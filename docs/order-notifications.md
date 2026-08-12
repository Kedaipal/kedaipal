# Seller order notifications

How a seller learns something happened on an order, across three channels:

| Channel | Events | Where configured | Requires |
| --- | --- | --- | --- |
| **Email** (`convex/email.ts`) | new order, payment claim, mockup loop, delivery-job failure, gateway mismatch | Settings → Store → Notification email | `retailers.notifyEmail` |
| **Browser** (chime + system notification, below) | new order, rider booking failed | Settings → Store → "Order alerts on this device" | a Kedaipal tab open on that device |
| **WhatsApp** (`86eyhw9zy`, below) | new order, payment claim | Settings → Store → "WhatsApp order alerts" | Pro + opt-in + approved Meta template |

## WhatsApp order alerts (86eyhw9zy, Aug 2026)

The Sengloh request: a WhatsApp ping the moment a new order lands, because
neither email nor an open dashboard tab is where a stall owner lives. Two
alerts, both sent from the shared WABA to the seller's own number:

- **New order** — fired from `orders.create` beside the email alert
  (`whatsapp.notifySellerNewOrder`). **Storefront orders only**: counter
  checkout's create path never schedules one (the seller is standing there —
  the min-order/notice exemption posture), and the action re-checks
  `order.source` as defence in depth.
- **Buyer says they've paid** — fired from `orders.claimPayment` beside the
  payment-claimed email (`whatsapp.notifySellerPaymentClaim`). **Counter
  pay-later orders ARE included** — a claim lands hours after the sale, when
  nobody is at the counter, so the standing-there rationale doesn't apply.

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
