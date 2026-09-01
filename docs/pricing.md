# Pricing surface — tiers, Scale multi-outlet, Enterprise-hidden

The public pricing presentation. Backend caps + billing live in
[`manual-subscription.md`](./manual-subscription.md); this doc is the **display**
contract. Scale's multi-outlet repositioning tracked in ClickUp `86eyb9zwt`
(supersedes the reseller-banded positioning from `86ey4gaju`); the order-allowance
numbers come from the caps ticket `86eye2ccu`.

## Where it renders

- **`src/routes/pricing.tsx`** — the full `/pricing` page: tier cards + feature
  comparison table + FAQ.
- **`src/components/landing/pricing-teaser.tsx`** — the landing-page teaser; same
  three tiers, links to the full page.
- **`src/components/cost/cost-calculator.tsx`** (`/cost`) — not a tier surface,
  but it anchors the seller's own leak against the **Pro list price**, so it
  prices Kedaipal too and follows the same region. (It anchored on the Founding
  price until that was retired — 30 Aug 2026 pricing reset, ClickUp z8r3fday21.)
- Copy lives in `messages/en.json` + `messages/ms.json` + `messages/zh.json`
  (`pricing_*` for the teaser, `pricingpage_*` for the full page, `cost_*` for
  the calculator). All three locales are kept in lockstep — the i18n parity test
  fails otherwise, and a card must never fall back to English mid-render.

## MY vs SG — detected at the edge, overridable by the visitor

Kedaipal invoices Malaysian sellers in MYR and Singaporean ones in SGD
(`PLAN_MONTHLY_PRICES`, `FOUNDING_MONTHLY_PRICES`). Which one a visitor sees is
detected from **Cloudflare's `CF-IPCountry`** and overridable via the
**`RegionToggle`** on all three surfaces.

**Precedence: stored pick → geo-IP → time zone → MY.**

The override is not decoration. Geo-IP is a guess about a *person*, and it is
wrong often enough to matter — VPNs, corporate proxies, carrier NAT that
egresses in another country, roaming, and the JB commuter on a Singapore
network. Without a switcher, a wrong guess is a dead end: the visitor sees the
wrong price and has no recourse but to leave. Keeping one is also what nearly
every comparable platform does.

### How it is read

`src/lib/geo-region.ts` owns it. `readVisitorRegion()` is a
**`createIsomorphicFn`**: the server arm reads the cookie then the header, the
client arm returns `null`, and each is compiled out of the other environment —
so there is no server-function RPC on any navigation and no server-only import
in the browser bundle. It is called from the **root route's loader**
(`__root.tsx`), which is the right home for three reasons: three surfaces need
it, the root loader does not re-run on client-side navigation (so a visitor
resolves it once), and the value dehydrates into the HTML so the client's first
render matches the server's — no RM→S$ flicker, and hydration cannot mismatch.

`detectCountryFromGeoHeader` maps the header:

| Header | Result | Why |
| --- | --- | --- |
| `SG` (any case) | `SG` | |
| any other resolvable ISO-2 | `MY` | A real answer. The device's time zone does **not** get to overrule it. |
| absent / blank | `null` | Not a Cloudflare origin — fall through. |
| `XX`, `T1` | `null` | Cloudflare's "unplaceable IP" and Tor. Present but meaningless, so they must not read as a vote for Malaysia. |

`useLandingRegion()` (`src/hooks/useLandingRegion.ts`) returns
`[Country, setRegion]`. It **remembers the server's answer rather than
re-deriving it**, because `router.invalidate()` — the retry button in
`route-error.tsx` — re-runs the root loader on the *client*, where
`readVisitorRegion` has no request and answers `null`. Without that, a
header-detected SG visitor with no cookie would flip to RM on an error retry. The time-zone heuristic survives **only** as the
fallback where neither cookie nor header answered — `vite dev`, `wrangler dev`,
any non-Cloudflare origin — which is also what keeps the SG path exercisable
locally. It is not a co-signal: a time zone is a device setting, and the case
that motivated this work is an SG visitor whose phone still reads
`Asia/Kuala_Lumpur`.

### The pick is a cookie, not `localStorage`

`kp_landing_region`, `Path=/`, `SameSite=Lax`, one year, `Secure` only where the
page already is (so `http://localhost` dev still persists).

**A cookie because the server can read it.** With `localStorage` — which is what
this started as — a returning visitor who had overridden the geo guess got an
SSR render of the *geo* currency and a correction after mount: a visible price
flicker on every single visit, which is exactly the defect the SSR read was
added to remove. The cookie closes the loop, and the precedence chain is
identical on both sides.

It is a **functional preference the visitor asked for by clicking** —
first-party, no PII, no tracking — so it needs no consent banner. Not
`HttpOnly`: the toggle's `setRegion` is the only writer. A stale or hand-edited
value degrades to detection (`parseRegionCookie`) rather than becoming a third
state.

