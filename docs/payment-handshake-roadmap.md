# Payment Confirmation Handshake — Implementation Roadmap

Reference doc for the manual two-button payment confirmation pattern. **Status: shipped (in production).** This file is kept for the original design rationale (problem framing, why we deferred, future PSP swap-in); for how the flow behaves today, see the canonical reference: [`payment-handshake.md`](./payment-handshake.md). No payment gateway required — solves the "did the money land?" handshake using the bank-transfer / DuitNow QR flow we already have.

## Context (2026-04-28)

**The problem.** Today, the order status pipeline (`pending → confirmed → packed → shipped → delivered`) conflates two events into one transition: "the retailer saw the money in their bank app" + "the retailer is now working on the order". The shopper has no way to signal "I've paid, please look", and neither side gets a clean confirmation that money landed.

**The shape of the fix.** Add **payment as a separate dimension** from fulfilment, with two manual confirmation points and one notification at each end:

1. Shopper taps "I've paid" on the tracking page → retailer gets an email alert
2. Retailer clicks "Mark payment received" in the dashboard → shopper gets a WhatsApp message

No payment gateway, no PSP licensing, no bank-API integration. The schema and notification slots are already shaped for a future gateway swap-in (CHIP / Billplz / ToyyibPay) — adding it later means flipping `paymentStatus` from a webhook instead of a button.

**Why we deferred this.** Email notifications were the immediate bottleneck (retailer alerts not arriving). With email shipped, the handshake is the next user-visible improvement. Solo-dev sequencing — get reliability first, then UX polish.

## Schema changes

### `convex/schema.ts` — orders table

Add to the existing `orders` table — leave the fulfilment status pipeline untouched:

```ts
paymentStatus: v.optional(
  v.union(
    v.literal("unpaid"),     // default; shopper hasn't claimed payment
    v.literal("claimed"),    // shopper tapped "I've paid"
    v.literal("received"),   // retailer confirmed money landed
  ),
),
paymentReference: v.optional(v.string()),       // shopper-entered transaction ref
paymentClaimedAt: v.optional(v.number()),
paymentReceivedAt: v.optional(v.number()),
paymentProofStorageId: v.optional(v.string()),  // optional screenshot upload
```

Optional but recommended: a `payments` index for filtering the dashboard:

```ts
.index("by_retailer_payment", ["retailerId", "paymentStatus"])
```

### State machine (independent of `order.status`)

```
                      I've paid              Mark received
   ┌──────────┐  ───────────────►  ┌──────────┐  ──────►  ┌──────────┐
   │  unpaid  │                    │  claimed │           │ received │
   └──────────┘  ◄───────────────  └──────────┘   ◄──┐    └──────────┘
                  Ask for proof          │           │
                  (WA nudge only,        │           │
                   no state change)      │           │
                                         └───────────┘
                                       (also reachable
                                        directly from
                                        `unpaid` —
                                        retailer manual override)
```

Marking `received` should auto-bump `pending → confirmed` if not already past — saves the retailer one click in the common case.

## Mutations

### `convex/orders.ts` (new)

**`claimPayment`** — public mutation, capability-token trust model. Same pattern as `updateDeliveryAddress`. (Originally shipped as shortId-as-capability; hardened to the high-entropy `orders.trackingToken` — see [`infra-cost-scaling.md` §6](./infra-cost-scaling.md).)

```ts
export const claimPayment = mutation({
  args: {
    shortId: v.string(),
    reference: v.optional(v.string()),
    proofStorageId: v.optional(v.string()),
  },
  handler: async (ctx, { shortId, reference, proofStorageId }) => {
    // Rate-limit by shortId (reuse existing rateLimiter)
    // Look up order, error if not found or already received
    // Patch paymentStatus="claimed", paymentClaimedAt=now, optional ref + proof
    // Insert orderEvents row with note="payment_claimed"
    // Schedule internal.email.notifyPaymentClaimed
  },
});
```

**`markPaymentReceived`** — Clerk-auth mutation, retailer-only. Mirrors `updateStatus`.

