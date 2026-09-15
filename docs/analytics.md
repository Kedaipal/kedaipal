# Analytics

**Status: implemented.** Client-side web analytics for the whole app —
storefront _and_ the seller dashboard. Two independent, env-gated providers,
each booted once from a hook mounted in the root document. Both no-op unless
their project/measurement ID env var is set, so local dev and preview builds
never pollute the production analytics.

| Tool                  | What it's for                          | Package         | Hook                                                 | Env var                   |
| --------------------- | -------------------------------------- | --------------- | ---------------------------------------------------- | ------------------------- |
| Google Analytics 4    | Pageviews, traffic, acquisition        | `react-ga4`     | [`useGoogleAnalytics`](../src/hooks/useGoogleAnalytics.ts) | `VITE_GA_MEASUREMENT_ID`  |
| Microsoft Clarity     | Session replays + heatmaps (UX/friction), funnel Smart events | `@microsoft/clarity` | [`useClarity`](../src/hooks/useClarity.ts)      | `VITE_CLARITY_PROJECT_ID` |

Both hooks are called in `RootDocument` ([`src/routes/__root.tsx`](../src/routes/__root.tsx)),
so analytics load on every route (storefront + `/app`) **except the
capability-token routes `/track/*` and `/claim/*`, which neither provider ever
observes** — see Privacy §1. ClickUp `86eyb7021` (Clarity), `86eyn25fk` (GA
tracking-token exclusion), PR #227 review (`/claim`).

## Why the npm package, not a `<script>` snippet

Clarity's dashboard offers a raw `<script>` tag, but we use the official
`@microsoft/clarity` package instead — matching the existing GA setup
(`react-ga4`). This keeps the project ID **env-driven** (no ID hardcoded into
committed HTML, and dev/preview stay out of the Clarity project by default),
runs on the client via `useEffect` so it's SSR-safe under TanStack Start, and
exposes a typed API (`identify`, `setTag`, `event`) if we later want to tag
sessions by seller or plan.

## How it works

`useClarity` initializes Clarity exactly once per page load through
`ensureClarityInitialized` in
[`src/lib/clarity-events.ts`](../src/lib/clarity-events.ts):

```ts
const projectId = clientEnv.VITE_CLARITY_PROJECT_ID;
if (!projectId) return false;
if (isCapabilityTokenPath(pathname)) return false;
if (!clarityInitialized) { Clarity.init(projectId); clarityInitialized = true; }
return true;
```

Unlike GA — where `useGoogleAnalytics` fires a pageview on every pathname change
— Clarity needs no per-navigation call: after `init` it hooks the History API
and tracks SPA route changes itself. The pathname is read only to decide whether
booting is allowed at all. The module-level `clarityInitialized` guard mirrors
GA's `gaInitialized` and lives in the events module for the same reason GA's
lives in `ga-events.ts`, not the hook: child-route effects run before the root
document's effect, so a route firing `land_marketing` on mount must be able to
boot the library itself. The guard means a remount can't double-boot it (the
hook test covers unmount → remount specifically; a plain re-render passes with
or without the guard, so it proves nothing).

## GA4 funnel events + seller-acquisition `src` (z8r3fdd1v0)

