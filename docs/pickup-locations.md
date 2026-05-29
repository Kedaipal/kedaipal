# Self-Collect Pickup Locations — Implementation Reference

Reference doc for the multi-location self-collect feature. **Backend + dashboard + storefront + tracking UI shipped.** This file documents what exists, why it was built this way, and what depends on it next.

## Context (2026-05-29)

Self-collect is a real F&B home-seller pattern (cake collection, kuih, frozen-supplier pickup), and a Founding-10 frozen supplier asked for it by name. Before this:

- `orders.deliveryMethod` already supported `"self_collect"` (since the original schema), but **no pickup address was ever captured on the order**.
- Buyers received the confirmation message with no collection details, forcing a back-and-forth in WhatsApp chat that recreates the #1 universal pain ("order info buried in chat").

A retailer-managed library of pickup locations + a buyer-side picker + an inline pickup block on the confirm message closes the loop and unblocks the supplier demo.

## What got built

### Schema

New `pickupLocations` table — retailer-managed library, soft-deleted (never hard-deleted) so historical order snapshots remain meaningful:

```
pickupLocations: {
  retailerId,
  label,            // 1–60 chars
  address,          // 3–500 chars
  mapsUrl?,         // strict Waze + Google Maps allowlist, ≤500 chars
  notes?,           // ≤200 chars
  isActive,         // soft-delete flag
  sortOrder,        // ascending; up/down arrows swap with active neighbour
  createdAt, updatedAt,
}
```

Indexes: `by_retailer`, `by_retailer_active`.

`orders` table gained two optional fields:

```
pickupLocationId?:  v.id("pickupLocations"),
pickupSnapshot?:    { label, address, mapsUrl?, notes? },
```

The snapshot is **frozen at order create / `updatePickupLocation`** and never mutated afterwards — editing the source location does not rewrite history.

`retailers` table gained `offerSelfCollect?: v.optional(v.boolean())` (default-`false`-when-undefined) — the explicit toggle that gates the storefront, checkout invariants, and dashboard checklist visibility. See **Visibility gating** below.

### Files

| Path | Purpose |
|---|---|
| `convex/lib/mapsUrl.ts` | Pure shared validator — `assertValidMapsUrl`, `isValidMapsUrl`, `ALLOWED_MAPS_HOSTS` (no Convex imports). Imported from both Convex mutations and the client Zod schema. |
| `convex/pickupLocations.ts` | Queries (`listForRetailer`, `listActivePublicBySlug`, `hasAnyActive`), mutations (`create`, `update`, `setActive`, `moveUp`, `moveDown`). Self-contained `requireRetailerOwner` / `requireOwnedLocation` helpers mirroring the `customers.ts` pattern. |
| `convex/pickupLocations.test.ts` | 17 integration tests — CRUD, soft-delete/restore, sort-order swap (including "skip inactive neighbour"), tenant isolation, `hasAnyActive`. |
| `convex/orders.ts` | `create` extended with the pickup invariants; new `updatePickupLocation` mutation (pending-only, mirrors `updateDeliveryAddress`). |
| `convex/orders.test.ts` | +10 tests — strict-branch enforcement, snapshot freeze, inactive/foreign-tenant id rejection, legacy zero-info path preservation, full `updatePickupLocation` lifecycle. |
| `convex/retailers.ts` | `updateSettings` accepts `offerSelfCollect`; `RetailerPublic` + both `getMyRetailer` and `getRetailerBySlug` surface it. |
| `convex/lib/whatsappCopy.ts` | New `PickupSnapshot` type + `renderPickupBlock(locale, snapshot)` (EN/MS). Returns `""` for missing snapshot so callers concat unconditionally. |
| `convex/lib/whatsappCopy.test.ts` | +6 tests for `renderPickupBlock`. |
| `convex/whatsapp.ts` | `getRetailerLocaleForOrder` surfaces `pickupSnapshot`; confirm send layers the pickup block between the confirm body and the transfer-reference line. |
| `src/lib/schemas.ts` | `pickupLocationFormSchema` (Zod, refines `mapsUrl` via the shared validator); `checkoutFormSchema` gained `pickupLocationId: z.string()`. |
| `src/components/settings/pickup-locations-tab.tsx` | Settings tab body — `offerSelfCollect` toggle card + locations list (up/down arrows, edit, active toggle, "show inactive" collapsible). |
| `src/components/settings/pickup-location-edit-dialog.tsx` | Bottom-sheet add/edit modal, mirrors `address-edit-dialog.tsx`. |
| `src/routes/app.settings.tsx` | New `"pickup"` tab wired into the tab bar + search validator. |
| `src/routes/$slug.tsx` | Sidecar `listActivePublicBySlug` query passed through `CartBar` to `CheckoutSheet`. |
| `src/components/storefront/cart-bar.tsx` | Drills `offerSelfCollect` + `pickupLocations` through. |
| `src/components/storefront/checkout-sheet.tsx` | Self-Collect button hidden when unavailable; 0/1/2+ branching (auto-confirm card for 1, required radio for 2+); pickup block inlined into the `wa.me` prefilled text. |
| `src/routes/track.$shortId.tsx` | "Pick up at" card for self-collect orders, rendered from the frozen snapshot. |
| `src/routes/app.index.tsx` | Dashboard checklist step 4 (only when `offerSelfCollect` is on); pulls `hasAnyActive` for the done state. |

