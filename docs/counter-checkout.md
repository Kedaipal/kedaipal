# Counter Checkout (in-person order spine)

> ClickUp [`86ey0e82j`](https://app.clickup.com/t/86ey0e82j). Lands **Bearcamp**
> (first paying customer — sells at a physical counter + online). The first brick
> of the offline→online **order spine**: a seller-initiated, in-person order that
> stays WhatsApp-linked, so confirmation / payment / tracking flow through the
> shared WABA like any storefront order.
>
> **Status: backend spine shipped** (schema, session/token lifecycle, inbound
> `KP-<token>` intent routing, live bind, expiry cron, tests). **Pending:** the
> iPad-first seller UI, order-from-session completion, pay-in-person, and the
> manual-phone / anonymous identity paths — see [§Pending](#pending).

---

## The flow (flipped — confirmed by spike [`86ey0e80x`](https://app.clickup.com/t/86ey0e80x))

A buyer's personal WhatsApp QR is **opaque** (`wa.me/qr/<token>`, no phone number
off-device), so identity binding is *flipped*: the buyer scans the **seller's** QR.

1. Seller opens Counter Checkout → `createCheckoutSession` → a
   `counterCheckoutSessions` row with an unguessable single-use `token`,
   `status: awaiting_buyer`, `expiresAt` ≈ 10 min out.
2. Dashboard renders a QR of `https://wa.me/<shared_WABA>?text=KP-<token>`.
3. Buyer scans → WhatsApp opens prefilled → sends → hits the shared WABA.
4. Webhook → signature verify → adapter → **intent router**
   (`convex/lib/inboundIntent.ts`) classifies `KP-<token>` → `bindCheckoutSession`.
5. Bind resolves the customer by `(retailerId, waPhone)`, captures the pushname,
   and flips the session to `buyer_identified`.
6. The seller's `useQuery(getCheckoutSession)` updates **live** (Convex reactive —
   no polling) to the buyer's name + history.
7. *(pending)* Seller keys products → confirm → existing order-creation path →
   session `completed`.

**Compliance:** the buyer's inbound hello opens WhatsApp's 24h customer-service
window, so confirmation / payment / tracking all send **free-form** (no paid
template).

---

## Schema (`convex/schema.ts`)

`counterCheckoutSessions`: `retailerId`, `sellerUserId` (Clerk), `token`,
`status` (`awaiting_buyer | buyer_identified | completed | expired | cancelled`),
`customerId?`, `waPhone?`, `waProfileName?`, `isNewCustomer?`, `orderId?`,
`boundAt?`, `expiresAt`, timestamps.
Indexes: `by_token` (bind lookup), `by_retailer_status` (seller's active list),
`by_status_expiry` (expiry cron range-scan).

**Identity = optional, three converging paths, one record:** token-scan (happy,
**built**), manual phone entry (**pending**), anonymous walk-in / cash
(**pending**).

---

## Security (mirrors the order tracking-token hardening, [`86ey1fggw`](https://app.clickup.com/t/86ey1fggw))

- **Unguessable token** — `generateTrackingToken()` (`convex/lib/order.ts`), 24
  url-safe chars, ~142 bits. Same generator as `orders.trackingToken`.
- **Single-use** — a bind only succeeds while `awaiting_buyer`; a second scan of
  the same token returns `already_used` and leaves the original binding untouched
  (replay/hijack-safe — covered by a test where a second phone tries to take over).
- **Short TTL** — ~10 min (`SESSION_TTL_MS`). Reads compute *effective* expiry
  (`effectiveStatus`) so the UI never shows "waiting" for a dead session; the cron
  is just housekeeping.
- **Rate-limited** creation (`checkoutSessionCreate`, per Clerk subject).
- **Ownership-checked** reads/cancel (the session's retailer must belong to the
  caller).

---

## What's built (this slice)

| Piece | Where |
|---|---|
| Intent classifier (KP / ORD / unknown) | `convex/lib/inboundIntent.ts` (+ test) |
| Session table + indexes | `convex/schema.ts` |
| `createCheckoutSession` / `getCheckoutSession` / `cancelCheckoutSession` | `convex/counterCheckout.ts` |
| `bindCheckoutSession` (internal, called by webhook) | `convex/counterCheckout.ts` |
| Inbound routing → bind + buyer reply | `convex/whatsapp.ts` (`handleInbound`) |
| Expiry cron (every 5 min) | `convex/crons.ts` → `expireStaleSessions` |
| Webhook observability (phone + pushname + text) | `convex/http.ts` |
| Tests | `counterCheckout.test.ts`, `inboundIntent.test.ts`, `whatsapp.test.ts` |

The reactive `getCheckoutSession` already returns the live `status`, bound
`displayName`, `isNewCustomer`, and a returning customer's lifetime `{ orderCount,
totalSpent, lastOrderAt }` — everything the seller screen needs to flip on scan.

## Pending

- **iPad-first seller UI** — `src/routes/app.checkout.*` +
  `src/components/dashboard/counter-checkout/*`: QR render (we have `react-qr-code`),
  fast catalog search → tap → qty, live waiting/identified/expired/new-vs-returning
  states. **Its own surface — NOT bolted onto the shopper storefront.**
- **Order-from-session completion** — seller confirms → reuse `orders.create` +
  `linkOrderToCustomer`, set `session.orderId`, `status: completed`.
- **Pay-in-person** — a settled-offline "mark paid in-person" path (cash /
  DuitNow-now) alongside the existing two-button handshake.
- **Manual-phone + anonymous paths** — bind a session without a webhook (seller
  types the phone) and a cash walk-in with no contact.
