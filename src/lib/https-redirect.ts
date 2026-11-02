import { isLocalHttpOrigin } from "../../convex/lib/localOrigin";

/**
 * The Worker's HTTPS guard (z8r3fdg3bw) — defence in depth behind Cloudflare's
 * zone-level "Always Use HTTPS". The edge redirect is the real fix (it fires
 * before the Worker runs and costs nothing); this guard exists so a flipped
 * dashboard toggle can't silently put `/track/<token>` — capability-secured by
 * the token in its URL — back on plain http. It also covers `*.workers.dev`,
 * where zone settings don't apply. See docs/https-enforcement.md.
 */

/** `http://` plus the authority (host and optional port), case-insensitive. */
const HTTP_AUTHORITY = /^http:\/\/([^/?#]*)/i;

/**
 * The `https://` URL to redirect an http request to, or `null` when it should
 * be served as-is (already https, a local dev host, or not an http URL at all).
 *
 * Built by swapping the scheme on the request string; path and query are not
 * touched. `Response.redirect` then parses and serialises the result, which
 * keeps percent-encoded bytes (`%7B%7B1%7D%7D`) exactly as they arrived — the
 * WHATWG serialiser never decodes them. That matters because the 86eyheqzv
 * loop was the router DECODING those braces in `Location`, which this hop never
 * does (pinned by the `Location` test). A non-default port is dropped: a public
 * host serves https on 443.
 */
export function httpsRedirectTarget(requestUrl: string): string | null {
	const match = HTTP_AUTHORITY.exec(requestUrl);
	if (!match || isLocalHttpOrigin(requestUrl)) return null;
	const host = match[1].replace(/:\d*$/, "");
	if (host === "") return null;
	return `https://${host}${requestUrl.slice(match[0].length)}`;
}

/**
 * 301 for GET/HEAD; 308 otherwise, because browsers re-send a 301'd POST as a
 * GET with no body — 308 keeps the method and the body.
 */
export function httpsRedirectStatus(method: string): 301 | 308 {
	const m = method.toUpperCase();
	return m === "GET" || m === "HEAD" ? 301 : 308;
}
