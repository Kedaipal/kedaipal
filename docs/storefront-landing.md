# Storefront — landing merchandising (buyer redesign PR3)

**Status: implemented.** The store home's lead is merchandised: category
**filter chips** replace the image-tile rail, a data-driven **"Popular this
week"** shelf scrolls the store's real bestsellers, and the desktop grid drops
to **4 columns** with visibly larger tiles. Third and final slice of the
storefront buyer redesign (ClickUp `86eybrhrt`, direction B "Market Page"
locked 20 Jul 2026). Buyer-facing, all-tier. Follows
[`storefront-checkout-page.md`](./storefront-checkout-page.md) (PR1) and
[`storefront-product-pages.md`](./storefront-product-pages.md) (PR2).

## Category chips, not hero tiles

`category-chips.tsx` replaces `category-rail.tsx` (deleted). The rail's big
image cards were heavy for the typical ≤3-category store and pushed the
products — the actual inventory — below the fold; the design call was
explicit: *"rail cards were heavy for ≤3 categories."*

- The chips are **links to the existing category pages**, not client-side
  filters: `/c/{slug}` keeps its SSR/SEO and shareable deep links (the
  dashboard's per-category copy-link still lands somewhere real), and there
  is exactly one navigation model.
- **"All"** links to the store home and reads active there; the **category
  page renders the same row with its own chip active**
  (`activeCategorySlug`), so buyers hop laterally (kuih → cakes) without
  going through back. The page's "← All products" link stays as the way
  *up*; chips are the way *across*.
- Zero-category stores render nothing — pixel-identical to the
  pre-categories storefront (the rail's contract, kept).
- **Every storefront `<Link to="/$slug">` passes
  `activeOptions={{ exact: true }}`.** TanStack Router matches prefixes by
  default and stamps its own `aria-current="page"` on anything it considers
  active — so on `/herb/c/cakes` the store-home link (`/herb`, a prefix) was
  announced as the current page *alongside* the real one, silently
  overriding an explicit `aria-current={undefined}`. Found on the chips;
  it was already true of the pre-existing "← All products" back links on the
  category, product and checkout pages, so all six call sites were fixed
  together. The styling was always right, which is why it looked fine —
  only a screen reader (or the DOM) showed three "current" links on one
  page. The chips test pins the `exact` request, since a plain-anchor `Link`
  stub cannot reproduce the router's own matching.
- Category **tile images still exist** in the data and dashboard — they're
  just no longer a storefront surface. If they earn a home later, the
  category page header is the natural spot.

## "Popular this week" — the merchandising shelf

`featured-product.tsx` + the public query `products.popularProducts` + pure
ranking in `convex/lib/popularProducts.ts`.

**Real order data, zero seller curation.** The target cohort won't
merchandise by hand, and a hand-picked "featured" flag goes stale; actual
orders don't lie. The section renders a **horizontally scrollable shelf** of
the qualifying products, closed by the "All products" divider that hands over
to the grid.

- **Ranking** = distinct orders per product in the last 7 days (quantity as
  tiebreak, id as the stable final tiebreak). Distinct orders, not units —
  one 40-pax bulk order shouldn't outrank ten customers buying one cake
  each. Only revenue statuses count (`isRevenueOrder`: confirmed→delivered;
  pending/cancelled excluded).
- **Honesty threshold**: fewer than 2 orders in the window → not a candidate;
  if nothing qualifies the section hides entirely. A new or quiet store shows
  search + chips + grid, never a hollow "bestseller" claim.
  (`POPULAR_MIN_ORDERS = 2`.)
- **Up to `POPULAR_TOP_CANDIDATES = 10`** on the shelf. The row scrolls, so
  extra items cost nothing in layout — the cap exists because past ~10 a
  "popular this week" shelf stops being a shortlist and starts being the
  catalog, which the grid below already is.
- **Ids only cross the wire.** The query returns ranked product ids — no
  order counts — because it's unauthenticated: a store's sales volume is the
  seller's business, not a competitor's scraping target. The client resolves
  ids against the `products.list` subscription it already holds (Convex
  dedupes identical subscriptions — no extra read), so public-visibility
  rules apply exactly once, and any candidate since hidden, archived, sold
  out or min-quantity-trapped **drops out of the row** rather than being
  merchandised as unbuyable.
- **The window ROLLS, ending now** — it is not a calendar week. `since =
  popularSince()` is MYT midnight 7 days back with **no upper bound**, so on
  3 Oct the shelf covers 26 Sep 00:00 → now and on 4 Oct it covers 27 Sep
  00:00 → now. Nothing resets on a week boundary, so the shelf never blanks
  out on a particular weekday. Test-pinned (`popularSince` "slides forward
  one day per day").
- **Cache discipline** (the insights precedent): day-aligning that anchor
  means every buyer on the same MYT date sends identical args and shares one
  cached result; the server **rejects** non-midnight anchors rather than
  letting per-pageview `Date.now()` values fragment the cache. The scan is an
  indexed newest-first `by_retailer` range read bounded by
  `take(POPULAR_SCAN_CAP = 500)` whatever window a hand-rolled client asks
  for.

**The shelf renders the shared `ProductCard`** — the same component the grid
uses — in fixed-width cells (`w-40 sm:w-44 lg:w-52`) inside a full-bleed
snap-scroller, identical on mobile and desktop (the Grab/Pandamart pattern
Zaki asked for). Reusing the card means the shelf inherits every state the
grid already handles — out-of-stock, low stock, "Min N", custom-available,
quick-add vs Choose, real `<Link>`s for crawlers — and the two surfaces
cannot drift. There is deliberately **no "Bestseller" ribbon**: the section
heading already says what the row is, and stamping it on all ten would be
noise. Add reuses the grid's exact `quickAddProductToCart` (min-quantity
top-up, hard-block stock clamp, one author).

*Getting here took three passes (Zaki, 31 Jul), worth recording so the
shape isn't relitigated:* the design only ever mocked this section in a phone
frame, so the first cut shipped one mobile card at every width — a thumbnail
marooned beside a metre of nothing at 1150px. A full-width banner variant was
worse. Capping a single card at `max-w-md` looked fine but answered the wrong
question: **the section was never meant to be one item.** A scrolling shelf
of the actual ranked list fills the row honestly at any width and needs no
breakpoint-specific layout at all.

## 4-column desktop grid

`GRID_CLASS` in `product-grid.tsx`: `lg:grid-cols-5 xl:grid-cols-6` →
`lg:grid-cols-4` (skeletons synced). The old density existed so product
cards never outweighed the category hero tiles; with the rail gone the
products are the page, and the design call was tiles ~50% larger.

## Layout order (store home)

Search (sticky, first control) → chips → popular shelf → "All products"
divider → grid. Chips and shelf both slot into `ProductGrid`'s `beforeGrid`,
so an active search hides them and results take the whole surface (existing
behaviour, unchanged). The divider renders with the shelf (it separates the
bestsellers from the full catalog); chips alone flow straight into the grid.

## Tests

`convex/lib/popularProducts.test.ts` (ranking: distinct-order counting,
status filtering, threshold, cap, determinism; `popularSince` day-alignment
AND the rolling-window slide),
`convex/products.test.ts` (query: ranking end-to-end, retailer isolation,
single-order hides, non-midnight `since` rejected),
`category-chips.test.tsx` (All + per-category links, active states,
zero-category null), `featured-product.test.tsx` (loading/empty null, the
whole ranked set shelved in rank order, unranked catalog products stay off,
unlisted/sold-out candidates dropped, quick-add wiring, multi-variant → page,
and the error boundary degrading to nothing).
