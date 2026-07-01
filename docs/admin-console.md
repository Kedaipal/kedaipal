# Admin Console — Act-as Seller (White-Glove Onboarding)

Reference doc for the **admin "act-as seller" console** (ClickUp `86ey25er1`). It lets a
Kedaipal admin open any seller's dashboard and operate it **as the seller** — products,
variants, orders, customers, settings, fulfilment/pickup, and counter checkout — with every
write attributed to the admin. This is the tool the white-glove onboarding session for the
**Founding 10** actually runs in; without it an admin would have to borrow a seller's Clerk
login or screen-share, neither of which scales.

> **TL;DR of the design:** we did **not** fork a parallel admin UI. The normal `/app/*`
> dashboard is reused; an admin threads a `?actAs=<retailerId>` URL param that every screen
> reads via one hook, and the scattered owner-only access checks were centralised into a
> single **owner-OR-admin** gate. Every admin-on-behalf write drops an `adminAuditLog` row.

## The two halves

1. **Seller directory** — `/app/admin/sellers` (`src/routes/app.admin.sellers.tsx`). Lists
   every store (name, slug, owner, founding rank, subscription status), admin-gated
   server-side by `requireAdmin` and hidden client-side behind `billing.amIAdmin`. Sorted
   Founding Members first (by rank), then newest. "Manage" links to `/app?actAs=<retailerId>`.
2. **Act-as context** — selecting a seller renders the ordinary dashboard against that
   `retailerId`. All reads/writes target it; the admin identity is the actor on every write;
   a persistent **"Acting as {store} — admin"** banner shows across every screen with a
   one-tap **Exit**.

## Access model — one central gate

The old pattern was scattered owner-only checks (`retailer.userId !== identity.subject →
Forbidden`), duplicated across `products.ts`, `customers.ts`, `pickupLocations.ts`, and
inlined ~15× in `orders.ts`. These were centralised into **`convex/lib/auth.ts`**:

- **`requireRetailerAccess(ctx, retailerId) → { retailer, actingAsAdmin, userId }`** — the
  owner-OR-admin gate. Owner → `actingAsAdmin: false`; an allow-listed admin operating a
  store they don't own → `actingAsAdmin: true`; anyone else → throws `Forbidden` (same
  message the dashboard + tests already relied on, so a plain owner sees zero behaviour
  change). Read-safe (works in `QueryCtx` and `MutationCtx`).
- **`logAdminAction(ctx, access, action, targetId?)`** — writes one `adminAuditLog` row, but
  only when `access.actingAsAdmin`. A no-op for ordinary owner writes. Called after each
  admin-capable mutation so every white-glove edit is attributable to a person.

Admins are the same env allowlist as billing (`ADMIN_USER_IDS`, via `isAdmin` / `requireAdmin`
in `convex/lib/auth.ts`) — **not** a DB field, **not** a Clerk role (yet). The client
`amIAdmin` check is cosmetic; the real gate is always server-side.

### Subscription soft-lock bypass

White-glove happens **before** the seller has paid, so a store being onboarded is usually
`trialing` or `past_due`. Admin act-as writes therefore **bypass `assertSubscriptionActive`**
(gated on `!actingAsAdmin` at each call site). A seller's **own** writes are still blocked
when `past_due` — the bypass only ever applies to an admin acting on a store they don't own.

## Reads that had to learn "admin"

A few read paths gate visibility on ownership; they now also allow an admin:

- `products.get` — inactive variants (owner-only editor view) are shown to an acting admin.
- `orders.resolveSharedOrder` (seller `shortId` path) + `orders.getPaymentProofUrl` — an
  admin can open a seller's order detail / payment proof.
- `pickupLocations.getOwnedById`, `counterCheckout.getCheckoutSession` — same.

## Identity-derived writes → explicit-`retailerId` admin path