```ts
export const markPaymentReceived = mutation({
  args: {
    orderId: v.id("orders"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { orderId, note }) => {
    // Auth check (mirror updateStatus)
    // Patch paymentStatus="received", paymentReceivedAt=now
    // If order.status === "pending", auto-bump to "confirmed" (skip WA confirm
    //   to shopper since the new paymentReceived WA covers it)
    // Insert orderEvents row with status="confirmed" + note
    // Schedule internal.whatsapp.notifyPaymentReceived
  },
});
```

**Optional:** `requestPaymentProof` — sends a WA nudge to the shopper without changing state. Could be a separate mutation or just a frontend `wa.me` deep link.

### `convex/retailers.ts`

No change required — but `paymentInstructions` block already exists. Update the WhatsApp `confirm` template to include the order ID as the transfer reference (see Copy section).

## Public storefront upload flow for proof

Reuse `generatePaymentQrUploadUrl` pattern at `retailers.ts:528` — but it's currently auth-gated. Need a new public version:

```ts
export const generateOrderProofUploadUrl = mutation({
  args: { shortId: v.string() },
  handler: async (ctx, { shortId }) => {
    // Rate-limit by shortId
    // Verify order exists and paymentStatus !== "received"
    // Return ctx.storage.generateUploadUrl()
  },
});
```

## Notifications

### Retailer email — extend existing infra

Already shipped infra in `docs/email-notifications.md`. Add:

**`convex/lib/emailCopy.ts`:**
- Extend `RetailerEmailKey = "newOrder" | "orderConfirmed" | "paymentClaimed"`
- New EN + MS copy:
  - Subject: `🪙 Payment claimed for ORD-XXXX · RM 89.00` / `🪙 Pembayaran diterima untuk ORD-XXXX`
  - Body: customer name + amount + reference (if provided) + screenshot thumbnail link + "Verify in your bank app and confirm in dashboard"

**`convex/email.ts`:**
- Add `notifyPaymentClaimed` action (sibling of `notifyRetailerOrderAlert`). Same skip-conditions, same swallow-errors pattern.
- OR — extend `notifyRetailerOrderAlert` to handle `paymentClaimed` if it can be derived from `paymentStatus`. Cleaner to keep them as separate actions to avoid status-coupling.

### Shopper WhatsApp — extend existing infra

**`convex/lib/whatsappCopy.ts`:**
- Add `paymentReceived` to the shopper-facing copy alongside `confirm` / `packed` / `shipped`. Bilingual.
- EN: `✅ Payment received for {shortId}. {storeName} is preparing your order.\n\nTrack: {trackingUrl}`
- MS: `✅ Pembayaran diterima untuk {shortId}. {storeName} sedang menyediakan pesanan anda.\n\nJejak: {trackingUrl}`

**`convex/whatsapp.ts`:**
- Add `notifyPaymentReceived` action — same shape as `notifyStatusChange`. Reuses `getOrderWithRetailer` query.

### Confirm reply addendum (one line, big leverage)

The current `confirm` template at `whatsappCopy.ts` doesn't tell the shopper to use the order ID as the transfer reference, which is the only deterministic way for the retailer to match a bank notification to an order. Add to **all** confirm copy variants (default + retailer-overridable templates):

- EN: `Use {shortId} as your transfer reference so we can match it.`
- MS: `Gunakan {shortId} sebagai rujukan pemindahan supaya kami boleh padankan.`

Implemented as either (a) a hard-coded line appended after the customizable confirm body, or (b) a separate template key `paymentInstructionRef`. Option (a) is simpler — it's a system-critical instruction, retailer-overriding it would break payment matching.

## UI changes

### Tracking page (`src/routes/track.$token.tsx`)

- New status section near the top showing payment badge:
  - `unpaid` → yellow `Payment Unpaid` + primary `I've paid` button
  - `claimed` → blue `Payment Submitted` + muted `Awaiting store confirmation · {ago}` + small `Update proof` link
  - `received` → green `Payment Confirmed ✅` + timestamp
- "I've paid" modal (single screen):
  - Optional text field: "Reference number from your bank app"
  - Optional file picker: "Screenshot of receipt"
  - Primary "Submit" + secondary "Cancel"
