# Kedaipal Credits — the order-credit ledger

> **Status:** T1 (the ledger — ClickUp [`86eye2ccu`](https://app.clickup.com/t/86eye2ccu)) built. T2 top-up packs (`z8r3fdf8ht`), T3 meter + seller lock + notices (`z8r3fdf8hy`), T4 auto top-up (`z8r3fdf8wa`) and T5 public surfaces + release pack (`z8r3fdfu31`) build on it and add their own sections below. Decision register: `z8r3fdf8j1` (Arif, locked 17 Sep 2026) — with **Zaki's 30 Sep 2026 overrides** (refund rule, trial allowance, team permission), marked below.

**1 credit = 1 order.** Every plan includes credits each month; sellers can buy
more. From 1 Oct 2026 every order carries a real Meta messaging cost, so a flat
price needs a volume bound to hold the margin band. Credits are that bound —
additive to the locked tier prices, never a replacement for a subscription
(there is **no pay-as-you-go plan**).

Language rule, everywhere a seller or prospect reads it: **"credits"**,
**"orders left"**, **"top up"**, and a debt reads **"15 orders owed"**. Never
*wallet*, *fee*, *commission*, *pay as you go*, a percentage, or a balance in
RM. One order = one credit whatever its size.

## The model

| | Plan credits | Purchased credits |
| --- | --- | --- |
| Where from | The plan's monthly grant | Top-up packs (T2), referral rewards, admin grants |
| Lifetime | One usage period (the MYT calendar month) | 12 calendar months from when they landed |
| At the month boundary | A positive leftover is **forfeited** (no rollover); a **debt carries** into the refresh | Untouched |
| Spent | First | Second, **oldest lot first** |
| Can go negative | Yes — orders are never refused | Never |

**When a credit is used:** at order **creation**, on every channel — storefront
checkout, direct checkout, counter checkout (walk-ins included), claim links,
bookings (a request-to-book uses its credit at request) and event RSVPs.
Creation is when the buyer confirmation and the seller alert go out and the Meta
cost lands. The balance may go **below zero**; the ledger never refuses an
order, and **the storefront never pauses** — running out locks the *seller*
(T3), never the buyer.

### Monthly grants

| Plan | Credits a month |
| --- | --- |
| Starter | 100 |
| Pro | 200 |
| Scale | 500 |
| Founding Pro (closed cohort, MY RM104 / SG S$41) | 300, for life |
| Free trial | **200, one-off for the whole trial** (Zaki, 30 Sep 2026) |

`PLAN_CREDIT_GRANT` in `convex/lib/plans.ts` is **the** per-plan order
allowance — `PLAN_CAPS.orderCap` is derived from it ("one number, one source"),
so the soft-cap meter and the ledger can't disagree. Scale moved from 400 to 500
with this change; subscription rows carry `orderCap` denormalized, hence the
`resyncSubscriptionCaps` step below.

**Grant precedence** (`monthlyCreditGrant`): an admin's custom grant → the grant
an annual payment locked for its term → Founding Pro 300 → the plan's grant.

### The trial: 14 days or 200 orders, whichever comes first

A store is free until its first order (start-when-you-sell). From that order
the trial runs until the first invoice is paid — **14 days** (that invoice's due
date, unpaid ⇒ the existing view-only lock) **or 200 orders**, whichever runs
out first. The 200 is granted once, at signup, and is **not** refreshed at a
month boundary (a trial crossing 1 Nov would otherwise get 400). Running out
during the trial locks the seller like any other zero balance (T3) — and the
fix is to pick a plan, since top-ups aren't sold during a trial.

**Subscribing always unlocks.** Paying the first invoice converts the trial
exactly like a monthly refresh: what's left of the 200 is forfeited, a trial
debt carries, and the plan's grant lands (`grant + min(0, trialBalance)`). The
ticket's original "Starter = 100 − trial usage" would have left a seller who
used 180 trial orders still locked after paying.

The day-15-after-signup backstop is unchanged: a store with no order by then
still gets its first invoice.

## Grants by subscription status

| Status | Grant at the month boundary | When the grant lands otherwise |
| --- | --- | --- |
| `trialing` | None — the trial's one-off 200 stays as it is | At signup |
| `active` | The monthly grant | An upgrade lands its difference at once |
| `past_due` | None; a positive leftover is still forfeited | When the invoice is paid (`settleInvoicePaid`) |
| `on_hold` | None (a technical guard until Off-Season Hold is retired, z8r3fdfuhr) | On resume |
| `cancelled` | None; purchased credits keep their expiry and work again on resubscribe | On the next paid invoice |
| **comped**, **admin-owned**, **missing subscription row** | The plan's monthly grant **whatever the status** | — |

Comped and admin-owned stores are metered for an honest number and are **never
locked**. An admin's own store sits in `trialing` forever, so it runs on the
monthly grant rather than a one-off trial allowance that would never refresh.

### Plan changes

- **Upgrade** (e.g. Pro → Scale mid-month): the difference lands at once — the
  bucket becomes `newGrant − used this period`.
- **Downgrade**: nothing changes this period; the next refresh grants the lower
  plan. A downgrade never takes credits back mid-month.
- **Annual**: granted **monthly**, never 12 months upfront. An annual payment
  locks the grant in force for its prepaid term (`creditAccounts.annualGrant`),
  so a later cut to `PLAN_CREDIT_GRANT` reaches an annual seller only at renewal.
  An upgrade mid-term re-stamps it; a monthly payment clears it.
- **Custom grant** (admin): beats every tier grant. A higher one lands its
  difference now; a lower one waits for the next period.

## Refunds — only an order that never got going

**Zaki, 30 Sep 2026** — this replaces the register's "every cancel refunds"
(item 5b). As specced, a seller could cancel finished orders to win credits
back — including while locked, since cancelling stays open to a locked seller
(T3), which would have made the lock a no-op. And the Meta cost of an order is
already spent when it's created.

| Who ended the order | Credit comes back? |
| --- | --- |
| **The system** — an unanswered booking request expired, an unpaid claim-link order passed its payment deadline | Always |
| **The buyer** — declined the custom item on a custom-only order | Always |
| **A Kedaipal admin** — hard-deleted a live order | Always |
| **The seller** (or an admin working their store) — cancel or booking decline | Only if the order was **never accepted** (`pending` / `booking_requested`), and at most **10 a month** (`SELLER_CANCEL_REFUNDS_PER_PERIOD`) |

An accepted order keeps its credit. A refund returns to the bucket — and the
lot — the credit came out of. Only an order this ledger actually debited can be
refunded, so an order from before credits launched, or one already refunded,
never mints a credit. There is no un-cancel path in the codebase; if one is ever
added, the debit is idempotent on the order's own history (debits − refunds), so
it will re-debit correctly.

Every `applyStatusTransition` caller that can cancel passes a `cancelCause`
(pinned by `credits.test.ts`, which scans the source). The option defaults to
`"seller"` — the strictest rule — so a caller that forgets can only ever
under-refund.

## Purchased credits: lots and expiry

Purchased credits live in **lots** (`creditLots`) — one per pack, referral
reward or admin grant — each with a `remaining` count and an `expiresAt` 12
**calendar** months after it landed (the same date next year on the MYT wall
clock; 29 Feb clamps to 28 Feb). Orders spend the lot that expires soonest.
`purchasedBalance` is always the sum of `remaining`.

A daily sweep at **00:10 MYT** retires whatever is left of each expired lot as
one `expire` ledger row per lot, so the seller's activity list shows exactly what
went and when. A refund into an already-expired lot re-opens it and the next
sweep retires it again ("no new expiry"). The meter shows the next expiry and
the seller is emailed 14 days before (T3, `creditLots.expiryNoticeAt`).

## Architecture

Three tables — and deliberately **no new fields on `retailers` or
`subscriptions`**:

- **`creditLedger`** — append-only, the source of truth. Every row carries the
  running balances after it (`planAfter`, `purchasedAfter`), a `reason`, and for
  orders an idempotency key (`refId` = the order id) plus the `ORD-XXXX` label.
  Kept when a store is deleted — a financial record, like `invoices`.
- **`creditAccounts`** — one row per store caching both balances, the period
  (`periodKey` `YYYY-MM`, `periodGrant`), the custom / annual grant, the seller
  refund count, `exhaustedAt` (when the total last fell to 0 or below — a fact
  about the balance, not a lock) and T3's notice dedupe.
- **`creditLots`** — above.

Why not fields on the retailer doc, as the ticket sketched: the storefront reads
the retailer doc, so a balance patched onto it on every order would re-run every
open storefront tab; and on the **one shared dev deployment**, data written into
new fields of an existing table blocks every other branch's `convex dev --once`,
while a table a branch doesn't declare is simply not validated.

**One write path.** Every balance change goes through `applyEntry`
(`convex/credits.ts`), which writes the ledger row and the cache in the same
mutation. `credits:internalRecomputeBalance` rebuilds a store's balances from
its ledger and reports drift (and whether the lots still add up).

### The seams

| Event | Where | What happens |
| --- | --- | --- |
| Order created (all 4 insert paths) | `subscriptionUsage.recordOrderCreated` | Usage meter + start-when-you-sell + **debit** |
| Order ended (the cancel helper, hard delete, buyer decline) | `subscriptionUsage.recordOrderCancelled`, via `orders.reverseCancellationEffects` / `declineMockupItem` | Usage decrement + **refund** decision |
| Store created | `retailers.createRetailer` | Account opens with the trial allowance |
| Invoice paid | `invoices.settleInvoicePaid` — `prepareCreditsForSettle` **before** the subscription is rewritten, `applyCreditsOnSettle` after | Roll under the old status, then conversion / grant / upgrade difference / annual lock |
| Hold resumed | `subscriptions.setSeasonalHold` | The period's grant lands if it hadn't |
| Comp switched on | `subscriptions.setComp` | Same |
| 00:05 MYT daily | `credits.internalRollPeriods` | Roll every account a month boundary has passed |
| 00:10 MYT daily | `credits.internalExpireLots` | Retire expired lots |

The order seams **never fail an order**: a ledger fault is logged and
swallowed. Payment settle, resume and comp likewise continue if the credit step
throws. Periods also roll lazily — an order on the 1st rolls its own account
before the sweep runs — and the balance query projects an un-rolled period, so
the meter is right at 00:01.

## Reads and permissions

- `credits.getBalance` — the one read behind every meter: plan, purchased,
  total, period, `nextGrant`, `refreshesAt`, the next expiring lot,
  `exhaustedAt`, seller refunds left, custom-grant flag.
- `credits.listActivity` — the ledger newest first (paginated), without admin
  notes. The seller's "Credit activity" list (T3) reads it.
- `credits.adminGetAccount` / `adminListLedger` / `adminAdjust` /
  `adminSetGrantOverride` — admin only, audited. An adjustment needs a note (kept
  on the ledger, never shown to the seller). Plan adjustments live and die with
  the month; purchased additions land as a 12-month lot; purchased removals take
  the oldest lot first and can't overdraw.

**Team permission** — a new **Credits** area (Zaki, 30 Sep 2026): *view* = the
balance and its history; *edit* = buying packs (T2). A member pays on the HitPay
checkout page themselves — the owner's saved card is **never** charged by a
member — and the owner is emailed every member purchase. Plan changes, cancel,
auto-renewal and auto top-up stay under **Billing**, owner-only. The Store
manager preset includes *view*.

## Three constraints

- **Non-transferable** — every row is keyed to one store; nothing moves credits
  between two.
- **Never redeemable for cash** — no path turns credits into money; refunding a
  top-up is an admin `adjust`, never a reversal of the purchase.
- **Only for Kedaipal's own service** — orders are the only spend; Lalamove,
  Delyva and Meta are never paid in credits. `reason` is the seam for future
  Kedaipal-provided spenders.

## Operator runbook

After the release deploys (listed in the release PR's operator checklist):

1. `npx convex run migrations:resyncSubscriptionCaps` — Scale's denormalized
   `orderCap` 400 → 500.
2. `npx convex run migrations:backfillCreditAccounts` — **once**; it batches
   and reschedules itself. Every store opens with the full grant its status
   earns today (never "grant − this month's orders"), so nobody starts in debt.
   No welcome credits.

Before T1 merges: the busiest month of every active seller should sit under
their grant (the query is in the T1 PR).

Audit a store: `npx convex run credits:internalRecomputeBalance
'{"retailerId":"…"}'` (add `"repair": true` to fix a drift — but find what wrote
around `applyEntry` first).
