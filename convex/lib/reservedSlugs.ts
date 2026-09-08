/**
 * Store handles a vendor can never register (ClickUp z8r3fddrd3).
 *
 * A store lives at `kedaipal.com/<slug>`, at the ROOT of the domain, so every
 * top-level path the app serves — or might serve — is a name a vendor must not
 * be able to take. A store registered as `track` would sit on the same first
 * segment as the buyer tracking page; one registered as `privacy` would
 * shadow the legal page in every link we ever send.
 *
 * ONE author for both sides: `convex/lib/slug.ts` (the server authority) and
 * `src/lib/slug.ts` (the live form pre-check) both import this module, so the
 * two can never disagree about what is reserved. Pure — no Convex imports —
 * so the client bundle and the unit tests can load it directly.
 *
 * The list is MACHINE-CHECKED, not remembered: `src/lib/reserved-slugs.test.ts`
 * scans `src/routes/` and `public/` and fails the gate when a top-level path
 * exists that is not in here. Add a route, forget this file, the build says so.
 * The same test refuses entries the slug pattern could never match (a dot, an
 * underscore, fewer than 3 chars) — a dead entry is false comfort, not safety.
 *
 * Grouped by WHY each name is fenced. Order inside a group is alphabetical;
 * the groups themselves are overlapping by nature (`poster` is both a public
 * folder and a dashboard page) — the Set de-duplicates, and the test forbids
 * listing a name twice so the groups stay honest.
 */

/**
 * Live top-level routes under `src/routes/` (first path segment of each
 * file). The gate test derives this list from disk and fails if any is
 * missing here. Dotted files (`sitemap.xml`) are not listed: the slug shape
 * already rejects a dot, and the test proves it.
 */
const LIVE_ROUTES = [
	"acceptable-use",
	"app",
	"claim",
	"cost",
	"onboarding",
	"pricing",
	"privacy",
	"sign-in",
	"sign-up",
	"terms",
	"track",
] as const;

/**
 * Top-level folders in `public/`, served from the root by Cloudflare assets.
 * A store at `/img` would work for the bare path (no such file) and then
 * every one of its product pages would race the asset router. Dotted
 * filenames (`favicon.ico`, `robots.txt`) are unreachable as slugs and not
 * listed — same rule as the routes.
 */
const PUBLIC_FOLDERS = ["guides", "img", "poster", "video"] as const;

/**
 * Paths the platform layer owns or is conventionally expected to: Vite's
 * built chunks (`/assets`), a future API/webhook surface, health and status
 * endpoints, the usual infra subdomain-style names people type as paths.
 * TanStack Start's own internals (`/_server`, `/_build`) start with an
 * underscore and are unreachable as slugs.
 */
const PLATFORM = [
	"admin",
	"api",
	"assets",
	"auth",
	"callback",
	"cdn",
	"health",
	"oauth",
	"public",
	"static",
	"status",
	"webhook",
	"webhooks",
	"www",
] as const;

/**
 * Auth-flow names. `sign-in`/`sign-up` are the live Clerk routes; the rest are
 * the spellings people expect to work and which we may alias later.
 */
const AUTH = [
	"account",
	"forgot-password",
	"invite",
	"join",
	"login",
	"logout",
	"password",
	"register",
	"reset-password",
	"sign-out",
	"signin",
	"signout",
	"signup",
	"verify",
] as const;

/**
 * Marketing and company pages — the ones live today (`pricing`, `cost`, the
 * legal trio, listed above) plus the pages a SaaS grows: help centre, blog,
 * changelog, partner/referral programmes, a public directory of stores.
 * Registering `help` today would cost us the URL the day we write a help
 * centre, and a rename is a broken link for every buyer who saved it.
 */
const MARKETING = [
	"about",
	"affiliate",
	"affiliates",
	"blog",
	"careers",
	"changelog",
	"community",
	"compare",
	"contact",
	"directory",
	"discover",
	"docs",
	"explore",
	"faq",
	"guide",
	"help",
	"legal",
	"marketplace",
	"news",
	"partners",
	"press",
	"referral",
	"referrals",
	"releases",
	"roadmap",
	"search",
	"support",
	"whats-new",
] as const;

