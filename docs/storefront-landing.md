# Storefront — landing merchandising (buyer redesign PR3 + UI polish v2 T1–T2)

**Status: implemented.** The store home's lead is merchandised: category
**image tiles** shrink into a scrollable rail, a data-driven **"Popular this
week"** shelf scrolls the store's real bestsellers, and the desktop grid drops
to **4 columns** with visibly larger tiles. Third and final slice of the
storefront buyer redesign (ClickUp `86eybrhrt`, direction B "Market Page"
locked 20 Jul 2026). Buyer-facing, all-tier. Follows
[`storefront-checkout-page.md`](./storefront-checkout-page.md) (PR1) and
[`storefront-product-pages.md`](./storefront-product-pages.md) (PR2).

## UI polish v2 — T1+T2 (ClickUp `z8r3fdegb5`, Arif's 12 Sep review)

The first two tranches of Arif's storefront polish (design:
`claude.ai/artifact/3Pp7fQmtoj9fMYNcnBugCE`; T3 category page and T4 product
page follow separately):

- **The cover hero renders ONLY on the store home.** Category, product and
  checkout pages carry the compact **`StorefrontAppBar`**
  (`storefront-app-bar.tsx`): 44px back (the bar OWNS back — the "← All
  products" text links are gone), 32px logo/initials tile, store name +
  founding badge (18px) + the live hours line, and a 44px share icon for the
  page's canonical URL (`shareLink` in `src/lib/share.ts` — OS share sheet,
  clipboard fallback; one author with the product page's Copy-link chip). Not
  sticky, deliberately: T3's category search/chips bar sticks to `top-0`.
- **Hero trimmed and re-tinted**: scrim `from-black/80…` →
  `from-primary/90 via-primary/45 to-primary/15`; logo 64 → 56px
  `rounded-[18px]` with an **initials tile** fallback (`storeInitials` —
  a hole where the brand should be reads as broken); the Kedaipal mark left
  the hero (the footer owns "Powered by"); the badge sits BESIDE the name,
  label-free (its popover carries the meaning); the hours line became a
  **pill with a live open/closed dot**. The identity block is
  `items-center` with a `gap-2` stack — the mock's ~6px rhythm read cramped
  (Zaki, 28 Sep), so the hero runs `min-h-[10.5rem]` (spec said 9.5rem) with
  the roomier gaps; deviation flagged to Arif. Desktop adds a **"Share
  store"** chip (top-right, `lg:` only — mobile heroes stay clean; subpages
  share via the app bar).
