import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { getAdapter } from "./lib/channels/registry";
import { extractWebhookOrderId } from "./lib/lalamove";
import {
	parseLalamoveWebhookEnvelope,
	verifyLalamoveWebhook,
} from "./lib/lalamoveSignature";
import { extractWabaHealthEvents } from "./lib/wabaWebhook";

const http = httpRouter();

/**
 * WhatsApp Cloud API webhook verification (GET) + receive (POST).
 *
 * Meta sends a GET with hub.mode=subscribe, hub.verify_token, hub.challenge.
 * If our token matches, echo the challenge with 200; else 403.
 */
http.route({
	path: "/webhook/whatsapp",
	method: "GET",
	handler: httpAction(async (_ctx, req) => {
		const url = new URL(req.url);
		const mode = url.searchParams.get("hub.mode");
		const token = url.searchParams.get("hub.verify_token");
		const challenge = url.searchParams.get("hub.challenge");
		const expected = process.env.WHATSAPP_VERIFY_TOKEN;

		if (mode === "subscribe" && expected && token === expected && challenge) {
			return new Response(challenge, {
				status: 200,
				headers: { "Content-Type": "text/plain" },
			});
		}
		return new Response("forbidden", { status: 403 });
	}),
});

http.route({
	path: "/webhook/whatsapp",
	method: "POST",
	handler: httpAction(async (ctx, req) => {
		const adapter = getAdapter("whatsapp");

		// Verify the request genuinely came from Meta before acting on it. This
		// endpoint mutates order + customer state, so an unauthenticated POST is
		// a spoofing vector. Meta signs the raw body with the app secret.
		const rawBody = await req.text();

		// Fail closed when the secret is absent: without it we cannot
		// authenticate anything, so distinguish this misconfiguration (500) from
		// a genuine bad/missing signature (401, handled by the adapter below).
		// Set WHATSAPP_APP_SECRET in the Convex deployment env before deploy.
		if (!process.env.WHATSAPP_APP_SECRET) {
			console.error(
				"WA webhook rejected: WHATSAPP_APP_SECRET is not configured",
			);
			return new Response("server misconfigured", { status: 500 });
		}

		const valid = await adapter.verifySignature(rawBody, req.headers);
		if (!valid) {
			console.warn("WA webhook rejected: invalid X-Hub-Signature-256");
			return new Response("invalid signature", { status: 401 });
		}

		// Signature OK — the adapter parses the raw body we already verified into
		// channel-agnostic envelopes.
		const messages = adapter.parseInbound(rawBody, req.headers);
		// Log the inbound identity triplet (phone + pushname + a short text preview)
		// so the WhatsApp identity-binding flow used by order confirmation — and the
		// Counter Checkout `KP-<token>` flipped flow (ClickUp 86ey0e80x) — is
		// observable end-to-end without decoding raw payloads.
		console.log("WA webhook POST", {
			messageCount: messages.length,
			firstFrom: messages[0]?.channelUserId,
			firstProfileName: messages[0]?.profileName,
			firstText: messages[0]?.text?.slice(0, 60),
		});
		for (const msg of messages) {
			await ctx.runAction(internal.whatsapp.handleInbound, {
				fromPhone: msg.channelUserId,
				text: msg.text,
				profileName: msg.profileName,
			});
		}

		// WABA health events ride the SAME webhook (different `field`):
		// phone_number_quality_update / account_update. Capture them so the send
		// gateway can auto-throttle on degradation and ops gets paged. These
		// fields must be subscribed in the Meta App dashboard — see
		// docs/waba-protection.md. We key health on OUR configured number; the
		// payload echoes a display number, not the phone_number_id.
		let parsedBody: unknown;
		try {
			parsedBody = JSON.parse(rawBody);
		} catch {
			parsedBody = null; // already handled/logged by parseInbound above
		}
		const healthEvents = extractWabaHealthEvents(parsedBody);
		for (const ev of healthEvents) {
			console.warn("WABA health webhook", ev);
			const result = await ctx.runMutation(
				internal.wabaProtection.recordWabaHealth,
				{
					qualityRating: ev.qualityRating,
					messagingTier: ev.messagingTier,
					notes: ev.notes,
				},
			);
			if (result.shouldAlert) {
				await ctx.scheduler.runAfter(0, internal.wabaProtection.sendWabaAlert, {
					summary: result.summary,
				});
			}
		}

		return new Response("ok", { status: 200 });
	}),
});

