# Storefront — product pages (buyer redesign PR2)

**Status: implemented.** Every visible product now has a **URL** —
`/{storeSlug}/p/{productSlug}` — rendered as a real page with per-product
SSR/OG and Product JSON-LD. Second slice of the storefront buyer redesign
(ClickUp `86eybrhrt`; direction locked 20 Jul 2026: URL-addressable product
detail. The mobile-sheet half of that call was reversed on 30 Jul — see
"One product view" below.) Buyer-facing, all-tier.
Follows [`storefront-checkout-page.md`](./storefront-checkout-page.md) (PR1).

## Why product URLs

Sellers close in WhatsApp — and until now there was **nothing to paste**: a
product lived only inside a modal on the store home. The product page is the
growth surface the flow was missing: a seller (or a happy buyer) drops
`/{store}/p/{product}` into a chat or a status, and the recipient lands on
that product with photos, price, options and an add-to-cart — plus OG tags so
the WhatsApp link preview shows the product photo, and JSON-LD so Google can
index each product as a `Product` with offers.

## The slug (backend)

- `products.slug` — **auto-generated from the name at create** (never a
  seller input; zero new form fields), unique per retailer via the new
  `by_retailer_slug` index, collisions suffixed `-2`, `-3` (category
  precedent). Degenerate names (emoji-only) pad to `item`/`item-x`.
- **Stable across renames** — a shared link must keep working, so `update`
  never rewrites an existing slug. It only *assigns* one to a legacy slug-less
  row on its first edit (lazy convergence).
- Archived/hidden products **keep** their slug: uniqueness is checked across
  the whole catalog, so a new same-named product can't steal a URL and
  restoring revives the original link (test-pinned).
- **Backfill**: `npx convex run products:backfillProductSlugs` — idempotent,
  batched, self-scheduling. Run once per deployment (dev done 30 Jul; **run on
  prod at ship**, same as the variants backfill). Not load-bearing for
  correctness — the derived-slug fallback below keeps un-backfilled rows
  addressable — it just moves them onto the indexed path.
- `products.getPublicBySlug({retailerId, slug})` — the page's read. Applies
  the exact public-visibility rules of `list` (`active`, not `hidden`, not
  `hiddenByCategory`) so a counter-only or archived product's URL answers
  null → 404, never a leak (extends the hidden-products promise). Same
  `productWithVariants` shape as `list` — page, grid and preview can't
  disagree. Falls back to the derived name-slug for un-backfilled rows.

## One product view, on every breakpoint

**Revised 30 Jul** (Zaki). The first cut routed desktop taps to the page but
kept a bottom sheet on mobile, reasoning that a sheet builds carts faster and
preserves scroll. That reasoning didn't survive contact:

- **It hid the URL on the platform that matters most.** PR2 exists to give
  every product a shareable link; on mobile the address bar *is* the share
  affordance (browser share sheet). Routing mobile to a modal meant the URL
  never appeared and buyers had to find a Copy-link button instead.
- **A modal costs more on a small screen, not less** — it eats height on the
  device with the least of it.
- Tapping a product to open its page is the universal mobile-commerce
  pattern; the "extra tap back" is a wash against the sheet's ✕.

So the storefront routes **every** product tap to the page. The bottom sheet
survives in exactly one place — **the seller's product editor**
(`app.products.$productId.tsx`), where it previews an unsaved draft. That's
the right home for it: a draft has no public URL to navigate to, and the
preview shouldn't eject the seller from the editor. Its buyer-only props
(cart count/total, the checkout CTA, the copy-link button) were stripped,
since a preview has no cart and no URL.

### No backfill race

With the page as the only buyer view, a product without a stored slug would
be **un-openable** — so `getPublicBySlug` resolves those by the slug derived
from the name (`effectiveSlug`), and `productWithVariants` returns that same
derived value so the grid always has a working link. Bounded by the
50-product cap, and once a row has a stored slug the index arm answers first,
so it never runs on a migrated catalog. Net: the feature is correct the
moment it deploys, independent of when `backfillProductSlugs` runs. The
fallback still applies the full visibility rules (hidden/archived → null),
pinned by test.

## One buy box, two surfaces (frontend)

`product-purchase.tsx` is the shared engine: `useProductPurchase` (selection,
quantity, stock/min-quantity gating, price labels, custom-line state incl.
reference-photo upload) + the presentational pieces (`OptionPills`,
`PurchaseHints`, `CustomOrderCard`, `PurchaseStepper`, `TotalPreviewRow`,
`AddToCartButton`, `GoToCheckoutBar`) + `addVariantToCart` (the one author of
cart-line snapshots — grid quick-add, sheet and page all call it).

- **`product-detail-sheet.tsx`** — now the **seller's draft preview only**
  (see above), a thin composition of the same pieces so what the seller
  previews is what the buyer gets.