/**
 * Dashboard nouns. Today they live under `/app/…`, but a top-level `/orders`
 * or `/billing` is the first thing anyone proposes when the `/app` prefix
 * gets tired — and a vendor sitting on `orders` would block that forever.
 * Also the buyer-facing nouns (`checkout`, `pay`, `invoice`, `receipt`) that
 * a future hosted-checkout or shareable-invoice surface would want at the root.
 */
const PRODUCT = [
	"billing",
	"booking",
	"bookings",
	"calendar",
	"cart",
	"checkout",
	"customer",
	"customers",
	"dashboard",
	"export",
	"home",
	"import",
	"inbox",
	"insights",
	"integrations",
	"invoice",
	"invoices",
	"labels",
	"manage",
	"notifications",
	"order",
	"orders",
	"pay",
	"payment",
	"payments",
	"plan",
	"plans",
	"product",
	"products",
	"profile",
	"receipt",
	"receipts",
	"settings",
	"subscribe",
	"subscription",
	"team",
	"teams",
	"upgrade",
	"user",
	"users",
] as const;

/**
 * Words that read as "the platform itself" or as a category of tenant, and
 * would mislead a buyer if one seller owned them. `official`/`verified` are
 * the impersonation pair; `store`/`shop`/`seller`/`vendor` are the generic
 * nouns a directory or a per-tenant subdomain scheme would want.
 */
const GENERIC = [
	"buyer",
	"buyers",
	"merchant",
	"merchants",
	"official",
	"retailer",
	"retailers",
	"seller",
	"sellers",
	"shop",
	"shops",
	"store",
	"stores",
	"vendor",
	"vendors",
	"verified",
] as const;

/**
 * Environment and channel names, and the literals a bug would produce.
 * `demo`/`staging`/`sandbox` are what an internal test store gets called;
 * a vendor holding them makes every future internal link ambiguous.
 * `null`/`undefined` are what a broken template renders — a store on either
 * would turn a bug into a redirect to someone's shop.
 */
const ENVIRONMENT = [
	"beta",
	"demo",
	"dev",
	"email",
	"example",
	"false",
	"mail",
	"meta",
	"null",
	"preview",
	"sample",
	"sandbox",
	"sms",
	"staging",
	"test",
	"testing",
	"true",
	"undefined",
	"whatsapp",
] as const;

/**
 * Brand spellings that the prefix rule below does not catch (it matches the
 * joined form only). Kept tiny on purpose — brand protection is the PREFIX.
 */
const BRAND = ["kedai-pal"] as const;

export const RESERVED_SLUG_GROUPS = {
	LIVE_ROUTES,
	PUBLIC_FOLDERS,
	PLATFORM,
	AUTH,
	MARKETING,
	PRODUCT,
	GENERIC,
	ENVIRONMENT,
	BRAND,
} as const;

/**
 * Every slug that STARTS with one of these is refused, not just the exact
 * word: `kedaipal-official`, `kedaipal-support`, `kedaipalhq` are all handles
 * an impersonator would pick, and a buyer reading `kedaipal.com/kedaipal-support`
 * has no way to tell it is not us.
 */
export const RESERVED_SLUG_PREFIXES: readonly string[] = ["kedaipal"];

/** The flat set — what the validators actually test against. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(
	Object.values(RESERVED_SLUG_GROUPS).flat(),
);

/**
 * The one question both validators ask. Takes an ALREADY-NORMALIZED slug
 * (trimmed, lowercased) — the callers normalize first, and a caller that
 * forgot would get a false "not reserved" for `App`, so this deliberately does
 * not re-normalize: the shape check that precedes it in both validators would
 * have rejected the uppercase form already.
 */
export function isReservedSlug(slug: string): boolean {
	if (RESERVED_SLUGS.has(slug)) return true;
	return RESERVED_SLUG_PREFIXES.some((prefix) => slug.startsWith(prefix));
}

/**
 * The rejection copy — one author, shown by the live form hint (client) and
 * thrown by the server validator, so the seller reads the same sentence
 * whichever side catches it. Names WHO reserved it: "reserved" alone reads as
 * "someone got here first", which sends the seller looking for a store that
 * does not exist. The field is labelled "URL slug" on every surface that has
 * one, so the noun matches.
 */
export const RESERVED_SLUG_MESSAGE =
	"Reserved by Kedaipal — pick another slug";
