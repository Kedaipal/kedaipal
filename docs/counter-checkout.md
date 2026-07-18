# Counter Checkout (in-person order spine)

> ClickUp [`86ey0e82j`](https://app.clickup.com/t/86ey0e82j). Lands **Bearcamp**
> (first paying customer — sells at a physical counter + online). The first brick
> of the offline→online **order spine**: a seller-initiated, in-person order that
> stays WhatsApp-linked, so confirmation / payment / tracking flow through the
> shared WABA like any storefront order.
>
> **Status: V1 shipped** — backend spine (schema, session/token lifecycle,
> inbound `KP-<token>` intent routing, live bind, expiry cron) **+** the
> iPad-first seller UI, order-from-session, and pay-in-person. **V1.1 shipped**
> ([`86ey8vqp6`](https://app.clickup.com/t/86ey8vqp6)) — the manual-phone and
> anonymous walk-in identity escape hatches, see
> [§Manual entry & anonymous](#manual-entry--anonymous-walk-in-86ey8vqp6). The V1
> cut was Bearcamp's happy-path counter (buyer scans → seller keys order → paid
> now or pay-later); V1.1 removes the "buyer must scan" precondition.

---

> **⚠️ Superseded in part by [§One QR](#one-qr--the-store-poster-replaces-the-per-session-qr-86ey5neg6) (`86ey5neg6`).**
> The per-session `KP-<token>` flow described in the historical sections below
> (`createCheckoutSession` / `bindCheckoutSession` / `AwaitingScreen` / the
> `checkout_bind` intent) has been **removed**. Counter checkout now uses a single
> permanent store QR (`KPS-`); "Start checkout" just presents it, and the walk-in
> session is created when the buyer scans. Read the historical sections for
> lineage, but the One-QR section is the current behaviour.

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
  checkout" opens a new one. A vendor can juggle several customers freely. The
  **3-day TTL is surfaced in the list copy** so the vendor knows where abandoned
  checkouts go (CLAUDE.md: make every feature discoverable). On resume, a saved
  cart line whose variant was since deactivated/deleted is dropped **with a toast**
  ("N item(s) no longer available"), never silently.
- **`getCheckoutSession` returns `null` for a not-found OR not-owned id** (not a
  thrown `Forbidden`). The active session is URL-addressable now, so a stale or
  foreign id degrades to the friendly "checkout not found" screen instead of an
  unhandled crash — and never reveals whether another store's session exists.
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

**`orders.source` — the checkout surface** ([`86ey8r734`](https://app.clickup.com/t/86ey8r734)):
a first-class field on `orders`, `v.union("storefront","counter")`, distinct from
`channel` (the messaging transport, always WhatsApp). `createOrderFromSession`
stamps `"counter"`; the storefront `orders.create` stamps `"storefront"`.
Optional/dev-only widen, no backfill — **undefined reads as `"storefront"`** (same
posture as `pickupSnapshot.locationType`). It drives per-surface UI:

- **No fulfilment-date urgency badge** and **excluded from the `dueToday` count**
  — a counter date is defaulted, not promised (see `fulfilment-date.md`).
- **"Completed", not "Delivered".** A counter sale finishes at the counter — there
  was no delivery/collection leg — so its terminal `delivered` status reads
  **"Completed"** (MS: "Selesai") on the inbox card + order detail, via
  `displayStatusLabel(order, resolved)` (mirrored in `src/lib/orderStatus.ts` ↔
  `convex/lib/orderStatus.ts`). Presentation only — the canonical `delivered`
  status is unchanged.
- **Inbox filter.** The order inbox filter sheet gains an **Order type** section
  (Online / Counter) — an in-memory predicate in `convex/lib/orderInboxFilter.ts`
  (no index), threaded through `searchOrders` + `exportOrders`. See
  [`order-inbox.md`](./order-inbox.md).

**Identity = optional, three converging paths, one record:** token-scan (happy,
**built**), manual phone entry (**built**, `86ey8vqp6`), anonymous walk-in / cash
(**built**, `86ey8vqp6`). See
[§Manual entry & anonymous](#manual-entry--anonymous-walk-in-86ey8vqp6).

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

## Made-to-order / custom items at the counter (2026-06-27)

Counter Checkout **sells made-to-order items** — both `isCustom` (quote) lines
and fixed-price `requiresProof` ("needs design approval") variants. They were
originally blocked (the storefront mockup-approval round-trip defers payment
until the buyer signs off a design on their tracking page, which fights the
at-the-counter pay-now model). **In person that round-trip is moot** — design +
price are agreed face-to-face — so the block is lifted:

- **Catalog** shows all active variants (`app.checkout.tsx`). A **custom (quote)
  line has no catalog price**, so its row exposes an inline **RM price input**;
  the vendor types the agreed price, then adds. Fixed-price `requiresProof`
  variants use their normal price (no entry).
- **No mockup gate.** Counter orders are created `confirmed` with no
  `mockupStatus` — there's nothing to approve, the buyer has it (or will collect).
  No image is required either.
- **Price trust boundary.** `createOrderFromSession` takes a per-item
  `unitPrice`, but trusts it **only for `isCustom` lines** (validated as a
  positive integer in sen — the **same rule as any product price**, no upper cap,
  since the vendor's business could be high-value: watches, renovations, B2B
  services); every normal line always uses the authoritative `variant.price`, so a
  tampered client can't reprice a fixed product. That custom-only trust — not any
  ceiling — is the actual security control. The vendor-set price is autosaved on
  the draft (`unitPrice`) so a resume restores it.

See [`custom-option.md`](./custom-option.md) and
[`proof-approval.md`](./proof-approval.md).

## Review-before-create (no price ceiling)

Counter prices have **no upper cap** — same rule as any product price (positive
integer in sen); the vendor's business could legitimately be high-value (watches,
renovations, B2B services). The guard against a fat-fingered amount (an extra
zero: RM 5M instead of RM 500k) is **not** an arbitrary limit but a **mandatory
review step**: tapping **"Review order"** opens a confirm modal
(`ConfirmCheckoutDialog`) that lays out every line (qty × unit price → line
total), the collection date, the payment method, and the grand total before the
order is created — the same "look before you pay" beat a normal storefront gives.
The small cart panel is easy to skim past on a busy day, so the full breakdown is
forced into view. **Counter-only:** the storefront buyer already reviews their own
cart before sending the order, so the standard order flow (incl. marking complete)
is unchanged.

## Cancelling a checkout (destructive — confirm required)

Cancelling drops the open checkout **and any items drafted onto it** — it's a
hard delete, not a reversible archive — so both entry points are gated behind a
confirm step (`ConfirmDialog`, see below):

- **Open-checkouts list** — the trash button on each `SessionRow` opens one
  shared confirm at the list level (`OpenCheckoutsList`), naming the buyer /
  waiting checkout being dropped.
- **Active "Waiting for buyer" screen** — the **"Cancel checkout"** link
  (`AwaitingScreen`) confirms before tearing down the QR so the buyer can no
  longer connect.

`ConfirmDialog` (`src/components/ui/confirm-dialog.tsx`) is the **shared
confirmation step for every destructive action** in the app (counter cancel,
single-order cancel, bulk cancel). Reach for it instead of hand-rolling another
`Dialog` — it standardises the copy/layout, renders the confirm button in the
destructive (red) style, awaits an async `onConfirm` (spinner + un-dismissable
while in flight), and keeps itself open if the action throws so the caller's
error toast stays visible. Reversible archives (e.g. deactivating a product or
pickup location) deliberately do **not** use it.

The pay-in-person **payment-method `<select>`** uses the same 16px (`text-base`)
sizing as every other native select in the app — sub-16px controls trigger an
iOS focus-zoom and render cramped option lists on mobile.

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
| Receipt/invoice **send to buyer's WhatsApp** + download/share (Done screen) | `src/components/order/send-order-document.tsx`, `orders.sendOrderDocumentToBuyer` |
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

## Receipt / invoice to the buyer — scan once, no rescan ([`86ey4fz3w`](https://app.clickup.com/t/86ey4fz3w))

The whole point of the QR is that the buyer scans it **once** to bind their
WhatsApp number. Everything after — confirmation, receipt, invoice, payment
details — rides that same chat **automatically**, so they never scan again and
the seller doesn't have to remember a manual step.

- **Humanized, localized copy.** The inline English bind reply + counter
  confirmation strings were moved into the `whatsappCopy` catalog as system
  messages (`counterCheckoutBound` / `Expired` / `Used`, `counterOrderConfirmed{Paid,Unpaid}`),
  warmed up, and **localized to the store's locale** (`bindCheckoutSession` now
  returns `locale`; `not_found`, which has no store, stays English). Same
  transactional category — order messages bypass WABA gating.
- **Automatic send on checkout** (`whatsapp.notifyCounterOrderCreated`, scheduled
  by `createOrderFromSession`) — the buyer's chat gets, with no seller action:
  - **Paid now** → a "confirmed & paid" text, then the **Receipt** PDF.
  - **Pay later** → a lean payment ask — the amount + order-page link (in the
    intro copy) + transfer-reference line + the **"Make payment"** CTA button (via
    `sendPaymentMessage`), then the **Invoice** PDF. Raw bank/QR details are
    **never sent in the chat** (ticket 86ey98ju1) — the link points to the order
    page's "How to pay", and the invoice PDF carries the actual details as the
    formal document. The intro carries the link, so no separate "see how to pay"
    block is appended (the buyer sees the link once, not twice).
- **One PDF, two faces:** `buildOrderReceiptPdf` keys off `OrderReceiptData.paid` —
  an unpaid order prints **"Invoice"** + the "How to pay" block, a settled one
  prints **"Receipt"**. No separate invoice builder or table.
- **Delivery plumbing:** `orders.sendOrderDocument` (internal, orderId-keyed, no
  auth — trusted scheduler) and the manual `orders.sendOrderDocumentToBuyer`
  (seller-auth via `resolveSharedOrder(shortId)`) both call the shared
  `deliverOrderDocument`: render → store transiently (a URL Meta fetches) → send
  as a WhatsApp **`document`** (channel-adapter outbound kind) `transactional` →
  scheduled `deleteTransientStorage` reclaims the blob (deterministic, never
  persisted).
- **Done screen = resend + download/share** (`src/components/order/send-order-document.tsx`):
  since the document is already sent automatically, the screen frames it as
  *"already sent — resend or download here if you need to"* (Resend → the manual
  action, Download/Share → `orders.generateReceiptPdf` bytes via the OS share
  sheet, falling back to download on desktop). Only renders on the fresh-create
  path (has the `shortId` + accurate paid state); a resend from **order detail**
  is a noted follow-up.

### Pay-at-bind — payment info right after the scan ([`86ey5kq7p`](https://app.clickup.com/t/86ey5kq7p))

> **⚠️ Removed by [`86ey98ju1`](https://app.clickup.com/t/86ey98ju1).** Raw bank/QR
> details are no longer sent in the WhatsApp chat, so the scan-time payment push
> (`notifyCounterCheckoutPayment`, `getRetailerPaymentContext`, the
> `counterCheckoutPaymentIntro` copy, and the `AwaitingScreen` "they'll get your
> payment details right away" helper) was **deleted**. There's also no order —
> hence no tracking page — at scan time, so there's nothing payable to point at
> yet. The buyer now gets the payment info once the cashier rings up the order:
> the order-create message carries the order-page link (in its intro) + the
> **"Make payment"** button (→ order page's "How to pay") + the invoice PDF. The original design is kept
> below for history.

So the buyer can pay **whenever they're ready** — often while the cashier is
still ringing items up — the seller's payment details are pushed **immediately
after the bind ack**, not held until the order is created.

- `handleInbound`'s `checkout_bind` branch schedules
  `whatsapp.notifyCounterCheckoutPayment` (`runAfter(0)`) right after sending the
  `counterCheckoutBound` ack — scheduled, not inline, so the ack always lands
  first and a payment-send hiccup can't fail the bind reply.
- The action loads the retailer's resolved methods via the retailerId-keyed
  `getRetailerPaymentContext` query (no order exists yet at scan time), then
  sends a friendly intro (`counterCheckoutPaymentIntro`, EN + MS) + the
  `renderPaymentMethods` block + one image per QR method. **No-ops** when the
  seller has no methods configured (nothing to send — no empty header).
- Sent as a gated **`session_message`** (the retailer is now known, so per-seller
  caps + kill switch + opt-outs apply) — unlike the transactional order docs.
- **No double-send:** the pay-later order-create message drops the methods block
  (above), so the buyer sees the bank/QR **once** per session, at scan.
- No tracking URL / "I've paid" CTA here — there's no order yet; those arrive
  with the order-create confirmation once the cashier finalizes.
- **Seller-side discoverability:** the "Ask the buyer to scan" screen
  (`AwaitingScreen`, `app.checkout.tsx`) shows a one-line helper — *"They'll also
  get your payment details right away, so they can pay while you ring up"* —
  gated on the retailer having ≥1 payment method configured, so it's never shown
  when nothing would actually be sent.

### Printable static store QR poster ([`86ey5m35w`](https://app.clickup.com/t/86ey5m35w))

One QR the seller **prints and puts up at the counter** — any walk-in buyer scans
it to start checkout themselves, instead of the cashier minting a per-session QR
for each customer. The per-session `KP-` QR embeds a single-use token so a
printed copy dies after one scan; this poster QR is the durable answer.

**The model — security is behavioural limits, not token secrecy.** A poster token
is printed on a wall, so it was never going to be secret. Security comes from:
rotation (kills leaked posters), per-`(store, phone)` rate limits, a per-store cap
on concurrent open walk-in sessions, and the retention purge — NOT from hiding the
token. The residual risk (someone photographs the poster and scans from home) is a
single dismissible junk session that auto-expires; **no order or payment can
result, because only the cashier builds orders.** (Option B — a web redirect that
mints a fresh single-use token per scan — was rejected for v1: worse counter UX,
and the mint URL is exactly as public, so it needs the same limits anyway.)

- **Token:** `retailers.counterQrToken` — permanent, random (`generateTrackingToken`
  alphabet), **never** the slug; indexed `by_counterQrToken`. `ensureCounterQrToken`
  is idempotent (the card's Generate button can't rotate by accident);
  `rotateCounterQrToken` replaces it (confirm-gated in the UI — old posters die).
- **Flow:** poster encodes `wa.me/<WABA>?text=…KPS-<token>…`. The inbound router
  (`inboundIntent.ts`) classifies `KPS-<token>` → `store_checkout_start` (checked
  **before** `KP-`; the literals can't shadow each other, pinned by a test) →
  `startSessionFromStoreQr` **creates or re-claims** a `buyer_identified` session
  flagged `origin: "store_qr"`. A rescan by the same buyer re-claims the open
  session (no duplicate row, no rate-limit charge). `handleInbound` acks with
  `storeQrConnected` (localized). *(The scan-time payment push was removed by
  86ey98ju1 — see the Pay-at-bind note above; the buyer gets the payment CTA at
  order-create instead.)*
- **Guards, in order:** unknown/rotated token → `not_found` (generic reply, no
  store leaked); re-claim; then the `storeQrScan` rate limit (`3/hr` per
  `(store, phone)`) + `MAX_OPEN_STORE_QR_SESSIONS` (10) cap → `busy` reply.
- **Seller UI:** a **Store QR card** on the walk-in desk screen (`StoreQrCard`,
  `app.checkout.tsx`) — Generate + Rotate + a quick on-screen QR (printing moved to
  the deluxe A4 at `/app/poster`, see One-QR below). Walk-in sessions carry a
  **"Walk-in scan"** badge in the open-checkouts list (`origin` on `listOpenSessions`).
- **PDPA notice at collection** (see `86ey5m3hx`): a poster buyer never touches the
  website before their number is stored, so the `storeQrConnected` ack **and** the
  printed poster both carry the `kedaipal.com/privacy` line (EN + BM).
- **Retention purge:** `purgeStaleSessions` (daily cron) **deletes** dead sessions
  (`expired`/`cancelled`) ~30 days after they die — they hold buyer phone numbers
  and the poster raises junk-scan volume, so they must not live forever.
  `expireStaleSessions` only *flips* status; this is the row-deleting sweep.
  Completed sessions are kept (they link to orders; order retention is `86ey5m3hx`).

### One QR — the store poster replaces the per-session QR ([`86ey5neg6`](https://app.clickup.com/t/86ey5neg6))

Counter checkout had **two** QRs (the per-session `KP-` on `AwaitingScreen` +
this permanent `KPS-` store QR), which confused sellers. Decision (CTO): **one
QR** — the static store QR is now the *only* counter QR.

- **Per-session flow removed.** Deleted `createCheckoutSession`,
  `bindCheckoutSession`, the `checkout_bind` intent + `CHECKOUT_TOKEN_REGEX`, the
  `counterCheckoutBound/Expired/Used` copy, `AwaitingScreen`/`ExpiryCountdown`, and
  the `checkoutSessionCreate` rate limit. The `awaiting_buyer` status literal is
  **kept** in the schema union (migration-safe — prod rows may exist), just never
  created; `expireStaleSessions` still sweeps it harmlessly.
- **No "Start checkout" button.** The QR is static, so there's no per-buyer
  ceremony. The Counter page shows the **one** store QR **compactly in the header**
  (`StoreQrChip`) — tap to enlarge for a buyer to scan; the walk-in session is
  created when they scan. Token auto-provisions silently. **All QR management
  (rotate) moved off this page to `/app/poster`** (its natural home — it already
  ensures the token + prints the A4). The redundant on-page "Store QR card" was
  removed.
- **Buyer pairing code — made actionable.** `startSessionFromStoreQr` mints a short
  `counterCheckoutSessions.pairingCode` (e.g. `K7` — 1 unambiguous letter + digit,
  unique among the store's open walk-ins), returned to the ack copy
  (`storeQrConnected` shows *"Your order code is `*K7*`"*) **and** surfaced as the
  open-checkouts list row's avatar. The list has a **search box** (filter by code
  or name) with **Enter-to-open** on a single match — so the cashier acts on the
  code the buyer shows them instead of eyeballing the list. A re-claim returns the
  **same** code.
- **Download → `/app/poster`.** The counter card's print button links to the deluxe
  A4 poster (`86ey5m4m9`) — one poster renderer (the old client-side PNG builder +
  `escapeXml` were removed). Rotate now lives on `/app/poster` too.
- **Dashboard QR dialog (`StorefrontQrDialog`)** now shows **both** QRs ("Order
  online" + "At the counter") each with its own Download-PNG, centered/width-capped
  on desktop, keeping the "printable A4 poster →" link. (This is the quick
  standalone-PNG grab; `/app/poster` remains the branded print.)
- **Payment-at-scan removed** (`86ey98ju1`): the scan no longer pushes payment
  details (raw bank details out of chat + no order/tracking page exists yet at
  scan time). The buyer gets the order-page link + "Make payment" button at
  order-create instead.

#### Auto-open on scan (follow-on, same ticket)

The "buyer scans → cashier picks the card out of the list" step had a needless
beat: with the enlarged store-QR dialog open (`StoreQrChip`), the cashier is
*already* waiting on that one buyer, so making them close the dialog and hunt for
the new card is friction. Now the dialog **jumps straight into the checkout the
scan produces**.

- When the dialog opens it snapshots the walk-in (`origin: "store_qr"`) session
  ids currently in `listOpenSessions` (`walkInSessionIds`). The **first** id that
  appears afterwards and isn't in that baseline (`newWalkInSince`) is *this*
  buyer — the dialog closes and `onScanned` navigates to their build screen. The
  list is sorted most-recently-active first, so a fresh scan sorts to the front.
- Diff logic is a pure helper (`src/lib/counter-scan.ts`, unit-tested) so the
  React effect is a thin wire-up.
- **Gated on the dialog being open** on purpose: a background scan of the printed
  poster while the cashier is mid-building another order still just lands quietly
  in the list (never yanks them off their current work). It also only reacts to
  `store_qr` origins — manual-phone / anonymous (`cashier`) sessions already
  self-navigate via `onStarted`, so they're excluded from the baseline diff.
- **Re-claim caveat:** a returning buyer who already has an open session doesn't
  mint a new row (`startSessionFromStoreQr` reclaims it), so re-scanning the
  on-screen QR won't auto-open — their existing checkout is still findable by
  code. The fresh-walk-in case (the overwhelming majority) is what this covers.
- `StoreQrChip` now shares the same `listOpenSessions` subscription
  `OpenCheckoutsList` holds (Convex dedupes), so the list is warm the instant the
  dialog opens and the baseline snapshot is accurate on the first frame.

### Build-screen UX polish (same ticket)

Shipped alongside the receipt/invoice work, all in `src/routes/app.checkout.tsx`:

- **Product images in the catalog** — each product shows its first product-level
  image (`imageUrls[0]`, resolved by `products.listForCounter`) via a shared
  `ProductThumb` (placeholder tile when there's no image). Variant rows stay
  image-free — one glance-able thumbnail per product is enough at the counter.
- **List ↔ grid view, remembered** — a toggle in the catalog header switches
  between the accordion list and an image-forward grid; the choice is persisted
  in `localStorage` (`useCatalogView`) so the next checkout opens in the same
  view. Grid tiles open the product's variants in a modal — both views render the
  **same** `ProductVariantRows` (the custom-price + stepper logic lives in one
  place, not duplicated).
- **Cancel from the build screen** — a "Cancel checkout" button (confirm-gated,
  reuses `cancelCheckoutSession` + the existing `onCancelActive` flow) so a vendor
  can drop the whole order in place when the customer changes their mind, without
  going back to the list first.
- **Humanized QR prefill** — `buildCheckoutWaUrl` now prefills a warm first-person
  message (*"Hi! 👋 I'd like to check out at the counter. My order ref: KP-…"*)
  instead of a bare token. Only the `KP-<token>` ref is load-bearing (the intent
  router scans for it anywhere in the text); URL-encoded for the emoji/newlines.
  There's no order number yet at scan time (the order is created *after* binding),
  so the ref is the token.
- **Uniform list header** — the "Start checkout" CTA moved *inside* the walk-in
  desk card so it spans full width and lines up with the open-checkout cards on
  desktop (no ragged button column).

## Manual entry & anonymous walk-in (`86ey8vqp6`)

The V1.1 identity escape hatches — the cashier can ring up **any** buyer, even one
who won't/can't scan (no WhatsApp, dead camera, in a hurry, privacy-shy). Same
"three converging paths, one record" model as the scan: both land a normal
`buyer_identified` session that the rest of the flow (draft → `createOrderFromSession`
→ receipt/invoice) treats identically. Discoverable via a **"No scan?"** control in
the Counter page header, alongside the store-QR chip.

**Buyer name** — the session's name lives in `waProfileName` (shared slot: an
inbound pushname on a scan, the cashier-typed name on manual/anonymous). It flows
onto the order snapshot + seeds the CRM row. Manual-phone **requires** a name (in
the modal); an anonymous walk-in's name is **optional and editable inline** on the
build screen (`setSessionCustomerName` → debounced save; trims + caps at 60, blank
clears). A provided name must be **≥3 chars** everywhere (a single letter isn't a
name) — required on the manual-phone bind, and enforced-if-present on the optional
anonymous name (the inline editor only saves an empty or ≥3-char value, so the
rule never fires mid-type). One shared validator seam in `convex/lib/customer.ts`
(`requireCustomerName` / `normalizeOptionalCustomerName`) backs **both** the
counter paths **and** `orders.create`, so the rule holds server-side on every
order-create path — a direct mutation call can't bypass the storefront form. The
storefront checkout name is now **required** (≥3)
too (`checkoutFormSchema`, mirroring the `fulfilmentDate` optional-at-protocol /
required-in-UI pattern — `orders.create` keeps `customer.name` optional for
legacy/other callers).

**Manual phone** — `counterCheckout.bindSessionManualPhone` (owner-or-admin,
admin-audited). The cashier types the buyer's number + name; the number is
normalized by
`assertValidMyWaPhone` (`convex/lib/slug.ts`) to the **same E.164 digits an inbound
scan produces** (`0xx…` → `60xx…`; `60…`/`+60…` kept) so it resolves-or-creates the
exact same `(retailerId, waPhone)` customer — a returning buyer is recognised, never
forked. The bind is direct (no webhook, no rate-limit/cap — those guard the public
poster token, not a logged-in seller). The buyer still gets the WhatsApp confirmation
+ receipt/invoice and a CRM row. **PDPA:** the buyer never scanned, so the confirmation
is our first message to them — it carries the same notice-at-collection line as the
poster ack (`whatsappCopy.privacyNoticeLine`, threaded via `notifyCounterOrderCreated`'s
`includePrivacyNotice`; scan buyers already got it at connect, so it's not repeated).
**Caveat (graceful degradation):** a manual-phone buyer never opened a 24h WhatsApp
session window, so a free-form send may be rejected by Meta. Sends are best-effort
(errors logged) so the order/CRM are always intact; full out-of-window Utility-template
fallback is [`86ey1fgjw`](https://app.clickup.com/t/86ey1fgjw), a follow-up.
**Payment details:** a manual-phone **pay-later** buyer (like every buyer now,
post-86ey98ju1) gets the order-page link + **"Make payment"** button on the
order-create message plus the bank/QR details inside the **invoice PDF**
(`How to pay` block) — never raw digits in the chat. (The old scan-time pay-ahead
push was removed for everyone by 86ey98ju1.)

**Anonymous** — `counterCheckout.startAnonymousSession`. A cash sale with **no phone
contact**: the session has no `waPhone`/`customerId` (an optional name is allowed —
see above), `createOrderFromSession` writes an order with no `customerId`/phone (name
optional), **no customer aggregate is touched**, and **no WhatsApp is scheduled**
(belt-and-braces: `notifyCounterOrderCreated` also no-ops on a missing
phone). Anonymous **forces paid-in-person** — there's nobody to send a pay-later link
to — enforced server-side and surfaced as a disabled-with-reason "Pay later" toggle.
Anonymous orders render **"Walk-in customer"** everywhere a name shows (inbox card,
order detail, CSV export) via the shared `orderCustomerLabel` (`convex/lib/customer.ts`
↔ `src/lib/customer.ts`) — never blank/crash. The Done screen hides the "sent to buyer"
framing and offers **Download / Share only**.

**Re-claim safety** — if a manually-bound buyer later scans the store QR with the same
number, `startSessionFromStoreQr`'s re-claim now spans **all** open sessions (every
origin), so it resumes the existing session instead of forking a duplicate.

**No schema change** — the session already had optional `waPhone`/`customerId`; an
anonymous session is simply a `buyer_identified` row with no phone, and an anonymous
order is `customer: {name: undefined, waPhone: undefined}` (both already optional).

## Pending

- **Resend from order detail** — the "Send receipt/invoice to buyer" action is
  currently only on the counter Done screen; order detail has Download only.
- ~~**Pay-at-scan message rework** ([`86ey8vqk1`](https://app.clickup.com/t/86ey8vqk1))~~
  — moot: the scan-time payment push was removed entirely by 86ey98ju1 (payment
  info now rides the order-create CTA + invoice PDF).
- *(later, ticket 3.2)* richer Desktop / iPad Console affordances.