- **`product-page.tsx`** — the destination view. It renders the **shared
  `StorefrontHeader`** — the same brand block (cover, logo, store name,
  founding badge, blurb) as the store home and category pages — followed by
  an "← All products" back link, mirroring the category page exactly. A buyer
  arriving from a pasted WhatsApp link lands in the *seller's store*, not on
  an anonymous product card. There's no cart chip in the header: the sticky
  purchase bar below already carries count + total + "Go to checkout", and
  saying it twice is the redundancy we removed from the checkout header.
  Below that: gallery (mobile snap carousel; desktop hero + thumbnails,
  variant-aware), buy box with a **Copy link** chip, and purchase controls
  that are a fixed bottom bar on mobile and in-flow on desktop (`lg:static`).
- **Description sits directly under the title/price, above the option
  pickers** (Zaki, 31 Jul). It used to render below the custom-order card,
  where it read as a footnote — but "what is this" is the question a buyer
  answers *before* "which size", especially arriving cold from a pasted
  WhatsApp link. It's **clamped to three lines with a Read more toggle**,
  because moving it up means its length now decides how far down the pickers
  sit: measured on dev, a 240-character description already ran four lines at
  430px and pushed the Size pills under the fixed purchase bar, and a seller
  listing ingredients, allergens and lead time writes far more than that. The
  full text stays in the DOM (indexable, selectable) — only its height is
  bounded. Products with no description render nothing at all: no empty
  block, no stray gap.
- **Share affordance**: `shareProductLink` uses the OS share sheet when
  available (the WhatsApp path on mobile) and falls back to clipboard + toast.

### The reset effect keys on `_id`, never the product object

The two surfaces feed the hook the same *shape* but not the same *lifetime*:
the sheet passes a snapshot held in the caller's `useState`, the page passes a
**live** `getPublicBySlug` result. Convex hands back a fresh object whenever
the query's value actually changes, so on the page anything that writes the row
or its variants — another buyer's order decrementing hard-block stock, the
seller editing a price — arrives as a brand-new object for the *same* product.

So the "a new product opened" reset (clear selection, re-seed the stepper at the
remaining-to-minimum, clear the custom note, revoke the uploaded reference
photo) depends on `product?._id` and reads the current doc through a ref. Keyed
on the object it would fire on every live update and silently wipe an in-flight
buyer's typed cake spec and uploaded photo — the exact ICP flow. Everything
that *should* react to the new data already does, derived per render:
`availability`/`sellable` re-resolve, and `displayQuantity` clamps to the new
`maxQty` instead of resetting to 1. Pinned both ways by test (same `_id` keeps
state, different `_id` resets).

## How buyers reach each view

- **Grid card tap** — navigates to the page on **every** breakpoint (see
  "One product view" above). Slug-less rows resolve via the derived-slug
  fallback, so there is no un-openable window before the backfill.
- **Shared links / search** — land on the page on any device.
- Route: `src/routes/$slug_.p.$productSlug.tsx` (pathless-parent underscore,
  same trick as the category + checkout routes). Slug renames 301 onto the
  new store slug; unknown/hidden/archived product → "Product not found" with
  a browse-the-store exit. `robots: index, follow` + canonical + OG (product
  photo → cover → logo precedence) + `Product` JSON-LD (`Offer` /
  `AggregateOffer`; quote-only products carry **no** offers block rather than
  advertising RM 0).

## Discoverability — the pages have to be findable

The SEO apparatus above (canonical, `robots: index, follow`, `Product` JSON-LD)
is **inert on its own**. Two things point at it, and both are load-bearing:

**1. The card is a real `<a href>`.** `ProductCard` renders its photo, its name
and (when orderable) its "Choose" CTA as TanStack `<Link>`s — not a
`<button onClick={navigate}>`. A click handler navigates fine and is invisible
to everything else: a crawler can only follow an anchor, and buyers lose
⌘/middle-click-to-new-tab, right-click "copy link address", the hover URL
preview, and the router's `defaultPreload: "intent"` prefetch. On the surface
whose entire job is producing a pasteable link, that's the wrong trade. Same
shape `CategoryRail` already uses for `/{store}/c/{category}`.

  - The photo link is `aria-hidden` + `tabIndex={-1}` so a screen reader
    announces the card's destination **once** (the name link), not three times.
  - An unorderable product (out of stock, or stock below its minimum with no
    custom line) renders "Choose" as a **disabled button** instead — an `<a>`
    can't be disabled, and disabled-with-reason beats a live link to a page the
    buyer can't order from.
  - `ProductGrid.storeSlug` is therefore **required**: a card with nowhere to
    link is a dead tile.

