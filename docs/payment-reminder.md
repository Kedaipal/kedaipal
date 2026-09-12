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

## Deliverability — the utility template (ClickUp `z8r3fddtkh`)

By day 11 the buyer's 24h service window is almost always closed, and a
free-form message outside it is **silently not delivered** (Meta 131047). A
registered template is the one message shape Meta delivers with no open
window, so the reminder now has two wire shapes behind one policy:

| `WHATSAPP_PAYMENT_REMINDER_TEMPLATE` | Sent as | Gateway category | Delivers when the window is closed? |
| --- | --- | --- | --- |
| set (`payment_reminder_utility`) | the Meta-approved utility template | `utility_template` | **yes** |
| unset | the legacy free-form payment message (intro → transfer ref → "Make payment" CTA) | `session_message` | no — best effort |

Both are gated (kill switch, per-seller caps, opt-outs — an unsolicited nudge
days after the last conversation is exactly the traffic WABA protection exists
to govern), both are best-effort (a Meta rejection is logged, never thrown at
the seller, and the 24h cooldown stamp stands either way — tapping again on a
number Meta refuses helps nobody). `orders.get` exposes
`paymentReminderViaTemplate` on the **seller** path only, and the button's
helper copy reads from it: with the template it says the reminder "lands even
if the buyer has never replied"; without it, it keeps the old caveat and points
at the always-works direct-chat button.

**Template registration (Meta, EN + BM).** Body params are the confirm
template's three — `{{1}}` order id, `{{2}}` store name (through
`templateParam`), `{{3}}` amount as `MYR 120.00` — and the URL button base is
`https://kedaipal.com/track/{{1}}` ← the tracking **token** (added via Meta's
*Add variable* control, never hand-typed braces). Proposed body, strictly
transactional (a promotional word is how a template gets re-categorised to
marketing at 6.1× the price — see the template-webhook section of
[`waba-protection.md`](./waba-protection.md)):

> EN — *A reminder from {{2}}: order {{1}} is still awaiting payment ({{3}}).
> Use the order number as your transfer reference. Tap below for how to pay and
> to confirm once you have.*
>
> BM — *Peringatan daripada {{2}}: pesanan {{1}} masih menunggu pembayaran
> ({{3}}). Gunakan nombor pesanan sebagai rujukan pindahan. Tekan di bawah
> untuk cara membayar dan sahkan setelah selesai.*
>
> Button: **How to pay** / **Cara bayar** → `https://kedaipal.com/track/{{1}}`

## Tests

`convex/lib/paymentReminder.test.ts` (pure window/cooldown/state truth table,
including the cooldown-outlives-the-window edge) and
`convex/manualPaymentReminder.test.ts` (end-to-end: day-5 refusal, day-12
send + stamp, same-day second tap refused, day-20 permanent close, paid/foreign
-owner refusals, a pin that nothing ever *schedules* a reminder, and the
template path — env set ⇒ a `template` payload with the three body params and
the tracking token on the button, logged as `utility_template`; the seller
payload flag; a Meta rejection stays best-effort).

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
