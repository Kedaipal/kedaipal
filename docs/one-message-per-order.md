# One message per order (2026-08-04, ClickUp [`86eyd63r8`](https://app.clickup.com/t/86eyd63r8))

The policy every other messaging doc defers to.

## The rule

> **An order sends the buyer exactly ONE outbound WhatsApp message: the
> confirmation. It fires the moment the order's price is final. Everything that
> happens after it lives on the buyer's order page, `/track/<token>`.**

One, on every plan. Not "one plus a status update", not "one per stage" — one.
Nothing in the fulfilment, payment, mockup, courier or rider flow proactively
messages a buyer any more.

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

Timing is the only thing that varies, and it varies on exactly one question:
**is the total real yet?** The template states `Total: {{3}}`, so sending before
the price settles would quote a number the buyer never agreed to.

| Order shape | Fires at | Why there |
| --- | --- | --- |
| Normal storefront order | `orders.create` — the moment the buyer taps **Place order** | The total is final at checkout. Order inserts `confirmed`, push scheduled in the same breath. |
| Delivery-fee-pending (radius "arrange", out of range) | `orders.setDeliveryFee` (`convex/orders.ts:2499`) | The seller agrees the charge with the buyer in chat, then sets it — that's the first moment the total is true. |
| Mockup / made-to-order (price on quote) | **`orders.submitMockup`** (`convex/orders.ts:2943`) | The seller enters `quotedAmount` **at submit**, and `submitMockup` folds it into `total` right there. So `submitted` already carries a real price — and the message's tracking link is the very page the buyer reviews and approves the mockup on. |
| Both holds at once | Whichever settles **last** | The claim (below) re-reads the order and only fires when *no* hold remains. |
| Counter checkout | `createOrderFromSession` → `notifyCounterOrderCreated` | The cashier priced it in front of the buyer; nothing to wait for. |

An order still holding a price is stamped `confirmationPushStatus: "deferred"`
and the buyer's page says so (`PushDeferredCard` in `src/routes/track.$token.tsx`) —
they are told a confirmation is coming and told to keep the link. Cancelling a
deferred order **clears** the stamp: the promise dies with the order.

### The mockup change: submit, not approve

This is the single most consequential behavioural change in the ticket.

Before, a deferred mockup order pushed on **approve/waive/decline** — the gate
opening. That was correct while the mockup itself had its own WhatsApp send
(`notifyMockupSubmitted` carried the image + a "review this" CTA). With that
send deleted, approving-as-the-trigger would have been a deadlock: nothing would
ever tell the buyer a design was waiting, so nobody would approve, and the gate
would only ever open on the seller's 48-hour waiver.

Firing at **submit** fixes it in the same move it saves the message: the buyer's
one WhatsApp arrives exactly when there is something for them to do, carrying a
true total and a link to the page where the mockup, the Approve button and the
Request-changes box all live.

**Re-submits after a change request are silent** — the claim can only be won
once. The revised mockup appears on the buyer's page, reactively, which is where
they were already looking. See [`proof-approval.md`](./proof-approval.md).

## The claim mechanism

`claimDeferredPush` (`convex/orders.ts:391`) is a **transactional claim**, not a
check-then-send. Called from inside the mutation that just settled a price, it:

