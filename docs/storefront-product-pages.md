# Storefront — product pages (buyer redesign PR2)

**Status: implemented.** Every visible product now has a **URL** —
`/{storeSlug}/p/{productSlug}` — rendered as a real page with per-product
SSR/OG and Product JSON-LD. Second slice of the storefront buyer redesign
(ClickUp `86eybrhrt`; direction locked 20 Jul 2026: URL-addressable product
detail — sheet UX on mobile, page on desktop). Buyer-facing, all-tier.
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
  prod at ship**, same as the variants backfill). Until it runs, slug-less
  rows just keep the in-place sheet — nothing breaks, they aren't linkable yet.
- `products.getPublicBySlug({retailerId, slug})` — the page's read. Applies
  the exact public-visibility rules of `list` (`active`, not `hidden`, not
  `hiddenByCategory`) so a counter-only or archived product's URL answers
  null → 404, never a leak (extends the hidden-products promise). Same
  `productWithVariants` shape as `list` — page, grid and sheet can't disagree.

## One buy box, two views (frontend)

`product-purchase.tsx` is the shared engine: `useProductPurchase` (selection,
quantity, stock/min-quantity gating, price labels, custom-line state incl.
reference-photo upload) + the presentational pieces (`OptionPills`,
`PurchaseHints`, `CustomOrderCard`, `PurchaseStepper`, `TotalPreviewRow`,
`AddToCartButton`, `GoToCheckoutBar`) + `addVariantToCart` (the one author of
cart-line snapshots — grid quick-add, sheet and page all call it).

- **`product-detail-sheet.tsx`** — the in-store view, now a thin composition
  of those pieces (behaviour unchanged, tests untouched). Gains a **copy-link
  button** in the header when the product has a slug.
- **`product-page.tsx`** — the destination view: store identity header (back +
  name + cart chip that jumps to checkout), gallery (mobile keeps the sheet's
  snap carousel; desktop gets hero + thumbnails, variant-aware), buy box with
  a **Copy link** chip, and purchase controls that are a sticky bottom bar on
  mobile and in-flow on desktop.
- **Share affordance**: `shareProductLink` uses the OS share sheet when
  available (the WhatsApp path on mobile) and falls back to clipboard + toast.

## How buyers reach each view

- **Grid card tap** — mobile opens the **sheet** (fastest cart-building,
  scroll preserved); desktop (`lg+`) **navigates to the page** (the proper
  view, per the locked redesign direction). Slug-less legacy rows fall back
  to the sheet everywhere until the backfill runs.
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
  focused — sellers can copy from their own storefront (sheet header or page
  chip) today.
- In-store mobile taps deliberately do NOT navigate (no scroll loss, no
  back-stack spam while browsing); the page is the destination for links,
  not a detour in cart-building.

## Tests

`convex/products.test.ts` — slug generation + collisions, rename stability,
degenerate names, lazy assignment on edit, backfill idempotency,
`getPublicBySlug` visibility rules (hidden/archived/unknown → null), and the
no-URL-takeover + restore-revives-URL invariant. Frontend behaviour rides the
existing `product-detail-sheet.test.tsx` (the sheet's composition of the
shared pieces keeps its contract).
