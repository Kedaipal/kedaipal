# Delivery as an Optional Fulfilment Method — Design Spec

**Date:** 2026-06-23
**ClickUp:** [86exu4grm — "Consider delivery optional instead of default selling method"](https://app.clickup.com/t/86exu4grm)
**Status:** Approved design → implementation

## Problem

Self-collect already has an explicit `retailers.offerSelfCollect` toggle that gates the
storefront, checkout invariants, and the dashboard checklist. **Delivery has no
equivalent — it is implicitly always-on.** A seller who only does self-collect (e.g. a
frozen-supplier pickup point, a cake decorator with studio collection only) cannot turn
delivery off, so buyers are always shown a delivery option the seller doesn't honour.

Goal: make delivery a first-class, optional fulfilment method symmetric with self-collect,
without ever letting a storefront end up with **no working way to receive an order**, and
guide sellers through the choice during onboarding.

## The core invariant

A storefront must **always have at least one _working_ fulfilment method**. "Working" is
not the same as "toggled on":

- **Delivery is working** when `offerDelivery` is on. (Zero-config — the buyer types an
  address; nothing for the seller to set up.)
- **Self-collect is working** when `offerSelfCollect` is on **AND** the retailer has **≥1
  active pickup location**.

Three actions must be rejected when they would leave **zero** working methods:

1. Turning **delivery off** while self-collect has no active locations →
   *"Add a pickup location before switching to pickup-only."*
2. Turning **self-collect off** while delivery is also off → blocked.
3. **Deactivating the last active pickup location** while delivery is off →
   *"Turn delivery back on or add another location first."*

Enforced **server-side** (source of truth) in `retailers.updateSettings` and
`pickupLocations.setActive`, and mirrored **client-side** as disabled-toggle-with-reason
so the seller sees *why* before clicking. The storefront also defends in depth (see §4).

## Default asymmetry (critical correctness point)

| Field | New retailer default | Legacy row (`undefined`) effective value | Reason |
|---|---|---|---|
| `offerSelfCollect` | `true` | `false` | Self-collect is opt-in; legacy rows never had it. |
| `offerDelivery` | `true` | **`true`** | Delivery has **always** been on for every existing retailer. Treating `undefined` as `false` would silently break every live storefront. |

Effective reads (use everywhere, never read the raw field for gating):

```ts
const offersDelivery = retailer.offerDelivery ?? true;
const offersSelfCollect = retailer.offerSelfCollect ?? false;
```

No data migration is required — the `?? true` fallback covers all existing rows.

## 1. Schema (`convex/schema.ts`)

Add to the `retailers` table, beside `offerSelfCollect`:

```ts
// Retailer opt-in for offering delivery at checkout. Mirror of offerSelfCollect,
// but with the OPPOSITE legacy default: undefined is treated as TRUE because every
// pre-existing retailer has always offered delivery. New retailers default to true
// (set in createRetailer). Effective read: offerDelivery ?? true.
offerDelivery: v.optional(v.boolean()),
```

No `orders` schema change — `deliveryMethod`, `deliveryAddress`, `pickupLocationId`,
`pickupSnapshot` already model both methods.

## 2. Backend

### `convex/retailers.ts`

- **`createRetailer`** — add `offerDelivery: true` to the insert.
- **`updateSettings`** — add `offerDelivery: v.optional(v.boolean())` to args and to the
  `patch` type. Before patching, compute the **effective post-change state** and enforce
  the invariant:
  - Resolve next delivery/self-collect from `args ?? current`.
  - Compute `selfCollectWorking = nextOfferSelfCollect && activeLocationCount > 0`
    (query `pickupLocations` `by_retailer_active`).
  - If `!nextOfferDelivery && !selfCollectWorking` → `throw new ConvexError(<reason>)`
    with the specific message for which toggle was being turned off.
- **`RetailerPublic`** mapper — surface `offerDelivery` (storefront checkout needs it).
  Keep surfacing `offerSelfCollect` as today.

### `convex/pickupLocations.ts`

- **`setActive`** — when deactivating (`isActive: false`): if this is the retailer's last
  active location **and** `offerDelivery ?? true` is `false`, reject with
  *"Turn delivery back on or add another location before hiding this one — your storefront
  would have no way to receive orders."* (Reactivating is always allowed.)

### `convex/orders.ts`

- **`create`** — reject a `deliveryMethod: "delivery"` order when the retailer does not
  offer delivery (`(retailer.offerDelivery ?? true) === false`). Legacy retailers are
  unaffected (effective `true`). The existing self-collect strict/legacy branch is
  unchanged. This closes the gap where a stale storefront tab could still POST a delivery
  order after the seller turned delivery off.

## 3. Settings — rename `Pickup` tab → `Fulfilment`

### `src/routes/app.settings.tsx`

- Rename the `"pickup"` tab value to `"fulfilment"` in the `SettingsTab` union, tab list,
  and search-param validator.
- **Back-compat:** accept `?tab=pickup` and normalise it to `fulfilment` so existing
  deep-links (dashboard checklist, docs, bookmarks) don't 404 or land on the default tab.

### `src/components/settings/pickup-locations-tab.tsx` → fulfilment tab body

- Add a **Delivery toggle card** above the existing self-collect toggle card. Wire both to
  the invariant: the toggle that would remove the last working method renders **disabled
  with an inline reason**; the mutation is still the server-side backstop.
- Keep the self-collect toggle card and the nested pickup-locations list as-is.
- Sharpen the existing amber warning: when self-collect is on with zero active locations
  **and** delivery is off, escalate the copy to *"Your storefront has no working way to
  receive orders — add a pickup location."*
- The "first visit dismisses the checklist step" behaviour (`markPickupSetupSeen`) stays;
  it now fires on the Fulfilment tab mount.

## 4. Storefront checkout (`src/components/storefront/checkout-sheet.tsx`)

Symmetric gating. Compute:

```ts
const deliveryAvailable = offerDelivery; // effective value drilled from RetailerPublic
const selfCollectAvailable = offerSelfCollect && pickupLocations.length > 0;
```

Render shapes:

- **Both available** → the two-button method picker (current behaviour). Default method
  `delivery`.
- **Delivery only** → no picker; the address form directly. Default method `delivery`.
- **Self-collect only** → no picker; the pickup picker directly (1 location → summary card,
  2+ → required radio list). Default method `self_collect`.
- **Neither available** (defence in depth — guards should prevent this) → no checkout form;
  a clear *"This store isn't accepting orders right now."* state. No broken empty picker,
  no `wa.me` link.

Drill `offerDelivery` through `$slug.tsx` → `CartBar` → `CheckoutSheet` alongside the
existing `offerSelfCollect`.

## 5. Onboarding checklist (`src/routes/app.index.tsx`)

Replace the optional **"Add a pickup location"** step with a **"Set up delivery & pickup"**
step:

- Title: **"Set up delivery & pickup"**, `optional: true` pill.
- Why copy: *"Delivery is on by default. Add self-collect points or switch to pickup-only."*
- Deep-link: `/app/settings?tab=fulfilment`.
- Done logic: `pickupSetupSeen || hasPickupLocation` (unchanged signal; reuse the existing
  `pickupSetupSeen` flag — the Fulfilment tab sets it on mount, so no migration and no
  re-nag for sellers who already visited).
- Visibility: show for every retailer (delivery is universal), not gated on
  `offerSelfCollect` like the old pickup step. This is the step that teaches a delivery-only
  seller that pickup-only is even possible.

## 6. Tests (Vitest + `convex-test`, matching existing `convex/*.test.ts` style)

### `convex/retailers.test.ts` (extend)

- `createRetailer` sets `offerDelivery: true`.
- Legacy retailer (`offerDelivery` undefined) reads as effectively offering delivery.
- `updateSettings` accepts `offerDelivery` and patches it.
- **Invariant rejections:**
  - delivery off + self-collect on but 0 active locations → rejects.
  - delivery off + self-collect off → rejects.
  - self-collect off while delivery on → allowed.
  - delivery off + self-collect on with ≥1 active location → allowed.

### `convex/pickupLocations.test.ts` (extend)

- `setActive(false)` on the last active location while delivery off → rejects.
- Same deactivation while delivery on → allowed.
- Deactivating a non-last location while delivery off → allowed.

### `convex/orders.test.ts` (extend)

- `create` with `deliveryMethod: "delivery"` when `offerDelivery: false` → rejects.
- Self-collect order still succeeds when delivery off (with an active location).
- Both-on path unchanged (regression guard).

UI stays `tsc` + manual end-to-end, consistent with the repo's "no React component tests"
convention (documented in `docs/pickup-locations.md` known limitations).

## 7. Docs

- **Rename `docs/pickup-locations.md` → `docs/fulfilment.md`**; broaden it to document the
  symmetric delivery/self-collect model, the default asymmetry, and the working-method
  invariant. Update the `docs/README.md` index and any cross-links.
- Update the **`CLAUDE.md` "Recently Shipped"** section with a one-line entry.

## Out of scope

- Delivery fee / zones / rates — delivery stays zero-config (buyer types address). Flag as
  future work if a seller asks.
- Per-product fulfilment eligibility (some products delivery-only, some pickup-only).
- Tier gating of fulfilment methods.

## Files touched (summary)

| File | Change |
|---|---|
| `convex/schema.ts` | `+ retailers.offerDelivery` |
| `convex/retailers.ts` | `createRetailer` default, `updateSettings` arg + invariant, `RetailerPublic` |
| `convex/pickupLocations.ts` | `setActive` last-location guard |
| `convex/orders.ts` | `create` rejects delivery order when delivery off |
| `src/routes/app.settings.tsx` | tab rename + `?tab=pickup` back-compat |
| `src/components/settings/pickup-locations-tab.tsx` | delivery toggle card + invariant UI |
| `src/routes/$slug.tsx`, `src/components/storefront/cart-bar.tsx` | drill `offerDelivery` |
| `src/components/storefront/checkout-sheet.tsx` | symmetric gating + render shapes |
| `src/routes/app.index.tsx` | checklist step rewrite |
| `convex/retailers.test.ts`, `convex/pickupLocations.test.ts`, `convex/orders.test.ts` | tests |
| `docs/pickup-locations.md` → `docs/fulfilment.md`, `docs/README.md`, `CLAUDE.md` | docs |
