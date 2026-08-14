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
 * the custom server entry 301s a polluted path to the clean URL before the
 * router ever sees it, and the Convex token lookup normalizes as defence in
 * depth. Tokens are crypto-random alphanumerics and can never legitimately
 * contain braces, so stripping is unambiguous.
 *
 * The rescue is route-agnostic (see `rescuePlaceholderUrl`): the same
 * mis-registration on the seller alert templates' `/app/orders/{{1}}` button
 * would fail exactly the same way, and a rescue that only knew about `/track/`
 * would have let that recur as a fresh incident.
 */

/** A leading run of `{{n}}` placeholders — literal or percent-encoded
 * (`%7B%7B1%7D%7D`, any hex case). WhatsApp appends the real parameter AFTER
 * the unrecognized placeholder, so pollution is always a prefix. */
const PLACEHOLDER_PREFIX = /^(?:\{\{\d+\}\}|(?:%7[Bb]){2}\d+(?:%7[Dd]){2})+/;

/**
 * Strip any leading run of `{{n}}` template placeholders from a tracking token.
 */
export function normalizeTrackingToken(raw: string): string {
	return raw.trim().replace(PLACEHOLDER_PREFIX, "");
}

/**
 * If any path segment of `rawUrl` carries a placeholder prefix, return the
 * cleaned absolute URL to 301 to; null when the URL is already clean, isn't
 * parseable, or a segment turns out to be a placeholder and NOTHING else
 * (`/track/{{1}}` — the parameter never arrived, so there is no destination to
 * guess; let the router 404 it rather than invent one).
 *
 * Deliberately route-agnostic. The rescue shipped for `/track/` because that
 * was the button URL that broke in prod, but the failure is a property of
 * *any* template whose URL button is registered with hand-typed braces — and
 * the seller order alerts (86eyhw9zy) added the first buttons on a different
 * path (`/app/orders/{{1}}`). Scoping the rescue to one prefix would have made
 * the next mis-registration a fresh incident. No legitimate Kedaipal path can
 * contain braces (slugs, shortIds and tracking tokens are all generated from
 * alphanumerics), so stripping is unambiguous everywhere.
 */
export function rescuePlaceholderUrl(rawUrl: string): string | null {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return null;
	}
	const segments = url.pathname.split("/");
	let changed = false;
	for (let i = 0; i < segments.length; i++) {
		const stripped = segments[i].replace(PLACEHOLDER_PREFIX, "");
		if (stripped === segments[i]) continue;
		if (stripped.length === 0) return null;
		segments[i] = stripped;
		changed = true;
	}
	if (!changed) return null;
	return `${url.origin}${segments.join("/")}${url.search}`;
}
