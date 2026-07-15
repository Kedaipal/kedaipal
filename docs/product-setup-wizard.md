# Product setup wizard & the question-first product form

ClickUp: [`86ey9udvz`](https://app.clickup.com/t/86ey9udvz) · Approved design
mockup: <https://claude.ai/code/artifact/8a88b292-8212-47a5-bc92-6327aefb67a0>

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
| 2 · Choices | "Does the buyer pick anything?" — *Just one item* / *Buyer picks a choice* (preset chips: Size/Flavour/Weight/Pack, values typed as chips, **one axis max**) | `options` |
| 3 · Price | One price field, or one per choice + "Same price for all" | per-variant `price` |
| 4 · Preparing | "How do you prepare orders?" — *Made to order* (no stock inputs) / *From stock* (stock steppers) | `blockWhenOutOfStock` + `onHand` |
| 5 · Review | Buyer-eye preview card + summary rows with per-row Edit + "You can also add later…" strip | submit |

Validation: the branching questions (2/4) gate Continue structurally
(disabled + one-line reason); text inputs validate on Continue with inline
`aria-invalid` + message (never a generic banner). Publish re-validates every
step before submitting (review-step edits jump around).

**Deliberately NOT in the wizard:** SKU, mockup approval, the custom line, a
second option axis, per-variant images/deactivate, visibility, categories.
The review step names them ("You can also add later: … Edit product →
Advanced") so nothing becomes hidden behaviour, per the discoverability rule.

**Escape hatch:** "Skip — use the full form" on step 1 →
`/app/products/new?form=full` renders the same restructured `ProductForm` the
edit page uses (`validateSearch` on the route). The import flow is untouched —
bulk sellers never see the wizard.

Pure, unit-tested helpers (`product-wizard.test.ts`): `wizardStepIssues`,
`buildWizardSubmitValues`, `wizardPriceLabel`.

## Edit = the question-first full form

A stepper is wrong for editing (sellers jump straight to "change Medium's
price"), so `ProductForm` keeps all sections visible but now mirrors the
wizard's mental model:

- **Summary strip first, in words** — "Chocolate fudge brownies — 3 choices by
  Size · Made to order · RM 12–28", live-derived by `describeProduct`
  (`src/lib/product-summary.ts`, unit-tested). Create/skip mode keeps the old
  readiness checklist instead (a create-time concept).
- **Card order:** Product basics → Photos → **Pricing & choices** → **Where it
  appears** (Visibility + Categories — publishing concerns come after what the
  product *is*; they used to sit above the name). `CategoryPicker` gained an
  `embedded` prop so it nests in the publishing card without double chrome.
- Photos moved to a shared `ProductImagesField`
  (`src/components/forms/product-images-field.tsx`), used by both the form and
  the wizard.

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

## Behaviour deltas (deliberate)

- Made-to-order rows show **no stock input** (previously "Stock (optional)").
  The value is preserved in state/DB, just not asked for — stock is
  meaningless when a product never sells out.
- The desktop dense variant table is gone; the responsive rows list +
  bulk-fill covers the 50-variant power case.
- SKU moved under Advanced everywhere.
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
