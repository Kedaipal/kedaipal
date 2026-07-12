# Admin Console — Act-as Seller (White-Glove Onboarding)

Reference doc for the **admin "act-as seller" console** (ClickUp `86ey25er1`). It lets a
Kedaipal admin open any seller's dashboard and operate it **as the seller** — products,
variants, orders, customers, settings, fulfilment/pickup, and counter checkout — with every
write attributed to the admin. This is the tool the white-glove onboarding session for the
**Founding 10** actually runs in; without it an admin would have to borrow a seller's Clerk
login or screen-share, neither of which scales.

> **TL;DR of the design:** we did **not** fork a parallel admin UI. The normal `/app/*`
> dashboard is reused; the "act-as" target is held in a **persistent client session**
> (`useActAs` context, mirrored to `sessionStorage`) that every screen reads via one hook, and
> the scattered owner-only access checks were centralised into a single **owner-OR-admin**
> gate. Every admin-on-behalf write drops an `adminAuditLog` row.
>
> **Why a session, not a URL param:** the first cut threaded `?actAs=<id>` through the URL.
> That's fragile — every `<Link>` and every programmatic `navigate()` / post-CRUD redirect has
> to remember to carry the param, and any one that forgets silently drops the admin back into
> their own store. A session held in context holds across **all** navigation, every CRUD
> action, and a refresh, until the admin explicitly Exits — nothing has to thread anything.

## The two halves

1. **Seller directory** — `/app/admin/sellers` (`src/routes/app.admin.sellers.tsx`). Lists
   every store (name, slug, owner, founding rank, subscription status), admin-gated
   server-side by `requireAdmin` and hidden client-side behind `billing.amIAdmin`. Sorted
   Founding Members first (by rank), then newest. "Manage" starts the act-as session
   (`setActAs(id)`) and opens `/app`.
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

`assertSubscriptionActive(ctx, retailerId)` **short-circuits for any admin** (`isAdmin(ctx)`,
the `ADMIN_USER_IDS` allowlist) before it ever checks `frozen`. So a Kedaipal admin is never
soft-locked, on **either** path:

- **Act-as** — white-glove happens before the seller has paid, so a store being onboarded is
  usually `trialing` or `past_due`. (Call sites also still guard on `!actingAsAdmin`, now
  belt-and-suspenders with the central admin check.)
