// Where to send a visitor who is *already* signed in but has landed on
// `/sign-in` or `/sign-up`.
//
// Clerk serialises its redirect options onto the auth URL as query params
// (`redirect_url`, `sign_in_force_redirect_url`, …) — e.g. `/onboarding` bounces
// a signed-out admin-invited client to `/sign-up?redirect_url=<invite link>`.
// If we ignored them we'd drop the client's prefill token on the floor and dump
// them on a bare dashboard, so an existing session honours the same target Clerk
// would have used.
//
// Kept pure (no router/window imports) so the open-redirect rules are unit-testable.

/** The post-auth destination when nothing usable is on the URL. */
export const DEFAULT_SIGNED_IN_DESTINATION = "/app";

/**
 * Clerk's redirect params, most specific first. `force` wins over `redirect_url`
 * because that's Clerk's own precedence — a caller that set a *force* URL meant it.
 */
const REDIRECT_PARAM_KEYS = [
	"sign_in_force_redirect_url",
	"sign_up_force_redirect_url",
	"redirect_url",
	"sign_in_fallback_redirect_url",
	"sign_up_fallback_redirect_url",
] as const;

/**
 * Bouncing a signed-in visitor back to an auth route would loop forever, so the
 * auth routes are never a valid destination.
 */
const AUTH_PATH_PREFIXES = ["/sign-in", "/sign-up"];

/**
 * A path we're willing to navigate to: same-origin and path-only.
 *
 * Rejects `//evil.com` and `/\evil.com` — both are protocol-relative URLs that
 * browsers resolve off-origin despite the leading slash (the classic open-redirect
 * bypass).
 */
export function isSafeInternalPath(value: string): boolean {
	if (!value.startsWith("/")) return false;
	if (value.startsWith("//") || value.startsWith("/\\")) return false;
	return !AUTH_PATH_PREFIXES.some(
		(prefix) => value === prefix || value.startsWith(`${prefix}/`),
	);
}

/**
 * Reduce a Clerk redirect param to a safe internal path, or `undefined` when it
 * points off-origin / is unusable. Absolute URLs are accepted only when they
 * match `origin` — `/onboarding` hands Clerk a `location.href`, so an absolute
 * URL on our own origin is a legitimate, expected shape.
 */
function toInternalPath(raw: string, origin?: string): string | undefined {
	const value = raw.trim();
	if (value.length === 0) return undefined;
	if (value.startsWith("/")) {
		return isSafeInternalPath(value) ? value : undefined;
	}
	if (!origin) return undefined;
	try {
		const url = new URL(value);
		if (url.origin !== new URL(origin).origin) return undefined;
		const path = `${url.pathname}${url.search}${url.hash}`;
		return isSafeInternalPath(path) ? path : undefined;
	} catch {
		// Not a parseable absolute URL — treat as no destination.
		return undefined;
	}
}

/**
 * Resolve the destination for an already-signed-in visitor on an auth route.
 * Falls back to the dashboard, which itself routes a storeless seller onward to
 * `/onboarding` — so this never needs to guess at onboarding state.
 */
export function resolveSignedInDestination(
	search: Record<string, unknown>,
	origin?: string,
): string {
	for (const key of REDIRECT_PARAM_KEYS) {
		const raw = search[key];
		if (typeof raw !== "string") continue;
		const path = toInternalPath(raw, origin);
		if (path) return path;
	}
	return DEFAULT_SIGNED_IN_DESTINATION;
}
