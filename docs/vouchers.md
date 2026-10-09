# Vouchers — seller-issued single-use codes

> **Status: shipped** (ClickUp `z8r3fdr617`, scoped 8 Oct 2026, built 9 Oct).
> This doc was written ahead of the code on purpose — the redemption model
> (especially *how the QR is used*) was decided at scoping and the build
> implements what's written here. Everything below is now live; the
> implementation pointers at the bottom say where each part lives.

A **voucher** is a seller-issued, single-use discount: one voucher = one
unique code = one redemption, applied to **one order** at checkout. It is the
*buyer-specific* discount lever. The *product-level* lever (promo price /
flash sale, `z8r3fdcw72`, [promo-price.md](./promo-price.md) once it lands) is
a deliberately separate mechanism: a promo changes the **line price**, a
voucher is an **order-level deduction**. They are never one system.

## The model in one paragraph

A `vouchers` row is retailer-scoped and carries a crypto-random, typeable code
(unambiguous alphabet, `KP-XXXX-XXXX` shape), a value (fixed amount in sen or
a percentage of the item subtotal), an optional expiry date, and a status
(`active → redeemed | voided`, plus `expired` judged at read time). Redemption
is atomic with order create — the voucher flips to `redeemed` in the same
mutation that inserts the order, so two checkouts racing one code serialise on
OCC and exactly one wins. A cancelled order returns its voucher to `active`
(any cancel cause — the seller issued it to that buyer). One voucher per
order, no stacking.

## The code, the QR and the link — what each is for

Every voucher's share sheet carries three spellings of the same thing. They
exist because the buyer is in one of two places when they redeem:

| Artifact | What it is | Built for |
|---|---|---|
| **The code** (`KP-7F3K-Q2WM`) | The voucher itself, human-typeable | Reading out loud, typing into the storefront checkout field, the seller keying it at the counter |
| **The QR** | The **plain code as text**, QR-encoded | Flashing at the counter — any camera app decodes it to the code instantly |
| **The link** | Storefront checkout URL with `?voucher=<code>` | Sending to the buyer on WhatsApp — opens checkout with the code already applied |

### When and how the buyer uses the QR

The QR is the **counter artifact**. The flow it's designed for:

1. The seller creates the voucher and sends it to the buyer (WhatsApp share
   from the share sheet, or the buyer screenshots the QR in person).
2. The buyer turns up at the stall / counter and **flashes the QR** (or just
   reads the code out).
3. The seller points any phone camera at it — because the QR encodes the
   *plain code text*, the camera preview shows `KP-7F3K-Q2WM` with **no scanner
   app, no deep link, no sign-in** — and keys the code into the counter
   checkout's voucher field. The discount lands on the counter order.

Deliberate decisions behind that:

- **The QR encodes the code, never a URL.** A URL-encoding QR scanned by the
  seller would open the *seller's own storefront checkout* — a buyer surface,
  on the wrong side of the counter. Encoding the bare code keeps the QR
  symmetric: whoever scans it, they get the one thing both sides can use.
- **No seller-side scanner is built in v1.** The phone's own camera already
  reads text QRs for free; a dedicated in-app scanner is a follow-up only if
  real counters ask for it.
- **The QR adds nothing online.** A buyer on their own phone can't scan their
  own screen — that's what the **link** is for: it opens the storefront
  checkout with `?voucher=` pre-filled, so the code is applied without typing.
  The share sheet says which to use where, so the seller never has to explain
  it.

### Where redemption happens, per surface