- **Own store** — an admin dogfooding their own store runs the app **for free, forever**; past
  the 14-day trial the cron still flips their sub to `past_due` in the data (it's identity-blind),
  but the gate ignores it. Identity-based, so it self-heals from the allowlist — no `comped`
  data to backfill or drift.

A **plain seller's own** `past_due` writes stay blocked — the bypass only ever applies to admins.

**Chrome:** on an admin's **own** store (`isAdmin && !actingAsAdmin`), the nav tier pill reads a
distinct **"Admin"** badge (linking to the console, not billing) instead of a trial/past-due
countdown, and the `SubscriptionBanner` pay-nag is suppressed. **Settings → Billing** follows the
same rule: the `BillingTab` swaps the Current-plan / status / order-usage / renew apparatus for a
plain **"Admin account"** note (admins have no trial, tier or invoices) — so the tab never presents
the admin as a Starter/Pro/Scale seller. While **acting-as** a seller the chrome (banner + billing
tab) shows that seller's **real** subscription state — white-glove needs to see where they stand.

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

## Frontend: the act-as session

- **`useActAs()`** (`src/hooks/useActAs.tsx`) — the `ActAsProvider` (wrapping the whole `/app`
  subtree) holds `actAsRetailerId` in React state mirrored to `sessionStorage`. `setActAs(id)`
  enters a store; `setActAs(undefined)` exits. Because it's a session (not a URL param), it
  holds across **every** navigation, CRUD redirect, and refresh with zero per-link threading —
  the class of bug that plagued the URL-param approach can't happen. Per-tab, so two tabs can
  operate two different stores. `useActAsRetailerId()` is the raw reader for the few mutations
  that must pass an explicit `retailerId` (`updateSettings`, `renameSlug`, counter-checkout
  create/list).
- **`useDashboardRetailer()`** (`src/hooks/useDashboardRetailer.ts`) — the single hook every
  `/app/*` screen calls instead of `useQuery(api.retailers.getMyRetailer)`. When a session is
  active it calls `getRetailerForAdmin`, otherwise `getMyRetailer`.
- **`ActingAsBanner`** (`src/components/admin/acting-as-banner.tsx`) — sticky, high-contrast
  amber bar rendered by the `/app` shell whenever `retailer.actingAsAdmin`. "Exit" calls
  `setActAs(undefined)` and returns to the directory.
- **Nav grouping** — the sidebar shows the **seller nav** (operating the vendor) and a
  separate, labelled **"Admin"** group (All sellers / Billing / WABA Safety), so the boundary
  is unmistakable while acting-as. Seller nav needs no special handling (the session holds
  globally); the admin-group links **end the session** (`setActAs(undefined)`), since they
  leave the vendor-operation view.
- **Redirect safety** — an active session whose store resolves `null` (stale/foreign id)
  clears the session and returns to the directory.
- **Storeless admin mode** — an admin does **not** need a store of their own. When the
  signed-in admin has no store and no active session, the `/app` shell renders in **admin-only
  mode**: `Sidebar` / `MobileHeader` / `BottomNav` accept a `null` retailer and show just the
  admin nav + user menu — no seller nav, tier pill, or store banners. The shell redirects a
  storeless admin away from seller routes (`/app`, `/app/products`, …) to the directory, since
  those screens need a store; "Manage" starts a session and brings the full seller shell back.
  Only a **non-admin** with no store is still sent to `/onboarding`. So an admin can choose
  never to set up a store and still run the console.

## Audit trail

`adminAuditLog` (schema): `{ adminUserId, retailerId, action, targetId?, ts }` with
`by_retailer` + `by_admin` indexes. `admin.recentAuditForRetailer({ retailerId })` surfaces the
recent rows (admin-only) so white-glove activity is inspectable per store.

**Write trail** — one row per admin-on-behalf write (owner writes are never logged). Actions
include `products.create/update/saveVariantGrid/updateVariant/archive/bulkUpsert/reorder`,
`customers.updateNotes/updateName`, `pickupLocations.create/update/setActive/reorder`,
`retailers.updateSettings/renameSlug`, `orders.updateStatus/bulkUpdateStatus/advanceStage/
setCarrierTrackingUrl/confirmPayment/submitMockup/updateMockupQuote/waiveMockup/hardDelete/
bulkDeleteOrders`, and
`counterCheckout.createCheckoutSession/createOrderFromSession/cancelCheckoutSession`.

**Read/entry trail** — individual act-as *reads* (order history, customer PII, payment proofs,
bank/subscription details) are intentionally not logged per-read, but **tenant ENTRY is**:
`admin.startActAsSession({ retailerId })` writes an `actAs.sessionStart` row, fired by the
directory's "Manage" action (Convex queries can't write, so entry is logged on the mutation at
session start, not inside `getRetailerForAdmin`). This answers "who at Kedaipal opened my store,
and when?" — the governance gap a pure write-only trail would leave for a platform holding
customer PII + seller financials. A capture of *why* (reason/consent on entry, like the WABA
pause flow) is a sensible next step but not yet implemented.

## Files

- `convex/lib/auth.ts` — `requireRetailerAccess`, `logAdminAction` (+ existing `isAdmin` /
  `requireAdmin`).
- `convex/admin.ts` — `listSellersForAdmin`, `recentAuditForRetailer`.
- `convex/schema.ts` — `adminAuditLog` table (dev-only widen; no migration).
- `convex/{products,customers,pickupLocations,orders,retailers,counterCheckout}.ts` —
  access-check swaps + audit stamps + explicit-`retailerId` admin paths.
- `src/routes/app.admin.sellers.tsx` — directory ("Manage" starts the session).
- `src/routes/app.tsx` — `ActAsProvider` wrap + banner + redirect guard + storeless-admin mode
  + act-as-aware retailer resolution.
- `src/hooks/useActAs.tsx` — the session (context + `sessionStorage`).
- `src/hooks/useDashboardRetailer.ts`, `src/components/admin/acting-as-banner.tsx`.
- `src/components/dashboard/{sidebar,mobile-header,bottom-nav}.tsx` — accept a `null` retailer
  for storeless-admin mode; sidebar's Admin group ends the session.
- `convex/admin.test.ts` — access, subscription bypass, audit, directory, counter-checkout.

## Deliberate scope / follow-ups

- Admin allowlist stays in `ADMIN_USER_IDS` env (graduates to a Clerk role later, same as
  billing).
- No seller-facing "changes made by Kedaipal" view yet — the audit log is admin-only. The
  `recentAuditForRetailer` read is the seam for that when we want it.
- **Reason/consent on session start** — `startActAsSession` logs the entry but not *why*.
  Capturing a short reason (mirroring the WABA pause flow) would strengthen the audit story;
  deferred as it adds entry friction.
- Individual act-as reads aren't logged per-read (only tenant entry is) — a per-read trail is
  possible later if compliance requires it, but is high-volume/low-signal for now.
- PostHog funnel for act-as usage deferred.
