# Custom / Made-to-Order Option

**Status:** shipped. Code + tests + docs. Schema widened (dev); the new columns
are additive + optional, so **no production backfill** is required.

## 1. Why

Variant axes are for **combinable** attributes — every Size works with every
Flavour, so `Size × Flavour` is a real grid. A bespoke "Custom" offering is *not*
a combinable attribute: there's no "Small Custom vs Large Custom," there's just
*Custom*. Modelling it as an axis value forced the cartesian to multiply it
across every size (`Small/Custom`, `Medium/Custom`, …), leaving the seller to
manually deactivate the duplicates — fragile and confusing.

This feature lets a product offer **one** custom / made-to-order line that lives
**outside** the option-axis grid, so it shows up exactly once. It reuses the
existing mockup-approval + re-quote machinery (`requiresProof` → `mockupStatus`)
end-to-end, so there is **no new order-flow code**.

> A product that is *only* bespoke (no standard variants) is the **"Made to
> order" product type** — the third answer to "What kind of product is it?" in
> both editors (ClickUp `86eyfq04j`). It is **this same custom line, as the
> product's only variant**: no cartesian matrix at all, which the server allows
> for exactly that shape (`validateVariantSet`'s `customOnly`). So everything
> below — the buyer's request box, the "Choose" routing that stops a one-tap
> quick-add, the qty-1 cart line, mockup approval, the min-order exemption —
> applies to it unchanged, by construction rather than by a parallel code path.
> See
> [`product-setup-wizard.md`](./product-setup-wizard.md#the-made-to-order-product-type-2026-08-02-clickup-86eyfq04j).
>
> The **checkbox** below is therefore only for the other case: a standard
> catalog **plus** a bespoke line on the same product. It isn't offered on a
> made-to-order product, which already is that line.

## 2. Data model

A custom line is a **real `productVariants` row** (orders reference a real
`variantId`, so a synthesized/virtual line was rejected). New optional columns on
`productVariants`:

| Column | Meaning |
|---|---|
| `isCustom?: boolean` | The discriminator. The row has `optionValues: []` — a no-axes **default** variant also has `[]`, so the two are told apart **only** by this flag, never by `optionValues`. |
| `customLabel?: string` | Buyer-facing name (default `"Custom"`). |
| `customPrompt?: string` | Optional buyer guidance ("Tell us your design, flavour & date"). |

Coerced server-side on save regardless of client input: `requiresProof: true`,
`blockWhenOutOfStock: false` (made-to-order, never blocks), `onHand: 0`, no `sku`.
Price is optional: `0` → "Price on quote" (seller quotes on the mockup); `>0` → a
"from" base price. **≤1 custom line per product**, and it does **not** count
toward the `MAX_VARIANTS_PER_PRODUCT` (50) cartesian cap.

Caps live in `convex/lib/variant.ts`: `MAX_CUSTOM_LABEL_LENGTH` (40),
`MAX_CUSTOM_PROMPT_LENGTH` (280), `DEFAULT_CUSTOM_LABEL`.

## 3. Engine / invariant changes (the careful part)

- **`validateVariantSet`** (`convex/products.ts`) splits inputs into the cartesian
  **matrix** (`isCustom` falsy) and the optional **custom** line. The
  count/coverage check against the cartesian runs on the **matrix only**; the
  custom line is validated + coerced by `validateCustomLine` and appended. Matrix
  rows are defensively stripped of any custom fields.
- **`saveVariantGrid` reconciliation** keys on **`(isCustom, optionValues)`** and
  skips already-matched rows — so a no-axes default and a custom line (both `[]`)
  can't fuse, and each keeps its `_id` (historical orders' `variantId` stay valid).
- **`src/lib/variant.ts`**: `availableValuesPerAxis` and `resolveVariant` exclude
  `isCustom` rows (not addressable by the axis pills — and on a no-axes product the
  custom row would otherwise shadow the real default on the empty selection).
  `getCustomLine(variants)` returns the custom row, selected via its own CTA.
- **`productWithVariants` rollup**: a RM0 custom row is a quote variant
  (`requiresProof && price === 0`) → already excluded from `priceFrom/priceTo` and
  flips `hasQuotePricing`. A custom line with a base price joins the "from" range.
  `inStock` stays `true` while a made-to-order custom exists — **intended**: you can
  always custom-order even if every shelf variant is sold out.

## 4. Seller UX (`variant-editor.tsx` + `product-form.tsx`)

A product-level **"Also offer a custom / made-to-order option"** checkbox under
the grid. When on, a dedicated card (kept out of the grid) edits: name, optional
starting price (blank = "Price on quote"), optional image, optional buyer prompt,
plus a note that it's made-to-order + mockup-approved. The custom line is carried
through the *same* `variants[]` array as a flagged entry (`isCustom: true`), so
`create` / `saveVariantGrid` / edit-route `initialValues` needed no new plumbing —
`initialEditorState` pulls the custom row into the dedicated editor and keeps it
out of the grid rows.

## 5. Buyer UX (`product-detail-sheet.tsx` + `product-card.tsx` + `product-grid.tsx`)

- The product page (and the seller's draft-preview sheet) shows a separated,
  **self-contained "Custom order" card** below the standard variant picker: a
  zoomable image, label, price ("from RM x" / "Price on quote"), a **"Your
  request" textarea** (the seller's `customPrompt` is its placeholder — so the
  buyer can type their size/colour/design spec, capped at 280 chars), and **its
  own "Request custom order" button**. It is **independent** of the axis pills —
  *not* mutually exclusive — so a buyer can add a standard variant **and**
  request the custom line in one visit. The purchase bar's "Add to cart" drives
  only the standard variant.
- **Where that CTA lives depends on whether the line IS the product.** One
  component decides, for both views: `PurchaseActions` renders the stepper +
  "Add to cart" when the product sells a standard line, and **"Request custom
  order"** when it doesn't (a made-to-order product — see
  [`product-setup-wizard.md`](./product-setup-wizard.md#the-made-to-order-product-type-2026-08-02-clickup-86eyfq04j)).
  So the bar always holds exactly one CTA, wherever the buyer's thumb already
  is, and `CustomOrderCard` renders its own button **only** in the
  catalog-plus-bespoke case — never both. On a made-to-order product the card
  also drops its identity row (thumbnail / label / price): the page heading
  already carries all three, and it states the mockup gate instead.
- The buyer's request rides the cart line (`CartItem.note`) and is folded —
  labelled by item — into the order's **`customerNote`** at checkout via
  `composeCustomerNote` (`src/lib/order-note.ts`), so it reaches the seller through
  the existing note channel (WhatsApp "Note for seller" + dashboard + email) with
  **no per-item order field**. It's also shown under the line in the cart review.
- **Optional reference photo.** The custom card has an "Add a photo" control — a
  picture says more than a note for a bespoke order (cake design, colour ref). The
  image is **uploaded on attach** (matching the seller mockup pattern, since a
  `File` can't survive cart persistence) via the public, rate-limited
  `orders.generateCustomImageUploadUrl` (keyed by `retailerId` — the order doesn't
  exist yet), and the resulting `storageId` rides the cart line
  (`CartItem.customImageStorageId`). At checkout the first custom line's image is
  passed to `orders.create` as **`customerImageStorageId`** (one image per order —
  one custom negotiation; a stray id on a non-custom order is dropped server-side).
  The seller sees it on the order-detail "Note from customer" card
  (`orders.getCustomerImageUrl`, zoomable); the buyer sees a "📎 Reference photo
  attached" chip in the cart review. **Rate limit:** `customImageUpload`.
- The sheet **stays open after an add** (a toast confirms; the cart bar updates) so
  multiple items can be added without reopening. This applies to all products
  (`product-grid.tsx` `onAdd` no longer closes the sheet).
- The custom cart/order line is labelled with its **`customLabel`** (cart
  `optionLabel`; order `variantLabel`) so it reads "… (Custom)" / "… — Bespoke"
  rather than an unlabelled row indistinguishable from the default variant.
- The product card routes to the detail sheet (never quick-add) whenever a custom
  line exists, with a small **"Custom available"** hint.
- Checkout / `wa.me` handoff is unchanged — the custom line is a normal cart item.
  Post-order, `requiresProof` puts the order into `mockupStatus: "pending"` and the
  existing seller mockup-submit → re-quote → buyer-approve flow handles spec +
  final price. **Zero order-flow changes.** (See `docs/proof-approval.md`.)

### 5b. "From" — a custom line's price is a STARTING price (ClickUp `86eyhn4mr`)

The custom card said "from RM 40", but every *other* price surface printed the
same number bare — so a made-to-order product (whose only variant IS the custom
line) showed a headline **`RM 40.00`** that reads as the bill. BearCamp's
variable-priced services (tent cleaning/repair) is where it hurt: the mockup
quote is **added on top** (`computeOrderTotals` extras), so the printed number
can only ever go up.

One pure predicate is the whole feature: **`hasStartingPrice(variants)`**
(`src/lib/variant.ts`) — *an **active** custom line priced **> 0***. Priced at 0
it stays "Price on quote" (`hasQuotePricing` already covers that, and "From RM
0" would be worse); a **standard** variant is always a fixed price, so a bespoke
line beside a catalog never makes the *selected* size negotiable.

Every surface that prints a price now agrees:

| Surface | Before | After |
|---|---|---|
| Product page + detail sheet headline | `RM 40.00` | **From** `RM 40.00` (shared `PriceLabel`, "From" as a small muted word — never part of the big number) |
| Storefront grid card | `RM 40.00` | `From RM 40.00` (`showFrom` gained the predicate; the existing lowercase "from" for price *ranges* is now "From" too, one vocabulary) |
| Checkout receipt line | `40.00` | `From 40.00` |
| Checkout TOTAL (both the receipt block and the mobile bar) | `RM 40.00` | `RM 40.00 + your quote` — via the shared `pendingTotalParts`, which also lists a pending delivery fee, so a cart with both reads `+ your quote + delivery` |
| Product JSON-LD | flat `Offer.price` | `AggregateOffer` with `lowPrice` and **no** `highPrice` (a flat price would promise a total the mockup can exceed) |
| Seller product list | `RM 40.00` | `From RM 40.00`, and an all-quote product finally says `Price on quote` instead of `RM 0.00` |
| Edit form summary strip | `One item · No price yet · + custom option` (the made-to-order shape fell through every branch) | `Made to order · From RM 40` |
| Wizard review preview | `RM 120` | `From RM 120` |

Seller-side discoverability: the made-to-order price field is labelled
**"Starting price"** in both editors (it already was under Advanced; the
made-to-order card said just "Price"), and both helpers now say *"Buyers see
'From RM …', so they know the final price comes with the mockup."*

**Not changed:** a **non-custom** variant with mockup approval and a fixed price
still prints that price bare — the seller set an amount for a specific size and
`submitMockup` explicitly makes the re-quote optional there. Counter checkout is
also untouched: it shows "Custom price" because the cashier types the real
amount at the point of sale.

## 6. Edge cases

- **No-axes default + custom** = two `[]`-keyed rows, disambiguated by `isCustom`
  everywhere (reconcile, resolve, availability).
- **`productId`-only order resolve** (the migration convenience in `orders.create`)
  becomes correctly ambiguous once a custom line exists (2+ variants), so the
  storefront's always-`variantId` path is required — no regression for true
  single-variant products.
- **Quick-add** is disabled when a custom line exists.
- **Quantity is locked to 1** for the custom line — it's one bespoke negotiation
  (the mockup + quote are per-order: one mockup set, one quoted total, one
  approval). Re-requesting **updates the note** instead of stacking qty
  (`CartItem.isCustom` → the cart reducer keeps qty 1). Scope/quantity/price are
  settled via the buyer's note + the seller's mockup + single quote. The seller can
  attach **up to 5 mockup images** (designs/angles, or one per item) — see
  `docs/proof-approval.md` §6.
- **Removing the custom option** with live custom orders is safe — orders snapshot
  the item name/price at create time (same as any variant).

## 7. Tests

- `convex/products.test.ts` → "custom option": create coerces made-to-order +
  excludes the RM0 line from the price range; blank label defaults to "Custom";
  a no-axes default + custom coexist and reconcile by identity (no fuse, `_id`
  preserved); rejects >1 custom line; rejects a custom line tied to option values.
- `src/lib/variant.test.ts` → "custom line": `getCustomLine`; the custom row never
  shadows the default on the empty selection; excluded from axis availability;
  `hasStartingPrice` (priced custom line yes / RM0 no / standard-only no /
  deactivated custom line no).
- `src/components/storefront/product-card.test.tsx` +
  `product-purchase.test.tsx` → the "From" prefix on a starting price, the bare
  price on a *selected* standard variant, and "Price on quote" still winning at
  RM0. `checkout-summary.test.tsx` → "From 40.00" on the line and
  `+ your quote [+ delivery]` on the total.
- `src/lib/product-summary.test.ts` + `src/components/forms/product-wizard.test.ts`
  → the seller-side strip/preview print the same "From".
- `src/components/forms/variant-editor.test.tsx` → "custom line": the card appears
  only after opt-in and stays out of the grid; seeds from an existing line.
- `src/components/storefront/product-detail-sheet.test.tsx`: custom line is an
  independent add carrying the buyer's note; not mutually exclusive with the pills.
- `src/lib/order-note.test.ts`: `composeCustomerNote` labels per-item notes, orders
  them ahead of the general note, and returns `undefined` when empty.
- `convex/orders.test.ts` → "buyer custom image": create stores
  `customerImageStorageId` + `getCustomerImageUrl` resolves it; a stray image on a
  non-custom order is dropped; `generateCustomImageUploadUrl` returns a URL.

## 8. Touch points

Authoring + resolution: `convex/schema.ts`, `convex/lib/variant.ts`,
`convex/products.ts`, `src/lib/variant.ts`,
`src/components/forms/variant-editor.tsx`, `src/components/forms/product-form.tsx`,
`src/routes/app.products.$productId.tsx`.

Storefront + ordering: `src/components/storefront/product-detail-sheet.tsx`
(independent add + buyer note + reference-photo upload), `…/product-card.tsx`,
`…/product-grid.tsx` (note/image → cart, stay-open), `…/checkout-form.tsx`
(`composeCustomerNote` + first custom image → `customerImageStorageId`),
`src/hooks/useCart.ts` (`CartItem.note` / `.customImageStorageId`),
`src/lib/order-note.ts`. Backend: `orders.generateCustomImageUploadUrl` +
`getCustomerImageUrl`, `orders.customerImageStorageId` (schema), `customImageUpload`
rate limit; the order-line **label** uses `customLabel`. Seller view:
`src/routes/app.orders.$shortId.tsx` ("Note from customer" card). Otherwise the
`requiresProof` → mockup path already covers it.
