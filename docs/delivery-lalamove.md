# Lalamove Delivery — checkout quote, one-tap dispatch, auto tracking

ClickUp [`86eyb5hrf`](https://app.clickup.com/t/86eyb5hrf) · shipped Jul 2026 (dev) · Fruit Hut (Founding #4) is the launch seller.

End-to-end delivery fulfilment on the Lalamove Open API v3 (market MY): the
buyer pays the **real rider price** at checkout, the seller books the rider in
**one tap** from order detail, and the webhook drives `shipped` (with live
tracking link) and `delivered` automatically. No manual tracking handling
anywhere.

## Locked decisions

- **BYO-ONLY money model** (Arif, revised 21 Jul — supersedes the 18 Jul
  "master fallback" plan): the seller holds their own Lalamove Business
  account; their API key/secret live on the retailer and they pay Lalamove
  directly from their own prepaid wallet — mirroring the retailer-owned
  payment-gateway posture. **Kedaipal has no Lalamove account and never
  books or pays on a seller's behalf.** A seller without their own keys
  simply uses the flat/radius pricing modes and books riders however they
  do today. (The briefly-built master fallback — env keys, RM2k spend cap,
  billing-tab meter, admin rebill badge — was removed the same day; see git
  history if it's ever wanted back.)
- **Fee frozen at checkout; dispatch always re-quotes.** Lalamove honours a
  quotation for exactly 5 minutes, so the buyer-paid fee and the actual
  booking cost are different numbers by design. Drift is absorbed by the
  paying account and stored on the job row (`costActual`), never rewriting
  the order. The dispatch confirm dialog shows the variance before booking.
- **Provider is a seam.** `deliveryJobs.provider` is a literal union of one
  today; the client is one module; DelyvaX is the named provider-#2
  candidate (trigger: parcel couriers or courier choice).
- **Pro-gated** (`PLAN_FEATURES.delivery`): enabling booking + switching
  pricing to live-quote are Pro; disabling/clearing stays un-gated
  (downgrade never traps); buyer-side fee rendering is all-tier.

## Architecture

**No new field for the origin** — the ticket's `retailers.deliveryOrigin`
was stale: `retailers.businessAddress` (shipped with radius delivery,
86extzdr8) is already the seller's pinned origin and is reused as the
Lalamove pickup point. One address, two consumers.

Pricing rides the existing delivery-charge seam: `deliveryConfig` gained a
third arm `{ mode: "lalamove", onUnquotable: "arrange" | "block" }` next to
`flat`/`radius`, all resolved by the same pure `resolveDeliveryQuote`
(`convex/lib/delivery.ts`). **Pricing and booking are orthogonal**: a seller
can charge a flat fee yet still book riders (absorbing drift); live-quote
pricing additionally requires booking to be enabled (its vehicle +
credentials price the quote).

| Piece | Where |
| --- | --- |
| Pure client (HMAC signing, payload builders, RM→sen, status maps, credential resolver) | `convex/lib/lalamove.ts` |
| Webhook signature verification | `convex/lib/lalamoveSignature.ts` |
| Convex functions (network client, checkout quote, dispatch, webhook handler) | `convex/lalamove.ts` |
| Webhook route | `convex/http.ts` `POST /webhook/lalamove` |
| Buyer checkout wiring | `src/components/storefront/checkout-sheet.tsx` |
| Seller dispatch card | `src/components/order/book-delivery-card.tsx` |
| Seller setup (4th pricing mode inside Delivery charge) | `src/components/settings/fulfilment-tab.tsx` (`DeliveryChargeSection`) |

Schema: `retailers.deliveryBooking { enabled, vehicleType, apiKey?, apiSecret? }`
(plain fields, accepted for v1 — flagged in the ticket), `deliverySnapshot`
gains mode `"lalamove"` + `quotationId`/`vehicleType`/`quotedAt` audit
fields, and two new tables: `deliveryQuotes` (transient server-side checkout
quote record) and `deliveryJobs` (the booking ledger — indexes `by_order`,
`by_retailer`, `by_provider_order`).

### Credential resolver

`resolveLalamoveCredentials(booking)` — the seller's own key pair on the
retailer row is the ONLY source; absent/half → `null` (feature unavailable,
checkout falls back gracefully). **No deployment env vars** — sandbox vs
production is inferred from Lalamove's own key prefix (`pk_test_…` →
sandbox, else production), so a key can never be pointed at the wrong API
host and one store can run sandbox keys while another runs prod.
`updateSettings` enforces: enabling requires business address + both key
parts; half a credential is refused at save time; clearing keys while
enabled is refused (nothing to fall back to); key fields follow the
logoStorageId convention (`undefined` = keep stored, `""` = clear).

**IA (revised after first seller test):** Lalamove is NOT a separate card —
it's the 4th delivery-pricing mode (Settings → Fulfilment → Delivery charge:
Free / Flat / By distance / **Lalamove**). Picking it reveals the whole
setup inline — pickup address, vehicle, BYO keys (with a "How to set up"
link to the vendor guide at `/guides/lalamove-setup.html`) and, once keys
are saved, the deployment's **webhook URL with one-tap copy** (see Webhook
below). One save button writes `deliveryConfig` + `deliveryBooking`
together; switching to another pricing mode disables booking in the same
save (keys stay stored, so switching back is instant). The key inputs are
plain text with a CSS mask on the secret — deliberately NOT
`type="password"`, so Chrome never mistakes the form for a login and
autofills saved credentials into it.

