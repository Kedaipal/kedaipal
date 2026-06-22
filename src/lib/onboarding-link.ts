// Builds the prefilled onboarding invite link the admin sends to a client when
// onboarding them by hand (admin billing → "Onboard a client"). The client opens
// it, signs up, and confirms — the store is created under *their* own Clerk login,
// so ownership is never ambiguous.
//
// Why a single opaque token (`?p=…`) instead of separate store/slug/wa params:
// the invite URL is handed to Clerk as the post-signup redirect, and a multi-param
// query (`?a=1&b=2&c=3`) gets truncated/mangled round-tripping through the auth
// redirect (later params silently drop). A single base64url token (chars
// A–Z a–z 0–9 - _ only — no & ? = %) round-trips intact through any redirect.
// Kept pure so it's unit-testable and the contract stays in lockstep with
// onboarding.tsx's `validateSearch`.

export type OnboardingInviteFields = {
	storeName: string;
	slug?: string;
	waPhone?: string;
};

export type OnboardingPrefill = { store: string; slug?: string; wa?: string };

/** The query-param key the invite token rides in. */
export const ONBOARDING_PREFILL_PARAM = "p";

function base64UrlEncode(text: string): string {
	const bytes = new TextEncoder().encode(text); // UTF-8 → bytes (unicode-safe)
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(token: string): string {
	const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
	const bin = atob(b64);
	const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

/** Encode the prefill into a single URL-safe token. Blank optional fields are
 * omitted. Returns "" when there's no usable store name. */
export function encodeOnboardingPrefill(
	fields: OnboardingInviteFields,
): string {
	const store = fields.storeName.trim();
	if (store.length === 0) return "";
	const payload: OnboardingPrefill = { store };
	const slug = fields.slug?.trim();
	if (slug) payload.slug = slug;
	const wa = fields.waPhone?.trim();
	if (wa) payload.wa = wa;
	return base64UrlEncode(JSON.stringify(payload));
}

/** Decode a token back to the prefill, or `undefined` if it's missing/garbage
 * (so the onboarding form just falls back to an empty, organic signup). */
export function decodeOnboardingPrefill(
	token: string | undefined,
): OnboardingPrefill | undefined {
	if (!token) return undefined;
	try {
		const obj = JSON.parse(base64UrlDecode(token)) as Record<string, unknown>;
		if (typeof obj.store === "string" && obj.store.length > 0) {
			return {
				store: obj.store,
				slug: typeof obj.slug === "string" ? obj.slug : undefined,
				wa: typeof obj.wa === "string" ? obj.wa : undefined,
			};
		}
	} catch {
		// malformed token — treat as no prefill
	}
	return undefined;
}

/**
 * Compose `<origin>/onboarding?p=<token>`. Returns `""` when there's no usable
 * store name, so callers can gate the copy button on a truthy result.
 */
export function buildOnboardingInviteLink(
	origin: string,
	fields: OnboardingInviteFields,
): string {
	const token = encodeOnboardingPrefill(fields);
	if (!token) return "";
	return `${origin}/onboarding?${ONBOARDING_PREFILL_PARAM}=${token}`;
}
