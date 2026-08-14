import {
	createStartHandler,
	defaultStreamHandler,
} from "@tanstack/react-start/server";
import { rescuePlaceholderUrl } from "../convex/lib/trackingToken";

/**
 * Custom Worker entry (wrangler.jsonc `main`) — the default TanStack entry
 * plus one pre-router rescue (86eyheqzv): WhatsApp template buttons sent while
 * the template's URL variable was mis-registered carry a literal `{{1}}` before
 * the parameter (`/track/%7B%7B1%7D%7D<token>`), and the router's URL
 * canonicalization 307-loops on those paths (it decodes the braces in Location,
 * the browser re-encodes them — net::ERR_TOO_MANY_REDIRECTS). Those links are
 * frozen in recipients' chats, so the server must rescue them: 301 to the clean
 * URL before the router sees the request. Everything else passes straight
 * through to the standard Start handler.
 *
 * Route-agnostic on purpose — the seller order alerts (86eyhw9zy) put the first
 * URL buttons on `/app/orders/{{1}}`, so a `/track/`-only rescue would have left
 * the identical failure open on a path it didn't know about.
 */
const startFetch = createStartHandler(defaultStreamHandler);

export default {
	fetch: (async (request, opts) => {
		const rescued = rescuePlaceholderUrl(request.url);
		if (rescued) {
			// Deliberate log: counts arrivals through polluted links, and the path
			// names WHICH template is still mis-registered (visible in wrangler tail
			// / the Worker's dashboard log stream).
			console.warn("rescued placeholder-polluted link", {
				path: new URL(request.url).pathname,
			});
			return Response.redirect(rescued, 301);
		}
		return startFetch(request, opts);
	}) satisfies typeof startFetch,
};
