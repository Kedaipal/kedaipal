# Kedaipal Credits — the order-credit ledger

> **Status:** T1 (the ledger — ClickUp [`86eye2ccu`](https://app.clickup.com/t/86eye2ccu)) built. T2 top-up packs ([`z8r3fdf8ht`](https://app.clickup.com/t/z8r3fdf8ht)) built — see [Top-up packs (T2)](#top-up-packs-t2). T3 meter + notices ([`z8r3fdf8hy`](https://app.clickup.com/t/z8r3fdf8hy)) built — see [The meter, the seller lock and the notices (T3)](#the-meter-the-seller-lock-and-the-notices-t3). **T3.1 ([`z8r3fdmg4h`](https://app.clickup.com/t/z8r3fdmg4h)) replaced T3's store-wide lock with a PER-ORDER gate, and a gated order is invisible to the seller** — that is the live behaviour, see [The gate is PER ORDER (T3.1)](#the-gate-is-per-order-t31). T3's lock half never reached a seller (it shipped switched off for one release). T5 public surfaces + release pack (`z8r3fdfu31`) builds on it and adds its own section below. **T4 auto top-up (`z8r3fdf8wa`) was cancelled on 1 Oct 2026** (Zaki × Arif): credit packs never auto-reload — the subscription is the only recurring charge, and a pack is always a deliberate purchase on HitPay's checkout page. Decision register: `z8r3fdf8j1` (Arif, locked 17 Sep 2026) — with **Zaki's 30 Sep 2026 overrides** (refund rule, trial allowance, team permission), marked below.

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
| **comped**, **missing subscription row** | The plan's monthly grant **whatever the status** | — |
| **admin-owned** | **None — the store is unmetered**, see below | Never |

Comped stores are metered for an honest number and are **never locked**: a comp
can end, so the balance behind it has to be real and visible the whole time.

### Unmetered: an admin's own store (z8r3fdp4er)

A Kedaipal admin's own store is **outside the credit system** — a strictly
stronger state than "metered but never locked":

| | comped / sponsored | **admin-owned (unmetered)** |
| --- | --- | --- |
| Credit account | yes | **none** |
| Debited per order | yes | **no** |
| Monthly grant | yes | **no** |
| Meter + activity UI | yes | **hidden** |
| Lock | never | never (nothing to lock) |

It used to be metered "so you can see your volume", which put **"200 of 200"
over a bar with a refresh date** on the one account that has no limit —
a cap to every eye, whatever the sentence underneath said (Zaki, 6 Oct 2026).
Volume already lives in Insights and in the admin console.

**The gate is one function**: `regimeFor` (`convex/credits.ts`) answers `null`
for a store `storeIsMetered` rejects. Every reader and writer of a balance
funnels through it and already had a `null` branch for a store that no longer
exists, so the whole behaviour follows from that one answer: no account
(`ensureCreditAccount`), no debit (`debitCreditForOrder`), no refund
(`refundCreditForOrder`), no monthly refresh (`rollPeriod`), no balance
(`projectedCredits` → `balanceView` → `getBalance` → **every meter hides**) and
no lock (`resolveCreditLock`). Delete the gate and the unmetered tests go red.

Two things the gate does NOT cover, each guarded where it lives:

- `ensureCreditAccount` asks for the regime **before** its existing-row
  shortcut. A store metered before this change still holds an account; without
  that ordering it would have kept spending from it.
- The admin levers (`credits.adminAdjust`, `credits.adminSetGrantOverride`) and
  `creditPurchases.createTopUp` refuse an unmetered store **by name**
  (`UNMETERED_STORE_REFUSAL`) instead of falling through to "Store not found".

The admin console reads it too: the seller row prints **"Admin store — not
metered"** rather than its stale cached figures, and the credit-ledger drawer
says the same instead of "This store no longer exists" (the same `null` view
means both — `adminGetAccount` returns an `unmetered` flag to tell them apart).

**Legacy rows** written while such a store was metered are inert — every
reader asks `regimeFor` *before* touching the account, so the meter hides
whether or not the rows exist — but they sit below the current usage period
forever, so `internalRollPeriods` re-selects them on every sweep and can never
advance them. Clearing them is hygiene, not a correctness fix.

`migrations:purgeUnmeteredCreditData` is **dry run by default**. Deleting
needs `{"apply":true,"retailerIds":[…]}`, naming the stores the dry run
reported, and a named id the run does not find unmetered **throws, rolling the
whole mutation back** — so a run is all-or-nothing.

Why naming, rather than trusting the unmetered check (PR #343 review): the
check protects the harmless direction of a mis-set `ADMIN_USER_IDS` (an admin
id missing) and **not the dangerous one**. A paying seller's id wrongly ADDED
makes their store unmetered, and a purge keyed on that same answer would
select it by the very same mistake. The dry run's store names are the real
safety net, so deleting is made to depend on having read them.

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
| admin's own store (unmetered) | "Kedaipal admin stores aren't metered…" | — |
| sponsored (comped, or no subscription row) | "Sponsored stores never run out, so there's nothing to top up…" | — |

A teammate reads the same reason addressed to them ("Ask the store owner to…")
and gets no button: every way out is a billing write, which is the owner's.
**A Kedaipal admin's own store** is its own refusal: it is unmetered
(z8r3fdp4er), so there is no balance a pack could add to — and the picker is
unreachable from the UI anyway, since the meter that opens it is hidden. **A sponsored store** (Zaki, 1 Oct 2026)
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

## The gate is PER ORDER (T3.1)

**ClickUp:** [`z8r3fdmg4h`](https://app.clickup.com/t/z8r3fdmg4h) · **Files:**
`convex/lib/credits.ts` (the pure arithmetic), `convex/creditLock.ts` (the
resolver, the guard, the read-path seams), `convex/lib/orderGate.ts` (the
redaction allowlist), `convex/creditLockCoverage.test.ts` (which writes gate,
which reads redact), `convex/orderGate.test.ts` (the sentinel sweep),
`src/hooks/useCreditGate.ts`, `src/components/orders/gated-order-page.tsx`,
`src/lib/bulk-skip-reasons.ts`.

**An order is workable once its OWN credit is paid for — and stays workable
forever after that.** Only orders that arrived while the balance was already at
or below zero WAIT, and they come off the queue oldest first as credits arrive.

This replaced the store-wide lock of T3, which was built, switched off
(`CREDIT_LOCK_ENABLED`, PR #336) and **never shipped to a seller**. Zaki's call,
2 Oct 2026: you charge a credit for an order; you don't then hold that order
hostage because a *later* one went unfunded. The switch and
`creditLockOff.test.ts` are gone with it — leaving a dead global flag beside a
per-order gate would be two rules for one idea.

### The mechanism: three numbers, no ledger walk

| Where | Field | Meaning |
| --- | --- | --- |
| `creditAccounts` | `debitSeq` | order debits this store has ever taken (monotonic) |
| `creditAccounts` | `fundedThrough` | the high-water mark of positions paid for — **only ever RISES** |
| `orders` | `creditSeq` | this order's position in that sequence |

An order is funded iff `creditSeq <= fundedThrough`, so **the inbox answers it
per row with no read at all** — the watermark rides the dashboard payload once
and the comparison is local. `debitSeq - fundedThrough` is how many orders are
waiting, so the meter's count is arithmetic too.

Both counters move in `applyEntry`, in the same patch as the balances, for
exactly the reason the balances are cached there: one write path, so the cache
can never disagree with the ledger.

- **On an order debit:** it claims the next `debitSeq`, which
  `debitCreditForOrder` stamps on the order. Funded iff the total AFTER the
  debit is **≥ 0** — a store on 1 credit takes an order, the debit leaves the
  total at 0, and that order *did* pay for its credit. (The ticket specified
  "at or below zero", which gates the order that spent the store's last credit.
  Off by one; corrected.)
- **On credits landing:** the watermark advances by `fundingAdvance(waiting,
  creditsIn)` = `min(...)` — **one credit in frees one waiting order**, oldest
  first. Every route does it by the same line: top-up, monthly refresh, invoice
  settle, upgrade, Enterprise contract, admin adjust, and a cancelled order's
  refund.
- **On anything negative** (an expired lot, an admin clawback): nothing moves.
  The watermark cannot fall, which is what makes "**expiry must not
  retroactively unfund an order already worked**" true by construction rather
  than by a check someone can delete.

**Why `min` and not "fill the balance back to zero first".** The two agree
exactly whenever the debt was created by waiting orders — a store at −101
buying a 100-pack opens the 100 oldest and keeps the 101st waiting, the rule as
specified. They diverge only where a store owes credits that no waiting order
created: a lot that expired under a negative plan balance, or the debt a store
was already carrying when this shipped. There, "fill the balance first" would
swallow a seller's whole pack and open nothing — money in, nothing happens, no
explanation on screen. One credit, one order is the rule a seller can predict,
and the debt still sits on the balance and still comes off the next refresh, so
nothing is given away.

**No backfill, and no retroactive gating.** An order with no `creditSeq` is
FUNDED — the gate fails open, like every other missing-data answer in this
file. So orders from before T3.1 are grandfathered, and so is an order whose
debit faulted (`recordOrderCreated` deliberately swallows a ledger fault so
checkout never fails): a bookkeeping fault must never be the thing that hides a
buyer's order from the seller.

### A gated order is INVISIBLE, not merely un-actionable

Zaki, 6 Oct 2026. Greying the buttons out leaves the buyer's name, phone and
address on screen, so a seller out of credits settles the order by hand in
WhatsApp and the gate collects nothing. **So the redaction lives on the server
READ PATH** — `convex/lib/orderGate.ts`, reached through `forSeller` /
`customerForSeller` / `orderGatedForSeller` — and the client never receives
what it isn't allowed to show. Hiding it in the UI would be theatre.

**An allowlist, not a denylist.** Redaction by deletion leaks every field added
afterwards, silently, and the thing it leaks is a phone number. So a gated row
is BUILT from the fields that are known safe:

- **kept:** `shortId`, `createdAt`/`updatedAt`, `status`, `channel`, `source`,
  the money (`subtotal`, `total`, `currency`, the fees), how it leaves
  (`deliveryMethod`, `fulfilmentDate`, the booking span), whether it's paid,
  and the mockup FLAG;
- **dropped:** the buyer (`customer`, `customerId`), the contents (`items`),
  `deliveryAddress`, every note, every storage id (payment proof, mockup,
  reference image), `paymentReference`, the courier fields, the gateway
  fields, and above all **`orders.trackingToken`** — the buyer's capability for
  `/track/`, with which the seller would simply open the buyer's own page and
  read everything.

Keeping the money and the date is deliberate: "3 orders waiting · RM 340 · one
due Friday" is both the honest state of the inbox and the strongest reason to
top up. A row that says nothing at all is just confusing, and confusion doesn't
sell credits.

**Redact-first, then filter.** `searchOrders` maps the whole scan window
through `forSeller` BEFORE the predicate, the facet tallies and the sort, so
the gate can't be enforced in one place and forgotten in another. Two
consequences fall out rather than needing rules of their own: **search can't
find a gated order by customer name or phone** (those fields are already
empty), while searching the ORDER NUMBER still finds it — which is right, since
the seller got that number in their new-order alert; and the category facet
counts a gated order as uncategorised, a fair description of an order whose
contents the seller can't see.

**Every seller read is covered**, and which ones is a test: `orders.get` (the
SELLER arm only — the buyer's `token` path is untouched), `searchOrders`,
`listByRetailer`, `exportPage` / `exportByIds` (a CSV of phone numbers is the
easiest manual-settlement route of all), `getTimeline`, `listPaymentProofs`,
`getItemImageUrls`, `getMockupUrls`, `getCustomerImageUrl`,
`notifications.latestActivity` (it carries the buyer's name on purpose), the
`.ics` calendar feed (every event's title IS the guest's name, and it goes to
Google — gated bookings are SKIPPED there rather than redacted, since an event
with no name and no listing is noise), and the whole customer surface.

**Customers.** A buyer whose EVERY order is gated is itself gated — the
customer page carries a phone number and a purchase history, which is the
loophole with extra steps. Answered in O(1) from `customers.firstOrderCreditSeq`,
stamped once on the insert: orders are debited in sequence, so a buyer's first
order carries their lowest position, and if even that is above the watermark
then all of theirs are. Stamped ONLY on the insert, so **one funded order makes
a buyer known for good** — the same "funded stays funded" promise. `list` and
`get` REDACT (the aggregates survive; the identity doesn't), `ordersByCustomer`
redacts per row, and **`search` FILTERS them out instead**: the search index
reads the stored `searchText`, which the redaction never touches, so a redacted
hit would still be a hit — type a phone number, get a row back, and the seller
has confirmed the buyer without ever seeing the record. That is an oracle, and
an oracle is a leak.

**The buyer's door is untouched.** `/track/<token>` and every public buyer
mutation key on `orders.trackingToken`, never on the seller's `shortId`, so a
buyer sees their order in full at any seller balance — pinned by the
storefront-parity test at +50 and −50. That test also caught `creditSeq` itself
leaking onto the public tracking payload: not a balance, but a running count of
every order the store has ever taken, on an unauthenticated read. Stripped.

**Two tests hold this up.** `orderGate.test.ts` seeds an order whose every
buyer-supplied field holds a sentinel, then serialises what each seller surface
returns and asserts not one sentinel survives — a WHOLE-PAYLOAD sweep, so it
catches a new field waved through the allowlist, a surface that forgot, and a
nested object nobody considered. `creditLockCoverage.test.ts` then requires
every public query in `orders` / `customers` to either redact or be excused
with a reason, so none can be forgotten as the app grows.

### NOTHING else is gated

Products, categories, insights and settings are paid for by the SUBSCRIPTION,
not by credits (Zaki, 6 Oct 2026). Gating the catalogue punishes work that
costs Kedaipal nothing, and the per-order gate already does the collecting. All
17 catalogue writes lost the guard, and `creditLockCoverage.test.ts` **fails if
one grows it back** — the previous release shipped the store-wide version, and
nothing but a test stops it returning.

It follows that there is **no store-wide credit refusal at all**:
`assertCreditsAvailable` is deleted, and the guard takes an ORDER
(`assertOrderCreditAvailable`; actions use `internal.creditLock.assertCreditsForOrder`,
which resolves a `shortId`). A guard that can't name an order can't be this
gate.

- **Gated** (server-enforced, per order): accepting and moving an order on
  (`updateStatus`, `advanceToStage`, approving a booking), marking payment
  received by hand, courier booking (Lalamove, Delyva), despatch labels
  (`awb.generateAwbPdf` — one order; the batch skips, below), the seller's
  receipt/invoice PDF, the payment reminder, rescheduling, setting a delivery
  charge, and mockup work.
- **Always open:** cancelling and refunding (booking decline, deposit
  settlement, courier cancel, clearing a gateway refund issue) — **a seller who
  can't SEE an order must always be able to release the buyer, and that is the
  mitigation the whole invisibility rule rests on**; the entire catalogue;
  pinning; settings; billing, top-up, plan changes, resume; the team; every
  buyer-side mutation; and **order intake on every channel**, each still using
  a credit, including below zero.
- **A BATCH skips and says so, never refuses.** With the gate per order a
  selection is routinely MIXED, so `bulkUpdateStatus` reports
  `skippedCreditGated` and the label batch reports `skipped.credit_gated`
  (rendered by `describeAwbSkips`). A batch that threw would be unusable the
  moment one order of forty was waiting — the store-wide lock's failure mode in
  miniature. Both are classified as the skip shape in the coverage test, which
  asserts the counter exists and that neither throws the gate refusal.
  **Returning the counter is only half of it** — the inbox shipped naming four
  of the five skip reasons, so a mixed batch toasted "Updated 1 · skipped 1"
  with no reason at all, the silent skip the house rule forbids. The phrases
  now live in `src/lib/bulk-skip-reasons.ts` as a `Record` over
  `keyof FunctionReturnType<typeof api.orders.bulkUpdateStatus>`, so a new
  `skipped*` counter is a COMPILE error until it has words. A test asserting
  today's reasons could not have caught the one that was missing.
- **The typed refusal** still carries the sentence and the way back
  (`CreditLockErrorData`, `kind: "credits_locked"` — unchanged, because that is
  the wire contract `format.ts` and every toast match on), plus
  `creditsToUnlock`: **this order's own position**, so a refused control says
  "waiting on 3 credits" rather than quoting the store's total.
- **Composing with the past-due lock:** unchanged, and still checked FIRST at
  every call site and in `useAreaLock`. It is the store-wide fact, it blocks the
  owner too, and a seller whose plan lapsed must not be told to buy credits.

**The way back** (`creditUnlockRoute`, by subscription status): active → top up
(or upgrade); trialing → pick a plan; past due → pay the invoice; on hold →
resume; cancelled → choose a plan. **Who can take it** (`creditLockAudience`):
the owner; a teammate holding **Credits write** when the way back is a top-up
(they buy a pack on HitPay's page themselves — T2); every other teammate is
told to ask the owner. One sentence (`creditLockMessage`) is the server's
refusal and every gate surface's copy.

### What the seller sees

- **The banner** (app shell, red, right after past due): "3 orders waiting on
  credits." + **Show the 3** (the filtered inbox) + the one button. A count the
  seller can't click through to is a fact they can't act on.
- **The inbox** carries a `creditGated` count, a **three-state chip leading the
  chip row** — ahead of even the seller's own pins, because it is the only chip
  about money we are owed; cycling all → only waiting → waiting hidden, exactly
  like the Pinned chip beside it so two look-alike controls behave alike — and
  per-row gated cards: a lock, "Waiting on credits" where the name was, and
  "Waiting on 2 credits — top up to open it" where the item list was, on a
  dashed border (waiting, not broken). The reference, the money and the time
  stay. `?creditGated=true` is a URL state, because the banner and the inbox
  note both LINK to it.
- **The order page** becomes `GatedOrderPage` — a screen of its own, not the
  normal page with its buttons greyed out. There is nothing left to grey out,
  and the normal page would render a grid of empty fields that reads as a bug.
  It shows the four surviving facts, names the order's position, offers the
  top-up, and keeps **Cancel and tell the buyer**.
- **The meter** gains the gated count beside the balance, linked to the
  filtered inbox. The two numbers are deliberately not the same: "15 orders
  owed" is the ledger's answer, "3 waiting on credits" is the one the seller can
  act on — a cancelled waiting order still owes its credit while nobody waits
  on it.
- **A cancelled gated order stays CLOSED — `orders.neverFunded`.** The refund
  below is a credit landing, so `applyEntry` walks the watermark one position;
  when the cancelled order held the oldest unfunded position the watermark
  passes its own `creditSeq`, every surface un-redacts it, and "cancel" becomes
  "reveal this buyer for free", repeatable. **A watermark cannot express "this
  position is spent but this order stays shut"** — not advancing only delays
  the reveal to the next credit, and skipping dead positions still moves the
  mark past them. So the gate is `neverFunded === true || creditSeq >
  fundedThrough`: the watermark advances (no dead position, the next LIVE order
  opens), and the stamp keeps the dead one shut. `customers.neverFunded` is the
  same stamp one table over, because `firstOrderCreditSeq` is a comparison
  against the same watermark and what it leaks is the phone number; it is
  CLEARED when the buyer orders again, so a returning buyer who is paid for
  becomes visible. Stamped for EVERY cancel cause, not just a seller's — the
  unpaid-order sweep refunds too, so without it a gated order revealed itself
  with no seller action at all. Found by driving Chrome, after the refund
  change below had already passed its unit and integration tests: the tests
  asserted the credit came back and never asked what the seller could now see.
- **Cancelling a GATED order always gives its credit back**, and never spends
  one of the month's 10 seller refunds (Zaki, 9 Oct 2026).
  `NEVER_ACCEPTED_STATUSES` (`pending`, `booking_requested`) is a PROXY for
  "the seller got something out of this order", and auto-confirm quietly
  invalidated it: `confirmedAtCreate` fires whenever the buyer left a phone
  and `WHATSAPP_ORDER_CONFIRM_TEMPLATE` is configured, which is every
  storefront order in production. So `pending` is nearly unreachable, every
  seller cancel read as "accepted", and once T3.1 made unfunded orders
  INVISIBLE the rule charged sellers a credit for an order they were never
  allowed to open — with cancelling, the gate's own prescribed way out, as the
  act that burned it. The rule now tests the GATE rather than widening the
  status set, because the question was never about status: a gated order
  delivers zero value by construction. Not exploitable — the only route to the
  refund is being denied the order first, and you end up with no order.
  **It also closes the dead-position bug on its own**: the refund runs through
  `applyEntry` with `+1`, so `fundingAdvance` walks the watermark past the
  freed position instead of leaving a hole for the next pack to pay past.
  Rejected on the way in: **charging the credit at PAYMENT instead of at
  creation**. `markPaymentReceived` is a seller mutation and manual bank
  transfer is the dominant flow, so it would mean charging when the seller
  clicks a button they control; and the mockup round-trip, COD and counter
  sales all do their work before payment, which would un-meter the made-to-
  order cohort that is the ICP.
- **The suite could not have caught this**, which is worth remembering: the
  convex-test env has no confirm template, so test orders are born `pending`
  — already in the one status the refund rule forgives. Any rule keyed on a
  status that production sets differently needs a test that sets it too.
- **The top-up picker** says what the pack OPENS (`opensLine`), and the thing
  that makes that hard is that the queue advances by POSITION while the count
  reports live orders. A cancelled order keeps the position its debit claimed
  — the watermark only moves from the oldest end, so there is no lifting one
  out of the middle — so a credit landing on a dead position opens nothing.
  With 4 live orders behind 2 cancelled ones the picker promised 4 and a
  4-pack opened 2. It now reads `waitingOffsets` (where each live order sits
  past the watermark, off the same bounded scan that already produced the
  count) and names the difference: "2 credits go to orders you cancelled."
  An unbroken queue is `[1, 2, 3, …]`, so the ordinary store's copy is
  unchanged word for word. It reads these off the balance, not the balance
  itself — a store can be below zero with nothing waiting.
- **The bulk bar** states what will be skipped BEFORE the tap
  (`bulkCreditSkipNote`), and the toast afterwards names it too
  (`bulkStatusToast`) — before the tap is where the decision is made, after it
  is where the seller learns which rows didn't move.
- **The gated order PAGE** is its own screen, with three states: waiting,
  waiting-and-you-can't-buy, and **cancelled**. The last one matters because
  the redaction is seq-keyed and survives the cancel by design, so the page has
  to know that `creditGated` no longer means "waiting" — it first shipped
  offering "Cancel and tell the buyer" on an order already cancelled. Its
  Fulfilment fact reads through `formatFulfilmentDateTime`, never
  `formatOrderTimestamp`: a fulfilment date is stored at MYT midnight with the
  time in a separate field, so a timestamp formatter prints "12:00 am" as if
  the buyer had asked for midnight.
- **The gated CUSTOMER row** says "Waiting on credits" where the name would be,
  on all three surfaces (`sellerCustomerName` — the list table, the mobile card
  and the detail page title, which also carries one line of why). The
  redaction blanks `name` AND `waPhone`, so `getDisplayName` falls through to
  `formatPhone("")` and returns an EMPTY STRING: the row shipped as a nameless
  line with a lifetime value beside it, which reads as corrupt data rather than
  a deliberate state. `customers.get` was also annotated
  `Promise<Doc<"customers"> & …>`, which silently dropped `creditGated` from
  the wire type — the client could not have told the two apart.
- **One author for the phrase** (`GATED_CELL_LABEL`): the CSV cell, the inbox
  chip and the customer name all read it, rather than three hand-typed copies
  drifting apart.
- **The BOOKING calendar blanks the guest, it never drops the row.** The grid,
  the day sheet, `blockImpact` and `closedDates.impact` read whole order rows
  off `bookingsOverlapping` rather than through the allowlist, so the
  redaction never reached them — and a booking REQUEST debits at request time
  while `holdsCapacity` keeps it on the calendar, so a request that lands at
  or below zero is born gated and sat there with the guest's name and the
  nights beside it. For a campsite that is the entire bypass: the guest turns
  up on the date and no phone number is needed. One helper now answers for all
  four (`guestNameForSeller`), and it BLANKS rather than skips, because these
  lists exist to stop a seller blocking or closing a date that already has
  someone on it — dropping the row would make the feature actively dangerous
  in the name of closing a leak. The night still counts; only the identity
  goes. `awb.readyToShipQueue` got the same treatment even though a gated
  order shouldn't reach "ready to ship", because "unreachable today" is the
  exact reasoning that left the calendar open.
- **There is no in-place note.** `CreditGateNote` sat under the app-shell
  banner on the inbox and on every order page repeating the same headline, the
  same explanation and the same two buttons about 40px lower — and on a FUNDED
  order's page it announced a restriction that order didn't have. The banner is
  the store-level message and carries the filter link; the rows, the bulk bar
  and the gated page carry the per-order one. One idea, one control.
- **The CSV** puts "Waiting on credits" in the **Customer cell** rather than
  gaining a column: a seller's bookkeeping template keys on column names, so
  the header set stays fixed (the `deliveryDirection` precedent). A line of
  blanks with no reason would be the silent gap the house rule forbids.

### Deliberately left alone

- **The seller's new-order WhatsApp and email alerts.** Both carry the buyer's
  NAME but no phone, no address and no items, so neither is the
  manual-settlement loophole — and they are the thing that sends the seller to
  look, where the row says what it is waiting for. Redacting the WA one means
  re-editing an approved Meta template for a name.
- **`orders.countActionable`.** Counts only, and a waiting order SHOULD be
  counted: the nav badge is what sends the seller to the inbox.

### Operator work (T3.1)

- **The three WhatsApp templates are still unsubmitted** — deliberately, since
  this ticket changed what they say. The exact body text to submit, en + ms, is
  in the block comment above `creditsLowTemplateName` in `convex/lib/whatsapp.ts`.
  Submit ONCE: re-editing an approved template re-triggers review.
- **No migration and no backfill.** The three fields are optional widens and
  absence reads as funded.
- **The release note** belongs to the staging→main release that ships this, not
  to the feature PR — `/prep-staging` writes it.

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
  month). A store that can't buy and holds no bought credits (sponsored, a
  trial) shows the one tile. An UNMETERED store shows no meter at all.

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

### The seller lock — SUPERSEDED by T3.1

Everything T3 shipped about *which writes lock* and *what the seller sees* was
replaced by the per-order gate — see
[**The gate is PER ORDER (T3.1)**](#the-gate-is-per-order-t31) above, which is
the live description. Kept here only as the trail of what changed and why:

- the lock was **store-wide** (projected total ≤ 0 froze every order and the
  whole catalogue). It is now **per order**, and the catalogue is never gated.
- it was **un-actionable, not invisible** — the buyer's name, phone and address
  stayed on screen behind greyed-out buttons, which is the manual-settlement
  loophole the invisibility rule exists to close.
- `assertCreditsAvailable` (store-wide) is gone; the guard takes an ORDER.
- it never reached a seller: `CREDIT_LOCK_ENABLED = false` parked it for one
  release (PR #336) rather than ship it.

What T3 built that **did** survive unchanged, and is still described below: the
meter, the running-low line (`lowCreditLine`, the last 20% of the month's
credits), the balance notices and their once-a-period dedupe, the expiry
heads-up, the exemptions (comped / admin-owned / missing-row fail-open), the
unlock routes and the audience rules, and the cancel outlook.

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
