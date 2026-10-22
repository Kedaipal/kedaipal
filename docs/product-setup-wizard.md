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
| 3 · Price | One price per choice (all combinations when two axes) + "Same price for all". "+ Photos, item codes (SKU) & more per choice" reveals per-row photo · SKU · on/off · design-approval — the full form's per-choice details, behind one link. **Made to order:** its OWN line — optional price + "What should the buyer tell you?" | per-row `price` (+ extras), or `customLine` |
| 4 · Preparation | "How do you prepare orders?" — *Made fresh* / *From stock* (stock steppers on tracking rows). "Vary per choice" reveals per-row Track-stock/Made-fresh toggles (auto-open when a restored draft is mixed). **Skipped entirely for made-to-order** | per-row `blockWhenOutOfStock` + `onHand` |
| 5 · Review | Buyer-eye preview card + summary rows with per-row Edit + **optional publish settings** (Visible/Hidden toggle; category picker **only when the store has categories**) + the **"More options"** disclosure | submit (+ `hidden`, `categoryIds`, `requiresProof`, custom line) |

### The "Made to order" product type (2026-08-02, ClickUp `86eyfq04j`)

Step 2's answer is a three-way `ProductShape` (`single` | `choices` |
`made_to_order`), not a `hasChoices` boolean. A bespoke seller — the ICP's cake
decorator, Bearcamp's tent wash — previously had **no way through the wizard**:
every path demanded a price, and the only bespoke affordance was a checkbox
under the full form's Advanced disclosure.

**The type IS a custom line.** A made-to-order product carries **no cartesian
matrix at all** — `{options: [], rows: [], customLine}` — so it saves as ONE
`isCustom` variant. That is the whole design: modelling it this way means it
*inherits* everything the storefront already does for bespoke work instead of
needing a parallel path for each piece —

| Behaviour | Comes free from `isCustom` |
|---|---|
| Buyer states their request + attaches a reference photo | `CustomOrderCard` |
| Card shows **Choose** and routes to the product page | `ProductCard`'s `hasCustom` — a one-tap quick-add can't bypass the brief |
| Cart line locked to qty 1, re-adding updates the note | `addVariantToCart`'s `updatingCustom` — no accumulating a one-off |
| Order gated on mockup approval, price settled on the quote | `requiresProof` → `mockupStatus` |
| Exempt from minimum-order rules | `convex/lib/minOrderRules.ts` |

The first cut instead built a second buyer path (`madeToOrderOnly` +
`MadeToOrderRequest` in the buy box) on top of a plain implicit variant. It
worked on the product page and was bypassed everywhere else — PR #160 review
caught the grid/shelf quick-add going straight to cart with an empty brief, and
the quantity accumulating on a one-off item. Both vanish with the model above,
which is why the parallel path is gone.

- **Server:** `validateVariantSet` allows an empty matrix for exactly this
  shape (`customOnly` — no axes, one custom line), and skips the
  combination-coverage loop with it. Everything else keeps the old rules; an
  empty variant set, and axes with no matrix, still throw. It only ever
  **loosens**, so no stored product becomes invalid.
- **Steps:** `wizardSteps(shape)` → `[1, 2, 3, 5]`. Preparation is dropped —
  "how do you prepare orders?" has exactly one answer for a thing that is by
  definition made to order. Step ids stay stable so every `step === n` branch is
  untouched; only the walked ORDER changes, and the progress dots / "Step N of
  M" count off the walked sequence.
