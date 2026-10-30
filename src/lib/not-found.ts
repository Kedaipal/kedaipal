/**
 * Where a visitor was when they hit a URL that doesn't exist — which decides
 * the next step the not-found page offers (`components/not-found/`).
 *
 * Read from the PATHNAME, not from the route id the boundary rendered under:
 * TanStack's fuzzy not-found mode renders the page inside the deepest matched
 * route that has children (`/app`, a virtual promotions parent, the root), so
 * the route id moves with the route tree while the pathname is what the
 * visitor actually typed or followed.
 *
 * - `app`   — anything under `/app`: a signed-in seller inside the dashboard.
 * - `store` — a single public segment (`/some-typo`): on Kedaipal that is the
 *   shape of a store link, and in practice `/$slug` claims it and renders this
 *   context itself once the slug resolves to nobody.
 * - `site`  — everything else: a stale marketing link, a mistyped page.
 */
export type NotFoundContext = "app" | "store" | "site";

export function notFoundContext(pathname: string): NotFoundContext {
	const segments = pathSegments(pathname);
	if (segments[0] === "app") return "app";
	if (segments.length === 1) return "store";
	return "site";
}

/**
 * The dashboard section a dead `/app/...` link was reaching for, when the
 * first segment names one — so `/app/orders/old-link/extra` can offer
 * "Go to Orders" beside "Back to Home". Labels match the sidebar's, so the
 * button names the place the seller will see highlighted when they land.
 * Admin pages are deliberately absent: an admin knows their way, and a seller
 * who mistyped into `/app/admin` should not be handed an admin door.
 */
const APP_SECTIONS: Record<string, { label: string; to: AppSectionPath }> = {
	orders: { label: "Orders", to: "/app/orders" },
	products: { label: "Products", to: "/app/products" },
	promotions: { label: "Promotions", to: "/app/promotions" },
	deliveries: { label: "Deliveries", to: "/app/deliveries" },
	checkout: { label: "Counter", to: "/app/checkout" },
	customers: { label: "Customers", to: "/app/customers" },
	vouchers: { label: "Vouchers", to: "/app/vouchers" },
	insights: { label: "Insights", to: "/app/insights" },
	settings: { label: "Settings", to: "/app/settings" },
};

export type AppSectionPath =
	| "/app/orders"
	| "/app/products"
	| "/app/promotions"
	| "/app/deliveries"
	| "/app/checkout"
	| "/app/customers"
	| "/app/vouchers"
	| "/app/insights"
	| "/app/settings";

export function appSectionFor(
	pathname: string,
): { label: string; to: AppSectionPath } | null {
	const [root, section] = pathSegments(pathname);
	if (root !== "app" || !section) return null;
	return Object.hasOwn(APP_SECTIONS, section) ? APP_SECTIONS[section] : null;
}

/** The tab title for each context — what `head()` sets on a not-found render. */
export const NOT_FOUND_TITLE: Record<NotFoundContext, string> = {
	app: "Page not found — Kedaipal",
	store: "Store not found — Kedaipal",
	site: "Page not found — Kedaipal",
};

/**
 * The head of a not-found render: its own title, and out of search. The 404
 * status already keeps it out of the index; `noindex` says the same thing to a
 * crawler that only reads the HTML.
 */
export function notFoundHeadMeta(context: NotFoundContext) {
	return [
		{ title: NOT_FOUND_TITLE[context] },
		{ name: "robots", content: "noindex, follow" },
	];
}

/** The slice of a route match the head helpers below read. */
type HeadMatch = { globalNotFound?: boolean; status?: string };

/**
 * This match renders the not-found page: either the URL matched nothing and
 * this layout is the deepest one under the miss (`globalNotFound` — `/app`
 * for a dead `/app/...` link, with status still `success`), or its own loader
 * threw `notFound()` (`/$slug` for a slug that names nobody).
 */
export function rendersNotFound(match: HeadMatch): boolean {
	return Boolean(match.globalNotFound) || match.status === "notFound";
}

/**
 * The URL matched nothing and the miss belongs to an ANCESTOR — this route was
 * only matched on the way. Fuzzy matching still runs `/$slug` (slug "foo") for
 * `/foo/bar`, and its head outranks the root's, so without this a store's
 * title — or "Store not found" — lands on a "Page not found" page. A route
 * that can be matched this way keeps its head silent when it's true.
 */
export function missOwnedElsewhere(
	matches: readonly HeadMatch[],
	match: HeadMatch,
): boolean {
	return !match.globalNotFound && matches.some((m) => m.globalNotFound);
}

/** The slice of a route's `head()` context the wrapper reads. */
type HeadCtx = { match: HeadMatch; matches: readonly HeadMatch[] };

/**
 * A LEAF route's `head()`, silent when the route was only matched on the way
 * to a URL nothing claims. Fuzzy matching matches a static leaf as readily as
 * a param one — `/pricing` is matched for `/pricing/anything`, `/stores` for
 * `/stores/x`, `/track/$token` (loader included) for `/track/<token>/x` — and
 * the deepest head wins the tag dedupe, so without this a "Page not found"
 * body carries the leaf's title, canonical, JSON-LD and even its
 * `robots: index, follow`.
 *
 *     head: (ctx) => pageHead(ctx, ({ loaderData }) => ({ meta: [...] })),
 *
 * The context is passed in rather than closed over so TanStack types it (the
 * route options object is still being inferred when `head` is typed, so a
 * `pageHead(fn)` wrapper would lose `loaderData`'s type). Every leaf route's
 * `head` goes through here; `not-found-head-sweep.test.ts` fails on one that
 * doesn't. The two LAYOUTS that own misses (`__root`, `/app`) are the
 * exceptions: `missOwnedElsewhere` is false for the owner anyway, and the
 * root's head carries the charset, viewport and stylesheet, which a miss under
 * `/app` must never silence.
 */
export function pageHead<C extends HeadCtx, R>(
	ctx: C,
	head: (ctx: C) => R,
): R | Record<string, never> {
	return missOwnedElsewhere(ctx.matches, ctx.match) ? {} : head(ctx);
}

/** Past this, the printed path is cut — a pasted tracking URL must not push
 * the actions off a phone screen. */
export const DISPLAY_PATH_MAX = 60;

/**
 * The path as the visitor would recognise it: percent-escapes decoded (a
 * mistyped `/kedai%20sayang` reads `/kedai sayang`), cut with an ellipsis past
 * `DISPLAY_PATH_MAX`. A malformed escape is shown raw rather than throwing.
 */
export function displayPath(pathname: string): string {
	let readable = pathname;
	try {
		readable = decodeURIComponent(pathname);
	} catch {
		// `%E0%A4%A` and friends: leave the raw text, it's still the right path.
	}
	return readable.length > DISPLAY_PATH_MAX
		? `${readable.slice(0, DISPLAY_PATH_MAX - 1)}…`
		: readable;
}

function pathSegments(pathname: string): string[] {
	return pathname.split(/[?#]/)[0].split("/").filter(Boolean);
}
