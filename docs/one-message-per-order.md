# One message per order (2026-08-04, ClickUp [`86eyd63r8`](https://app.clickup.com/t/86eyd63r8))

The policy every other messaging doc defers to.

## The rule

> **An order sends the buyer exactly ONE outbound WhatsApp message: the
> confirmation. It fires the moment the order's price is final. Everything that
> happens after it lives on the buyer's order page, `/track/<token>`.**

One, on every plan. Not "one plus a status update", not "one per stage" — one.
Nothing in the fulfilment, payment, mockup, courier or rider flow proactively
messages a buyer any more.

The one deliberate exception is **seller-driven**, never automatic: the manual
payment reminder, available on the order page only on days 11–14 of the
open-payment window, at most once per 24h — every send is a human tap. See
[`payment-reminder.md`](./payment-reminder.md).

**Scope note — this governs BUYER messages.** The seller's own order alerts
(`86eyhw9zy`: new order, payment claim, and payment received, to the retailer's
`notifyWaPhone`) are a separate budget and a separate consent, and are
unaffected by this policy.
They also now *replace* the equivalent seller emails rather than duplicating
them — see [`order-notifications.md`](./order-notifications.md).

The buyer's one message is the Meta-approved utility template
`order_confirmation_utility` (`WHATSAPP_ORDER_CONFIRM_TEMPLATE`) — body params
shortId / store / total, URL button = the **tracking token**. Its whole job is
to hand the buyer a link to the page that carries the rest.

Two paths keep a *different* single message, and both are still one:

- **Counter checkout** — the walk-in's message is the free-form order
  confirmation (`whatsapp.notifyCounterOrderCreated`), sent in the session
  window their QR scan opened. (A poster scan also earns a one-line ack with
  their pairing code — a reply to the buyer's own message, not a proactive send,
  but see [Known edges](#known-edges).) See
  [`counter-checkout.md`](./counter-checkout.md).
- **Legacy / no-template stores** (`WHATSAPP_ORDER_CONFIRM_TEMPLATE` unset, or a
  phone-less direct create) — the buyer sends their `ORD-XXXX` first and the
  free-form reply to it is their one message. That reply is the *only* seller-
  editable WhatsApp copy left (`TEMPLATE_KEYS = ["confirm"]`,
  `convex/lib/whatsappCopy.ts:316`).

## Why

Meta bills **every delivered message** from **1 October 2026** — the free
service window and the "first conversation is free" allowances go away. Priced
out against the lifecycle we actually shipped (confirm + packed + shipped +
delivered + payment-received + mockup + reminders + POD photos + the counter
receipt PDF), a single order was costing roughly **RM 0.34** in message fees. At
ICP volume — 20+ orders a week, ~87 a month — that is **~RM 30/month per store,
about 37% of Starter's RM 79**. Gross margin on the wedge plan does not survive
that.

The ticket's original message-budget table proposed a per-plan allowance (3 for
Starter, more above). **This supersedes it: one, for every plan.** A budget that
varies by tier means the buyer's experience varies by what their seller pays,
which is exactly the thing the storefront must never do — and a "3 messages"
allowance still leaves the seller guessing which three they just spent. One
message is a promise both sides can hold in their head.

The cost argument is what forced the decision, but the product argument is the
better one: a reactive page beats a stream of stale texts. A WhatsApp status
update is a snapshot of a moment that has already passed; `/track/<token>` is
always current, always has the payment details, and is one link the buyer can
keep.

## When the one message fires

**At checkout. Always.** There is no timing question and no deferral: every
storefront order schedules its confirmation from `orders.create`, in the same
transaction that inserts the order.

| Order shape | Fires at |
| --- | --- |
| Normal storefront order | `orders.create` — the moment the buyer taps **Place order** |
| Delivery-fee-pending (radius "arrange", out of range) | `orders.create` |
| Mockup / made-to-order (price on quote) | `orders.create` |
| Both holds at once | `orders.create` |
| Counter checkout | `createOrderFromSession` → `notifyCounterOrderCreated` |
| Legacy / no-template store | the free-form reply to the buyer's own `ORD-XXXX` |

### The held price is SAID, not waited for

The template states `Total: {{3}}`, and an order whose price isn't settled has
no number to put there — a price-on-quote line is RM 0.00 until quoted, and an
"arrange" delivery total grows by a fee the seller hasn't set.

So `{{3}}` carries **`PENDING_TOTAL_LABEL`** instead (`convex/lib/whatsappCopy
.ts`): *"to be confirmed"* / *"akan disahkan"*, keyed on the store locale like
every other template value. It is a plain **text** parameter — the currency code
already rides inside the value we pass (which is why an SGD store renders
"SGD 40.00", not "RM SGD 40.00"), so the body carries a bare `{{3}}` and free
text is valid. Meta only rejects newlines, tabs and >1024 chars.

`notifyStorefrontOrderCreated` picks between the two at **send** time, from the
live hold state — so a mockup quoted in the seconds between create and send goes
out with the real number.

**Nothing re-sends when the price settles.** The button in that same message
opens the order page, which is reading the total live. Restating a number the
buyer can already see is the exact thing this policy exists to stop.

### Why not wait for the price (superseding 86eyfq0w5)

The original design deferred the message until a price-settling mutation
released it — `confirmationPushStatus: "deferred"`, claimed transactionally by
`setDeliveryFee` / `submitMockup` / mockup approve / waive / decline. It was
correct about one thing (never quote a total the buyer didn't agree to) and
wrong about the remedy. Three problems, in order of severity:

1. **It stranded the buyers who need the order page most.** A made-to-order
   buyer left checkout with no confirmation and no link — and the tracking page
   is where they approve their mockup. The link could be days away, or never, if
   the seller went quiet. The whole design leans on "everything lives on the
   order page"; withholding the only pointer to it undercut that.
2. **It bought nothing.** The price still isn't final when they read the
   message — the seller sets it afterwards either way. Waiting only moved
   *when* the buyer learned their order existed.
3. **It cost a state machine.** A deferred stamp, a serializable claim, five
   call sites, a cancel-clears branch in two places, and a buyer-facing card for
   the in-between state — all to defer something that could simply say what it
   didn't know yet.

Saying "to be confirmed" is honest, arrives on time, and deletes all of it.
`claimDeferredPush` and `PushDeferredCard` are gone; `orders.create` no longer
produces `deferred`.

**Migration:** `deferred` remains a valid schema literal because rows may still
be in it. Run the one-shot **`orders:releaseDeferredPushes`** once per
deployment — it flips every live deferred order to `sending` and schedules its
send, and clears the stamp on cancelled ones. Idempotent; a second run finds
nothing. Without it those buyers never get their message, since nothing claims
them any more.

Cancelling still **clears** an in-flight stamp (`sending` or `deferred`) in both
`applyStatusTransition` and the custom-only decline path: the promise dies with
the order, and the send action returns early on a cancelled order, so a stamp
left at `sending` would be stuck there forever. Terminal states
(`sent` / `failed` / `recovered`) are history, not promises, and survive.

### The mockup flow sends nothing at all

Before this ticket, a mockup order pushed on **approve/waive/decline** (the gate
opening); the 8 Aug revision moved it to **submit** (the quote landing). Neither
survives: the message went out at checkout, and submitting, re-submitting,
approving, requesting changes, waiving and declining are all page updates.

That's the right answer even ignoring cost. For a made-to-order item the seller
is already in that chat by hand discussing the design — that conversation is the
notification, and it's better than any template we could send. The order page
carries the mockup, the quote, the Approve button and the Request-changes box,
and it's linked from the message the buyer already has.

See [`proof-approval.md`](./proof-approval.md).

## What was removed, and where the buyer gets it now

Every row below used to be an outbound WhatsApp send. All roads now lead to
`/track/<token>`.

| Deleted send | Was triggered by | Where the buyer gets it now |
| --- | --- | --- |
| `notifyStatusChange` — packed / shipped / delivered / **cancelled** | `applyStatusTransition`, `updateStatus` | Status timeline on the order page, live. |
| `notifyStageEntry` — custom-stage pings | `advanceToStage` with `stage.notify` | The same timeline, in the seller's own stage vocabulary. |
| `notifyPaymentReceived` | `markPaymentReceived` | Payment card flips to received on the page, live. |
| `notifyMockupSubmitted` — mockup image + review CTA | `submitMockup` | The confirmation the buyer already has links straight to the review UI; the mockup, quote and Approve button all render there. |
| `notifyPaymentDue` (`approved` / `waived` / `declined` intros) | `approveMockup`, `waiveMockup`, `declineMockupItem` | The confirmation already went out at submit; "How to pay" lives on the page. |
| `notifyDeliveryFeeSet` | `orders.setDeliveryFee` | **Replaced by the one confirmation**, which now fires there and carries the charge + final total. |
| `notifyPaymentReminder` — automatic day-11 nudge | daily cron `paymentReminders.sendDuePaymentReminders` | The **seller's** day-11 reminder button (8 Aug revision): same timing, human finger — [`payment-reminder.md`](./payment-reminder.md). |
| `orders.sendOrderDocument` / `sendOrderDocumentToBuyer` — counter receipt/invoice PDF | `notifyCounterOrderCreated`, Done-screen Resend | Download / Share on the cashier's Done screen; **Receipt** button on the buyer's own order page. |
| `notifyDeliveryPhoto` — Lalamove POD photos | `lalamove.fetchPodImages` | "Delivery photo" card on the order page + the seller's dispatch card. (This was the one send that produced *N* messages from one event — up to 3 images.) |

**Modules deleted:** `convex/paymentReminders.ts` (the cron).
`convex/lib/paymentReminder.ts` returned on 8 Aug carrying the manual button's
window rules — the cron predicates stayed dead.
**Removed from `OrderStage`:** the `notify` field.
**Removed from `lib/orderStatus.ts`** (both `convex/lib` and `src/lib` mirrors):
`MAX_NOTIFY_STAGES`, `stageNotifyPlan`, `StageNotifyPlan`.
**Removed from `whatsappCopy.ts`:** `StatusKey`, the whole `status` catalog,
`renderStageUpdate`, `hasTemplateOverride`, and the system messages
`paymentReceived`, `paymentDue*`, `paymentReminder*`, `deliveryFeeSet`,
`deliveryPhotoCaption`, `orderReceiptCaption`, `orderInvoiceCaption`.

**Schema:** `retailers.orderStages[].notify` is widened to
`v.optional(v.boolean())` — already-saved stage lists still validate, nothing
writes it (`sanitizeOrderStages` drops it), and it decays to absent on the
seller's next save. Narrow it away later. Nothing else changed; there is **no
backfill**.

## The double-send guard — inbound `ORD-` replies

An inbound `ORD-XXXX` to the shared number used to always earn a free-form
confirm reply. On the push path that would be a **second billable send for the
same order**, and it happens more than it looks: a stale `?send=1` link, a
forwarded chat, or a buyer simply re-sending their reference.

So `handleInbound` (`convex/whatsapp.ts:404`) suppresses the reply at its
`pushOwnsTheMessage` guard (`convex/whatsapp.ts:554`,
`convex/lib/confirmationPush.ts:48`):

```
sent | sending | deferred | recovered  →  push owns it, stay silent
failed | undefined                     →  reply
```

- **`deferred` counts as owned.** Legacy only — nothing creates that state any
  more — but a row still in it has a message *coming*, and two is still two
  whichever order they arrive in.
- **`failed` still replies — deliberately.** That push reached nobody, so this
  reply *is* that buyer's one message, and it is their recovery route.
- **`undefined` is the legacy store**, where the reply has always been the one
  message.

**The guard is two clauses, and the second one is load-bearing:**

```ts
if (pushOwnsTheMessage(meta?.confirmationPushStatus) && !result.pushRecovered)
```

`meta` is re-read *after* `confirmOrderFromWhatsApp` has already run
(`convex/whatsapp.ts:539`), and that mutation is what stamps a recovering order
`failed → recovered`. So the very inbound that performs the recovery reads its
own write back as `recovered`, which `pushOwnsTheMessage` calls owned — and
without `!result.pushRecovered` the buyer would be silenced on the one path the
`failed` carve-out exists to serve. Read the table as *"`recovered` from an
earlier inbound → silent; `recovered` by **this** inbound → reply"*.

Suppression is *outbound only*. The confirm mutation still runs — status,
customer link, pushname — and the seller's new-order email still fires.

## Deliberate consequences

Each of these is a real behaviour loss. Each is named in the UI at the exact
point the seller would otherwise assume a message went out. No hidden behavior:
the precedent is the hard-delete dialog, which has always said the customer is
NOT notified, and every new line below matches that tone.

| Consequence | Where the seller is told |
| --- | --- |
| **Cancellation is silent.** No tombstone message, no apology text. | The cancel confirm dialog (`src/routes/app.orders.$shortId.tsx`) and the inbox bulk-cancel dialog (`src/components/dashboard/order-bulk-bar.tsx`): *"The customer is NOT notified — the cancellation only shows on their order page, so tell them yourself if they're expecting it."* |
| **Advancing a status or stage tells the buyer nothing on WhatsApp.** | A line under the order-detail stepper: *"Moving the order along updates the buyer's order page — it doesn't send them a WhatsApp."* Plus a note under the Settings → Order status stage editor explaining what stages still do. |
| **No AUTOMATIC payment chasing** — the day-11 cron is gone. What remains is the seller's own reminder button, window-boxed to days 11–14, once per 24h, closed forever after ([`payment-reminder.md`](./payment-reminder.md)). | Settings → Payments names the day-11 unlock; the unpaid Payment card on order detail carries the button, its cooldown state, and the day-14 closure copy. |
| **Settling a held price sends nothing.** Setting the delivery charge, or quoting and approving a mockup, only updates the order page — the buyer's confirmation already went out saying the total was "to be confirmed". | The delivery-charge card (*"the new total shows on their order page… No further WhatsApp goes out"*), the mockup upload helper (*"The buyer sees it on their order page — no WhatsApp goes out"*), and both success toasts. |
| **Confirming a payment doesn't ping the buyer.** | The mark-received confirm dialog says the buyer isn't messaged; the buyer's page carries *"This page updates the moment {store} confirms your payment."* |
| **Counter orders no longer get the invoice/receipt PDF in chat.** | The Done screen (`src/components/order/order-document-actions.tsx`): *"Hand {buyer} their {receipt} now if they want one. It isn't sent on WhatsApp — they can open it any time from the order page we linked them to."* An anonymous cash sale says plainly that this is their only copy. |
| **Courier + tracking number never ride a message.** | The mark-shipped prompt and the Shipment tracking card both state that the number lands on the buyer's order page. |
| **POD photos are page-only.** | The dispatch card: *"the buyer sees this on their order page."* |
| **A seller's custom status/stage copy no longer has a sender.** | The template editor is now scoped to the one reply that still exists and is renamed *"Reply when a buyer messages their order number"*. |

The buyer side is covered too: every card on `/track/<token>` that mentions
WhatsApp now says *"that's the only message we'll send you — everything else is
here… Keep this link."*

## If you are adding a feature

**New buyer-facing information goes on the tracking page. Never a new send.**

If a change opens a new state the buyer should know about, the work is a section
on `/track/<token>` plus, where a seller action caused it, a line at that action
saying the buyer isn't messaged. If you genuinely believe a second message is
warranted, that is a pricing decision and a ticket, not an implementation
detail — it changes the unit economics of every plan.

Enriching the **existing** confirmation (an extra body param, better copy) is
fine and costs nothing. Adding a `wa.send` is the thing to stop at.

## Known edges

- **A counter walk-in receives two sends, not one — the scan ack, then the
  confirmation.** Scanning the printed `KPS-` poster QR earns a `storeQrConnected`
  reply (`convex/whatsapp.ts:491`) carrying the pairing code the buyer shows the
  cashier; the order confirmation follows when the cashier rings it up. The ack
  is a **direct reply to a message the buyer just sent**, and it is functionally
  required — without the code the cashier cannot match them in the open-checkouts
  list — so it was left in place. Counted honestly, a walk-in order therefore
  costs **two** messages. This is the one shape where the headline rule is a
  simplification; if counter volume makes it material, folding the pairing code
  into the confirmation (and acking nothing at scan) is the obvious next move,
  but it costs the buyer their code while they queue.
- **A counter buyer who types their `ORD-` reference gets a reply.** Counter
  orders carry no `confirmationPushStatus`, so `pushOwnsTheMessage` is false and
  `handleInbound` answers with the legacy free-form confirm. It is buyer-
  initiated and inside their own session window, so it isn't a proactive send —
  but it is technically another message on that order. Left alone rather than
  silencing a buyer who wrote in; revisit if the logs show it happening.
- **The sent message's `Total:` is never corrected.** A held price went out as
  "to be confirmed" and stays that way; a settled one goes out as a number and
  keeps it through any later re-price (`updateMockupQuote`, a re-submit,
  `setDeliveryFee`, an address change). This is the deliberate cost of one
  message — the alternative is a send per re-price, which is exactly the spend
  this policy removed. The order page carries the live figure and is where the
  buyer pays, and the seller is re-pricing *because* they are already talking to
  the buyer. Worth knowing before treating the message as authoritative —
  **it is a pointer, not a receipt.**
- **Nothing tells a made-to-order buyer their price is ready.** They have to
  open the link. Accepted deliberately: for a custom item the seller is in that
  chat by hand agreeing the design, so a template would be a worse version of a
  conversation that is already happening. If a real seller reports buyers going
  cold at this step, the fix to weigh is unlocking the manual reminder earlier
  for price-settled orders — not a new automatic send.
- **A legacy (no-template) mockup order gets nothing at submit.** Those buyers
  never had a push at all; the deleted `notifyMockupSubmitted` was that path's
  nudge. They were told at confirm time that a design is coming
  (`mockupPendingConfirm`) and see it on their order page. The condition
  disappears the moment the template env is set.
- **`orders.paymentReminderSentAt` and `orders.lastManualReminderAt` remain on
  the schema** with no writer. Harmless, and cheaper to leave than to migrate;
  drop them in the next narrowing pass.

## Related

[`order-lifecycle.md`](./order-lifecycle.md) ·
[`waba-protection.md`](./waba-protection.md) ·
[`proof-approval.md`](./proof-approval.md) ·
[`counter-checkout.md`](./counter-checkout.md) ·
[`payment-reminder.md`](./payment-reminder.md) (the manual-reminder exception) ·
[`order-status-customization.md`](./order-status-customization.md) ·
[`fulfilment.md`](./fulfilment.md) ·
[`delivery-lalamove.md`](./delivery-lalamove.md)
