# Storefront — landing merchandising (buyer redesign PR3)

**Status: implemented.** The store home's lead is merchandised: category
**image tiles** shrink into a scrollable rail, a data-driven **"Popular this
week"** shelf scrolls the store's real bestsellers, and the desktop grid drops
to **4 columns** with visibly larger tiles. Third and final slice of the
storefront buyer redesign (ClickUp `86eybrhrt`, direction B "Market Page"
locked 20 Jul 2026). Buyer-facing, all-tier. Follows
[`storefront-checkout-page.md`](./storefront-checkout-page.md) (PR1) and
[`storefront-product-pages.md`](./storefront-product-pages.md) (PR2).

## Category rail — small image tiles, in a carousel

`category-rail.tsx`. A horizontal snap-scroller of category tiles: the
category's own image (or a deterministic brand-adjacent gradient when it has
none), its name, and its live product count.

**Sized down from the original rail, not removed.** PR3 first replaced the
full-size rail with text chips, because tiles at `h-[9.5rem] w-[15rem]`
dominated the fold on a ≤3-category store and pushed the products — the
actual inventory — below it. Zaki's call (31 Jul) was that losing the
photography went too far: for a food seller the picture *is* the menu. So the
tiles came back at `h-24 w-36` (`lg:h-28 lg:w-44`) — roughly a third of the
old area — which keeps the images without burying the grid. Tile images had
never left the data or the dashboard; this puts them back on the storefront.

- Tiles are **links to the existing category pages**, not client-side
  filters: `/c/{slug}` keeps its SSR/SEO and shareable deep links (the
  dashboard's per-category copy-link still lands somewhere real), and there
  is exactly one navigation model.
- **Store home only.** The rail briefly also rendered on the category page
  with the current tile ringed, for lateral hops (kuih → cakes); that was cut
  (Zaki, 31 Jul). Inside a category the page already names it (h1 + blurb)
  and the only job left is browsing what's in it, so a row of siblings just
  competes with the products it sits on top of. "← All products" is the way
  back out. No "All" tile either, for the same reason — that link already
  exists.
- **Scrim is heavier than the old rail's** (`from-primary/90 via-primary/30`).
  These tiles are a third the area with 13px names, and a seller's photo can
  be pale — a white-iced cake on marble left white-on-light. The top of the
  gradient stays near-clear so the photography still reads.
- Zero-category stores render nothing — pixel-identical to the
  pre-categories storefront (the rail's original contract, kept).
- Same scroller mechanics as the popular shelf below it, including the
  `scroll-pl-*` fix described there.

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
  search + rail + grid, never a hollow "bestseller" claim.
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
cards never outweighed the category hero tiles; with those tiles now a third
of their old size the products are the page, and the design call was tiles
~50% larger.

## Layout order (store home)

Search (sticky, first control) → category rail → popular shelf → "All
products" divider → grid. Rail and shelf both slot into `ProductGrid`'s
`beforeGrid` (wrapped in a `gap-6` column so neither leaves a dangling gap
when it renders nothing),
so an active search hides them and results take the whole surface (existing
behaviour, unchanged). The divider renders with the shelf, since it separates
the bestsellers from the full catalog. The **category page** renders neither
rail nor shelf — it goes header → back link → category name → search → grid.

## Tests

`convex/lib/popularProducts.test.ts` (ranking: distinct-order counting,
status filtering, threshold, cap, determinism; `popularSince` day-alignment
AND the rolling-window slide),
`convex/products.test.ts` (query: ranking end-to-end, retailer isolation,
single-order hides, non-midnight `since` rejected),
`category-rail.test.tsx` (a tile per category with count + link, no tile ever
marked as the current page, deterministic gradient fallback, own image when
set, zero-category null), `featured-product.test.tsx` (loading/empty null, the
whole ranked set shelved in rank order, unranked catalog products stay off,
unlisted/sold-out candidates dropped, quick-add wiring, multi-variant → page,
and the error boundary degrading to nothing).
