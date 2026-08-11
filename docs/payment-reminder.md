# Unpaid-order payment reminder — **REMOVED** (2026-08-04)

> **This feature no longer exists.** Both halves of it — the automatic day-11
> cron and the seller's manual "Send payment reminder" button — were deleted by
> the one-message-per-order policy, ClickUp
> [`86eyd63r8`](https://app.clickup.com/t/86eyd63r8). See
> [`one-message-per-order.md`](./one-message-per-order.md).
>
> This file is kept as a tombstone: the standard it established (a 14-day
> payment window, one nudge, never auto-cancel) was a real product decision, and
> the next person to reach for "we should remind buyers to pay" needs to know it
> was built, shipped, and deliberately removed — not overlooked.

## What existed (2026-07-03 `86ey570am`, extended 2026-07-16 `86ey9xar5`)

**The automatic nudge.** Every order had a **14-day open-payment window** from
creation. At **day 11** — three days before it closed — a still-unpaid order got
**one** WhatsApp reminder, ever, stamped on `orders.paymentReminderSentAt`.
Nothing auto-cancelled at day 14; the window was a reminder deadline, not an
expiry, and the copy never threatened cancellation.

An order was "due" when all of: `status` in `confirmed`/`packed`/`shipped`/**`delivered`**
(`delivered` counted — F&B sellers deliver on credit and settle at week's end, so
goods-arrived ≠ goods-paid-for); `paymentStatus` neither `claimed` nor `received`
(a buyer who tapped "I've paid" is waiting on the *seller*); the mockup gate open;
never reminded before; buyer had a `waPhone`; order ≥ 11 days old.

Moving parts: `convex/lib/paymentReminder.ts` (pure predicates + constants),
`convex/paymentReminders.ts` (daily cron sweep at 02:00 UTC = 10:00 MYT),
`whatsapp.notifyPaymentReminder` (the send), `whatsappCopy.paymentReminder`
(EN/MS/ZH system copy), and a one-line note under Settings → Payments so the
behaviour was never a surprise.

The design decisions worth remembering, in case any of this is rebuilt on a
different channel: **stamp at schedule time, re-check at send time** (at-most-once
across crashes and retries); a **bounded creation-time index scan** over the
`[now − 14d, now − 11d]` slice rather than a table walk, which also self-healed
across missed cron days; and it was sent as a gated **`session_message`**, not
`transactional`, because an unsolicited nudge days after the last conversation is
exactly the traffic WABA protection exists to govern.

**The manual companion.** A **"Send payment reminder"** button on the order's
unpaid Payment card re-sent the buyer the full payment message on demand. No age
gate, no once-ever cap — the seller drove it — but with a 6-hour cooldown stamped
atomically in `orders.prepareManualReminder` (compare-and-set on
`lastManualReminderAt`, so two fast taps couldn't both slip through), and
disabled-with-reason for every state where asking for payment would be wrong:
`cancelled`/`pending`, already `paid`, buyer-`claimed`, `mockup_gated`,
`fee_pending`, `no_contact`, `cooldown`. It doubled as recovery when the buyer
never received the first bot reply.

## Why it went

Meta bills every delivered message from 1 October 2026. A reminder is, by
definition, a message sent to a buyer who is already ignoring you — the worst
possible cost-per-outcome on the platform — and it sat on top of a lifecycle
already spending ~RM 0.34 per order. An order now gets exactly one outbound
WhatsApp: the confirmation. Chasing payment is not something Kedaipal does on the
seller's behalf any more.

There is also a truth problem the removal fixes. A `session_message` sent days
after the last inbound may simply not deliver (outside Meta's 24-hour window),
so the feature's headline promise — *"we chase your customers for you"* — was
only ever best-effort. Better to not claim it than to claim it unreliably.

## What a seller does instead

1. **The buyer's order page is the payment surface.** The one confirmation
   message links to `/track/<token>`, which carries "How to pay", the bank/QR
   details and the "I've paid" button, and updates live. Nothing about being
   unpaid is hidden from the buyer.
2. **The inbox surfaces who owes.** The **Unpaid** chip and the unpaid-amount
   figure on the dashboard home come from the same `searchOrders` counts they
   always did — that surface is untouched.
3. **The seller messages them, from their own number.** The unpaid Payment card
   on order detail carries a WhatsApp deep link to the buyer, and Settings →
   Payments now says plainly: *"Kedaipal doesn't chase unpaid orders… To nudge
   someone, message them yourself."* A message from the seller's own number is
   also the one a buyer actually recognises.

## Residue in the codebase

`orders.paymentReminderSentAt` and `orders.lastManualReminderAt` are still on the
schema with **no writer**. Harmless and cheaper to leave than to migrate; drop
them in the next schema-narrowing pass. Every function and module named above is
gone — do not reference `api.orders.sendPaymentReminder`,
`internal.whatsapp.notifyPaymentReminder`, `notifyManualPaymentReminder`,
`convex/lib/paymentReminder.ts` or `convex/paymentReminders.ts`.

## If this ever comes back

It should not come back as WhatsApp. The two directions that survive the
per-message economics:

- **A page the buyer already has** — the reminder is the order page; the missing
  piece would be getting them to re-open it (a browser push / PWA notification,
  which costs nothing per send).
- **Email**, where we already send the seller's own order alerts for free.

Any WhatsApp revival needs an approved **utility template** (deliverability
outside the 24h window is otherwise not real) *and* a pricing decision — it
changes the unit economics of every plan, so it is a ticket, not an
implementation detail. See
[`one-message-per-order.md`](./one-message-per-order.md#if-you-are-adding-a-feature).