### Visibility gating (toggle + count)

Self-collect surfaces on the storefront **only when both gates are open**:

```
shopperSeesSelfCollect = retailer.offerSelfCollect && activePickupLocations.length > 0
```

When either is closed, the Self Collect button is hidden entirely — buyers never see a non-functional option. The same rule governs:

- **`orders.create`** strict-branch — when `deliveryMethod === "self_collect"` and `offerSelfCollect === true` and ≥1 active location exists, `pickupLocationId` is **required** and is verified to belong to the retailer and be active before the snapshot is frozen onto the order.
- **`orders.create`** legacy-zero-info path — when either gate is closed, a `self_collect` order is accepted with no pickup info (matches the historical behaviour — preserved deliberately).
- **Dashboard checklist step 4** — included in the array only when `offerSelfCollect === true`. Delivery-only retailers don't see it at all (not "auto-done", just gone).

### Pickup snapshot lifecycle

`pickupSnapshot` is the **single source of truth for all buyer-visible pickup details** after order creation. It is written by:

- **`orders.create`** — copies the resolved `pickupLocations` row at insert time.
- **`orders.updatePickupLocation(shortId, pickupLocationId)`** — public mutation, pending-only, rate-limited under `addressUpdate`. Same trust model as `updateDeliveryAddress` (shortId is the capability). Mirrors `updateDeliveryAddress`'s pending-only guard and writes a `pickup_location_updated` `orderEvents` audit row.

It is read by:

- **`convex/whatsapp.ts`** confirm flow — surfaced via `getRetailerLocaleForOrder` and rendered into the WhatsApp confirmation message via `renderPickupBlock`.
- **`src/routes/track.$shortId.tsx`** — the "Pick up at" card.

Edits to the source `pickupLocations` row (label, address, mapsUrl, notes) **never propagate** to existing orders. Deactivating the source row (`isActive = false`) also leaves the historical snapshot intact; the only effect is that `updatePickupLocation` will refuse to switch a pending order to that now-inactive id.

### `mapsUrl` allowlist

Pickup locations enforce a stricter allowlist than delivery addresses — scoped to the two share-sheet formats Malaysian shoppers actually use:

```
waze.com, www.waze.com, maps.app.goo.gl, goo.gl, maps.google.com, www.google.com
```

`https://` only, ≤500 chars. The validator throws a human-readable `Error` so callers (Convex mutations vs Zod refine) choose how to surface it. The existing delivery-address `mapsUrl` validator in `convex/lib/address.ts` was intentionally **not** tightened to the same allowlist — grandfathered to avoid invalidating existing delivery rows.

### WhatsApp confirm composition

Order of the confirm message body when a self-collect snapshot is present:

