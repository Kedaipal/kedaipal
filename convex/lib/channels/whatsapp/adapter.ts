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

// A LOCAL http:// origin (loopback / private-LAN host). Used only by the dev
// affordance below — such a host can never be a real public production URL, so
// matching it is a safe "this is local dev" signal that needs no env flag.
const LOCAL_HTTP_ORIGIN =
	/^http:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/i;

/**
 * Resolve the URL an interactive CTA button should point at, or `null` when the
 * CTA must degrade to a plain image/text (no button).
 *
 *   - HTTPS → passes through (production; Meta accepts it).
 *   - LOCAL http:// (localhost / loopback / private-LAN) → **dev affordance**:
 *     upgraded to https:// so Meta renders the button. Meta refuses non-HTTPS
 *     CTA URLs, and in local dev APP_URL is http://localhost, so without this
 *     the button would always degrade away and never be visible while
 *     developing. The message *body* keeps the original http link (which loads
 *     on the dev machine); the button's https URL won't resolve as-is, so the
 *     developer edits the scheme by hand when tapping it. Scoped to local hosts
 *     so a real (public) production domain can NEVER be silently rewritten — a
 *     misconfigured public http:// URL still degrades safely.
 *   - any other non-HTTPS URL → `null` (degrade).
 */
function ctaButtonUrl(url: string): string | null {
	if (!capabilities.ctaButtons) return null;
	if (url.startsWith("https://")) return url;
	if (LOCAL_HTTP_ORIGIN.test(url)) return `https://${url.slice("http://".length)}`;
	return null;
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
			const buttonUrl = ctaButtonUrl(msg.url);
			if (buttonUrl) {
				if (msg.imageUrl) {
					await sendCtaUrlWithImage(
						to,
						msg.imageUrl,
						msg.body,
						msg.buttonText,
						buttonUrl,
					);
				} else {
					await sendCtaUrlButton(to, msg.body, msg.buttonText, buttonUrl);
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
