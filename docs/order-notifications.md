# Seller order notifications

How a seller learns something happened on an order, across three channels:

| Channel | Events | Where configured | Requires |
| --- | --- | --- | --- |
| **Email** (`convex/email.ts`) | new order, payment claim, payment received, mockup loop, delivery-job failure, gateway mismatch | Settings → Store → Notification email | `retailers.notifyEmail` |
| **Browser** (chime + system notification, below) | new order, rider booking failed | Settings → Store → "Order alerts on this device" | a Kedaipal tab open on that device |
| **WhatsApp** (`86eyhw9zy`, below) | new order, payment claim, payment received | Settings → Store → "WhatsApp order alerts" | Pro + opt-in + approved Meta template |

## WhatsApp order alerts (86eyhw9zy, Aug 2026)

The Sengloh request: a WhatsApp ping the moment a new order lands, because
neither email nor an open dashboard tab is where a stall owner lives. Three
alerts, all sent from the shared WABA to the seller's own number — and all on
the moments money moves:

- **New order** — fired from `orders.create` beside the email alert
  (`whatsapp.notifySellerNewOrder`). **Storefront orders only**: counter
  checkout's create path never schedules one (the seller is standing there —
  the min-order/notice exemption posture), and the action re-checks
  `order.source` as defence in depth.
- **Buyer says they've paid** — fired from `orders.claimPayment` beside the
  payment-claimed email (`whatsapp.notifySellerPaymentClaim`). **Counter
  pay-later orders ARE included** — a claim lands hours after the sale, when
  nobody is at the counter, so the standing-there rationale doesn't apply.
- **Payment actually received** (86eyd63r8) — fired from
  `orders.receiveGatewayPayment`, i.e. a HitPay settlement verified by webhook
  HMAC or the redirect reconcile (`whatsapp.notifySellerPaymentReceived`).
  Before this the event notified the seller on **no channel at all** — there
  was no payment-received email either, so the only way to learn money had
  landed was to open the dashboard.

### Why "received" is a third template, not the claim one

The two are different asks. A **claim** is the buyer's word for it: the seller
has to open their bank app and confirm. A **gateway receive** is already
verified — the order auto-confirmed itself, the money is in their HitPay
account, and nothing is required of them. Reusing the claim template (whose
params happen to match exactly) would have told sellers to go check a payment
Kedaipal had just checked for them, manufacturing work that doesn't exist.
Pinned by test: the send asserts `template.name` is **not** the claim template.

Two more deliberate asymmetries with the claim alert:

- **It is NOT fired by `orders.markPaymentReceived`.** That mutation *is* the
  seller, clicking. Telling someone what they just did is the definition of
  noise, and the buyer sees the change on their order page either way.
