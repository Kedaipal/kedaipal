# Manual Subscription Billing (v1)

ClickUp [`86expn2qg`](https://app.clickup.com/t/86expn2qg). Manual invoicing for the
Founding 10 — no Stripe/HitPay. Admin issues a pending invoice, the retailer pays
out-of-band (DuitNow / bank), the admin flips "paid", and entitlement + Founding
rank-claim happen atomically. Built behind a typed `PaymentProvider` seam so the
future automated-billing integration touches only the adapter.

**Status:** All phases shipped (1–4) + the **admin Issue-invoice flow** (the
operational piece that makes invoices actually appear). Remaining for prod: run the
backfill, set payment details in the admin UI.

## How invoices appear (the operational loop)

A pending invoice is created in two ways:
1. **Admin issues one** — `/app/admin/billing` → **Invoices** tab → `invoices.issueInvoice`
   (pick retailer, plan, cycle, **founding** toggle, due date defaulting to +14d;
   amount auto-derived from `lib/plans`). This is the path for trial **conversions**
   and **renewals**, and for onboarding a **Founding-10** member (founding toggle =
   30% Pro discount). Guards: rejects Scale (the v1 defense-in-depth home),
   founding-non-Pro, and a duplicate pending per retailer.
2. **Founding-intent signup** — `createRetailer({ intent: "founding" })` auto-creates
   one (kept for a future no-trial founding signup entry).

**⚠️ Rank vs. discount — important.** The Founding **rank** claims on a retailer's
**first paid Pro invoice** (ticket-literal) — the `founding` toggle on the invoice
controls the **30% discount**, NOT rank eligibility. So any Pro invoice paid while
spots remain claims a rank; Starter never does; rank 11+ gets none. Operationally:
**toggle founding ON for the first 10 Pro invoices** so those members also get the
discount they're promised.

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

## Soft-lock (`past_due`)

`assertSubscriptionActive(ctx, retailerId)` throws `ConvexError` when the
subscription is `past_due` **and not comped**. Wired (Phase 2) onto seller
**growth-writes** only: product create/update, `updateSettings`, future
broadcast/reminder. Explicitly **NOT** wired onto: `orders.create` (public),
order pipeline (confirm/pack/ship/deliver/payment-claim/mockup), customer views,
storefront. **Order cap is SOFT** — a nudge in the dashboard, never a block on
`orders.create`; `userCap`/`broadcastQuota` are hard (seller-side surfaces).

## Signup paths (`createRetailer`)

- **Public** (default / `intent: "public"`): `status: trialing`, `plan: pro`,
  `trialEndsAt = now + 14d`, Pro-level caps. Tier is chosen at conversion, not
  signup.
- **Founding** (`intent: "founding"`): `status: active` + a **pending Pro invoice**
  with a `dueDate` (founding price RM104, with the discount shown as a line). Pay →
  rank claims (Phase 2). The 10-slot cap + admin mark-paid are the real rank gate,
  so `intent` is not a privileged arg in v1.

## Admin auth

Env allowlist, **not** a Clerk role (`convex/lib/auth.ts`). `requireAdmin(ctx)`
checks `identity.subject` against `ADMIN_USER_IDS` (comma-separated Clerk subs).
Fails closed when unset. Server check mandatory; client hiding cosmetic.
**Dev setup:** `npx convex env set ADMIN_USER_IDS <your-clerk-sub>`.

## Pricing / caps — single source of truth

`convex/lib/plans.ts`. Starter RM79 / Pro RM149 / Scale RM299; founding Pro RM104
(Scale RM209, unreachable at launch). Annual = 10 months charged. Caps per
CLAUDE.md: Starter 100/1/0, Pro 500/2/100, Scale ∞/5/∞ (unlimited stored as the
`UNLIMITED` sentinel — Convex can't store `Infinity`). Scale is **not selectable**
at v1 (`isPlanSelectable`) and grants **no** Founding badge (`planQualifiesForFounding`,
Arif's 2026-05-28 decision).

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
  history). Pure helpers + tests in `src/lib/subscription.ts`. **Remaining (light):**
  the dashboard's one-time "Schedule your white-glove call" CTA on rank assignment
  (the day-14 pay nudge is already covered by the banner).
  **Payment details are admin-editable in the UI** (not env) — see Phase 4.
  Only the WA number stays env (`WHATSAPP_CHECKOUT_PHONE`).
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
  reads the public denormalized flag). **Live landing counter** — `FoundingTen` now
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
