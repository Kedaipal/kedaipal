# Unpaid-order payment reminder (2026-07-03, ClickUp `86ey570am`)

One automatic WhatsApp nudge to a buyer whose order is still unpaid near the
end of its open-payment window. Directly serves universal pain #2 — *"I'm
chasing customers for payment confirmation"* — without the seller lifting a
finger.

> **Manual companion (2026-07-16, ClickUp `86ey9xar5`):** the seller can also
> re-send the payment details on demand from the order page — see
> [Manual payment reminder](#manual-payment-reminder-seller-triggered) below.

## The standard (established here — no prior default existed)

- Every order has a **14-day open-payment window** from creation
  (`OPEN_PAYMENT_WINDOW_DAYS`).
- At **day 11** (3 days before the window closes, `PAYMENT_REMINDER_LEAD_DAYS`)
  the buyer gets **one** WhatsApp reminder — ever. Stamped on
  `orders.paymentReminderSentAt`.
- **Nothing auto-cancels at day 14.** The window is a reminder deadline, not an
  expiry — the copy deliberately never threatens cancellation. Auto-expiry /
  escalation is a separate product decision (follow-up).

> Origin note: the ticket referenced a "14-day default" seen in a seller's
> custom status description ("collect within 14 days"), but no such default
> existed anywhere in code or docs — this feature *establishes* it for the
> payment dimension.

## When is an order "due"? (`convex/lib/paymentReminder.ts`, pure + unit-tested)

All of:
- `status` is `confirmed` / `packed` / `shipped` / **`delivered`** — a `pending`
  order was never confirmed in chat so payment isn't owed yet; `cancelled` is
  closed. **`delivered` counts** (PR feedback, 2026-07-03): F&B sellers
  routinely deliver stock on credit and settle at the end of the week/month —
  "goods arrived" does not imply "goods paid for", so a delivered-but-unpaid
  order still gets nudged;
- `paymentStatus` is neither `claimed` nor `received` — a buyer who tapped
  **"I've paid"** is waiting on the *seller*, so nudging them would be wrong;
- the **mockup gate isn't closed** (`isMockupGateClosed`) — custom orders defer
  payment until design approval, and the confirm message promised "no payment
  needed yet";
- never reminded before; buyer has a `waPhone`; order is ≥ 11 days old.

## Moving parts

| Piece | Where |
|---|---|
| Constants + `isPaymentReminderDue` | `convex/lib/paymentReminder.ts` |
| Daily cron sweep | `convex/paymentReminders.ts` → registered in `convex/crons.ts` (02:00 UTC = 10:00 MYT, a humane send hour) |
| Send action | `convex/whatsapp.ts` `notifyPaymentReminder` |
| Copy (EN/MS, system message — not retailer-overridable) | `convex/lib/whatsappCopy.ts` `paymentReminder` |
| Stamp | `orders.paymentReminderSentAt` (schema widened dev-only, optional forever — no backfill) |
| Seller discoverability | Settings → Payments: one-line note under the payment methods card |

## Design decisions

- **Stamp at schedule time, re-check at send time.** The cron writes
  `paymentReminderSentAt` in the same transaction that schedules the send, so a
  crash/retry can never double-message; the action re-loads the order and
  drops silently if payment was claimed/received (or the order closed) in the
  gap. Net effect: at-most-once.
- **Bounded index scan, no full table walk.** The sweep reads only orders whose
  `_creationTime` falls inside `[now − 14d, now − 11d]` on the built-in
  creation-time index — at most 3 days of orders platform-wide per run, and it
  self-heals across missed cron days. Orders older than 14 days age out
  (reminding after the referenced deadline would be noise).
- **Sent as a gated `session_message`, NOT `transactional`.** An unsolicited
  nudge days after the last conversation is exactly the traffic WABA
  protection exists to govern — the kill switch, per-seller caps, and STOP
  opt-outs all apply. (Known real-world caveat shared with all our text sends:
  outside Meta's 24-hour customer-service window a session text may not
  deliver; moving reminders to an approved utility **template** is the
  follow-up that fixes deliverability platform-wide.)
- **Not retailer-configurable in v1.** One window, one lead time, system copy.
  Per-seller tuning (window length, opt-out, custom copy) belongs to the S4
  "Automated Reminders" roadmap item and can layer on this seam.

## Manual payment reminder (seller-triggered)

_ClickUp `86ey9xar5` (2026-07-16)._ A **"Send payment reminder"** button on the
order page's unpaid Payment card lets the seller re-send the buyer the payment
details on demand — the human counterpart to the day-11 cron. It doubles as a
**recovery path**: if the buyer's first bot reply never landed (a swallowed send
after `confirmOrderFromWhatsApp` flips the order to `confirmed`), one tap re-ships
the whole confirmation.

