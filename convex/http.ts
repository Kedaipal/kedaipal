import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { verifyMetaSignature } from "./lib/whatsappSignature";
import { extractInboundMessages } from "./lib/whatsappWebhook";

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
		// Verify the request genuinely came from Meta before acting on it. This
		// endpoint mutates order + customer state, so an unauthenticated POST is
		// a spoofing vector. Meta signs the raw body with the app secret.
		const appSecret = process.env.WHATSAPP_APP_SECRET;
		const rawBody = await req.text();
		const signature = req.headers.get("x-hub-signature-256");

		if (!appSecret) {
			// Fail closed: without the secret we cannot authenticate anything.
			// Set WHATSAPP_APP_SECRET in the Convex deployment env before deploy.
			console.error(
				"WA webhook rejected: WHATSAPP_APP_SECRET is not configured",
			);
			return new Response("server misconfigured", { status: 500 });
		}

		const valid = await verifyMetaSignature({
			body: rawBody,
			signatureHeader: signature,
			appSecret,
		});
		if (!valid) {
			console.warn("WA webhook rejected: invalid X-Hub-Signature-256");
			return new Response("invalid signature", { status: 401 });
		}

		// Signature OK — parse the raw body we already verified.
		let payload: unknown;
		try {
			payload = JSON.parse(rawBody);
		} catch {
			return new Response("bad json", { status: 400 });
		}

		const messages = extractInboundMessages(payload);
		console.log("WA webhook POST", {
			messageCount: messages.length,
			firstFrom: messages[0]?.from,
		});
		for (const msg of messages) {
			await ctx.runAction(internal.whatsapp.handleInbound, {
				fromPhone: msg.from,
				text: msg.text,
				profileName: msg.profileName,
			});
		}

		return new Response("ok", { status: 200 });
	}),
});

export default http;
