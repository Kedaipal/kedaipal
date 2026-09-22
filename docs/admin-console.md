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

1. **Seller directory** — `/app/admin/sellers` (`src/routes/app.admin.sellers.tsx`,
   redesigned in ClickUp `z8r3fdh37c`, 22 Sep 2026). Every store with the facts an
   admin used to open a second tab for: **owner contact** (login email, store
   WhatsApp — each with a one-tap copy and a `wa.me` link), **status with its
   reason** ("KP-0142 unpaid", "Comp upgrade turned off", "Auto-renew failed ×2 ·
   retry …", "Off-season since …"), **plan and rail** (cycle + how money arrives:
   auto-renew card, Pay-now link, free period, held, manual), and **expires /
   renews** worded per state — *Renews 14 Oct*, *Trial ends 28 Sep*, *Invoice due*,
   *Was due 3 Sep · 19 days overdue*, *Comp off 1 Sep · 21 days locked*, *Hold
   renews*, *Ended*, *No expiry* (comped), *— · Never billed* (admin) — amber inside
   a week, red once past. Admin-gated server-side by `requireAdmin` and hidden
   client-side behind `billing.amIAdmin`.
   - **Shape:** a table at `lg+` (`useIsDesktop`, a JS gate so a phone never
     carries 500 rows of hidden table DOM), cards below it — both render the
     same cells from `src/components/admin/seller-cells.tsx`, and every derived
     fact comes from one pure module, **`src/lib/admin-seller-view.ts`**
     (`sellerExpiry`, `sellerReason`, `sellerRail`, `sellerBucket`, the sorts,
     the search, the summary text, the CSV), so the table, the cards, the sheet
     and the export cannot disagree.
   - **Find:** search matches name, slug, email and both phones (a query with
     three or more digits is matched against the stored digits, so "018-7" finds
     `60187…`). **Status chips** (`FilterChip`, with counts) — All · Past due ·
     Trialing · Active · On hold · Cancelled · Comped · Admin (· No subscription,
     only when non-zero); Past due sits first after All because it is the urgent
     bucket. **Sort:** Founding rank (default, unchanged), Expiry · soonest first,
     Newest store, Name A–Z. Filter, sort and search ride the URL
     (`?status=past_due&sort=expiry&q=…`, validated by `validateSearch`) so a
     filtered view is a link; defaults are omitted so the plain route stays
     `/app/admin/sellers`.
   - **Detail sheet:** the store's name opens a read-only `Sheet side="right"`
     (a drawer beside the table at `sm+`, a bottom sheet on a phone —
     `src/components/admin/seller-sheet.tsx`) with every fact and its own copy
     control: login email, store and alerts WhatsApp, storefront link, country ·
     currency, status, plan, expiry (the date copies in full), free-period end
     and reason, open invoice, last paid invoice, auto-renew method, comp state
     and note, joined, signup source and referrer, founding rank, and **last
     opened by an admin** (`adminAuditLog` `actAs.sessionStart`). **Copy
     summary** writes a plain-text block — name, link, email, WhatsApp, plan,
     expiry — for a WhatsApp message. **Open store** in the sheet header is the
     same act-as door as the menu (`useOpenStore`).
   - **Export CSV** (header action) writes the *visible* rows with every sheet
     column (`sellersToCsv`, `downloadCsv`); disabled-with-reason when nothing
     matches. **Invite seller** links to the Billing page's onboard card
     (`/app/admin/billing#onboard`) — the form stays there because it needs the
     founding-spot count and the invoice picker beside it.
   - **One door per row** (owner decision, 20 Sep 2026): the **Manage menu**
     (`src/components/admin/seller-manage-menu.tsx`) holds every per-store action
     with its consequence written under it — **Open store** (starts the act-as
     session via `setActAs(id)` and opens `/app`), **View details** (the sheet),
     **comp upgrade** (`comp-dialog.tsx`), and **Delete store** (dev only; hidden
     entirely where the purge flag is off). The row itself is inert: the name
     opens the read-only sheet, the copy buttons copy, nothing on it enters
     act-as. The row used to BE the act-as button with two bare icons beside it
     — three targets, two unlabelled, and a mis-tap entered act-as.
   - **The query** (`admin.listSellersForAdmin`) grew the contact + billing
     fields: `ownerEmail` is `retailers.notifyEmail` (Clerk's identity email is
     never stored; `createRetailer` prefills it from Clerk and
     `ensureNotifyEmailFromIdentity` backfills), the two phones, country and
     currency, the subscription's cycle / trial end / free-period end /
     period end / cancelled / held / auto-renew dunning state, the **open
     invoice** and **last paid invoice** (`invoices.by_retailer`, first hit per
     status — never a collect over a store's billing history) and
     `lastActAsAt`. No schema change. Absent facts stay absent and the UI says
     so ("No email on file", "Never paid", "Never") rather than leaving a blank.
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
- **`logDestructiveAdminAction(ctx, access, action, targetId?)`** — same row, minus the
  ownership no-op: it records even when the admin **owns** the store. Reserved for
  irreversible erasures (today: `orders.hardDelete`, `orders.bulkDeleteOrders`). The no-op is
  the right default for ordinary edits — routine and recoverable — but a permanent record
  deletion must always answer "who did this?", and the deleted row isn't around to be asked.
  Both share one private inserter so the two policies can't drift. Use `logAdminAction`
  unless the write destroys data irreversibly. ClickUp `86eyhz189`.

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

### Plan-feature top tier (admin's own store)

The past-due soft-lock isn't the only gate — Pro-and-above **features** (CRM, Order Inbox,
categories, insights, chargeable pickup, radius delivery) are gated by plan via
`assertPlanFeature`. Admins get the **highest tier unlocked** here too, on **both** paths:

- **Server:** `assertPlanFeature(ctx, retailerId, feature)` **short-circuits for any admin**
  (`isAdmin(ctx)`), mirroring the soft-lock bypass. Act-as call sites already skipped it via
  `!actingAsAdmin`; this also covers **admin-on-own-store** (where `actingAsAdmin` is false).
- **Client:** the owner read (`getMyRetailer` → `loadRetailerForUser`) detects an admin owner and
  passes `adminFullAccess` into `resolveAccess(sub, { adminFullAccess })`, which forces
  `features` to the **highest tier**, caps to **no limits** (`fullAccessCaps()` — the same
  full-access definition a comped store resolves to) + `active`/`!frozen` while **keeping the real
  plan/status/trial** (so billing still tells the truth). `subscriptions.current` resolves the
  same way. So an admin's own dashboard never renders a Pro wall / locked control — regardless of
  what plan their own store sits on. The act-as read (`getRetailerForAdmin`) deliberately does
  **not** pass this, so white-glove sees the seller's real tier.

Without this, an admin whose own store happened to be on **Starter** would hit Pro upgrade walls +
blocked mutations — masked only while their store sits on a Pro trial.

**Chrome:** on an admin's **own** store (`isAdmin && !actingAsAdmin`), the nav tier pill reads a
distinct **"Admin"** badge (linking to the console, not billing) instead of a trial/past-due
countdown, and the `SubscriptionBanner` pay-nag is suppressed. The **mobile Settings index** (its
header pill + the Billing-row status subtitle) and the **Admin · Sellers directory** card
(`ownerIsAdmin` → an indigo "Admin" pill instead of the subscription status/plan) carry the same
treatment — every place a tier/plan would otherwise show for an admin's own store now reads
"Admin". **Settings → Billing** follows the same rule: the `BillingTab` swaps the Current-plan /
status / order-usage / renew apparatus for a plain **"Admin account"** note (admins have no trial,
tier or invoices) — so the tab never presents the admin as a Starter/Pro/Scale seller. While
**acting-as** a seller the chrome (banner + billing tab + directory row) shows that seller's
**real** subscription state — white-glove needs to see where they stand.

**Settings → Billing is VIEW-ONLY under act-as** (z8r3fdfty4; Zaki, 17 Sep
2026). It is the one settings tab an admin can't act in: billing is the
seller's money and consent, and every legitimate admin billing action (issue,
void, mark paid, comp) already lives in **Admin → Billing**, audited. Every
other settings tab keeps act-as edits.

- **Reads show the seller.** `invoices.myInvoices` and
  `subscriptionPayments.billingGatewayAvailable` take an optional
  `retailerId`, passed only while acting-as; omitted, they resolve the CALLER,
  which inside act-as is the admin's own store (that is how a founding seller's
  plan was priced at the admin's list rate beside the admin's invoices).
