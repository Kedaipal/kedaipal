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

## Create = the wizard (`/app/products/new`)

`src/components/forms/product-wizard.tsx`, mounted by
`src/routes/app.products.new.tsx`. One question per screen, progress dots,
back button; state lives in one `WizardState` and survives jumping between
steps.

| Step | Question | Derives |
| --- | --- | --- |
| 1 · Name it | "What are you selling?" — name + photos, description behind a link | `name`, `imageStorageIds`, `description` |
| 2 · Type | "What kind of product is it?" — *Just one item* / *Buyer picks a choice* (preset chips: Size/Flavour/Weight/Pack, values typed as chips) / *Made to order*. "+ They also choose by something else" reveals the **second axis** (Size × Flavour) — zero pixels unless used | `editor.options`, `shape` |
| 3 · Price | One price per choice (all combinations when two axes) + "Same price for all". "+ Photos, item codes (SKU) & more per choice" reveals per-row photo · SKU · on/off · design-approval — the full form's per-choice details, behind one link. **Made to order:** one optional "starting price" | per-row `price` (+ extras) |
| 4 · Preparation | "How do you prepare orders?" — *Made fresh* / *From stock* (stock steppers on tracking rows). "Vary per choice" reveals per-row Track-stock/Made-fresh toggles (auto-open when a restored draft is mixed). **Skipped entirely for made-to-order** | per-row `blockWhenOutOfStock` + `onHand` |
| 5 · Review | Buyer-eye preview card + summary rows with per-row Edit + **optional publish settings** (Visible/Hidden toggle; category picker **only when the store has categories**) + the **"More options"** disclosure | submit (+ `hidden`, `categoryIds`, `requiresProof`, custom line) |

### The "Made to order" product type (2026-08-02, ClickUp `86eyfq04j`)

Step 2's answer is a three-way `ProductShape` (`single` | `choices` |
`made_to_order`), not a `hasChoices` boolean. A bespoke seller — the ICP's
cake decorator — previously had **no way through the wizard**: every path
demanded a price, and the only bespoke affordance was a checkbox under the
full form's Advanced disclosure.

**No schema or server change.** A made-to-order product sells through the shape
the catalog has always supported and [`custom-option.md`](./custom-option.md)
already prescribed: ONE implicit variant with `requiresProof: true`,
`blockWhenOutOfStock: false`, price 0 — which `productWithVariants` already
reads as a quote variant (`hasQuotePricing`) and the storefront already renders
as **"Price on quote"**. This ticket only built the route to it.

- **Steps:** `wizardSteps(shape)` → `[1, 2, 3, 5]`. Preparation is dropped —
  "how do you prepare orders?" has exactly one answer for a thing that is by
  definition made to order, and offering "From stock" there would silently undo
  the type. Step ids stay stable so every `step === n` branch is untouched;
  only the walked ORDER changes, and the progress dots / "Step N of M" count
  off the walked sequence.
- **Price is optional.** Blank means "Price on quote"; a typed amount shows as
  a "from" floor. `reconcileForSubmit` resolves blank → `"0"` on the ONE submit
  path both editors share, so it can't be accepted in the wizard and rejected
  in the full form.
- **Derived, never stored twice.** `isMadeToOrderOnly(editor)` reads the rows;
  the render-time `madeToOrder` is `!showAxes && (shape === "made_to_order" ||
  isMadeToOrderOnly(...))` — the same "the editor answers, not the flag"
  posture `86eyex5vk` established for `showAxes`. Deliberately **not** keyed on
  price, so typing a "from" figure can't flip the mode mid-edit.
- **Nothing is asked twice.** Mockup approval and the custom line are dropped
  from More options / Advanced for this type: approval is what the type *is*
  (a checkbox that turns the product into a free item is a trap), and a bespoke
  line on a bespoke product is the same offer twice. Both are removed from the
  tree, not CSS-hidden — a `hidden` class still leaves them for screen readers.
