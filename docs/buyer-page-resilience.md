# Buyer-page resilience — SSR soft-degrade, error boundary, Clerk-free buyer surfaces

**ClickUp:** [`86eyheqzv`](https://app.clickup.com/t/86eyheqzv) · **Shipped:** 2026-08-05 (dev)

## ROOT CAUSE (confirmed via buyer screenshot, 2026-08-05)

The WhatsApp confirmation template's **URL button composes to
`/track/{{1}}<token>`** — the registered button URL carries `{{1}}` as
literal text instead of a recognized dynamic variable, so WhatsApp *appends*
the token after the braces rather than substituting it. Tapping that URL hit
an infinite redirect: TanStack's URL canonicalization answers
`/track/%7B%7B1%7D%7D…` with a 307 whose `Location` has the braces
**decoded**, the browser re-encodes them to request it, forever —
`net::ERR_TOO_MANY_REDIRECTS`, before any page code (loader, boundary, React)
ever runs. Reproduced with curl against prod (6/6 redirects, stable loop).

Why it looked new: before the confirmation push (86eyf1rck) the confirm was a
plain text message whose URL **our code** built — always clean. The button
only became the link buyers tap when that shipped. Other messages (status
updates) still embed clean plain-text URLs, which is why some taps worked and
some didn't — "intermittent" was really *which link the buyer tapped*.

Two-part fix:

1. **Server-side rescue (this repo — makes every already-sent button work,
   since those links are frozen in buyers' chats):** custom Worker entry
   `src/server-entry.ts` (wired via wrangler `main`) 301s a polluted
   path to the clean URL *before* the router sees it — handles
   percent-encoded and literal brace forms, preserves the query
   string, logs a `console.warn` per rescue so the rate is visible in the
   Worker's log stream. Pure logic + tests in `convex/lib/trackingToken.ts`;
   `orderByToken` (the single `by_tracking_token` reader) normalizes too, as
   defence in depth. Tokens are crypto-random alphanumerics — braces can
   never legitimately appear, so stripping is unambiguous.

   **The rescue is route-agnostic** (`rescuePlaceholderUrl`, generalised in
   PR #178 review, finding 2). It shipped as a `/track/`-only fix because
   that was the button that broke, but the failure is a property of *any*
   template whose URL button is registered with hand-typed braces — and the
   seller order alerts (`86eyhw9zy`) added the first URL buttons on a
   different path, `https://kedaipal.com/app/orders/{{1}}`. A `/track/`-only
   rescue would have let the identical mis-registration recur as a fresh
   incident, this time 307-looping the **seller** out of their own order.
   So it now strips a leading `{{n}}` run from *any* path segment; a segment
   that is a placeholder and nothing else (`/app/orders/{{1}}` — the
   parameter never arrived) is left alone to 404, since there is no
   destination to guess. No legitimate Kedaipal path can contain braces
   (slugs, shortIds and tracking tokens are all generated from
   alphanumerics), so this is safe everywhere.

   **Every new URL-button template must still be registered via Meta's Add
   variable control** — the rescue is a safety net for links already sent,
   not a licence to hand-type `{{1}}`. A polluted link costs a 301 on every
   tap and only works while the Worker entry survives.
2. **Meta-side correction (seller/ops):** re-register the template's button
   URL so the variable is recognized — in WhatsApp Manager the URL field must
   be built with the **Add variable** control (base
   `https://kedaipal.com/track/`, UI appends `{{1}}`), not hand-typed braces.
   Until then, new messages still carry polluted links; the rescue absorbs
   them.

## The incident

Buyers tapping the tracking link / confirmation-template URL button in their
WhatsApp message intermittently hit an error page instead of their order —
reported as "too many requests" / "too many redirects", prod only, starting
around the confirmation-push release (86eyf1rck). Debugging findings:

- **Any SSR loader throw served buyers TanStack's built-in fallback** — an
  unstyled "Something went wrong!" with a Show-Error button that dumps the raw
  error string. No route had an `errorComponent`. Proven live: prod
  `/sitemap.xml` 500'd with exactly that page server-rendered.
- The `/track/<token>` loader was **fatally coupled to one Convex HTTP query**
  even though the page's real data is the client's reactive `useQuery` — the
  loader only feeds `<head>` meta on a `noindex` page. Any transient upstream
  failure (Convex hiccup, edge 429, Worker→Convex fetch timeout) = raw error
  page for the buyer.
- **Every buyer page booted Clerk**: 8 requests to `clerk.kedaipal.com` per
  view, including two per-IP rate-limited FAPI calls (`/v1/client`,
  `/v1/environment`) — for shoppers who can never sign in. MY mobile carriers
  CGNAT many subscribers behind few IPs, so per-IP limits are a plausible
  intermittent 429 source.
- **Desktop-only preload storm**: `defaultPreloadStaleTime: 0` +
  `preloadDelay` 0 + three `<Link>`s per product card meant every hover
  re-ran the product-page loader (2 sequential Convex queries) with zero
  dedupe. Touch never preloads at delay 0, so mobile was unaffected.
- Redirect loops were ruled out server-side (clean/WA-webview-UA/cookie-jar
  probes never looped; slug renames resolve active-slug-first so an A↔B loop
  is unconstructible). Prod Convex showed zero function errors — consistent
  with failures happening at the SSR/edge layer, which function logs never see.

## What shipped

### 1. `ssrRead` — SSR loaders soft-degrade on transient failure

`src/lib/ssr-read.ts`. Every buyer-route loader (storefront home, category,
product, checkout, track) wraps its Convex reads:

- **Query threw** (upstream unreachable) → loader returns `null` → `head()`
  falls back to generic meta (`if (!loaderData) return {}` was already the
  guard shape) → the page shell renders and the client's reactive `useQuery`
  paints the real data. The buyer never sees an error page for a blip.
- **Query answered `null`** (bad token / unknown slug / hidden product) →
  `notFound()` exactly as before. The two cases are deliberately distinct
  result shapes (`{ok:false}` vs `{ok:true, value:null}`) — collapsing them
  would 404 a valid order on a blip, worse than the error page it replaces.
- Slug-rename `redirect()` throws are untouched (they only happen on an
  `ok` read).

SEO trade-off, accepted: a crawler hitting a transient blip gets a meta-less
200 instead of a 5xx. Rare, and crawlers refetch; humans are the priority on
these routes.

### 2. Branded error boundary with retry

`src/components/route-error.tsx`, wired as `defaultErrorComponent` in
`router.tsx` — every route without its own `errorComponent` now falls back to
a calm, mobile-first card: "Something went wrong / usually temporary", one
**Try again** CTA that `reset()`s the boundary then `router.invalidate()`s to
re-run the failed loaders (that order is load-bearing). Raw error text renders
only in dev builds. This is the backstop for everything `ssrRead` doesn't
cover (render errors, non-buyer routes).

### 3. Buyer surfaces are Clerk-free

`src/lib/buyer-routes.ts` (`BUYER_ROUTE_IDS`) + a provider branch in
`__root.tsx`: when the matched route ids include a buyer surface, the tree
renders under plain `ConvexProvider`; everywhere else keeps
`ClerkProvider` + `ConvexProviderWithClerk`. Matched **route ids** — not raw
pathnames — decide the branch, so router precedence keeps `/pricing` vs
`/$slug` unambiguous.

- Verified: storefront + track page make **zero** requests to any external
  host and never define `window.Clerk`; landing still boots Clerk normally.
- Crossing buyer ⇄ Clerk surfaces remounts the provider subtree — rare
  (storefront → landing), and a clean remount is what a provider swap needs.
- **Adding a buyer surface? Add its route id to `BUYER_ROUTE_IDS`** or it
  boots Clerk. `buyer-routes.test.ts` pins each listed id against
  `routeTree.gen.ts` so a route rename breaks loudly in CI.

### 4. Preload staletime back to sane

`defaultPreloadStaleTime: 0` → `30_000` in `router.tsx` (the TanStack
default the 0 had overridden since the initial commit). A hover's preload is
now reused by the click that follows it instead of re-firing loaders on every
re-hover.

### 5. `/sitemap.xml` actually serves XML

The route `throw`ed a `Response` from its loader — the current TanStack
version treats that as a route *error*, so prod served a 500 error page and
no crawler ever saw the storefront/product URLs. Rewritten as the sanctioned
`server: { handlers: { GET } }` returning the Response directly; the XML
shape lives in pure `src/lib/sitemap.ts` with tests.

## Ops follow-ups (not code — tracked on the ticket)

- `www.kedaipal.com` is NXDOMAIN — add DNS + redirect to apex in Cloudflare.
- No `CLOUDFLARE_API_TOKEN` on the dev machine, so `wrangler tail` (live SSR
  error stream — where these failures actually surface) is unavailable
  non-interactively. Worth setting up; Convex function logs cannot see
  SSR-layer failures.
- The confirmation template's **registered button base URL** (WhatsApp
  Manager) must be `https://kedaipal.com/track/{{1}}` — the send site passes
  the raw tracking token as the sole parameter (`convex/whatsapp.ts`,
  `notifyStorefrontOrderCreated`). A wrong registered base breaks every
  buyer's button in a way no code change can fix.

## Tests

`src/lib/ssr-read.test.ts` (threw vs answered-null contract),
`src/lib/sitemap.test.ts` (XML shape, lastmod truncation, priorities),
`src/lib/buyer-routes.test.ts` (ids exist in the generated tree; Clerk
surfaces never classified as buyer), `src/components/route-error.test.tsx`
(copy + reset-before-invalidate order).
