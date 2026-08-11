import {
	createStartHandler,
	defaultStreamHandler,
} from "@tanstack/react-start/server";
import { rescueTrackUrl } from "../convex/lib/trackingToken";

/**
 * Custom Worker entry (wrangler.jsonc `main`) — the default TanStack entry
 * plus one pre-router rescue (86eyheqzv): WhatsApp confirmation buttons sent
 * while the template's URL variable was mis-registered carry a literal
 * `{{1}}` before the token (`/track/%7B%7B1%7D%7D<token>`), and the router's
 * URL canonicalization 307-loops on those paths (it decodes the braces in
 * Location, the browser re-encodes them — net::ERR_TOO_MANY_REDIRECTS).
 * Those links are frozen in buyers' chats, so the server must rescue them:
 * 301 to the clean-token URL before the router sees the request. Everything
 * else passes straight through to the standard Start handler.
 */
const startFetch = createStartHandler(defaultStreamHandler);

export default {
	fetch: (async (request, opts) => {
		const rescued = rescueTrackUrl(request.url);
		if (rescued) {
			// Deliberate log: counts buyers still arriving through polluted links
			// (visible in wrangler tail / the Worker's dashboard log stream).
			console.warn("rescued placeholder-polluted /track link", {
				path: new URL(request.url).pathname,
			});
			return Response.redirect(rescued, 301);
		}
		return startFetch(request, opts);
	}) satisfies typeof startFetch,
};
