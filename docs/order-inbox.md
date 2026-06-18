# Order Inbox (Phase 1)

**Status:** shipped (Phase 1). ClickUp [Tier 1] Order Search & Inbox View
(`86expm4xx`). Turns `/app/orders` from a flat list into a working inbox so no
order sits forgotten. **Phase 2** (bulk multi-select + `bulkUpdateStatus`) is a
separate follow-up.

## Decisions (locked with the CTO)

- **Buckets are fulfilment-based**, not a mix of axes: **All / New (pending) /
  In progress (confirmed·packed·shipped) / Completed (delivered) / Cancelled**.
- **Payment status is an orthogonal filter + badge, NOT a bucket** — an order can
  be "confirmed" *and* "unpaid", so pulling it into its own bucket would yank it
  out of In-progress while still being worked. Payment is a multi-select filter.
- **Phase it:** this PR is the inbox (buckets, search, filters, time-in-status,
  URL state, mobile bottom-sheet). Bulk actions land in Phase 2.

## Data model

- `orders.statusChangedAt: v.optional(v.number())` — when the canonical `status`
  last changed. Stamped on `create` (= createdAt) and on **every** transition
  (`updateStatus` always; `advanceToStage` only when the canonical status changes
  — a within-anchor stage move keeps the same bucket). Optional → pre-inbox orders
  fall back to `updatedAt` → `createdAt` at read time, so **no backfill**.

## Backend — `searchOrders` (one query, in-memory)

`convex/orders.ts` → `searchOrders({ retailerId, bucket, paymentStatuses?,
dateFrom?, dateTo?, searchText?, limit? })` (owner-only). It scans the retailer's
orders once (`by_retailer`, newest-first, capped at `MAX_INBOX_SCAN = 1000`) and
returns **the filtered page plus the per-bucket counts in a single subscription**:
`{ orders, total, counts, capped }`.

- **Counts** are over the full set, independent of the active filters/search, so
  the chips always show true totals.
- **Filtering** (bucket statuses, payment — `undefined` reads as `unpaid` —, date
  on `createdAt`, and a cross-cutting **`mockupPending`** toggle = mockupStatus
  pending/changes_requested) and **search** (order #, customer name partial/CI,
  phone by trailing digits ≥4, **and item name/variant** — cheap since the orders
  are already in memory) are in-memory. `counts` also carries `mockupPending` (the
  count behind the "Needs mockup" chip).
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
  `validateSearch`: `bucket`, `q`, `pay[]`, `from`, `to`; all optional, defaults
  kept out of the URL). Debounced search drives the query and mirrors into `?q`.
  Bucket chips show counts (New highlighted). "Load more" raises an in-query
  `limit`. Per-bucket empty states ("No new orders — you're all caught up 🎉").
- **`order-time-badge.tsx`** — "time in status" pill (e.g. "2h"). Only **pending**
  escalates: amber >4h, red >24h (the missed-order risk window); other statuses
  are neutral.
- **`order-filters.tsx`** — one coherent filter set: a **"Needs mockup"** toggle
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

## Phase 2 (next)

Bulk multi-select + `bulkUpdateStatus(orderIds[], newStatus)` reusing the existing
`updateStatus` per-order path (so the mockup gate + stock-restore can't be
bypassed), with only sensible transitions offered for the selection.