1. re-reads the order (`ctx.db.get` sees this transaction's own writes),
2. returns early if it isn't still `deferred`, or the order is cancelled, or
   **either** price hold remains,
3. otherwise patches `deferred → sending` **and** schedules the send.

**The flip IS the de-dup.** Convex mutations are serializable, so exactly one
transaction can ever observe `deferred` with both holds clear. A second settle
event racing in — the seller sets the delivery fee a second after submitting the
mockup — serializes *after* the winner, sees `sending`, and schedules nothing.
A claim inside the *action* could not guarantee this: two in-flight actions read
their metadata before either outcome commits.

### The mockup hold is `isMockupPriceUnsettled`, not `isMockupGateClosed`

`convex/lib/order.ts:129`. Two deliberately different questions:

| Predicate | Asks | True while |
| --- | --- | --- |
| `isMockupGateClosed` | *Has the buyer approved?* — the **production** gate on `confirmed → packed` | `pending`, `submitted`, `changes_requested` (unwaived) |
| `isMockupPriceUnsettled` | *Is there a quote at all?* — the **message** hold | `pending` only (unwaived) |

`submitted` and `changes_requested` both follow a submit, so both carry a real
total even though the gate is still shut. That gap is precisely where the one
message belongs.

### Why approve / waive / decline still call the claim

They are the **migration path**, and the reason no backfill was needed. Orders
already stamped `deferred` when this shipped were deferred under the old
approve-gate; their mockup may already be `submitted`. Leaving the claim call on
those three sites means such an order fires its message on the next settle event
exactly as it would have before, and then the site is a no-op forever after.

`waiveMockup` and `declineMockupItem` earn their calls twice over: a waiver
settles the price without a submit ever happening, and a decline settles it at
the ready-made remainder. Together they guarantee no order can reach a final
price without having sent its one message.

`notifyStorefrontOrderCreated` (`convex/whatsapp.ts:904`) keeps its own hold
guard as defence-in-depth. Sending a wrong `Total:` is the one mistake this
feature must never make, whatever schedules it.

## What was removed, and where the buyer gets it now

Every row below used to be an outbound WhatsApp send. All roads now lead to
`/track/<token>`.

| Deleted send | Was triggered by | Where the buyer gets it now |
| --- | --- | --- |
| `notifyStatusChange` — packed / shipped / delivered / **cancelled** | `applyStatusTransition`, `updateStatus` | Status timeline on the order page, live. |
| `notifyStageEntry` — custom-stage pings | `advanceToStage` with `stage.notify` | The same timeline, in the seller's own stage vocabulary. |
| `notifyPaymentReceived` | `markPaymentReceived` | Payment card flips to received on the page, live. |
| `notifyMockupSubmitted` — mockup image + review CTA | `submitMockup` | **Replaced by the one confirmation**, which now fires at submit and links straight to the review UI. |
| `notifyPaymentDue` (`approved` / `waived` / `declined` intros) | `approveMockup`, `waiveMockup`, `declineMockupItem` | The confirmation already went out at submit; "How to pay" lives on the page. |
| `notifyDeliveryFeeSet` | `orders.setDeliveryFee` | **Replaced by the one confirmation**, which now fires there and carries the charge + final total. |
| `notifyPaymentReminder` — automatic day-11 nudge | daily cron `paymentReminders.sendDuePaymentReminders` | Nothing. Chasing is the seller's call — see below. |
| `notifyManualPaymentReminder` — seller's "Send payment reminder" button | `orders.sendPaymentReminder` | Nothing. The seller messages the buyer themselves. |
| `orders.sendOrderDocument` / `sendOrderDocumentToBuyer` — counter receipt/invoice PDF | `notifyCounterOrderCreated`, Done-screen Resend | Download / Share on the cashier's Done screen; **Receipt** button on the buyer's own order page. |
| `notifyDeliveryPhoto` — Lalamove POD photos | `lalamove.fetchPodImages` | "Delivery photo" card on the order page + the seller's dispatch card. (This was the one send that produced *N* messages from one event — up to 3 images.) |

**Modules deleted:** `convex/lib/paymentReminder.ts`, `convex/paymentReminders.ts`.
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

- **`deferred` counts as owned.** The buyer has a message *coming*; two is still
  two, whichever order they arrive in.
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
| **There is no payment chasing over WhatsApp at all** — no day-11 cron, no manual button. | Settings → Payments, under the payment-methods card: *"Kedaipal doesn't chase unpaid orders…To nudge someone, message them yourself."* And on the unpaid Payment card of the order itself, pointing at the seller's own WhatsApp deep link. |
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
- **Re-pricing after submit leaves a stale `Total:` in the sent message.**
  `updateMockupQuote` (`convex/orders.ts:3038`) and a re-submit both recompute
  `total`, but the claim has already been won, so nothing new goes out — the
  buyer's WhatsApp still quotes the first price. This is the deliberate cost of
  one message: the alternative is a send per re-price, which is exactly the
  spend this policy removed. The order page is the live figure and is where the
  buyer pays, and the seller is re-pricing *because* they are talking to the
  buyer already. Worth knowing before assuming the message is authoritative —
  **it is a pointer, not a receipt.**
- **A legacy (no-template) mockup order gets nothing at submit.**
  `claimDeferredPush` no-ops without a `deferred` stamp, and the deleted
  `notifyMockupSubmitted` was that path's nudge. Those buyers were told at
  confirm time that a design is coming (`mockupPendingConfirm`) and see it on
  their order page. The condition disappears the moment the template env is set.
- **`orders.paymentReminderSentAt` and `orders.lastManualReminderAt` remain on
  the schema** with no writer. Harmless, and cheaper to leave than to migrate;
  drop them in the next narrowing pass.

## Related

[`order-lifecycle.md`](./order-lifecycle.md) ·
[`waba-protection.md`](./waba-protection.md) ·
[`proof-approval.md`](./proof-approval.md) ·
[`counter-checkout.md`](./counter-checkout.md) ·
[`payment-reminder.md`](./payment-reminder.md) (tombstone) ·
[`order-status-customization.md`](./order-status-customization.md) ·
[`fulfilment.md`](./fulfilment.md) ·
[`delivery-lalamove.md`](./delivery-lalamove.md)
