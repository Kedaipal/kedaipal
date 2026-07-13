# Product Categories — storefront browse-by-category

ClickUp: [`86ey81n63`](https://app.clickup.com/t/86ey81n63) · Driver: Sue Chef Kitchen (3rd Founding Member) — a large multi-line menu (daily meals, corporate catering, event packages) that had become a flat scroll-wall.

Retailer-defined **categories** group products into a browsable structure: tiles on the storefront home (`/$slug`) lead to nested category pages (`/$slug/c/$categorySlug`). Many-to-many — a product can sit in up to **10** categories, a category holds any number of products. A permanent **"All products"** flat view (the store home grid) guarantees nothing ever becomes unreachable. Stores with zero categories render **pixel-identical** to before.

Naming decision: **"categories" everywhere** — tables, files, routes, UI (no Shopify-style "collections" split; one word, no translation tax).

## Schema

Two tables (additive, dev-only widen — no migration) + one derived field on `products`:

- **`categories`** — `retailerId, name, slug, description?, imageStorageId?, active, hidden?, productCount?, sortOrder, createdAt, updatedAt`. Indexes `by_retailer`, `by_retailer_active`, `by_retailer_slug` (powers the public page + per-retailer slug uniqueness). `active` = archive; `hidden` = storefront off-switch (see [Hidden categories](#hidden-categories)); `productCount` = denormalized visible count (see [Read model](#read-model--costs-pr-review-resolution)).
- **`productCategories`** (junction) — `productId, categoryId, retailerId` (denormalized for the account-deletion cascade), `sortOrder` (position **within** the category, independent of the product's global sortOrder), `createdAt`. Indexes `by_product`, `by_category_sort`, `by_product_category`, `by_retailer`.
- **`products.hiddenByCategory?`** (new) — denormalized: true when every category the product is in is hidden, so it drops off the storefront (see [Hidden categories](#hidden-categories)). No change to `orders`.

Categories are a pure browse layer — never frozen onto an order line (unlike `pickupSnapshot`), so re-categorizing never rewrites order history. They are also **never a sellability gate**: counter checkout, order create, and admin flows are untouched (a category-hidden product is still counter-sellable).

## Hidden categories

A category has a `hidden` toggle **orthogonal to archive** (mirrors `products.hidden`). Hiding a category:
- pulls its tile off the storefront rail (`listActivePublic` excludes `hidden`) and 404s its page (`getPublicPage` returns null);
- **suppresses a product only when _every_ category it belongs to is hidden** — a product also in a visible category stays on the storefront (and on that category's page). Suppressed products are still **sellable at the counter** (`listForCounter` doesn't filter them).

The suppression is denormalized onto `products.hiddenByCategory` (recomputed in [`convex/lib/categoryCounts.ts`](../convex/lib/categoryCounts.ts) on membership changes + category hide/show), so the hot `products.list` read just excludes `hidden || hiddenByCategory` — no per-load category fan-out. `products.get` also hides suppressed products from non-owners.

Hide/show (`categories.setHidden`) is **un-gated by plan** (only the soft-lock applies) — storefront visibility is always the seller's to manage, even after a downgrade. Archive vs hide: **archive** retires the grouping but leaves products listed (in All / other categories); **hide** pulls the group *and its exclusive products* off the store.

## API — `convex/categories.ts`

CRUD mirrors `pickupLocations.ts` (owner-OR-admin `requireRetailerAccess`, `productWrite` rate limit, `assertSubscriptionActive` soft-lock, `logAdminAction` audit rows on act-as writes).

| Function | Notes |
|---|---|
| `listForRetailer` (q) | All categories (active-first), live visible-`productCount` + `imageUrl`. Readable on every tier (archive must stay reachable). |
| `listProductsForCategory` (q) | Owner/admin — the category's products in within-category order, archived/hidden included + flagged (feeds the dialog's Arrange list). |
| `listActivePublic` (q) | Public rail: active categories with **≥1 active+visible product** only — an empty category never renders a tile. |
| `getPublicPage` (q) | Public page payload; `null` for unknown **or archived** slug (route 404s). Products filtered `active && !hidden`, enriched via the exported `productWithVariants` (same shape as `products.list`). |
| `getProductCategoryIds` (q) | Seeds the product editor's picker. |
| `create` / `update` (m) | **Pro-gated.** Slug via `assertValidCategorySlug` + per-retailer uniqueness (`by_retailer_slug`); archived categories keep their slug (restore keeps its URL, and blocks reuse). `update` GCs a replaced/cleared image blob (logo-GC pattern). |
| `setActive` (m) | **Un-gated** archive/restore (only the soft-lock applies). Junction rows kept — restore revives assignments. Reactivate appends to end. |
| `setHidden` (m) | **Un-gated** storefront hide/show (soft-lock only). Recomputes `hiddenByCategory` for every product in the category — see [Hidden categories](#hidden-categories). |
| `reorder` / `reorderProducts` (m) | **Pro-gated** full-permutation rewrites (pickupLocations contract: exact set, no dupes). |
| `setProductCategories` (m) | Diffs the product's full membership: adds appended to each category's end, removals deleted, kept rows keep their position. Cap 10; additions must be same-retailer + active. **Gate fires only when the diff ADDS rows** — pure removal/clear is un-gated. |

## Plan gating (Pro+)

`categories` in `PLAN_FEATURES` (`convex/lib/plans.ts`) — starter ✗, pro/scale ✓; gated via `assertPlanFeature`, admin act-as bypasses everywhere.

Gating matrix (the escape-hatch rule — a downgraded seller is never trapped, mirroring `chargeablePickup`):

| Action | Starter | Pro+ |
|---|---|---|
| Create / rename / edit / reorder categories, arrange products | ✗ (disabled-with-reason + Pro chip) | ✓ |
| **Add** a product to a category | ✗ | ✓ |
| **Remove/clear** a product's categories | ✓ | ✓ |
| **Archive / restore** a category | ✓ | ✓ |
| **Hide / show** a category (storefront visibility) | ✓ | ✓ |
| Read the management list / picker data | ✓ | ✓ |
| Buyer-side rendering (rail, category pages) | always | always |

UI locked states: `/app/products/categories` shows a `ProFeatureWall` when locked with zero categories, a `ProFeatureTease` + disabled actions (archive stays live) when locked with existing ones; the picker's unselected rows disable (selected stay deselectable).

## Archived memberships (editor scope)

The product editor manages a product's memberships in **active** categories only. `getProductCategoryIds` seeds the picker with active memberships; `setProductCategories` reconciles **only** active-category junctions and leaves archived-category junctions untouched. Consequences:
- Archiving a category preserves its product links, so **restore revives the assignments** — a later product edit can't silently drop them.
- Archived memberships **don't consume the 10-category cap** (the cap counts active only), so a product near the cap is never invisibly blocked by a link it can't see or remove. To drop an archived membership, restore the category (then deselect) or delete it.

## Surfaces

- **Dashboard** — [`/app/products/categories`](../src/routes/app.products.categories.tsx) (categories are catalog structure, so they live **under Products**; entry via a "Categories" header action, icon-only on mobile, with a page back arrow). SortableList drag-reorder, per-row **description** line + product count ("tile hidden until one is added" when 0), a **"Hidden" badge** when a category is hidden, per-row **Copy link** for the shareable `/$slug/c/<slug>` deep link, and a **⋯ menu** (Edit / Hide-Show / Archive-Restore — one menu keeps a 4th action off the crowded mobile row). [`CategoryEditDialog`](../src/components/dashboard/category-edit-dialog.tsx): name, auto-slugified editable link (server re-validates), description (≤280), optional tile image, drag-to-arrange the category's products. Entry point: **"Categories" header action on the Products index** (Pro chip when locked).
- **Product editor** — [`CategoryPicker`](../src/components/forms/category-picker.tsx) in `ProductForm` (Storefront section, after Visibility): a scrollable **checkbox list** (not chips) so each category shows its **description**, a **"Hidden" pill** on hidden categories, and an **amber note** when every picked category is hidden (the product won't show on the storefront). Long catalogs scroll (`max-h-72`). Seeded active-only. Empty state links to the management page. Both save paths call `setProductCategories` **last** so a gate error can never block the core product save (new-product path keys on the id `products.create` returns). The Products dashboard card also flags a suppressed product with a **"Hidden · category"** badge.
- **Storefront home** — layout is **search → categories → all products** (the "layout A" call, 2026-07-13): the search bar is the first control and **sticky** (always reachable mid-scroll; lives in `ProductGrid`, full-bleed via negative margins), then [`CategoryRail`](../src/components/storefront/category-rail.tsx) **`variant="hero"`** as the page's main highlight — big snap-carousel image cards (bottom scrim, name, description, item-count badge; no image → a deterministic brand-adjacent gradient hashed from the slug) under a "Browse by category" heading — closed by an "All products" divider labelling the full grid below. The rail slots into `ProductGrid`'s **`beforeGrid`** prop and is **hidden while a search query is active** (results take the whole surface). Sidecar `useQuery`, renders nothing when empty — zero-category stores stay search + grid.
- **Category page** — [`$slug_.c.$categorySlug.tsx`](../src/routes/$slug_.c.$categorySlug.tsx). The `$slug_` underscore is load-bearing: `$slug.tsx` is a leaf with no `<Outlet/>`, so plain dot-nesting would never render. SSR loader mirrors the home page (301 slug-rename redirect **preserving the category suffix**; `notFound()` for unknown/archived/hidden → "Category not found" + a Browse-all CTA, incl. live-archive while open). Own SEO head (`{category} — {store} | Kedaipal`; OG image: category image → cover → logo). Renders "← All products" back link, the rail as **`variant="switcher"`** (compact tiles — a hero carousel here would bury the category's own products; current tile highlighted + an **All products** tile, also in `beforeGrid` so search hides it), and the shared `ProductGrid`/`CartBar` — the cart is localStorage-keyed per retailer, so it carries across pages.
- `ProductGrid` gained an optional `products` override prop (skips its internal query) — the category page reuses cards/search/detail-sheet/cart-add, no fork.

## Fixed in passing

- **`useCart` persist-before-hydrate race** — a fresh mount's empty initial state could overwrite the stored cart before the async HYDRATE applied (React StrictMode's double-effects made it destructive). Persistence now waits for `state.hydratedFor === retailerId`. Surfaced by SPA navigation between storefront routes — previously impossible, so it was latent.
- **`getConvexHttpClient` was server-only** — TanStack loaders also run in the browser on client-side navigations; without a `import.meta.env.VITE_CONVEX_URL` fallback the loader threw and the navigation silently no-oped.
- **`retailers.deleteUser` cascade gaps** — now also deletes `productVariants` (+ their image blobs; previously orphaned), `categories` (+ tile blobs), and `productCategories`.
- Dev seed (`convex/seed.ts`) now creates 3 overlapping categories for `trailgear`, topping up idempotently on already-seeded deployments.

## Read model / costs (PR-review resolution)

The hot public reads must not fan out over every junction's product on each load (CLAUDE.md: "no full scans on hot paths"). So the visible-product count is **denormalized** onto `categories.productCount` (mirrors the customers-aggregate pattern):

- **`categories.productCount`** = number of storefront-visible (`active && !hidden`) products assigned. Maintained in [`convex/lib/categoryCounts.ts`](../convex/lib/categoryCounts.ts): membership add/remove adjusts the affected category (`setProductCategories`); a product visibility flip (archive/restore, hide/unhide) adjusts every linked category (`products.archive` + `products.update` call `bumpCategoryCountsForProduct`); restore recomputes from scratch (`recomputeCategoryCount`). `internal.categories.recomputeAllCounts` is a re-runnable backfill/repair.
- **`products.hiddenByCategory`** = true when every category the product is in is hidden. Same module: `recomputeProductHiddenByCategory` (one product, on membership change) + `recomputeHiddenByCategoryForCategory` (all a category's products, on hide/show). So `products.list` filters `hidden || hiddenByCategory` with no category fan-out. New (dev-only) feature → no prod backfill: every product starts un-suppressed and the flag is set forward the first time a category is hidden.
- **`listActivePublic`** (rail) reads only category rows + the stored count — no product reads, no double-read of the grid's product set.
- **`getPublicPage`** (category page) must load its products to render them; bounded by `CATEGORY_PAGE_PRODUCT_LIMIT` (100 > the 50 per-retailer product cap, so it never truncates today — defensive against a future cap raise). Per-product enrichment matches `products.list`'s cost.

Caps: ≤10 **active** categories per product (`MAX_CATEGORIES_PER_PRODUCT`; archived memberships don't count — see above); category name ≤60, description ≤280; slug 3–32, same charset as store slugs but **no reserved-word list** (nested under `/$slug/c/`, no route-collision surface).

## Tests

`convex/categories.test.ts` (CRUD, slug rules incl. reserved-words-allowed + cross-retailer reuse, image GC, archive/restore semantics, both reorders, the junction diff + cap, public visibility rules), `planGating.test.ts` ("plan gating — Categories (Pro+)": Starter rejections, escape hatches, admin act-as + audit rows), `retailers.test.ts` (deletion cascade incl. variants/categories/junction/blobs), `src/lib/subscription.test.ts` (feature flag on the client mirror).
