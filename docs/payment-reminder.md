# Unpaid-order payment reminder (2026-07-03, ClickUp `86ey570am`)

One automatic WhatsApp nudge to a buyer whose order is still unpaid near the
end of its open-payment window. Directly serves universal pain #2 — *"I'm
chasing customers for payment confirmation"* — without the seller lifting a
finger.

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
- `status` is `confirmed` / `packed` / `shipped` — a `pending` order was never
  confirmed in chat so payment isn't owed yet; `delivered`/`cancelled` are closed;
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

## Tests

- `convex/lib/paymentReminder.test.ts` — predicate matrix (status ×
  paymentStatus × mockup gate × age × stamp × reachability).
- `convex/paymentReminders.test.ts` — cron sweep (stamps once, skips
  young/paid/aged-out) + send action (body content; claimed-in-the-gap never
  nagged).
