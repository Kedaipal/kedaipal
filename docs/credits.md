# Kedaipal Credits — the order-credit ledger

> **Status:** T1 (the ledger — ClickUp [`86eye2ccu`](https://app.clickup.com/t/86eye2ccu)) built. T2 top-up packs ([`z8r3fdf8ht`](https://app.clickup.com/t/z8r3fdf8ht)) built — see [Top-up packs (T2)](#top-up-packs-t2). T3 meter + seller lock + notices ([`z8r3fdf8hy`](https://app.clickup.com/t/z8r3fdf8hy)) built — see [The meter, the seller lock and the notices (T3)](#the-meter-the-seller-lock-and-the-notices-t3). T5 public surfaces + release pack (`z8r3fdfu31`) builds on it and adds its own section below. **T4 auto top-up (`z8r3fdf8wa`) was cancelled on 1 Oct 2026** (Zaki × Arif): credit packs never auto-reload — the subscription is the only recurring charge, and a pack is always a deliberate purchase on HitPay's checkout page. Decision register: `z8r3fdf8j1` (Arif, locked 17 Sep 2026) — with **Zaki's 30 Sep 2026 overrides** (refund rule, trial allowance, team permission), marked below.

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
| Enterprise | **the contract's included credits** (HSL: 1,500) — see [Enterprise](#enterprise-the-contract-is-the-grant-t6) |
| Founding Pro (closed cohort, MY RM104 / SG S$41) | 300, for life |
| Free trial | **200, one-off for the whole trial** (Zaki, 30 Sep 2026) |

`PLAN_CREDIT_GRANT` in `convex/lib/plans.ts` is **the** per-plan order
allowance — `PLAN_CAPS.orderCap` is derived from it ("one number, one source"),
so the plan cards, the meter and the ledger can't disagree (the soft-cap meter
it replaced is gone — T3). It has no Enterprise key: a contract's grant is a
per-store number, so it lives on the store (below). (Scale's 500 went with
Scale, retired before release by T6.)

**Grant precedence** (`monthlyCreditGrant`): an admin's custom grant → the grant
an annual payment locked for its term → Founding Pro 300 → the plan's grant.
An Enterprise store's grant is always the first line — its contract writes it
there.

### Enterprise: the contract is the grant (T6)

A store on an Enterprise contract ([`pricing.md` →
Enterprise](./pricing.md#enterprise--a-contract-not-a-price)) is granted its
contract's **`includedCredits`** every month, and those credits live in exactly
one field: `creditAccounts.grantOverride`. `enterprise.setContract` writes the
override in the same mutation that saves the contract, and
`credits.adminSetGrantOverride` — which since the z8r3fdkp8h follow-up only
accepts a NUMBER on comped or contract stores (`GRANT_LEVER_CONTRACT_REFUSAL`:
a custom allowance on a listed plan is a contract with no record; clearing a
stale grant always works) — on a contract store edits the contract's
number too (under the contract's own rule — at least 1 — and stamping who
changed it) — changing one changes the other, and clearing the override is
refused while the store is on a contract. Raising it lands the difference this
month, exactly like an upgrade. When a scheduled move to Pro settles, the
contract and the override are cleared together: this month's credits stay,
next month is Pro's 200 (and that Pro bill's emails already quote 200, not the
1,500 still on the account). Should the override ever be missing on an Enterprise
row, `monthlyCreditGrant` falls back to Pro's grant rather than zero — a data
fault must not lock a contract customer.

**Overage blocks are bought credits.** A block (HSL: 5,000 at RM0.60) is
invoiced by hand and landed with `credits.adminAdjust` into the **purchased**
bucket under reason **`enterprise_block`** — contract stores only, positive
amounts only. It then behaves like any pack: 12 months, spent after the monthly
credits, counted in "Unused bought credits". The seller's activity list reads
"Enterprise block — extra credits under your contract". The top-up dialog
names the contract's block rate beside the packs, with an "Ask us for a block"
chat for the owner (`topUpOptions.contractBlock`); the packs themselves stay on
sale. Lock rules are Pro's unless comped, and a contract store is never shown
an upgrade hint — there is no plan above a contract.

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

- **Upgrade** (e.g. Starter → Pro mid-month): the difference lands at once — the
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
  `exhaustedAt`, seller refunds left, custom-grant flag, and
  `ordersThisPeriod` (the `subscriptionUsage` count a plan change compares
  against).
- The dashboard payload (`getMyRetailer`) carries `creditLock` — locked, the
  unlock route, since when, orders waiting — to **every** teammate: it has no
  balance numbers, and everyone needs to know why a control is greyed out.
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
member — and the owner is emailed every member purchase. Plan changes, cancel
and auto-renewal stay under **Billing**, owner-only. The Store
manager preset includes *view*.

## Three constraints

- **Non-transferable** — every row is keyed to one store; nothing moves credits
  between two.
- **Never redeemable for cash** — no path turns credits into money; refunding a
  top-up is an admin `adjust`, never a reversal of the purchase.
- **Only for Kedaipal's own service** — orders are the only spend; Lalamove,
  Delyva and Meta are never paid in credits. `reason` is the seam for future
  Kedaipal-provided spenders.

## Public surfaces (T5)

ClickUp [`z8r3fdfu31`](https://app.clickup.com/t/z8r3fdfu31). "Open Scale for
purchase" ([`z8r3fdfuhq`](https://app.clickup.com/t/z8r3fdfuhq)) was folded in,
then cancelled before release by Enterprise (T6,
[`z8r3fdkp8h`](https://app.clickup.com/t/z8r3fdkp8h)).
The rule: on release day the dashboard, `/pricing`, the landing, `/cost`, the
emails and the Terms say the same thing, in en/ms/zh, for MY and SG visitors —
a prospect finds nothing to discover after signup.

**Every number is read, never typed.** Allowances come from
`PLAN_CREDIT_GRANT`, pack prices from `CREDIT_PACKS[currency]`, the trial from
`INVOICE_DUE_GRACE_DAYS` (the first invoice's grace — which IS the 14 days) and
`TRIAL_CREDIT_GRANT`, the refund allowance from
`SELLER_CANCEL_REFUNDS_PER_PERIOD`, the lot lifetime from
`PURCHASED_CREDIT_LIFETIME_MONTHS` — as `{placeholders}` in the catalogs. The
one exception is the landing FAQ (`faq_a_8`): FAQ answers render param-less
for the FAQPage JSON-LD mirror, so it spells "14 days or 200 orders" and
`landing-redesign.test.ts` pins those literals to the constants.

| Surface | What it says | Where |
| --- | --- | --- |
| `/pricing` tier cards | "{credits} credits a month — 1 per order" on Starter and Pro; Enterprise "Credits sized to your volume", "Custom", and "Talk to Arif" | `src/routes/pricing.tsx` |
| `/pricing` table | "Credits a month (1 credit = 1 order)" — 100 / 200 / Custom, **per month in both toggle positions** | same |
| Under the table | "1 credit = 1 order. Need more in a busy month? Top-ups start at {price} for {credits} credits." — the visitor's currency's smallest pack; S$ never beside RM | same |
| Under the annual toggle | "On annual you get the same credits every month, locked in for the year you paid." | same |
| `/pricing` FAQ | When do I start paying? · What is a credit? · Is my price changing? · What happens if I run out? · Do unused credits carry over? · Can I switch plans? · Same credits on annual? | same |
| Landing teaser | one sub line (every plan includes a monthly order allowance); Starter and Pro open on their credits, Enterprise on "Credits sized to your volume"; Enterprise's unbuilt rows wear "Soon" | `src/components/landing/pricing-teaser.tsx` |
| `/cost` | the plan the visitor's volume needs — plan + cheapest top-ups, never a flat Pro | `recommendPlan`, `src/lib/calculator.ts` |
| `/terms#credits`, `/terms#data-processing` | the credits clauses and the processor terms | `src/routes/terms.tsx` |
| Emails | invoice emails name the billed plan's monthly credits (`monthlyCreditGrant` — a custom grant or Founding Pro's 300 in the member's own email); the first-invoice emails state the trial; the free-period nudge names each plan's credits | `convex/lib/billingEmailCopy.ts` |
| Dashboard checklist | "Start your plan" states the trial in one line | `src/lib/subscribe-step.ts` |
| Admin | per-store credits column + sort, a Credits section in the seller sheet that opens the credit ledger (adjust, custom grant) as a page of the SAME drawer — back link to the seller, never a drawer stacked on a drawer — and two book-wide tiles on Admin → Billing | `admin.ts`, `credits.adminCreditTotals`, `src/components/admin/credit-ledger-sheet.tsx` |

**What public copy says, in one place:**

- **1 credit = 1 order you keep.** A credit comes back only for an order that
  never got going (an unanswered booking request, a lapsed unpaid claim-link
  order, a buyer backing out, or a new order the seller cancels before
  accepting — up to 10 a month).
- **Running out never stops the shop.** Every order still comes in; until
  credits are added (top up, move up, or the monthly credits) the seller can't
  accept or update orders or edit products, and can always see, cancel and
  refund. Orders taken at zero come off the next credits.
- **The trial:** free until the first order; from it, 14 days or 200 orders of
  everything in Pro, whichever comes first; then pick a plan. The day-15
  backstop is named in the FAQ answers, never contradicted elsewhere.
- **Never shown publicly:** Founding Pro's 300, the Off-Season Hold, any
  percentage, "wallet", "pay as you go", a balance in money — and credits are
  never mentioned to a buyer.

**Vocabulary** (so T3's in-app copy and emails match the public pages):

| en | ms | zh |
| --- | --- | --- |
| credit / credits | kredit | 点数 (unit 点 — "1 点 = 1 张订单") |
| top up | tambah kredit | 充值 |
| orders a month | pesanan sebulan | 每月 … 张订单 |

`pricing-copy.test.ts` pins the allowances to `PLAN_CREDIT_GRANT` (placeholder,
never a literal; the retired 400 and any "orders/mo" line are banned), the
trial's two bounds travelling together, and the banned vocabulary.

## Operator runbook

After the release deploys (listed in the release PR's operator checklist):

1. ~~`npx convex run migrations:resyncSubscriptionCaps`~~ — **not needed since
   T6.** Its only job for this release was Scale's denormalized `orderCap`
   400 → 500, Scale is retired with zero prod rows, and Starter's and Pro's
   caps are unchanged. Harmless if run (idempotent; it would report
   `patched: 0`).
2. `npx convex run migrations:backfillCreditAccounts` — **once**; it batches
   and reschedules itself. Every store opens with the full grant its status
   earns today (never "grant − this month's orders"), so nobody starts in debt.
   No welcome credits.

Before T1 merges: the busiest month of every active seller should sit under
their grant (the query is in the T1 PR).

Audit a store: `npx convex run credits:internalRecomputeBalance
'{"retailerId":"…"}'` (add `"repair": true` to fix a drift — but find what wrote
around `applyEntry` first).

## Top-up packs (T2)

**ClickUp:** [`z8r3fdf8ht`](https://app.clickup.com/t/z8r3fdf8ht) · **Files:**
`convex/creditPurchases.ts` (the lifecycle), `convex/lib/creditPurchases.ts`
(pure rules + refusal copy), `convex/lib/hitpayBillingClient.ts` (the one HTTP
client for Kedaipal's own HitPay account), `convex/lib/hitpayBilling.ts`
(request params, method labels), `convex/billingEmail.ts` +
`convex/lib/billingEmailCopy.ts` (the receipt email), `convex/lib/pdf/` (the
receipt PDF), `src/components/settings/credit-top-up-dialog.tsx` (the picker),
`src/lib/credit-top-up.ts` (the URL contract).

A seller picks a pack and pays on HitPay's hosted checkout — **Kedaipal's own
HitPay account**, the same one-off payment request as a subscription invoice's
Pay-now link, never the seller's BYO HitPay. The credits land in the purchased
bucket **exactly once**, as a 12-month lot, through `addPurchasedCredits`.

### Packs and currency

| Billing currency | Packs |
| --- | --- |
| MYR | 50 credits — RM 45 · 200 credits — RM 160 |
| SGD | 50 credits — S$ 22 · 200 credits — S$ 75 |

A store sees **one currency's packs: its BILLING currency** — `renewalCurrency`
(the newest paid invoice's currency, else the country), the author renewals
already bill by. Never the visitor's geo cookie: a Malaysian seller on holiday
in Singapore still pays in ringgit. A pack id from the other currency is
refused. The purchase row freezes the pack, credits, amount and currency;
nothing ever re-prices it.

### Who can buy

**The store** (`topUpRefusal`, which wraps T1's `topUpBlock`): only an
**active, paid** store buys — a pack tops up a plan, it never replaces one.
Every other store is refused with copy that names the way out — the server's
refusal and the picker's disabled-with-reason line are one author
(`topUpRefusalMessage`):

| Status | The owner reads | Way out in the picker |
| --- | --- | --- |
| `trialing` | "Credit packs top up a paid plan. Pick a plan first…" | Choose a plan |
| `past_due` | "Your invoice INV-… is overdue. Pay it first…" | **Pay INV-…** (its Pay-now link), else View the invoice |
| `on_hold` | "Your plan is on Off-Season Hold. Resume it first…" | Resume your plan |
| `cancelled` | "Your subscription has ended. Choose a plan first…" | Choose a plan |
| admin's own store | "Kedaipal admin stores aren't billed…" | — |
| sponsored (comped, or no subscription row) | "Sponsored stores never run out, so there's nothing to top up…" | — |

A teammate reads the same reason addressed to them ("Ask the store owner to…")
and gets no button: every way out is a billing write, which is the owner's.
**A Kedaipal admin's own store** is its own refusal (a judgment call beyond the
ticket): it sits in `trialing` forever and is never locked, so "pick a plan
first" would be advice it can't take. **A sponsored store** (Zaki, 1 Oct 2026)
is refused for the same reason — its credits are a meter, never a lock, so a
pack would be money for nothing; the missing-row fail-safe resolves as comped
and is refused alongside it. Neither refusal has a way-out button: nothing is
wrong.

**The person**: credits **WRITE** (`requireRetailerAccess(…, {area: "credits",
level: "write"})`) — the owner and an admin always, a teammate only with the
grant. **Under admin act-as it is refused**: billing is view-only there (the
`subscriptions.setSeasonalHold` posture) and an admin adds credits with an
audited `credits.adminAdjust` instead. A teammate pays on HitPay's page **with
their own card or wallet** — no saved card is ever charged for a manual top-up
— and the owner is emailed a receipt that names them.

### The lifecycle

```
createTopUp (action, public)
  └ openPurchase (mutation): credits write · not act-as · billingSelfServe rate
     limit · pack ∈ the billing currency · topUpRefusal → insert PENDING,
     schedule expirePurchase at +24h
  └ POST /payment-requests  (expires_after "1440 mins", webhook, redirect
     /app/settings?tab=billing&topup=return)
  └ recordPurchaseRequest → return the checkout URL; the client redirects

pending ──settlePurchase──▶ paid     (lot + ledger row; then finalize + GA4)
pending ──24h, unpaid────▶ expired  (HitPay request DELETEd)
pending ──mint failed────▶ failed   (the checkout never existed)
```

`creditPurchases` is its own table — deliberately **not** `invoices`: a pending
invoice past its due date locks the store and blocks renewals
([hitpay-recurring.md](./hitpay-recurring.md#why-credit-as-days-and-not-charge-the-difference)
rejected "top-up invoices" for exactly this), and an abandoned top-up must do
neither.

### Settling — exactly once

Three callers land in ONE mutation, `settlePurchase`: the v1 completion webhook,
the return reconcile (`verifyCreditPurchase`), and the expiry's last look.

| The purchase is… | …and the payment | Result |
| --- | --- | --- |
| pending | amount AND currency match | **paid** — lot + `purchase` ledger row (`refId` = the purchase, `refLabel` "50-credit pack") |
| paid | the same payment id | duplicate — a plain no-op |
| paid | a different payment id | `gatewayIssue: late_payment`, no credit |
| expired / failed | anything | `gatewayIssue: late_payment`, **no credit** |
| pending | wrong amount or currency | `gatewayIssue: amount_mismatch`, **no credit**, still pending |

The status flip and `addPurchasedCredits` share the transaction, so the paid
guard IS the idempotency: a second delivery can never mint a second lot. An
issue is stamped once and never overwritten. After a settle: `finalizePaidPurchase`
names the rail (the v1 webhook doesn't carry one — it asks HitPay's status API),
freezes the receipt PDF, then schedules the receipt email, in that order so both
say how the seller paid; and the server-side GA4 `credits_topup_paid` goes out.
**Referral T2 hooks in right there** (the referrer's reward on a referee's first
paid pack — a comment marks the spot; not built).

### The webhook branch

`POST /webhook/hitpay`, v1 form branch: orders are resolved first
(`hitpay.getWebhookContext`); a miss goes to ONE resolver,
`subscriptionPayments.resolveBillingRequestContext`, which answers an invoice OR
a credit purchase by `gatewayRequestId` — one query hop whichever it is.
`handleBillingCompletionWebhook` verifies the HMAC with `HITPAY_BILLING_SALT`
(fail-closed 500 without it, 401 on a bad signature), acks a non-completed
status without touching anything (a declined attempt leaves the checkout open
for another try), and dispatches to `settlePurchase`. Routing never reads
`reference_number` — the `CRD-…` number is a label.

### Expiry — 24 hours, per purchase

`openPurchase` schedules `expirePurchase` at +24h — a per-purchase timer, not a
daily sweep, so "expired" means exactly that. The HitPay request carries the
same clock (`expires_after "1440 mins"` — minutes, the only unit sandbox has
verified on this account). The expiry **never throws money away**: it asks
HitPay once more first, and settles a payment whose webhook was lost; if HitPay
can't be asked, it looks again an hour later (three looks in all) —
"couldn't check" is not "didn't pay". Only then is the purchase `expired` and
its request DELETEd. A payment that still turns up is stamped `late_payment`.

**Testing that clock — mind the flush drift.** `flushSoon`, the suite's
`finishAllScheduledFunctions` wrapper, advances the fake clock **1ms per
macrotask pump** while it waits for scheduled functions to settle, so a single
flush burns fake milliseconds in proportion to *real* latency — ~2s against a
cold module cache, more on a loaded CI runner. An assertion that a purchase has
**not** expired yet must therefore sit well clear of the TTL rather than a
second below it: the original 1000ms margin was smaller than one flush, so the
expiry fired early and the suite failed at random on whichever branch happened
to be slow. `creditPurchases.test.ts` checks an hour out, which a flush cannot
overshoot (capped at 100 x 10000 pumps, ~16.7min of fake time). The same trap
applies to any future "not yet" assertion against a scheduled timer.

### Back from HitPay, and the URL contract

- `/app/settings?tab=billing&topup=1` **opens the picker**. Every "Top up"
  button links there — use `TOP_UP_SEARCH` on a router `<Link>` or
  `TOP_UP_HREF` as a plain path (`src/lib/credit-top-up.ts`). The validated
  search carries the raw `1`, so a typed link produces a clean `topup=1`.
- `/app/settings?tab=billing&topup=return` is where HitPay sends the buyer:
  the dialog reopens on "Confirming your payment…", calls
  `verifyCreditPurchase` once, and watches `latestPurchase` reactively — no
  polling — into **paid** (credits, new balance, receipt), **not received yet**
  (honest for both paid-but-slow and backed-out; flips to paid live if the
  webhook lands), **expired**, or **flagged** (an uncredited payment: "we'll add
  them or refund you", with a WhatsApp link quoting the `CRD-…` number).
- Both are consumed once and stripped from the URL — a refresh or a shared link
  never replays a confirmation.

The dialog is mounted by the settings route **beside** the billing tab's
`AreaGate`, not inside it: a teammate can hold credits write without billing
read, and inside the gate the only place they can buy would be hidden.

### Every state the picker has

Loading (skeletons) · can buy (balance being topped up — "37 orders left",
always split as "12 monthly · 25 bought" — the packs, the rules, the Terms
`#credits` link) · refused (disabled with the reason and the way out; the
packs stay visible but inert) · view-only teammate (`NeedsAccessNote`) · no credits
access (the note is the surface) · admin act-as (view-only note, reads the
seller's store) · online top-ups unavailable (no packs, a WhatsApp link) ·
opening HitPay. A Starter store also reads that Pro includes 200 orders a month
and is cheaper for steady volume — a line, not a button; never shown where no
upgrade is on offer (Pro, Enterprise, founding, a custom grant). An Enterprise
store reads its contract's block rate there instead, with "Ask us for a block"
for the owner.

**The packs read like the /pricing cards** (Zaki, 1 Oct 2026 — "make the
packages look enticing"): side-by-side cards, native radios (arrow keys move
the choice, one spoken sentence per pack), credits as the headline, the price
the way /pricing quotes one (no cents on whole amounts), what one credit costs
in each pack, the cheaper per credit badged **Best value** and saying exactly
what it saves in money ("Save RM 20 vs 4 × 50") — never a percentage — and
"Lasts 12 months" on each. Under them, the result of the tap before the tap:
"After this top-up: 60 orders left", or "Covers the 15 owed and leaves 35
orders" when the store owes orders (a pack pays the debt first). The rules
live in `src/lib/credit-packs.ts` (`packOffers`, `afterTopUpLine`), pinned by
tests. The default pick stays the smaller pack: the badge and the saving do the
persuading, not a pre-selection.

### Receipts and history

- **Email** (`billingEmail.notifyCreditPurchaseReceipt`, en/ms/zh): to the
  store's billing inbox (`notifyEmail`) for EVERY top-up, naming the teammate
  when one bought it and saying their own method paid; plus a copy to that
  teammate (a judgment call beyond the ticket — they paid and need proof). Pack,
  credits, amount, rail, date, the lot's expiry, the `CRD-…` number and
  "non-refundable and not redeemable for cash". Dates on the MYT wall clock,
  matching the PDF. Preview: `npx convex run
  billingEmail:sendSampleBillingEmail '{"to":"…","key":"creditPurchaseReceipt","member":true}'`.
- **PDF** (`buildCreditPurchaseReceiptPdf`): frozen once paid on
  `receiptPdfStorageId`, rendered on demand if missing, served by
  `getReceiptPdfUrl` behind credits READ.
- **Billing history** (`myPurchases`, credits read): paid top-ups merge into the
  billing tab's list — now "Billing history" — dated by when each was paid,
  with a receipt button; a teammate's purchase reads "Bought by {name}".

### Deleting a store

The rows are retained (a financial record, like invoices). The
`creditPurchases` deletion phase closes every still-pending checkout (`expired`)
and DELETEs its HitPay link — a payment into a deleted store is only ever a
refund, and one that slips through lands as `late_payment`.

### Operator notes (T2)

- **Env vars:** none new. `HITPAY_BILLING_API_KEY` / `HITPAY_BILLING_SALT`
  absent ⇒ `topUpOptions.available` is false, every top-up surface hides, and
  `createTopUp` refuses.
- **Schema:** the new `creditPurchases` table (indexes `by_retailer_created`,
  `by_retailer_status_created`, `by_gateway_request`). Additive; no backfill.
- **First sandbox run:** confirm HitPay accepts `expires_after "1440 mins"` —
  a 422 there would fail every top-up at "Couldn't open the payment page".
- **An uncredited payment needs a person:** `npx convex run
  creditPurchases:internalListIssues` lists late payments and mismatches; land
  the credits with `credits:adminAdjust` (purchased bucket, a note naming the
  `CRD-…` number) or refund it in HitPay.
- **GA4:** mark `credits_topup_paid` as a key event (docs/analytics.md).
- **Terms:** the picker links `/terms#credits` — T5's Credits clause. The
  picker must not be reachable in production before that clause is live.

## The meter, the seller lock and the notices (T3)

**ClickUp:** [`z8r3fdf8hy`](https://app.clickup.com/t/z8r3fdf8hy) · **Files:**
`convex/creditLock.ts` (the lock resolver, the guard, the cancel outlook),
`convex/creditNotices.ts` (the notice evaluator, its senders, the expiry
heads-up), `convex/lib/credits.ts` (pure: unlock route, audience, the lock
sentence, the typed refusal, `dueCreditNotice`), `convex/lib/creditEmailCopy.ts`
(en/ms/zh), `src/components/credits/` (meter, lock note, activity, lock CTA),
`src/hooks/useCreditLock.ts`, `src/lib/credits-ui.ts` (every display rule).

Credits become visible inside the product and are enforced **on the seller
side only**. The storefront never pauses; a buyer never sees or feels a
seller's balance (a test reads the storefront, product page, categories and
tracking page at +50 and −50 and asserts they're identical).

### The meter

One `CreditMeter`, two places (one control, one rule):

- **Dashboard home** (`card`) — "42 orders left", the monthly bar, both
  balances in one line ("120 of 200 monthly · 25 bought"), the reset ("Back to
  200 on 1 Nov"), and a way into Billing. One button by urgency: when locked,
  the one that puts credits back; once running low, **Top up credits** straight
  into the picker (for a reader who may buy); otherwise just Billing.
- **Settings → Billing** (`full`), right under the plan — the total, then **the
  two balances as two tiles in their order of use** (Zaki, 1 Oct 2026):
  *Monthly credits · used first* ("120 of 200", its bar, "Back to 200 on 1 Nov")
  and *Bought credits · used next* ("25", "Next 25 expire 12 Jan 2027" / "None
  yet — packs last 12 months"); the state line; the nearest bought-credit
  expiry when it falls within 30 days; **Top up credits** → T2's picker; and
  the rule in plain words at the foot (monthly credits are used first and reset
  on the 1st — they don't carry over; bought credits are used next and last 12
  months; a cancelled never-accepted order gives its credit back, up to 10 a
  month). A store that can't buy and holds no bought credits (sponsored, an
  admin's own, a trial) shows the one tile.

**The reset reads as a reset** (Zaki's test round): "300 more on 1 Oct" read as
300 ADDED; monthly credits go BACK to the allowance. `creditRefreshLabel`
writes "Back to 300 on 1 Nov", "285 on 1 Nov — the 15 owed come off", "0 on
1 Nov — the 300 owed use it all up" or "Still 20 owed after 1 Nov".

Order counts only — "15 orders owed", never money. **Amber once the store is
into the last 20% of the month's credits** (`lowCreditLine` — one line shared
with the banner and the low email), red at 0. Every state is designed —
`creditStateLine` is the one author: loading, trial ("200 orders from your
first order"), active, founding (the 300 badge), past due / on hold / ended
("…your 150 bought credits are kept, and work again once your plan is active"
— bought credits never stand in for a plan), sponsored ("never locked — here so
you can see your volume"), **an admin's own store** ("aren't billed… never
locks" — keyed on `getBalance`'s new `lockExempt`, never on the raw status: an
admin store sits in `past_due` or `trialing` and was being told to pay its
invoice), custom allowance, at zero, below zero ("the 15 owed come off your
next pack or your next monthly credits"). Top up is **hidden** where packs
aren't sold and for a store that can never be locked (the state line says why
instead), and **disabled with T2's own sentence** everywhere else
(`creditPurchases.topUpOptions` — credits-read gated, so a teammate with Credits
write gets it without Billing access).

T3 **replaced** the soft-cap surface: the "Orders this month" meter, the
`orderCapNear`/`orderCapOver` banner states, `orderCapState` and
`ordersThisMonth` on the dashboard payload are gone. The `subscriptionUsage`
counter stays — it is `getBalance.ordersThisPeriod`, what a plan change compares
the new allowance against.

**Credit activity** (Billing) lists every movement as a sentence — "October
credits from your plan", "Order ORD-7K2Q", "cancelled before you accepted it,
credit returned", "Unused October plan credits — they don't carry over",
"Bought credits expired (12 months)" — with the balance after it. No admin notes.

### The seller lock

- **Condition:** the projected total is **≤ 0** — the same projection the meter
  reads (`projectedCredits`), so a store whose monthly refresh brings it back
  above zero unlocks at its own midnight, not when the sweep runs. One check.
- **Never locked:** comped and admin-owned stores, a store without a
  subscription row or a credit account (fail open, like the past-due lock's
  missing-row fail-safe). Kedaipal admins pass on their own store and in act-as.
- **Locked** (server-enforced, `assertCreditsAvailable` / the two internal
  queries for actions): editing the catalogue (products, variants, stock,
  categories, import), accepting and moving an order on (`updateStatus` /
  `bulkUpdateStatus` except to cancelled, `advanceToStage`, approving a
  booking), marking payment received by hand, courier booking (Lalamove,
  Delyva), despatch labels, the seller's receipt/invoice PDF, the payment
  reminder, rescheduling, setting a delivery charge, and mockup work.
- **Always open:** reading everything; cancelling and refunding (booking
  decline, deposit settlement, courier cancel, clearing a gateway refund
  issue); pinning; settings; billing, top-up, plan changes, resume; the team;
  every buyer-side mutation; and **order intake on every channel** — storefront,
  direct checkout, counter, claim links, bookings, RSVPs keep taking orders,
  each using a credit, including below zero.
- **Machine-enforced:** `creditLockCoverage.test.ts` classifies every public
  write in the order-handling modules as locked or open (with a reason), fails
  on a catalogue/despatch write without the guard, and fails if order intake or
  a way back (`creditPurchases`, `invoices`, `subscriptionPayments`,
  `subscriptions`, `billing`, `retailers`, `team`) ever carries it.
- **A second, narrower lock** beside the past-due one (which makes a lapsed
  store fully view-only). Where both apply the view-only one speaks: the banner
  shows past due first, and the in-place credit note stands down.
- **The typed refusal:** every locked write throws `ConvexError` with
  `CreditLockErrorData` (`kind: "credits_locked"`, the sentence, the unlock
  route, the audience) — so a save the lock refuses mid-edit shows the sentence
  *with its way back* (`CreditLockCta`), never a dead end. `convexErrorMessage`
  reads it as the sentence everywhere else.

**The way back** (`creditUnlockRoute`, by subscription status): active → top
up (or upgrade); trialing → pick a plan; past due → pay the invoice; on hold →
resume; cancelled → choose a plan. **Who can take it** (`creditLockAudience`):
the owner; a teammate holding **Credits write** when the way back is a top-up
(they buy a pack on HitPay's page themselves — T2); every other teammate is
told to ask the owner. The same sentence (`creditLockMessage`) is the server's
refusal and every lock surface's copy.

### What the seller sees

- **The banner** (app shell, red, right after past due): "You're out of credits
  · 3 new orders since you ran out" + the one button. **Running low** (amber,
  dismissable — keyed by the month) once the store is into the last 20% of the
  month's credits — 60 left on Founding Pro's 300, 40 on Pro, 20 on Starter, 40
  of a trial's 200 — with the way to stay ahead of zero for THIS reader: **Top
  up credits** straight into the picker (the owner, or a teammate holding
  Credits write; never an admin acting as the store), **See plans** on a trial
  (packs top up a paid plan), or **See credits** for a teammate who can't buy,
  told the owner adds them. Never for a store that can't be locked or a custom
  allowance. Measured on what's left IN TOTAL against the month's grant, so a
  store with bought credits banked isn't told to buy more (Zaki, 1 Oct 2026:
  "once base credit is 20%, show banner w/ CTA to purchase" — identical for a
  store with no bought credits).
- **The pack picker** says the result before the tap — and for a locked store,
  "…Your store unlocks as soon as it's paid."
- **`CreditLockNote`** in place on the orders inbox, the order page, the
  products list, new/edit product, import and categories — what's paused, what
  still works, the one button (or "ask the store owner").
- **Every locked control greys out with its reason before the tap.** Primary
  controls say it in the label ("Mark as Packed — out of credits"); the Lalamove
  and Delyva cards keep their Book button, disabled, with the sentence under it,
  and never auto-open a quote; the reschedule trigger stays tappable and opens
  onto the reason (a tooltip is invisible on a phone); the inbox bulk bar keeps
  Cancel and greys every forward move; the batch label dialog says why it
  can't print. **Product forms keep their fields editable** — an edit already
  under way survives, and saves the moment the lock lifts — with Save/Publish
  disabled and the reason beside it; the variant editor's stock Adjust greys
  out too (it is an immediate write). The same wiring covers the past-due
  view-only lock and a view-only teammate, which several of these controls
  never had.
- **The cancel dialog** says what happens to *this* order's credit before the
  tap (`creditLock.cancelOutlook`): it comes back (with how many more this
  month), or it stays used because the order was accepted or the month's 10
  are spent.
- **The plan cards** state each plan's allowance, and what the choice does to
  the balance before confirm: a trial converting ("your trial has used 140 of
  its 200 orders — Starter includes 100 a month, you'd start with 100"), a
  lapsed store paying (the month's credits land on payment, less anything
  owed), an upgrade ("100 more land this month as soon as it's paid") and a
  downgrade ("Starter includes 100 orders a month, from 1 Nov. You've had 140
  so far this month"). "Credited" is no longer a plan-change word — unused
  paid time "carries over as extra days".

### The notices

- **When:** `applyEntry` schedules `creditNotices.evaluate` five minutes after
  the balance crosses a line (into the last 20% of the month's credits —
  `lowCreditLine` of the month's grant — ≤ 0, back above 0); the monthly roll
  schedules one for a store still at or below zero. The evaluator reads the
  balance **when it runs**, so a burst from 45 to −3 is one "you're out", never
  "running low" then "out".
- **Once:** `creditAccounts.notices` (`{periodKey, sent}`) — `low` once a
  period, `locked` once per lock (the marker carries across the 1st, so a lock
  that spans it gets `still_locked`, not a second `locked`), `unlocked` clears
  it.
- **What:** `low` (the last 20% of the month's credits — was a flat 10 until
  Zaki's test round, 1 Oct 2026; the meter's amber and the banner move with it,
  one line — never for comped stores or a custom allowance), `locked`, `still_locked` (a refresh left the store at or below
  zero — says how many orders short, or "at 0"), `unlocked`, and `expiring`
  (a bought lot expires within 14 days — once per lot via
  `creditLots.expiryNoticeAt`, a daily 00:15 MYT sweep, one email per store).
- **How:** **email always**, to `notifyEmail`, in the seller's language — not
  subject to order-alert settings, because a lock must reach them; a top-up
  notice's button opens the pack picker (`topup=1`). **WhatsApp** utility
  templates through `makeGuardedSender(…, "utility_template")` once Meta has
  approved them and the seller has an alert number — the louder second tap.
  Every lock notice says what's paused and what still works, and names the one
  way back; the upgrade line only for an ordinary Starter store.
- **GA4:** `credits_low_nudge_sent`, `credits_seller_locked`,
  `credits_seller_unlocked` (server-side, like `subscription_paid`).

### Operator notes (T3)

- **Env vars (optional, after Meta approval):** `WHATSAPP_CREDITS_LOW_TEMPLATE`,
  `WHATSAPP_CREDITS_LOCKED_TEMPLATE`, `WHATSAPP_CREDITS_UNLOCKED_TEMPLATE` —
  the approved template names. Absent ⇒ email only, nothing breaks.
- **Meta template approvals:** the three utility templates (EN + BM),
  registered by Zaki — list them under "Meta template approvals" in the
  release PR.
- **Crons:** new "credit expiry notices", daily 16:15 UTC (00:15 MYT).
- **Schema:** one additive index, `creditPurchases.by_status_paid` (the admin
  revenue tile). T1 pre-declared `creditAccounts.notices` and
  `creditLots.expiryNoticeAt`, so nothing else is new.
- **Behaviour change on release:** stores at or below zero lock the moment it
  deploys; the backfill opens every account with its full grant, so nobody
  starts locked.
- **Admin → Billing** gains the tile T5 deferred until the purchase table
  existed: **Top-ups · {month}** — this MYT month's paid packs, summed per
  currency (never flattened), with packs and credits sold
  (`creditPurchases.adminTopUpRevenue`, admin only). It sits beside T5's two
  credit tiles, which stay counts of credits, never money.
- **Language:** the notices speak the product's vocabulary — ms "kredit" /
  "tambah kredit", zh 点数 (unit 点) / 充值 — the same words as `/pricing`
  and the receipts (T2's zh receipt said 额度 until the stack was joined).
  Tests pin both.

### How the credit PRs stack

T1 ← T2 ← T5 ← T3, merged in that order: T2 must not ship without T3's Top
up buttons (its only entry points), T3 and T5 both reshape the plan cards, and
the four ship in one release so the dashboard and `/pricing` never disagree.
T4 (auto top-up) was cancelled on 1 Oct 2026 — packs never auto-reload.