### Checkout quote (trust model)

The reactive `delivery.quote` query answers `{ kind: "live", onUnquotable }`
for lalamove-mode stores; the checkout then calls the
`lalamove.quoteForCheckout` **action** once per picked address (debounced,
rate-limited per retailer — the quote-by-coordinates oracle gets the same
trilateration caution as the radius quote). The action records the fee in a
`deliveryQuotes` row and returns `{ quoteId, fee }`; **`orders.create` only
ever accepts the row id** — coordinate-matched (±~11 m), ≤30 min old,
consumed on use — so the browser can display the fee but never dictate it.
Missing/stale/mismatched quote → the store's `onUnquotable` policy:
`arrange` → the existing `deliveryFeePending` hold (payment ask held, seller
confirms the charge — same machinery as radius out-of-range), `block` →
checkout refused with clear copy. Kill switch: no credentials/config → the
quote query never says "live" and checkout behaves exactly as before.

Note: a buyer address edit (`updateDeliveryAddress`) re-prices through the
same resolver *without* a live quote, so under lalamove pricing it lands
fee-pending for the seller to confirm — deliberate (an address change means
the old price is wrong, and mutations can't fetch).

### Dispatch (Book delivery)

Two-tap: `prepareBooking` re-quotes at today's price and the confirm dialog
shows it against the buyer-paid fee (variance called out, including who
absorbs it); `confirmBooking` places the order within the 5-minute window
and writes the `deliveryJobs` row — the **one-active-job-per-order**
invariant is enforced atomically inside `recordBooking`, so double-taps
can't double-book. Every blocked state renders disabled-with-reason on the
card (`DispatchBlock` map): wrong status, no map pin on the address (with a
fix path — never a dead end), booking off, plan gate (Pro chip), no
credentials, missing buyer/seller phone. Wallet-empty
booking failures surface Lalamove's error as "top up your Lalamove wallet,
then retry". `cancelBooking` (with a rider-fee warning) deliberately skips
the eligibility gates — cancelling must work even when booking wouldn't.

### Webhook

`POST /webhook/lalamove` mirrors the WhatsApp route: raw body → resolve
secrets → verify → act → ack. Lalamove-specific twists:

- Auth lives **inside the JSON body** (`apiKey`/`timestamp`/`signature`),
  and the verifying secret is **per retailer** (BYO-only): the route
  resolves it through the `deliveryJobs` row (`by_provider_order`) — the
  job retailer's stored secret is the only candidate. Unmatched events are
  unverifiable by design and get ack+ignore.
- **Signature formula CONFIRMED against real sandbox traffic (21 Jul 2026)**:
  `hex(HMAC-SHA256("<ts>\r\nPOST\r\n<our-path>\r\n\r\n" + JSON.stringify(data), secret))`
  — the `data` variant. An `envelope` fallback candidate is kept
  defensively; the route logs which variant matched.
- Lalamove retries 10× over 24 h **and disables the URL after 10 failures**,
  so every handled-or-ignorable outcome acks 200 (including the empty-body
  registration ping). 401/500 are reserved for forged/misconfigured cases.
- Events arrive **out of order** and can **regress** (a matched driver
  bailing sends the order back to `ASSIGNING_DRIVER`). The job row follows
  provider truth via a `lastEventAt` guard; the **order never regresses** —
  `picked_up` → `shipped` only from confirmed/packed, `completed` →
  `delivered` only from confirmed/packed/shipped, cancelled orders are never
  touched, and transitions ride the exported `applyStatusTransition` so
  WhatsApp notify, stage vocabulary, activation stamping and orderEvents all
  come free.
- Event types handled: `ORDER_STATUS_CHANGED` (7 statuses),
  `DRIVER_ASSIGNED` (driver + shareLink, mirrored early onto
  `orders.carrierTrackingUrl` fill-if-unset), `ORDER_AMOUNT_CHANGED`
  (post-match fees → `costActual`), `ORDER_REPLACED` (cancel-and-clone —
  the job follows the new provider order id). `WALLET_BALANCE_CHANGED` and
  the undocumented-but-real `ORDER_CREATED` are logged only (a proactive
  low-balance banner is the named follow-up). Terminal failures
  (`canceled`/`expired`/`rejected`) mark the job failed, email the seller
  (EN+BM `deliveryJobFailed` template), leave the order untouched, and the
  card offers one-tap rebook.

**Registration is per SELLER** (BYO-only): each vendor pastes OUR webhook
URL into THEIR Partner Portal → Developers → Webhook URL (Version 3). The
settings card surfaces the exact URL with a copy button and the vendor
guide walks it (Step E5). Graceful degradation if a seller skips it:
bookings still work, but shipped/delivered stop being automatic — the
order just stays where it is until the seller advances it by hand. Dev
deployment URL: `https://qualified-chihuahua-441.convex.site/webhook/lalamove`.

## Sandbox E2E — verified 21 Jul 2026

Real sandbox pass with test keys (then platform-env-based; the same keys
now simply live on a retailer row as BYO): webhook URL registered via API → quote
(KLCC→PJ, RM13.30 → 1330 sen, stopIds, 18.3 km) → order placed (shareLink
returned at create, status `ASSIGNING_DRIVER`) → GET → cancel (204). All
request signing accepted first try; webhook events landed at the dev route
and verified under the `data` variant. Remaining before prod: driver-status
progression (sandbox has no riders — `PICKED_UP`/`COMPLETED` paths are
covered by hand-signed-payload tests in `convex/lalamove.test.ts`; first
prod booking is the live confirmation), and Fruit Hut's own account: Naim
registers, tops up his wallet, pastes his `pk_prod_` keys into Settings →
Fulfilment and registers the prod webhook URL in his Partner Portal
(Arif walks him through it — subtask `86eyb5w24`; the vendor guide is the
handout).

## Follow-ups (named, not built)

- Low-balance banner from `WALLET_BALANCE_CHANGED` (store last-known
  balance, warn before a booking ever fails).
- Prompt to cancel the Lalamove job inside the order-cancel flow (today the
  job card's cancel button is the path).
- Multi-outlet origin (per-dispatch origin picker) — dispatch already reads
  the origin from one resolver point.
- DelyvaX as provider #2 (parcel couriers / courier choice).
- Vendor onboarding guide (PDF): drafted with real Partner Portal
  screenshots; finalize once Kedaipal-side settings screenshots exist.