Both parsers are pure, total and tested — `readStoredRegion` catches
`decodeURIComponent`'s `URIError` too, since it runs in an effect on every
public page and a hand-edited `kp_landing_region=%` would otherwise take the
landing page down. Note the deliberate asymmetry: the **header** is normalized
case-insensitively (Cloudflare's, not ours), the **cookie** is case-sensitive
(we write it, so a lowercase value means something else did).

### Copy may not name a currency

Every amount in `pricing_*` / `pricingpage_*` arrives as a **placeholder** and
the surface formats it from the resolved currency. This is enforced by
`src/lib/pricing-copy.test.ts`, which fails on `RM 12` / `S$ 12` / `MYR` / `SGD`
appearing in any of those keys, in any locale — the sibling of
`currency-literals.test.ts` for source files.

It is a test rather than a sweep because the sweep had already failed twice:
the landing anchor read *"Starter from RM 79/mo"* directly above S$29 tier
cards, and the Scale card read *"Additional outlets RM49/mo each"* beside S$119.

Deliberately **out of scope**: the illustrative RM amounts in the hero chat, the
how-it-works mockups and the bento cards (`hero_*`, `how_mockup_*`, `bento_*`).
Those depict a fictional *Malaysian seller's* storefront — not Kedaipal's price
and not the visitor's money — so converting them would misrepresent the
screenshot. Same for the static SEO description, which names both currencies:
Googlebot crawls from the US, so a per-request `<meta>` would make the indexed
copy a coin toss.

### `/cost` is currency-parametric

`src/lib/calculator.ts` takes the currency as a **required** argument and keys
every currency-shaped value off an exhaustive `Record<BillingCurrency, …>`, so a
third billing currency is a compile error, never a silent Malaysian fallback.

| | MYR | SGD |
| --- | --- | --- |
| Pro price anchor | RM149 | S$59 |
| Labour rate (`LABOR_RATE_PER_HR`) | 25/hr | 15/hr |
| AOV slider | max 500, step 5, default 35 | max 200, step 2, default 15 |

The MY column is byte-identical to pre-SG and a test pins it.

**S$15/hr is not an FX conversion.** RM25 converts to about S$7, which reads as
implausibly cheap labour to a Singaporean and would quietly undercut the
chase-cost half of the argument.

`PRO_PRICE` is **derived** from `PLAN_MONTHLY_PRICES`, not restated — the file
used to carry its own literal, a second copy of the Pro price with nothing
stopping it drifting. A test asserts the identity.

The calculator holds only what the visitor **stated** (a shared link's params,
then each slider they move) and derives the rest, because the region can resolve
*after* a `/cost?aov=400` link is opened: untouched fields follow the new
region's defaults, entered ones are `clampInputs`-fitted into the new slider's
range. Pure derivation — no effect, no ref.

> The subtle part, and the one that broke in review of PR #238: `update` merges
> the patch into the **entered** set, never into the derived one. Spreading the
> derived `inputs` folds the current region's defaults in as if the visitor had
> typed them, so one nudge of the orders slider freezes an untouched RM 35
> basket and a switch to SG reads it as S$ 35 instead of re-seeding to S$ 15 —
> inflating missed revenue ~2.3× on the SG framing. `onInputsChange` still
> receives the full derived object, because the URL mirror wants every param.
> Pinned by `cost-calculator.test.tsx`.

The share params carry bare numbers with no currency, so a link built in
Malaysia and opened in Singapore reinterprets `aov=35` as S$35. Deliberate: a
region baked into the link would outlive the share, and the toggle sits directly
above the sliders. On `/cost` the toggle carries a **visible label**, unlike the
other two surfaces — here it reshapes the seller's *own* numbers (every slider's
currency and the leak total), not just the price we quote.

### Numbers still unconfirmed for SG

Marked `UNCONFIRMED` in `convex/lib/plans.ts`, both following the tier ratio
(SGD ≈ 0.4 × MYR across all three plans):

- `OUTLET_ADDON_MONTHLY_PRICES.SGD` — S$19 (vs RM49). Display copy only; Scale
  is not purchasable.
- `COMPETITOR_MONTHLY_RANGE.SGD` — S$80–200 (vs RM200–500), the landing
  anchor's comparison band.

`starterPricePerDay()` is `floor + 1`, not `ceil`: at a price that divides
evenly (RM90 → exactly 3) `ceil` returns the daily rate itself and "less than
RM3 a day" becomes false. Strictly-true beats tightest-possible for a public
claim; the cost is one unit of slack on prices divisible by 30, and neither of
today's is.

## The three public tiers

| Tier | Price | Positioning | Orders (display) | Seats | Outlets |
| --- | --- | --- | --- | --- | --- |
| **Starter** | RM79/mo | Single home seller, just starting | 100/mo | 1 | 1 |
| **Pro** | RM149/mo | Established single shop | 200/mo | 2 | 1 |
| **Scale** | **RM299/mo flat — Coming soon** | Multi-outlet / high-volume seller | ~400/mo | 5 | Up to 3 (+RM49/mo each additional) |

