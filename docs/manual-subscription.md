# Manual Subscription Billing (v1)

ClickUp [`86expn2qg`](https://app.clickup.com/t/86expn2qg). Manual invoicing for the
Founding 10 — no Stripe/HitPay. Admin issues a pending invoice, the retailer pays
out-of-band (DuitNow / bank), the admin flips "paid", and entitlement + Founding
rank-claim happen atomically. Built behind a typed `PaymentProvider` seam so the
future automated-billing integration touches only the adapter.

**Status:** All phases shipped (1–4) + the **admin Issue-invoice flow**. Since
[`86eyb6z4r`](./hitpay-recurring.md) this manual flow is the **fallback rail**,
not the whole system: renewal invoices are cron-issued, every invoice carries a
HitPay **Pay-now** link, sellers can **self-serve subscribe** and opt into
**auto-renewal** (tokenised card / Touch 'n Go). The admin issue + mark-paid
flow documented here is fully retained for founding onboards and bank-transfer
holdouts — see [`hitpay-recurring.md`](./hitpay-recurring.md) for the
automated layer.

## How invoices appear (the operational loop)

A pending invoice is created in two ways:
1. **Admin issues one** — `/app/admin/billing` → **Invoices** tab → `invoices.issueInvoice`
   (pick retailer, plan, cycle, **founding** toggle, due date defaulting to +14d;
   amount auto-derived from `lib/plans`). This is the path for trial **conversions**
   and **renewals**, and for onboarding a **Founding-10** member (founding toggle =
   30% Pro discount). Guards: rejects Scale (the v1 defense-in-depth home),
   founding-non-Pro, and a duplicate pending per retailer.
2. **Founding-intent signup** — `createRetailer({ intent: "founding" })` reserves the
   rank + flags `foundingIntent`, but issues **no** auto-invoice (Arif issues it).

**⚠️ A founding signup does NOT start the paid Pro plan (set 2026-06-23).** The PAID
Pro subscription begins **only when Arif marks the founding invoice paid** (`markPaid`
→ `status: "active"` + fresh period). Until then the founding member rides the **same
14-day trial as everyone else** — `status: "trialing"` — and if that trial lapses
before they pay, they're soft-locked exactly like any other unpaid trial. We never
pre-activate Pro at onboard (that would be free service before money lands).

**⚠️ Founding is EXPLICIT + RESERVED AT ONBOARD (changed 2026-06-23, supersedes the
ticket-literal "claims on first paid Pro invoice").** Reserving a slot (rank assigned,
`retailers.isFoundingMember`/`foundingMemberRank` set, badge live, counter ticks down)
is SEPARATE from starting the paid plan — it happens at the moment founding is
*designated*, while the paid plan waits for payment:
- **Onboard** with the Founding toggle → `reserveFoundingRank` runs at **signup**
  (so Arif can't over-commit past 10, and the badge shows from day one), but the sub
  stays `trialing` until the founding invoice is paid.
- **Promote** a standard vendor → a **founding invoice** (founding toggle on →
  `foundingDiscount` set). Reserved when that invoice is **marked paid** (or at
  signup if they were onboarded founding).

A **plain Pro invoice never claims a rank** — founding must be deliberate. The
`founding` toggle still controls the 30% discount; the issue form auto-applies it
for `isFoundingMember || foundingIntent`. `paidAt`/`firstInvoiceId` on the
`foundingMembers` row fill in when the first founding invoice is paid.

**Nav pill (`TierPill`, sidebar + mobile header + settings card).** A founding
member's status chip reads **"Founding #N"** (± trial/past-due state), which on
its own hides their actual tier — so the pill renders a **second neutral tier
chip** (Starter/Pro/Scale) beside it, both wrapped in one link to Settings →
Billing. Non-founding sellers keep the single tier chip (their status pill *is*
the tier); an admin's own store still shows only the "Admin" chip (→ console).
The pair wraps as a unit and inherits the header's smaller text so it stays neat
on mobile. Chip labels come from the exported `PLAN_LABEL`.

### Email notifications (capped, escalating — no spam)

Sellers won't always be in the dashboard, so deadlines don't sit silent. The hard
rule: **at most 3 emails per paid cycle, 2 per trial**, each fired **once**. A
prompt payer gets just the one "issued" email. Invoice creation + mark-paid stay
**manual** (Arif) — these are notifications only, NOT auto-renewal.

**Paid vendor, per manually-issued invoice (≤3):**
1. **Issued** — `issueInvoice` schedules `notifyInvoiceIssued` (amount + founding
   discount, due date, how-to-pay).
2. **Reminder** — daily cron, once, `[due − 3d, due)`, deduped by `invoices.reminderSentAt`.
3. **Past due / locked** — when the cron flips the sub to `past_due` over the unpaid
   invoice it schedules `notifyInvoiceOverdue` ("storefront stays live, pay to resume
   editing"). Once, on the status transition.

**Free-period vendor (≤2, start-when-you-sell — see below):**
1. **Free period ends in 3 days** — daily cron, once, deduped by
   `subscriptions.trialReminderSentAt` (`notifyTrialEmail "trialEndingSoon"`): "your
   first invoice arrives then, or sooner with your first order — nothing to do".
2. **First invoice** — the moment the free period ends, by first order
   (`firstInvoiceOrder`, "your first order is in 🎉") or by the day-14 backstop
   (`firstInvoiceBackstop`, "your free period has ended"). Both are ordinary invoice
   emails (amount, due date, Pay-now, how-to-pay) with the framing changed. From
   there the vendor is on the paid-vendor ladder above (reminder, overdue). The old
   `trialEnded` lock notice is gone — nothing locks at the end of a free period.
2. **Trial ended / locked** — on the trialing→past_due flip (`notifyTrialEmail "trialEnded"`).

**On payment (positive, not dunning):** `markPaid` schedules `notifyPaymentReceived` — a
**welcome** email on the retailer's first-ever paid invoice, a **thanks** on every renewal
after (`renderPaymentEmail`, same logo'd shell, no how-to-pay). Separate from the dunning cap.

All **fire-and-forget** (errors swallowed/logged), **localized** (en/ms). Invoice
copy + trial copy in `convex/lib/billingEmailCopy.ts` (`renderBillingEmail` /
`renderTrialEmail`), sent via Resend (`RESEND_API_KEY` / `EMAIL_FROM`). Email links
use `SITE_URL` (the seller's own dashboard origin), not `APP_URL`. A WhatsApp ping is
the planned follow-up once a Meta template + the central send gateway land (Sprint 4).

**Single pending invoice invariant:** a retailer has **at most one** pending invoice
ever — `issueInvoice` rejects a second (serializable read-then-insert); the only other
insert path is the one-time founding-signup invoice on a brand-new retailer.

**Branding + preview.** All retailer emails carry the Kedaipal logo header
(`emailCopy.logoHeader` / `LOGO_URL` → the prod public asset, since email clients
can't load localhost). Invoice emails use the richer card layout (`wrapBillingHtml`);
order/trial emails use the simple shell (`wrapHtml`). To preview any template in a
real inbox without DB surgery:
```
npx convex run billingEmail:sendSampleBillingEmail '{"to":"you@email.com","key":"invoiceIssued"}'
```
Keys: `invoiceIssued` · `invoiceReminder` · `invoiceOverdue` · `trialEndingSoon` ·
`trialEnded`. Add `"locale":"ms"` or `"founding":true` for those variants.

**Voiding (issued in error).** `invoices.voidInvoice` (admin, pending-only) soft-cancels
an invoice — status → `void`, kept for audit (stamps `voidedBy`/`voidedAt`/`voidReason`),
**never hard-deleted** (audit trail + vendor history + reconciliation). It frees the
single-pending slot so a corrected invoice can be issued, and does **not** touch
subscription status. A paid invoice can't be voided (that's a refund — out of scope).
The vendor's billing history shows it as "Cancelled". Admin "Void" button + confirm in
the pending list.

Admin UI is **tabbed** (`app.admin.billing.tsx`): **Invoices** (onboard-a-client +
issue form + pending list + mark-paid/void, the frequent task) and **Payment details**
(set-once bank/QR). Tests: `convex/invoices.test.ts` (issueInvoice
standard/founding/Starter/guards), `src/lib/onboarding-link.test.ts` (invite link).

## Onboarding a client by hand (admin "Onboard a client")

A retailer is owned **1:1 by the client's own Clerk login** — staff can't create a
store *for* a client without an orphaned, un-loginable row. So the admin doesn't
create the store directly; instead the **Invoices** tab has an **Onboard a client**
card that produces a **prefilled onboarding link**:

1. Admin fills store name (slug auto-derives, with **live availability** so a taken
   slug never ships in a link), optional WhatsApp number, optional client email
   (just the "send it to" contact — not encoded).
2. Admin copies the link (`<origin>/onboarding?p=<token>` — the store/slug/WhatsApp
   prefill is packed into one URL-safe base64url token by `src/lib/onboarding-link.ts`,
   so it survives the Clerk auth redirect intact; separate query params get mangled)
   and sends it via WhatsApp/email.
3. The client opens it → **signs up** for a new account. Because `via=admin`,
   `onboarding.tsx` routes signed-out invitees to sign-**up**, not sign-in — a new
   client has no account to sign into yet (routing them to sign-in dead-ends with
   "couldn't find account"). The prefill survives account creation because the
   invite URL is handed to Clerk as the post-signup redirect, and the `/sign-up`
   route uses `fallbackRedirectUrl` (not a hard `forceRedirectUrl`) so that redirect
   wins → onboarding shows an "**Kedaipal set this up for you**" banner with the
   fields prefilled (incl. a WhatsApp field, only shown in `via=admin` mode) → taps
   **Create store**. The store is created under **their** account.
4. The store now appears in the Issue-invoice picker → admin issues their invoice
   (Founding toggle for the first 10 Pro members).

**Why a link, not direct creation:** ownership stays correct with zero new failure
modes (no orphaned stores, no claim/email-matching edge cases). The client's only
step is creating their own account. `via=admin` / `founding` is **not** a privileged
URL arg
— the store is created on the normal trial path; the Founding **rank** still only
claims via admin mark-paid, so a hand-crafted link grants nothing.

## Core model

- **Subscription** (one per retailer, created in-transaction by `createRetailer`).
  `plan` ∈ `starter | pro | scale`; `status` ∈ `trialing | active | past_due |
  cancelled | on_hold` (`on_hold` = Off-Season Hold, below). Entitlement **caps are
  denormalized** onto the row (`orderCap`, `userCap`, `broadcastQuota`) —
  feature-gating reads the caps, **never the `plan` field**, so the seam stays clean
  for automated billing. A held row's EFFECTIVE `orderCap` is 0, resolved by
  `resolveAccess` and never stored.
- **Invoice** (per period). `kind` ∈ `plan` (default) | `hold`; `origin` ∈ `admin |
  self_serve | auto_renewal | free_period_end`. `dueDate` drives the `→ past_due`
  overdue cron — for EVERY status, including a trial's first invoice.
- **Founding member** ledger — atomic rank claim (1..10), Pro-only at v1.

### Two invariants everything rests on

1. **Fail safe.** A retailer with **no** subscription row resolves to **comped
   full access** (logged), never locked — so a backfill miss degrades to "works",
   not "locked out". (`resolveAccess(null)` in `convex/subscriptions.ts`.)
2. **Pressure on the seller, never the buyer.** The storefront + order pipeline are
   public and **never call the subscription guard** — they stay live regardless of
   status. Soft-lock (`past_due`) freezes **only** the seller's dashboard
   growth-writes.

## Start-when-you-sell + Off-Season Hold (Sep 2026, ClickUp `z8r3fday24`)

The 30 Aug 2026 pricing reset's three backend moves, built on the auto-renewal
engine (`86eyb6z4r`): Scale RM399/S$149 (still Coming soon — nobody was repriced),
the additional-outlet add-on at S$18, Pro 200 / Scale 400 order allowances
(`migrations.resyncSubscriptionCaps` re-syncs existing rows), and the two
mechanisms below. Decisions: Zaki, 9 Sep 2026.

### Start-when-you-sell — "free until you sell"

A new store is **free until its first live order, or day 15, whichever comes
first**. Not a trial with a deadline: the order is the trigger, the day-14
`trialEndsAt` is only the backstop.

- **Trigger.** `subscriptions.endFreePeriodOnFirstOrder` is called from the ONE
  order-created seam every channel funnels through (`subscriptionUsage.
  recordOrderCreated` — storefront, counter, claim link, booking), so "first
  live order" means the first order, full stop (counter sales count; a seller's
  own test order counts too — it opens a 14-day due window, voidable by Arif).
  It stamps `freePeriodEndedAt` + `freePeriodEndReason: "first_order"` and
  schedules the first invoice. **A stamp plus a scheduled job, never a gate** —
  the narrow, documented exception to "the pipeline never reads subscription
  status"; nothing in it can refuse or fail the order. Skips comped rows and
  stores owned by a Kedaipal admin (identity-blind, `ADMIN_USER_IDS`).
- **Backstop.** The daily cron ends the free period at `trialEndsAt` the same way
  (`freePeriodEndReason: "backstop"`) — it no longer locks.
- **The first invoice** (`invoices.internalIssueFirstInvoice`, origin
  `free_period_end`) bills **the trialed tier — Pro** (every trial showcases
  Pro; Zaki, 9 Sep: "default to Pro, still switchable before paying"), monthly,
  in the store's country currency, at the founding price when the store was
  promised one (`foundingPricingApplies`). Never auto-charged, even with a
  saved method — a first bill the seller hasn't seen is exactly the surprise
  debit `86eyb6z4r` refuses. Idempotent: refuses when any pending/paid invoice
  exists, so trigger and cron can both call it.
- **Switch before paying.** `invoices.switchPendingPlan({ plan })` voids the
  machine-issued invoice (Pay-now link killed) and reissues at the other tier
  with the **same due date**, so switching can never extend the grace. Refuses
  admin-issued invoices (Arif may have priced one by hand) and hold invoices.
  Surfaced inside the pending-invoice card, with the consequence: paying a
  Starter invoice moves the store to Starter (no CRM / inbox / insights).
- **The invoice's `dueDate` is the only lock.** The trialing branch of the cron
  now mirrors the active branch: pending + not due → grace; pending + overdue →
  `past_due` + `invoiceOverdue`; no invoice on file (voided, failed) → the
  machine writes it again rather than locking (to give a store free service,
  comp it — don't void). Paying it settles through the ordinary path → `active`.
- **Surfaces.** Pill: "Free · until first order" → "Free · N days left" (last 5
  days) → "First invoice due". Banner: ends-in-N-days (dismissable) → "your
  first order is in / free period ended — invoice ready, due in N days"
  (dismissable, keyed by due date) → the ordinary invoice-due-soon → overdue.
  Billing tab: status chip, a one-line explainer while free, the first-invoice
  card with the switch. Dashboard checklist: "Start your plan" → "Pay your first
  invoice". The self-serve picker stays for a free store that would rather
  start today, prefaced with "no rush".

### Off-Season Hold — pause between seasons for RM19 / S$9

A **subscription status (`on_hold`), never a Plan** (`HOLD_MONTHLY_PRICES` in
`lib/plans.ts`; the `Plan` union, `PLANS` and the feature matrix are untouched).
`plan` keeps the tier the seller resumes to.

- **What pauses:** new orders. `retailers.orderingPausedAt` is set on entry and
  cleared on resume — a **store setting**, denormalized on purpose, so the
  buyer-facing payload (`orderingPaused`) and every order-create path
  (`orders.create`, counter `startAnonymousSession` / `bindSessionManualPhone` /
  `createOrderFromSession`, `orderClaims.sendClaim`, `bookings.requestBooking`)
  refuse on the seller's own switch — like opening hours — and the pipeline
  still never reads billing status. The storefront shows a "seasonal break"
  note under the header on every buyer route, every ordering CTA reads
  "Ordering paused" (disabled-with-reason), checkout renders the note instead
  of the form, and the cart is kept for the reopening. Server refusal was a
  deliberate deviation from the copy pack's "UI-level only": a stale tab must
  not place an order the seller said they can't fulfil.
- **What stays live:** storefront, catalog, buyer list, order history, and
  editing (`frozen` stays false; the tier's features stay on).
- **Entry** (`subscriptions.setSeasonalHold({ hold: true })`, owner or admin
  act-as, audited): from `active` or `past_due` only — never a free store (a
  store that isn't selling simply doesn't convert) or a comped row. A pending
  PLAN invoice is voided ("rather pause than pay"). **Billing:** paid through a
  future date by the plan → nothing now, the cron issues the hold invoice at
  `currentPeriodEnd`; otherwise (period over, or a bill just voided) the hold
  invoice issues at once (`internalIssueRenewalInvoice({ force: true })`,
  origin `self_serve`, kind `hold`). Email `holdStarted` restates the deal.
- **While held:** the cron's active loop also walks `on_hold` rows;
  `internalIssueRenewalInvoice` picks `kind: "hold"` (flat price, no founding
  discount, monthly, `plan` = the resume tier). A hold invoice auto-charges
  when a method is attached (the seller chose the price by tapping Pause);
  overdue → `past_due` like any other. **Settle** of a hold invoice keeps the
  row `on_hold`, rolls the period and stamps `periodPaidBy: "hold"`.
- **Resume** (`{ hold: false }`): from `on_hold`, or from a lock over an unpaid
  HOLD invoice (that bill is voided; a lock over an unpaid PLAN invoice is not
  a hold to resume from — settle it). Status → `active` on the kept tier,
  ordering reopens. **Billing:** a running period bought by the plan owes
  nothing; a period bought by a hold (or none) issues the tier invoice at once
  — **unused hold days are forfeited**, stated in the card and the confirm
  before the tap. Email `holdResumed`.
- **Surfaces.** Settings → Billing card (every real paid seller sees it —
  discoverable where billing lives; four states: offer / pause-instead /
  resume / hold-overdue), status chip "On hold · since …", pill "On hold", a
  persistent calm banner with a Resume link, the cap meter hidden (cap 0 is
  not "0 / 0"), admin console "Off-Season Hold" pill on hold invoices, the
  founder report counts `onHold` separately from churn.

Pure rules: `convex/lib/seasonalHold.ts` (`canEnterHold`, `canResumeHold`,
`holdBillsNow`, `resumeBillsNow`, the buyer message). Tests:
`convex/startWhenYouSell.test.ts`, `convex/seasonalHold.test.ts`,
`src/components/storefront/seasonal-break.test.tsx`, plus additions to
`plans.test.ts`, `migrations.test.ts`, `billingEmailCopy.test.ts`,
`invoices.test.ts`, `subscription.test.ts`, `billing-tab.test.tsx`.

**Prod rollout:** the schema is widen-only (a status literal + optional
fields). After the deploy run `npx convex run migrations:resyncSubscriptionCaps
--prod` once — until it runs, existing rows still read "N of 500". No env vars,
no crons, no Meta templates.

## Locking (when the cron flips to `past_due`)

The daily cron locks a vendor on any of:
1. **Invoice overdue** — a pending invoice past its `dueDate`, for `trialing`
   (the first invoice), `active` and `on_hold` alike. This is the ONLY lock.
2. ~~Trial lapsed~~ — retired with start-when-you-sell: the backstop ISSUES the
   first invoice (no status change); see above.
3. ~~Period lapsed, no invoice~~ — retired with `86eyb6z4r`: the cron issues the
   renewal (or the hold renewal) and the seller rides its grace.

A pending invoice with a *future* due date always keeps them in grace. Comped subs
never lock (a comped trial that runs out its backstop still takes the legacy
`past_due` flip, which for a comped row locks nothing). Each transition fires its
one email (`notifyInvoiceOverdue`).

## Issuing — system-set due date, cycle starts at payment

The admin does **not** pick a due date. `issueInvoice` sets it to **issue + 14 days**
(pay-by deadline). The **billed plan + cycle live on the invoice** (`invoices.plan` /
`billingCycle`), NOT the subscription — so issuing a Pro invoice to a Starter seller
does **not** change their visible tier until they pay; `markPaid` reconciles the sub
from the invoice. Voiding therefore leaves the tier untouched. The actual paid
**billing cycle** (`currentPeriodStart/End`) is set at **mark-paid** — so Pro only
starts once payment lands, never at issue time. Founding members
auto-get their lifetime discount: the issue form detects `isFoundingMember` and force-applies
(and locks) the founding toggle, so Arif can't accidentally bill them full price on a renewal.

## Annual billing — the in-app offer (Sep 2026)

Annual is **10 months charged, 12 received** (`ANNUAL_MONTHS_CHARGED`), framed to
sellers as **"2 months free"** and never as a percentage. Every annual number on
every surface comes from **`annualQuote(plan, founding, currency)`** in
`convex/lib/plans.ts` — `annualTotal` *is* `planPrice(plan, "annual", …)`, pinned
by a test, because the two used to disagree (see `docs/pricing.md`).

**Why annual is sold here and not on `/pricing`.** Manual billing has no
self-serve checkout, so a public annual price is a dead-end CTA — the standing
reason `SHOW_ANNUAL_TOGGLE` stays `false`. But a *year* is a single bank
transfer, which is exactly what these rails already do well: one annual seller
costs one billing event a year instead of twelve. So the offer lives in the
seller's own **Settings → Billing**, as a prefilled WhatsApp message like every
other billing action in that tab.

### Who is offered it (`src/lib/annual-billing.ts`)

`resolveAnnualOffer` is a pure ladder, first match wins. The **order is
load-bearing** and each rung is a unit test:

| # | Condition | State |
| --- | --- | --- |
| 1 | Admin on their own store | `hidden` |
| 2 | No subscription row | `hidden` |
| 3 | `comped` | `hidden` |
| 4 | A **pending invoice already `annual`** | `pendingAnnual` |
| 5 | `subscription.billingCycle === "annual"` | `onAnnual` |
| 6 | Plan not in `ANNUAL_OFFER_PLANS` (**Pro only**) | `hidden` |
| 7 | `status !== "active"` | `hidden` |
| 8 | Fewer than `ANNUAL_MIN_PAID_INVOICES` (**2**) paid invoices | `hidden` |
| 9 | Pending monthly invoice due in `< ANNUAL_SWAP_MIN_DAYS` (**4**) | `switchDeferred` |
| 10 | Pending monthly invoice | `switchInstead` |
| 11 | — | `offer` |

Three of those rungs exist because of a specific failure:

- **Rung 4 before everything.** `issueInvoice` deliberately never touches the
  subscription, so a seller who accepted yesterday still reads
  `billingCycle: "monthly"` for the whole 14-day window. Without this rung the
  card keeps selling what they just bought, they ask again, and `issueInvoice`
  throws *"already has a pending invoice"* at the admin.
- **Rung 5 before the plan gate.** A seller already billed annually is told so on
  **any** plan. Hiding a true fact about their own billing because their tier is
  off-list is a lie by omission.
- **Rung 6 is Pro only.** Starter is excluded by owner decision (a year upfront
  contradicts start-when-you-sell). **Scale is excluded because `issueInvoice`
  throws on it** — offering it would reproduce in-app the dead-end CTA we refuse
  to ship publicly. Add `"scale"` in the same change that makes Scale
  purchasable (`z8r3fday24`). A Starter seller is still *told* annual exists, and
  *why not on Starter*, in the Starter → Pro nudge.

Currency comes from the seller's **own most recent paid invoice**, never visitor
geo — they have already told us what we bill them in, and a VPN must not
re-price a subscription. Founding members are quoted `annualQuote(plan, true, …)`,
i.e. 10 × their discounted rate.

### The swap runbook (rung 9/10)

An open invoice is the **best** moment to sell a year, not a blocker: nothing has
been collected, so switching costs the seller nothing. `issueInvoice` refuses a
second pending invoice, so the swap is **void-then-reissue**:

1. The seller messages from the card. The prefilled text carries the invoice
   number and their own words *"I haven't paid it yet"*.
2. **Confirm in chat that nothing has been transferred** before voiding.
3. Void the monthly invoice, then issue the annual one (founding toggle ticked
   if their message says *"at my Founding Member rate"*).

**Why the 4-day floor.** Voiding leaves a window with no pending invoice, and the
daily cron flips an active seller to `past_due` — soft-locking their dashboard —
both when a pending invoice passes its due date **and when the period lapses with
nothing pending**. Close to the due date the swap could therefore lock the
account of the seller most willing to pay us. Inside four days the card degrades
to `switchDeferred`, states the reason, and asks them to pay the current invoice
as normal.

If a swap cannot be completed before the due date, tell the seller to pay the
monthly invoice and switch at the next renewal.

### Credit, not refund

There is **no proration anywhere in the codebase** and no credit-balance field.
The card states, above the CTA: a year already paid isn't refunded in cash; if
they change plan or stop part-way, the unused months are credited to the new plan
or the next invoice. That is deliberately scoped to something a human can honour
by hand at the next issue — it never quantifies, because any arithmetic would
imply a calculation the system cannot perform.

### Known gaps this offer depends on

- **The annual renewal chase does not exist.** `internalDailyBillingStatus` logs
  a `console.info` three days before `currentPeriodEnd` — no email, no admin
  surface. For a once-a-year four-figure renewal that log line is the entire
  mechanism, and a missed one silently soft-locks the seller. The `onAnnual` card
  therefore states the period end as a **fact** and deliberately promises no
  reminder. Ship a 30-day annual renewal notice before this matters.
- **No atomic swap.** Void-then-issue is two mutations with a gap between them.
  An `invoices.switchInvoiceToAnnual` (needing `issueInvoiceInner` extracted so
  the single-pending guard can be bypassed for exactly one path) would close it.
- The admin issue form previews the **amount** and now the **coverage**, but the
  invoice PDF still prints a period computed at *issue* time while entitlement
  runs from *mark-paid* — on a year-long commitment the paper can be off by up to
  the 14-day grace.

### Superseded by 86eyb6z4r (auto-sub era) — read the above with these deltas

The offer card itself stays valid (it targets **active** monthly sellers, whom
`subscribeSelf` deliberately refuses — mid-cycle changes remain a human
conversation). But three premises above changed when HitPay recurring landed:

- **`SHOW_ANNUAL_TOGGLE` is now `true`.** The "no self-serve checkout" reason is
  gone: a public annual price leads to the in-app plan picker → invoice →
  Pay-now link, a real checkout. The badge reads "2 months free", per the rule.
- **Trialing / past_due / cancelled sellers self-serve annual directly** through
  the plan picker (`invoices.subscribeSelf`) — the WhatsApp prefill is no longer
  their only route. Currency there derives from the store's country / last paid
  invoice, same posture as above.
- **"The annual renewal chase does not exist" is stale.** The daily cron now
  auto-issues every renewal (annual included) with an email + Pay-now link, and
  auto-charges a saved method; the `console.info` is no longer the mechanism.
  The 30-day advance notice for four-figure annual charges is still worth
  shipping — auto-renew sellers get a 3-day pre-charge notice today.


## Deferred / known gaps (manual-sub era — revisit for auto-sub)

- **No cancellation flow.** The `cancelled` status exists but nothing reaches it; a churning
  vendor just stops paying and sits at `past_due` (auto-renewal itself is always cancellable —
  that kills the *charge*, not the subscription). A real "cancel my subscription" flow is
  still an open follow-up.
- ~~No self-serve plan picker~~ — **closed by 86eyb6z4r**: with the payment gateway
  configured, trial-ended / lapsed / cancelled vendors pick a plan + cycle in the billing tab
  (`invoices.subscribeSelf`) and pay the invoice online. Without gateway credentials the old
  "message Arif on WhatsApp" card renders unchanged.
- ~~Renewals typed by hand~~ — **closed by 86eyb6z4r**: the daily cron issues renewal
  invoices (`invoices.internalIssueRenewalInvoice`); the old lapse-lock branch is gone (the
  overdue flip at `dueDate` is still the lock).

## Soft-lock (`past_due`)

`assertSubscriptionActive(ctx, retailerId)` throws `ConvexError` when the
subscription is `past_due` **and not comped** — **unless the caller is a
Kedaipal admin** (`isAdmin(ctx)`, the `ADMIN_USER_IDS` allowlist), who is never
soft-locked on any store (their own, dogfooded free forever, or a seller's
during act-as; see [`admin-console.md`](./admin-console.md)). Wired onto seller
**growth-writes** only: product create/update/`saveVariantGrid`,
`updateSettings`, `renameSlug`, `pickupLocations`
create/update/setActive/reorder (the last two added Jul 2026 — they'd escaped
the original sweep), future broadcast/reminder. Explicitly **NOT** wired onto:
`orders.create` (public), order pipeline (confirm/pack/ship/deliver/
payment-claim/mockup), customer views, storefront. **Order cap is SOFT** — a
nudge in the dashboard, never a block on `orders.create`;
`userCap`/`broadcastQuota` are hard (seller-side surfaces).

## Plan-feature gating (Pro+) — CRM + Order Inbox (Jul 2026)

The pricing table's **live** ✓/– feature rows are now enforced, not just
advertised. Catalog: `PLAN_FEATURES`/`featuresForPlan` in `convex/lib/plans.ts`
(Starter: no `crm`, `orderInbox` or `chargeablePickup`; Pro/Scale: all). `resolveAccess` resolves
them onto `AccessState.features` — **the only place `plan` is read for
gating**; every check reads the resolved descriptor, so per-retailer overrides
stay possible later. Fail-safe: a missing subscription row resolves to Pro
features (never a lockout). Trial = Pro plan = full features (the trial
showcases Pro).

- **Server gate:** `assertPlanFeature(ctx, retailerId, feature)` in
  `convex/subscriptions.ts`. **Admin act-as bypasses** (support work on a
  Starter store), mirroring the soft-lock.
- **CRM (`crm`):** every public surface in `convex/customers.ts` (list/count/
  get/ordersByCustomer/search/updateNotes/updateName) — gated in the shared
  auth helpers. The **internal linking helpers are NOT gated**: orders keep
  aggregating for Starter sellers so the data is complete the day they upgrade.
- **Order Inbox (`orderInbox`):** `searchOrders` rejects **inbox-only args**
  (bucket ≠ `all`, search text, payment/method/date/fulfilment-window/mockup
  filters) but the **plain list with default args stays all-tier** — that's the
  "Order pipeline" row. Also gated: `bulkUpdateStatus` and CSV export
  (`exportOrders` via `assertExportAccess`). Single `updateStatus` + order
  detail stay open to every tier.
- **Chargeable pickup (`chargeablePickup`):** *setting* a non-zero fee on a
  pickup location (`pickupLocations.create`/`update`) is Pro+; **clearing a fee
  is un-gated** (a downgraded seller can always make a point free again), and a
  fee already frozen on an order displays on every tier. See
  [`fulfilment.md`](./fulfilment.md#chargeable-pickup-location--flat-per-location-fee-2026-07-07-clickup-86ey5tywf).
- **UI (client mirror, `hasFeature` in `src/lib/subscription.ts` — fail-open;
  the server is the real lock):** `/app/customers` (+ detail) render a
  `ProFeatureWall` (what it does + WhatsApp "Upgrade to Pro" + billing link);
  the orders page hides search/chips/filters/bulk/export behind a
  `ProFeatureTease` strip while the list keeps working; nav (sidebar +
  bottom-nav) marks Customers with a **Pro chip** so the wall is never a
  surprise; the dashboard Customers stat tile renders a locked variant.
  Components in `src/components/app/pro-gate.tsx`.

## Order-usage meter + soft-cap nudge (Jul 2026)

The promised "X/100 orders used" surface behind the SOFT `orderCap`:

- **`subscriptionUsage` table** — per-retailer × **MYT calendar month**
  (`monthStart` via `convex/lib/usagePeriod.ts`) denormalized counter. Calendar
  month, not the billing period: caps are "orders/mo" while billing cycles can
  be annual (and trials have no period). Incremented at both order-create
  sites (`orders.create`, counter checkout); decremented on the **first**
  transition into `cancelled` (keyed to the order's creation month, floored at
  zero, same idempotency guard as the stock restore). Helpers in
  `convex/subscriptionUsage.ts`. **Never read to block an order.**
- **Read path:** `buildRetailerPublic` embeds `ordersThisMonth` (owner/admin
  payload only). Pre-meter orders were never counted — the meter starts at 0
  on deploy, which is fine for a monthly counter.
- **Nudge:** `SubscriptionBanner` gains two amber states (below every payment
  state in precedence): **≥80%** of cap → dismissable-for-the-month warning;
  **≥100%** → persistent "you've passed your plan's orders — upgrade" (still
  never blocks). Billing tab shows an "Orders this month X/cap" progress
  meter. Pure logic `orderCapState` in `src/lib/subscription.ts`. Comped subs
  and `UNLIMITED` caps never nudge.

Tests: `convex/planGating.test.ts` (gates, bypasses, meter, soft-lock),
`convex/lib/usagePeriod.test.ts`, plus additions to `plans.test.ts`,
`subscriptions.test.ts`, `counterCheckout.test.ts`,
`src/lib/subscription.test.ts`.

## Signup paths (`createRetailer`)

Every signup starts the same **free period** (`status: trialing`, `plan: pro`,
`trialEndsAt = now + 14d` as the backstop, Pro-level caps) — free until the first
live order or day 15, see "Start-when-you-sell" above. The admin onboard-a-client
form has a **"Founding Member"** toggle (gated on spots remaining). When set, the
invite link carries `founding: true` → onboarding passes `intent: "founding"` →
the same free period + `foundingIntent: true` and a **reserved rank** (badge live).
The founding discount then applies automatically to whichever invoice ends the free
period (first order or backstop) or to one Arif issues; the paid cycle is confirmed
at settle.

> **Verified 9 Sep 2026 (z8r3fday24 audit):** `intent: "founding"` is still an
> unprivileged public arg on `createRetailer` — anyone can pass it and, while
> spots remain, reserve a rank + `foundingIntent` (and with `subscribeSelf` /
> the first invoice, self-bill at the founding price). Founding pricing was
> retired for NEW signups on 30 Aug, so the remaining slots should be Arif's to
> hand out only. Closing the public arg breaks the admin invite link's toggle
> (the link token isn't signed), so the fix — designate founding via the
> admin issue form's checkbox only — is a decision for Arif, not smuggled here.

- **Public** (default / `intent: "public"`): the free period. Tier chosen at
  conversion — the first invoice bills Pro, switchable to Starter before paying.
- **Founding** (`intent: "founding"`): `status: active` (NO trial), `currentPeriodEnd =
  now + 14d` (pay-by window, not free), `foundingIntent: true`, reserved rank, Pro caps,
  **no invoice**. They set up their store; pay the founding invoice (RM104, monthly/annual) to
  confirm the cycle. Unpaid within the window → lapse/overdue lock.

## Admin auth

Env allowlist, **not** a Clerk role (`convex/lib/auth.ts`). `requireAdmin(ctx)`
checks `identity.subject` against `ADMIN_USER_IDS` (comma-separated Clerk subs).
Fails closed when unset. Server check mandatory; client hiding cosmetic.
**Dev setup:** `npx convex env set ADMIN_USER_IDS <your-clerk-sub>`.

## Support WhatsApp number (`SUPPORT_WA_PHONE`) — ClickUp `86eyjuvyu`

Every **seller→Kedaipal** CTA — billing support, Starter→Pro upgrade, "I've
paid", choose/renew plan, the past-due and sending-paused banners, the Pro
feature wall, the white-glove call, the first-order testimonial, and the
landing/pricing/cost founding CTAs — opens a `wa.me` chat on **one** number,
served by the public query **`contact.supportWhatsapp`**.

**It is deliberately NOT `WHATSAPP_CHECKOUT_PHONE`.** That env var is the shared
WABA sender that talks to *buyers*; a seller messaging it reaches the order bot,
not a human. Until Aug 2026 the billing CTAs read it (via
`billing.paymentInstructions.whatsappPhone`) and every one of them pointed at
the wrong number — that field is now gone, and `paymentInstructions` carries
bank/DuitNow/QR details only.

**To change the number** (no deploy, takes effect on the next query):

```bash
npx convex env set SUPPORT_WA_PHONE "018-473 5095"
```

- Any Malaysian spelling is accepted (`018…`, `18…`, `+60 18-473 5095`) and
  normalized to the wa.me form by `resolveSupportWaNumber`
  (`convex/lib/contact.ts`).
- A value that isn't a MY mobile is **rejected, logged, and ignored** in favour
  of `DEFAULT_SUPPORT_WA_NUMBER` — a typo must never leave a seller with a dead
  link. Check the Convex logs for `SUPPORT_WA_PHONE is not a valid…` after
  setting it.
- Unset ⇒ the same default, so a deployment that never sets it still works.
- The query is **unauthenticated** (landing/pricing render to signed-out
  visitors) and the number is public by nature — it's printed on those pages.

**When the number changes for good, also update `DEFAULT_SUPPORT_WA_NUMBER`** in
the next PR: SSR and the first client paint use the constant until the query
resolves, so server-rendered HTML would otherwise carry the old number for a
few hundred ms. The env var is the instant lever; the constant is the
deploy-time floor.

## Pricing / caps — single source of truth

`convex/lib/plans.ts`. Starter RM79 / Pro RM149 / Scale **RM399** (S$29 / S$59 /
S$149; the 30 Aug 2026 reset, `z8r3fday24`); founding Pro RM104 (Scale RM279,
unreachable at launch — founding is retired for new signups, existing members keep
theirs); Off-Season Hold **RM19 / S$9** (`HOLD_MONTHLY_PRICES`); additional outlet
RM49 / S$18. Caps: Starter 100/1/0, Pro **200**/2/100, Scale **400**/5/500 — the
allowances `/pricing` advertises, all finite since Arif's 2026-06-28 decision
dropped Scale's "unlimited" (kept an upsell ceiling for a future Enterprise tier). The
`UNLIMITED`/`isUnlimited` sentinel stays exported for that future tier but no v1
plan uses it. Scale is **not selectable** at v1 (`isPlanSelectable`) and grants
**no** Founding badge (`planQualifiesForFounding`, Arif's 2026-05-28 decision).

> **Scale = flat multi-outlet tier (ClickUp 86eyb9zwt, supersedes 86ey4gaju).**
> The public pricing surface shows Scale as the **multi-outlet / high-volume** tier
> at **RM399/mo flat** (no bands, no metering; the reseller band table was removed
> after the 1 Jul ICP audit). Scale stays "Coming soon" — not purchasable — until
> the separate Scale build (multi-outlet management, outlet counting, RM49/mo
> additional-outlet billing) ships. See [`pricing.md`](./pricing.md).

> **Order allowances now match the page (ClickUp 86eye2ccu, landed via z8r3fday24).**
> `/pricing` advertised **Starter 100 / Pro 200 / Scale 400** ahead of enforcement
> (Arif, 9 Aug 2026) while `PLAN_CAPS` read Pro 500 / Scale 2,000 — the denominator
> the billing-tab meter renders. The constants moved with the pricing reset;
> `migrations.resyncSubscriptionCaps` re-syncs the denormalized caps on existing
> rows (idempotent, `updatedAt` untouched). Still open from `86eye2ccu`: the admin
> per-store allowance override and the surfaced-not-billed overage copy. See
> [`pricing.md`](./pricing.md).

## SGD invoices — billing a Singapore seller (Aug 2026)

The first Singapore customer is invoiced in **SGD** through the same manual loop.
Everything downstream of issue (`markPaid`, void, reminders, the cron, history)
was already currency-agnostic — the work was the issue path and the pay surfaces:

- **Price table:** `PLAN_MONTHLY_PRICES` in `convex/lib/plans.ts` is an exhaustive
  `Record<BillingCurrency, Record<Plan, number>>` — MYR (unchanged) + SGD
  **S$29 / S$59 / S$119** monthly (from the Aug 2026 SG pricing deck). Annual keeps
  the same 10-months-charged rule. `planPrice` takes an optional trailing
  `currency` (default `"MYR"`, so legacy call sites are byte-identical).
- **Founding works in SGD too** (owner call, 19 Aug 2026): `FOUNDING_MONTHLY_PRICES`
  holds a per-currency table — MYR RM104/RM209 (unchanged), SGD **S$41 / S$83**,
  both derived by the same ~30%-off-rounded-down-to-a-whole-unit rule
  (S$59 × 0.7 = S$41.30 → S$41). Rank claiming on `markPaid` is currency-agnostic.
- **Issue:** `issueInvoice` takes an optional `currency` (`"MYR" | "SGD"`, default
  MYR) — a segmented control on the admin issue form; the founding checkbox works
  in either currency.
- **No payment block on non-MYR invoices.** The `billingConfig` rails (MY bank +
  DuitNow) can only settle MYR, so a cross-border invoice deliberately shows
  **amount only** everywhere — PDF (no "Payment instructions" card; footer says
  "We'll confirm payment details with you on WhatsApp — quote INV-… as your
  payment reference"), the invoice emails (same line replaces the pay panel,
  en/ms/zh, via `BillingEmailVars.crossBorder`), and the seller billing tab (the
  "How to pay" section shows the contact line instead of bank/DuitNow/QR; the
  "I've paid — notify us" WhatsApp CTA stays). The seller pays however was agreed
  over WhatsApp; the admin `markPaid` flow is unchanged.
- The trigger for suppression is `invoice.currency !== "MYR"` — derived, not a
  flag, so it can't drift from the amount it protects.
- **Admin console:** the Outstanding stat tile sums **per currency** ("RM X +
  S$ Y") since one flattened number across currencies would be a lie; pending
  rows/history always rendered `invoice.currency`.
- The invoice PDF's "From" block now names the legal entity — **Kedaipal Pte Ltd,
  UEN 202630712C** (the operating entity is Singaporean; applies to all invoices)
  — and the PDF money formatter maps SGD → `S$`.
- Preview: `npx convex run billingEmail:sendSampleBillingEmail
  '{"to":"you@email.com","key":"invoiceIssued","currency":"SGD"}'`.
- **Not built (deliberate):** SGD on the public pricing page, PayNow/SG-bank
  fields on `billingConfig`, SG phone (+65) / address support, HitPay buyer
  payments in SGD — this slice is subscription invoicing only.

## `PaymentProvider` seam

`convex/payments/provider.ts`. Entitlement/rank logic consumes a normalized
`PaymentRecord`, never raw provider data. v1 = `ManualAdminProvider`
(`recordPayment` is pure — the caller owns the transaction). When Stripe/HitPay
land, a new adapter produces the same `PaymentRecord` and `markPaid`'s downstream
doesn't change.

## ⚠️ Production rollout sequence (must not lock users)

1. **Deploy schema** (3 new tables + optional retailer flags — additive, validates
   against existing data; new retailers get subscriptions from here on).
2. **Run the backfill** `internalMutation` (Phase 2): drop every pre-existing
   retailer onto a fresh **14-day Pro trial** (`trialing`, non-comped). They are
   **not** free forever — the trial banner shows and the daily cron soft-locks them
   to `past_due` when it lapses, exactly like a new signup. (The backfill is
   convergent: a leftover `comped` row from an earlier run is healed into the same
   trial; real subscriptions are left untouched.)
3. **THEN enable gating** (Phase 2 wires `assertSubscriptionActive`).

Until step 2, existing retailers have no subscription row → `resolveAccess` fails
open to comped full access, so they keep working between steps regardless. The
`comped` state is now reserved for that **missing-row fail-safe only** — the
backfill no longer mints comped subscriptions.

## Phasing

- **Phase 1 (done):** schema (`subscriptions`/`invoices`/`foundingMembers` +
  retailer flags), `lib/plans.ts`, `lib/auth.ts` (`requireAdmin`),
  `payments/provider.ts` seam, `subscriptions.ts` (`current` query, `resolveAccess`
  /`getAccess`/`assertSubscriptionActive` fail-safe guard), `createRetailer`
  two-path wiring + `getMyRetailer` carrying the subscription summary. Tests:
  `convex/lib/plans.test.ts`, `convex/subscriptions.test.ts`.
- **Phase 2 (done):** `invoices.ts` — `markPaid` (atomic: invoice→paid → reconcile
  → caps refreshed → `claimRankIfEligible` → schedule welcome WhatsApp), `listPending`
  (admin), `myInvoices`. `foundingMembers.ts` — `claimRankIfEligible` (Pro-only,
  no-prior-row, cohort ≤ 10, atomic in-txn) + `getSpotsRemaining`. Backfill
  `subscriptions.internalBackfillSubscriptions` (drops pre-billing retailers onto a
  14-day trial, non-comped; convergent/idempotent — heals leftover comped rows).
  Crons
  `subscriptions.internalDailyBillingStatus` (trial expiry + active-overdue flips +
  renewal log) wired in `crons.ts`. Soft-lock wired onto `products.create/update/
  saveVariantGrid` + `updateSettings`. Founding welcome WhatsApp
  `whatsapp.notifyFoundingWelcome` (sends to the seller, stamps `welcomedAt`).
  Tests: `convex/invoices.test.ts` (markPaid happy/reject/comped/no-double/cohort-cap,
  backfill, cron flips, gating blocks growth-writes while the storefront + orders
  stay live).
  **Before prod:** run `internalBackfillSubscriptions` after the schema deploy,
  before relying on gating (existing retailers fail-open until then).
- **Phase 3 (mostly done):** `subscriptions.paymentInstructions` query (env-sourced
  bank/DuitNow text + Convex-storage QR + WA number), tier pill
  (`tier-pill.tsx` in sidebar + mobile-header), `SubscriptionBanner` (app shell —
  escalating: amber **invoice-due-soon** (any pending invoice ≤5 days out, via
  `invoices.myNextDueInvoice`) + amber **trial-ending** (≤5 days) warnings, both
  **dismissable** for the session; red non-dismissable **past_due** CTA with
  `wa.me`. Pure decision in `resolveBannerState`), Billing settings tab
  (`billing-tab.tsx` — plan/status, pending invoice + how-to-pay, founding ribbon,
  history, **+ an always-on "Questions about billing?" support card** — WhatsApp
  (`contact.supportWhatsapp`) + email (`hello@kedaipal.com`) —
  rendered for **every** retailer regardless of plan/tier/status so they can
  always reach us). Pure helpers + tests in `src/lib/subscription.ts`. **Remaining (light):**
  the dashboard's one-time "Schedule your white-glove call" CTA on rank assignment
  (the day-14 pay nudge is already covered by the banner).
  **Payment details are admin-editable in the UI** (not env) — see Phase 4.
  The support WA number is **`SUPPORT_WA_PHONE`** — see below.
- **Phase 4 (in progress):** **`billingConfig`** singleton table + `convex/billing.ts`
  (`paymentInstructions` reads the table + resolves the QR from Convex storage;
  admin `getBillingConfig`/`updateBillingConfig`/`generateQrUploadUrl`; `amIAdmin`
  for client hiding). **Admin route `/app/admin/billing`** (`src/routes/app.admin.billing.tsx`):
  client-gated by `amIAdmin` (server `requireAdmin` is the real lock) — lists
  pending invoices with a **confirm-then-mark-paid** flow (shows the founding-rank
  result), plus an **edit-payment-details form** (bank fields + DuitNow + **QR
  upload to Convex storage**, swap/remove). So the boss self-serves bank details +
  QR with no CLI. Tests: `convex/billing.test.ts`. **Remaining Phase 4:** storefront
  founding badge (`getRetailerBySlug` already exposes the flags), landing "X of 10"
  counter (`foundingMembers.getSpotsRemaining` exists), Scale "Coming soon" pricing
  card + signup guard, a conditional "Admin" nav link, and the deferred white-glove
  dashboard CTA.
  **Phase 4 completed:** conditional **Admin nav link** (sidebar, gated on `amIAdmin`).
  **Storefront founding badge** (`founding-member-badge.tsx` on `/<slug>` header,
  reads the public denormalized flag). Ships Kris's "Plain" badge artwork
  (`public/img/badges/founding-badge-{navy,mint}.png`, speech-bubble emblem with
  a mint star) — the navy variant on light backgrounds, the mint variant swapped
  in under `.dark`, so the emblem always contrasts with the mint-tinted header.
  A "Founding Member #N" text label rides alongside the emblem (the artwork alone
  isn't self-explanatory to a shopper, and a hover tooltip wouldn't work on
  mobile); the label carries the meaning for screen readers, so the images are
  decorative. **Live landing counter** — `FoundingTen` now
  reads `getSpotsRemaining` (defaults to all-open while loading; never shows a fake
  "taken"). **Scale "Coming soon"** — pricing-teaser Scale card shows a disabled
  "Coming soon" pill instead of a CTA + dimmed. **White-glove CTA** — one-time
  dashboard card (`white-glove-card.tsx`) for a new Founding Member, `wa.me` to Arif,
  dismiss via `foundingMembers.markWhiteGloveScheduled` (+ `myStatus` query).
  **Scale signup guard:** intentionally not added — `createRetailer` takes no `plan`
  arg (trial/founding are always Pro), so there is no user-facing scale input to
  reject in v1. The guard belongs to a future plan-selection mutation;
  `isPlanSelectable`/`planQualifiesForFounding` (in `lib/plans.ts`) are ready for it.
- **Phase 4 (admin + public UI):** admin billing route (list + mark-paid),
  storefront founding badge, landing spots counter, Scale "Coming soon" card +
  signup guard.
