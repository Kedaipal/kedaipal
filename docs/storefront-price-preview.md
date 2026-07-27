# Storefront Price Preview — line total on cards + live total in the detail sheet

**Status: implemented.** Buyer-facing pricing clarity. The storefront used to
only ever show the **unit** price (`RM 50.00`) on the grid tile and in the
product-detail sheet — a shopper adjusting quantity had no idea what they were
committing to until the cart/checkout screen. This adds the running total where
the buyer actually decides. All-tier, buyer-facing, no plan gating (the buyer
flow can't vary by seller plan — same reasoning as the checkout date picker).
Source: Zaki, 19 Jul 2026. ClickUp `86eyb8vde`.

Prices are stored in **minor units (sen)** everywhere (see `src/lib/format.ts`).
Totals are computed by multiplying `unitMinor × quantity` **before**
`formatPrice`, never by combining formatted strings.

## Two surfaces

### 1. Product-detail sheet — live total preview

`src/components/storefront/product-detail-sheet.tsx`

A "Total" row sits directly above the quantity stepper + Add-to-cart button and
updates on every `−`/`+` tap:

```
Total · 2 × RM 50.00                              RM 100.00
```

- The `2 × RM 50.00` breakdown only appears at **qty > 1** (redundant at qty 1,
  where the unit price is already shown at the top of the sheet).
- Gated by `totalPreview`, which is non-null only when a **concrete, priced,
  sellable** variant is resolved:
  - unresolved multi-axis selection → no variant → no total (the CTA still reads
    "Select options");
  - a made-to-order / quote line (`requiresProof && price === 0`) → **no total**,
    because there's no price yet (the sheet shows "Price on quote" instead);
  - an out-of-stock / unsellable variant → no total (Add is disabled anyway).
- The independent custom-order line has its own button and stays qty 1 — it
  never shows a money total (quoted later by the seller on the mockup).

### 2. Product grid tile — line total once in cart

`src/components/storefront/product-card.tsx` (threaded via `product-grid.tsx`)

The tile keeps its unit / `from` price unchanged. Once the buyer has ≥1 of the
product in the cart, a mint line appears under the price and updates as they add
more:

```
3 in cart · RM 150.00
```

- **Only rendered when in the cart** (`cartQuantity > 0`) — un-added tiles stay
  clean. Chosen over an inline per-tile quantity stepper, which would duplicate
  the sheet's control and bloat the mobile grid.
- The money total is the **sum of the actual cart line totals** for that product
  across its variants — correct for mixed-price multi-variant carts, and never
  derived from the ambiguous `priceFrom` range.
- If every in-cart line of the product is quote-priced (subtotal 0), only the
  count shows (`1 in cart`) — no misleading `RM 0.00`.
- Cards in a grid row equal-height via CSS grid + the button's `mt-auto`, so a
  tile gaining the cart line doesn't misalign the Add buttons across the row.

## Cart plumbing

`src/hooks/useCart.ts` gains two per-product aggregate helpers, backed by a
single `byProduct` map rebuilt once per cart change (read per-card in O(1)):

```ts
quantityForProduct(productId): number   // units in cart, custom lines excluded
subtotalForProduct(productId): number   // Σ price × qty (minor units), custom lines excluded
```

**Custom / made-to-order lines are excluded from both** — they're a separate
quoted negotiation (price 0 in-cart until the seller quotes), so folding them
into a running money total would understate it and inflate the count.

## Tests

- `src/hooks/useCart.test.tsx` — aggregate sums across variants, product
  isolation, custom-line exclusion, reaction to qty change + removal.
- `src/components/storefront/product-detail-sheet.test.tsx` — total hidden until
  a variant resolves, updates with quantity, hidden for a quote selection.
- `src/components/storefront/product-card.test.tsx` — cart line hidden when not
  in cart, count + total when priced, count-only when quote-priced.

## Overlap with min-order rules (`zaki/#86ey9unyx`, in review)

That unmerged branch rewrites the same stepper region and independently adds a
`quantityForProduct` cart helper + a `cartQuantity` prop on the detail sheet.
This work branches from `origin/staging` and reuses the matching
`quantityForProduct` name, so the eventual merge is a small, mechanical conflict
in the stepper block + `useCart` — flagged, not a surprise.