- Reuse existing `formatPrice`, status colour pattern from `getStatusConfig`.

### Order detail (`src/routes/app.orders.$shortId.tsx`)

- Payment status badge near top.
- When `paymentStatus === "claimed"`:
  - "Payment claim" section showing customer reference + screenshot thumbnail (tap to expand) + total (large, for bank-app cross-checking).
  - Primary button: **"Mark payment received"** (auto-confirms order).
  - Secondary button: **"Ask for proof"** → sends WA nudge to shopper, no state change.
- When `paymentStatus === "received"`:
  - Read-only "Payment received · {time} by you".
  - Show in `orderEvents` timeline.

## Tests

### `convex/orders.test.ts`

- `claimPayment` — sets paymentStatus, schedules retailer email, writes event
- `claimPayment` — invalid shortId rejects
- `claimPayment` — already-received order rejects
- `markPaymentReceived` — sets paymentStatus + auto-confirms pending, schedules shopper WA
- `markPaymentReceived` — does not auto-confirm if already past confirmed
- `markPaymentReceived` — auth required (Clerk)

### `convex/email.test.ts`

- New `notifyPaymentClaimed` test — assert resend POST with `paymentClaimed` subject and reference.

### `convex/whatsapp.test.ts`

- New `notifyPaymentReceived` test — assert WA send to customer with payment-received body.

## Edge cases & branches

| Situation | Behaviour |
|---|---|
| Shopper pays but never taps "I've paid" | Retailer manually clicks "Mark payment received" anyway. Same end state. |
| Shopper claims but retailer can't find money | "Ask for proof" → WA nudge. `paymentStatus` stays `claimed`. |
| Shopper double-taps "I've paid" | Modal lets them re-submit with corrected ref/proof. State stays `claimed`. |
| Retailer slow to confirm (>24h after `claimed`) | Optional cron sends retailer a daily nudge email. |
| Shopper hasn't paid (>24h after `pending`) | Optional cron sends shopper a gentle WA reminder. |
| Order cancelled after payment received | `cancelled` status set, `paymentStatus` stays `received` for refund-trail audit. Refund handled offline by retailer via WA. |
| Multiple orders, single bundled payment | Not solved — each order has its own ORD reference. Retailer marks both manually. |
| Wrong amount paid | "Ask for proof" + WA discussion. No automated reconciliation. |

## Migration notes

- `paymentStatus` is `v.optional` — existing orders will be `undefined` post-deploy and behave as `unpaid`. No backfill needed.
- `markPaymentReceived` for legacy orders (created before this lands) works fine — the retailer can mark received on any order regardless of `paymentStatus` history.
- The order detail page should treat `undefined` `paymentStatus` as `unpaid` for badge rendering.

## Order of execution (when picked up)

1. Schema field + paymentStatus union, plus optional index.
2. `claimPayment` and `markPaymentReceived` mutations + tests.
3. Public `generateOrderProofUploadUrl` mutation for screenshot upload.
4. Email path: extend `RetailerEmailKey` + `paymentClaimed` copy + new `notifyPaymentClaimed` action.
5. WhatsApp path: extend shopper copy + `notifyPaymentReceived` action.
6. Append the `Use {shortId} as your transfer reference` line to confirm copy (en + ms).
7. Tracking page payment-status badge + "I've paid" modal.
8. Order detail page payment-claim section + actions.
9. End-to-end smoke with one retailer.

Each step is independently reviewable. Steps 1–2 alone (without UI) ship a usable backend that the dashboard can drive — the UX layer (7–8) can land in a separate PR.

## Why this leaves a clean gateway-swap path

When/if a real payment gateway gets added later (CHIP / Billplz / ToyyibPay — see `PROJECT_CONTEXT.md` Payments Architecture):

- The webhook handler simply writes `paymentStatus = "received"` and `paymentReceivedAt = now` — same end state as the manual button.
- The retailer can stop watching their bank app; the shopper-facing WA `paymentReceived` message fires on the webhook just like it does on the button click.
- No re-architecture — the schema, mutations, copy, and UX all already model "payment as a separate dimension".