- **Full editor parity.** `VariantEditor`'s Q1 is a three-segment control, and
  the summary strip reads "Made to order · Price on quote" (or "· from RM 120")
  instead of "One item · Made fresh · No price yet", which framed a deliberate
  shape as unfinished setup.

**Renamed in passing:** the *prepare* answer "Made to order" → **"Made fresh"**
(wizard step 4, `PrepareQuestion`, `FulfilmentToggle`, `describeProduct`). It
only ever meant "don't track stock", and leaving it would have put two controls
with the same label and different meanings on one screen — exactly the
confusion `86eyfq04j` was filed about.

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

### The grid/axes invariant and `reconcileForSubmit` (2026-07-31, ClickUp `86eyex5vk`)

Whatever the client submits, `options` and `variants` must describe the **same**
product — `rows.length === cartesian(options).length`, and the rows must cover
exactly those combinations. The server enforces it in `validateVariantSet`; when
it's violated the seller got `Expected 1 variants for these options, got 2` with
**no field to fix** — a dead end that made the product unsavable.

Every in-editor path upholds the invariant through `rebuildRows`. Two things
broke it:

1. **`hasChoices` was a second source of truth.** The wizard's step-2 answer flag
   decided the payload's axes (`options: state.hasChoices ? … : []`) while
   `variants` came from `state.editor.rows` unconditionally, and
   `wizardStepIssues` step 2 skipped option validation **entirely** when the flag
   was `false`. Once the flag and the editor disagreed, the wizard shipped
   `options: []` beside a multi-row grid and skipped the very check that would
   have caught it. Both now read the editor: the flag is a UI affordance only.
2. **The client and server disagreed about blank values** — a latent gap, *not*
   a demonstrated cause of the reported bug. `normalizeOptions` trims values and
   silently **drops** blank ones; the client's `collectOptionIssues` never
   trimmed, so a whitespace-only value would count as a combination on the
   client that the server then discards, shrinking `expected` behind the grid's
   back. No reachable path feeds it one today (`addValue` trims and rejects
   blanks in both editors, the presets are clean, and stored options come back
   server-normalized), so `sanitizeOptions` is defence-in-depth that keeps the
   two sides provably in step — worth having, but it did not produce the
   `Expected 1 variants…` report. Cause 1 is the one that did.

`reconcileForSubmit(options, rows)` is the backstop, called at **both** submit
sites (the full form and `buildWizardSubmitValues`). It sanitizes the axes, then
rebuilds the rows unless they already cover the cartesian exactly — coverage, not
just count, since two rows carrying a stale or duplicated tuple pass a length
check and still fail the server's "Missing variant for combination". State the
editor never derived (a stored product whose options and variants disagree, a
wizard handoff, a commit against a stale render closure) is repaired instead of
rejected. Rows are left untouched while an axis is still incomplete — that's the
transient moment above, and the axis's own "add at least one value" is the
actionable message.

A rebuild can mint a combination the seller never priced. That surfaces as the
normal inline row issue (`buildSubmitVariants`), and the full form writes the
reconciled grid back into editor state before validating so the message points at
an input the seller can actually see. The result: a mismatch costs a re-typed
price, never an unsavable product. The server's two throws now name the axes and
the combinations received (truncated past six — the full list at the 50-variant
cap is a ~1KB banner).

**Validation and render must read the same source.** Moving validation onto the
editor without moving the render created a new dead end (caught in PR #156
review): step 2 raised an `axisName`/`axisValues` issue while the axis block was
still gated on `state.hasChoices`, so the message had no mounted input, and since
the wizard has no generic issue banner, Continue silently did nothing. One
derived `showAxes = state.hasChoices === true || options.length > 0` now feeds
the render gate, both `AnswerCard` selections, and the step 3/5 wording, and the
"pick one to continue" check only fires when the editor genuinely has no axes.
The rule to keep: **any state validation can reject must be reachable and
visible on screen.** Covered by `variant-grid-reconcile.test.ts`,
`product-wizard-axes-render.test.tsx` and `convex/products.test.ts`.

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