GA4 fires more than pageviews: the acquisition funnel emits custom events via
[`src/lib/ga-events.ts`](../src/lib/ga-events.ts) (`trackEvent` — no-ops
without a measurement ID and on capability-token paths, never throws). The
init flag lives there too, shared with `useGoogleAnalytics`, so whichever
fires first boots the library exactly once (child-route effects run before the
root's pageview effect).

| Event | Fires | Where |
| --- | --- | --- |
| `land_marketing` | once per page load, first marketing-route mount | `/`, `/pricing`, `/cost` via [`useMarketingLanding`](../src/hooks/useMarketingLanding.ts) |
| `view_pricing` | every `/pricing` mount | `pricing.tsx` |
| `calc_used` | first calculator input change per visit | `cost.tsx` (`syncToUrl` choke point) |
| `cta_signup_click` | every signup CTA click, `placement` param (`nav`, `nav-mobile`, `hero`, `hero-secondary (retired 13 Sep 2026 with the hero's secondary link — landing v2)`, `final-cta`, `pricing-teaser-<tier>`, `pricing-card-<tier>`, `pricing-bottom`) | landing components + `pricing.tsx` via `trackSignupCta` |
| `onboarding_start` | signed-in seller reaches the store-creation form AND the retailer query resolved to "no store yet" — an already-onboarded seller hitting `/onboarding` gets redirected, never counted | `onboarding.tsx` via [`useOnboardingStart`](../src/hooks/useOnboardingStart.ts) |
| `store_created` | `createRetailer` succeeded (never on validation failure) | `onboarding.tsx` |

**Every event auto-carries the `src` param** when the session arrived tagged:
[`src/lib/marketing-attribution.ts`](../src/lib/marketing-attribution.ts)
captures `?src=`/`utm_source` on the marketing routes (and `/onboarding`) into
sessionStorage — the seller-side sibling of the buyer-side storefront capture
(`docs/source-attribution.md`), same sanitizer, same last-touch rule, its own
storage key. sessionStorage (not the URL) because the funnel crosses the Clerk
sign-up redirect, which mangles multi-param queries (see `onboarding-link.ts`).
At `createRetailer` the tag is re-sanitized server-side and stamped onto
**`retailers.signupSource`** (absent = untagged/direct — the
`orders.attributionSource` posture), surfaced as a "via `<tag>`" pill in the
admin sellers directory.

**Naming convention** for tags Kedaipal itself emits: `powered-by` (the
storefront badge — renamed from `storefront_badge`) and its per-surface
siblings `powered-by-track` / `powered-by-claim` / `powered-by-receipt` (one
author, `convex/lib/poweredBy.ts` — see
[`powered-by-badge.md`](./powered-by-badge.md)), `spotlight-<member>`,
`referral-<member>`, `tiktok-live`, `directory`, `qr-poster`. Free-form tags
sanitize and store verbatim.

**The badge also names its store (z8r3fdcwd0):** `?store=<slug>` is captured
beside the tag (same last-touch rule, its own key — the pair is rewritten
together, so a later tagged hit without `store=` clears a stale referrer),
rides every funnel event as `ref_store`, and lands as
**`retailers.signupReferrerId`** — the slug resolved to a store id at
`createRetailer`, dropped when it names no store. The admin pill reads
`via powered-by-track · /<referrer-slug>`. Register `ref_store` as a GA4 custom
dimension to report on it; the param is sent either way.

**Operator step (GA4 UI, once per property):** mark `onboarding_start` and
`store_created` as **key events** (Admin → Events → toggle "Mark as key
event") so funnel/conversion reports treat them as conversions. Events appear
in DebugView immediately; standard reports lag ~24h.

## Clarity Smart events + the weekly review ritual (z8r3fdd1v2)

GA4 says *where* the funnel leaks; Clarity says *why* (the recording). To make
the two line up, **`trackEvent` is the funnel's single emitter and fans out to
both providers**: GA4 gets the event + params as above, and
[`trackClarityEvent`](../src/lib/clarity-events.ts) mirrors the bare event
name as a Clarity **Smart event** — the same six names, so a session that
shows `cta_signup_click` in GA is filterable by `cta_signup_click` in the
Clarity Recordings view. Each provider is gated on its own env var, so an
unset GA never silences Clarity or vice-versa; call sites know nothing about
providers.

Two extras ride the mirror:

- **`Clarity.upgrade("signup-cta")` on `cta_signup_click`.** Clarity
  prioritises upgraded sessions for full recording, so the exact sessions the
  ritual below wants to watch are never sampled away.
- **`Clarity.setTag("src", <tag>)`** when the session arrived with a marketing
  `src` (same capture as GA, `marketing-attribution.ts`), so recordings and
  heatmaps segment by acquisition channel the way the GA funnel does.

The mirror inherits the capability-token gate (Privacy §1) and the
never-throws posture: every Clarity API call is `window.clarity(...)`, which
does not exist until `init` injected the script, so an unbooted call would
throw — the boot check and the `try/catch` are both load-bearing.

### Weekly review ritual

**Owner: Arif. Cadence: weekly, Monday.** Done criterion per review: one
landing-page change picked and handed to Kris. Kill criterion: two consecutive
reviews that yield nothing → drop to fortnightly and say so here.

1. **Heatmaps** — [Clarity](https://clarity.microsoft.com) project
   `xoduz9wjl5` → Heatmaps → `/` then `/pricing`, click + scroll maps, last
   7 days. Note where the fold lands relative to the primary CTA and any
   dead-click cluster (clicks on things that aren't links).
2. **Recordings** — Recordings → Filters → *Smart events* →
   `cta_signup_click`. Skip any session whose event list also shows
   `onboarding_start` (they got through). Sort the rest by rage clicks, then
   dead clicks, then duration; watch the 3 worst and write one line each:
   what they tried, where it broke.
3. **Hand-off** — post the lines and the one change picked as a comment on the
   ticket and on the landing-page pass task for Kris.

Smart events appear in the Filters list within minutes of the first click after
a deploy; Clarity's own auto-detected events (rage/dead/quick-back) need no
code.

## Server-side key events (z8r3fdd1v1)

Activation = the retailer's first REAL order reaching confirmed, and
subscription revenue lands at admin mark-paid — both happen in **Convex**,
usually while the seller's browser is closed, so no client event can observe
them. Two server events extend the funnel past `store_created` via the GA4
**Measurement Protocol** (server → GA4 HTTPS POST):

| Event | Fires | Scheduled from |
| --- | --- | --- |
| `first_order` | ONCE per retailer ever — the moment `retailers.activatedAt` transitions unset → set (the existing write-once activation stamp IS the dedupe guard; all 8 confirm sites go through it) | [`stampRetailerActivation`](../convex/lib/activation.ts) |
| `subscribe_paid` | every `invoices.markPaid` — renewals too, distinguished by `first_time`; carries `plan`, `cycle`, `value` (major units) + `currency` so revenue segments by channel | [`invoices.markPaid`](../convex/invoices.ts) |

Both carry the retailer's stored **`src`** (`retailers.signupSource`), so the
whole funnel — `land_marketing → … → store_created → first_order →
subscribe_paid` — segments by acquisition channel end to end.

**Delivery contract:** mutations schedule
[`internal.ga4Events.sendKeyEvent`](../convex/ga4Events.ts) fire-and-forget
(`ctx.scheduler.runAfter(0, …)` — transactional, so nothing fires on
rollback); the action no-ops without env config and swallows every network
failure. **Analytics can never block or roll back an order or a payment.**
The pure payload builder + server event catalog live in
[`convex/lib/ga4.ts`](../convex/lib/ga4.ts) — a deliberately separate catalog
from the client's `FunnelEvent` (the client module boots react-ga4 and reads
sessionStorage; a Convex action can't import it).

**Funnel stitching — `retailers.gaClientId`:** MP events only join the
client-side journey in Funnel Exploration when they carry the SAME
`client_id` GA assigned in the browser. The onboarding submit reads the `_ga`
cookie (`readGaClientId` in `ga-events.ts`, parser shared with the server in
`ga4.ts`) and `createRetailer` stores it — wire-format validated
(`^\d+\.\d+$`), garbage dropped. When absent (ad-blocker, GA unbooted) the
emitter falls back to a **synthetic id** derived from the retailer id:
events still count and segment by `src`, but won't stitch to that browser's
funnel. Known GA4 limitation either way: MP events carry no `session_id`, so
they show in user-scoped explorations and key-event counts but can read as
"unassigned" in some session-scoped standard reports.

**Convex env vars (prod deployment — release-checklist items):**

| Var | Value |
| --- | --- |
| `GA4_MEASUREMENT_ID` | The same `G-…` id as `VITE_GA_MEASUREMENT_ID` |
| `GA4_MP_API_SECRET` | GA4 UI → Admin → Data streams → *stream* → Measurement Protocol API secrets → Create |

Both unset (local dev, preview) → the action is a silent no-op, same posture
as the client providers.

**Operator steps (GA4 UI, once per property):** create the MP API secret
(above), set both Convex env vars, then mark `first_order` and
`subscribe_paid` as **key events** (Admin → Events). Verify with a test
retailer's first confirmed order in Realtime/DebugView (server events appear
within minutes), then check Funnel Exploration segments by `src`.

## Configuration

- **Local:** copy the `VITE_CLARITY_PROJECT_ID` line from `.env.local.example`
  into `.env.local`. Leave it blank to keep local traffic out of Clarity; set it
  to `xoduz9wjl5` (the Kedaipal project) only if you want to test the boot.
- **Production:** `VITE_` vars are baked at build time. The build step in
  [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) reads
  `VITE_CLARITY_PROJECT_ID` from the GitHub Actions **`prod` environment
  variables** (same as `VITE_GA_MEASUREMENT_ID`). Add `VITE_CLARITY_PROJECT_ID =
  xoduz9wjl5` there (Settings → Environments → prod → variables) or prod builds
  ship without Clarity.

The Clarity project ID is not a secret — it's embedded in the shipped client
HTML on every page — so it lives in a plaintext repo variable, not a secret.

## Privacy

Session replay is materially more invasive than pageview analytics — it ships a
reconstruction of the rendered page to a third party. Three controls, all in the
repo rather than behind a dashboard toggle:

### 1. Capability-token routes never reach either provider

[`isCapabilityTokenPath`](../src/lib/analytics-privacy.ts) is the single
predicate both providers share: `useClarity` refuses to boot on them,
`useGoogleAnalytics` neither initializes nor sends a pageview there, and the
funnel emitters (`trackEvent` / `trackClarityEvent`) no-op there too. Masking
governs DOM content, not the **observed page address**, and these URLs *are*
the secret:

| Route | What the token in the URL grants, with no auth |
| --- | --- |
| `/track/<token>` | Read the order, claim payment, edit the delivery address/phone (see CLAUDE.md). |
| `/claim/<token>` | Read the buyer's name/phone and the frozen lines, **and commit**: `orderClaims.commit` creates a real order and decrements the seller's stock. |

Recording either would export the secret to Microsoft/Google and to anyone with
either dashboard's access — for Clarity, alongside a session replay of the
buyer's checkout.

**Any new buyer route with a token in its path belongs in that predicate.**
`/claim` shipped guarded against Clerk (`BUYER_ROUTE_IDS`) but not against
analytics; the two lists cover the same class of route and are worth changing
together.

For GA specifically, full exclusion beats redacting the sent path: gtag
auto-collects the real `page_location` from the browser on every hit once the
library is loaded, so a redacted manual pageview would still leak the URL. The
library simply never loads on token pages; a buyer who navigates from /track
into the storefront boots GA on that first non-token pathname.

**Ops note (GA property setting, not repo):** keep GA4 Enhanced Measurement's
"Page changes based on browser history events" OFF — if enabled, gtag fires
its own page_view with the full URL on SPA navigations, bypassing the hook.
No client-side link navigates into `/track` or `/claim` today, so this is
defence in depth, not a live hole.

Nothing links to either route client-side (buyers arrive from a WhatsApp link,
i.e. a fresh document load), so the exclusion is complete rather than
best-effort.

### 2. PII regions are masked in markup

**Clarity's default masking mode is Balanced, which masks only numbers, email
addresses, and `input`/`select` contents.** All other *rendered* text is
captured — so buyer names, the non-numeric parts of delivery addresses, order
notes, and the seller's private customer notes would otherwise be recorded
verbatim.

Regions rendering that data carry `data-clarity-mask="true"` via the shared
[`MASK_PII`](../src/lib/analytics-privacy.ts) spread, which overrides the
dashboard setting for that subtree:

| Surface | File |
| --- | --- |
| Customer list — mobile cards | `src/components/dashboard/customer-card.tsx` |
| Customer list — desktop table | `src/components/dashboard/customer-list.tsx` |
| Customer detail (name, phone, notes) | `src/components/dashboard/customer-detail.tsx` |
| Customer detail route header (name in PageHeader + mobile h2) | `src/routes/app.customers.$customerId.tsx` |
| Delivery address + notes (order detail *and* tracking page) | `src/components/storefront/delivery-address-display.tsx` |
| Order detail — buyer note / reference photo, customer + CRM block, push-failed card (phone), mockup change note, notify-manager message | `src/routes/app.orders.$shortId.tsx` |
| Orders inbox — buyer name on every card | `src/routes/app.orders.index.tsx` |
| Home — recent-orders buyer names | `src/routes/app.index.tsx` |
| Counter — open-sessions list, both BuyerCard branches, 3 dialog descriptions | `src/routes/app.checkout.tsx` |
| Done screen — download/share button labels + helper copy | `src/components/order/order-document-actions.tsx` |
| Lalamove rider name/plate (third-party PII) | `src/components/order/book-delivery-card.tsx` |
| Pickup-point manager name + phone (third-party PII) | `src/components/settings/fulfilment-tab.tsx` |
| Storefront checkout — the phone-echo line (the one rendered-text PII on the storefront; inputs are auto-masked) | `src/components/storefront/checkout-form.tsx` |

`grep -rn MASK_PII src` audits coverage, and
`src/lib/analytics-privacy.test.tsx` **pins a minimum spread count per file**
— deleting a mask goes red, and a new PII surface must be added to that table.
**Any new surface that renders a customer's name, phone, address, or notes
must carry it.**

Three limits of masking, encoded as conventions rather than attributes:

- **Dialogs portal to `document.body`** — an ancestor's mask can't reach a
  `ConfirmDialog`/`DialogDescription`; the mask must ride the description
  node itself (see the three counter-checkout dialogs).
- **Toasts also portal** outside every masked subtree — so toast copy never
  interpolates a buyer name (pinned by test).
- **Masking covers text nodes, not attributes** — `href`s like the Maps link,
  `wa.me` deep links, and `tel:` still embed the address/phone in the DOM
  snapshot. Those are attribute values on interaction elements Clarity does
  not display as text, accepted as-is; don't move PII into visible text near
  them.

### 3. Disclosure

Clarity is listed as a data processor, session recording is described under
"Information We Collect", and the cookie section names the analytics cookies
(`_clck` persists ~1 year) instead of claiming everything is strictly necessary
— all in the [privacy policy](../src/routes/privacy.tsx).

**Changing that page means bumping `PRIVACY_VERSION` in both
[`src/lib/legal.ts`](../src/lib/legal.ts) and
[`convex/lib/legal.ts`](../convex/lib/legal.ts)** — it drives the "Last updated"
date and `consentIsStale()`, which triggers the dashboard re-acceptance banner.
This PR bumped it to `2026-08-04`.

Clarity also exposes `consent()` / `consentV2()`. Unused today (there's no
cookie banner, and GA already runs without one); that's the hook if the
disclosure ever becomes a real consent gate.
