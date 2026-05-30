# Self-Collect Pickup Locations — Implementation Reference

Reference doc for the multi-location self-collect feature. **Backend + dashboard + storefront + tracking UI + Google Places autocomplete + WhatsApp location pin shipped.** This file documents what exists, why it was built this way, and what depends on it next.

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
  address,          // 3–500 chars (Google formattedAddress when autocomplete used)
  mapsUrl?,         // legacy fallback; strict Waze + Google Maps allowlist, ≤500 chars
  notes?,           // ≤200 chars
  latitude?,        // captured from Google Places autocomplete
  longitude?,       // — both written together or not at all
  placeId?,         // Google's stable place identifier
  isActive,         // soft-delete flag
  sortOrder,        // ascending; drag-and-drop reorder writes 0..N-1
  createdAt, updatedAt,
}
```

Indexes: `by_retailer`, `by_retailer_active`.

`orders` table gained pickup + delivery coordinate fields:

```
pickupLocationId?:  v.id("pickupLocations"),
pickupSnapshot?:    { label, address, mapsUrl?, notes?, latitude?, longitude? },
deliveryAddress?:   { line1, line2?, city, state, postcode, notes?, mapsUrl?, latitude?, longitude? },
```

The pickup snapshot (and the buyer's chosen `deliveryAddress`) is **frozen at order create / `updatePickupLocation`** and never mutated afterwards — editing the source location does not rewrite history.

`retailers` table gained two fields:

- `offerSelfCollect?: v.optional(v.boolean())` — the explicit toggle that gates the storefront, checkout invariants, and dashboard checklist visibility. **New retailers default to `true`** (set in `createRetailer`) so the Pickup checklist step is discoverable during onboarding. Pre-existing rows stay undefined and are treated as `false` — no migration, no surprise nag.
- `pickupSetupSeen?: v.optional(v.boolean())` — set the first time the seller opens the Pickup settings tab. Drives checklist step-4 dismissal so a seller who deliberately skips self-collect isn't nagged. See **Visibility gating** below.

### Files

| Path | Purpose |
|---|---|
| `convex/google.ts` | Server-side proxy for Google Places API (New). `autocompleteAddress` + `getPlaceDetails` actions. API key (`GOOGLE_MAPS_API_KEY`) never reaches the browser; results scoped to `includedRegionCodes: ["my"]`; session-token billing pattern; field mask locked to Essentials tier. Rate-limited via `googleAutocomplete` (30/min) and `googlePlaceDetails` (10/min) buckets, keyed by Clerk subject (settings caller) or `retailerId` (storefront). |
| `convex/google.test.ts` | 10 tests — short-input no-op, payload normalization, header/body/region forwarding, error handling (403/404/missing key/missing rate key/missing coordinates). Stubs `globalThis.fetch` to assert exact wire payloads. |
| `convex/lib/mapsUrl.ts` | Pure shared validator — `assertValidMapsUrl`, `isValidMapsUrl`, `ALLOWED_MAPS_HOSTS` (no Convex imports). Used by legacy pasted-link path only; new autocomplete captures derive maps URLs from lat/lng instead. |
| `src/lib/google-address.ts` | Pure client helpers — `parseGoogleAddress` maps Google `addressComponents` into our `{ line1, city, state, postcode }` shape; `normalizeMyState` resolves Federal Territory variants ("Wilayah Persekutuan Kuala Lumpur" → "WP Kuala Lumpur") and alternate spellings ("Penang" → "Pulau Pinang", "Malacca" → "Melaka") into our `MY_STATES` enum. |
| `src/lib/google-address.test.ts` | 10 tests covering both helpers — Federal Territory variants, alt spellings, case-insensitive matching, named-building line1 fallback, `postal_town` fall-through, unknown-state graceful empty. |
| `src/components/forms/google-address-autocomplete.tsx` | Reusable combobox shared by the pickup-settings dialog and the buyer-checkout `AddressFieldset`. Debounced (300ms), session-token managed internally, keyboard/mouse navigation, loading/error/no-results/escape states. Public storefront callers pass `retailerId` for rate-limit scoping; authenticated callers omit it (action falls back to Clerk subject). |
| `convex/pickupLocations.ts` | Queries (`listForRetailer`, `listActivePublicBySlug` — surfaces lat/lng for the storefront picker, `hasAnyActive`), mutations (`create`, `update`, `setActive`, `reorder`). `create`/`update` accept `latitude`/`longitude`/`placeId`; `update` accepts `null` for those fields to explicitly clear coords. `sanitizeCoords` enforces WGS84 ranges; lat/lng are all-or-nothing (silently dropped when only one is provided). |
| `convex/pickupLocations.test.ts` | 26 integration tests — CRUD, soft-delete/restore, bulk `reorder`, tenant isolation, `hasAnyActive`, and the Google-autocomplete field group (create stores coords, range rejection, all-or-nothing drop, `update` with null clears, public listing surfaces coords, order snapshot freeze including coords). |
| `convex/orders.ts` | `create` extended with the pickup invariants; new `updatePickupLocation` mutation (pending-only, mirrors `updateDeliveryAddress`). |
| `convex/orders.test.ts` | +10 tests — strict-branch enforcement, snapshot freeze, inactive/foreign-tenant id rejection, legacy zero-info path preservation, full `updatePickupLocation` lifecycle. |
| `convex/retailers.ts` | `updateSettings` accepts `offerSelfCollect`; `createRetailer` defaults it to `true`. Idempotent `markPickupSetupSeen` mutation called from the Pickup tab on mount. `RetailerPublic` surfaces `offerSelfCollect` everywhere and `pickupSetupSeen` on `getMyRetailer` only. |
| `convex/retailers.test.ts` | +6 tests covering the default-true behaviour and `markPickupSetupSeen` (auth, missing retailer, first-call patch, idempotency, per-user scoping). |
| `convex/lib/whatsappCopy.ts` | `PickupSnapshot` type now carries optional `latitude`/`longitude`. `renderPickupBlock` **suppresses the inline `mapsUrl`** when lat/lng are set — the WhatsApp location pin sent as a follow-up replaces the inline URL, keeping the confirm text clean. Legacy snapshots without coords still get the URL inline. |
| `convex/lib/whatsapp.ts` | New `sendLocation(toPhone, lat, lng, name, address)` calling Meta's `/messages` endpoint with `type: "location"`. Stringifies lat/lng per Meta's spec. |
| `convex/lib/channels/types.ts` | `OutboundMessage` union gained `kind: "location"` variant — channel-neutral so any future adapter (Telegram, WeChat) implements a `location` send or degrades to text. |
| `convex/lib/channels/whatsapp/adapter.ts` | Adapter `send` switch handles the new `location` kind by delegating to `sendLocation`. |
| `convex/whatsapp.ts` | `getRetailerLocaleForOrder` surfaces `deliveryAddress` so the confirm-flow can read its coords. New `resolveLocationPin(meta)` helper picks the right pin (pickup snapshot for self-collect, delivery address for delivery) and returns `undefined` when no coords were captured. Confirm flow sends the pin after the CTA — isolated `try/catch` so a location-send failure doesn't break the rest of the confirm. |
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
| `src/routes/app.index.tsx` | Dashboard checklist step 4 (only when `offerSelfCollect` is on); marked "Optional" via the pill in both expanded and collapsed row variants. Done logic: `pickupSetupSeen \|\| hasAnyActive`. |
| `src/routes/app.orders.$shortId.tsx` | Seller order detail — "Pick up at" card mirroring the delivery address block, plus a "Notify store manager" panel with a pre-built copy-to-clipboard snippet for forwarding to whoever runs the pickup spot. |

### Visibility gating (toggle + count)

Self-collect surfaces on the storefront **only when both gates are open**:

```
shopperSeesSelfCollect = retailer.offerSelfCollect && activePickupLocations.length > 0
```

When either is closed, the Self Collect button is hidden entirely — buyers never see a non-functional option. The same rule governs:

- **`orders.create`** strict-branch — when `deliveryMethod === "self_collect"` and `offerSelfCollect === true` and ≥1 active location exists, `pickupLocationId` is **required** and is verified to belong to the retailer and be active before the snapshot is frozen onto the order.
- **`orders.create`** legacy-zero-info path — when either gate is closed, a `self_collect` order is accepted with no pickup info (matches the historical behaviour — preserved deliberately).
- **Dashboard checklist step 4** — appears for every retailer with `offerSelfCollect === true` (which is the default for new retailers) so the feature is discoverable during onboarding. Pre-existing retailers with `offerSelfCollect` unset don't see it. The step is marked "Optional" via a small pill so sellers know they can skip without consequence.

### Onboarding & checklist dismissal

Step 4 has two independent paths to "done":

1. **Visited dismissal** — when the seller opens the Pickup settings tab for the first time, `PickupLocationsTab` fires the idempotent `markPickupSetupSeen` mutation. `retailer.pickupSetupSeen` flips to `true` and step 4 renders as strikethrough done, even if the seller didn't add any locations.
2. **Completion** — adding at least one active pickup location flips `hasAnyActive` to `true`, which also strikes the step through.

Step 4 `done = pickupSetupSeen || hasPickupLocation`. Either signal is enough — a seller who's clearly seen the feature and chose to skip it doesn't get nagged, and a seller who configured a pickup point is rewarded for completing it.

The mutation uses a `useRef` guard in the React layer to prevent re-firing on re-renders. The server-side mutation is also idempotent (no-op when already `true`), so a stale double-call is harmless.

### Pickup snapshot lifecycle

`pickupSnapshot` is the **single source of truth for all buyer-visible pickup details** after order creation. It is written by:

- **`orders.create`** — copies the resolved `pickupLocations` row at insert time.
- **`orders.updatePickupLocation(shortId, pickupLocationId)`** — public mutation, pending-only, rate-limited under `addressUpdate`. Same trust model as `updateDeliveryAddress` (shortId is the capability). Mirrors `updateDeliveryAddress`'s pending-only guard and writes a `pickup_location_updated` `orderEvents` audit row.

It is read by:

- **`convex/whatsapp.ts`** confirm flow — surfaced via `getRetailerLocaleForOrder` and rendered into the WhatsApp confirmation message via `renderPickupBlock`.
- **`src/routes/track.$shortId.tsx`** — the "Pick up at" card.

Edits to the source `pickupLocations` row (label, address, mapsUrl, notes) **never propagate** to existing orders. Deactivating the source row (`isActive = false`) also leaves the historical snapshot intact; the only effect is that `updatePickupLocation` will refuse to switch a pending order to that now-inactive id.

### Google Places autocomplete (sellers + buyers)

Both the pickup-settings address input and the buyer's delivery address form use a **shared `<GoogleAddressAutocomplete>` component** that calls the Convex action proxy (`autocompleteAddress` → `getPlaceDetails`). The API key lives only in the Convex deployment env (`GOOGLE_MAPS_API_KEY`), never in the client bundle.

**Architecture decisions:**

- **Convex action proxy** instead of a referrer-restricted browser key. Cleaner key rotation, central rate-limiting via the existing `rateLimiter` (`googleAutocomplete` 30/min, `googlePlaceDetails` 10/min), and one place to add future logging/cost accounting. Per-request cost is the Convex action invocation (cheap) plus Google's bundled session price.
- **Session tokens** — the client component generates a UUID per "type → see suggestions → pick" cycle and passes it to both actions. Google bundles autocomplete queries + one Place Details call into a single billable session at the Essentials tier (~$17/1000 sessions). A new token is generated after each successful pick to start a fresh session.
- **Malaysia only** — `includedRegionCodes: ["my"]` on autocomplete so we never get suggestions from SG/TH.
- **Essentials field mask** — `id,formattedAddress,addressComponents,location` only. The cheapest billable tier and all we need.
- **Graceful manual-entry fallback** — buyers who type a not-on-Google address can still submit; their order just gets no location pin (everything else works).

**State normalization:** `parseGoogleAddress` (in `src/lib/google-address.ts`) maps Google's `addressComponents` into our structured form. The trickiest bit is the state field — `normalizeMyState` resolves:

- Federal Territories: `Wilayah Persekutuan Kuala Lumpur` / `Federal Territory of Kuala Lumpur` / `Kuala Lumpur` all → `WP Kuala Lumpur` (same for Labuan/Putrajaya)
- Alternate spellings: `Penang` → `Pulau Pinang`, `Malacca` → `Melaka`
- Everything else: case-insensitive match against `MY_STATES`

Unknown states return `undefined`, in which case the form leaves the state field blank for the buyer to pick.

### Legacy `mapsUrl` allowlist

Pickup locations had a stricter allowlist than delivery addresses (Waze + Google Maps share-sheet hosts only). After the autocomplete migration, the `mapsUrl` field is **no longer user-facing for new captures** — coordinates from Google drive the maps experience instead. The field stays on the schema for legacy rows; the strict validator in `convex/lib/mapsUrl.ts` and its allowlist are retained for any rare legacy edit path.

### WhatsApp confirm composition

Order of the confirm message + follow-ups when a self-collect snapshot is present:

```
1. Confirm text:
   {confirmBody}                  // retailer-overridable template
   \n
   📍 Pickup details              // renderPickupBlock — non-overridable
   {label}
   {address}
   {mapsUrl?}                     // ONLY when no lat/lng — see suppression rule
   \n
   {notes?}
   \n\n
   {transferReferenceLine}        // system message, non-overridable
   \n
   💳 Payment details             // renderPaymentInstructions, if any
   [I've paid button]             // CTA

2. Location pin (separate message)  // ONLY when lat/lng present — tappable map
                                    // preview that opens in buyer's default
                                    // maps app (Waze/Google/Apple)

3. Payment QR image (separate)      // if configured
```

The pickup block is appended *after* the user-overridable confirm template — retailers can customise their own copy without being able to break the pickup info. No new template variables were added to the override surface.

**`mapsUrl` suppression:** `renderPickupBlock` drops the inline `mapsUrl` line when the snapshot has both `latitude` AND `longitude` — the dedicated location pin sent as message #2 makes the inline URL redundant noise. Legacy snapshots without coords still get the URL inline so navigation isn't lost.

**Location pin (delivery orders too):** Delivery orders that captured a `deliveryAddress.latitude`/`longitude` from Google autocomplete also get a location pin after their confirm (record-keeping + verification for the buyer). Pin "name" is `address.line1`, "address" is a one-line composition of the full address.

### Tracking page navigation buttons

For self-collect orders the tracking page (`/track/<shortId>`) renders **two side-by-side buttons** when the pickup snapshot has lat/lng:

- **Open in Waze** → `https://waze.com/ul?ll=<lat>,<lng>&navigate=yes`
- **Open in Google Maps** → `https://www.google.com/maps/search/?api=1&query=<lat>,<lng>`

Both URLs are derived from stored coordinates — no app-specific data is captured separately. Legacy snapshots without coords fall back to the single "Open in maps" link from the retailer's `mapsUrl`. If neither is present, no buttons render.

### Storefront checkout branching

`checkout-sheet.tsx` branches on the active-location count when self-collect is selected:

- **0 active locations** (or `offerSelfCollect` off): the Self Collect tile is hidden entirely; the row collapses to a single full-width Delivery button.
- **1 active location**: the tile shows; selecting it renders a `PickupSummaryCard` (auto-confirmed, no input). The id is resolved at submit time from the single option.
- **2+ active locations**: the tile shows; selecting it renders a required `PickupLocationRadioList`. Submit refuses to proceed without a chosen id, with the message *"Please choose a pickup location to continue."*

The `wa.me` prefilled text now inlines `📍 Self Collect at: <label>\n<address>\n<mapsUrl>\n<notes>` so the buyer sees pickup details immediately, before the bot replies.

### Settings UI

- **"Pickup" tab** added to `/app/settings`, between Payments and Integrations.
- **Top card:** `offerSelfCollect` toggle. Amber callout when the toggle is on but zero active locations exist ("buyers won't see the option until you add one").
- **Main card:** locations list with **drag-and-drop reorder** (`@dnd-kit/core` + `@dnd-kit/sortable`). Each active row exposes a `GripVertical` handle on the left — drag listeners are bound to the handle only, so tapping Edit / the active toggle never starts a drag. Sensors: `PointerSensor` (8 px distance), `TouchSensor` (250 ms hold + 5 px tolerance), `KeyboardSensor` (arrow-key reorder for a11y). `touch-none` on the handle prevents mobile scroll-while-drag.
- **Optimistic drop:** dropping a row applies the new order to local state immediately, fires the `reorder` mutation in the background, and reverts + toasts on failure. Convex's reactive query then ships the authoritative order back on success — same as the optimistic state, so no flicker.
- Each row also shows: label, address, optional "Open in maps" link, notes, edit button, active/hidden toggle. Inactive rows live behind a "Show inactive (N)" collapsible. Empty state with a CTA when no locations exist.
- **Reactivating** a soft-deleted row sends it to the end of the active list so it doesn't ambush the retailer's current ordering.

### `reorder` mutation invariants

`pickupLocations.reorder(retailerId, orderedIds)` rewrites `sortOrder` to the index of each id (0..N-1) so the result is gap-free. Validates that `orderedIds` is **exactly** the set of currently-active ids for the retailer:

- Length must match the active set (catches a stale client whose cache lost or gained a row after someone else added/deactivated a location).
- No duplicates.
- No foreign or inactive ids.
- Tenant-scoped via `requireRetailerOwner`.

Inactive rows' `sortOrder` values are intentionally untouched — preserving them keeps `setActive(true)`'s "push to end" semantics (`Math.max(allSortOrders) + 1`) robust against drift.

### Dashboard checklist

Setup checklist on `/app` gains a 4th step `"pickup"` when `retailer.offerSelfCollect === true` (default for new retailers). Marked "Optional" via a small pill in both the expanded and collapsed row variants. Done logic: `pickupSetupSeen || hasAnyActive`. Deep-links to `/app/settings?tab=pickup`. Pre-existing retailers with `offerSelfCollect` unset keep the original 3-step checklist unchanged.

### Order detail (seller view)

`/app/orders/$shortId` for self-collect orders renders two extra blocks, both reading from the frozen `pickupSnapshot`:

- **"Pick up at" card** — label, address, optional notes, with Copy and Maps buttons (Maps only when the snapshot has a `mapsUrl`). Mirrors the existing "Delivery Address" section visually.
- **"Notify store manager" panel** — a pre-built message snippet in a `<pre>` block with a "Copy message" button. Format:

  ```
  📦 New pickup order ORD-AB23 — Main Store
  Customer: Ali (+60 12-345 6789)

  Items:
  • 1× Mango Kush Seed (RM 50.00)

  Total: RM 50.00

  Please prepare for collection.
  ```

  Customer line resolves `name → phone → "Anonymous"`; phone runs through the shared `formatPhone` helper. Fixed format for v1 — per-retailer override is future work, only revisit if retailers ask. Seller can edit the message after pasting it into the manager's chat.

## Env requirements

- **`GOOGLE_MAPS_API_KEY`** (Convex deployment env, set via `npx convex env set`). Server-side only — never `VITE_`-prefixed. Required for Google autocomplete; absence causes the proxy actions to throw a sanitized error. Owner-managed; restricted to "Places API (New)" and the Kedaipal HTTP referrer allowlist.
- Everything else (WhatsApp Cloud API, etc.) unchanged.

## Tier gating (deferred)

The pricing plan caps Starter at **1 active pickup location** and lets Pro+ have unlimited. **Not implemented in v1** — there's no plan/tier field on `retailers` yet (subscription billing is Sprint 1–3). All retailers currently get unlimited locations. The cap will be added inside `pickupLocations.create` (and a "N locations hidden — upgrade to Pro" banner in `listForRetailer`) when the subscription-billing task lands.

## Known limitations

- **No hard-delete.** Soft-delete only. A retailer cannot permanently remove a location, even one with zero orders against it. Acceptable for v1; revisit if the inactive list becomes cluttered.
- **`channelUserId` migration not part of this feature.** Identity is still keyed by `waPhone` on `orders.customer` and `customers`. The channel-adapter Phase 4–6 migration is independent and unblocked separately.
- **No React component tests.** Same constraint as the customer-database feature — pure helpers are unit-tested, UI components are verified via `tsc` + manual end-to-end in the browser.

## Future work

- **Tier cap enforcement** when subscription billing lands (Starter = 1 active, Pro+ = unlimited) — single check inside `pickupLocations.create`, plus a soft over-cap banner in `listForRetailer` for retailers downgraded from Pro.
- **Click-to-send "notify store manager"** — per-location `managerWaPhone` + a `wa.me` deep-link button on the order detail page so the seller can forward the pre-built message in one tap instead of copy/paste. (Parked in favour of the Google autocomplete bundle; revisit when retailers ask.)
- **Pickup time slots / appointments** — currently a free-form `notes` field. A structured slot picker (Mon–Sat 10am–6pm, etc.) would unlock the cake/kuih cohort's actual workflow.
- **Pickup location attached to a specific product** — for retailers where only some products are pickup-eligible (e.g. frozen-only). Not requested yet; flag the use case if it surfaces.
