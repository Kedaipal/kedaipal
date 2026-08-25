# Data retention — append-only log tables

ClickUp: [`86eyetzt7`](https://app.clickup.com/t/86eyetzt7). Several tables are
append-only by design (audit trails, event histories, suppression lists) and,
before this ticket, four of them grew forever with nothing ever deleting a row.
This doc is the policy table: every append-only table, its retention window (or
its keep-forever justification), and how the purges work.

**Single source of truth for every window: [`convex/lib/retention.ts`](../convex/lib/retention.ts).**
The numbers below cite it; change a window there, never here first.

## The policy table

| Table | Window | Why |
| --- | --- | --- |
| `outboundMessageLog` | **90 days**, rolled up first | Fastest-growing table (one row per outbound WhatsApp attempt) and also the WhatsApp **cost ledger** (Meta bills per-send from Oct 2026). Raw rows cover incident forensics + bill disputes; before deletion each row is folded into `messageLogRollups`, so aggregate cost/volume accounting survives forever. |
| `wabaHealth` | **90 days**, newest row always kept | History is for trend-eyeballing only. The newest row is `canSend`'s live quality state and Meta health webhooks can be months apart — purging it would silently **fail the gateway open to HIGH**, so it is retained regardless of age. |
| `adminAuditLog` | **24 months** (stated decision) | Compliance-friendly window: long enough to answer "who at Kedaipal touched my store?" for any plausible dispute or PDPA access request, bounded so the trail doesn't outlive its usefulness. |
| `orderEvents` | **No purge (deferred)** | An order's event timeline is part of the order record — purging events on a different clock than their orders would leave half-erased histories. Their lifetime is tied to **order retention**, which is ticket `86eydwct5` (PDPA Q2). Hard-delete already cascades them (`deleteOrderCascade`), so the table only grows with live orders. |
| `optOuts` | **Never purged** | An opt-out row is the buyer's **standing legal instruction** ("do not message me") across the whole shared WABA number — deleting it would re-consent the buyer on our behalf. It grows with distinct humans who said STOP, not with traffic. The consequence: reads must stay indexed + bounded (see the `adminListVendors` fix below), never "small enough to `.collect()`". |

Already-covered elsewhere (pre-existing crons in `convex/crons.ts`):
`slugHistory` (purge expired redirects) and `counterCheckoutSessions` (dead
sessions ~30 days after death — they hold buyer phone numbers).

> **Order/customer retention is NOT decided yet.** The numbers are pending a
> business decision on `86eydwct5`; the proposal on `86ey5m3hx` (proofs/images
> 6 months post-completion, orders anonymised at 24 months) is a proposal, not
> policy. Nothing in this ticket touches order or customer rows.

## The rollup design (`messageLogRollups`)

The cost ledger must survive the purge, so `purgeExpiredOutboundLog`
(`convex/wabaProtection.ts`) never plain-deletes:

- **Bucket key:** `retailerId × month × category × status`, where `month` is
  the **MYT calendar month** (`"YYYY-MM"`, `mytMonthKey` in
  `lib/retention.ts` — the `usagePeriod.ts` convention: UTC+8, no DST, fixed
  offset). `retailerId` is optional, mirroring the log (system replies to an
  unknown inbound sender carry none).
- **Upsert-increment:** each purge page is aggregated in memory, then each
  touched bucket is incremented (or inserted) via the
  `by_retailer_month_category_status` index — one write per bucket, not per row.
- **Atomic with the delete:** rollup writes and row deletes share one
  transaction per page. A crash can neither double-count a row (it's deleted
  the moment it's counted) nor lose one (an uncounted row is still there for
  the next run) — which is also why re-running the purge is idempotent.
- **Bounded by construction:** retailers × months × 4 categories × 8 statuses.
- **What the rollup deliberately drops:** `templateName` and `toWaPhone`.
  Per-template and per-recipient detail is a 90-day view on the raw log; the
  monthly category ledger is the permanent one. If per-template cost history
  ever matters past 90 days (Broadcast-era), add `templateName` to the bucket
  key **before** the rows expire.

`adminListVendors`' 30-day at-a-glance stats read only rows well inside the
90-day window (via `by_retailer_sent`), so they are unaffected by the purge —
by construction, not by luck.

## The purge crons

Three daily jobs in [`convex/crons.ts`](../convex/crons.ts) (04:05 / 04:15 /
04:25 UTC, beside the existing housekeeping block):

| Cron | Mutation |
| --- | --- |
| `purge expired outbound message log` | `wabaProtection.purgeExpiredOutboundLog` |
| `purge expired waba health history` | `wabaProtection.purgeExpiredWabaHealth` |
| `purge expired admin audit log` | `admin.purgeExpiredAdminAudit` |

All three are paginated, self-chaining `internalMutation`s — the
`counterCheckout.purgeStaleSessions` / `migrations.ts` house pattern: delete up
to `LOG_PURGE_PAGE_SIZE` (100) rows per transaction, then
`ctx.scheduler.runAfter(0, …)` to continue, so a first run against a years-old
backlog stays inside Convex transaction limits. Every read is a bounded index
range on the table's time field — `outboundMessageLog.by_sent`,
`wabaHealth.by_observed`, `adminAuditLog.by_ts` (the first and last are new
indexes; indexes are deploy-safe).

## The `optOuts` scan fix (`adminListVendors`)

The admin vendor list used to `.collect()` the entire global `optOuts` table to
count 30-day opt-outs per vendor — correct while the table was tiny, unbounded
forever after (the table is never purged, see above). It now does an **indexed,
bounded** read: `by_created` (new index) range-scoped to the 30-day window,
newest first, capped at `OPTOUT_STATS_SCAN_CAP` (1000). At the cap the
per-vendor counts surface as `"N+"` via `optOutsCapped` — the same honest
"counts max out at the scan cap" semantics `statsCapped` already established
for the per-vendor message-log scan. Full denormalized rolling counters were
**deliberately skipped**: the capped semantics stay honest with bounded indexed
reads at current scale; counters remain the Broadcast-era escape hatch noted in
[`docs/waba-protection.md`](./waba-protection.md).

## Tests

- `convex/logRetention.test.ts` — expired-vs-fresh deletion per table, rollup
  counts across two months × multiple category/status pairs, upsert-increment
  across successive purges, idempotent re-run, multi-page self-chaining
  (driven via `t.finishAllScheduledFunctions`), wabaHealth's keep-the-newest
  rule (including that the retained LOW state still blocks `canSend`), the
  adminAuditLog 24-month window.
- `convex/lib/retention.test.ts` — `mytMonthKey` month-boundary behaviour +
  the stated windows.
- `convex/wabaProtection.test.ts` ("admin vendor list") — 30-day opt-out
  counting through the new indexed read, `optOutsCapped` exposed.

## Related docs

- [`waba-protection.md`](./waba-protection.md) — the gateway that writes
  `outboundMessageLog` / `optOuts` / `wabaHealth`.
- [`admin-console.md`](./admin-console.md) — the act-as trail that writes
  `adminAuditLog`.
- [`counter-checkout.md`](./counter-checkout.md) — the pre-existing
  counter-session purge (PDPA family).
- [`infra-cost-scaling.md`](./infra-cost-scaling.md) — the broader cost/scale
  picture these purges feed into.
