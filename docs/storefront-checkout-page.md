# Storefront — checkout page (buyer redesign PR1)

**Status: implemented.** The storefront checkout is a **real route** —
`/{slug}/checkout` — replacing the old full-height bottom-sheet
(`checkout-sheet.tsx`, deleted). First slice of the storefront buyer UI/UX
redesign (ClickUp `86eybrhrt`; direction locked 20 Jul 2026: Market Page
architecture + Order Ticket receipt summary). Buyer-facing, all-tier — the
buyer flow never varies by seller plan. Source: Zaki. See
[`app-redesign.md`](./app-redesign.md) for the seller-side sibling pass.

## Why a page, not a sheet

The sheet had no desktop variant: it pinned full-width to the viewport bottom,
stretched inputs to ~1,500px, and reviewed items in a strip the buyer couldn't
see past. A route fixes the architecture, not just the paint:

- **Desktop** gets a two-column layout (`lg:`): numbered form sections left,
  **sticky receipt summary** right with the CTA under the money it commits to.
- **Mobile** stays single-column: summary first (this page IS the review),
  then the sections, with a **fixed bottom bar** (live total + CTA) always in
  thumb reach — same `fixed inset-x-0 bottom-0` as `CartBar` and the product
  page's purchase bar, so the powered-by footer floats above it exactly like
  every other storefront page (design-system rule #4). An earlier pass tried
  `sticky` here on the theory that a form needs an in-flow bar; tested on a
  phone it just welded the badge to the bar and made checkout the odd page
  out. The route reserves the bar's **measured** height
  (`--storefront-bar-h`), so there's no dead space under the badge.
- Browser **back** returns to the store; **refresh** keeps the buyer's place
  (the cart is localStorage, keyed per retailer); an abandoned desktop cart
  can be returned to via URL. `noindex` — a checkout is transactional.
- Route file `src/routes/$slug_.checkout.tsx` (pathless-parent underscore,
  same trick as the category page — `$slug.tsx` is a leaf with no outlet).
  Slug renames 301 onto `/{new}/checkout`.

## What the redesign fixes (the audit items)

1. **Quantities are editable at checkout** — every non-custom line gets a
   stepper (− qty +). Minus at qty 1 becomes **remove** (trash icon).
   Steppers write through `cart.updateQuantity`; qty 0 removes the line.
   **Stock caps**: the page reads the public `products.list` and caps the
   `+` at live on-hand stock for hard-block variants, with a visible
   "Only N in stock" reason. A cart line whose product left the public list
   (hidden/archived since add) gets no cap — `orders.create` stays the judge.
   Custom lines stay qty-locked at 1 (one bespoke negotiation) with an
   explicit Remove chip instead of a stepper.
2. **The name field explains itself** — label "Your name", placeholder
   "e.g. Aisyah", helper *"Appears in your WhatsApp message so {store} knows
   who this order is for."*
3. **The form is sectioned, not a wall** — numbered decision cards:
   **1 · Who's ordering?** → **2 · How do you want to get it?** (or
   "Delivery address" / "Pickup point" when only one method is offered) →
   **3 · When…?** (kind-aware title: delivered / collect / meet / requested
   date) → an unnumbered "Anything else?" note card.
4. **Date quick-picks** — the first three selectable days render as one-tap
   chips ("Today" / "Tomorrow" / "Wed, 5 Aug"), honouring the notice window
   (a 2-day-notice store never shows "Today"). The native `<input
   type="date">` stays below as the source of truth (the lean Date Picker
   decision). Pure helper: `src/lib/checkout-dates.ts`.
5. **The wa.me handoff is announced** — under the CTA: *"Opens WhatsApp to
   confirm with {store} — nothing is paid yet."* The two-step flow itself
   (create → tracking page auto-fires wa.me, popup-blocker-safe) is
   unchanged.
6. **Min-order-rule hints are actionable** — the per-line "add N more" hint
   now sits next to the stepper that fixes it; the blocked alert stays in the
   totals block.
