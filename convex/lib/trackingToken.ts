/**
 * Rescue for placeholder-polluted tracking links (86eyheqzv).
 *
 * The WhatsApp confirmation template's URL button was registered with a
 * literal `{{1}}` in its URL instead of a recognized dynamic variable, so
 * WhatsApp composes the button link as `/track/{{1}}<token>` — the
 * placeholder survives and the real token is appended after it. Tapping that
 * URL then hit an infinite 307 loop: TanStack's URL canonicalization decodes
 * `%7B` → `{` in the Location header, the browser re-encodes it back, forever
 * (net::ERR_TOO_MANY_REDIRECTS — the prod buyer blocker).
 *
 * Those links are frozen in buyers' chat histories — no template fix can
 * repair a message that's already sent — so the server rescues them instead:
 * the custom server entry 301s a polluted /track path to the clean-token URL
 * before the router ever sees it, and the Convex token lookup normalizes as
 * defence in depth. Tokens are crypto-random alphanumerics and can never
 * legitimately contain braces, so stripping is unambiguous.
 */

/**
 * Strip any leading run of `{{n}}` template placeholders — literal or
 * percent-encoded (`%7B%7B1%7D%7D`, any hex case) — from a tracking token.
 */
export function normalizeTrackingToken(raw: string): string {
	return raw
		.trim()
		.replace(/^(?:\{\{\d+\}\}|(?:%7[Bb]){2}\d+(?:%7[Dd]){2})+/, "");
}

/**
 * If `rawUrl` is a /track link whose token segment carries a placeholder
 * prefix, return the cleaned absolute URL to 301 to; null when the URL is
 * clean, isn't a /track link, or nothing usable remains after stripping
 * (a degenerate `/track/{{1}}` with no token — nowhere sensible to send it).
 */
export function rescueTrackUrl(rawUrl: string): string | null {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return null;
	}
	const match = url.pathname.match(/^\/track\/(.+)$/);
	if (!match) return null;
	const rawToken = match[1];
	const cleaned = normalizeTrackingToken(rawToken);
	if (cleaned === rawToken || cleaned.length === 0) return null;
	return `${url.origin}/track/${cleaned}${url.search}`;
}