**2. `/sitemap.xml` lists every visible product.** `products.listForSitemap`
emits `{storeSlug, productSlug, updatedAt}` per retailer, applying `list`'s
exact visibility rules — a hidden, category-suppressed or archived product must
not be advertised to a crawler any more than it's shown on the storefront, or
Google indexes URLs that answer 404. Priority `0.6` (below the store home at
`0.8` — the storefront is the entry a seller shares, a product page is a leaf),
`changefreq weekly`.

  - Slug-less legacy rows are **skipped**, not emitted via `effectiveSlug`: a
    derived slug is a temporary address, and publishing one to a crawler risks
    indexing a URL `backfillProductSlugs` is about to change. They appear the
    run after the backfill.
  - Cross-retailer scan, like `retailers.listSlugsForSitemap`; the route caches
    for an hour.

## The bottom bar and the footer

Applies to both pages that carry a bottom CTA bar (product, checkout), and to
any new one. Three attempts got this wrong, so the reasoning is here.

**The bar is `position: fixed`** (`fixed inset-x-0 bottom-0`, matching the
long-standing `CartBar`), the footer is an ordinary direct flex child of the
route container *after* it, and the route reserves bottom clearance. Because
`fixed` is out of document flow, the powered-by badge renders as page content
**above** the floating bar — the store home's stacking, on every page.

- ✗ *Nest the footer inside the bar.* Welds the badge to the bar and eats
  sticky-footer space on mobile.
- ✗ *Make the bar `sticky` instead.* Sticky sits **in** flow, so a following
  footer renders **below** the bar. Tried twice: once as a house rule, once as
  "forms should differ from browse pages because a fixed bar fights the soft
  keyboard". Both were rejected on a real phone — the badge reads as welded to
  the bar and checkout becomes the one page that stacks differently from its
  siblings. The keyboard worry didn't hold up either: a fixed bar goes *behind*
  the keyboard (both iOS Safari and Chrome Android keep fixed elements pinned to
  the layout viewport), it doesn't cover the focused field, and `CartBar` has
  shipped `fixed` on the store home — which also has an input — from the start.
  Design-system rule #4 now says `fixed` outright.

**The clearance is measured, not guessed.** The bar calls
`usePublishedHeight("--storefront-bar-h")` (`src/hooks/usePublishedHeight.ts`,
the same ResizeObserver pattern as the dashboard's `--app-bottomnav-h`) and the
route reserves `pb-[var(--storefront-bar-h,12rem)] lg:pb-10`. These bars change
height for real — a blocked CTA adds a reason line, copy wraps at 320px, the
safe-area inset varies per device — and a hardcoded `pb-64` overshot by 60-75px,
which showed up as dead space under the badge.

Gotcha: a `display: none` bar measures 0, and `var(--x, fallback)` does **not**
fall back on `0px` (only when unset) — so consumers must set their own value at
breakpoints where the bar is hidden, hence the paired `lg:pb-10`.

`StorefrontFooter` takes no props: all four storefront pages share one rhythm
(32px above the badge, 24px below). It briefly had a `compact` variant for the
bar pages, which only made sense while those bars were `sticky` and sat in flow
right under it.

## Deliberate scope edges

- **No seller-facing slug editor** — the URL is derived and permanent;
  editing slugs is complexity without a driver yet. If a seller ever needs a
  vanity product URL, that's a small follow-up on the product form.
- **Dashboard copy-link buttons** (products list/editor) deferred to keep PR2
  focused — sellers can copy from the page's own chip today.

## Tests

`convex/products.test.ts` — slug generation + collisions, rename stability,
degenerate names, lazy assignment on edit, backfill idempotency,
`getPublicBySlug` visibility rules (hidden/archived/unknown → null), and the
no-URL-takeover + restore-revives-URL invariant, plus the derived-slug
fallback (resolves an un-backfilled row, and still returns null when hidden).
`listForSitemap` is pinned on all four of its promises: one pair per visible
product, hidden/archived omitted, slug-less rows skipped until the backfill
stamps them, and each product scoped to its own store's slug.

Frontend:

- `product-card.test.tsx` renders the card under a **real** router (no mocking)
  and asserts genuine hrefs — the name is an `<a>` to the product page, the
  photo link carries the same href but is `aria-hidden`/untabbable, "Choose"
  is a link when orderable and a disabled button when not, and a click
  navigates client-side.
- `product-purchase.test.tsx` covers the shared checkout CTA **and** the
  live-update contract: a re-rendered product with the same `_id` but changed
  stock keeps the buyer's option, quantity and custom note (quantity clamps to
  the new ceiling rather than resetting), while a different `_id` still resets
  everything.
- `product-detail-sheet.test.tsx` keeps the buy-box contract (custom line,
  live total, minimum-quantity states) through the seller-preview shell.
