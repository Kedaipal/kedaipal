/**
 * WhatsApp Cloud API webhook signature verification.
 *
 * Meta signs every webhook delivery with
 *   X-Hub-Signature-256: sha256=HMAC_SHA256(rawBody, APP_SECRET)
 * Verifying it proves the request genuinely came from Meta and wasn't tampered
 * with — the only defence for an otherwise-public, state-mutating endpoint.
 *
 * Uses Web Crypto (`crypto.subtle`) because Convex `httpAction`s run on the
 * edge runtime, where Node's `crypto` module isn't available. Kept free of
 * Convex imports so it can be unit-tested in isolation.
 */

const encoder = new TextEncoder();

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
	return [...new Uint8Array(signature)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** Compute the `sha256=…` header value Meta would send for this body. */
export async function computeMetaSignature(
	secret: string,
	body: string,
): Promise<string> {
	return `sha256=${await hmacSha256Hex(secret, body)}`;
}

/**
 * Verify an inbound webhook's `X-Hub-Signature-256` header against the raw
 * request body. Returns false (never throws) on any missing input or mismatch
 * so the caller can simply reject. The body MUST be the exact raw bytes Meta
 * sent — verify before `JSON.parse`, never re-serialize.
 */
export async function verifyMetaSignature({
	body,
	signatureHeader,
	appSecret,
}: {
	body: string;
	signatureHeader: string | null;
	appSecret: string;
}): Promise<boolean> {
	if (!signatureHeader || !appSecret) return false;
	const expected = await computeMetaSignature(appSecret, body);
	// Normalise case so we don't depend on Meta always sending lowercase hex
	// (our `expected` is lowercase; the `sha256=` prefix is unaffected).
	return timingSafeEqual(signatureHeader.toLowerCase(), expected);
}

/**
 * Constant-time string comparison to avoid leaking how many leading characters
 * matched. Length is allowed to short-circuit — HMAC hex digests are fixed
 * length, so length itself carries no secret.
 */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) {
		mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return mismatch === 0;
}
