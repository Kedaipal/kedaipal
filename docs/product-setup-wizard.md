# Product setup wizard & the question-first product form

ClickUp: [`86ey9udvz`](https://app.clickup.com/t/86ey9udvz) · Approved design
mockup: <https://claude.ai/code/artifact/8a88b292-8212-47a5-bc92-6327aefb67a0>

## One draft substrate, two skins (the parity invariant)

**The wizard's selling configuration IS a `VariantEditorState`** — the same
shape the full form edits (`WizardState.editor`). There is no translation
layer between the two views, so switching (`wizardHandoff` /
`formDraftToWizardState`) passes the substrate through untouched — every
capability exists in both views by construction: second choice axis,
per-choice photos/SKUs/on-off/approval, mixed fulfilment, the custom line
with photo, order rules. The wizard's validators delegate to the SAME
`buildSubmitVariants` / `collectOptionIssues` the form uses, re-addressed to
wizard fields — the two views can never disagree about what's valid. Adding
a capability to `VariantEditorState` means deciding where it surfaces in the
wizard (usually behind a progressive-disclosure link), never whether.

## Why

The add/edit product page is the first real task every new seller faces, and
the old form showed **every capability at once** — readiness strip, visibility,
categories, and a "Step 3" that packed price, stock, fulfilment mode, option
axes, mockup approval, the custom line and SKUs into one wall. A kuih seller
adding "Brownies — S/M/L, made to order" met the words *variant, SKU, option,
approval* before typing a price.

The fix is not just splitting the form into steps — it's **replacing settings
with questions whose answers derive the configuration**. The seller answers
"Does the buyer pick anything?" and "How do you prepare orders?"; the form
derives `options`, variant rows and `blockWhenOutOfStock` from the answers.
Zero backend change: everything still maps onto `ProductFormSubmitValues` and
the existing `products.create` / `saveVariantGrid` mutations.

## Create = the 5-step wizard (`/app/products/new`)

`src/components/forms/product-wizard.tsx`, mounted by
`src/routes/app.products.new.tsx`. One question per screen, progress dots,
back button; state lives in one `WizardState` and survives jumping between
steps.

| Step | Question | Derives |
| --- | --- | --- |
| 1 · Name it | "What are you selling?" — name + photos, description behind a link | `name`, `imageStorageIds`, `description` |
| 2 · Choices | "Does the buyer pick anything?" — *Just one item* / *Buyer picks a choice* (preset chips: Size/Flavour/Weight/Pack, values typed as chips). "+ They also choose by something else" reveals the **second axis** (Size × Flavour) — zero pixels unless used | `editor.options` |
| 3 · Price | One price per choice (all combinations when two axes) + "Same price for all". "+ Photos, item codes (SKU) & more per choice" reveals per-row photo · SKU · on/off · design-approval — the full form's per-choice details, behind one link | per-row `price` (+ extras) |
| 4 · Preparation | "How do you prepare orders?" — *Made to order* / *From stock* (stock steppers on tracking rows). "Vary per choice" reveals per-row Track-stock/Made-to-order toggles (auto-open when a restored draft is mixed) | per-row `blockWhenOutOfStock` + `onHand` |
| 5 · Review | Buyer-eye preview card + summary rows with per-row Edit + **optional publish settings** (Visible/Hidden toggle; category picker **only when the store has categories**) + the **"More options"** disclosure | submit (+ `hidden`, `categoryIds`, `requiresProof`, custom line) |

Validation: the branching questions (2/4) gate Continue structurally
(disabled + one-line reason); text inputs validate on Continue with inline
`aria-invalid` + message (never a generic banner). Publish re-validates every
step — including the review step's custom-line price — before submitting.

A **Cancel ✕** in the wizard header exits directly (confirm-if-dirty) — no
pressing Back through every step.

**Header sizing (mobile):** the row carries back + title + progress dots +
cancel, so step titles are capped at ~12 characters ("Preparation", not
"Preparing orders" — the full question is the heading inside the step), the
gap tightens to `gap-2` below `sm`, and only the CURRENT progress dot widens
(completed steps stay small but accent-coloured). Measured at 320/375/390/430
— the title fits with headroom at every width; before this, step 4 truncated
on everything below 430.

**Publish settings on review** (never a create-then-edit round trip):
**visibility** (counter-only products are created hidden directly — the
Rahman's-lekor pattern, docs/hidden-products.md) and **categories** — the
picker only renders when the store has ≥1 active category, so a brand-new
seller never meets the concept mid-wizard.

**"More options" on review:**
- **Design approval (mockup)** — product-level checkbox, offered when any
  choice is made to order (proof gating is a made-to-order concept — Zaki's
  call); indeterminate when per-choice settings vary (set per choice in the
  Price step's details).
- **Custom / made-to-order option** — label, price-on-quote, buyer prompt AND
  photo (`VariantImageCell`), same as the full form.
- **Order rules** — minimum order quantity + minimum notice days, mirroring
  the edit form's "Order rules" card. Blank = no rule (mapped to `undefined`,
  never 0, so the create mutation simply omits them).
- **"Open in the full editor"** — same draft, other skin: `wizardHandoff`
  passes the editor substrate as-is (in-memory via the route's `wizardDraft`;
  a refresh falls back to a blank full form).

**Escape hatch:** "Skip — use the full form" on step 1 →
`/app/products/new?form=full` renders the same restructured `ProductForm` the
edit page uses (`validateSearch` on the route), seeded with the whole wizard
draft; "← Prefer the guided setup? Switch back" returns losslessly. The
import flow is untouched — bulk sellers never see the wizard.

Pure, unit-tested helpers (`product-wizard.test.ts`): `wizardStepIssues`,
`buildWizardSubmitValues`, `wizardHandoff`, `formDraftToWizardState`,
`wizardInitialStep`, `wizardPriceLabel`.

## Edit = the question-first full form

A stepper is wrong for editing (sellers jump straight to "change Medium's
price"), so `ProductForm` keeps all sections visible but now mirrors the
wizard's mental model:

- **Summary strip first, in words** — "Chocolate fudge brownies — 3 choices by
  Size · Made to order · RM 12–28", live-derived by `describeProduct`
  (`src/lib/product-summary.ts`, unit-tested). Create/skip mode keeps the old
  readiness checklist instead (a create-time concept).
- **Card order:** Product basics → Photos → **Pricing & choices** → **Order
  rules** → **Where it appears** (Visibility + Categories — publishing concerns
  come after what the product *is*; they used to sit above the name).
  `CategoryPicker` gained an `embedded` prop so it nests in the publishing card
  without double chrome.
- **"Order rules" card** (added when staging's min-order rules merged in):
  minimum order quantity (`86ey9unyx`) + the per-product minimum notice
  (`minNoticeDays`) live together, because both constrain *how a buyer may
  order* — neither is about price/choices (what it costs) nor publishing
  (where it shows). Staging had min-notice floating above the product name
  (that slot is now the summary strip) and min-quantity tacked onto the
  pricing card.
- Photos moved to a shared `ProductImagesField`
  (`src/components/forms/product-images-field.tsx`), used by both the form and
  the wizard. Both it and the variant editor render through staging's shared
  `AppImage` primitive (`86eybq1uk`).

### `rebuildRows` and the empty-axis moment

Tapping "Buyer picks a choice" (or adding a second axis) seeds an axis with
NO values, and `cartesian` over zero values is `[]`. `rebuildRows` therefore
returns `prev` untouched whenever the axes yield zero combinations — an
incomplete axis is a transient authoring state, not an instruction to discard
the price/fulfilment the seller already typed. That keeps the documented
`seed` branch reachable: the single implicit row survives the switch and seeds
every generated row when the first value lands (PR #108 review, finding 1 —
without this, a made-to-order seller's RM12 came back blank and
stock-tracked). While the grid is incomplete, per-choice UI and per-row
validation both gate on `gridReady` (`cartesian(options).length > 0`) so the
surviving row never shows as a blank-labelled choice and errors can't target
invisible inputs. Covered by `rebuild-rows.test.ts`.

### The restructured `VariantEditor`

`src/components/forms/variant-editor.tsx` — same state shape
(`VariantEditorState`), same submit contract (`buildSubmitVariants`), new
surface:

- **Q1 — "Does the buyer pick anything?"** segmented control (*Just one item*
  / *Buyer picks a choice*). Switching to choices seeds an empty axis;
  switching back to one item collapses to a single row (confirm dialog when
  typed prices/stock would be discarded, first row's values carried over).
- **Choices mode:** preset chips + axis name + value chips for the FIRST axis,
  then a "choices & prices" list — one row per choice with price and (only
  when tracking) a stock stepper. "Fill all prices/stock" bulk inputs appear
  above 3 rows. The old desktop `<table>` was **removed** — one responsive
  rows list serves both breakpoints.
- **Q2 — "How do you prepare orders?"** product-level answer cards
  (*Made to order* / *From stock*) that bulk-apply to every row. Stock inputs
  render only for tracking rows — made-to-order products show no stock UI at
  all. A **"Vary per choice"** link reveals per-row Track-stock/Made-to-order
  toggles (auto-open when a legacy product is already mixed; "Use one setting
  for all choices" collapses to the majority).
- **Advanced disclosure** (dashed card, collapsed by default, teaser line):
  product-level mockup-approval checkbox (indeterminate when mixed), the
  custom / made-to-order line, "Add a second choice" (axis 2, Size × Flavour),
  and per-choice details (photo, SKU, on-sale, per-choice approval). It
  auto-opens when the product already uses any of these, or when a submit
  issue points inside it (so `focusFirstInvalidField` can land on the input).
- `rebuildRows` now seeds NEW combinations' fulfilment/approval flags from the
  first existing row — adding "XL" to a made-to-order product no longer
  silently creates a stock-tracked row.

## Edit-page header: honest status + preview

- **Status chip** (`src/lib/product-status.ts`, unit-tested): the old chip was
  `active ? "Live" : "Archived"`, so hidden and sold-out products kept reading
  "Live". Now: **Archived > Hidden > Sold out > Live** — archived beats
  everything, hidden (including `hiddenByCategory` suppression) beats stock
  state, and "Sold out" derives from the server's `inStock` (any active
  variant sellable). Each label carries a one-line `title` explanation. The
  chip reflects the SAVED product — the summary strip reflects the draft.
- **Preview CTA** — "Preview" (desktop header) / eye icon (mobile header)
  opens the REAL storefront `ProductDetailSheet` in-page (the same bottom
  sheet buyers get) — no new tab — fed the form's **live draft** via
  `draftPreviewOverlay` (`src/lib/product-preview.ts`, unit-tested): unsaved
  edits preview exactly as buyers would see them after saving. The overlay
  mirrors the server's `productWithVariants` derivations (price range, quote
  pricing, in-stock); identity fields come from the saved row. Option pills
  and steppers work; "Add to cart" shows a toast explaining it's a preview.
  Built once per open — a per-render object identity would reset the sheet's
  selection state.

## Behaviour deltas (deliberate)

- Made-to-order rows show **no stock input** (previously "Stock (optional)").
  The value is preserved in state/DB, just not asked for — stock is
  meaningless when a product never sells out.
- The desktop dense variant table is gone; the responsive rows list +
  bulk-fill covers the 50-variant power case.
- SKU moved under Advanced on the edit form; in the wizard it's behind the
  price-step "+ Add your own item codes (SKU)" link.
- The wizard is the only prominent create path; the full form remains one
  quiet link away (`?form=full`).

## Files

- `src/components/forms/product-wizard.tsx` (+ `.test.ts`) — the wizard
- `src/components/forms/product-form.tsx` — restructured full form
- `src/components/forms/variant-editor.tsx` (+ `.test.tsx`) — question-first editor
- `src/components/forms/product-images-field.tsx` — shared photo grid
- `src/components/forms/category-picker.tsx` — `embedded` variant
- `src/lib/product-summary.ts` (+ `.test.ts`) — summary strip derivation
- `src/routes/app.products.new.tsx` — wizard route + `?form=full`

## Follow-ups (named, not hidden)

- sessionStorage draft persistence for the wizard (refresh mid-wizard loses
  the draft today).
- A step-2 third card ("Fully custom — buyer describes what they want") if
  custom-cake sellers turn out to need the custom line on day one.
