# Seller Insights (`/app/insights`)

A mobile-first analytics page that turns the order log into a picture of the
business: revenue **earned vs collected**, order count, AOV, best-selling
products, a revenue trend, and how buyers pay. Pro-and-above feature; Starter
sees a locked teaser. ClickUp `86ey5tfrz`.

## Why

The order inbox is a log, not a picture — a seller can't answer "what actually
sells?" or "how much did I make this month?" without scrolling WhatsApp or
exporting a CSV. Insights makes Kedaipal the **system of record for the
business**, not just the orders.

## Definitions (the whole model lives in `convex/lib/insights.ts`)

- A **revenue order** is one whose status is `confirmed → delivered`. `pending`
  and `cancelled` are excluded from **every** figure. So an order cancelled
  after payment drops out of both earned and collected (consistent with
  `decrementAggregatesForCancel` on customers).
- **Earned** = Σ `order.total` over revenue orders (order placed = revenue
  recognised). Revenue anchors on `createdAt`, **not** `fulfilmentDate` (that's
  ops, not revenue).
- **Collected** = Σ `order.total` over revenue orders whose `paymentStatus` is
  `"received"` (money actually in hand). "Delivered ≠ paid" is the whole reason
  for the split — F&B sellers routinely deliver on credit.
- **AOV** = earned ÷ revenue-order count.
- **Top products** group order-item lines by `productId + variantId`, using the
  item's **snapshot** `name`/`variantLabel` — never a live-product join — so a
  since-deleted product still appears in history (thumbnail falls back to a
  placeholder). Line revenue is `price × quantity`.
- **Payment donut** slices the *collected* figure by `paymentMethod`
  (`cash`/`duitnow`/`tng`/`bank_transfer`/`card`/`other`, plus `unspecified` for
  online self-claims with no recorded method). By construction Σ slices ===
  collected.
- **Trend** plots earned revenue per **MYT** day bucket (ranges ≤ 31 days) or
  week bucket (above). All bucketing is MYT (UTC+8, no DST) — a 00:30 MYT order
  lands in the right day.

Product line-revenue (Σ `price × quantity`) can differ slightly from `earned`
(Σ `order.total`) because the order total also carries delivery fees / order-level
adjustments — expected, they answer different questions. Mockup-quote changes
mutate `order.total` after creation; aggregates read current doc state, so this
is self-correcting.

## Backend — two queries, one page (`convex/analytics.ts`)

Cache discipline is the core design constraint: **every inbound order must not
re-run the heavy scan.** So the range is split in two, merged on the client:

- **`getInsightsRange({ retailerId, from, to, bucketing })`** — the heavy query
  over a **closed** range ending no later than *yesterday* (the client clamps
  `to`). Args are MYT-midnight epochs + a fixed bucketing enum, so they're stable
  and Convex caches the result; it only re-runs when a **historical** order in
  the window mutates. It contains **no `Date.now()`**, so a day rollover can't
  silently stale the cache.
- **`getTodayStats({ retailerId })`** — the small **live** query over just today
  (MYT). Re-runs on each of today's inbound orders — cheap (one day of docs). No
  trend of its own; the client places today's earned into the right bucket.

The client (`src/lib/insights-view.ts` `buildInsightsView`) merges the two onto
one contiguous trend grid, summing KPIs and merging product/payment breakdowns
via the shared pure helpers, so client and server never diverge.

### Scan

The scan is an **indexed `_creationTime` range read** on `by_retailer` — bounded
to the window, *not* a full-table `.take()`. `createdAt` (the revenue anchor) and
`_creationTime` track within milliseconds, so we read a slightly **widened**
`_creationTime` window (`CREATION_SKEW_BUFFER_MS`) then filter precisely on
`createdAt`, guaranteeing no boundary order is missed. Bounded by
`ANALYTICS_SCAN_CAP` (10k — well above the ICP's ~1–2k orders/year even for a
365-day range) with a `capped` flag surfaced in the UI (an amber banner) — never
silently truncate. No schema change, no rollup table; `@convex-dev/aggregate` is
the deliberate v2 scale escape hatch.