| Surface | Who enters the code | How |
|---|---|---|
| **Storefront checkout** | The buyer | Types it into the "Have a voucher?" field in the totals card, or arrives via the `?voucher=` link and finds it applied |
| **Counter sale** | The seller | Keys it into the voucher field in the order panel (reading it off the buyer's QR or by ear) |
| **Claim link** | The seller, at send | Applied when sending the claim; frozen into the claim like the line prices, shown on the buyer's claim ticket |

Every door re-validates server-side at order create (never trusting an
earlier check) and refuses with a named reason: invalid, expired, voided,
already used (naming the order), or another voucher already on this order.

## Lifecycle and the seller's controls

- **Create**: single or batch ("create 20"), value + optional expiry (store
  time zone, end of day). Vouchers list shows status filters (active /
  redeemed / expired / voided), each row linking a redeemed voucher to its
  order.
- **Void**: any time, with an optional private reason. Soft — the row and its
  history stay; the code simply stops redeeming, with copy that says so.
  There is no hard delete in v1.
- **Expiry** is judged inside the redeem mutation against `Date.now()`; the
  list and the buyer-facing error render it, no cron flips anything.

## Guard rails

- Redemption and the code-check endpoint are **rate-limited** (own bucket in
  `convex/lib/rateLimiter.ts`) so codes can't be guessed by hammering.
- The discount applies to the **item subtotal only** — never fees or
  deposits — and is clamped so the total never goes below zero. Minimum-order
  and free-delivery thresholds judge the *pre-discount* subtotal.
- A voucher order still uses one credit (`recordOrderCreated` unchanged).
- Pro-gated (decided 8 Oct): creating vouchers is a Pro capability; already
  -issued history stays visible on a downgraded store.

## How it is built

### The subtractive seam — the one thing that could silently overcharge

A voucher is the **first subtractive term** `total` has ever carried, and the
failure it introduces is silent: a recompute site that drops it charges the
buyer **full price**, with no error anywhere. `convex/orders.ts` has **six**
sites that recompute an existing order's total (mockup submit, mockup
re-quote, custom-decline, pickup switch, address re-price, seller
set-delivery-fee), and before this feature all six **hand-listed** the extras
they happened to know about — a list that had already drifted: every one of
them omitted `securityDeposit`.

So the discount is not threaded through six lists. It rides one helper:

- **`orderExtras(order)`** (`convex/lib/order.ts`) is the single author for
  "what is already folded into this order's total". Every recompute site
  spreads it and overrides only the term it is changing:

  ```ts
  computeOrderTotals(order.items, {
    ...orderExtras(order),
    deliveryFee: resolved.snapshot?.fee,
  })
  ```

  A future extra is therefore carried by all six the moment it is added there.
- **`computeOrderTotals`** returns `{ subtotal, discount, total }`. Each site
  patches `voucherDiscount: storedDiscount(discount)` beside `total`.
- The seam carries the voucher's **terms**, not a frozen sen figure. "10% off
  this order" has to follow the subtotal when the custom-decline keeps part of
  a mixed basket; a fixed voucher re-clamps to whatever the basket is now
  worth. Freezing the computed sen would leave a figure matching nothing.
- **`orders.subtotal` stays GROSS.** The min-order rules and the free-delivery
  thresholds read it, so netting the discount in would silently move every
  threshold in the app. `total` is the net number.
- `revenueExcludingDeposit` needs no voucher term — `total` is already net, so
  every revenue surface (CRM `totalSpent`, Insights) counts the real money
  without knowing vouchers exist.

Both halves of that are test-enforced, in `convex/orderTotalsSeam.test.ts`:

- a **source scan** fails any `computeOrderTotals` call in `convex/` that
  hand-lists extras while recomputing an existing order (a call either spreads
  `...orderExtras(...)` or is a classified order-CREATE door);
- a **count** pins that every site binding `discount` also persists it.

And behaviourally, in `convex/voucherRedemption.test.ts`: all six sites are
exercised with a live voucher, and each proof is mutation-tested — dropping the
voucher at a site turns its own test red.

### The money rule

