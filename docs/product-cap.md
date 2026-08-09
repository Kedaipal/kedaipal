# Product cap — 200 per store, and the delete that makes it honest

ClickUp [`86eyjmf4q`](https://app.clickup.com/t/86eyjmf4q). Shipped to dev Aug 2026.

## What changed

A cap already existed — `MAX_PRODUCTS_PER_RETAILER = 50`, hard, all-tier, enforced in
`products.create` and `products.bulkUpsert`. Three things were wrong with it:

1. **50 was too low for our own ICP.** Sue Chef Kitchen's scroll-wall menu was the driver for
   building categories — that's a >50 catalog. A kuih seller with a full menu, or a multi-outlet
   frozen seller listing flavours as separate products, reaches it. Hitting a hard wall on a paying
   customer is a worse failure than having no cap.
2. **It was invisible.** No counter, no disabled-with-reason, nothing in the import screen. The
   seller met it as a raw `ConvexError` at save time — on import, *after* preparing the sheet.
3. **It was a one-way ratchet.** The count included archived rows, and there was **no delete path
   for a product anywhere in the app**. A store that filled its slots with test rows and a bad
   import could never reclaim one without someone editing the database.

Now: **200 products per store, every tier**, still counted on total rows — plus
`products.deletePermanently`, which is the only thing that frees a slot.

## The decisions, and why

### 200, not tiered by plan

Catalog size is a bad upsell lever for this ICP. A seller's menu *is* their business; capping it on
Starter stops them representing their shop rather than persuading them to upgrade. `orderCap` is
the monetization lever. A store that genuinely needs >200 distinct SKUs is an Enterprise
conversation handled by hand (see the admin escape below), not a paywall.

### The cap counts TOTAL rows — active AND archived

Three reasons, in order of weight:

1. **It's the only semantic that can't be breached.** Restoring an archived product is
   `products.update({ active: true })`, which has no cap check and shouldn't need one. Under an
   active-only cap a seller sitting at the ceiling could restore their way straight past it.
   Counting rows keeps `create` and `bulkUpsert` as the *only* two mutations that can grow the
   count — the invariant lives in exactly two places. Pinned by the test
   *"restoring an archived product at the cap can't breach it"*.
2. **Archived rows aren't free.** `products.listAll` collects every product including archived ones
   and hydrates each one's variants and signed image URLs for the dashboard.
3. **It keeps the contract sayable.** "200 products." An active-only cap means 200 live plus an
   unbounded graveyard — 300+ rows of real cost wearing a "200" label.

The cost of this choice is that archiving no longer looks like removal, which is exactly why
deleting had to ship alongside it.

### Deleting is the escape valve; archiving is not

- **Archive** → off the storefront, **keeps its slot**, fully reversible.
- **Delete** → gone for good, **frees the slot**, irreversible.

Both are surfaced with that distinction spelled out, because it isn't guessable.

### Delete is refused once a product has ever been ordered

`orders.items[].productId` is a hard reference alongside the frozen name/price snapshot, so erasing
a sold product would orphan those references (Insights groups top products by `productId` and
resolves the row for its thumbnail). A sold product is archived instead.

That still leaves every row that actually clogs a cap deletable: test products, typos, duplicated
imports, and seasonal SKUs that never sold.

**A cancelled order still protects the product.** The cancelled order's line still names it, and
"has this ever sold?" is a question about history. The cost of being wrong is asymmetric — a stale
stamp only means the seller archives instead of deletes, while a wrongly-cleared one would let them
erase a product that live order rows point at.

### Admin override

A Kedaipal admin operating a store via act-as **bypasses the cap**, matching how act-as already
bypasses the subscription soft-lock. This is how a white-glove Enterprise catalog gets stocked past
the ceiling without shipping a self-serve tier we haven't designed.

The exemption is the **admin's, not the store's**: a store sitting at 250 because an admin put it
there still can't add a 251st product under its own login. Pinned by test.

## How it's built

### `convex/lib/productCap.ts` — one pure module

`MAX_PRODUCTS_PER_RETAILER`, `productCapState()`, `productCapBlockReason()`, `assertProductCap()`,
`fitsWithinProductCap()`. Imported by both the server gate and the dashboard client, so the two can
never disagree about what blocks a save (the `minOrderRules.ts` pattern).

`ProductCapState` carries `exempt` explicitly, because "is there room for N more?" can't be answered
from `remaining` alone — an exempt caller always has room, and a client reasoning from `remaining`
would wrongly block a white-glove bulk import.

### `products.orderedAt` — the O(1) "has it sold?" answer

`orders.items` is an **array**, so no index answers "which orders reference product X". The only
alternative to a denormalized stamp is scanning every order the store has ever taken and walking
each item list — unbounded, and it would break exactly on the high-volume stores most likely to be
pruning their catalog.

Stamped set-if-unset at **both** order-create sites (`orders.create` + `counterCheckout`
`createOrderFromSession`) via `stampProductsOrdered` in `convex/lib/productOrdered.ts`. Never
cleared. `updatedAt` is deliberately not bumped — that field means "when the seller last edited
this", and a sale is not an edit.

**Backfill (run once per deployment):**

```bash
npx convex run products:backfillProductOrderedAt
```

It paginates **orders** (not products — the fact lives in `items[]`) and converges on the earliest
order per product. Without it every pre-existing product looks never-ordered and would be deletable.

### `convex/lib/productDelete.ts` — one cascade, two callers

`deleteProductCascade` knows everything a product row owns: variants (and their image blobs), its
own image blobs, its `productCategories` junctions, then the row. Used by both
`products.deletePermanently` and the account-deletion cascade in `retailers.deleteUser`, which
previously open-coded its own version.

Category `productCount` is deliberately **not** in the shared helper — the two callers genuinely
differ. A single delete must decrement each category's count (via `bumpCategoryCountsForProduct`,
**before** the junctions go, since the bump reads them); account deletion is dropping those category
rows a moment later and would just be patching corpses.