Top-product thumbnails are resolved (`ctx.storage.getUrl`) only for the
**union** of top-K-by-revenue and top-K-by-quantity, so the client's revenue⇄
quantity toggle always has images without over-fetching.

## Plan gate (Pro and above)

Insights rides the shared plan-feature seam (`86ey5tywf`/plan-gating work), **not**
a bespoke gate — `insights` is one key in `PlanFeatures`:

- `PLAN_FEATURES.insights` in `convex/lib/plans.ts` — `false` for Starter, `true`
  for Pro/Scale. `resolveAccess` folds it onto `AccessState.features` via
  `featuresForPlan`, so **comped** and the fail-safe (missing subscription → Pro
  features) grant access, and a **Pro trial** passes.
- **Enforced server-side**: both queries read `getAccess(ctx, retailerId)` and
  return `{ gated: true }` when `!access.features.insights` — the client teaser is
  UX, not the boundary. (We return a gated sentinel rather than throwing via
  `assertPlanFeature`, because the teaser needs a soft response, not an error.)
- **Admin act-as** gates on the **retailer's** own access (via
  `requireRetailerAccess` + `getAccess(ctx, retailerId)`), so an admin sees the
  seller's real entitlement regardless of the admin's own plan (they may be
  storeless). This is a plan-tier gate, distinct from the `past_due` soft-lock.
- The client mirror `hasFeature(sub, "insights")` (`src/lib/subscription.ts`)
  drives the teaser-vs-full split and the lock badge on the Home entry card.

## Frontend

- Route: `src/routes/app.insights.tsx` (Pro: full page; Starter/non-Pro: teaser).
- Components in `src/components/insights/`: `kpi-row`, `revenue-trend` (SVG-free
  bars), `top-products` (bar list + revenue/quantity toggle + thumbnails),
  `payment-donut` (hand-rolled SVG, **no chart library** — monochrome mint by
  opacity, on-brand), `date-range-control` (preset chips + custom range) and
  `locked-teaser`.
- New primitives: `src/components/ui/calendar.tsx` (themed `react-day-picker`,
  range mode) and `src/components/ui/sheet.tsx` (mobile bottom-sheet on radix
  Dialog).
- Date presets (Today / 7d / 30d / This month / 90d) + a custom range via the
  Calendar in a bottom sheet, capped at 365 days with future dates disabled.
- Discoverability: a primary **Insights** tab in the mobile bottom nav (Pro chip
  when locked — part of the 5-tab + More restructure, see
  [`docs/app-redesign.md`](./app-redesign.md#mobile-bottom-nav--5-tabs--more)),
  an **Insights** entry card on `/app` home (lock-badged for Starter) + a
  desktop sidebar link.

### Empty states

- **New seller, no sales** (`!retailer.activatedAt`): points at sharing the store
  link to land the first order.
- **Zero orders in the selected range**: prompts a wider range.

## Edge cases handled

- Counter-checkout orders (default `fulfilmentDate` today, often instant-
  delivered) flow through identically — everything anchors on `createdAt`.
- Range spanning today splits closed→`getInsightsRange`, today→`getTodayStats`;
  the open day never enters the heavy scan.
- Downgrade Pro → Starter flips a bookmarked `/app/insights` to the teaser (both
  the client mirror and the server gate resolve the current plan).

## Tests

- `convex/lib/insights.test.ts` — the reduce (revenue split, cancelled-after-
  paid, pending-but-paid, product grouping, deleted-product snapshot, MYT 00:30
  boundary, day/week bucketing, donut = collected invariant, merge helpers).
- `src/lib/insights-view.test.ts` — presets + range/today merge onto the grid.
- Gate: `PLAN_FEATURES.insights` (`convex/lib/plans.test.ts` +
  `convex/subscriptions.test.ts`) + `hasFeature(sub, "insights")`
  (`src/lib/subscription.test.ts`).

## Not in v1

Rollup/aggregate table (deferred to v2 `86ey5tfvh` at scale), Scale "reseller
performance reports" (network-level, unbuilt — renamed on the pricing card via
`86ey5tkd1`), PostHog `/app/insights` funnel wiring, and the order-cap usage
meter (`86ey31558`) that will later live on this page.
