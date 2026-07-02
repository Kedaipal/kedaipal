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
  - **Pay later** → the **payment ask** (transfer-reference line + the seller's
    payment methods as text + an "I've paid" CTA + any QR images, via the shared
    `sendPaymentMessage`), then the **Invoice** PDF. So the buyer can pay from the
    chat immediately — the payment details arrive *and* are baked into the invoice.
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

## Pending (V1.1)

- **Resend from order detail** — the "Send receipt/invoice to buyer" action is
  currently only on the counter Done screen; order detail has Download only.
- **Manual-phone path** — seller types the buyer's number to bind a session
  without a scan (e.g. buyer's camera won't cooperate). Binds the session
  directly, no webhook.
- **Anonymous walk-in** — a cash sale with no contact: create the order off the
  session with no buyer identity (no WhatsApp confirmation).
- *(later, ticket 3.2)* richer Desktop / iPad Console affordances.