Most dashboard mutations already take an explicit `retailerId` arg, so the only backend
change there was the access-check swap. A handful resolved the retailer from
`identity.subject` (the caller's own store) and needed a dedicated admin path:

| Function | Admin path |
| --- | --- |
| `retailers.getMyRetailer` | **unchanged** (zero-arg). Act-as uses a separate `retailers.getRetailerForAdmin({ retailerId })`, which returns the payload with `actingAsAdmin: true`. Keeping them separate avoided churning ~40 test call sites and keeps the owner read a stable zero-arg query. |
| `retailers.updateSettings` | optional `retailerId` — when set, owner-or-admin on that store. |
| `retailers.renameSlug` | optional `retailerId` — same. |
| `counterCheckout.createCheckoutSession` / `listOpenSessions` | optional `retailerId`. |
| `counterCheckout.getCheckoutSession` / `saveSessionDraft` / `createOrderFromSession` / `cancelCheckoutSession` | session-id based → owner-or-admin on `session.retailerId` (no arg needed). |

**Not** changed (deliberately): `generateLogoUploadUrl` / `generatePaymentQrUploadUrl` /
`products.generateUploadUrl` mint a storage upload URL that isn't retailer-scoped — the
returned id is bound to a store later through the access-checked `updateSettings` /
`products.*`, so they need no admin path. The onboarding-checklist "seen" stamps
(`markPickupSetupSeen`, greeting, `ensureNotifyEmailFromIdentity`) still resolve by identity;
they're seller-activation niceties that harmlessly target the admin's own (or no) store when
acting-as and self-correct on the seller's next login. The email backfill is additionally
skipped client-side while acting-as.

### Counter Checkout note

A session opened by an admin still stamps `sellerUserId = retailer.userId` (the **seller's**
Clerk subject, never the admin's), so the inbound-webhook buyer binding and the buyer
confirmation resolve to the right store.

## Frontend threading

- **`useDashboardRetailer()`** (`src/hooks/useDashboardRetailer.ts`) — the single hook every
  `/app/*` screen calls instead of `useQuery(api.retailers.getMyRetailer)`. It reads
  `?actAs` from the URL and calls `getRetailerForAdmin` when set, `getMyRetailer` otherwise.
  `useActAsRetailerId()` exposes the raw id for the few mutations that need it threaded
  (`updateSettings`, `renameSlug`, counter checkout create/list).
- **`?actAs` persistence** — the `/app` route declares `retainSearchParams(["actAs"])`, so
  the param survives every in-dashboard navigation and a page refresh (it's URL-encoded, not
  in-memory) — an admin can't silently fall out of a store or edit the wrong one.
- **`ActingAsBanner`** (`src/components/admin/acting-as-banner.tsx`) — sticky, high-contrast
  amber bar rendered by the `/app` shell whenever `retailer.actingAsAdmin`. "Exit" drops
  `?actAs` and returns to the directory.
- **Sidebar** — an admin-only **"Sellers"** link (first in the admin group) points at the
  directory.
- **Redirect safety** — a stale/foreign `actAs` id (payload `null`) bounces back to the
  directory instead of onboarding.
- **Storeless admin mode** — an admin does **not** need a store of their own. When the
  signed-in admin has no store and isn't acting-as, the `/app` shell renders in **admin-only
  mode**: `Sidebar` / `MobileHeader` / `BottomNav` accept a `null` retailer and show just the
  admin nav (Sellers / Billing / WABA) + user menu — no seller nav, tier pill, or store
  banners. The shell redirects a storeless admin away from seller routes (`/app`, `/app/products`,
  …) to the directory, since those screens need a store; opening a seller via "Manage" (`?actAs`)
  brings the full seller shell back. Only a **non-admin** with no store is still sent to
  `/onboarding`. So an admin can choose never to set up a store and still run the console.

## Audit trail

`adminAuditLog` (schema): `{ adminUserId, retailerId, action, targetId?, ts }` with
`by_retailer` + `by_admin` indexes. One row per admin-on-behalf write; owner writes are never
logged. `admin.recentAuditForRetailer({ retailerId })` surfaces the recent rows (admin-only)
so white-glove edits are inspectable per store. Actions logged include `products.create/
update/saveVariantGrid/updateVariant/archive/bulkUpsert/reorder`, `customers.updateNotes/
updateName`, `pickupLocations.create/update/setActive/reorder`, `retailers.updateSettings/
renameSlug`, `orders.updateStatus/bulkUpdateStatus/advanceStage/setCarrierTrackingUrl/
confirmPayment/submitMockup/updateMockupQuote/waiveMockup`, and
`counterCheckout.createCheckoutSession/createOrderFromSession/cancelCheckoutSession`.

## Files

- `convex/lib/auth.ts` — `requireRetailerAccess`, `logAdminAction` (+ existing `isAdmin` /
  `requireAdmin`).
- `convex/admin.ts` — `listSellersForAdmin`, `recentAuditForRetailer`.
- `convex/schema.ts` — `adminAuditLog` table (dev-only widen; no migration).
- `convex/{products,customers,pickupLocations,orders,retailers,counterCheckout}.ts` —
  access-check swaps + audit stamps + explicit-`retailerId` admin paths.
- `src/routes/app.admin.sellers.tsx` — directory.
- `src/routes/app.tsx` — `?actAs` search param + `retainSearchParams` + banner + redirect
  guard + act-as-aware retailer resolution.
- `src/hooks/useDashboardRetailer.ts`, `src/components/admin/acting-as-banner.tsx`.
- `src/components/dashboard/{sidebar,mobile-header,bottom-nav}.tsx` — accept a `null` retailer
  for storeless-admin mode.
- `convex/admin.test.ts` — access, subscription bypass, audit, directory, counter-checkout.

## Deliberate scope / follow-ups

- Admin allowlist stays in `ADMIN_USER_IDS` env (graduates to a Clerk role later, same as
  billing).
- No seller-facing "changes made by Kedaipal" view yet — the audit log is admin-only. The
  `recentAuditForRetailer` read is the seam for that when we want it.
- PostHog funnel for act-as usage deferred.
