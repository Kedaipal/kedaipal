# Order Inbox

**Status:** shipped (Phase 1 + Phase 2). ClickUp [Tier 1] Order Search & Inbox
View (`86expm4xx`). Turns `/app/orders` from a flat list into a working inbox so
no order sits forgotten. Phase 1 = buckets/search/filters/time-badge/URL state;
**Phase 2 = bulk multi-select + `bulkUpdateStatus`** (now done).

**Plan gating (Jul 2026):** the inbox is a **Pro+** feature per the pricing
table. Starter keeps the plain order list (default fulfilment-date sort),
order detail and single status transitions — the all-tier "Order pipeline" —
while buckets, search, filters, due-chips, bulk actions and CSV export are
rejected server-side (`assertPlanFeature` in `searchOrders`/`bulkUpdateStatus`/
`exportOrders`) and replaced in the UI by an upgrade tease. Admin act-as sees
the full inbox. See [`manual-subscription.md`](./manual-subscription.md)
§Plan-feature gating.

## Decisions (locked with the CTO)

- **Buckets are fulfilment-based**, not a mix of axes: **All / New (pending) /
  In progress (confirmed·packed·shipped) / Completed (delivered) / Cancelled**.
- **Payment status is an orthogonal filter + badge, NOT a bucket** — an order can
  be "confirmed" *and* "unpaid", so pulling it into its own bucket would yank it
  out of In-progress while still being worked. Payment is a multi-select filter.
- **Phase it:** Phase 1 was the inbox; Phase 2 added bulk actions.

## ⚠️ Two deliberate deviations from the ticket (`86expm4xx`)

The implementation differs from two acceptance criteria **on purpose** — recorded
here so the ticket and code don't read as out of sync:

1. **"Awaiting Payment" is a *filter*, not a bucket.** The ticket lists it as an
   inbox section alongside the fulfilment buckets, but payment status is
   **orthogonal** to fulfilment (a confirmed order can be unpaid). Making it a
   bucket would pull an in-progress order *out* of "In progress" while it's still
   being worked. Instead it's the **Payment** multi-select filter (Unpaid /
   Claimed / Paid) — select Unpaid+Claimed to get the "awaiting payment" view.
2. **"Filter by status (multi-select)" is implemented as single-select buckets.**
   The buckets *are* status groups (In progress = confirmed+packed+shipped), which
   covers the user-story intent ("see new separated from completed"). Arbitrary
   multi-status selection (e.g. pending **and** delivered together) is not
   supported — buckets were the cleaner UX. If true multi-select is ever wanted,
   it's a small add to `searchOrders` (`statuses[]`) + the chip UI.

Everything else maps directly; bulk actions (the remaining AC) shipped in Phase 2.

## Data model

- `orders.statusChangedAt: v.optional(v.number())` — when the canonical `status`
  last changed. Stamped on `create` (= createdAt) and on **every** transition
  (`updateStatus` always; `advanceToStage` only when the canonical status changes
  — a within-anchor stage move keeps the same bucket). Optional → pre-inbox orders
  fall back to `updatedAt` → `createdAt` at read time, so **no backfill**.

## Backend — `searchOrders` (one query, in-memory)

`convex/orders.ts` → `searchOrders({ retailerId, bucket, paymentStatuses?,
paymentMethods?, methodUnspecified?, dateFrom?, dateTo?, fulfilmentWindow?,
mockupPending?, source?, searchText?, limit? })` (owner-only). It scans the retailer's
orders once (`by_retailer`, newest-first, capped at `MAX_INBOX_SCAN = 1000`) and
returns **the filtered page plus the per-bucket counts in a single subscription**:
`{ orders, total, counts, capped }`.

