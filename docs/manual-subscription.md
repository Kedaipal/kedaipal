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

**Trial vendor (≤2):**
1. **Ends in 3 days** — daily cron, once, deduped by `subscriptions.trialReminderSentAt`
   (`notifyTrialEmail "trialEndingSoon"`). "Choose a plan" — trials have no invoice.
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
  cancelled`. Entitlement **caps are denormalized** onto the row (`orderCap`,
  `userCap`, `broadcastQuota`) — feature-gating reads the caps, **never the `plan`
  field**, so the seam stays clean for automated billing.
- **Invoice** (per period). Admin marks paid; `dueDate` drives the
  `active → past_due` overdue cron.
- **Founding member** ledger — atomic rank claim (1..10), Pro-only at v1.

### Two invariants everything rests on

1. **Fail safe.** A retailer with **no** subscription row resolves to **comped
   full access** (logged), never locked — so a backfill miss degrades to "works",
   not "locked out". (`resolveAccess(null)` in `convex/subscriptions.ts`.)
2. **Pressure on the seller, never the buyer.** The storefront + order pipeline are
   public and **never call the subscription guard** — they stay live regardless of
   status. Soft-lock (`past_due`) freezes **only** the seller's dashboard
   growth-writes.

## Locking (when the cron flips to `past_due`)

The daily cron locks a vendor on any of:
1. **Trial lapsed** (`trialing`, `trialEndsAt < now`).
2. **Invoice overdue** (`active` with a pending invoice past its `dueDate`).
3. **Period lapsed, no invoice** (`active`, `currentPeriodEnd < now`, and **no** pending
   invoice) — we never give a paid vendor free service past their cycle while waiting on
   Arif to issue a renewal. A pending invoice with a *future* due date keeps them in grace.

Comped subs never lock. Each transition fires its one email (overdue → `notifyInvoiceOverdue`;
trial → `trialEnded`; period-lapse → `notifySubscriptionLapsed`).

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
