# Analytics

**Status: implemented.** Web + product analytics for the whole app — storefront
_and_ the seller dashboard. Three independent, env-gated providers, each booted
once from a hook mounted in the root document. All three no-op unless their key
env var is set, so local dev and preview builds never pollute production data.

| Tool | What it's for | Package | Hook | Env var |
| --- | --- | --- | --- | --- |
| Google Analytics 4 | Pageviews, traffic, acquisition | `react-ga4` | [`useGoogleAnalytics`](../src/hooks/useGoogleAnalytics.ts) | `VITE_GA_MEASUREMENT_ID` |
| Microsoft Clarity | Session replays + heatmaps (UX/friction) | `@microsoft/clarity` | [`useClarity`](../src/hooks/useClarity.ts) | `VITE_CLARITY_PROJECT_ID` |
| PostHog | Events, funnels, cohorts | `posthog-js` | [`usePostHog`](../src/hooks/usePostHog.ts) | `VITE_POSTHOG_KEY` |

All three hooks are called in `RootDocument`
([`src/routes/__root.tsx`](../src/routes/__root.tsx)), so analytics load on
every route (storefront + `/app`) **except the capability-token routes
`/track/*` and `/claim/*`, which no provider ever observes** — see Privacy §1.
ClickUp `86eyb7021` (Clarity), `86eyn25fk` (GA tracking-token exclusion),
PR #227 review (`/claim`), `86eyrayux` (PostHog).

## Why three tools — and when to collapse to one

**The honest version: this is free-tier arbitrage, not a capability gap.** It is
tempting to justify three providers with "no single tool does all of it", and
that would be wrong — PostHog alone *can* do all three jobs. It ships product
analytics, session replay, **and** a web-analytics product that is a direct GA4
replacement. One tool could cover this whole surface today.

We run three anyway, for two reasons and one inheritance:

1. **Free-tier capacity is the real driver.** Three free tiers hold more than
   one. PostHog free stops at **1M events + 5k session recordings/mo**; Clarity
   is free with **no traffic or recording cap**; GA4 is free for pageviews at
   our volume. Consolidating onto PostHog's free tier would mean sampling
   replays at ~100 retailers (5k/mo is roughly 1.6 recordings per retailer per
   day) — paying in *coverage* for a tidiness we don't need yet.
2. **GA4 has one thing genuinely nothing else has**: native Google Ads and
   Search Console attribution. PostHog cannot push conversions back into Google
   Ads bidding. The moment S6 turns targeted ads on, that stops being
   substitutable — and until then it is the weakest of the three.
3. **GA4 and Clarity were already shipped and disclosed** before PostHog was
   considered. Removing them is work plus a privacy-policy revision, not a
   saving.

### What three tools actually costs

Worth stating plainly, because it is not free:

- **Three data processors to disclose.** Under PDPA every one of them is a
  third party receiving buyer data, and each must appear in the privacy policy
  (see Privacy §3). This is the heaviest cost, and it grew right after the
  August privacy truth-pass (`86eyn25fu`).
- **Three scripts on buyer routes.** Mitigated — PostHog is a lazy chunk and
  its replay recorder never loads — but not zero, on a storefront whose payload
  budget is already a live concern (`86eypxght`).
- **Three dashboards, no single view.** A question spanning acquisition →
  behaviour → conversion is answered by hand across three tools.

### The decision rule

Keep the split **while all three are free**. Collapse when either of these
happens:

- **You start paying PostHog.** At that point replay and web analytics are
  included in what you already bought, and Clarity is pure duplicated
  disclosure — drop it.
- **You stop running Google Ads (or never start).** GA4's only irreplaceable
  capability is ad attribution. Without ads it is a redundant processor, and
  dropping it removes a disclosure obligation for free.

The end state is almost certainly **PostHog alone**. This is a deliberate
"not yet", not an architecture we intend to keep.

### Who answers what

