# Analytics

**Status: implemented.** Client-side web analytics for the whole app —
storefront _and_ the seller dashboard. Two independent, env-gated providers,
each booted once from a hook mounted in the root document. Both no-op unless
their project/measurement ID env var is set, so local dev and preview builds
never pollute the production analytics.

| Tool                  | What it's for                          | Package         | Hook                                                 | Env var                   |
| --------------------- | -------------------------------------- | --------------- | ---------------------------------------------------- | ------------------------- |
| Google Analytics 4    | Pageviews, traffic, acquisition        | `react-ga4`     | [`useGoogleAnalytics`](../src/hooks/useGoogleAnalytics.ts) | `VITE_GA_MEASUREMENT_ID`  |
| Microsoft Clarity     | Session replays + heatmaps (UX/friction) | `@microsoft/clarity` | [`useClarity`](../src/hooks/useClarity.ts)      | `VITE_CLARITY_PROJECT_ID` |

Both hooks are called in `RootDocument` ([`src/routes/__root.tsx`](../src/routes/__root.tsx)),
so analytics load on every route (storefront + `/app`) **except `/track/*`,
which neither provider ever observes** — see Privacy §1. ClickUp `86eyb7021`
(Clarity), `86eyn25fk` (GA tracking-token exclusion).

## Why the npm package, not a `<script>` snippet

Clarity's dashboard offers a raw `<script>` tag, but we use the official
`@microsoft/clarity` package instead — matching the existing GA setup
(`react-ga4`). This keeps the project ID **env-driven** (no ID hardcoded into
committed HTML, and dev/preview stay out of the Clarity project by default),
runs on the client via `useEffect` so it's SSR-safe under TanStack Start, and
exposes a typed API (`identify`, `setTag`, `event`) if we later want to tag
sessions by seller or plan.

## How it works

`useClarity` initializes Clarity exactly once per page load:

```ts
const projectId = clientEnv.VITE_CLARITY_PROJECT_ID;
if (!projectId || clarityInitialized) return;
if (isTrackingTokenPath(pathname)) return;
Clarity.init(projectId);
```

Unlike GA — where `useGoogleAnalytics` fires a pageview on every pathname change
— Clarity needs no per-navigation call: after `init` it hooks the History API
and tracks SPA route changes itself. The pathname is read only to decide whether
booting is allowed at all. The module-level `clarityInitialized` guard mirrors
GA's `gaInitialized`, so a remount can't double-boot it (the test covers
unmount → remount specifically; a plain re-render passes with or without the
guard, so it proves nothing).

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

### 1. `/track/*` never reaches either provider

[`isTrackingTokenPath`](../src/lib/analytics-privacy.ts) is the single
predicate both hooks share: `useClarity` refuses to boot on the buyer tracking
page, and `useGoogleAnalytics` neither initializes nor sends a pageview there.
Masking governs DOM content, not the **observed page address**, and
`/track/<token>` carries the buyer's capability secret in the URL — that token
grants reading the order, claiming payment, and editing the delivery
address/phone with no auth (see CLAUDE.md). Recording it would export the
secret to Microsoft/Google and to anyone with either dashboard's access.

For GA specifically, full exclusion beats redacting the sent path: gtag
auto-collects the real `page_location` from the browser on every hit once the
library is loaded, so a redacted manual pageview would still leak the URL. The
library simply never loads on token pages; a buyer who navigates from /track
into the storefront boots GA on that first non-token pathname.

**Ops note (GA property setting, not repo):** keep GA4 Enhanced Measurement's
"Page changes based on browser history events" OFF — if enabled, gtag fires
its own page_view with the full URL on SPA navigations, bypassing the hook.
No client-side link navigates into `/track` today, so this is defence in
depth, not a live hole.

Nothing links to `/track` client-side (buyers arrive from a WhatsApp link, i.e.
a fresh document load), so the exclusion is complete rather than best-effort.

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
| Customer list rows | `src/components/dashboard/customer-card.tsx` |
| Customer detail (name, phone, notes) | `src/components/dashboard/customer-detail.tsx` |
| Delivery address + notes (order detail *and* tracking page) | `src/components/storefront/delivery-address-display.tsx` |
| Order detail — buyer note / reference photo | `src/routes/app.orders.$shortId.tsx` |
| Order detail — customer + CRM block | `src/routes/app.orders.$shortId.tsx` |

`grep -rn MASK_PII src` audits coverage. **Any new surface that renders a
customer's name, phone, address, or notes must carry it** — this is a
fail-closed convention only if it's applied.

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