- **Writes are refused.** A "View-only billing" banner opens the tab, and every
  billing control renders disabled with a one-line reason: subscribe,
  auto-renewal on/off, plan change and its undo, the first-invoice switch, the
  Off-Season Hold switch, the annual request, "Pay online now", "I've paid —
  notify us" and the manual "Message us". Server-side the self-serve writes
  resolve the caller's own store, and `subscriptions.setSeasonalHold` — the one
  billing write that took `retailerId` — throws on `actingAsAdmin`. An admin on
  their OWN store is unaffected (the owner path).

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
- **`useUpdateSettings()`** (`src/hooks/useUpdateSettings.ts`) — the act-as-aware wrapper for
  `retailers.updateSettings`; it injects `actAsRetailerId` into every call. **Every settings
  write must use this hook, never a raw `useMutation(api.retailers.updateSettings)`** — the
  mutation resolves by identity when `retailerId` is omitted, so a raw call inside act-as
  silently writes to the **admin's own** store (the acted-as store then "reverts" on refresh).
  This bit in production: the Fulfilment tab's four extracted sections (method toggles,
  delivery charge/Lalamove keys, min-notice, min-order-value) each held a raw mutation and
  bypassed `app.settings.tsx`'s wrapper. Same posture for identity-resolved stamps: the tab's
  `markPickupSetupSeen` mount effect now skips under act-as (mirrors `markLinkShared` on
  `/app/poster`), since it would stamp the admin's checklist. Pinned by
  `fulfilment-tab.test.tsx` + `useUpdateSettings.test.tsx`.
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
- **Mobile admin nav** ([`86ey8r734`](https://app.clickup.com/t/86ey8r734)) — desktop has the
  always-visible Admin sidebar group, but on mobile an admin operating a store previously could
  only reach **one** admin page (via the "Admin" tier pill). Now: (1) the **mobile settings
  index** gains an "Admin" group with an **Admin console** row (the natural home for the entry),
  (2) the `BottomNav` swaps to the **admin tabs** whenever the admin is on an `/app/admin/*`
  route (`adminNav = !retailer || (isAdmin && onAdminRoute)`) so every admin page is reachable,
  and (3) that admin tab row **leads with an "App" tab back to `/app`** (only when the admin has
  a store) — the console is never a dead end. A storeless admin keeps the plain 3-tab admin nav
  (there's no seller app to go back to).
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
- `convex/admin.ts` — `listSellersForAdmin` (`ownerIsAdmin` per row), `recentAuditForRetailer`.
- `convex/schema.ts` — `adminAuditLog` table (dev-only widen; no migration).
- `convex/subscriptions.ts` — `assertPlanFeature` admin bypass; `resolveAccess(sub,
  { adminFullAccess })` highest-tier override.
- `convex/{products,customers,pickupLocations,orders,retailers,counterCheckout}.ts` —
  access-check swaps + audit stamps + explicit-`retailerId` admin paths; `retailers.ts` owner read
  threads `adminFullAccess`.
- `src/routes/app.admin.sellers.tsx` — directory ("Manage" starts the session); `ownerIsAdmin` →
  "Admin" pill.
- `src/routes/app.settings.tsx` — mobile settings index pill + Billing subtitle read "Admin" for
  an admin's own store.
- `src/routes/app.tsx` — `ActAsProvider` wrap + banner + redirect guard + storeless-admin mode
  + act-as-aware retailer resolution.
- `src/hooks/useActAs.tsx` — the session (context + `sessionStorage`).
- `src/hooks/useDashboardRetailer.ts`, `src/components/admin/acting-as-banner.tsx`.
- `src/components/dashboard/{sidebar,mobile-header,bottom-nav}.tsx` — accept a `null` retailer
  for storeless-admin mode; sidebar's Admin group ends the session.
- `convex/admin.test.ts` — access, subscription bypass, audit, directory, counter-checkout.

## Comp accounts (z8r3fdeub2)

The sellers directory is also where a store gets the **comp upgrade** — a
toggle for partner/sponsor/pilot/internal deals. While it's on, the store gets
exactly what an admin's own store gets (every feature, no limits, never billed —
the same `FULL_ACCESS_PLAN` / `fullAccessCaps()` resolution) minus admin
access, and the seller can't subscribe, change plan, pause or cancel. **It has
no end date**: it stays on until an admin turns it off.

The Manage menu's comp item opens one dialog. It states the toggle's
position up front ("Off", or "On · since {date}") and is the single surface to
**turn it on** (kind, seller-facing label, admin-only note), **edit** those
details while it's on (who/when first turned it on is kept), and **turn it
off** behind its own confirm, which names the consequence: the store becomes an
**expired seller** straight away — storefront live, buyers still ordering,
the dashboard view-only until the seller picks a plan and pays (no free
period) — and the seller is emailed. Comped rows show a violet chip (kind · label; since-when and
the note on hover); a store whose comp was turned off shows a muted
"Comp off · {date}" chip beside its past-due status, so nobody chases an invoice
that doesn't exist. Admin-owned rows keep the comp item visible but disabled,
with the reason as its own subtitle ("Admin store — always free already") —
a disabled menu row can't show a hover title, so the reason sits in the row.

Both mutations (`subscriptions.setComp` / `revokeComp`) are
`requireAdmin`-gated and **always** write an `adminAuditLog` row
(`subscriptions.setComp` / `.revokeComp`, targetId = the retailer, by the admin
who made that write) — a billing-state change is never untraced, and the act-as
no-op doesn't apply because an admin's own store can't be comped. **Note for
testing:** turning a comp off while acting-as a store won't show you the lock —
admins bypass `assertSubscriptionActive` — so the view-only refusal (every
seller action, orders included) is only visible to the seller's own login. Full lifecycle, edge cases and the "never
charged" guarantees: [`manual-subscription.md`](./manual-subscription.md#comp-accounts--admin-granted-free-access-sep-2026-clickup-z8r3fdeub2).

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

## Dev-only store purge (z8r3fdbmc9)

A per-row trash control on `/app/admin/sellers` that erases a test store back
to nothing so its Clerk login onboards fresh — the test-reset for the
onboarding/country flows. Not a new deletion path: `admin.purgeStoreForAdmin`
schedules the existing PDPA erasure cascade (`internal.retailers.deleteUser` →
`runDeletionPhase`, every phase, self-chaining), so it can never drift from
what account deletion erases. The Clerk USER survives — after the cascade
`getMyRetailer` is null and `/onboarding` treats the login as brand-new.
Erasure is asynchronous; the directory row disappears when the retailer doc
goes in the final phase.

**Gating, fail-closed at every layer:**

1. `requireAdmin` (the env allowlist).
2. `devStorePurgeAllowed()` — TWO independent guards: a hard deny when
   `CONVEX_CLOUD_URL` names the production deployment (beats any flag), and an
   explicit `DEV_STORE_PURGE_ENABLED=true|1` opt-in that prod simply never
   sets. Absent/junk values read as OFF. Each guard is mutation-tested alone.
3. The caller must echo the store's **slug** (`confirmSlug`) — the client
   confirm dialog types it (`ConfirmDialog confirmPhrase`), the server
   re-checks it, so a wrong-row misfire is refused on both sides.

The button only renders when `admin.devStorePurgeEnabled` says so (cosmetic —
the mutation re-checks). The purge is audited via `logDestructiveAdminAction`
(`admin.purgeStore`, recorded even on an admin's own store — the 86eyhz189
rule), and the audit row outlives the tenant because the cascade retains
`adminAuditLog` by decision.

**In-flight lock:** the purge stamps `retailers.purgeStartedAt` before
scheduling the cascade. While it's set (and younger than the 10-minute retry
window), the directory row shows "Deleting…" in place of its Manage menu,
`startActAsSession` refuses the store, and a second purge is
rejected — no session can touch a store mid-erase. The stamp is never cleared
on success (the row itself is the cascade's final delete); a stamp older than
the window means a crashed cascade, and re-running the purge is the recovery
(every phase is idempotent).

**Env:** `DEV_STORE_PURGE_ENABLED` is set on the dev deployment only. It is
deliberately NOT in any prod checklist — never set it there; the prod
deny-list exists precisely for the day someone does.

**Expected log noise:** if any session still has the purged store's dashboard
open, the moment the retailer row goes you'll see a burst of uncaught
`Retailer not found` / `No store found for this account` query errors — live
subscriptions re-running against a store that no longer exists and hitting the
`requireRetailerAccess` guard, which is doing its job. One burst, then the
client sees `getMyRetailer` go null and lands on onboarding. Deliberately NOT
fail-softed: silencing it would weaken the access seam across every dashboard
query for a few seconds of dev log noise.

**Trap found on first use:** the erasure cascade itself had a latent crash —
two phases paginate and Convex allows one `.paginate()` per mutation, so a
small tenant stalled mid-erase. Fixed in the driver (see
`docs/account-deletion.md`, "one paginate per invocation").