`deletePermanently` is **owner-or-admin**, matching `archive` — this is a seller's own catalog
housekeeping, not the admin-only posture of the order hard delete (orders are financial records; a
never-sold product is not). It is deliberately **not** subscription-gated, for the same reason
`archive` isn't: reducing is always allowed, so a past_due or downgraded seller is never trapped.

## Where the seller is told

| Surface | What they see |
|---|---|
| Products header (both breakpoints) | `N of 200 used`, appended to the active/archived line — **only from 80%** (160), so a 12-product shop is never nagged about a ceiling it won't reach |
| Products page, at the cap | Amber card: the limit, that **archived products count**, and that deleting frees a slot |
| "New product" button (both breakpoints) | Disabled-with-reason at the cap. An `<a>` can't be disabled, so the blocked state renders a real `<button>` rather than a link that would only fail at the server |
| `/app/products/new` | Guarded before the wizard renders — covers the deep-link/bookmark path the disabled button can't, so nobody builds a whole product and only then bounces off the gate. A still-loading cap falls through to the form; the server is the real gate |
| Product detail | A "Delete this product" section below the form (**not** beside Archive in the header — different kind of action, and a destructive control next to a routine one invites the misclick), with the archive-vs-delete distinction stated |
| Product detail, sold product | Delete **disabled with the reason**, never hidden — the seller needs to learn that history is why, and that archiving is the path |
| Import preview | Remaining slots when near the cap; an over-cap sheet blocks Confirm with how many fit |

The import block is client-side **on purpose**: the sheet is chunked across several `bulkUpsert`
calls, so without it an oversized import would apply the first chunks and then throw partway,
leaving the catalog half-imported.

The delete confirm is a plain destructive `ConfirmDialog` — **no** type-to-confirm phrase, unlike
the order hard delete. That gate exists there because deleting a paid order destroys financial
history; a product that has never sold is irreversible but low-stakes, and a seller clearing ten
typo rows shouldn't type DELETE ten times.

## Deliberately not done

- **Read-path optimisation of `products.list` / `listForCounter` / `listAll`.** These collect every
  product and N+1 a variant read plus a `storage.getUrl` per image. At 200 (4× the old cap) that's
  worth measuring, but pre-optimising it wasn't in scope — the storefront grid hydrating every
  variant's images is its own ticket if the numbers demand it.
- **An actual Enterprise tier.** The admin override is the manual answer until one exists.
- **A per-retailer cap override field.** Deliberately avoided — the admin act-as bypass achieves the
  same outcome with no schema change.

## Tests

- `convex/lib/productCap.test.ts` — boundaries (inclusive at the cap), the 80% counter threshold,
  exempt behaviour, and the two shapes of `assertProductCap`'s message.
- `convex/products.test.ts` → `describe("product cap")` / `describe("deletePermanently")` — the
  last-free-slot boundary, archived-rows-count, restore-can't-breach, admin bypass (and that the
  seller stays capped), the bulk-import "only N of these M fit" refusal, update-only imports being
  unaffected, cascade completeness, the sold-product refusal (including via a **cancelled** order),
  `orderedAt` stamping from a real order, and non-owner rejection.

Mutation-tested: flipping the count to active-only turns the archived-counts and restore-breach
tests red; removing the `orderedAt` refusal turns all three sold-product tests red.