| Question | Tool |
| --- | --- |
| Where did this traffic come from? Which ad worked? | GA4 |
| What did this buyer struggle with on the checkout page? | Clarity |
| How many storefront visitors become paid orders? | PostHog |
| Which stores are activating? Which features get used? | PostHog |
| Is this page slow / is the layout broken on their phone? | Clarity |

## Clarity — why the npm package, not a `<script>` snippet

Clarity's dashboard offers a raw `<script>` tag, but we use the official
`@microsoft/clarity` package instead — matching the existing GA setup
(`react-ga4`). This keeps the project ID **env-driven** (no ID hardcoded into
committed HTML, and dev/preview stay out of the Clarity project by default),
runs on the client via `useEffect` so it's SSR-safe under TanStack Start, and
exposes a typed API (`identify`, `setTag`, `event`) if we later want to tag
sessions by seller or plan.

## Clarity — how it works

`useClarity` initializes Clarity exactly once per page load:

```ts
const projectId = clientEnv.VITE_CLARITY_PROJECT_ID;
if (!projectId || clarityInitialized) return;
if (isCapabilityTokenPath(pathname)) return;
Clarity.init(projectId);
```

Unlike GA — where `useGoogleAnalytics` fires a pageview on every pathname change
— Clarity needs no per-navigation call: after `init` it hooks the History API
and tracks SPA route changes itself. The pathname is read only to decide whether
booting is allowed at all. The module-level `clarityInitialized` guard mirrors
GA's `gaInitialized`, so a remount can't double-boot it (the test covers
unmount → remount specifically; a plain re-render passes with or without the
guard, so it proves nothing).

## Clarity — configuration

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

## PostHog — product analytics

**ClickUp `86eyrayux`.** PostHog runs on **Convex Starter** — no Convex Pro.
Pro only gates log streams, exception reporting, streaming export, daily backups
and custom domains; none of that is involved here. Do not upgrade the Convex
plan for analytics.

### The shape: client for behaviour, Convex for money

Kedaipal's funnel **crosses the device boundary**, and that single fact
determines the architecture:

```
buyer browses storefront  →  wa.me handoff  →  [browser gone]  →  Convex confirms  →  paid
└────────── client-fired ──────────┘                          └──── server-fired ────┘
```

A client-only integration cannot see order-confirmed or paid — the buyer's
browser is no longer there. So events come from both sides:

| Side | Fires | Where |
| --- | --- | --- |
| Browser | `$pageview` per resolved route | [`usePostHog`](../src/hooks/usePostHog.ts) |
| Convex | `order_created` | [`orders.create`](../convex/orders.ts) via [`captureServerEvent`](../convex/posthog.ts) |

**SSR is deliberately not one of the options.** Firing from a route loader would
double-count (loaders run on the Worker for first paint *and* in the browser on
client navigations), would bill Googlebot and WhatsApp's link unfurler as buyer
pageviews, and would run head-first into the module-singleton `QueryClient`
constraint documented in [frontend-caching.md](./frontend-caching.md).

### Joining the two halves: `analyticsDistinctId`

The server events would otherwise land on a *different* PostHog person than the
pageviews that preceded them, and no conversion funnel would compute. So the
browser's `distinct_id` is carried onto the order at create:

1. `readAnalyticsDistinctId()` reads `posthog.get_distinct_id()` at checkout
   ([`src/lib/posthog.ts`](../src/lib/posthog.ts)).
2. It rides in as an `orders.create` arg and is **re-sanitized server-side**
   ([`sanitizeDistinctId`](../convex/lib/posthog.ts)) — same posture as
   `attributionSource`: a public mutation never trusts a client string.
3. It is stored as `orders.analyticsDistinctId` and used as the `distinct_id` on
   every server event for that order.

