# Activation Checklist

The dashboard setup checklist (`src/routes/app.index.tsx`) measures **activation**
— the retailer's first real order through Kedaipal — not just **configuration**.
Finishing setup is necessary but not sufficient; the milestone that predicts
retention is the first confirmed order, so the checklist drives the seller all the
way there and then celebrates it.

ClickUp: `86exrxj0x`. Complements the Setup Wizard and the Founding-10 White-Glove
runbook.

## Why

The old checklist (3 config steps: WhatsApp number, first product, payment) hid
itself the moment config was complete, leaving a cliff between "3/3 done" and the
first order. The two highest-leverage actions weren't tracked at all: **sharing the
store link** and **receiving the first order**. We now persist activation timestamps
so the funnel is measurable (feeds PostHog when that lands) and the dashboard guides
the seller through the whole arc.

## Schema (`convex/schema.ts`, `retailers`)

Two one-time stamps that **never un-set**:

| Field          | Meaning                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| `activatedAt`  | epoch-ms of the retailer's **first order to reach confirmed (or beyond)**. The real finish line. |
| `linkSharedAt` | epoch-ms the seller **first shared** their link (copied it / opened the QR from the checklist). A soft proxy — see below. |

Both are widened-in optional fields (dev-only, no migration — unset = legacy /
not-yet). Surfaced by `retailers.getMyRetailer` (owner read only).

> Note: `customers.firstOrderAt` already existed but is a **per-customer** aggregate
> — it does not give store-level activation, which is why a retailer-level
> `activatedAt` was required.

## Activation stamp (`convex/lib/activation.ts`)

`stampRetailerActivation(ctx, retailerId, now)` is **set-if-unset**: it re-reads the
row inside the caller's transaction and writes only when `activatedAt` is still
undefined. This is the single helper called from **every place an order can become
confirmed**, so the four paths can't drift:

1. `whatsapp.confirmOrderFromWhatsApp` — buyer confirms via WhatsApp (`wasPending`).
2. `orders.markPaymentReceived` — payment auto-confirm of a pending order.
3. `orders.applyStatusTransition` — any seller-driven **forward (non-cancel)**
   transition (manual confirm, or skipping straight to packed/shipped/delivered).
4. `counterCheckout.createOrderFromSession` — counter orders are born confirmed.

Because it's set-if-unset, the timestamp stays at the **true first** order even
though later transitions all call it again.

### Edge cases (all covered by `convex/activation.test.ts`)

- **Created-then-cancelled before confirm** → never stamps (create leaves the order
  `pending`; only confirm/forward transitions stamp; cancel is skipped).
- **Cancel after activation** → `activatedAt` stays (set-if-unset never un-sets).
- **Products later archived** → unrelated; `activatedAt` is independent of products.
- **Concurrency** (two orders racing to be "first") → safe: Convex OCC re-runs the
  loser, which re-reads the now-set field and no-ops. No read-then-write gap.

## `linkSharedAt` is a soft proxy

We can't detect a *real* share, so `retailers.markLinkShared` (idempotent
set-if-unset) treats "copied the link" / "opened the QR" from the checklist share
step as the signal. It **never blocks** anything — it only flips the share step to
done and advances the funnel.

## Two distinct milestones — don't conflate them

- **`activatedAt` (first customer order)** — the in-system activation/retention
  signal + the transient celebration. NOT the checklist's completion gate.
- **Onboarding "complete" (the dashboard checklist disappearing)** — the trial
  vendor has **converted to a paid plan** (the "Subscribe to a plan" step). The
  business definition of done: *first subscription payment*.

These are independent: a vendor can land order #1 while still mid-trial — they get
the celebration AND keep being nudged to subscribe.

## Dashboard UI (`app.index.tsx`)

The checklist **stays visible until every REQUIRED step is done** (`requiredDone`)
and is split into two groups so the must-do path is visually distinct:

- **Required path** — numbered 1..N, progress bar counts these only (`X/N done`),
  the active step auto-expands.
- **Optional extras** — a lighter group below a divider (greeting, fulfilment), no
  numbers, collapsed by default and **tap-to-expand** (accordion, one open at a
  time via `openOptional`). They never block completion. The collapsed rows are
  toggle buttons (chevron), which is what makes the greeting step — usable only
  when expanded — actually actionable.

Required steps, in order:

1. Add WhatsApp number
2. Add products — recommends **bulk import** (`/app/products/import`) as the primary
   CTA, "Add one product" (`/app/products/new`) secondary (the F&B cohort runs
   20–30+ SKUs).
3. Add payment details
4. **Share your store link** (`ShareLinkChecklistRow`) — a self-contained card: the
   link, a Copy / Show-QR / Open-store row, and "where to put it" guidance. Copy or
   QR calls `markLinkShared`. (Copy/QR from the returning-user **hero** also stamp,
   so a seller who shares from anywhere isn't re-nagged.) Done when `linkSharedAt`
   is set **or** the store has its first order.
5. **Subscribe to a plan** — the capstone. Done when `hasSubscribed(subscription)`
   (left `trialing`, or `comped`). CTA → Settings → Billing. While trialing, the
   copy shows the live days-left (`trialDaysLeft`). Per product decision, this step
   is shown **from day 1 as the final step** with trial context — the checklist
   visibly isn't "complete" until they pay.

`hasSubscribed` (`src/lib/subscription.ts`) is the gate: `comped || status !==
"trialing"`. Comped pilots never pay, so they read as done and are never nagged; a
missing subscription fails open to subscribed (mirrors `resolveAccess`).

### First-order celebration (independent overlay)

When `activatedAt` is set, a transient `FirstOrderCelebration` shows for
**`ACTIVATION_CELEBRATION_MS` (7 days)**, then self-clears (no stored dismissal — it
just compares against `activatedAt`). It renders **above** the checklist, so it can
appear alongside the still-pending "Subscribe" step. Doubles as a **testimonial ask**
(all sellers; CTA opens a WhatsApp chat to the Kedaipal contact, reusing the
configured checkout number). Ties to the Founding 10 program (`86exq9kz9`).

## SSR

The storefront URL uses `window.location.origin` with a `https://kedaipal.com`
fallback. The 7-day celebration window is a plain timestamp compare, safe on the
server.

## Deferred

PostHog events for step completion + activation land with the analytics task — the
timestamps ship now so the data exists when PostHog arrives.

## Tests

- `convex/activation.test.ts` — all four `activatedAt` stamp paths, one-time
  idempotency, never-un-set on cancel, no-activation on cancel-before-confirm,
  `markLinkShared` idempotency + unauth no-op, and `getMyRetailer` exposure.
- `src/lib/subscription.test.ts` — `hasSubscribed` gate: trialing → not done;
  active/past_due/cancelled → done; comped trialing → done; missing → fails open.
