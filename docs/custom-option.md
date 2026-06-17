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

> When NOT to use it: a product that is *only* bespoke (no standard variants)
> should just be a single made-to-order variant with **Require mockup approval**
> on — that's the existing path. The custom option is for "standard catalog **plus**
> a bespoke line on the same product."

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

- The detail sheet shows a separated, **self-contained "Custom order" card** below
  the standard variant picker (and standalone for no-axes products): a zoomable
  image, label, price ("from RM x" / "Price on quote"), a **"Your request"
  textarea** (the seller's `customPrompt` is its placeholder — so the buyer can
  type their size/colour/design spec, capped at 280 chars), and **its own "Request
  custom order" button**. It is **independent** of the axis pills — *not* mutually
  exclusive — so a buyer can add a standard variant **and** request the custom line
  in one visit. The bottom sticky "Add to cart" drives only the standard variant.
- The buyer's request rides the cart line (`CartItem.note`) and is folded —
  labelled by item — into the order's **`customerNote`** at checkout via
  `composeCustomerNote` (`src/lib/order-note.ts`), so it reaches the seller through
  the existing note channel (WhatsApp "Note for seller" + dashboard + email) with
  **no per-item order field**. It's also shown under the line in the cart review.
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

## 6. Edge cases

- **No-axes default + custom** = two `[]`-keyed rows, disambiguated by `isCustom`
  everywhere (reconcile, resolve, availability).
- **`productId`-only order resolve** (the migration convenience in `orders.create`)
  becomes correctly ambiguous once a custom line exists (2+ variants), so the
  storefront's always-`variantId` path is required — no regression for true
  single-variant products.
- **Quick-add** is disabled when a custom line exists.
- **Quantity** is allowed for custom orders (e.g. 10 custom cupcakes); the seller
  quotes the total on the mockup.
- **Removing the custom option** with live custom orders is safe — orders snapshot
  the item name/price at create time (same as any variant).

## 7. Tests

- `convex/products.test.ts` → "custom option": create coerces made-to-order +
  excludes the RM0 line from the price range; blank label defaults to "Custom";
  a no-axes default + custom coexist and reconcile by identity (no fuse, `_id`
  preserved); rejects >1 custom line; rejects a custom line tied to option values.
- `src/lib/variant.test.ts` → "custom line": `getCustomLine`; the custom row never
  shadows the default on the empty selection; excluded from axis availability.
- `src/components/forms/variant-editor.test.tsx` → "custom line": the card appears
  only after opt-in and stays out of the grid; seeds from an existing line.
- `src/components/storefront/product-detail-sheet.test.tsx`: custom line is an
  independent add carrying the buyer's note; not mutually exclusive with the pills.
- `src/lib/order-note.test.ts`: `composeCustomerNote` labels per-item notes, orders
  them ahead of the general note, and returns `undefined` when empty.

## 8. Touch points

Authoring + resolution: `convex/schema.ts`, `convex/lib/variant.ts`,
`convex/products.ts`, `src/lib/variant.ts`,
`src/components/forms/variant-editor.tsx`, `src/components/forms/product-form.tsx`,
`src/routes/app.products.$productId.tsx`.

Storefront + ordering: `src/components/storefront/product-detail-sheet.tsx`
(independent add + buyer note + zoomable image), `…/product-card.tsx`,
`…/product-grid.tsx` (note → cart, stay-open), `…/checkout-sheet.tsx`
(`composeCustomerNote`), `src/hooks/useCart.ts` (`CartItem.note`),
`src/lib/order-note.ts`. The order-line **label** uses `customLabel`
(`convex/orders.ts`); otherwise the `requiresProof` → mockup path already covers it.