`voucherDiscountFor` (`convex/lib/vouchers.ts`) is the only place the discount
is computed, server and client both. The base and the cap are the **item
subtotal**, which is what makes the two guard rails one clamp: the discount
can never reach a fee or a deposit, and `subtotal - min(d, subtotal)` can never
drive the total below zero because every other term is additive. Percentages
round to the nearest sen **once**, here, so the storefront preview and the
stored total agree exactly. A non-finite value floors to 0 (`Math.max(0, NaN)`
is `NaN`, which would otherwise write an unreadable order — found by this
file's own test).

### Where each piece lives

| Piece | Where |
|---|---|
| Code, value, status, refusal copy (pure) | `convex/lib/vouchers.ts` |
| Resolve / redeem / release / claim state (ctx) | `convex/lib/voucherRedemption.ts` |
| Totals seam + `orderExtras` | `convex/lib/order.ts` |
| Issue, void, void-batch, list, code check | `convex/vouchers.ts` |
| Storefront redemption | `orders.create` (`voucherCode` arg) |
| Counter redemption | `counterCheckout.createOrderFromSession` (explicit `voucherCode` arg) |
| Claim redemption | `orderClaims.sendClaim` freezes, `commit` spends |
| Hand-back on cancel | `reverseCancellationEffects` + `declineMockupItem` |
| Seller surface | `src/routes/app.vouchers.index.tsx`, `src/components/vouchers/*` |
| Buyer / counter field | `src/components/vouchers/voucher-field.tsx` (ONE control, both surfaces) |
| `?voucher=` carried across browsing | `src/hooks/useVoucherParam.ts` |
| Tenant teardown | `vouchers` phase in `convex/lib/accountDeletion.ts` |

### Decisions worth keeping

- **Codes are globally unique**, not per store (`by_code`). A code typed at the
  wrong store resolves to a row whose `retailerId` does not match and is
  refused as "not valid for this store" — it can never silently match a
  *different* store's voucher, which a per-store index would have allowed the
  moment two stores minted the same 8 symbols. The refusal never confirms the
  code exists somewhere.
- **`checkCode` is a mutation, not a query.** A voucher code is the only
  guessable secret the storefront accepts, so the check has to spend
  rate-limiter budget — and the limiter can only be spent from a mutation. It
  writes nothing else. A free query here would be an unmetered oracle for
  guessing codes.
- **No character repair in `normalizeVoucherCode`.** Case, spaces, dashes and
  a missing `KP-` are all folded; a typed `O`/`0`/`I`/`1` is **rejected**,
  because no real code contains one and "repairing" it could map two distinct
  codes onto one and hand a buyer somebody else's voucher.
- **`vouchers` is its own permission area.** Issuing gives money away, so it
  must not arrive free with `orders: write` ("move this order to packed").
  Redeeming at the counter needs `orders: write` only, so a front-desk helper
  can take a voucher without being able to mint one. Left off both team
  presets deliberately.
- **The route is not plan-walled.** Issuing is the Pro capability; the LIST is
  not, because a downgraded store still has outstanding codes it has to honour
  and void. The gate lands on one button, with its reason beside it.
- **Void refuses a redeemed voucher.** It has been spent and the order is the
  record; voiding one would imply the discount could be clawed back off a
  placed order. `voidBatch` therefore skips spent rows and names the skip
  rather than refusing a part-spent run.
- **A voided voucher is never resurrected by a cancellation.** The seller
  withdrew it on purpose.

- **Both counter doors take the code as an ARGUMENT, never off the session
  draft.** The draft is a 700 ms debounced autosave — `items` are already
  passed explicitly for exactly that reason — so a door reading it would drop a
  code applied in the second before the seller tapped Create or Send, *after*
  the panel had shown the discount. `counterCheckout.createOrderFromSession`
  and `orderClaims.sendClaim` take `voucherCode`; `draft.voucherCode` exists
  only to restore the field on a refresh. Pinned by "the door reads the
  ARGUMENT, never the debounced draft".

- **A `?voucher=` link is tapped BEFORE shopping, so the code is held.** The
  link points at checkout (that is where it is spent), but the buyer it was
  sent to on WhatsApp has an empty cart — they land on "Your cart is empty ·
  Browse the store", and in-store navigation carries no params. So every
  storefront route captures the code to per-store sessionStorage
  (`useVoucherParam`, the `useSourceAttribution` sibling), checkout reads it
  back, the empty-cart panel SAYS it is being held, and it is forgotten once
  spent so a second checkout in the same tab can't re-apply a redeemed code.

### The one found bug, fixed in passing

`orders.updateDeliveryAddress` refuses `self_collect` but **not** `booking`, so
a booking order could reach it — and with `securityDeposit` missing from its
hand-written extras, the deposit was silently deleted from `total`. Spreading
`orderExtras(order)` fixes it; `voucherRedemption.test.ts` pins it with a test
that fails if the site is reverted to its literal.
