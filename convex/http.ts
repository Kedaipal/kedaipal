import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { getAdapter } from "./lib/channels/registry";

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
		console.log("WA webhook POST", {
			messageCount: messages.length,
			firstFrom: messages[0]?.channelUserId,
		});
		for (const msg of messages) {
			await ctx.runAction(internal.whatsapp.handleInbound, {
				fromPhone: msg.channelUserId,
				text: msg.text,
				profileName: msg.profileName,
			});
		}

		return new Response("ok", { status: 200 });
	}),
});

export default http;