**Privacy shape.** The id is an opaque UUID minted by posthog-js — not PII. The
join lives in *our* database; PostHog only ever receives the id beside scalar,
PII-free order properties (total, currency, item count, delivery method,
attribution source). No name, phone, address, or note is ever sent. Server
events also set `$process_person_profile: false` by default, so a buyer never
mints a durable PostHog *person* record — mirroring `identified_only` on the
client. `withPersonProfile: true` is opt-in and reserved for genuinely
identified subjects (a signed-in seller).

Absent on counter orders (no buyer browser at all) and whenever PostHog is
unconfigured or blocked, so **there is nothing to backfill**.

### Config decisions

Every disabled default in [`posthogInitOptions`](../src/lib/posthog.ts) is a
cost or privacy decision, and each is pinned by a test:

| Option | Value | Why |
| --- | --- | --- |
| `autocapture` | `false` | It records clicked-element text and attributes — buyer names, addresses, `wa.me` hrefs with phone numbers. **`MASK_PII` is a Clarity attribute PostHog does not honour**, so autocapture would silently bypass all masked surfaces (Privacy §2). It is also the fastest way to exhaust 1M events/mo. |
| `capture_pageview` | `false` | `usePostHog` fires per resolved route instead, so SPA navs count once rather than twice. |
| `capture_pageleave` | `false` | Roughly doubles event volume to measure bounce/duration, which Clarity already shows. |
| `disable_session_recording` | `true` | Replay is Clarity's job — free and uncapped there. |
| `person_profiles` | `identified_only` | Anonymous shoppers never mint a person record. |
| `sanitize_properties` | `stripTrackingReferrer` | Blanks any `/track/*` referrer (Privacy §1). |

### Why no SDK on the Convex side

[`convex/posthog.ts`](../convex/posthog.ts) is one `fetch` to PostHog's
documented capture endpoint. Two alternatives were considered and rejected:

- **`@posthog/convex`** (the official component) is the better long-term home
  and works on the free plan — but it **requires Convex ≥ 1.39 and we are on
  1.34.x**. Bumping five minors of the backend SDK does not belong inside an
  analytics change. `captureServerEvent` is a narrow enough seam that adopting
  it later is a one-file change (the `ChannelAdapter` posture).
- **`posthog-node`** is built around a long-lived process with a background
  flush timer, whereas Convex actions are short-lived isolates — and it would
  introduce the codebase's **first `"use node"` file** purely for telemetry.

Capture is **scheduled, never awaited into the critical path**: mutations cannot
`fetch`, so `captureServerEvent` uses `ctx.scheduler.runAfter(0, …)`. The order
commits first; the event goes out after. Failures are swallowed and warned —
analytics is never load-bearing.

### Cost

PostHog free tier: **1M events/mo**, 5k session recordings/mo. With autocapture
and replay off, at ~100 retailers / 5,000 orders per month:

| Source | Volume/mo |
| --- | --- |
| Pageviews (~10 per order) | ~50,000 |
| Server events | ~5,000 per event type |
| **Total** | **well under 100k** |

Comfortably inside the free tier, with room for several more server events
before the 1M ceiling is a live concern. Revisit at ~500 retailers.

**Client payload:** `posthog-js` is imported dynamically inside the boot effect,
so it is a lazy chunk — **~85 KB gzipped**, never in the critical path, and
never loaded during SSR. That matters on a storefront whose payload budget is
already a live concern (`86eypxght`). If it ever becomes an issue,
`posthog-js-lite` (analytics + flags only, no replay) is the smaller drop-in.

### Configuration

- **Client (build-time):** `VITE_POSTHOG_KEY` (project API key, `phc_…`) and
  optional `VITE_POSTHOG_HOST` (defaults to `https://us.i.posthog.com`). Both
  live in `.env.local.example`; leave blank locally to stay out of the project.
  For prod, add them to the GitHub Actions **`prod` environment variables**
  alongside `VITE_GA_MEASUREMENT_ID`.
