# Product Variants — Roadmap (SUPERSEDED)

> **Superseded by [`product-variants.md`](./product-variants.md)** (ticket `86extjqxf`, in build).
> This file is the pre-build *menu of decisions*; the decisions are now locked in the spec.
> Kept for the import/export shape discussion (§"Import / Export Impact"), which the bulk-import
> subtask still draws on. For everything else, read the spec.

Reference doc for adding Shopee/Lazada-style variant support (size, color, etc.) to products. Not a plan — a menu of decisions to make when we pick this up, and a pointer to what the current flat schema needs to migrate cleanly.

## Context (2026-04-21)

**Current state:** `convex/schema.ts` `products` is flat — one row per sellable thing, single `price` / `stock` / `sku` / `imageStorageIds`. Works for outdoor gear that ships single-SKU (a specific tent, a specific bag), breaks the moment a retailer sells "Jacket — Red / M" vs "Jacket — Red / L" vs "Jacket — Blue / M".

**Why this is likely needed:**
- Outdoor gear vertical has real variant demand (apparel sizes, boot sizes, tent colors, pack volumes).
- Marketplace connectors (Shopee, Lazada, TikTok Shop) all model variants natively — importing a Shopee catalog into a flat schema requires lossy flattening.
- Shoppers expect a single product page with size/color pickers, not 12 near-duplicate products.

**Why we punted on MVP:** Variants double the schema, rewrite cart/order/import/export, and we don't yet know which variant axes retailers actually use. Flat MVP → instrument → design variant schema against real usage.

**Interim workaround (MVP):** Retailers encode variants as separate products with distinct SKUs (`"Jacket Red M"`, `"Jacket Red L"`). Ugly but unblocks the outdoor-gear beta.

## Proposed Schema

Two-level model — standard e-commerce shape (Shopify/Shopee/Lazada all use a variant of this):

```ts
products: defineTable({
  retailerId: v.id("retailers"),
  name: v.string(),              // "Trailblazer Jacket"
  description: v.optional(v.string()),
  currency: v.string(),
  imageStorageIds: v.array(v.string()), // shared product-level images
  active: v.boolean(),
  channel: v.union(v.literal("whatsapp")),
  sortOrder: v.number(),

  // NEW: option axes this product varies along. Ordered — determines picker UI order.
  // Empty array = single-variant product (no pickers shown).
  options: v.array(
    v.object({
      name: v.string(),          // "Size", "Color"
      values: v.array(v.string()), // ["S", "M", "L"] or ["Red", "Blue"]
    }),
  ),

  // REMOVED from products (moved to productVariants): sku, price, stock
  createdAt: v.number(),
  updatedAt: v.number(),
})

productVariants: defineTable({
  productId: v.id("products"),
  retailerId: v.id("retailers"),  // denormalized for index queries
  sku: v.optional(v.string()),
  // Ordered option values, aligned with product.options[].
  // ["M", "Red"] if options are [{name:"Size"}, {name:"Color"}].
  optionValues: v.array(v.string()),
  price: v.number(),               // minor units
  stock: v.number(),
  imageStorageIds: v.array(v.string()), // variant-specific (e.g. color swatch images)
  active: v.boolean(),
  sortOrder: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_product", ["productId"])
  .index("by_retailer_sku", ["retailerId", "sku"])
```

**Key decisions baked in:**
- **Variants are first-class rows**, not a JSON blob on products — lets us index by SKU, query stock, and later join with order line items.
- **Option axes live on the product**, values live on each variant. Enforces that a product can only vary along declared axes.
- **Every product has ≥1 variant** — single-SKU products get an auto-created variant with `optionValues: []`. Simplifies cart/order code (always reference a variant, never a product directly).
- **SKU moves to variant** — makes sense (SKUs identify sellable units) and aligns with import/export shape.
- **Retailer ID denormalized on variant** — needed for the SKU uniqueness index (we check SKU uniqueness per retailer, not per product).

## Cart & Order Impact

### Cart
`src/hooks/useCart.ts` currently keys items by `productId`. Must switch to `variantId`:

```ts
export type CartItem = {
  variantId: Id<"productVariants">;
  productId: Id<"products">;   // kept for display/grouping
  name: string;                 // "Trailblazer Jacket"
  optionLabel?: string;         // "M / Red" — rendered next to name
  price: number;
  currency: string;
  quantity: number;
  imageUrl?: string;
};
```

The `ADD` reducer dedupe key changes from `productId` to `variantId` — "Jacket M / Red" and "Jacket M / Blue" are distinct cart lines.

### Orders
`orders.items[]` schema already has a `productId` field. Add `variantId` alongside (keep `productId` for reporting/denormalized display, as you do with `name` and `price`):