```
{confirmBody}                  // retailer-overridable template
\n
📍 Pickup details              // renderPickupBlock — non-overridable
{label}
{address}
{mapsUrl?}
\n
{notes?}
\n\n
{transferReferenceLine}        // system message, non-overridable
\n
💳 Payment details             // renderPaymentInstructions, if any
...
```

The pickup block is appended *after* the user-overridable confirm template — retailers can customise their own copy without being able to break the pickup info. No new template variables were added to the override surface.

### Storefront checkout branching

`checkout-sheet.tsx` branches on the active-location count when self-collect is selected:

- **0 active locations** (or `offerSelfCollect` off): the Self Collect tile is hidden entirely; the row collapses to a single full-width Delivery button.
- **1 active location**: the tile shows; selecting it renders a `PickupSummaryCard` (auto-confirmed, no input). The id is resolved at submit time from the single option.
- **2+ active locations**: the tile shows; selecting it renders a required `PickupLocationRadioList`. Submit refuses to proceed without a chosen id, with the message *"Please choose a pickup location to continue."*

The `wa.me` prefilled text now inlines `📍 Self Collect at: <label>\n<address>\n<mapsUrl>\n<notes>` so the buyer sees pickup details immediately, before the bot replies.

### Settings UI

- **"Pickup" tab** added to `/app/settings`, between Payments and Integrations.
- **Top card:** `offerSelfCollect` toggle. Amber callout when the toggle is on but zero active locations exist ("buyers won't see the option until you add one").
- **Main card:** locations list with up/down arrow buttons (mobile-friendly, ≥44px tap targets — true drag-and-drop is backlogged). Each row: label, address, optional "Open in maps" link, notes, edit button, active/hidden toggle. Inactive rows live behind a "Show inactive (N)" collapsible. Empty state with a CTA when no locations exist.
- **Reactivating** a soft-deleted row sends it to the end of the active list so it doesn't ambush the retailer's current ordering.

### Dashboard checklist

Setup checklist on `/app` gains a 4th step `"pickup"` only when `retailer.offerSelfCollect === true`. `done = hasAnyActive`. Deep-links to `/app/settings?tab=pickup`. Delivery-only retailers (`offerSelfCollect === false`) keep the existing 3-step checklist unchanged.

## Env requirements

None beyond what already exists.

## Tier gating (deferred)

The pricing plan caps Starter at **1 active pickup location** and lets Pro+ have unlimited. **Not implemented in v1** — there's no plan/tier field on `retailers` yet (subscription billing is Sprint 1–3). All retailers currently get unlimited locations. The cap will be added inside `pickupLocations.create` (and a "N locations hidden — upgrade to Pro" banner in `listForRetailer`) when the subscription-billing task lands.

## Known limitations

- **No true drag-and-drop reorder.** Up/down arrow buttons only. DnD via `dnd-kit` with touch sensors is backlogged — only shipped if time permits before the demo window. Up/down arrows are mobile-friendly and good enough for a screen retailers use a handful of times.
- **No hard-delete.** Soft-delete only. A retailer cannot permanently remove a location, even one with zero orders against it. Acceptable for v1; revisit if the inactive list becomes cluttered.
- **`channelUserId` migration not part of this feature.** Identity is still keyed by `waPhone` on `orders.customer` and `customers`. The channel-adapter Phase 4–6 migration is independent and unblocked separately.
- **No React component tests.** Same constraint as the customer-database feature — pure helpers are unit-tested, UI components are verified via `tsc` + manual end-to-end in the browser.

## Future work

- **Tier cap enforcement** when subscription billing lands (Starter = 1 active, Pro+ = unlimited) — single check inside `pickupLocations.create`, plus a soft over-cap banner in `listForRetailer` for retailers downgraded from Pro.
- **Drag-and-drop reorder** via `dnd-kit` + touch sensor.
- **Pickup time slots / appointments** — currently a free-form `notes` field. A structured slot picker (Mon–Sat 10am–6pm, etc.) would unlock the cake/kuih cohort's actual workflow.
- **Pickup location attached to a specific product** — for retailers where only some products are pickup-eligible (e.g. frozen-only). Not requested yet; flag the use case if it surfaces.