- **Default sort = fulfilment date ascending** (soonest-first), so the seller
  works the most urgent orders top-down. Orders without a `fulfilmentDate`
  (legacy / any path that didn't capture one) sink to the bottom, then fall back
  to newest-created. The scan is newest-first; the result is re-sorted in-memory.
  See [`fulfilment-date.md`](./fulfilment-date.md).
- **Counts** are over the full set, independent of the active filters/search, so
  the chips always show true totals.
- **Filtering** (bucket statuses, payment — `undefined` reads as `unpaid` —,
  payment method, date on `createdAt`, a **`fulfilmentWindow`** chip — today /
  tomorrow / this-week on the order's `fulfilmentDate` —, a **`source`** chip —
  online (`storefront`) vs walk-in (`counter`), `undefined` reads as
  `storefront` — and a cross-cutting **`mockupPending`** toggle = mockupStatus
  pending/changes_requested) and
  **search** (order #, customer name partial/CI, phone by trailing digits ≥4,
  **and item name/variant** — cheap since the orders are already in memory) are
  in-memory. `counts` also carries `mockupPending` (the count behind the "Needs
  mockup" chip).
- **Why in-memory, not indexed pagination + Aggregate:** at the Phase-1 target
  (≤500 orders/retailer) a single bounded scan is simpler and correct, and it
  unifies browse + search + counts. `capped` flags when a retailer exceeds the
  scan ceiling (the cue to move to indexed pagination + the Aggregate component).
- "In progress" spans 3 statuses (can't single-index), and the payment `unpaid`
  filter must also match `undefined` — both fall out naturally from the in-memory
  predicate, avoiding `.filter()`/cursor + `eq(undefined)` complexity.

Shared pure logic lives in **`convex/lib/orderBuckets.ts`** (no Convex imports —
imported by both the query and the UI, same as `isMockupGateClosed`):
`BUCKET_STATUSES`, `statusToBucket`, `INBOX_BUCKETS`, and the time-in-status
helpers (`statusAgeMs`, `formatStatusAge`, `statusAgeSeverity`).

## Frontend

- **`src/routes/app.orders.index.tsx`** — URL is the source of truth (TanStack
  `validateSearch`: `bucket`, `q`, `pay[]`, `method[]`, `munspec`, `from`, `to`,
  `mockup`, `fwin`; all optional, defaults kept out of the URL). Debounced search
  drives the query and mirrors into `?q`. Bucket chips show counts (New
  highlighted). A **"Due" chip row** (Today / Tomorrow / This week, driving
  `fwin`) sits inline above the advanced filters — fulfilment urgency is a
  primary axis for F&B sellers, not a buried filter. Each order row carries a
  **fulfilment-date badge** (`fulfilment-date-badge.tsx`) that leads with urgency
  (Overdue / Today / Tomorrow coloured) — **suppressed to neutral on terminal
  orders and hidden entirely on counter orders** ([`86ey8r734`](https://app.clickup.com/t/86ey8r734),
  see [`fulfilment-date.md`](./fulfilment-date.md)). Each card's meta line shows
  the **absolute placed-at datetime + relative age** (`formatOrderTimestamp` +
  `formatStatusAge`, e.g. "12 Jul, 3:45 PM (3h ago)") so the seller reads both
  "when" and "how long ago" without opening the detail page.
  Each card shows **what was ordered** ([`86ey9uny8`](https://app.clickup.com/t/86ey9uny8),
  Sue Chef Kitchen feedback — an order list that doesn't show the products fails
  the core job): a tinted block of item rows (`qty× product · variant`, from the
  frozen order-item snapshots — no extra query) with a per-line amount from `sm:`
  up (phones keep the grouped list but drop the price column; the bold total
  stays the money number there). Rows are capped via
  `src/lib/order-card-items.ts` (`summarizeOrderCardItems`): 2 item lines, the
  rest folded into one "+N more items" row carrying the folded lines' aggregated
  amount — folding only kicks in past cap+1, so a 3-item order shows all 3
  instead of a pointless "+1 more". Product names on cards pair with the search
  predicate already matching item name/variant, so seeing "Pavlova" and typing
  it both work.
  "Load more" raises an in-query `limit`. Per-bucket empty states ("No new orders
  — you're all caught up 🎉").
- **`order-time-badge.tsx`** — "time in status" pill (e.g. "2h"). Only **pending**
  escalates: amber >4h, red >24h (the missed-order risk window); other statuses
  are neutral.
- **`order-filters.tsx`** — one coherent filter set: an **"Order type"** pair
  (Online / Counter → `source`), a **"Needs mockup"** toggle
  (amber, with count; cross-cutting — ANDs with the bucket; shown only when ≥1
  order needs one or it's on), **payment** multi-select, and a **date range**
  (quick presets Today / 7 days / 30 days / This month + custom inputs). Inline on
  desktop; collapses to a **bottom-sheet** on phones with an active-count badge.
  The mockup toggle + each payment pick increment the count; a date range counts
  as **one**. (The amber "Mockup pending" pill on each row still flags individual
  orders, so visibility isn't lost by folding mockup into the sheet.)

## Tests

- `convex/lib/orderBuckets.test.ts` — bucket mapping + time-in-status (fallback
  chain, format, pending-only escalation).
- `convex/orders.test.ts` → "orders — inbox search" — buckets + counts + text
  search (id/name/phone), payment filter treating `undefined` as unpaid, owner-only.
- `order-time-badge.test.tsx`, `order-filters.test.tsx` — severity tone + filter
  toggling / active count.
- `src/lib/order-card-items.test.ts` — card item summary: line totals, cap,
  fold-only-past-cap+1, folded amount reconstructs the subtotal.
- `convex/orders.test.ts` → "orders — bulk status" — applies to all eligible +
  skips no-ops, skips mockup-gated when bulking to packed, bulk-cancel restores
  stock, foreign-order batch is rejected (owner-only).
- `order-bulk-bar.test.tsx` — count + clear + the "Mark as" action menu.

## Phase 2 — bulk actions (shipped)

- **`convex/orders.ts`**: the core of `updateStatus` was extracted into a shared
  `applyStatusTransition(ctx, order, status)` helper (stock-restore-on-cancel +
  aggregates, `statusChangedAt`, `orderEvent`, WhatsApp notify). New
  **`bulkUpdateStatus(orderIds[], status)`** calls that same helper per order, so
  the **mockup gate + stock-restore can't be bypassed**. Per-order it **skips**
  (rather than failing the batch) when the order is already in that status or is
  mockup-gated for `packed`, and returns `{ updated, skipped }`. Owner-checked for
  every order; capped at 100/batch.
- **UI** (`app.orders.index.tsx` + `order-bulk-bar.tsx`): every row has an
  **always-visible checkbox** as its own click target — the card itself still
  links to the order (two distinct CTAs; no "select mode" toggle to fight). Ticking
  one reveals a **Select all / Done** toolbar + a sticky bottom **bulk bar** ("N
  selected" + a **"Mark as…"** menu of resolved status labels) → `bulkUpdateStatus`
  → toast summary ("Updated 8 · skipped 2"). **Destructive actions (Cancel) are
  gated behind a confirm dialog** ("Cancel N orders? Customers will be notified…")
  since bulk-cancel restores stock, reverses aggregates, and sends an unrecallable
  WhatsApp cancellation to up to 100 customers; non-destructive actions apply
  immediately. Selection clears
  when the view (bucket/search/filters) changes. The bar is `fixed` and sits over
  the mobile bottom-nav while selection is active.
- **Bucket counts are retained across refetches** (`countsRef`) so the chips +
  "Needs mockup" toggle don't flicker out each time a filter changes (the query
  reloads). The desktop filter row lays out horizontally (compact toolbar);
  the mobile bottom-sheet keeps the stacked layout.