- **Step 3 edits the line itself:** an optional price (blank = "Price on
  quote"; a typed amount is just the price — one variant means `priceFrom ===
  priceTo`, so no "from" prefix) and **"What should the buyer tell you?"**,
  which becomes the placeholder in the buyer's request box. A bad amount raises
  at step 3, where the input is — not on Review.
- **Derived, never stored twice — through ONE function.** `effectiveShape(state)`
  is the single read: axes present ⇒ `choices`; else an explicit answer or
  `isMadeToOrderOnly(editor)` ⇒ `made_to_order`; else `state.shape`. The same
  "the editor answers, not the flag" posture `86eyex5vk` established for axes.
  Validation, the step sequence, which card is lit and the review rows all read
  it, so the screen can't contradict the payload. Splitting that read is what
  PR #160's review caught: the step-2 card keyed on `state.shape` while the
  explainer keyed on a derived flag, so a draft could render the explainer with
  **no card selected** and a Review claiming "Type: Made to order" beside
  "Preparing: Made fresh".
- **The custom-line option isn't offered on this type** in either editor — the
  product already is that line, so adding one to itself is the same offer twice.
  Nothing is stranded behind the hidden control, because the type is only
  reachable through `switchToMadeToOrder`, which *moves* the seller's line onto
  the product rather than leaving a second one in state. Leaving the type
  (`switchToSingle` / `switchToChoices`) restores a real matrix row and retires
  the line, carrying its price across.
- **The full form's whole Advanced disclosure is hidden for this type**, not
  just the custom-line row. Every control inside it is dead here: mockup
  approval is constitutive (and its `bulkFillFlag` maps over `rows: []`, so the
  checkbox couldn't toggle even if you clicked it — it rendered *unchecked* on a
  product that always requires approval), SKU binds to `rows[0]`, the custom
  line IS the product, and the second axis is already gated on having choices. A
  disclosure whose every control is inert reads as a broken setting, so the card
  goes and the one fact worth knowing is **stated inline** in the type's own
  setup: *"🧑‍🍳 Made to order · ✅ the buyer approves your mockup before you start
  — always on for this type."* Leaving the type brings Advanced straight back.
- **The purchase bar always has a CTA — `PurchaseActions` decides which.**
  `resolveVariant` deliberately excludes `isCustom`, so a made-to-order product
  resolves no standard variant; the stepper and "Add to cart" would render
  permanently disabled reading "Unavailable". Both editors' views feed their bar
  a single `PurchaseActions`, which renders the standard pair when
  `sellsStandardLine` and **"Request custom order"** otherwise. Deciding once, in
  one place, is the point: the two views can't disagree about a product's CTA,
  and on mobile — where that bar is `fixed` — it can never be empty chrome with
  the real CTA scrolled out of thumb reach (PR #160 review).
- **The card doesn't restate the page.** When the custom line *is* the product,
  `CustomOrderCard` drops its own thumbnail / label / price row — the page's h1,
  gallery and price label already say all three, and repeating them as
  "Custom · Price on quote" reads as a second item. It leads with the mockup
  gate instead ("You'll approve a mockup before your order is made"), which is
  the one thing the buyer doesn't know yet, and its CTA moves to the bar. Beside
  a real catalog the card is unchanged: full identity row, quiet outline button.

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
- **Order rules** — minimum order quantity + minimum notice days, plus (since
  `z8r3fdff97`) **prep time** in minutes (the same `PREP_PRESETS` as the form)
  and the **pickup note**, mirroring the edit form's "Order rules" card. Blank =
  no rule (mapped to `undefined`, never 0, so the create mutation simply omits
  them). Prep and note are hidden on the booking route; prep parses through the
  shared `parsePrepMinutesText` (digits only), the same rule as the form and
  the spreadsheet import.
- **"Open in the full editor"** — same draft, other skin: `wizardHandoff`
  passes the editor substrate as-is (in-memory via the route's `wizardDraft`;
  a refresh falls back to a blank full form).

**Escape hatch:** "Skip — use the full form" on step 1 →
`/app/products/new?form=full` renders the same restructured `ProductForm` the
edit page uses (`validateSearch` on the route), seeded with the whole wizard
draft; "← Prefer the guided setup? Switch back" returns losslessly. The
import flow is untouched — bulk sellers never see the wizard.

**Deep link to a step-0 card** (`z8r3fdhkr7`): `/app/products/new?card=event`
(any of `food` · `physical` · `service` · `booking` · `event`) opens the
wizard with that card already selected — how the v2026.09.7 "Host an event"
note lands the seller on Event instead of a page ringing their own store
type. The card is applied by `withKindCard`, the SAME pure transition a tap
runs, so a link can't open a state a tap wouldn't; `openingWizard` derives
the opening state at mount (a lazy initialiser, never an effect — the first
paint is already right). A link to Event on a plan without `events` keeps
the store-type default and shows the tap's Pro refusal from the first paint.
`form=full` drops `card` in `validateSearch`: the full form has no step 0,
and a param that silently does nothing is worse than none. Unknown values
are dropped, never honoured. A restored draft (switch back from the full
form) outranks the link — that draft is the seller's own answer.

**On a phone the answer must be ON screen, not just selected** (#297
review, measured at 360×780 and 375×667). Step 0's fifth card sits under
the sticky Continue and the bottom nav, so an arrival that only set the
answer looked like nothing happened. Three things close it:

- **The Event refusal sits under the Event card.** It's the house
  `ProFeatureTease` strip: the reason plus an **Upgrade** button, never a
  dead end. It has its own issue field (`kind:events-locked`), so step 0's
  "Pick one to continue." keeps its slot below the list. Below the list it
  was hidden, on the tap path as much as the link.
- **A link's arrival scrolls the answer into view once.** That's the event
  hint on the event route (it sits directly under the Event card), the
  refusal on a locked plan, else the chosen card. It uses
  `scrollIntoView({ block: "nearest" })` with a phone-only
  `scroll-mb-56 lg:scroll-mb-0`, so it scrolls only when the sticky bars
  cover the target, and a desktop page that already shows it never jumps.
  The first paint is still derived. The effect moves only the scroll
  position.
- **A link that changes while the wizard is open** (What's new reopened
  mid-draft) is applied once, as a tap (`pickCard`): back to step 0, the
  lock refusing with its reason, a booking switch asking before it drops
  typed prices. React's "store the previous prop" pattern does this during
  render, **never by remounting**, which would throw the draft away.

Other doors use it: "Create a booking listing" (Settings → Bookings, the
orders calendar) and the weekend-rate spotlight's "+ New product" open on
**Booking** (`createCard` on its `PRODUCT_SPOTLIGHT` row) instead of telling
the seller to find the Booking kind. The card list lives in
`src/lib/kind-card.ts`, because it is the `?card=` contract as well as the
wizard's. `releases.test.ts` fails a release note whose `?card=` isn't a
real card, since the route would silently drop the typo.

Pure, unit-tested helpers (`product-wizard.test.ts`): `wizardStepIssues`,
`buildWizardSubmitValues`, `wizardHandoff`, `formDraftToWizardState`,
`wizardInitialStep`, `wizardPriceLabel`, `withKindCard`, `openingWizard`,
`isKindCard`.

## Edit = the question-first full form

A stepper is wrong for editing (sellers jump straight to "change Medium's
price"), so `ProductForm` keeps everything on one page — but since
[`z8r3fdv1z2`](https://app.clickup.com/t/z8r3fdv1z2) only the CORE is open.
Every optional capability is a collapsed **question row** whose line carries
its current **answer**.

**Why.** Each capability shipped after the last cleanup (promotion + flash
extras, event, buyer questions, prep time, pickup note, weekend rate, instant
book, deposit) landed as one more full-weight card or field, and custom orders
+ mockup approval sat in a dashed "Advanced" box under the price grid. The
switch that turns a capability on was the third thing inside a card named
after the feature, so a seller who never read a release note never learned
the product *could* be a flash sale, an event, or take custom requests. A
question ("Is it on sale right now?") names the capability in the seller's
words; the answer ("No" / "Yes · 20% off · ends Fri 6:00 PM") says whether it
is on without opening anything. **The answer line is the design** — a question
alone is an FAQ accordion; with its answer it is state.

- **Summary strip first, in words** — "Chocolate fudge brownies — 3 choices by
  Size · Made to order · RM 12–28", live-derived by `describeProduct`
  (`src/lib/product-summary.ts`, unit-tested). Create/skip mode keeps the old
  readiness checklist instead (a create-time concept).
- **Open core cards:** Product basics → Photos → **Pricing & choices** (a
  booking: **Pricing & capacity** — package length, open-days counting, price,
  capacity: what DEFINES the stay).
- **The per-choice list folds on edit** ([`z8r3fdwnyk`](https://app.clickup.com/t/z8r3fdwnyk),
  Zaki 22 Oct). Pricing & choices stays an open card, but its **"The choices &
  prices"** list — one ~120px card per choice — sits behind a one-line header
  whose answer is the list's state: "12 choices · RM 12–28 · 2 off sale", amber
  "· 1 needs a price" when a line a buyer can buy has none (`choicesAnswer`,
  same file as the row answers; off lines count only as "off", because the
  save never prices them). A product with 20 sizes used to push every question
  group thousands of pixels down. What stays visible: the product type and the
  "They choose by" axis with its value chips — short, and they say what the
  product IS. Same disclosure rules as a question row: **closed every visit**,
  the rows stay mounted while hidden, and it **opens itself** when a refused
  save points at a choice's price/stock (issue effect + focus-error's
  `REVEAL_EVENT`) and when the seller adds a value (its new row has no price —
  it must never land behind a closed list). An open list of more than three
  ends in **"Hide the N choices"**, which closes it from where the seller
  finished and brings the header back into view (`scroll-mt-24`, clear of the
  sticky header). **Advanced folds too, on edit:** it used to force itself
  open whenever it held config, and one parcel weight was enough, so nearly
  every real product opened it, and its **Per-choice details** repeated every
  variant again (the `/test-code` pass measured a 56-variant product with
  "Selling options" still 8,500px down). On edit it starts **closed**, and its
  line says what is inside rather than what could be: "Second choice: Colour ·
  3 SKUs · 56 parcel weights · 1 off sale" (`advancedAnswer`; the generic menu
  shows only when nothing is set), so the config is stated, never hidden.
  Opened, its per-choice details are the **same disclosure** as the price
  list (`ChoiceListDisclosure`, one control for both), closed, with "56
  choices · 3 SKUs · 56 parcel weights". A refused parcel weight opens
  Advanced and its details. Both lists say "off sale", not "off", which
  reads like a discount. **Edit only** (`collapseChoices`
  on `VariantEditor`): on create, and in the wizard, the seller is authoring
  the grid and has to see every row to price it.
- **Question groups, by meaning** (`src/components/ui/question-row.tsx`):

  | Group | Physical / food / service / event | Booking |
  | --- | --- | --- |
  | **Selling options** — what it is or costs | Is it on sale right now? · Is it a fixed-date event? · Do you take custom requests on it? · Does the buyer approve a mockup first? | Do weekend nights cost more? · Is it on sale right now? · Confirm bookings instantly? · Take a refundable security deposit? |
  | **At checkout** — how it is ordered | Do buyers answer any questions? · Any rules on how it's ordered? (min qty · notice · prep) · Anything to know when collecting? | How much notice do you need? |
  | **Publishing** | Where does it show? (visibility + categories) | same |

  A **made-to-order** product is never asked the custom-orders or mockup
  question: it already IS both, and its price card says so inline.
- **Answers** are pure derivers in `src/components/forms/product-answers.ts`
  (one per row, unit-tested), reading the same as-typed drafts the fields edit.
  Tone: `off` muted, `set` mint, `warn` amber (in use but needs a look — an
  ended sale, a passed event date, prep made inert by notice, a minimum the
  stock can't reach). After a refused save a row with a problem inside reads
  "Needs a fix before you can save" in red (`rowAnswer` in the form).
  Answers wrap to **two lines** rather than truncating, because a row's
  warning comes last ("· prep has no effect while notice is on") — exactly
  where a one-line cut would hide it on a phone.
- **An answer never claims more than the save or the storefront will do**
  (found in the `/test-code` pass, 16 Oct): a sale price at or above the normal
  price is not counted as a discount ("1 sale price needs fixing") — and,
  like the save (`buildSubmitVariants`, `if (row.active)`), only lines that
  are ON SALE are counted or policed, so a stale price on an off-sale line
  neither turns the row red nor reads as a discount (PR #384 review); "Where does
  it show?" says **Off your storefront** for a past event or a product whose
  every category is hidden, whatever the visibility switch says; switching
  custom orders off and on again restores the seller's line (name, price,
  prompt, photo) instead of a blank one, the way the event and promotion rows
  keep their drafts.
- **Rules the row owns:** collapsed by default **on every visit, even when on**
  (Zaki, 16 Oct — the answer already says what is on, and a page that changes
  shape per product is harder to learn); rows open independently; the switch
  lives INSIDE the panel, never on the header (one tap must not end a live
  sale whose terms you can't see); a Pro-gated row wears the Pro pill on its
  header (a `badge` slot, so the `ui/` primitive imports no app component); the panel stays **mounted while closed** (`hidden`) so a half-typed
  draft survives a collapse.
- **"Take me to the error" opens the row.** `focusFirstInvalidField` checks
  whether the first invalid field sits inside a closed `[data-disclosure-panel]`;
  if so it dispatches `REVEAL_EVENT` on it and reports "not yet", and the
  submit path's existing timer retry focuses the field once it renders. One
  generic hook, so any future row inherits it.
- **Deep links** (`?spot=promo|prep_time|weekend_rate`) scroll to the ROW,
  ring it and open it (`defaultOpen`), so the seller lands on the field.
- **Custom orders + mockup approval moved out of Advanced** in the full form:
  `VariantEditor` takes `capabilitiesOutside`, which drops both (and the
  per-choice mockup checkbox) from Advanced; the form renders them as rows via
  the extracted `CustomLineFields` and `MockupApprovalFields`. Mockup approval
  is **tri-state** (all / none / some, `aria-checked="mixed"`) with the
  per-choice list it summarises right under it, so the flag has one home. The
  wizard leaves `capabilitiesOutside` off and keeps both in Advanced — same
  `VariantEditorState`, two skins, the parity invariant above.
- **Pickup note is its own row**, not folded into the order rules (Zaki, 16
  Oct): it is an instruction, not a limit, and its disabled-with-reason state
  ("Needs self-collect on · Settings → Fulfilment") needs its own line.
- The order-rules contents are unchanged from `z8r3fdff97`: minimum quantity,
  minimum notice, **prep time** under notice (an amber note when a notice of a
  day or more makes it inert); on an event the two timing rules are replaced by
  one sentence. See [`fulfilment-date.md`](./fulfilment-date.md) and
  [`fulfilment.md`](./fulfilment.md).
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
  **Not on the edit page** (`collapseChoices`, z8r3fdwnyk): there it starts
  closed and its line states what it holds instead — see the edit-form
  section above.
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
- `src/routes/app.products.new.tsx` (+ `.test.ts`) — wizard route, `?form=full`, `?card=`
- `src/components/forms/product-wizard-card-link.test.tsx` — the `?card=` arrival, rendered
- `src/components/ui/question-row.tsx` (+ `.test.tsx`) — `QuestionGroup` / `QuestionRow`, the collapsed question + answer primitive (z8r3fdv1z2)
- `src/components/forms/product-answers.ts` (+ `.test.ts`) — every row's answer line
- `src/components/forms/product-form-questions.test.tsx` — which rows each kind gets, tri-state mockup, custom line as a row, refused save opens its row
- `src/components/forms/focus-error.ts` — opens a collapsed row holding the first error

## Follow-ups (named, not hidden)

- sessionStorage draft persistence for the wizard (refresh mid-wizard loses
  the draft today).
- A step-2 third card ("Fully custom — buyer describes what they want") if
  custom-cake sellers turn out to need the custom line on day one.
- The wizard's Review "More options" and Settings' two home-grown expandable
  rows (`message-templates-form`, `order-flows-card`) could converge on
  `QuestionRow` — separate tickets, not part of `z8r3fdv1z2`.
- Older What's-new entries in `src/content/releases.ts` still say "the
  Promotion card"; they are dated release records and were left as written.
  The next release's note should describe the question rows.
