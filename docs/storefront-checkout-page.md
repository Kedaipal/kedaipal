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
  thumb reach.
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

## The receipt summary (the "Order Ticket" skin)

`CheckoutSummary` + `CheckoutTotals` in
`src/components/storefront/checkout-summary.tsx` — dotted leader lines on fee
rows, dashed separators, `tabular-nums` digits, and a stamped **TOTAL** chip
(the one personality moment; form controls stay conventional). Pure
components: cart mutations via the `UseCart` handle, quote state passed in —
unit-tested without Convex/router providers
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

## Follow-ups (PR2 / PR3 of 86eybrhrt)

- **PR2** — URL-addressable product detail (`/{slug}/p/{productSlug}`) —
  **built**, see [`storefront-product-pages.md`](./storefront-product-pages.md).
- **PR3** — landing merchandising (filter chips, featured row, 4-col desktop
  grid).
- The empty-cart checkout state links back to the store; a "resume checkout"
  nudge on the store page when a cart exists is a possible later polish.