- **It does NOT skip cancelled orders.** A claim on a dead order is noise; real
  money landing on one is the most urgent thing a seller can be told.
  `receiveGatewayPayment` refuses a payment on an already-cancelled order
  outright (that's the `paid_after_cancel` issue path), so this only fires on a
  cancel that raced the settlement — exactly the case worth shouting about.

The gateway **mismatch / paid-after-cancel** states stay **email-only**
(`notifyGatewayPaymentIssue`). They're rare, they need an explanation a
template can't carry, and the buyer's page already blocks a second payment
while one is unresolved — see [`hitpay-gateway.md`](./hitpay-gateway.md).

### Why templates (and the env gate)

Sellers don't chat with the shared WABA, so there is normally **no open 24h
service window** — free-form text can't reach them. Each alert is therefore a
Meta-approved **utility template**, env-gated exactly like the buyer confirm
push (`WHATSAPP_ORDER_CONFIRM_TEMPLATE` precedent): unset ⇒ that alert is
silently unavailable and the settings card doesn't render, so the code ships
decoupled from Meta template review.

| Env var | Template (suggested name) | Body params (in order) | URL button |
| --- | --- | --- | --- |
| `WHATSAPP_SELLER_NEW_ORDER_TEMPLATE` | `seller_new_order_utility` | shortId, buyer name, total, fulfilment date-time ("—" when absent) | `https://kedaipal.com/app/orders/{{1}}` ← shortId |
| `WHATSAPP_SELLER_PAYMENT_CLAIM_TEMPLATE` | `seller_payment_claim_utility` | buyer name, shortId, total | `https://kedaipal.com/app/orders/{{1}}` ← shortId |
| `WHATSAPP_SELLER_PAYMENT_RECEIVED_TEMPLATE` | `seller_payment_received_utility` | buyer name, shortId, total | `https://kedaipal.com/app/orders/{{1}}` ← shortId |

The received template's body must say the payment is **settled and needs no
action** — e.g. "{{1}} has paid {{3}} for order {{2}}. It landed in your HitPay
account and the order is confirmed — nothing to check." Its params are the
claim template's exact three so the two stay interchangeable at the call site;
only the words differ, and the words are the whole point.

Register the button URL via Meta's **Add variable** control — never hand-type
`{{1}}` (the 86eyheqzv redirect-loop root cause). The deep link rides the
`shortId` (the seller is Clerk-authenticated on /app), never the buyer's
capability token.

These are the **first URL buttons on a non-`/track/` path**, so the Worker's
pre-router rescue was generalised to cover them (PR #178 review, finding 2):
`rescuePlaceholderUrl` now strips a leading `{{n}}` from *any* path segment,
so a mis-registration here 301s to `/app/orders/ORD-XXXX` instead of
307-looping the seller out of their own order. That is a **safety net for
links already sent**, not a substitute for registering the button properly —
see [`buyer-page-resilience.md`](./buyer-page-resilience.md).

### Language: EN + BM, driven by `retailers.locale`

Both templates are submitted with **English and Bahasa Malaysia** variants and
the send picks one from the store's locale — the same switch the retailer's
**email** alerts have always used (`renderRetailerEmail(meta.locale, …)`), so a
BM seller reads BM on both channels. An EN-only WhatsApp alert next to a BM
email would have been the odd one out.

Resolution goes through **`TEMPLATE_LANGUAGE`** (`convex/lib/whatsappCopy.ts`),
an exhaustive `Record<Locale, "en" | "ms">` that is the ONE author of template
language for every template send — the buyer confirmation push included (it
previously carried its own `locale === "ms" ? …` ternary). **zh rides EN**: the
copy catalog is zh-complete but no zh *template* is approved, and naming an
unapproved language makes Meta reject the send outright — that would silently
kill a zh store's alerts rather than degrade them. Adding a 4th locale is a
compile error here, never a silent English fallback (the 86eybjw5n rule).

Two deliberate carry-overs, both matching what the retailer emails already do:
- the **fulfilment date** in `{{4}}` is formatted by `formatFulfilmentDateTime`,
  which is EN-only (`Tue, 12 Aug 2026 · 3:30 PM`), so a BM alert carries an
  English date. Localizing that formatter is a cross-surface i18n change (buyer
  WhatsApp, emails, tracking, PDFs all share it), not this feature's job;
- the **/app dashboard** the button opens is English until the i18n `/app`
  sweep — the emails link to the same English pages today.

`retailers.locale` is one field serving two audiences (what shoppers receive,
what the seller receives). The settings card's label was narrowed to "Message
language" and its helper now states both reaches, so the shared field isn't
hidden behaviour. Splitting seller-UI language from buyer-message language
belongs to the `/app` localization phase, if it's ever worth the second field.

### Category decision: `utility_template`, not `transactional`

A seller alert is not part of the buyer order promise, so it **respects the
WABA gateway**: kill switch, per-retailer caps, the quality halt, and the
global STOP opt-outs (`makeGuardedSender(ctx, retailerId, "utility_template")`).
It also counts in the **same cap bucket as buyer messages** — the ticket's
7 Aug 2026 decision (Pro absorbs the Meta cost; no add-on SKU; alerts share
the order-cap margin math). If the seller's own number holds a STOP opt-out,
the gateway suppresses the send and the settings card surfaces it
(`notifyWaPhoneOptedOut`) with the reply-START fix, so the toggle is never a
silent no-op.

Failures retry on the confirm-push classifier (`classifyPushFailure`:
30s → 2m → 8m, ambiguous 2xx never retried). Final failure is only logged —
**this phase the email alert still fires independently for every event**, so a
gated/failed WA alert never means zero notification. Replacing the email when
the WA alert succeeds (with automatic email fallback on WA failure) is the
follow-up ticket; until it lands, an opted-in seller gets both.

### Config + settings surface

- Schema: `retailers.notifyWaPhone` (normalized `60…` MY mobile — deliberately
  separate from `waPhone`, the buyer-facing store contact / wa.me fallback /
  Lalamove sender, same split as `notifyEmail` vs the Clerk email) +
  `retailers.orderWaAlerts` (opt-in, off by default). Dev-only widen.
- `updateSettings`: number validated via `assertValidMyMobile` (landlines
  rejected) and refused if it equals `WHATSAPP_CHECKOUT_PHONE` (the WABA can't
  message itself). **Enabling is Pro-gated** (`PLAN_FEATURES.waOrderAlerts`,
  admin act-as bypasses); disabling and clearing are un-gated (downgrade never
  traps). Clearing the number switches the toggle off with it.
- Settings → Store → **"WhatsApp order alerts"** card
  (`src/components/settings/wa-order-alerts-card.tsx`), grouped with the
  browser + email notification cards. Renders only when
  `retailer.waOrderAlertsAvailable` (template env set). Input prefills from
  `waPhone`; copy names both events, the counter exclusion, the alert language,
  and that email + browser alerts keep working alongside. Starter sees
  disabled-with-reason + the Pro chip.
- Deliberately **not** on the /pricing table yet — the feature is env-gated on
  Meta approval, and the table must never promise what a deployment can't do.
  Add the row when the templates are live in prod.

## Browser alerts — chime + system notification (per device)

Shipped Jul 2026 alongside the Lalamove release (ClickUp `86eyb5hrf` polish
round). The seller's ask: know the moment an order lands without flooding
WhatsApp — a chime + system notification on whatever device has the
dashboard open.

### How it works

- `convex/notifications.ts` `latestActivity` — one tiny owner-or-admin query:
  newest order stamp + newest FAILED delivery booking (last-10-jobs window).
  **Convex reactivity is the push channel** — no polling, no service worker.
- `src/hooks/useOrderNotifications.tsx` — `OrderNotificationsBridge`, mounted
  once in the authed app shell. The first sample after (re)subscribe is a
  BASELINE (page loads never chime for existing orders); later increases
  raise: WebAudio two-tone chime (no asset), a system `Notification`
  (`tag`-collapsed, click focuses + navigates to the order), a 6s tab-title
  flash, and an in-app toast fallback.
- Events: **new order** and **rider booking failed** (money-relevant only —
  deliberately not every status change).
- Preferences are **per device** (`localStorage`): master switch + sound.
  The master switch also gates the Convex subscription, so disabled devices
  hold no extra subscription.

### Settings surface (discoverability)

Settings → Store → **"Order alerts on this device"** card
(`src/components/settings/notifications-card.tsx`). Every permission state
has a next step:
- unsupported browser (iOS Safari non-PWA) → explains Add-to-Home-Screen /
  desktop Chrome;
- `default` → "Turn on order alerts" (permission prompt + test alert);
- `denied` → concrete unblock steps (lock icon → Site settings →
  Notifications → Allow, + Android Chrome path);
- `granted` → Turn off / Sound on-off / Send a test.

### Deliberate limits

Alerts require a Kedaipal tab open somewhere (foreground or background).
True closed-browser Web Push (service worker + subscriptions + VAPID) is the
existing roadmap item **"PWA + Push" (S4)** — the card's footnote tells
sellers that upgrade is coming, so today's behavior never reads as broken.

## WhatsApp replaces email for the seller alerts (2026-08-08, `86eyd63r8`)

The seller alerts shipped as a deliberate **double-notify** — WhatsApp *and*
email on the same event — while the WA path bedded in. That's now retired:
**WhatsApp is the channel, email is the fallback.** Never both, never neither.

Suppression is in **one place per event**,
`internal.email.notifyRetailerOrderAlert` / `notifyPaymentClaimed` /
`notifyPaymentReceived`, not at the call sites — so every caller (order create,
`claimPayment`, `receiveGatewayPayment`, and both inbound-confirm paths in
`handleInbound`) is covered by construction and the rule can't drift between
them.

The decision runs in two steps, because "we scheduled a WhatsApp alert" is not
the same as "the seller heard about it":

1. **Schedule time** — the email no-ops when
   `sellerWaAlertWillAttempt(retailer, …)` (pure, `convex/lib/sellerAlerts.ts`)
   says the alert can actually be attempted: event template env set, the
   seller's `orderWaAlerts` toggle on, `notifyWaPhone` saved, and — for the
   **new-order** alert only — not a counter sale. Anything falsy and the email
   fires exactly as before. That's every Starter seller (the toggle is
   Pro-gated) and everyone who never opted in.
2. **Failure time** — `notifySellerNewOrder` / `notifySellerPaymentClaim` /
   `notifySellerPaymentReceived` schedule the email with **`force: true`** when
   they give up: gateway-blocked (opt-out / cap / quality pause) or a terminal /
   retries-exhausted send failure. `force` bypasses step 1, which is the whole
   point — that email is needed precisely when the suppression would otherwise
   silence it.

The WA actions deliberately **do not** force the email on their own early
returns (template env unset, toggle off, no number). Those are the exact
conditions `sellerWaAlertWillAttempt` reads, so the email has already decided
not to suppress itself — forcing there would send the seller two. Pinned by
test.

Between them a seller never ends up with zero notification, which is the
property the old unconditional email existed to guarantee. Browser alerts are
untouched.

**The counter asymmetry is load-bearing.** `isCounterOrder` suppresses the
new-order WA alert (the seller rang it up in person), so the predicate must
report `false` there or a counter order would notify nobody. A payment *claim*
or *receive* passes no counter flag at all — both land hours after the sale,
when nobody is standing at the counter.

**Where the seller is told:** the WhatsApp-order-alerts card in Settings →
Store (it names all three events, the counter exclusion, and "if one can't be
delivered, the email goes out as backup"), and the Notification email field
description, which names the same relationship from the other side.

**Tests:** `convex/lib/sellerAlerts.test.ts` asserts every falsy input
explicitly — a wrong `true` is the dangerous direction, since it suppresses an
email for an alert that never fires. `convex/oneMessagePerOrder.test.ts` asserts
the seller alerts still fire *positively*, so excluding them from the
buyer-message gate can't quietly become a hole.

**Not covered by one-message-per-order.** That policy caps what we push at a
**buyer**. A seller opting in to be pinged about their own shop is a different
budget and a different consent — see
[`one-message-per-order.md`](./one-message-per-order.md).
