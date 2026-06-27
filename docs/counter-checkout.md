# Counter Checkout (in-person order spine)

> ClickUp [`86ey0e82j`](https://app.clickup.com/t/86ey0e82j). Lands **Bearcamp**
> (first paying customer — sells at a physical counter + online). The first brick
> of the offline→online **order spine**: a seller-initiated, in-person order that
> stays WhatsApp-linked, so confirmation / payment / tracking flow through the
> shared WABA like any storefront order.
>
> **Status: V1 shipped** — backend spine (schema, session/token lifecycle,
> inbound `KP-<token>` intent routing, live bind, expiry cron) **+** the
> iPad-first seller UI, order-from-session, and pay-in-person. **Deferred to
> V1.1:** the manual-phone and anonymous walk-in identity paths — see
> [§Pending](#pending). The V1 cut = Bearcamp's happy-path counter (buyer scans →
> seller keys order → paid now or pay-later).

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

## Multiple concurrent checkouts + draft persistence (2026-06-27)

Real counters serve several customers at once, and a vendor will refresh / lose
connection / step away mid-order. So the flow is **multi-session and resumable**,
not a single ephemeral in-memory session:

- **The active checkout lives in the URL** (`/app/checkout?session=<id>`), so a
  refresh or reconnect lands the vendor right back on it.
- **The home view is a list of open checkouts** (`listOpenSessions` → all the
  retailer's `awaiting_buyer` + `buyer_identified` sessions) with buyer name,
  draft item count, and age. Each can be **resumed** or **cancelled**; "Start
  checkout" opens a new one. A vendor can juggle several customers freely.
- **The in-progress cart is autosaved to the session** (`draft` field:
  items + fulfilment date + paid/method), debounced (~700ms) via
  `saveSessionDraft`. On resume, `BuildOrderScreen` hydrates the cart from the
  draft once the catalog loads (to resolve names/prices), guarded so our own
  autosaves echoing back never clobber live edits. Price/stock stay
  authoritative at `createOrderFromSession` — the draft is a scratchpad.
- **Two TTLs.** The unscanned QR keeps the short **10-min** window
  (`SESSION_TTL_MS`) — the token is live then. Once bound, the session becomes a
  seller-owned in-progress order and gets a **3-day idle window**
  (`OPEN_SESSION_TTL_MS`) that **slides on every draft edit**; `bindCheckoutSession`
  promotes the expiry, `saveSessionDraft` bumps it. Abandoned ones are swept by
  the cron so the open-checkouts list stays clean. `effectiveStatus` treats a
  past-window bound session as `expired` even before the cron flips the row.

## Schema (`convex/schema.ts`)

`counterCheckoutSessions`: `retailerId`, `sellerUserId` (Clerk), `token`,
`status` (`awaiting_buyer | buyer_identified | completed | expired | cancelled`),
`customerId?`, `waPhone?`, `waProfileName?`, `isNewCustomer?`, `orderId?`,
`draft?` (`{ items[], fulfilmentDate?, paidInPerson?, paymentMethod? }` — autosaved
in-progress order), `boundAt?`, `expiresAt`, timestamps.
Indexes: `by_token` (bind lookup), `by_retailer_status` (seller's open list),
`by_status_expiry` (expiry cron range-scan — now sweeps `awaiting_buyer` then
chains to `buyer_identified`).

**Fulfilment date:** counter orders capture an optional collection date
(defaults to **today**, the walk-in case) validated against a 0-day notice — the
seller is keying it in person, so today is always valid regardless of the
storefront `minFulfilmentNoticeDays`. See [`fulfilment-date.md`](./fulfilment-date.md).
After a **paid-in-person** order is created, the success screen offers an
optional **"Mark as completed"** button (one tap → `delivered`).

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
- **Expiry beats status on bind** — `bindCheckoutSession` checks the TTL before
  the generic status check, so a stale QR always tells the buyer "expired"
  regardless of whether the 5-min cron has swept it yet (otherwise the cron's
  timing would flip the buyer message between "expired" and a generic reply).

## Constraints

- **Mockup-gated items can't be sold at the counter (V1).** Any variant where
  `requiresProof` resolves true is **excluded from the catalog** (`app.checkout.tsx`)
  **and rejected server-side** (`createOrderFromSession`). Their flow defers
  payment until the buyer approves a design on the tracking page, which is
  incompatible with the at-the-counter pay-now/confirmed model — and would
  otherwise produce an order with no mockup gate. See
  [`proof-approval.md`](./proof-approval.md). (A counter + mockup flow is a
  deliberate later feature, not V1.)

## Observability / PII note

The inbound webhook (`convex/http.ts`) logs the buyer's phone, WhatsApp pushname,
and a 60-char message preview on every call — added to debug the `KP-<token>`
intent routing. That's **PII in Convex logs** with no retention/redaction policy
yet; revisit (trim or gate it) alongside the WABA-protection / compliance work
([`86expmgep`](https://app.clickup.com/t/86expmgep)).

---

## What's built (V1)

| Piece | Where |
|---|---|
| Intent classifier (KP / ORD / unknown) | `convex/lib/inboundIntent.ts` (+ test) |
| Session table + indexes | `convex/schema.ts` |
| `createCheckoutSession` / `getCheckoutSession` / `cancelCheckoutSession` | `convex/counterCheckout.ts` |
| `bindCheckoutSession` (internal, called by webhook) | `convex/counterCheckout.ts` |
| `createOrderFromSession` (server-priced, pay-in-person, completes session) | `convex/counterCheckout.ts` |
| Inbound routing → bind + buyer reply | `convex/whatsapp.ts` (`handleInbound`) |
| Buyer order confirmation + tracking link | `convex/whatsapp.ts` (`notifyCounterOrderCreated`) |
| Expiry cron (every 5 min) | `convex/crons.ts` → `expireStaleSessions` |
| Webhook observability (phone + pushname + text) | `convex/http.ts` |
| **iPad-first seller UI** (start → QR → live bind → catalog/cart → pay → done) | `src/routes/app.checkout.tsx` |
| Nav entry ("Counter") | `sidebar.tsx`, `bottom-nav.tsx` |
| Tests | `counterCheckout.test.ts`, `inboundIntent.test.ts`, `whatsapp.test.ts` |

**Order shape:** a counter order is created `confirmed`, `deliveryMethod:
self_collect` (collected at the counter), customer linked from the bound session.
**Pay-in-person** → `paymentStatus: received` immediately + a structured
`order.paymentMethod` (see below); **pay-later** → left `unpaid` and the buyer's
WhatsApp confirmation carries a pay-&-track link (the normal handshake). Either
way the buyer gets a WhatsApp confirmation with their tracking link, so the order
is WhatsApp-linked and status updates flow through the shared WABA.

**Payment method (`order.paymentMethod`, `convex/lib/paymentMethod.ts`):** a
structured enum — `cash | duitnow | tng | bank_transfer | card | other` — captured
**only where it's reliably known**: the Counter Checkout "Paid now" picker (the
seller witnesses the payment) and the seller's "mark payment received" action (the
seller has just verified the channel — an optional chip row on that dialog). The
buyer's online "I've paid" self-claim **never** sets it, so an online order stays
`undefined` = "online / unknown" (we don't fake a value). Surfaced on the seller
order detail's "Payment received" line **and filterable on the orders inbox**
("Method" chips → `searchOrders.paymentMethods`). Enables later analytics on the
reliable in-person data without adding buyer-side friction. Legacy counter orders
that stored the method as a `"In-person (…)"` reference string are migrated by
`migrations:backfillCounterPaymentMethod`.

## Pending (V1.1)

- **Manual-phone path** — seller types the buyer's number to bind a session
  without a scan (e.g. buyer's camera won't cooperate). Binds the session
  directly, no webhook.
- **Anonymous walk-in** — a cash sale with no contact: create the order off the
  session with no buyer identity (no WhatsApp confirmation).
- *(later, ticket 3.2)* richer Desktop / iPad Console affordances.