/**
 * Lalamove webhook (docs/delivery-lalamove.md, ClickUp 86eyb5hrf).
 *
 * Mirrors the WhatsApp route's control flow (raw body → secret guard →
 * verify → act → ack) with two Lalamove-specific twists:
 *  - auth lives INSIDE the JSON body (apiKey/timestamp/signature), not a
 *    header, and the verifying secret is PER-RETAILER (BYO-first model): we
 *    resolve candidate secrets through the deliveryJobs row the event
 *    references before verifying;
 *  - Lalamove retries 10× over 24h and DISABLES the URL after 10 failures,
 *    so every handled-or-ignorable outcome acks 200. Non-200 is reserved for
 *    real auth problems (401 forged, 500 misconfigured) where dropping the
 *    URL would be the right outcome anyway.
 *
 * Idempotency + out-of-order handling live in lalamove.applyWebhookEvent.
 */
http.route({
	path: "/webhook/lalamove",
	method: "POST",
	handler: httpAction(async (ctx, req) => {
		const rawBody = await req.text();

		// Initial-connection ping / non-event POSTs: Lalamove expects a 200
		// before any complex logic (their tutorial is explicit about this).
		const envelope = parseLalamoveWebhookEnvelope(rawBody);
		if (!envelope) {
			console.log("Lalamove webhook: non-event body, acking", {
				bytes: rawBody.length,
			});
			return new Response("ok", { status: 200 });
		}

		const providerOrderId = extractWebhookOrderId(envelope.data);
		const { jobId, secrets } = await ctx.runQuery(
			internal.lalamove.getWebhookContext,
			{ providerOrderId, apiKey: envelope.apiKey },
		);

		if (jobId !== null && secrets.length === 0) {
			// A job we placed but no secret can verify it — credentials were
			// removed after booking AND no platform secret is configured. Fail
			// closed like the WhatsApp route's missing-secret guard.
			console.error(
				"Lalamove webhook rejected: no verifying secret configured",
				{ providerOrderId },
			);
			return new Response("server misconfigured", { status: 500 });
		}
		if (jobId === null) {
			// Not ours to act on: bookings made outside Kedaipal on the same
			// account, wallet events, or an unknown sender. Ack so Lalamove
			// doesn't disable the URL over traffic we deliberately ignore.
			console.log("Lalamove webhook: no matching delivery job, ignoring", {
				eventType: envelope.eventType,
				providerOrderId,
			});
			return new Response("ok", { status: 200 });
		}

		const path = new URL(req.url).pathname;
		let verified = false;
		for (const apiSecret of secrets) {
			const result = await verifyLalamoveWebhook({
				rawBody,
				envelope,
				path,
				apiSecret,
			});
			if (result.valid) {
				verified = true;
				// The exact signing-body variant is under-documented — log which
				// one real traffic uses so we can narrow the verifier (see
				// convex/lib/lalamoveSignature.ts header).
				console.log("Lalamove webhook verified", {
					eventType: envelope.eventType,
					variant: result.variant,
				});
				break;
			}
		}
		if (!verified) {
			console.warn("Lalamove webhook rejected: invalid signature", {
				eventType: envelope.eventType,
				providerOrderId,
			});
			return new Response("invalid signature", { status: 401 });
		}

		await ctx.runMutation(internal.lalamove.applyWebhookEvent, {
			jobId,
			eventType: envelope.eventType,
			data: envelope.data,
			eventTimestamp: envelope.timestamp,
		});
		return new Response("ok", { status: 200 });
	}),
});

export default http;