### What it sends

The **full payment message** (not the terse auto-cron copy) via the shared
`sendPaymentMessage`: a reminder intro (`paymentReminderIntro`, EN/BM) → pickup
block → transfer-reference line → payment methods → QR images, capped by an
**"I've paid" CTA** + tracking link. Standing alone, it works whether the buyer
is being chased or is seeing the details for the first time. **No powered-by
footer** — this is a transactional re-send, not a fresh storefront confirm.

### When can the seller send it? (`manualReminderEligibility`, pure + tested)

Unlike the auto nudge there's **no age gate and no once-ever cap** — the seller
drives it. The blocks mirror the states where asking the buyer to pay would be
wrong or impossible, returned as the first failing reason so the button can
explain itself:

| Reason | Why blocked |
|---|---|
| `cancelled` / `pending` | No live confirmed order (a `pending` order was never confirmed in chat, so no buyer `waPhone` exists). |
| `paid` | `paymentStatus === "received"` — nothing to chase. |
| `claimed` | Buyer tapped "I've paid" → waiting on the **seller**, not the reverse. |
| `mockup_gated` | Custom item still needs approval; the buyer was told "no payment needed yet". |
| `fee_pending` | Delivery charge not set yet — the total the buyer would pay isn't final (mirrors the mockup-gate hold; button is hidden, like mockup-gated). |
| `no_contact` | No buyer WhatsApp number on file. |
| `cooldown` | A manual reminder went out **< 6h ago** (`MANUAL_REMINDER_COOLDOWN_MS`); carries `retryAt`. |

### Moving parts

| Piece | Where |
|---|---|
| Constant + `manualReminderEligibility` / `ManualReminderBlock` | `convex/lib/paymentReminder.ts` |
| Auth + eligibility + atomic cooldown stamp | `convex/orders.ts` `prepareManualReminder` (internal mutation; `resolveSharedOrder` owner-or-admin) |
| Public seller action | `convex/orders.ts` `sendPaymentReminder({ shortId })` |
| Send + state re-check | `convex/whatsapp.ts` `notifyManualPaymentReminder` + `getManualReminderContext` |
| Intro copy (EN/BM, system message) | `convex/lib/whatsappCopy.ts` `paymentReminderIntro` |
| Stamp | `orders.lastManualReminderAt` (schema widened dev-only, optional forever — no backfill) |
| UI | `src/routes/app.orders.$shortId.tsx` — button + disabled-with-reason + "Last reminded Xh ago" + 24h-delivery helper on the unpaid Payment card |

### Design decisions

- **Separate stamp (`lastManualReminderAt`) from the auto `paymentReminderSentAt`.**
  The two triggers never corrupt each other's once-only logic. To avoid
  double-messaging, the **auto cron skips** an order the seller manually reminded
  within the 3-day lead window (`PAYMENT_REMINDER_LEAD_DAYS`) — a manual nudge on
  day 9 suppresses the day-11 auto nudge; a manual nudge on day 5 doesn't.
- **Atomic compare-and-set cooldown.** `prepareManualReminder` re-reads
  `lastManualReminderAt` and stamps in one mutation, so two fast taps can't both
  slip past the 6h gate. The button also disables while a send is in flight.
- **Best-effort delivery, eligibility is the only hard feedback.** The send rides
  the WABA `session_message` gateway (kill switch / caps / opt-outs apply) and
  `sendPaymentMessage` swallows Meta errors — same posture as every session send,
  including the auto nudge. So the action surfaces only the **eligibility** block
  reasons; actual delivery carries the standing caveat (session texts may not
  reach a buyer you haven't messaged in ~24h), shown as helper copy under the
  button. A paused store is already flagged by the WABA kill-switch banner.
- **Scope = confirmed online/storefront orders.** Counter checkout sends payment
  details at scan and has its own document resend, so the button stays on the
  Payment card (which never renders for a `pending` or fully-paid order).

## Tests

- `convex/lib/paymentReminder.test.ts` — predicate matrix (status ×
  paymentStatus × mockup gate × age × stamp × reachability) for **both**
  `isPaymentReminderDue` (incl. the manual-suppresses-auto rule) and
  `manualReminderEligibility` (blocks + 6h cooldown boundary + precedence).
- `convex/paymentReminders.test.ts` — cron sweep (stamps once, skips
  young/paid/aged-out) + send action (body content; claimed-in-the-gap never
  nagged).
- `convex/manualPaymentReminder.test.ts` — the seller action end-to-end (sends
  the full message + stamps; cooldown rejects a second tap without sending;
  claimed order blocked; requires auth).
