/**
 * Lalamove webhook signature verification (parallel to whatsappSignature.ts).
 *
 * Unlike Meta (header-based), Lalamove carries auth INSIDE the JSON body:
 *   { "apiKey": "pk_…", "timestamp": 173…, "signature": "hex…",
 *     "eventType": "ORDER_STATUS_CHANGED", "data": { … } }
 * and the signature is the same HMAC scheme as request signing, computed over
 *   "<TIMESTAMP>\r\nPOST\r\n<PATH>\r\n\r\n<BODY>"
 * with the partner's API SECRET, where PATH is OUR webhook path (everything
 * after the host, e.g. "/webhook/lalamove") and BODY is the JSON of the
 * event's `data` object (the signature can't cover the full raw body — it
 * contains itself).
 *
 * The exact BODY serialization is the one under-documented spot (the official
 * tutorial shows it only in a code screenshot), so `verifyLalamoveWebhook`
 * checks the documented candidate plus one conservative alternative and
 * reports WHICH matched — the first sandbox event tells us the truth and we
 * narrow to a single candidate then. Accepting either is not a security
 * weakening: both are HMACs under the same secret.
 *
 * Web Crypto only (Convex httpAction edge runtime), no Convex imports so it
 * unit-tests in isolation.
 */

import { lalamoveSigningString } from "./lalamove";

const encoder = new TextEncoder();

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
	return [...new Uint8Array(sig)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** Constant-time string comparison (same rationale as whatsappSignature.ts —
 * fixed-length hex digests, so length short-circuit leaks nothing). */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) {
		mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return mismatch === 0;
}

/** The auth envelope every Lalamove webhook body carries. */
export type LalamoveWebhookEnvelope = {
	apiKey: string;
	timestamp: number;
	signature: string;
	eventType: string;
	eventId?: string;
	eventVersion?: string;
	data: unknown;
};

/**
 * Parse the raw webhook body into its envelope. Returns null (never throws)
 * on anything malformed so the route can log + ack without acting.
 */
export function parseLalamoveWebhookEnvelope(
	rawBody: string,
): LalamoveWebhookEnvelope | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawBody);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const p = parsed as Record<string, unknown>;
	if (
		typeof p.apiKey !== "string" ||
		typeof p.signature !== "string" ||
		typeof p.eventType !== "string" ||
		typeof p.timestamp !== "number" ||
		p.data === undefined
	) {
		return null;
	}
	return {
		apiKey: p.apiKey,
		timestamp: p.timestamp,
		signature: p.signature,
		eventType: p.eventType,
		eventId: typeof p.eventId === "string" ? p.eventId : undefined,
		eventVersion:
			typeof p.eventVersion === "string" ? p.eventVersion : undefined,
		data: p.data,
	};
}

export type LalamoveWebhookVerification =
	| { valid: true; variant: "data" | "envelope" }
	| { valid: false };

/**
 * Verify a parsed envelope against the resolving partner's API secret.
 * Candidates (see module header):
 *  - "data":     BODY = JSON.stringify(envelope.data)
 *  - "envelope": BODY = raw body with the `signature` field's value blanked —
 *    covers the "sign everything except the signature" interpretation without
 *    depending on key order (we splice the original raw string).
 */
export async function verifyLalamoveWebhook(args: {
	rawBody: string;
	envelope: LalamoveWebhookEnvelope;
	path: string;
	apiSecret: string;
}): Promise<LalamoveWebhookVerification> {
	const { rawBody, envelope, path, apiSecret } = args;
	if (!apiSecret || !envelope.signature) return { valid: false };
	const provided = envelope.signature.toLowerCase();

	const dataCandidate = lalamoveSigningString({
		timestamp: envelope.timestamp,
		method: "POST",
		path,
		body: JSON.stringify(envelope.data),
	});
	if (timingSafeEqual(await hmacSha256Hex(apiSecret, dataCandidate), provided)) {
		return { valid: true, variant: "data" };
	}

	// Blank the signature value inside the ORIGINAL raw string (no
	// re-serialization → key order preserved).
	const blanked = rawBody.replace(envelope.signature, "");
	const envelopeCandidate = lalamoveSigningString({
		timestamp: envelope.timestamp,
		method: "POST",
		path,
		body: blanked,
	});
	if (
		timingSafeEqual(await hmacSha256Hex(apiSecret, envelopeCandidate), provided)
	) {
		return { valid: true, variant: "envelope" };
	}
	return { valid: false };
}

/** Test helper — compute the signature Lalamove would send for a payload
 * under the "data" variant. Mirrors computeMetaSignature's role in the
 * WhatsApp tests. */
export async function computeLalamoveWebhookSignature(args: {
	secret: string;
	timestamp: number;
	path: string;
	data: unknown;
}): Promise<string> {
	return hmacSha256Hex(
		args.secret,
		lalamoveSigningString({
			timestamp: args.timestamp,
			method: "POST",
			path: args.path,
			body: JSON.stringify(args.data),
		}),
	);
}
