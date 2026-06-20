# Manual Subscription Billing (v1)

ClickUp [`86expn2qg`](https://app.clickup.com/t/86expn2qg). Manual invoicing for the
Founding 10 — no Stripe/HitPay. Admin issues a pending invoice, the retailer pays
out-of-band (DuitNow / bank), the admin flips "paid", and entitlement + Founding
rank-claim happen atomically. Built behind a typed `PaymentProvider` seam so the
future automated-billing integration touches only the adapter.

**Status:** Phases 1 + 2 shipped (full backend: subscriptions, markPaid, founding
rank, backfill, crons, gating). UI phases 3–4 below.

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
  **Env to set for real pay details:** `KEDAIPAL_BANK_NAME`,
  `KEDAIPAL_BANK_ACCOUNT_NAME`, `KEDAIPAL_BANK_ACCOUNT_NUMBER`, `KEDAIPAL_DUITNOW_ID`,
  `KEDAIPAL_PAYMENT_QR_STORAGE_ID` (upload QR to Convex storage first). WA number
  reuses `WHATSAPP_CHECKOUT_PHONE`. Until set, the billing page shows a graceful
  "message us for details" fallback.
- **Phase 4 (admin + public UI):** admin billing route (list + mark-paid),
  storefront founding badge, landing spots counter, Scale "Coming soon" card +
  signup guard.
