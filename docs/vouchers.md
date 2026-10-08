# Vouchers — seller-issued single-use codes

> **Status: spec, build in progress** (ClickUp `z8r3fdr617`, scoped 8 Oct 2026).
> This doc is written ahead of the code on purpose — the redemption model
> (especially *how the QR is used*) was decided at scoping and the build
> implements what's written here. Each section gains implementation pointers
> as the slices land.

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
| **The code** (`KP-7F3K-Q2`) | The voucher itself, human-typeable | Reading out loud, typing into the storefront checkout field, the seller keying it at the counter |
| **The QR** | The **plain code as text**, QR-encoded | Flashing at the counter — any camera app decodes it to the code instantly |
| **The link** | Storefront checkout URL with `?voucher=<code>` | Sending to the buyer on WhatsApp — opens checkout with the code already applied |

### When and how the buyer uses the QR

The QR is the **counter artifact**. The flow it's designed for:

1. The seller creates the voucher and sends it to the buyer (WhatsApp share
   from the share sheet, or the buyer screenshots the QR in person).
2. The buyer turns up at the stall / counter and **flashes the QR** (or just
   reads the code out).
3. The seller points any phone camera at it — because the QR encodes the
   *plain code text*, the camera preview shows `KP-7F3K-Q2` with **no scanner
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

## Open implementation pointers

Filled in as the build lands: schema + `computeOrderTotals` subtractive seam
(and the six recompute sites in `convex/orders.ts` that must re-pass it),
the `vouchers` table's deletion-cascade entry, and the UI surfaces.