7. **Disabled-with-reason on the CTA** — one `blockedReason` line renders
   directly above the button in **both** places it appears (desktop summary
   footer, mobile sticky bar): store not accepting orders → checkout
   unavailable → below minimum → *"Add your delivery address to continue"* →
   calculating → can't deliver here. The quote's own `no_coords` copy is
   suppressed while the address is still empty so the buyer never gets two
   versions of the same nudge.
8. **The Google pin is the single source of truth** (ClickUp `86eye50qv`,
   folded in here so the same form isn't redesigned twice) — the delivery
   address block no longer shows a search *and* a parallel manual form. See
   [`fulfilment.md`](./fulfilment.md#the-buyers-address--the-google-pin-is-the-single-source-of-truth).

## The receipt summary (the "Order Ticket", 1:1 with the design)

`CheckoutSummary` + `CheckoutTotals` in
`src/components/storefront/checkout-summary.tsx`, rendered faithful to the
chosen design (Zaki, 30 Jul — "follow the design closely, down to the font"):

- **Masthead**: centered store name (heading face, uppercase) over a
  letterspaced mono `ORDER TICKET · DRAFT` line.
- **Receipt lines in monospace** with dotted leaders and **bare amounts**
  (`5× Quantity item ······ 250.00`) — no thumbnails, RM appears only on the
  TOTAL row, like a printed kedai receipt. Charges (pickup/delivery fees,
  FREE-threshold, pending, calculating) print as muted receipt lines in the
  same block; there is **no Subtotal row** (the items above sum in plain
  sight — per the design).
- **Tap a line to edit** (the design's own caption): the quantity stepper +
  unit price reveal inline; custom lines reveal a Remove chip. A permanent
  mono hint ("TAP AN ITEM TO EDIT") keeps it discoverable, and a line with a
  **min-quantity shortfall comes pre-expanded** — the stepper that fixes it
  is already in hand.
- Chunky dashed rules, the rotated **TOTAL** stamp, and a **perforated
  tear-off edge** (radial-gradient punch-outs) close the ticket; the desktop
  CTA sits *below* the perforation — the button is not part of the receipt.

Pure components: cart mutations via the `UseCart` handle, quote state passed
in — unit-tested without Convex/router providers
(`checkout-summary.test.tsx`).

## What moved, not changed

The form logic ported **verbatim** from the sheet into
`src/components/storefront/checkout-form.tsx` (`CheckoutPage`): the zod
schema (`checkoutFormSchema`), saved-address restore, Google address
autocomplete, pickup radio list / single-pickup card (now in
`pickup-location-options.tsx`), fulfilment-date floor bumping, min-order-rule
gates, the static delivery quote (`delivery.quote`), the live Lalamove quote
(`useLiveDeliveryQuote`) with the full blocked-reason taxonomy, and the
`orders.create` submit → `/track/{token}?send=1` navigation. **No server
change in this PR.**

`CartBar` slimmed down: it no longer hosts a checkout sheet or its plumbing —
its button (label now just "Checkout") navigates to the route. The product
detail sheet's "Go to checkout" exit (86eybhqye) navigates there too, via the
routes' `onRequestCheckout` seam.

## Page chrome — the same header and footer as everywhere else

Checkout renders the shared **`StorefrontHeader`** (cover, logo, store name,
founding badge, blurb) and the **`StorefrontFooter`** badge, so all four
storefront surfaces — store home, category, product, checkout — are the same
page shape. It shipped without a header first and read as bare and off-brand
next to the others.

The usual e-commerce instinct is the opposite: strip the chrome on checkout so
nothing tempts the buyer out of the funnel. That rule is about **payment**
pages, where an exit costs a captured card. Nothing is charged here — checkout
composes a WhatsApp message — and the only way out is back to the store, which
keeps the cart and may well come back with more in it. The seller's brand at
the moment of ordering is worth more than the leak it doesn't cause.

Two layout consequences:

- The container drops its own `px` (the header is full-bleed — its cover image
  must reach the edges) and each section below owns its padding, exactly like
  the other three routes.
- It stays `max-w-5xl` where the others are `max-w-6xl`. Capping the *content*
  narrower than the header instead centres the two on different axes, leaving
  the brand block indented 64px off the page it heads — which reads as a bug. A
  slightly narrower header is the cheaper inconsistency, and suits a task page.

**Heading rule (applies to every storefront page):** each page's `<h1>` is its
own subject — store name on the home, category name, product name, "Checkout".
`StorefrontHeader` takes `asPageHeading` (default `true`, for the home) and
renders the store name as a `<p>` on the subpages. Without it, adding the
header here would have given checkout two `<h1>`s, and every page in the store
would have shared one duplicated heading. Purely semantic — identical styling
either way.

The bottom CTA bar's stacking against the footer (fixed bar, measured
clearance) is written up once in
[`storefront-product-pages.md`](./storefront-product-pages.md#the-bottom-bar-and-the-footer).

## Post-release polish (2026-08-02, ClickUp `86eyfq04j`)

Six fixes from the 31 Jul release, all on this page:

- **`+60` prefix on the WhatsApp field.** `TextField` gained a `prefix` prop
  (bordered wrapper owns the focus ring, the input goes `variant="bare"` — the
  house composite pattern the `kedaipal.com/` slug boxes already use).
  **The badge is a promise, so the validator had to keep it:** it invites
  "12-345 6789", which the old normalizer accepted from neither arm (`0…` and
  `60…` only) and rejected. `assertValidMyMobile` (server, the authority) and
  `myWaPhoneCheckoutSchema` (client mirror) now also take a bare MY mobile NSN,
  pinned to `^1\d{8,9}$` so a foreign number that merely starts with 1 (a US
  `+1` is 11 digits) can never be silently rewritten to a Malaysian one. The
  loose `assertValidMyWaPhone` is untouched — the counter's manual bind may
  legitimately key a foreign number.
- **Caret on every receipt row.** The rows have been tappable since PR1, but
  the only cue was a caption under the whole list. The chevron sits on the LEFT
  so the money column stays flush, and its ~1rem footprint matches the `pl-4`
  the note / attachment sub-lines already indent by.
- **Truck on the delivery charge** (all four quote states — fee / free /
  pending / calculating are one concept), and a package on the pickup charge:
  a glyph on one of two fee rows would read as a bug, not a decision.
- **No card inside a card.** `CheckoutSection` is a bordered card, so
  everything nested in it now carries **fill, not outline**: the method picker
  became the house segmented control (`bg-muted p-1`, raised `bg-background`
  on the selected segment), and `AddressFieldset` / `PickupSummaryCard` /
  the pickup radio rows / the confirmed-address card dropped their borders.
  `AddressFieldset` also lost its duplicate visible title — it now takes an
  optional `legend`, passed only when the section heading is the method
  question rather than "Delivery address" (the dialog has its own title).
  Date chips keep their border: a pill is a chip, not a card.
- **Pickup title spacing** — a `<legend>` is rendered by the fieldset and is
  **not a flex item**, so the fieldset's `gap-3` never applied below it and the
  title sat flush against the first option. Fixed with `mb-2` on the legend
  itself (same fix in `AddressFieldset`).
- **Mobile bottom bar trimmed.** It stacked a total, a blocked reason, the CTA
  and *two* full sentences of small print. The reassurance line is now
  desktop-only — "confirmation lands in your WhatsApp" is already the phone
  field's own description — and the bar carries one line: `Nothing is paid yet
  · Privacy Policy`.

## Follow-ups (PR2 / PR3 of 86eybrhrt)

- **PR2** — URL-addressable product detail (`/{slug}/p/{productSlug}`) —
  **built**, see [`storefront-product-pages.md`](./storefront-product-pages.md).
- **PR3** — landing merchandising (filter chips, featured row, 4-col desktop
  grid).
- The empty-cart checkout state links back to the store; a "resume checkout"
  nudge on the store page when a cart exists is a possible later polish.
