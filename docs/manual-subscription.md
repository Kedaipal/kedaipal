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

Admin UI is **tabbed** (`app.admin.billing.tsx`): **Invoices** (issue form + pending
list + mark-paid, the frequent task) and **Payment details** (set-once bank/QR).
Tests: `convex/invoices.test.ts` (issueInvoice standard/founding/Starter/guards).

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
2. **Run the backfill** `internalMutation` (Phase 2): create an `active + comped`
   subscription for every pre-existing retailer.
3. **THEN enable gating** (Phase 2 wires `assertSubscriptionActive`).

Until step 2, existing retailers have no subscription row → `resolveAccess` fails
open to comped full access, so they keep working between steps regardless.

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
  `subscriptions.internalBackfillSubscriptions` (active+comped, idempotent). Crons
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
  trial countdown in last 5 days / past-due CTA with `wa.me`), Billing settings tab
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