- **Server (Convex runtime):** `npx convex env set POSTHOG_PROJECT_KEY phc_…`
  and optionally `POSTHOG_HOST`. **This is a separate env store from the
  frontend's** — setting only the `VITE_` vars gets you pageviews with no server
  events, which looks like a broken funnel rather than a missing config.
- A **blank** value counts as unset on both sides. This is load-bearing: Vite
  inlines a blank `.env` key as `""`, and `z.string().url()` rejects the empty
  string — which would throw at module load and take the *whole app* down over
  an unset optional. `optionalEnv` in [`src/lib/env.ts`](../src/lib/env.ts)
  normalizes blank → undefined; the server mirrors it with a `.trim() ||`
  fallback.

The project key is not a secret — it ships in the client bundle on every page —
so it lives in a plaintext repo variable, not a secret.

### PostHog dashboard setup

Kedaipal's PostHog org: project **584039**, **US Cloud**. The rest of this
section is what to configure there, and why each item is not just a default.

#### The one-project constraint (read this first)

**PostHog's free plan allows exactly one project.** There is no sandbox project
and no free dev/prod split — everything lands in the same silo, and free
retention is **1 year** (session replay 3 months, though we don't use PostHog's).
A polluted funnel therefore stays polluted for a year.

So every event carries an **`environment`** property, stamped automatically on
both sides so no call site can forget it:

| Side | Source | Where |
| --- | --- | --- |
| Browser | `window.location.hostname` | super property registered at init, before the first `$pageview` |
| Convex | `SITE_URL` | stamped inside the capture action |

`kedaipal.com` and its subdomains are `production`; **everything else, including
anything unset or unparseable, is `development`** — see `posthogEnvironment` in
[`convex/lib/posthog.ts`](../convex/lib/posthog.ts). The failure direction is
deliberate: mislabelling dev traffic as production silently corrupts the numbers
a decision gets made on, while the reverse under-counts visibly and is fixable.

**Every production insight, funnel and dashboard must filter
`environment = production`.** Build that filter into the saved insight, not into
a habit. If PostHog ever moves to a paid plan, separate projects replace this and
the property becomes redundant rather than wrong.

#### Project settings to check

Client config already sets the important ones ([`posthogInitOptions`](../src/lib/posthog.ts)),
but several have a **project-side** switch too, and the project side wins for
anything PostHog decides server-side. Set both — belt and braces, and the
project side is what protects you if some future page boots PostHog without our
config.

| Setting | Set to | Why |
| --- | --- | --- |
| Autocapture | **Off** | It records clicked-element text: buyer names, addresses, `wa.me` hrefs with phone numbers. `MASK_PII` is a *Clarity* attribute PostHog does not honour, so autocapture bypasses all masked surfaces. Also the fastest way to burn 1M events. |
| Session replay | **Off** | Clarity's job, free and uncapped there. Leaving it on burns the 5k/mo cap for a duplicate. |
| Heatmaps | **Off** | Clarity's job. |
| Web vitals / performance capture | **Off** | Pure event volume against the 1M cap; not a question we're asking. |
| Exception autocapture / error tracking | **Off** | Not our error tool, and exceptions can carry PII in messages. |
| Surveys | **Off** | Would render UI to buyers. Nothing should appear on a storefront that the seller didn't put there. |
| IP data capture | **Consider off** — *Settings → Project → Privacy* | The one path PostHog documents explicitly. An IP is personal data under PDPA; we don't use geo, so collecting it adds disclosure burden for nothing. Turning it off also disables GeoIP. |
| Bot filtering | **On** (default) | Keeps crawlers and the WhatsApp link unfurler out of buyer counts. |
| Toolbar authorized URLs | `https://kedaipal.com` | Limits where the PostHog toolbar can be injected. |

Anything not in this table: leave at its default. The menu paths move between
PostHog releases — only the IP one is documented above, so search settings by
the **setting name** rather than trusting a path from memory.

#### Billing

