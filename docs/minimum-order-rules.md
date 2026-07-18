# Minimum Order Rules — per-product min quantity + store min order value

**Status: built (dev), ClickUp [`86ey9unyx`](https://app.clickup.com/t/86ey9unyx) · Jul 2026**

Source: Sue Chef Kitchen (FM #3) — two asks that are the same primitive:
_"fear of someone ordering 1 pax"_ (per-product minimum quantity) and
_"minimum order for catering"_ (store-wide minimum order value). Both protect
seller unit economics — the core reason made-to-order sellers exist — and both
are parity features vs Orderla / Take App. **All-tier** (no plan gate), both
optional and default-off: an unset rule adds zero friction and zero migration.

## The two rules

| Rule | Lives on | Judged against | Example |
| --- | --- | --- | --- |
| Minimum quantity | `products.minQuantity` | The **summed** quantity of that product's cart lines | Catering item, min 20 pax |
| Minimum order value | `retailers.minOrderValue` (sen) | The **item subtotal** (before pickup/delivery fees), boundary **inclusive** | RM100 minimum |

Decisions locked 18 Jul 2026 (Zaki):

- **Min quantity is product-level, not per-variant** — a deliberate break from
  the per-variant field convention (`blockWhenOutOfStock` etc.). "Min 20 pax"
  is the seller's mental model for the whole menu item: 10 + 10 of two
  flavours satisfies min 20; per-variant would wrongly force 20 *per flavour*.
  Stored ≥ 2 only — 0/1 normalize to unset (`sanitizeMinQuantity`), so
  undefined always means "no rule".
- **Min order value is store-wide** (no per-fulfilment-method scoping in v1)
  and compares the item subtotal, matching the `freeAbove` inclusive-boundary
  posture. 0 normalizes to unset (`sanitizeMinOrderValue`); RM10k ceiling.
- **Counter checkout is exempt from both.** The seller is standing at the
  counter ringing up the sale — same posture as min-notice bypass and fee-free
  counter pickup. The checks live ONLY in `orders.create`;
  `counterCheckout.createOrderFromSession` is untouched (pinned by test).
- **Custom / price-on-quote lines sit outside both rules.** A custom line is
  qty-locked to 1 (one bespoke negotiation), so it never counts toward — or
  triggers — a product minimum. And an order carrying any custom or
  price-on-quote line is **exempt from the value minimum**: its real value is
  settled by the seller's quote, so a "RM0" custom cake must not bounce off a
  RM100 floor (the seller can always decline the request).

## One shared module, two enforcers

All rule logic is pure and lives in **`convex/lib/minOrderRules.ts`**
(sanitizers, `collectMinQuantityShortfalls`, `minOrderValueShortfall`,
exemption + message helpers), imported by **both sides** — the
`fulfilmentDate.ts` pattern — so the storefront's friendly pre-check and the
server's authoritative gate can never disagree:

- **Server (the lock):** `orders.create` collects per-line
  `{productId, name, qty, minQuantity, isCustom, quoteOnRequest}` alongside the
  snapshot loop, then throws `ConvexError` on the first quantity shortfall
  ("Minimum 20 × Kuih Tray per order — you have 12") or on a value shortfall
  ("Minimum order of MYR 100.00 — add MYR 35.00 more to check out"). Runs
  before delivery resolution / totals. Create-time only — post-order seller
  edits (address re-price, mockup re-price, fee-pending) never re-check.
- **Client (the easement):** the checkout sheet maps `cart.items` through the
  same functions. Cart items snapshot `minQuantity` at add time (like
  price/name); the server re-checks against live values, so a stale cart can
  at worst see a server error, never a wrong order.

## Buyer UX — the rule is never a checkout surprise

- **Product card:** a "Min 20" chip on the image (beside "Custom available").
- **Detail sheet:** a "Minimum 20 per order" hint (plus "mix options to reach
  it" on multi-variant products, and "You have N in your cart"); the quantity
  stepper **opens at the remaining amount** toward the minimum (min 20, 12 in
  cart → starts at 8, clamped to stock). On no-options products the minus
  button **floors at the minimum** (disabled-with-reason); with options the
  floor stays 1 because mixing variants toward the sum is legitimate.
- **Quick-add** (single-variant cards) tops the cart up to the minimum in one
  tap, **clamped to the variant's remaining stock** (a single tap can never put
  more in the cart than can be bought); once met, +1 as usual. The toast names
  the quantity ("Added 20 × …").
- **Unreachable minimum = unavailable-with-reason, never a stepper trap**
  (`minQuantityUnreachable` in `src/lib/variant.ts`): when every standard
  variant hard-blocks and their combined stock sits below the minimum (min 20,
  15 left), the card shows a "Not enough stock" badge with the add button
  disabled, and the detail sheet swaps the min hint for "Only 15 left — not
  enough to meet this product's minimum of 20 per order" with the stepper +
  add disabled. Without this, the stepper would pin at stock and checkout
  would demand units that can't be bought. Any made-to-order standard variant
  keeps the minimum reachable (unbounded); the custom line neither rescues the
  minimum (it's excluded from min sums) nor gets blocked by this state (its
  own CTA stays live — cards with a custom line keep their Choose button).
  Note the seller-form stock warning only fires while editing — this
  storefront state is what covers stock *eroding* below the minimum through
  normal sales.
- **Checkout sheet:** a red inline hint on the offending product's first line
  ("Minimum 20 per order — add 8 more"), a `role="alert"` banner above the
  total listing every shortfall (same pattern as the delivery out-of-range
  block), and the **"Send order on WhatsApp" button disables** while any rule
  is unmet. Storefront copy is hard-coded EN like the rest of checkout.

## Seller UX

- **Product form** (create + edit): a "Minimum order quantity" input in the
  price/stock step, with helper copy naming all the behaviour (options
  combined, storefront chip, counter exempt, blank = off) and an amber warning
  when every active variant hard-blocks and combined stock < the minimum
  (buyers couldn't reach the bar until a restock). Blank/0 clears.
- **Products list:** a "Min N" chip on rows carrying the rule.
- **Settings → Fulfilment:** a "Minimum order value" card next to the
  order-date-notice card (RM input, save, clear by blanking). Helper copy
  states the counter + custom-order exemptions.

## Wiring map

- Schema: `products.minQuantity`, `retailers.minOrderValue` — both optional,
  dev-only widen, no backfill.
- `products.create/update` take `minQuantity` (update: 0 clears).
  `productWithVariants` spreads the product row, so every list/get read —
  public storefront included — carries it automatically (public-safe by
  design: buyers must see the bar to reach it).
- `retailers.updateSettings` takes `minOrderValue` (0 clears);
  `buildRetailerPublic` + `getRetailerBySlug` expose it (public-safe).
- Client: `useCart` gained `CartItem.minQuantity` + `quantityForProduct()`;
  `minOrderValue` threads `$slug.tsx` / category route → `CartBar` →
  `CheckoutSheet`.
- Bulk import (`products.bulkUpsert`) does not set `minQuantity` — sellers add
  it in the editor after import (acceptable v1 gap; the import schema is CSV
  parity-focused).

## Tests

- `convex/lib/minOrderRules.test.ts` — sanitizers, summing across variants,
  boundary inclusivity, custom exemptions, message shape.
- `convex/orders.test.ts` ("minimum order rules") — create-time enforcement:
  below-min rejection, cross-variant summing, value floor + boundary,
  quote-line exemption, sanitizer normalization through `products.update` /
  `updateSettings`, public payload exposure.
- `convex/counterCheckout.test.ts` — the counter sells below both rules.
- `src/components/storefront/product-detail-sheet.test.tsx` — stepper opens at
  the minimum / at the remaining amount, minus floors, add passes the min,
  unreachable minimum renders unavailable-with-reason with the add disabled.
- `src/lib/variant.test.ts` — `minQuantityUnreachable`: all-hard-block below
  min, cross-variant summing, made-to-order rescue, custom line doesn't
  rescue, inactive variants excluded.
