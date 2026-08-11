# Payment reminder — seller-driven, day 11–14 only (2026-08-08 revision)

The one deliberate exception to
[one-message-per-order](./one-message-per-order.md) (`86eyd63r8`): a seller can
WhatsApp an unpaid buyer a payment reminder from the order-detail page — but
only inside a hard window, and every send is a human tap. **Nothing chases
payment automatically.** The day-11 cron that used to fire the nudge is gone
(see the history section at the bottom); the seller's finger replaced it, on
the same day-11 timing.

## The rules

| Order age (from creation) | The button |
| --- | --- |
| day 1–10 | **Hidden.** The unpaid-payment card says a reminder button unlocks on day 11 (and when), so the seller isn't surprised by its arrival — a control that's dead for 10 days would be noise, so this is the one place we explain-then-hide rather than disable-with-reason. |
| day 11–14 | **Live**, at most **once per 24h** — disabled-with-reason between sends, showing when the next one opens. With a 4-day window, an order can ever receive at most 4 reminders. |
| day 15+ | **Closed forever.** The card says so: a two-week-old unpaid order is a conversation (or a cancellation), not a nudge. The seller settles it directly over WhatsApp and marks payment received — or cancels the order. Nothing auto-cancels. |

Day 11 is where the retired automatic nudge used to fire (14-day open-payment
window, 3-day lead), so the *timing standard* survives — only the finger on the
button changed from cron to seller.

Beyond the window, the same state blocks as before apply (each with its own
disabled reason or card copy): `cancelled`/`pending` (nothing to chase),
`paid`, `claimed` (the buyer is waiting on the *seller*), the mockup gate,
`deliveryFeePending` (the total isn't final), and no buyer phone on file.
Status-wise, `confirmed`/`packed`/`shipped`/**`delivered`** are all remindable
— goods-arrived ≠ goods-paid-for (F&B sellers deliver on credit and settle at
week's end; PR feedback on `86ey570am`).

## Moving parts

- **`convex/lib/paymentReminder.ts`** — pure `manualReminderEligibility` +
  the window/cooldown constants. The **single source of truth**, imported by
  both the server lock and the dashboard button, so the disabled-with-reason
  UI can never disagree with the mutation that enforces it.
- **`orders.prepareManualReminder`** (internal mutation) — auth via
  `resolveSharedOrder` (owner or admin act-as) + eligibility + the **atomic
  cooldown stamp** on `orders.lastManualReminderAt`, all in one transaction so
  two fast taps can't both slip past the 24h gate.
- **`orders.sendPaymentReminder`** (public action) — the button's target;
  returns the block reason without sending when refused.
- **`whatsapp.notifyManualPaymentReminder`** — the send: reminder intro
  (`whatsappCopy.paymentReminderIntro`, EN/MS/ZH) → amount + transfer
  reference → "Make payment" CTA to the buyer's order page, via the shared
  `sendPaymentMessage`. Re-checks the live order state so a payment that lands
  between tap and send stays un-nagged.
- **Seller surfaces** — the unpaid-payment card on order detail carries the
  button and every window state; Settings → Payments names the behaviour so
  it's discoverable before day 11 ever arrives.

## Deliverability caveat (and the plan for it)

The reminder is a free-form **`session_message`** (gated: kill switch,
per-seller caps and opt-outs all apply — an unsolicited nudge days after the
last conversation is exactly the traffic WABA protection exists to govern).
By day 11 the buyer's 24h service window is almost always closed, so **Meta
may silently not deliver it** (error 131047) unless the buyer has messaged
recently. The button's helper copy says this to the seller outright and points
at the always-works direct-chat button. Moving this send onto a registered
utility template — which delivers regardless of the window — is part of the
remaining `86eyd63r8` template work.

## Tests

`convex/lib/paymentReminder.test.ts` (pure window/cooldown/state truth table,
including the cooldown-outlives-the-window edge) and
`convex/manualPaymentReminder.test.ts` (end-to-end: day-5 refusal, day-12
send + stamp, same-day second tap refused, day-20 permanent close, paid/foreign
-owner refusals, and a pin that nothing ever *schedules* a reminder).

## History

- **2026-07-03 (`86ey570am`)** — the original standard: 14-day open-payment
  window, ONE automatic WhatsApp nudge at day 11 via a daily cron
  (stamp-at-schedule / re-check-at-send, bounded creation-time index scan).
- **2026-07-16 (`86ey9xar5`)** — the seller's manual button, any-time with a
  6h cooldown.
- **2026-08-04 (`86eyd63r8`)** — both removed by the one-message-per-order
  policy.
- **2026-08-08 (Zaki)** — the manual button returns, window-boxed to the
  cron's old day-11 timing: day 11–14 only, 24h cooldown, closed forever after
  day 14. The cron stays gone; `orders.paymentReminderSentAt` (its stamp) is
  schema residue with no writer, to be dropped in a later narrowing pass.
