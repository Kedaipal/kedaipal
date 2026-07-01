/**
 * WhatsApp Cloud API adapter. Conforms the existing Meta-specific transport
 * (convex/lib/whatsapp.ts), inbound parser (whatsappWebhook.ts), and signature
 * verifier (whatsappSignature.ts) to the channel-agnostic ChannelAdapter
 * interface. This is a thin delegation layer — it deliberately does NOT
 * reimplement any wire logic, so the existing unit tests on those modules
 * remain the source of truth.
 */

import type {
	ChannelAdapter,
	ChannelCapabilities,
	InboundEnvelope,
	OutboundMessage,
} from "../types";
import {
	sendCtaUrlButton,
	sendCtaUrlWithImage,
	sendDocument,
	sendImage,
	sendText,
} from "../../whatsapp";
import { extractInboundMessages } from "../../whatsappWebhook";
import { verifyMetaSignature } from "../../whatsappSignature";

const capabilities: ChannelCapabilities = { ctaButtons: true };

/**
 * Whether a CTA message can render as an interactive button. Two independent
 * gates, both resolved here so the orchestrator never carries provider quirks:
 *   1. the channel must support CTA buttons (capabilities.ctaButtons), and
 *   2. Meta rejects non-HTTPS CTA URLs — in dev (APP_URL=http://localhost) the
 *      button would be refused, so we degrade to a plain image/text instead.
 */
function canUseCtaButton(url: string): boolean {
	return capabilities.ctaButtons && url.startsWith("https://");
}

async function send(to: string, msg: OutboundMessage): Promise<void> {
	switch (msg.kind) {
		case "text":
			await sendText(to, msg.body);
			return;
		case "image":
			await sendImage(to, msg.imageUrl, msg.caption);
			return;
		case "document":
			await sendDocument(to, msg.documentUrl, msg.filename, msg.caption);
			return;
		case "cta": {
			if (canUseCtaButton(msg.url)) {
				if (msg.imageUrl) {
					await sendCtaUrlWithImage(
						to,
						msg.imageUrl,
						msg.body,
						msg.buttonText,
						msg.url,
					);
				} else {
					await sendCtaUrlButton(to, msg.body, msg.buttonText, msg.url);
				}
				return;
			}
			// Degraded path: no interactive button. Keep the image header if one
			// was provided, otherwise fall back to plain text. (Today's only
			// caller always supplies imageUrl, so the text fallback is a forward
			// affordance for future callers, not a path the order flow hits.)
			if (msg.imageUrl) {
				await sendImage(to, msg.imageUrl, msg.body);
			} else {
				await sendText(to, msg.body);
			}
			return;
		}
	}
}

function parseInbound(rawBody: string, _headers: Headers): InboundEnvelope[] {
	let payload: unknown;
	try {
		payload = JSON.parse(rawBody);
	} catch {
		// A correctly-signed Meta webhook is always valid JSON; a malformed body
		// yields no messages rather than throwing, so the route can ack (200).
		// Log it so the anomaly is observable if that assumption is ever violated
		// (truncated delivery, proxy re-encoding) — the old route surfaced this as
		// a 400, which we trade for an ack + log entry.
		console.error("WA webhook: signed body failed JSON.parse — discarding");
		return [];
	}
	return extractInboundMessages(payload).map((m) => ({
		channel: "whatsapp" as const,
		channelUserId: m.from,
		text: m.text,
		profileName: m.profileName,
	}));
}

async function verifySignature(
	rawBody: string,
	headers: Headers,
): Promise<boolean> {
	const appSecret = process.env.WHATSAPP_APP_SECRET;
	if (!appSecret) return false;
	return verifyMetaSignature({
		body: rawBody,
		signatureHeader: headers.get("x-hub-signature-256"),
		appSecret,
	});
}

export const whatsappAdapter: ChannelAdapter = {
	channel: "whatsapp",
	capabilities,
	send,
	parseInbound,
	verifySignature,
};