- **Founding badge is a button** (`founding-member-badge.tsx`): tap (mobile)
  / hover (desktop, `pointerType === "mouse"` so touch's synthetic
  mouseenter can't fight the tap toggle) opens a Popover — "Founding Member
  #N / One of Kedaipal's first sellers. This badge is issued by Kedaipal,
  not self-declared." Sizes: 28px hero, 18px app bar.
- **Cart bar → floating pill** (`cart-bar.tsx`): navy `h-14 rounded-full`
  capsule inset 16px (bottom-right on desktop) — count badge (caps at 99+),
  "N items / RM total", mint Checkout. **Renders nothing while the cart is
  empty** (chrome saying "Empty" taught nothing); appears with the first
  add. Ordering paused keeps the pill (cart persists) with checkout
  disabled-with-reason. In dark the accent-on-primary pair would be
  mint-on-mint, so the badge + CTA flip to `dark:bg-background`. Pages
  reserve `pb-28` (≥96px) so the pill never sits on the footer.
- **Section headings** (`section-heading.tsx`): the three 11px all-caps
  eyebrows ("Browse by category" / "Popular this week" / "ALL PRODUCTS")
  became real `<h2>`s — `font-heading text-[15px] font-extrabold` — with a
  right-aligned context fact ("Most ordered, last 7 days", "23 items").
  One component, three call sites, so they can't drift.
- **Card CTA is one full-width pill in every state** (Arif's 12 Sep
  supersede): `+ Add` (mint) / `Options`·`Book` (outline, icon) / `Notify`
  (outline, disabled, "Coming soon" — ships ahead of the notify feature) /
  the **−/n/+ stepper** once `cartQuantity > 0` (mint, `justify-between`,
  count tabular; − is `useCart.quickRemoveProduct`, which drops the whole
  line when a decrement would fall below the product's minimum — symmetric
  with quick-add's min top-up, and the card has no room to explain a
  shortfall). **When that tap will clear the line, the − says so**
  ("Remove Kuih Lapis from cart — minimum order is 4", as both
  `aria-label` and `title`): on a min-order product this is the DEFAULT
  state, since quick-add opens the line AT the minimum, and a minus glyph
  labelled "Remove one" that silently wipes four units is the button lying
  about its own consequence (PR #308 review). `+` disables at the
  hard-block stock / event-seat cap, so an enabled + always adds. The
  disabled `Notify` carries its "coming soon" promise in the accessible
  name as well as the wrapper's `title`, which only ever reaches a mouse. Price sits on its own `whitespace-nowrap` line
  (RM 9,999.99 stays whole). Photo inset `p-1.5` in an 18px-radius card;
  out-of-stock photos go `grayscale opacity-60` under a muted badge.

## Category rail — small image tiles, in a carousel

`category-rail.tsx`. A horizontal snap-scroller of category tiles: the
category's own image (or a deterministic brand-adjacent gradient when it has
none), its name, and its live product count.

**Sized down from the original rail, not removed.** PR3 first replaced the
full-size rail with text chips, because tiles at `h-[9.5rem] w-[15rem]`
dominated the fold on a ≤3-category store and pushed the products — the
actual inventory — below it. Zaki's call (31 Jul) was that losing the
photography went too far: for a food seller the picture *is* the menu. So the
tiles came back at roughly a third of the old area, which keeps the images
without burying the grid. Tile images had never left the data or the
dashboard; this puts them back on the storefront. The polish pass
(`z8r3fdegb5`) tightened mobile tiles to `124×84` `rounded-[14px]` and made
desktop a **4-column grid** of `h-[120px]` tiles under the search bar
(Arif's desktop-home-v2: a wide screen shows every door at once instead of
hiding them in a scroller) — ONE list, CSS-switched at `lg`, because a
second DOM tree would double-fetch every tile image. The count moved from a
top-right pill INTO the label block ("N items" under the name): it's a fact
about the name, not a badge on the photo.

- Tiles are **links to the existing category pages**, not client-side
  filters: `/c/{slug}` keeps its SSR/SEO and shareable deep links (the
  dashboard's per-category copy-link still lands somewhere real), and there
  is exactly one navigation model.
- **Store home only.** The rail briefly also rendered on the category page
  with the current tile ringed, for lateral hops (kuih → cakes); that was cut
  (Zaki, 31 Jul). Inside a category the page already names it (h1 + blurb)
  and the only job left is browsing what's in it, so a row of siblings just
  competes with the products it sits on top of. The app bar's back is the
  way out (T3 of `z8r3fdegb5` adds sibling CHIPS to that page instead). No
  "All" tile either, for the same reason — that link already exists.
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
the qualifying products.

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
- **Visibility is filtered server-side, BEFORE the cap** — and that order is
  the whole point. Ranking reads `orders.items[].productId` with no product
  lookup, so counter-only SKUs (hidden from the storefront, fully
  counter-sellable, and their orders count) rank like anything else. Capping
  to ten first and letting the client discard them — which is what PR3
  originally did — spends slots on products that can never render, with no
  rank-11 to back-fill: a stall seller whose top ten are counter-only got an
  **empty shelf**. `rankPopularProducts` therefore returns the full ranked
  list and the query filters (same index + rules as `list`) then slices.
  Caught in the PR #155 review; pinned by a query test.
- **Ids only cross the wire, and only listable ones.** The query returns
  ranked product ids — no order counts — because it's unauthenticated: a
  store's sales volume is the seller's business, not a competitor's scraping
  target. **Live stock and minimum-quantity stay client-side** on purpose:
  they change by the minute and the client already holds them reactively in
  `products.list` (Convex dedupes the identical subscription — no extra
  read), so a candidate that sells out or becomes min-trapped drops out of
  the row without a round trip. Visibility, by contrast, is server truth (see
  above).
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
products" heading → grid. Rail and shelf both slot into `ProductGrid`'s
`beforeGrid` (wrapped in a `gap-6` column so neither leaves a dangling gap
when it renders nothing),
so an active search hides them and results take the whole surface (existing
behaviour, unchanged).

The **"All products" heading belongs to the grid it labels**
(`AllProductsDivider`, exported from `product-grid.tsx` — a real `<h2>` with
the live item count since `z8r3fdegb5`, no longer a hairline rule), not to
whichever section sits above it. It was briefly owned by the popular shelf,
which meant it vanished with the shelf on any store under the
qualifying-orders threshold — leaving category tiles 4px from the first
product row, on every newly-onboarded seller and every quiet week (PR #155
review). `ProductGrid` renders it right after `beforeGrid` (so it knows the
product count), as a following sibling of the route's `peer`-marked wrapper,
shown via `peer-[:not(:empty)]` only when at least one merchandising section
actually rendered. The wrapper is genuinely `:empty` when they all return
null, so all four combinations are right with no extra queries or
prop-drilling — verified in-browser across rail+shelf / rail-only /
shelf-only / neither.

The **category page** renders neither rail nor shelf — it goes app bar →
category name → search → grid.

## Tests

`convex/lib/popularProducts.test.ts` (ranking: distinct-order counting,
status filtering, threshold, cap, determinism; `popularSince` day-alignment
AND the rolling-window slide),
`convex/products.test.ts` (query: ranking end-to-end, retailer isolation,
single-order hides, non-midnight `since` rejected, **unlisted bestsellers
never consume a slot**; plus `get` refusing an archived product to a
non-owner),
`category-rail.test.tsx` (a tile per category with count + link, the section
heading, no tile ever marked as the current page, deterministic gradient
fallback, own image when set, zero-category null), `featured-product.test.tsx`
(loading/empty null, the whole ranked set shelved in rank order, unranked
catalog products stay off, unlisted/sold-out candidates dropped, quick-add
wiring, multi-variant → page, and the error boundary degrading to nothing).
Polish-pass surfaces: `storefront-app-bar.test.tsx` (back ownership +
listing-back variant, initials tile, badge at 18px, one-line hours,
44px share), `cart-bar.test.tsx` (empty → nothing, count/total, 99+ cap,
checkout navigation, paused disabled-with-reason),
`founding-member-badge.test.tsx` (labelled button, popover copy, cover/theme
artwork, sm size), `product-page.test.tsx` (the gallery's LCP preload contract: the hint covers
the mobile branch, each branch requests the sizes the hint is built from, and
only the first mobile tile is eager), `product-card.test.tsx` (stepper swap +
wiring + stock-cap
disable, the min-order − label stating that it clears the line, Notify on
out-of-stock with its promise in the accessible name, disabled Options on a
min-trapped product),
`useCart.test.tsx` (`quickRemoveProduct`: decrement, remove-at-zero,
below-minimum drop, custom-line immunity).
