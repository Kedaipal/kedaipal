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
  that are a sticky bottom bar on mobile and in-flow on desktop.
- **Share affordance**: `shareProductLink` uses the OS share sheet when
  available (the WhatsApp path on mobile) and falls back to clipboard + toast.

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
Frontend: `product-purchase.test.tsx` covers the shared checkout CTA, and
`product-detail-sheet.test.tsx` keeps the buy-box contract (custom line,
live total, minimum-quantity states) through the seller-preview shell.