**Founding pricing (RM104/S$41) is retired** (30 Aug 2026 pricing reset,
ClickUp z8r3fday21): no public surface advertises it any more — a guard in
`landing-redesign.test.ts` now covers `cost_*` too — and existing Founding
Members simply keep their rate (`FOUNDING_MONTHLY_PRICES` stays in billing for
them). Scale's launch price moves to **RM399/S$149** with the companion backend
ticket (z8r3fday24); this table updates when that constant lands.

All three prices are **flat** — no metering (Arif, 19 Jul 2026). The 1 Jul ICP
audit disqualified reseller/wholesale networks; our real payers outgrow Pro on
**outlets and team size** (the StoreHub axis), so Scale is the multi-outlet tier.
All reseller-band copy, the band table, and its i18n keys were **removed** (the old
`src/lib/resellerBands.ts` + `reseller-band-table.tsx` are deleted).

Presentation rules:

- **Annual billing is hidden** (`SHOW_ANNUAL_TOGGLE = false` in `pricing.tsx`).
  There are no recurring-billing rails behind an annual price yet (HitPay
  recurring `86eyb6z4r` unbuilt) and a permanent visible % discount undercuts the
  flat-price posture (Arif, 28 Jul + 9 Aug 2026). Monthly is the only cycle. Flip
  the constant to re-expose the toggle; if reinstated, frame the saving as
  "2 months free", never a percentage.
- Scale is **not purchasable**: the CTA is a disabled **"Coming soon"** panel
  (trials are Pro-only), on both the full page and the teaser.
- **Tier CTAs are plan-aware for signed-in sellers** (`resolveTierCta` in
  `src/lib/pricing-cta.ts`): signed-out → trial link. For a signed-in seller,
  ownership is judged on **status, not just `plan`** — a trial stamps
  `plan:"pro"` on day one, so `plan` alone is "the tier being trialed", not
  owned. Only an **active** paid subscriber (or a **comped** account) of a tier
  gets the disabled **"Current plan"** pill; a trialing / past_due / cancelled
  seller gets an actionable **"Subscribe"** on every tier; an owner of another
  tier gets **"Upgrade"** (higher) or **"Manage plan"** (lower). All actionable
  CTAs route to **Settings → Billing** (`?tab=billing`), which owns the manual
  contact-Arif flow. While Clerk auth + the plan query are still resolving, the
  purchasable-tier buttons show a **spinner** (`Button isLoading`) instead of a
  label, so a signed-in seller's CTA doesn't flip trial → dashboard → final on one
  refresh — the SSR render is the spinner too, so hydration matches. A storeless
  admin / genuinely-null plan then falls back to "Go to Dashboard". The full page
  reads plan/status via the narrow `retailers.getMyPlan` query (not the heavy
  `getMyRetailer` payload) so a marketing route doesn't sign storage URLs just to
  read an enum; the landing teaser stays plan-agnostic (a lighter surface that
  links here).
- **Order allowances lead enforcement.** The page advertises the *decided*
  allowances — **Starter 100 / Pro 200 / Scale ~400** (caps ticket `86eye2ccu`) —
  ahead of the soft-cap meter that ticket ships. `PLAN_CAPS` still reads **Pro 500
  / Scale 2,000** until then — and that constant is the denominator the shipped
  billing-tab order meter renders — so both Pro (500→200) and Scale (2,000→400)
  copy deliberately diverge from the constant, and a Pro seller sees "200
  orders/mo" here but "N of 500" in Settings → Billing until `86eye2ccu` drops
  both caps. The page never advertises a number the business can't hold, and never
  shows "Unlimited". Cap numbers stay off the hero price; they live in the
  tier-card allowance line and the comparison table.
- Each tier card carries **"Flat price. We never take a cut of your sales."** — the
  value posture vs the metered/commission competitors.
- The comparison table carries a live **Insights row** (Starter –, Pro ✓, Scale ✓,
  no Coming soon badge): the strongest shipped Pro differentiator. The old "Sales
  reports" row was deleted per the 11 Jul Insights tiering decision.
- Scale-only rows (Outlets "Up to 3", custom domain, production calendar, priority
  support, higher broadcast quota) carry **Coming soon** badges until the Scale
  build ships. "Additional outlets RM49/mo each" is display copy only — the billing
  lever ships with that build.
- Founding is generic across plans: `FOUNDING_MONTHLY_PRICE` covers pro (RM104) +
  scale (RM209), 30% lifetime — not hardcoded to Pro. **Retired for new signups
  30 Aug 2026**; the constants remain only so existing members keep their rate.

## Enterprise — hidden

Enterprise is drafted in strategy (quote-based ceiling) but must **not** appear on
any public or in-app pricing surface yet (ICP is still F&B home sellers). There is
**no** `enterprise` plan enum — the exposed set is exactly `starter | pro | scale`
(`convex/lib/plans.ts`, guarded by a test in `plans.test.ts`). The
`UNLIMITED`/`isUnlimited` sentinel stays exported for that future tier but no v1
plan uses it.

## Mobile-first

Cards stack single-column, the comparison table scrolls inside its own container,
and tap targets stay ≥44px.