Do **not** add a card. With no payment method PostHog hard-stops at the free
tier rather than billing on overage, which is exactly the behaviour we want
while this is a spike. Adding a card silently converts the 1M-event ceiling from
a stop into a bill.

#### Turning it on in production

Two halves, two stores — **setting only the first gives pageviews with no server
events, which reads as a broken funnel rather than missing config.**

1. **Client (build-time):** add `VITE_POSTHOG_KEY` to the GitHub Actions **`prod`
   environment variables**, beside `VITE_GA_MEASUREMENT_ID` and
   `VITE_CLARITY_PROJECT_ID`. `VITE_` vars are baked at build, so this only
   takes effect on the next deploy.
2. **Server (Convex prod runtime):** `POSTHOG_PROJECT_KEY`, set on the
   production deployment.

The project token is **not a secret** — it ships in the client bundle on every
page, exactly like the Clarity project ID and the Clerk publishable key — so it
belongs in a plaintext repo/environment variable, never a secret store. (The
key that *is* secret is a PostHog **personal API key**; we don't use one.)

#### Before production rollout: the privacy policy

PostHog is a third data processor receiving buyer data. Turning it on in prod
means [`src/routes/privacy.tsx`](../src/routes/privacy.tsx) must name it in the
processor list and the cookie section — and **that means bumping
`PRIVACY_VERSION` in both [`src/lib/legal.ts`](../src/lib/legal.ts) and
[`convex/lib/legal.ts`](../convex/lib/legal.ts)**, which drives `consentIsStale()`
and re-prompts every seller. Do it in the same change that sets the prod env
vars, not after. See Privacy §3.

### Deliberately deferred

- **`/ingest/*` reverse proxy** to survive ad blockers.
  [`src/server-entry.ts`](../src/server-entry.ts) already has the pattern
  (`handleImageRequest`), so it is ~15 lines, and retrofitting only changes
  `VITE_POSTHOG_HOST`. The real prize is first-party cookies surviving Safari
  ITP's 7-day cap for returning-buyer analysis — worth doing, not worth
  blocking on.
- **More server events** (`order_paid`, `order_confirmed`, WhatsApp sends by
  category). The seam takes them in one line each; `order_created` proves the
  path end-to-end first.
- **Feature flags and exception forwarding**, which arrive with
  `@posthog/convex` once Convex is bumped for its own reasons.

## Privacy

Session replay is materially more invasive than pageview analytics — it ships a
reconstruction of the rendered page to a third party. Three controls, all in the
repo rather than behind a dashboard toggle:

### 1. Capability-token routes never reach any provider

[`isCapabilityTokenPath`](../src/lib/analytics-privacy.ts) is the single
predicate all three hooks share: `useClarity` and `usePostHog` refuse to
boot on them, and `useGoogleAnalytics` neither initializes nor sends a
pageview there. Masking
governs DOM content, not the **observed page address**, and these URLs *are*
the secret:

| Route | What the token in the URL grants, with no auth |
| --- | --- |
| `/track/<token>` | Read the order, claim payment, edit the delivery address/phone (see CLAUDE.md). |
| `/claim/<token>` | Read the buyer's name/phone and the frozen lines, **and commit**: `orderClaims.commit` creates a real order and decrements the seller's stock. |

Recording either would export the secret to Microsoft/Google/PostHog and to
anyone with those dashboards' access — for Clarity, alongside a session replay
of the buyer's checkout.

PostHog is the strictest case of the three: with autocapture or replay on it
would capture the token from the URL **and** from the DOM. It never loads on
these routes, and [`stripTrackingReferrer`](../src/lib/posthog.ts) additionally
blanks any `$referrer` pointing at one — defence in depth for the one channel
that could still carry a token onto a page PostHog *is* allowed to see (every
anchor on the tracking page currently sets `rel="noreferrer"`, so this is not a
live hole today, but it is one a single future `<a href>` would reopen).

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
