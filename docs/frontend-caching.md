# Frontend caching — Convex + TanStack Query adapter

**ClickUp:** [`86eydh0dy`](https://app.clickup.com/t/86eydh0dy) · **Status:** dev

> **STANDING RULE — all new frontend reads follow this pattern.** Any new
> component/hook/route that reads Convex data uses
> `useQuery(convexQuery(api.x, args)).data`, never plain `useQuery` from
> `convex/react`. Its tests mock the adapter pair (see §Tests). Mutations,
> actions, imperative `useConvex`, and `usePaginatedQuery` stay on
> `convex/react`. Following this at write-time is what makes sure the caching
> migration never has to be repeated.

## Why

The dashboard felt slow "even navigating to a page I've loaded before." Root cause:
**there was no frontend query cache.** Every screen read through plain `useQuery` from
`convex/react`. Convex keeps a query's result in memory only while something is subscribed;
when a page unmounts on navigation the subscription tears down and the result is evicted.
Navigate back → `useQuery` returns `undefined` → skeleton → fresh WebSocket round-trip → render.
That re-navigation flash was the felt slowness.

The fix routes reads through the official Convex adapter **`@convex-dev/react-query`**, which
bridges Convex's live subscriptions into TanStack Query's cache. Data **and** the live
subscription survive unmount for `gcTime`, so navigating back to an already-visited page paints
**instantly from cache** and revalidates in the background — while keeping Convex's realtime
reactivity (the adapter keeps the subscription open; it is not a dumb TTL cache).

The cache was client-side only until z8r3fdue6f, which made the clients **per request on the
server** and lets storefront loaders seed the cache the HTML ships — see
[SSR: per-request clients](#ssr-per-request-clients).

## The wiring

`src/lib/convex.ts` exposes one factory, `getQueryClients()`, returning
`{ queryClient, convexQueryClient }`:

- `convexQueryClient` → `new ConvexQueryClient(new ConvexReactClient(url))`. The root providers
  mount **its** `convexClient`, so Clerk's auth token flows to adapter queries with no extra
  wiring.
- `queryClient` → a `QueryClient` whose default query options are `queryKeyHashFn`/`queryFn`
  from the bridge (the query key holds a non-serializable `FunctionReference`, so both must come
  from Convex) plus `gcTime: 10 min`, then `convexQueryClient.connect(queryClient)`.

**Server: fresh per call. Browser: one instance.** `getRouter()` (`src/router.tsx`) calls it once
per request on the Worker and once in the tab, passes the pair as **router context**
(`createRootRouteWithContext<RouterContext>()` in `__root.tsx`), and hands the `queryClient` to
`setupRouterSsrQueryIntegration`, which mounts the `<QueryClientProvider>` around the whole
router. Nothing imports a client from a module any more: components get the cache from the
provider, loaders from `context.queryClient`, the root providers from `Route.useRouteContext()`.

With `VITE_CONVEX_URL` unset the factory returns a bare `QueryClient` and
`convexQueryClient: null`; the root renders its `SetupNotice`, and `pnpm build` still works
without a deployment.

### `gcTime` = 10 minutes

`gcTime` is the knob: it's how long a query's data **and** live subscription survive after the
last component using it unmounts. `staleTime` is irrelevant — `convexQuery` sets it to `Infinity`
because Convex proactively pushes updates, so cached data is never stale. 10 min comfortably
covers tab-hopping within a work session (back-nav stays instant) while still reclaiming idle
subscriptions. Not `Infinity` — that would pin every one-off detail page's subscription
(each keyed by a distinct id) for the whole session.

## The read pattern

Every migrated read follows one uniform transform:

```ts
// before (convex/react):
const x = useQuery(api.foo, cond ? args : "skip");
// after (adapter):
const x = useQuery(convexQuery(api.foo, cond ? args : "skip")).data;
```

Rules that make it safe:

- **`"skip"` stays verbatim inside `convexQuery(...)`.** The adapter accepts the `"skip"`
  sentinel natively (sets `enabled:false`, throws if a skipped query ever runs). Do **not**
  hoist the condition into a separate `enabled:` option — that forces eager construction of args
  like `{ orderId: order._id }` and reintroduces null-deref bugs.
- **Unwrap into a named `.data` variable**, never store the whole `useQuery(...)` object. Loading
  semantics are preserved (`.data` is `undefined` while loading/skipped, `null` for a not-found
  result), so existing `=== undefined` (loading) vs `=== null` (not-found) checks keep working.
  Keeping the payload in a named var also preserves `typeof x`-derived types (e.g. the orders
  inbox's `useRef<NonNullable<typeof result>["counts"]>`).
- **Type-position** usages of the old hook (`ReturnType<typeof useQuery<typeof api.x>>`) become
  `FunctionReturnType<typeof api.x>` (+ `| undefined` where the loading state was part of the type).
- **An adapter read never throws — a read whose `undefined` blocks a screen must check
  `.error` too.** Plain `useQuery` from `convex/react` threw a failed query into the nearest
  error boundary; the adapter settles it as `status: "error"` and leaves `.data` as it was:
  `undefined` if nothing had loaded, the last good value if something had (ConvexQueryClient
  keeps it). So through `.data` alone a read that fails on first load is indistinguishable
  from a slow one, and a component whose `undefined` branch is a skeleton spins forever —
  exactly how every `/app` page hung for a seller who inherited an admin's act-as session
  (ClickUp `z8r3fdkqn6`). Recovery from a first-load failure is TanStack's retry, a remount or
  a reload, **not** the live subscription: the bridge only updates cache entries that already
  hold data, so a later good push is dropped.

`src/hooks/useDashboardRetailer.ts` unwraps `.data` **internally** and keeps returning
`Retailer | null | undefined`, so its ~8 route consumers are unchanged. The shell — the one
place a failed store read must become a screen, not a skeleton — reads the sibling
`useDashboardRetailerRead()`, which returns `{ retailer, error }`.

## What stays on `convex/react` (NOT migrated)

- **Mutations / actions** — `useMutation`, `useAction` are unaffected everywhere.
- **Imperative client** — `useConvex` (e.g. the orders/products CSV export paths).
- **Pagination** — `usePaginatedQuery` has no adapter wrapper, so the customer
  list's paginated read in `src/routes/app.customers.index.tsx` stays native.

> **Corrected 2026-08-24 (86eyqgxe1).** This bullet used to say that route
> "stays fully native", and that overstatement caused a real miss: the file also
> holds a **non-paginated** read (`api.customers.search`) which kept plain
> `useQuery` from `convex/react` for months, because the exemption written for
> its paginated neighbour was read as covering the whole file. **The exemption is
> per-read, never per-file.** A file may legitimately hold both — the customer
> list does. The gate test below now catches this class of drift instead of
> relying on anyone remembering the distinction.

## The client never loads a Convex function module

A file directly under `convex/` (`credits.ts`, `orders.ts`, `subscriptions.ts`, …)
registers queries and mutations when it is evaluated. Loaded in the browser, Convex logs
_"Convex functions should not be imported in the browser"_ once per function, and a future
Convex release turns that into a throw. Client code (`src/**`) may load only:

- `convex/_generated/*` — `api` is a proxy of function references, no function code;
- `convex/lib/*` — pure helpers shared by client and server, which must themselves never
  value-import a function module (that leaks it into every client file using the helper);
- anything via **`import type`** / **`export type`** — erased at compile time.

`verbatimModuleSyntax` is on, so `import { type X } from "…"` is **not** erased: it compiles to
`import {} from "…"` and still loads the module. Put `type` on the whole statement.

A constant or pure function the browser needs goes in `convex/lib/`, and the server imports it
from there too — never a re-export from the function module (z8r3fdv49m: `USAGE_PACE_DAYS` →
`lib/credits.ts`, `claimVoucherDiscount` → `lib/vouchers.ts`).

## Tests

- **`src/lib/convex-read-pattern.test.ts` — the gate that enforces the rule** (86eyqgxe1). Scans
  every `.ts`/`.tsx` under `src/` and fails on a `useQuery`/`useQueries` import from
  `convex/react`, naming the offending files and printing the correct pattern. Aliases
  (`useQuery as x`) and namespace imports are covered too, so the gate can't be sidestepped by
  accident. `usePaginatedQuery` + the mutation/action/client hooks are explicitly allowed, and an
  **unclassified** `convex/react` export fails the test rather than escaping it silently — a new
  read hook added upstream must be triaged, not ignored.
  It found a real violation on its first run (see the correction above), which is the argument
  for having it: the rule had been prose in `CLAUDE.md` for months, and prose doesn't fail a build.
  Precedent for the scan-the-source shape: `dependency-pins.test.ts`, `landing-funnel.test.ts`.
- **`src/lib/convex-client-imports.test.ts` — the gate for the function-module rule above**
  (z8r3fdv49m). Walks every `src/` file's runtime imports (static, side-effect, `export … from`,
  dynamic `import()`; `import type` / `export type` / `typeof import()` excluded) and follows them
  **transitively through `convex/lib`**, failing with the full chain
  (`src/x.tsx → convex/lib/a.ts → convex/subscriptions.ts`). The transitive walk is not
  belt-and-braces: on its first run it found the buyer claim page loading `subscriptions.ts`
  through `lib/voucherRedemption.ts`, which a direct-import sweep called clean. A self-test pins
  the matcher in both directions so a regex edit can't silently blind it.
- `src/lib/convex.test.ts` — the browser path: one shared pair, wired with the Convex
  `queryFn`/`queryKeyHashFn` defaults and `gcTime` of 10 min.
- `src/lib/convex.server.test.ts` — **the cross-request leak guard**: on the server path two
  calls (and two `getRouter()`s) never share a `QueryClient`, `ConvexQueryClient` or
  `ConvexReactClient`, and a store seeded in one request is absent from the next one's
  dehydrated payload. Mutation-tested: memoising the server branch turns all three red.
- `src/lib/storefront-ssr.test.ts` + `storefront-ssr.hydrate.test.tsx` — the SSR seed end to
  end; see the section below.
- Component tests that render a migrated read mock the two adapter modules (pass-through
  `convexQuery` + a `useQuery` returning `{ data }`) instead of `convex/react` — see
  `src/components/settings/billing-tab.test.tsx` and `src/components/order/book-delivery-card.test.tsx`
  for the pattern (name-keyed, synchronous, no `QueryClientProvider` needed).

## SSR: per-request clients

**ClickUp:** [`z8r3fdue6f`](https://app.clickup.com/t/z8r3fdue6f) — infrastructure half.

Until this ticket the `QueryClient` was a module singleton, safe only because nothing fetched
Convex during SSR (an empty server cache has nothing to leak). Storefront loaders now write into
the cache on the Worker and the SSR-query integration dehydrates it into the HTML, so a shared
cache would serve one buyer's store — or one seller's data — into another visitor's response.
**The per-request prerequisite that CLAUDE.md's "SSR is for buyer surfaces" rule names is now
met**; the leak test above is what keeps it met.

### What ships in the HTML

- **Only answered queries** (`dehydrate.shouldDehydrateQuery: status === "success"` in
  `lib/convex.ts`). The integration's own default is "everything", which would also ship a loader
  read that failed (hydrating the tab into an error) and every pending `useQuery` the server render
  touched. Consequence: streaming an un-awaited prefetch is off — loaders `await` their reads.
- **Today: the retailer.** The `/$slug`, `/$slug/p/*` and `/$slug/c/*` loaders read
  `retailers.getRetailerBySlug` through `ssrRetailerBySlug` (`src/lib/storefront-ssr.ts`) instead
  of the bare HTTP client, under the exact key the components subscribe with. The server render
  paints the store header, hours and category rail; the browser's first render reads the same key
  from the hydrated cache — no skeleton, no fetch — and the live subscription attaches on hydrate,
  so the store stays reactive exactly as before.
- **Not yet: the catalog.** `products.list`, `categories.listActivePublic`,
  `products.popularProducts`, `products.getPublicBySlug` and `categories.getPublicPage` are still
  client-fetched (the product/category loaders read the last two over the HTTP client for `head()`
  and the 404 decision only). Their shape may change under
  [`86eyjv002`](https://app.clickup.com/t/86eyjv002) (a card-shaped `listForGrid`) and their
  payload has to be measured first. **The seam:** each one is a single `ssrEnsure(queryClient,
  api.x, args)` call (`src/lib/storefront-ssr.ts`) in its loader after the retailer resolves —
  the cache seed, `ssrRead`'s soft-degrade and the time cap travel together, so a prefetch can't
  forget either guard.

### Failure and slowness

`ssrEnsure` wraps every seeded read in `ssrRead` **and** a 3 s cap (`SSR_READ_TIMEOUT_MS`). A
throw or a timeout returns `{ ok: false }`, the loader returns `null` exactly as before
(docs/buyer-page-resilience.md), nothing for that key ships, and the page renders the skeleton
the live query replaces — never a 500, never a first byte held hostage by a slow Convex. A
timed-out read keeps running; in the browser its answer still lands in the cache.

On a client-side navigation the loader runs in the tab against the one browser `QueryClient`, so
`ensureQueryData` answers from the warm cache or the live client — never a second fetch.

### Still out of scope

`/app` stays client-cached (Clerk's `<Show when="signed-in">` renders the fallback on the
server); a server-side Clerk token, bundle size and auth-handshake ordering stay with the
cold-start ticket [`86eydh4vd`](https://app.clickup.com/t/86eydh4vd).
