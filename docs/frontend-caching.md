# Frontend caching — Convex + TanStack Query adapter

**ClickUp:** [`86eydh0dy`](https://app.clickup.com/t/86eydh0dy) · **Status:** dev

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

Scope is deliberately **client-side only** — no SSR data fetching (see Out of scope).

## The wiring

`src/lib/convex.ts` exposes two lazy singletons that wrap the **same** `getConvexClient()`
`ConvexReactClient` the React providers use (so Clerk's auth token flows to adapter queries
with no extra wiring):

- `getConvexQueryClient()` → `new ConvexQueryClient(getConvexClient())`
- `getQueryClient()` → a `QueryClient` whose default query options are
  `queryKeyHashFn`/`queryFn` from the bridge (the query key holds a non-serializable
  `FunctionReference`, so both must come from Convex) plus `gcTime: 10 min`, then
  `convexQueryClient.connect(queryClient)`.

`src/routes/__root.tsx` wraps the tree in `<QueryClientProvider>` (outermost), constructed only
**past** the `SetupNotice` env guard so the missing-`VITE_CONVEX_URL` build path is preserved.

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

`src/hooks/useDashboardRetailer.ts` unwraps `.data` **internally** and keeps returning
`Retailer | null | undefined`, so its ~8 route consumers are unchanged.

## What stays on `convex/react` (NOT migrated)

- **Mutations / actions** — `useMutation`, `useAction` are unaffected everywhere.
- **Imperative client** — `useConvex` (e.g. the orders/products CSV export paths).
- **Pagination** — `usePaginatedQuery` has no adapter wrapper, so
  `src/routes/app.customers.index.tsx` (the customer list) stays fully native.

## Tests

- `src/lib/convex.test.ts` — smoke test asserting `getQueryClient()` builds a singleton with the
  Convex `queryFn`/`queryKeyHashFn` defaults and `gcTime` of 10 min.
- Component tests that render a migrated read mock the two adapter modules (pass-through
  `convexQuery` + a `useQuery` returning `{ data }`) instead of `convex/react` — see
  `src/components/settings/billing-tab.test.tsx` and `src/components/order/book-delivery-card.test.tsx`
  for the pattern (name-keyed, synchronous, no `QueryClientProvider` needed).

## Out of scope → separate "cold-start / SSR first-paint" ticket

This change does **not** enable SSR data fetching. Today `/app` renders client-only (Clerk's
`<Show when="signed-in">` returns the fallback on the server) and public-route loaders only
populate `<head>` — so no route fetches Convex during SSR, which is why the module-singleton
`QueryClient` is safe here (empty server cache → nothing to leak). **Before** any SSR data
fetching is turned on (`setupRouterSsrQueryIntegration` + route loaders + a server-side Clerk
token), the `QueryClient` must move to per-request creation in router context. That work — plus
bundle-size analysis and the auth-handshake ordering on first paint — is the deferred cold-start
ticket; the singleton posture here is the one thing it must change first.
