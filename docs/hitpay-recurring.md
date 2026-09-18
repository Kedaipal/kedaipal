# Subscription auto-renewal + Pay-now — HitPay on Kedaipal's own account

**ClickUp:** [`86eyb6z4r`](https://app.clickup.com/t/86eyb6z4r) · **Status:** built; sandbox-verified end-to-end on MY (TnG) and SG (PayNow) — V2 event verification pending the endpoint secret
**Files:** `convex/lib/hitpayBilling.ts` (pure), `convex/subscriptionPayments.ts` (actions/queries), `convex/invoices.ts` (settle core + self-serve + renewal issuance), `convex/subscriptions.ts` (cron), `convex/http.ts` (webhook branches), `convex/billingEmail.ts` + `convex/lib/billingEmailCopy.ts` (emails), `src/components/settings/{billing-tab,auto-renewal-card,plan-picker-card}.tsx`, `src/routes/app.admin.billing.tsx`

## What it is

Sellers pay Kedaipal without a founder in the loop, on two rails that both
funnel into the ONE settle path (`settleInvoicePaid` — the exact code the
admin mark-paid flow uses, founding claim included):

1. **Pay-now** — every issued invoice mints a one-off HitPay payment request
   against **Kedaipal's own HitPay account**; the hosted-checkout URL is a
   green button in the billing tab and in the issue/reminder/overdue emails.
   The v1 completion webhook (or the seller landing back on the billing tab —
   `verifyInvoicePayment`, the lost-webhook safety net) settles it.
2. **Auto-renewal** — the seller authorises a **card or Touch 'n Go wallet
   once** (`save_payment_method=true` recurring-billing session); each renewal
   the daily cron issues is then charged merchant-initiated
   (`POST /v1/charge/recurring-billing/{id}`) for the **invoice total** —
   never a cached plan amount, so founding discounts and plan changes are
   always right.

Plus the piece the ticket assumed already existed and didn't: **the daily cron
now auto-issues renewal invoices** (`invoices.internalIssueRenewalInvoice`).
The old behaviour locked an active seller whose period lapsed with no pending
invoice (because Arif hadn't typed one); the machine now writes the bill
instead, and the seller keeps access through the invoice's normal 14-day
grace. The overdue flip at `dueDate` is still the only lock.

And **self-serve subscribe** (`invoices.subscribeSelf`): a trialing /
past-due / cancelled seller picks Starter or Pro, monthly or annual (framed
"2 months free"), gets an invoice + Pay-now button, pays, done. A store on
founding pricing automatically gets its founding price — and is offered
**Founding Pro only** (see "Founding Members stay on Founding Pro" below);
founding is never otherwise self-selectable — the last slots stay Arif's to
hand out via the admin console, and **manual admin issue/mark-paid is fully
retained** for bank-transfer holdouts.

## Why merchant-initiated charges, not HitPay's plan cycle

- HitPay's scheduled-plan mode bills a **fixed amount on its schedule** —
  wrong the moment a founding discount or plan change applies, and its
  currency support for plans is SGD-documented only.
- Merchant-initiated means **we own amount, timing, retries** — and the
  charge response is **synchronous** (`status: "succeeded"` / not), which is
  the primary success/failure signal because **HitPay ships no
  charge-failure webhook**.
- Structural safety: with no `autoRenew` on the sub, nothing ever charges —
  so "turn off auto-renewal" is guaranteed by local state alone, never
  blocked, never dependent on a remote DELETE succeeding.

## The no-double-charge invariant

A charge action can die between HitPay taking the money and us settling.
Defences, in order:

0. `recordChargeAttempt` is a **mutex, not a stamp**: it refuses the claim
   when an attempt is already in flight, so two schedulers (attach webhook +
   reconcile, or cron + heal) can never both POST. The loser stands down; the
   owner settles or records a failure either way. Without it the reconcile in
   (2) cannot save us — while charge A is in flight HitPay's `times_charged`
   has not moved, so charge B reads "remote not ahead" and charges anyway.
1. The winner stamps `lastChargeAttemptAt` + `pendingChargeInvoiceId` **before**
   the HTTP call, and **kills the invoice's Pay-now link** in the same breath —
   that window (seller on HitPay's page, our charge in flight) is the one place
   both rails could take money, and no spinner of ours reaches them there. A
   decline re-mints the link, because the failure email's whole CTA is "pay it
   yourself".
2. A later run seeing a fresh stamp with no recorded outcome **reconciles
   first**: `GET /recurring-billing/{id}` and compare `times_charged` to our
   `autoRenew.timesCharged`. Remote ahead ⇒ the money is real ⇒ settle with
   `recordedBy = reconciled:<session>:<n>`, never re-charge.
3. Network throws and HitPay 5xx are recorded as outcome **"unknown"** — not
   counted as an attempt, no seller email, retry ~24h later through the
   reconcile guard. Only a definitive decline (2xx-not-succeeded or 4xx)
   counts toward dunning.

## Dunning (Kedaipal-owned)

`AUTO_CHARGE_RETRY_DELAYS_MS` = attempt at period end, retry +2d, retry +5d
(3 attempts total — inside the 14-day invoice grace, sized for "TnG wallet
tops up on payday"). Each decline emails `autoRenewFailed` (Pay-now CTA;
the final one says retries stopped). The pending invoice + Pay-now link is
always the way out; the overdue lock at `dueDate` + its email are unchanged.
A settle **by any rail** (auto-charge, Pay-now, admin mark-paid) clears the
dunning state inside `settleInvoicePaid`.

**Charge-on-attach, and its two guards.** Attaching a method charges the open
bill immediately — that is what makes subscribe Netflix-shaped, and it heals a
mid-dunning store without waiting for tomorrow's cron. Two guards keep
"authorising IS the consent" literally true:

1. **First attach only.** `applyMethodAttached` runs for every attach signal —
   the webhook, its retries, AND the redirect reconcile — so charging on each
   one raced two charges onto the same bill.
2. **Only the bill the page showed.** `autoRenewSetup` records the invoice id
   and amount displayed when the session was minted; a bill that appeared,
   changed, or was reissued afterwards is NOT consented to and stays for the
   cron/Pay-now rail. A stale session is likewise re-minted rather than
   resumed when that context has moved.

**What attach does NOT charge**, by the same consent rule: a store's **first
invoice** from start-when-you-sell (`z8r3fday24`) — a bill the seller has not
seen is never charged unseen. Held subscriptions renew through this machine
too (`internalIssueRenewalInvoice` picks `kind: "hold"`), so the setup page and
the pre-charge notice quote the **hold** price while a store is paused, and a
hold bill the authorisation page displayed is charged on attach like any other.


**Pre-charge notice:** auto-renew sellers get `autoRenewUpcoming` once per
cycle in the 3-day window before `currentPeriodEnd` (amount + method + date +
how to turn it off) — the no-surprise-MIT rule card networks expect.
Deduped by `renewalNoticeSentForPeriodEnd`.

## Webhooks — one route, two schemes

`POST /webhook/hitpay` now discriminates on the **`Hitpay-Signature` header**:

| | V2 events (new) | v1 completion (existing) |
|---|---|---|
| Sender | Kedaipal's account, dashboard-registered | per-request `webhook` param |
| Body | JSON | form-encoded |
| Signature | HMAC-SHA256 over **raw body**, header `Hitpay-Signature` | HMAC over sorted `key+value` concat, `hmac` **field** |
| Salt | `HITPAY_BILLING_WEBHOOK_SALT` — the **endpoint's own** secret (env) | seller's stored salt (orders) / `HITPAY_BILLING_SALT` (invoices) |
| Events | `charge.created`, `recurring_billing.method_attached/detached/subscription_updated` | `status=completed` |

The v1 branch resolves **orders first** (`by_gateway_request` on orders),
then **invoices** (same-named index on invoices). Unknown ids still 200-ack.
Recurring `charge.created` is corroboration only (the sync response settles
first; duplicates no-op); attach/detach/status events maintain `autoRenew`.
Event payload parsing (`extractRecurringEvent`) is deliberately tolerant and
returns null → ack for anything unrecognised.

## Settle idempotency (`invoices.internalSettleFromGateway`)

- pending + amount & currency match → settle through `settleInvoicePaid`
  (founding rank claim runs **through the same path** — no fork; pinned by
  test).
- already paid by the same payment id → duplicate, plain no-op.
- paid another way / voided → **`late_payment`** stamp on
  `invoices.gatewayIssue` (admin console shows "possible double payment"),
  nothing else changes.
- amount/currency mismatch → **`amount_mismatch`** stamp, NO settle (a stale
  link paid after a reissue must not activate the wrong bill).
- Manual `markPaid` / `voidInvoice` on a link-carrying invoice schedules a
  best-effort DELETE of the HitPay request so the dead link stops taking
  money.

## Env vars (Convex deployment)

| Var | Meaning |
|---|---|
| `HITPAY_BILLING_API_KEY` | Kedaipal's own HitPay API key (sandbox `test_`-prefixed; mode inferred like the BYO path) |
| `HITPAY_BILLING_SALT` | The **API-key** salt — signs the per-request v1 completion webhooks |
| `HITPAY_BILLING_WEBHOOK_SALT` | The **registered endpoint's** signing secret — signs the dashboard V2 events. Optional: falls back to `HITPAY_BILLING_SALT`, but on a real account the two DIFFER, and without it every V2 event 401s |

**The first two, both or nothing.** Absent ⇒ every surface (Pay-now, auto-renewal, plan
picker) quietly stays hidden and manual billing renders byte-identical to
before — fail-open-to-manual. These are **deployment env**, never a table:
`billingConfig` is readable by every signed-in seller via
`paymentInstructions`, so a platform secret can't live there.

Also: the V2 events must be **registered in HitPay's dashboard** (Developers
→ Webhook Endpoints → `<CONVEX_SITE_URL>/webhook/hitpay`, select the four
recurring/charge events) — the signing secret shown for THAT endpoint is
`HITPAY_BILLING_WEBHOOK_SALT`, **not** the API-key salt (sandbox-proved).

## Currency + methods

- Session methods per billing currency (`AUTO_RENEW_METHODS`): MYR = `card`,
  `touch_n_go`; SGD = `card` (PayNow can't be tokenised). FPX/DuitNow are
  push-only and never appear.
- A 422 naming `payment_methods` retries with the param OMITTED, so the
  ACCOUNT's own tokenisable set decides (sandbox: a TnG-only account
  rejected `card`, and a card-only fallback would have been the one method
  it did not have).
- Renewal/self-serve invoice currency: last **paid** invoice's currency,
  falling back to `BILLING_CURRENCY_FOR_COUNTRY[retailer.country]`.
- `times_to_be_charged` is NEVER sent: a save-payment-method session
  rejects it outright ("You cant set times_to_be_charged for save_card is
  true", sandbox 11 Sep 2026). No charge-count ceiling exists on the
  tokenised path.

## Webhooks: TWO mechanisms, TWO secrets (sandbox-proved, 11 Sep 2026)

- **Per-request v1 completion webhooks** — we pass `webhook=<our URL>` when
  minting each invoice payment request, so they need **no dashboard setup** and
  are signed with the **API-key salt** (`HITPAY_BILLING_SALT`), field-concat
  HMAC. This is what settles Pay-now invoices.
- **Dashboard-registered V2 events** (`charge.created`,
  `recurring_billing.*`) — no per-session parameter exists, so registration in
  Developers → Webhook Endpoints is the only way to receive them. They are
  signed with **that endpoint's own secret** (`HITPAY_BILLING_WEBHOOK_SALT`),
  raw-body HMAC-SHA256 hex in `Hitpay-Signature`. Proved the hard way: a real
  `method_attached` verified against *neither* HMAC form of the API salt. The
  var falls back to the API salt when unset, and the rejection log says so.

**The real V2 payload is an ENVELOPE, not the docs' flat object:**

```json
{ "event": "recurring_billing.method_attached",
  "affected_method_id": "…",
  "recurring_billing": { "id": "…", "status": "active", "cycle": "save_card",
    "reference": "<our subscription id>",
    "payment_provider_charge_method": "touch_n_go",
    "default_method": { "payment_provider": "touch_n_go", … } } }
```

The billing id is NESTED and the authorised rail lives in
`payment_provider_charge_method` — the docs-derived reader found neither, which
is why an attach recorded the default "card" for a Touch 'n Go wallet.
`extractRecurringEvent` now reads the envelope first and keeps the flat shape
as a fallback; both forms are pinned by tests carrying verbatim captured
payloads.

**What registration buys** (money flows without it): the true method label, and
detach detection. Without it the redirect reconcile still attaches the method
but cannot see WHICH, and a method removed at HitPay's end is only discovered
when the next charge fails into normal dunning.

## Subscribe = auto-renewal by default (Zaki, 11 Sep 2026)

The plan picker's primary CTA is **"Subscribe to {plan}"** — invoice created,
then straight to HitPay's authorisation page; **attaching the method charges
the open bill immediately** (`applyMethodAttached` schedules the charge for
ANY pending invoice — the authorisation page displayed exactly that amount,
so authorising IS the consent) and every later renewal charges itself. The
Netflix shape: subscribing enrols you; cancelling is the explicit act. This
REVERSED the earlier don't-charge-self-serve-at-attach rule by owner decision.

Two things keep it honest for the Malaysian rails:

- **The manual rail survives implicitly, not as a second button.** The explicit
  "get an invoice instead" link was built and then removed the same day — ONE
  door. It still works for the DuitNow/bank seller who structurally cannot
  tokenise: the invoice is created BEFORE the redirect, so abandoning HitPay's
  page (or tapping Back) lands them on a pending invoice carrying both the
  Pay-now button and the bank/DuitNow details. The opt-in "Turn on
  auto-renewal" card remains for sellers who came in manually.
- The authorisation session shows **the open bill's total** when one exists
  (an annual subscribe shows the annual figure), else the current renewal
  price; `customer_name` carries the store name so HitPay's dashboard lists a
  real customer instead of "N/A".

Sandbox-verified API rules encoded the same day: a save-payment-method
session REJECTS `times_to_be_charged` (so no charge-count ceiling exists on
the tokenised path), and a 422 on `payment_methods` means the account lacks
(some of) our preferred rails — the retry omits the param and lets the
account's own tokenisable set decide.

## Changing tier mid-subscription — credit as DAYS (Zaki, 11 Sep 2026)

An active seller changes tier from Settings → Billing (`invoices.changePlan`).
The two directions are deliberately asymmetric, because what is fair differs:

| | Upgrade (higher tier) | Downgrade (lower tier) |
|---|---|---|
| When | Immediately, on payment | End of the period already paid for |
| Bill | An ORDINARY full-price invoice | None — the next renewal bills it |
| The remainder | Carried over as extra DAYS | Kept as-is: they keep the tier they bought |
| Reversible | Settle or void the invoice | `cancelPlanChange`, any time |

**Direction is decided by tier RANK (`isPlanUpgrade`), never by price.** A seller
on an annual Starter (RM790) moving to a monthly Pro (RM149) is unmistakably an
upgrade that a price comparison would have scheduled as a downgrade.

**An open invoice disables the UPGRADE, and the card names it.** `changePlan`
keeps the one-pending-invoice rule `subscribeSelf` already enforces — a second
bill on the table is how a seller ends up `past_due` on a tier they never got —
so the button is disabled with the invoice number rather than erroring on
confirm. Moving DOWN charges nothing, so it stays available throughout.

### Why credit-as-days, and not "charge the difference"

Charging a prorated difference was designed, reviewed and rejected. It breaks on
this product's own rails:

- **It is only sound if payment is instantaneous.** Priced at issue, a seller on
  the 14-day manual rail who pays twelve days later has been charged for days
  that already elapsed — and pinning their period to the old end date means a
  late-paid upgrade can buy **zero** days and trigger an instant re-bill.
- **A small top-up invoice inherits the service bill's lifecycle.** An unpaid
  RM35 add-on hits `dueDate`, flips the seller to `past_due`, and soft-locks a
  store that had fully paid for the period it is standing in — with no exit,
  since the picker hides behind `!pending` and `subscribeSelf` refuses a second
  pending invoice.
- It also needed an amount override, invoice-level proration metadata, a new
  origin literal, a PDF discount line, a sub-30-sen special case and an MRR fix.

Credit-as-days needs **one pure helper and one changed line in settle**. The
invoice stays an ordinary full-price bill, so the gateway amount check, the
saved-method consent guard, the PDF totals and the founder report's MRR all keep
working untouched, and no new money path exists to get wrong.

### The arithmetic (`planChangeCarryoverDays`)

```
valueLeft = fromPrice × daysLeft / fromCycleDays
carryover = valueLeft ÷ (toPrice / toCycleDays)
```

Day-rates, not a price ratio, so crossing cycles is right: RM26 left on a
monthly Starter buys 6 days of ANNUAL Pro but only 5 of monthly Pro, because a
year bought upfront is cheaper per day. Both prices are read at the seller's own
founding rate and currency, and the result rounds to whole days (flooring would
quietly shave up to a day of paid value).

**Say the conversion out loud, never just the answer.** The upgrade dialog
quotes all three numbers — days left, what they are worth, what that buys —
because "16 days carry over" beside a billing page promising another 30 reads as
14 days confiscated (Zaki, 13 Sep 2026, on a store that subscribed to Starter
and upgraded the same day). Nothing is confiscated: RM79 is RM79, and it buys 16
days of a plan costing RM4.97 a day rather than 30 of one costing RM2.63.
`planChangeCarryover` returns that breakdown and `planChangeCarryoverDays` is a
thin wrapper on it, so the number the copy quotes is by construction the number
settle grants.

**The settled invoice is corrected to match.** `insertPendingInvoice` can only
ESTIMATE the period it covers — 30 days from the ISSUE date — but the period is
granted from the moment the money lands and is stretched by any carryover, so
settle rewrites `periodStart`/`periodEnd` on the invoice it is flipping. Without
it the PDF receipt (the only surface that prints those two fields) said "Period:
13 Sep - 13 Oct" for a payment that bought service to 29 Oct, and on the 14-day
manual rail every late payment produced a receipt for days the seller never had.
The founder report is unaffected: `monthsInInvoicePeriod` reads `billingCycle`
and only measures the span for legacy rows that predate it. Historical invoices
are left alone — the estimate was the only truth available when they settled, so
there is no backfill.

**Applied at SETTLE, never at issue** — `daysLeft` must be the days genuinely
unused when the money lands. It applies to ANY invoice settled while a paid
period is still running, not just upgrades, so an early renewal no longer
forfeits its remainder either. A lapsed or missing period carries 0, so this can
never resurrect a period that had already run out.

### The scheduled half (`subscriptions.pendingPlanChange`)

`{ plan, requestedAt }` — no `billingCycle` on purpose: a cycle change is the
annual offer's void-and-reissue runbook, and a field that could express one would
eventually be set by a picker that defaults to monthly. The renewal cron reads
it, bills that plan, and **clears it** (leaving it set would re-apply the
downgrade to every future renewal). The pre-charge "renewing soon" email reads it
too, so the heads-up quotes the plan and price actually about to be charged
rather than the tier the seller is on their way out of.

Nothing about entitlement moves until the renewal settles: a downgrading seller
keeps their caps, their features and their data access for everything they paid
for. The confirm dialog names exactly what they lose and when — losing the
customer database by surprise is the kind of thing a seller discovers at the
worst moment — as a scannable list, because a nine-item comma run inside a
paragraph is not something anyone reads. It is bounded (`max-h-52`, its own
scroll) since `DialogContent` has no max-height and clips: unbounded, the
wrapped mobile case pushes the confirm buttons out of reach.

Both the dialog and the banner that replaces it quote **the amount**, not just
the tier: "Your next invoice is RM 79.00 for Starter, instead of RM 149.00". The
saving is the reason the seller is there, and the auto-renewal card sitting
beside the banner only ever names the DATE of the next charge.

### The renewing window

Between a period lapsing and its renewal settling, a seller is still `active`
with a `currentPeriodEnd` in the past — access stays on through the grace by
design. Rendered naively the plan pill read "Active · expires 29 Aug 2026" beside
"Next charge on 29 Aug 2026", both dates already gone (Zaki, 13 Sep 2026, on a
backdated test store). `isRenewing` (src/lib/subscription.ts) is the single
predicate for it: the pill says "Active · renewing" and the auto-renewal line
says the charge is happening rather than naming a date behind us. A declined
charge still outranks both — that message names the actual problem.

The window is at most a day in production, since the daily cron issues the
renewal on the next run. It is longer whenever the cron is delayed, which is
exactly when a stale date would be most misleading.

## Founding price — the 3-month lapse window (Zaki, 3 Sep 2026)

The 30% founding price survives a subscription lapse of up to **3 months**
(`FOUNDING_PRICE_LAPSE_MS`, lib/plans.ts); sit unpaid longer and the benefits
are **revoked for good** (see "Revocation" below — before z8r3fdfyw5 this was a
read-time window only, so paying later silently brought the discount back). The
**rank + badge never revert** — that is a promise in the signed agreement and in
the billing ribbon's own copy, and revocation deliberately does not touch them.
Only the *entitlements* are forfeited. One rule for every automated issuer, in
two shapes (lib/plans.ts):

- **`foundingPriceEligible`** — is this STORE on founding pricing? Tier-agnostic:
  it keys off `isFoundingMember` + the sub's `currentPeriodEnd`, and a claimed
  member's never-cleared `foundingIntent` flag deliberately cannot bypass the
  window (unclaimed intent = the first conversion, no lapse to measure, so it
  always qualifies). This is the answer for anything that prices MORE than one
  tier — the billing page's cards, a Starter → Pro carryover at settle.
- **`foundingPricingApplies`** — does a bill for `plan` get the founding price?
  Eligibility narrowed to the tiers that have one. Asked with the store's
  *current* plan it says "no" for a founding member on Starter — which is how
  settle once priced their move back up at list (z8r3fdfty4, below).

Cron renewals, `subscribeSelf`, `changePlan`, `switchPendingPlan`, the
auto-renewal setup display amount and the pre-charge notice all resolve it
identically. The **admin issue form keeps its explicit founding checkbox** —
Arif's judgment can override in either direction.

Never enforced silently: the founding ribbon states the condition (and stops
saying "locked in" once it has lapsed), and a lapsed member's plan picker
explains why prices read standard (`billingGatewayAvailable.foundingPricing` /
`foundingPricingLapsed` — every card must use the server-resolved flag, never
client-side `foundingIntent` or `isFoundingMember`, or a member would SEE one
price while being BILLED another).

### Revocation — membership is permanent, benefits are not (z8r3fdfyw5)

**The split that governs everything here.** A Founding Member has an **honour**
(rank, storefront badge, nav pill, their slot in the 10) and a set of
**benefits** (the 30% price, the Founding-Pro lock, white-glove onboarding). The
honour is permanent: Arif's signed agreement (`86exq9kz9`) promises "RM104/mo
for life" with no lapse clause, and this app's own billing ribbon has told
members since 3 Sep that "your rank and badge are permanent either way". Only
the benefits can be taken. **Never revoke by clearing `isFoundingMember`** —
that strips a badge we promised *and* drops through to the `foundingIntent`
fallback in `foundingPriceEligible`, granting founding pricing for ever.

**Data.** `foundingMembers.benefitsRevokedAt` / `benefitsRevokedReason`
(`lapsed` | `admin`) / `benefitsRevokedNote` is the audit record;
`retailers.foundingBenefitsRevokedAt` is the denormalized flag every
`foundingPriceEligible` caller reads off the retailer doc it already loaded
(zero extra reads, mirroring `isFoundingMember`). `benefitsRevokedAt` is a
**required** field on `FoundingEligibilityArgs`, so a new pricing path is a
compile error until it answers the question. The row is stamped, never deleted —
`getSpotsRemaining` counts rows, so **a revoked slot does not free up** and
re-granting is a deliberate admin act rather than a race for a freed spot.

**The pass** (`foundingMembers.internalRevokeLapsedBenefits`, scheduled by the
daily billing cron). It walks the `foundingMembers` ledger, not that cron's
subscription loops, and **that is load-bearing**: those loops cover `trialing`,
`active` and `on_hold`, while a lapsed member is `past_due` within ~14 days of
their period ending. A pass built on them would never fire for the exact
population it targets. The ledger is bounded at 10 for ever (the programme
closed 30 Aug 2026), so a full `collect()` is correct.

- **T-14:** `foundingBenefitsWarningDue` → one email
  (`foundingBenefitsEndingSoon`) + the ribbon's red state. Deduped by
  `benefitsWarningSentForPeriodEnd`, which stores the `currentPeriodEnd` the
  warning was about (the `renewalNoticeSentForPeriodEnd` idiom) — paying
  advances the period, so a later lapse warns again with no clearing logic.
- **T-0:** `foundingBenefitsRevocable` → revoke + `foundingBenefitsEnded` email.
  **Not gated on the warning** (Zaki, 18 Sep 2026): the rule is the rule, and 14
  daily runs sit between the two.
- **Never revoked:** `on_hold` (an Off-Season Hold is a PAYING store — its hold
  invoice advances the period, so the status guard and the paid-through guard
  both protect it, and both are tested), `active`, `comped`, and a member with
  no paid period at all (`paidThrough` undefined → fail toward the promise,
  exactly as `foundingPriceEligible` does).
- **Orphaned rows are skipped, counted and LISTED.** A founding row can outlive
  its retailer (a partially completed account purge — dev has a live example).
  Revoking one patches a deleted document, which throws; and since the pass is a
  single transaction, one bad row would abort the run so **nobody** is ever
  revoked. The loop skips them (`orphaned` in the return), `revokeBenefits` /
  `restoreBenefits` refuse rather than throw, and `listForAdmin` renders them as
  "Store deleted" — because the header counts ROWS, hiding them made the console
  read "2/10 claimed" above a single store and concealed the exact row the pass
  has to step around. Tidying the leftovers stays `accountDeletion`'s job.
- `foundingBenefitsEndAt` is the **one author** of the end date, and
  **`foundingBenefitsAtRisk` is the one author of whether a date is shown at
  all** — the revoke gate, the warning gate, the seller's ribbon and the admin
  list all ask it. Without that second author the two disagreed: the ribbon
  derived its countdown from paid-through alone and showed a red "your founding
  price ends on 29 Sept" alert to a store the pass SKIPS (found 19 Sep 2026
  testing an aged store). The realistic victim is a **comped** founding member —
  Kedaipal is giving them the product while the page threatens to take their
  discount on a date that can never arrive. Whatever surface shows the date must
  gate on the same predicate the cron acts on; pinned both in `plans.test.ts`
  and against the real queries in `foundingMembers.test.ts`. `foundingBenefitsRevocable` is
  the **exact complement** of `foundingPriceEligible` (eligible while
  `now <= endAt`, revocable while `now > endAt`), pinned by an hour-by-hour
  invariant test across the boundary — a day where both said "yes" would revoke
  a member the billing page was still quoting the discount to.

**The plan lock opens for free.** `foundingPlanLocked` keys off
`foundingPriceEligible`, so a revoked seller regains the Starter/Pro choice with
no extra code. Pinned by a test, because it is an acceptance criterion.

**Surfaces.** The billing ribbon is ONE control with **four** tones — amber
("locked in"), red (T-14, naming the date), muted (ended, and never "renew to
keep your founding price", which would be a lie), and a **pending** state that
exists because its absence was one: the retailer doc resolves before
`billingGatewayAvailable`, so every flag read `false` and the ribbon told a
revoked member their discount was "locked in" on every page load (~310ms
measured on localhost, longer on mobile data). The rank is true in every state
so the title still renders; only the CLAIM waits for the server. The admin issue
form derives its founding toggle from the same server answer rather than copying
it into state — an effect keyed on the selection alone left the checkbox and
Amount showing the founding discount under copy that said "standard price". The plan picker's lapsed note
splits the same way. White-glove (`foundingMembers.myStatus.benefitsRevoked`)
stops being offered, since it is a benefit. **The storefront badge and nav pill
are untouched, by design.** Admin → Billing → Founding members shows each
member's benefit state, the end date, whether they were warned, and a
revoke/restore lever (`adminSetBenefits`) — the escape hatch for a wrong
revocation or a deliberate re-grant; a restore also clears the warning stamp so
a future lapse warns again.

**The window: 90 days, confirmed by Arif on 19 Sep 2026** (z8r3fdfyw5). It had
come from a verbal call (Zaki, 3 Sep 2026) and lived only in
`FOUNDING_PRICE_LAPSE_MS` and this file, with no ticket carrying it — worth
recording, because the signed agreement (86exq9kz9) still reads "RM104/mo for
life" with no lapse clause, so these two lines remain the only written statement
of the rule the code enforces. If the agreement is ever revised, revise it to
match this.

**Notice to the cohort.** The condition has been stated in-product since 3 Sep —
the founding ribbon says the price "stays yours as long as your subscription
doesn't lapse for more than 3 months" — and from this ticket a member also gets
an email plus a red banner 14 days before anything is taken. Whether Arif also
wants a direct message to the three unpaid members ahead of the first revocation
(lekor-mr-ganu, 28 Oct 2026) is a GTM call, not a code gap.

**Known edge, deliberately not built.** Comping a member through their own lapse
and later un-comping them leaves a stale `currentPeriodEnd`, so the pass could
revoke them the next day. No founding member is comped today; the admin restore
lever is the remedy if it ever happens.

## Founding Members stay on Founding Pro (Zaki, 17 Sep 2026)

A store on founding pricing has **one tier: Founding Pro** (`FOUNDING_PLAN`).
It can move between **monthly and yearly** on that tier (RM104 / RM1,040,
S$41 / S$410), and it can **stop renewing** (turn auto-renewal off) — it
cannot change tier — not down to Starter, and not back to list Pro, which
costs more for the same features. That holds until Scale launches; whether a
founding member may then move to Scale is Arif's call. Once the subscription
lapses past the 3-month window the founding price is revoked, and from then on
the store is an ordinary seller who can pick any plan.

- **Server:** `foundingPlanLocked(plan, eligible)` is refused by
  `subscribeSelf`, `changePlan` (both directions, before anything is scheduled
  or billed) and `switchPendingPlan` (before the void, so a refused switch
  leaves the bill intact), with one message that names what they CAN do.
- **Billing page:** the plan picker shows a single "Founding Pro" card with the
  monthly/yearly toggle; the change-plan slot reads "Your plan stays Founding
  Pro" with the price and the lapse clause instead of offering a move; the
  first-invoice "Switch to Starter" is not offered; the current-plan card says
  "Founding Pro"; the annual card never describes moving up or down a tier to
  them ("You stay on Founding Pro for the whole year, at your founding price",
  both on the offer and once they're on annual); and the auto-renewal turn-off
  dialog states the lapse clause.
- **Downgrades scheduled before the lock are cancelled** (Zaki, 17 Sep 2026).
  `renewalQuote` ignores a `pendingPlanChange` the lock forbids, so the renewal
  bills Founding Pro and `internalIssueRenewalInvoice` clears the stale flag as
  it writes the bill; the change card never shows it as a move that will land.
  No backfill: the rule cancels them wherever they are read.
- **Deliberately left alone:** the Off-Season Hold card is unchanged for
  founding members (the credits model removes holds for everyone on 14 Oct). A
  founding member already sitting on Starter (from before the lock, if any)
  renews on Starter and is offered only "Move up to Founding Pro" — the lock
  never raises a bill without the seller's own tap.

## Every billing-page price is server-resolved (z8r3fdfty4, 17 Sep 2026)

Reported by Arif: a founding member's billing tab quoted **RM149** where they
pay **RM104** (S$59 vs S$41). Two defects stacked:

1. **Admin act-as read the wrong store.** `invoices.myInvoices` and
   `subscriptionPayments.billingGatewayAvailable` resolved the CALLER — inside
   act-as, the admin's own store — so the tab showed the seller's plan priced
   at the admin's founding status and currency, above the admin's invoices.
   Both now take an optional `retailerId` (owner-or-admin via
   `requireRetailerAccess`); the tab passes it only while acting-as.
   **Billing is view-only under act-as** (Zaki, 17 Sep 2026): it is the
   seller's money and consent, and every legitimate admin billing action
   (issue, void, mark paid, comp) already lives in Admin → Billing. A banner
   at the top of the tab says so; every billing control renders disabled with
   a one-line reason — subscribe, auto-renewal on/off, plan change and its
   undo, the first-invoice switch, the Off-Season Hold switch, the annual
   request, "Pay online now", "I've paid — notify us" and the manual "Message
   us". Server-side, the self-serve writes resolve the caller's own store, and
   `setSeasonalHold` — the one billing write that accepted `retailerId` —
   now refuses `actingAsAdmin`. Every other settings tab keeps act-as edits.
2. **The page decided "founding?" three ways.** The picker used the server
   flag; the plan-change card used `sub.foundingIntent` (missing every
   admin-marked member); the annual card used the raw rank flag (ignoring the
   lapse window); the first-invoice switch read the open invoice's discount
   (which a Starter bill never has). All four now take
   `billingGatewayAvailable.foundingPricing`, and cards whose price is
   founding-sensitive wait for that read instead of flashing list.

**One number everywhere.** `renewalQuote` (lib/plans.ts) is the single author
of what the next renewal bills — tier (a scheduled downgrade lands with it),
cycle, founding, currency (`renewalCurrency`: last PAID invoice, else the
country) and amount (the hold price for a paused store). The cron's renewal
invoice, the pre-charge email, HitPay's authorisation page (which used to show
the MONTHLY price in the COUNTRY currency — wrong for annual and SGD-billed
stores) and the billing page (`billingGatewayAvailable.nextRenewal`) all read
it; `subscriptionPayments.test.ts` pins that all four agree across founding
MY/SG, annual, SGD-billed MY, lapsed, scheduled-downgrade and hold stores. The
auto-renewal card now states the amount in every state ("Next charge of
RM104.00 on …", the off-state pitch, an unfinished setup, the declined-charge
line).

**Found on the way:** settle priced a Starter → Pro carryover with
`foundingPricingApplies({ plan: sub.plan })` — "no" for a founding member on
Starter — so the remainder bought 5 days of list Pro while the page (and the
invoice) said 8 at the founding rate. Settle now uses `foundingPriceEligible`.

At go-live this needs nothing: the current founding cohort is active (inside
the window) so they keep renewing at their price automatically; everyone else
already bills at list.

## Invariants preserved

- **`subscriptions.updatedAt` is the past_due flip moment** (founder report).
  Every new patch (`autoRenew` state, notice stamps, session records) leaves
  it alone; only real status transitions touch it. Pinned by test.
- `markPaid` semantics unchanged (existing suite passes untouched).
- Buyer-gateway code paths (seller BYO) byte-identical.
- Storefront/order pipeline never touched by any of this.

## Sandbox verification checklist (before prod)

1. Set sandbox `HITPAY_BILLING_API_KEY`/`_SALT` on dev, register the webhook
   in the sandbox dashboard.
2. Billing tab → plan picker → invoice → **Pay now** → sandbox checkout →
   invoice flips paid (webhook), receipt email lands.
3. **Turn on auto-renewal** → authorise a test card → attach recorded
   (webhook or return reconcile) → confirmation email.
4. `npx convex run subscriptionPayments:chargeDueRenewal '{"invoiceId":"…"}'`
   against a seeded pending renewal → settles.
5. ✅ DONE (11 Sep 2026) — the `method_attached` payload was captured from
   live sandbox traffic and `extractRecurringEvent` rewritten against it (an
   envelope, not the docs' flat object). `times_to_be_charged` is rejected
   outright in save-card mode. A verbatim enveloped `charge.created` is still
   unseen — the parser handles both shapes, and the sync response settles
   first, so this is corroboration rather than a money path.
6. Production: Arif's open HitPay support thread must confirm **TnG
   tokenisation cross-border for MY customers + MYR on the tokenised charge
   path** on the live SG account (86eyb6z2d question set). Card rail works
   regardless.
