# Product Variants — Implementation Spec (ticket `86extjqxf`)

Finalized, boss-approved plan for generalizing products from flat single-SKU to the
standard **option-axes + variant-rows** model (the Shopify/Shopee/TikTok-Shop shape).
This supersedes [`product-variants-roadmap.md`](./product-variants-roadmap.md) (the
pre-build menu of decisions).

**Status: implemented** on `zaki/#86extjqxf-explore-variants-for-inventory` —
backend + storefront + dashboard editor + WhatsApp/email labels, with tests
(373 passing), typecheck, and lint green. Pushed to the **dev** Convex deployment
only. Still pending: manual QA by Zaki + boss sign-off, and the staged
**production** rollout (widen → backfill → switch → narrow), which is the separate
migration task — not done here. `convex run migrations:backfillDefaultVariants`
backfills default variants for pre-existing flat products.

## 1. Why this feature

Sellers can't model a product that comes in more than one form. Today `products` is flat
— one row = one price/stock/SKU (`convex/schema.ts:105`). The moment a retailer sells
"Frozen Salmon · 1kg · fillet" vs "· 500g · whole", or metal prints in 5 sizes, they have
to create near-duplicate products.

Confirmed demand signal from **Metalpix** (Sukhjeet, ask #4: *"TikTok-Shop-style products
— one product, multiple variants, each variant its own price"*), and it's table stakes for
the F&B beachhead, where pack-size selling is how the vertical works (cake sizes, frozen
pack weights). After shipping, one listing carries N sellable units, each with its own
price/stock/weight, behind a single storefront product page with pickers.

**Scope guard:** this is NOT a fashion-grade matrix builder. Cap at **1–2 option axes**.
That covers ~all of F&B and metal prints. More axes = combinatorial explosion in both UI
and seller effort.

## 2. Goal

Generalize products from flat single-SKU to option-axes + variant-rows, so a seller
defines arbitrary option axes (Size, Weight, Cut, Color…) and each value-combination is a
first-class variant with its own price, stock, parcel weight, SKU, and optional image —
surfaced as pill pickers on the storefront.

## 3. User stories

- As a retailer, I want to add option axes (e.g. "Size" with values 5x7/8x12/…) so I don't create duplicate listings.
- As a retailer, I want each variant to have its own price and stock so I can charge more for larger sizes.
- As a retailer, I want a single editor that generates the variant grid from my axes so I'm not hand-building combinations.
- As a retailer, I want a rich product description so I can list specs and "what's included" per size.
- As a shopper, I want to pick size (and any other axis) on one product page and see the price/stock/image update live.
- As a shopper, I want sold-out combinations greyed out so I don't order what isn't available.

## 4. Acceptance criteria

- A product can declare **0, 1, or 2** option axes; each axis has a name + ordered list of values.
- Every product resolves to **≥1 variant**. A no-option product has exactly one implicit
  variant (`optionValues: []`) — there is **no separate "simple product" code path**.
- Variant editor auto-generates one row per cartesian combination of axis values; supports
  bulk-fill (set all prices/stock at once) and per-row deactivate.
- Storefront product page renders one pill row per axis (in `options` order); a complete
  selection resolves exactly one variant and updates displayed price + stock + image.
- **Image fallback:** when the resolved variant has no image, the page shows the
  product-level hero image (Metalpix's exact case — one hero + a size-comparison graphic,
  no per-variant photos).
- Product description stays **product-level** (one per listing) and renders as **sanitized
  markdown** on the storefront, so specs and "what's included" show as readable lists.
  Per-variant differences ("5x7: stand; 8x12: magnet set") are expressed as text within the
  one description — there is no per-variant description field. The description is NOT the
  home for store-wide FAQ (delivery zones, halal, storage/shelf-life) — that belongs
  store-level on `retailers` as a separate feature.
- **Grey-out has two distinct disable reasons — keep them separate:**
  1. **No variant exists** for the partial/complete selection (never a valid combo) → always disabled.
  2. **Resolved variant is sold out** (`onHand = 0`) → disabled **only when** the product's
     `blockWhenOutOfStock` is on. Made-to-order products (frozen pack-to-order; metal prints
     = effectively infinite) leave sold-out combos sellable.
- "Add to cart" disabled until a complete, sellable variant is selected.
- Cart treats different variants of the same product as **distinct lines**.
- Order line items persist `variantId` + a human `variantLabel` ("1kg / Fillet"); historical orders unaffected.
- WhatsApp order/confirmation message includes the variant label per line.
- Mobile-first: pill rows wrap, ≥44px tap targets, variant grid editor usable on a phone.

## 5. Schema changes (`convex/schema.ts`)

**Modify `products` (line 105):**
- add `options: v.array(v.object({ name: v.string(), values: v.array(v.string()) }))`
- add `blockWhenOutOfStock: v.optional(v.boolean())` — per-product toggle gating reason (2)
  above. Undefined/false = made-to-order (never block); true = hard-block sold-out combos.
- **Deprecate** (keep during migration, then drop) `price`, `stock`, `sku`.
- `description` (`v.optional(v.string())`, line 112) — **no schema change**; only its
  storefront rendering upgrades to markdown (see §6).

**New table:**

```ts
productVariants: defineTable({
  productId: v.id("products"),
  retailerId: v.id("retailers"),        // denormalized for the SKU index
  optionValues: v.array(v.string()),    // positionally aligned with product.options
  sku: v.optional(v.string()),
  price: v.number(),                    // minor units
  onHand: v.number(),
  reserved: v.number(),                 // stays 0 until HitPay; build now, no migration later
  parcelWeightG: v.number(),            // feeds weight-band delivery (separate task); 0 = unset
  imageStorageIds: v.array(v.string()),
  active: v.boolean(),
  sortOrder: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_product", ["productId"])
  .index("by_retailer_sku", ["retailerId", "sku"])
```

**`orders.items[]` (line 170):** add `variantId: v.id("productVariants")` +
`variantLabel: v.optional(v.string())` alongside existing `productId`/`name`/`price`.
Price stays **server-derived** from the variant — `orders.create` takes `variantId`, never a
client price (preserves the existing `{ productId, quantity }`-only trust model at
`orders.ts:62`).

## 6. Code touch points

- **`convex/schema.ts`** — `products.options` + `blockWhenOutOfStock`, new `productVariants` table, `orders.items[]` variant fields.
- **`convex/products.ts`** — variant CRUD; `create`/`update`/`archive` become
  product+variant aware; the implicit-default-variant invariant lives here. `bulkUpsert`
  (line 306) / `bulkUpsertPreview` (414) → see import subtask.
- **`convex/orders.ts` + `convex/lib/order.ts`** — order create reads/decrements
  `productVariants.onHand` in the transactional mutation (Convex gives concurrency
  correctness for free); totals + `orders.items` carry `variantId`/`variantLabel`.
- **`src/routes/app.products.$productId.tsx`** — the new variant-grid editor (axis builder +
  cartesian grid + bulk-fill) AND the product description editor (plain textarea; markdown
  authored as plain text).
- **`src/routes/app.products.index.tsx`** — product list shows "from RM X" / variant count.
  ⚠️ This read now **aggregates `productVariants` per product** — fetch by `by_product` and
  reduce; do **not** query per-row in a loop (read-amplification / N+1 watch).
- **Storefront `$slug` product route** — N pill rows, live variant resolution, grey-out
  logic, image fallback to product hero, AND render description as **sanitized markdown**
  (vetted renderer + HTML allowlist — this is the one XSS surface; seller-authored content
  on a public page).
- **`src/hooks/useCart.ts`** — dedupe key `productId` → `variantId`; cart item gains
  `variantId` + `optionLabel`.
- **Channel adapter (`convex/lib/channels/`)** — variant label into the **outbound**
  confirm/status message render only. ⚠️ **Correction vs original plan:** there is *no*
  inbound parser work — the inbound webhook matches an order purely by `ORD-XXXX` shortId
  (`whatsapp.ts:62`) and never re-parses line items. Orders are built from structured
  storefront data, so the variant already lives on the order; the adapter just formats the
  label into message copy.

## 7. Edge cases

- **Combinatorial cap:** hard-limit axes to **2** and total variants per product (~**50**,
  Shopee parity) to avoid grid blowup.
- **Partial selection on storefront:** compute the valid value-set client-side as the buyer
  narrows; disable impossible combos (reason 1 above).
- **Concurrency:** two buyers, last unit — handled by the Convex transactional mutation on
  `onHand`. No locking tricks needed.
- **Out-of-stock vs made-to-order:** the `blockWhenOutOfStock` toggle (§5). A hard 0-block
  kills the orders the "nothing gets missed" promise covers, so frozen-food pack-to-order
  and metal prints default to never-block.
- **Variant image optional:** Metalpix uses one hero + a "Size Comparison" graphic instead
  of per-variant photos — don't require an image per variant; fall back to the hero.
- **Description markdown sanitized** (render-side, allowlist) — strip scripts/raw HTML.
- **Historical orders:** already store denormalized `name`/`price`, so no backfill; only
  new orders get `variantId`.
- **SKU uniqueness** moves to the variant (per-retailer scope, `by_retailer_sku`); products
  no longer hold SKUs.

## 8. Deferred sibling — buyer personalization fields (NOT in this ticket)

Variant axes model **discrete sellable units**. They structurally **cannot** represent
free-text per-order personalization — "Message on cake: *Happy Birthday Sarah*", a pickup-date
note — because every distinct string would spawn a new variant row and blow the grid to
infinity. This is a real F&B need (cake decorators are persona #1) that this feature does
**not** cover, by design.

The correct shape is a separate, orthogonal concept: a per-product list of **buyer fields**
(`{ label, required, maxLength }`) whose values ride on the **order line** (not the product
catalog). Tracked here only so it is a *conscious deferral* — the next person must not
assume "variants covers customization." Scope it as its own ticket after this ships.

## 9. Dependencies / blocks

- **Bulk-import rework** (subtask) — **shipped** (2026-06-04): variant-aware one-row-per-variant import/export with auto-fill + upsert-by-SKU. See [`bulk-product-upload-roadmap.md` § Shipped](./bulk-product-upload-roadmap.md#shipped--variant-aware-importexport-2026-06-04).
- **Blocks the data migration** (separate task) — existing flat products must be backfilled
  to default variants before reads switch. Migration is its **own reviewable unit** (it does
  not ride this feature PR): additive → backfill default variants → dual-write behind a
  per-retailer flag → switch reads → drop deprecated fields.
- **Blocks `86extzdwf`** (already a dependency on this task).
- **Plays alongside the Delivery-charge task:** `parcelWeightG` on the variant is what
  weight-band delivery sums. Backfilled/legacy variants read as `0` (weightless) until edited.
- Store-level FAQ on `retailers` is a separate, out-of-scope feature — flagged so
  `description` isn't overloaded to fake it.
- `reserved` is forward-wiring for the HitPay reservation/hold pattern — present but unused
  until payments go live.
- **Buyer personalization fields (§8)** — deferred sibling, separate ticket.

## 10. Effort estimate

**L — 4–6 days.** Schema + storefront picker is the easy ~70%; the variant-grid editor
(cartesian generation, bulk-fill, per-row image) and the cart→variant refactor are where the
time goes. Markdown description rendering is a small add (~0.25d). Staged migration adds
cutover care, not raw build time — tracked in the migration task.

## 11. Tier impact

- **Pro (RM149)** — variants is a Pro+ capability per the Metalpix triage. **Starter** stays
  single-variant (flat-feeling) products.
- Because of the implicit-default-variant invariant, Starter products are *also*
  single-variant under the hood — so the gate is **purely UI** (hide the axis-builder).
  The backend order path stays uniform, no `if (tier)` branching. This is why the "no
  separate simple-product path" invariant is load-bearing.
- **Markdown description** is universal (all tiers).

---

### Competitive validation — why 2 axes / 50 variants (added 2026-06-03)

The 1–2 axis cap was checked against the marketplaces Malaysians actually use, and
it is **exact parity**, not a shortfall:

| Platform | Max variation axes | Total SKU/combo cap |
|---|---|---|
| **TikTok Shop** | **2** (Variation 1 + 2) | 100 SKUs |
| **Shopee (MY)** | **2** tiers | **≤50 combinations** |
| **Lazada** | **2** (since Jul 2025) | ≤20 per axis, category-dependent |
| **Meta (FB/IG Shops)** | recognised variant fields (color/size/material/pattern) | feed-based |
| **Kedaipal** | **2** (`MAX_OPTION_AXES`) | **50** (`MAX_VARIANTS_PER_PRODUCT`) |

Key finding: the giants do **not** absorb "vast product variety" with *more variation
axes* — they cap at 2 universally. Variety is handled in a **second, separate layer**:
**category-driven attribute templates** (brand, material, ingredients, halal, weight,
size-chart) that *describe* a product and drive search/filter/compliance but **do not
generate SKUs**. Picking a category reveals a tailored attribute set and constrains
which variations are even allowed.

Decision for Kedaipal: **keep 2 axes + 50 cap** (settled), and **do not** build a
category-attribute engine — that is marketplace-scale machinery for a *general* platform
spanning electronics→groceries. As a **single-store, vertical-focused** storefront, the
product-level **markdown description already carries the descriptive long-tail**
("what's included", ingredients, specs). The right-sized version of "templates by type"
for our cohort is the lightweight **preset axis chips** (tap *Size* / *Weight* / *Flavour*
/ *Pack* to pre-fill an axis) — a nudge, not an engine. Implemented in the variant editor.
Staying at 2 axes also maps cleanly onto the parked marketplace connectors (no lossy
down-convert later). Sources captured in the originating research thread.

### Real-world reference

[metalpix.my](https://metalpix.my) product page uses a single "Size" axis as wrapping pills
(5x7 / 8x12 / 10x10 / 11x14 / 12x18), per-variant price, one hero image + a size-comparison
graphic (no per-variant photos), and bundles "what's included" into the product description
as free text. Confirms the 1-axis pill picker as the v1 target, description-as-markdown for
specs, and that the grey-out/stock half is exercised by F&B, not by their made-to-order prints.
