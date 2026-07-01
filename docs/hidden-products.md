# Hidden-from-storefront products

A product-level **`hidden`** flag lets a seller keep a product **off the public
storefront** while it stays **fully sellable in counter checkout**, inventory,
and the dashboard. It is a pure list/unlist switch — it touches no price,
approval, or variant logic.

ClickUp [`86ey40ze9`](https://app.clickup.com/t/86ey40ze9).

## Why

Rahman (Mr Ganu Lekor) runs a food event and sells lekor at an event-only price
via **counter checkout**. The custom-price-approval flow can't fire per walk-up
sale (and breaks counter checkout with variants), so the workaround is a
pre-priced SKU the seller rings up in person but shoppers never see online. A
hidden product is exactly that.

## The state model

`hidden` is **orthogonal to `active`** (which is the archive flag). Three
observable states:

| `active` | `hidden` | Storefront | Counter checkout | Dashboard |
| --- | --- | --- | --- | --- |
| `true`  | falsy   | ✅ listed | ✅ sellable | ✅ (normal) |
| `true`  | `true`  | ❌ hidden | ✅ sellable | ✅ badged **Hidden** |
| `false` | (any)   | ❌ | ❌ | ✅ badged **Archived** |

`hidden` defaults to `undefined` (visible) — a legacy/dev-only widen with **no
backfill**. Archived (`active:false`) already sits off the storefront, so the
**Hidden** badge only shows on active products.

## Backend (`convex/products.ts`)

- **`products.hidden: v.optional(v.boolean())`** on the `products` table
  (`convex/schema.ts`). No new index — see below.
- **`products.list`** (public storefront, unauthenticated) collects active rows
  via the `by_retailer_active` index, then drops hidden ones with an in-memory
  `.filter(q => q.neq(q.field("hidden"), true))`. The set is already scoped to
  one retailer's active products (capped at 50/retailer), so filtering a handful
  in memory is cheaper than a compound index — and this is not a full scan.
- **`products.listForCounter`** (new; owner-OR-admin via
  `requireRetailerOwnership`) mirrors `list` — active products, active variants —
  **but keeps hidden ones in**. Counter checkout reads this instead of `list`.
  It is **authenticated on purpose**: hidden products must never leak through the
  public, unauthenticated `list`, so we did **not** add an `includeHidden` param
  to `list`.
- **`products.get`** (public, by-id) returns **`null`** for a hidden product when
  the caller isn't the owner/admin — closing the same leak as `list` for the
  single-product read (Convex ids are opaque, but the promise is "no hidden SKU
  through a public query", so we don't rely on that). Owner/admin still get the
  full product to edit.
- **`create`** / **`update`** accept an optional `hidden` and persist it. Both go
  through the existing owner-OR-admin gate; no change to the soft-lock or audit
  behaviour.

## Frontend

- **Product editor** (`src/components/forms/product-form.tsx`) — a top-of-form
  **Visibility** control (Visible / Hidden segmented control), with a live helper
  line explaining that hidden products stay sellable at the counter. Wired
  through `app.products.new.tsx` (create) and `app.products.$productId.tsx`
  (edit).
- **Dashboard product list** (`src/routes/app.products.index.tsx`) — active
  products carry a **Hidden** pill so the state is never silent.
- **Counter checkout picker** (`src/routes/app.checkout.tsx`) — hidden products
  carry a **Hidden** pill next to the name so the seller can confirm at a glance
  they're ringing up the counter-only SKU. Reads `listForCounter`.

## Tests

`convex/products.test.ts`: create/update persistence, create-time hidden,
storefront `list` exclusion, `listForCounter` inclusion (and archived exclusion),
the owner-OR-admin gate on `listForCounter`, and `get` returning `null` for a
hidden product to a non-owner (full to the owner).

## Deliberately out of scope

Per the ticket: no changes to price logic, custom-price-approval, or variant
logic. (The custom-price-approval-with-variants bug on counter checkout is a
separate parked Q2 item.)