```ts
items: v.array(v.object({
  productId: v.id("products"),
  variantId: v.id("productVariants"),
  name: v.string(),          // "Trailblazer Jacket"
  variantLabel: v.optional(v.string()), // "M / Red"
  price: v.number(),
  quantity: v.number(),
}))
```

### WhatsApp order message
The `wa.me` payload and the Convex-side parser (`convex/orders.ts` order confirmation logic) need variant labels. Likely format:
```
ORDER#ab12cd
- Trailblazer Jacket (M / Red) × 1 — RM 189
- Cook Set × 2 — RM 80
Total: RM 269
```

## Import / Export Impact

The XLSX round-trip (`exceljs`, see `project_xlsx_library` memory) needs a new shape. Two options:

**Option A — One row per variant (flat, Shopee-style export).** Each variant is a row; product-level fields (`name`, `description`) repeat across rows. Grouping key: `name` or a `productHandle` column.

```
name                 description   option1_name  option1_value  option2_name  option2_value  sku          price   stock
Trailblazer Jacket   Lightweight…  Size          M              Color         Red            TBJ-M-RED    18900   12
Trailblazer Jacket   Lightweight…  Size          M              Color         Blue           TBJ-M-BLU    18900   8
Trailblazer Jacket   Lightweight…  Size          L              Color         Red            TBJ-L-RED    18900   4
```

Pros: one sheet round-trips cleanly, matches Shopee's export format.
Cons: description repeats (and can drift on re-import), retailers may edit one row's description and expect it to win.

**Option B — Two sheets (Products + Variants) in one workbook.** Cleaner data model, harder for retailers to edit by hand.

Recommendation: **A**, with import logic that treats product-level fields as "last writer wins within the file" and warns on drift.

## UI Touchpoints

- **Storefront product card**: shows "from RM X" (min variant price) when variants have different prices.
- **Storefront product page**: option pickers (Size: [S M L], Color: [Red Blue]) — disable combinations with no matching active variant or zero stock.
- **Dashboard product form**: repeatable "Options" section (add axis, add value), then a variant matrix/grid for per-variant SKU/price/stock/image. Shopify-style — look at their product editor for reference.
- **Stock display**: product is "in stock" if any variant has stock > 0; variant-level out-of-stock greys out the specific option combo.

## Migration from Flat Schema

Convex migrations are cheap but cart/order shape changes aren't — plan the cutover:

1. **Add new tables** (`productVariants`, new fields on `products`) without removing old fields. Schema can hold both.
2. **Backfill migration**: for each existing `products` row, insert one `productVariants` row with `optionValues: []`, copying `sku`/`price`/`stock` across.
3. **Dual-write period**: cart still uses `productId`; new variant UI is behind a feature flag per retailer.
4. **Switch reads** to variant-first (storefront queries `productVariants`, cart keys on `variantId`).
5. **Drop deprecated fields** (`products.price`, `products.stock`, `products.sku`) once no code reads them.

Existing `orders` rows don't need backfill — they already stored denormalized `name`/`price`, so historical orders still display correctly. New orders include `variantId`.

## Open Questions (answer before implementation)

1. **Variant-level images**: does every variant need its own image, or only color variants? (Size usually doesn't need unique photos; color does.) Decision affects UX and storage costs.
2. **Max variants per product?** Shopee caps at 50 (2 options × ~25 values). We should cap similar to avoid combinatorial explosion.
3. **Price per variant or shared price?** Shopify allows either. Simpler UX if price is product-level with per-variant override.
4. **Stock tracking granularity**: per-variant only, or also a product-level "total across variants" rollup for the dashboard summary?
5. **SKU uniqueness scope**: per retailer (current behavior) still holds — the `by_retailer_sku` index moves to `productVariants`. Products themselves no longer have SKUs.
6. **Default variant on product page**: first variant by sortOrder, or last-viewed from URL param (`/store/slug/product/xyz?size=M&color=red`)?

## What to Do Now (MVP-compatible)

To keep the door open without committing to variants yet:

- **Keep the flat schema.** Don't add `options` or `productVariants` yet.
- **Design the xlsx headers to be variant-extensible** — avoid encoding `"Red / M"` into the `name` column at import time; if retailers do this manually it's fine, but don't make it a documented convention we'd have to unwind later.
- **Cart items already key on `productId`** — plan for a refactor to `variantId`, but don't introduce the indirection yet.
- **Don't build features that lock in the flat shape**, e.g., a dashboard report grouping strictly by product with no room for a variant dimension.

When retailer feedback shows real variant pain (count of manual "Jacket Red M"-style duplicate products, or marketplace connector on the horizon), revisit this doc.
