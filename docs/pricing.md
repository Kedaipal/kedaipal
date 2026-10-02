# Pricing surface — tiers, Scale multi-outlet, Enterprise-hidden

> **30 Sep 2026 (Credits T5 `z8r3fdfu31` + `z8r3fdfuhq`):** every public
> allowance is now **Kedaipal Credits read from `PLAN_CREDIT_GRANT`** (100 / 200 /
> 500 — the retired Scale 400 is gone from every catalog), **Scale is
> purchasable** (plan-aware CTA on both surfaces, self-serve and admin), the trial
> reads **"14 days or 200 orders from your first order"** wherever the page used
> to say "14-day free trial", `/cost` prices the plan the visitor's volume needs,
> and no public surface mentions the Off-Season Hold. The full map of what each
> surface says: [`credits.md` → Public surfaces](./credits.md#public-surfaces-t5).

> **13 Sep 2026 (`z8r3fdegej`):** `/`'s pricing teaser, hero, nav and closing CTA
> now carry the start-when-you-sell copy (no "14-day"), the JSON-LD offer range
> is derived from `PLAN_MONTHLY_PRICES`, and the landing's MY/SG region is one
> shared `LandingRegionProvider` (Delivery + Pricing move together). Scale is
> RM399 / S$149 once PR #270 merges; `/pricing`'s own `pricingpage_*` copy is
> still z8r3fday21's.

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
  but it prices Kedaipal against the seller's own leak, so it follows the same
  region. Since the credits release it anchors on **the plan their volume
  needs** (`recommendPlan`, below) — it was the Founding price until the 30 Aug
  reset (z8r3fday21), then a flat Pro list price for everyone.
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
| Price anchor | `recommendPlan` — plan + top-ups in MYR | the same, in SGD |
| Labour rate (`LABOR_RATE_PER_HR`) | 25/hr | 15/hr |
| AOV slider | max 500, step 5, default 35 | max 200, step 2, default 15 |

The MY sliders are byte-identical to pre-SG and a test pins them.

### `/cost` recommends the plan the volume needs (Credits T5)

Monthly volume is `ordersPerWeek × 52 / 12`, **rounded up** so the answer
always covers the estimate (`monthlyOrdersFromWeekly`). For every purchasable
tier, `recommendPlan` prices the plan plus the **cheapest whole top-up packs**
covering the rest (`cheapestTopUp` over `CREDIT_PACKS[currency]`), and takes the
cheapest; a tie goes to the **higher** tier (the same money, more credits built
in, fewer top-ups to remember). The leak is then compared against that price —
the savings, the ratio ("5.7× what Kedaipal costs you" — the plan plus its
top-ups, never "your subscription"), the "not worth it yet" verdict and the
WhatsApp message all name it. **The sticky CTA is the one exception:** it
quotes the recommended PLAN at the plan's own price ("Start with Pro —
RM149/mo"), because a plan-plus-top-ups total on a "Start" button reads like a
plan price that doesn't exist (Zaki's test round, 1 Oct 2026). The card above
it says what the top-ups add.

| Orders a week (≈ a month) | MYR | SGD |
| --- | --- | --- |
| 20 (87) | Starter — RM79 | Starter — S$29 |
| 60 (260) | Pro + 2 × 50 credits — RM239 (ties Starter + 1 × 200) | Pro + 2 × 50 credits — S$103 |
| 130 (564) | Pro + 2 × 200 credits — RM469 | Scale + 2 × 50 credits — S$193 |

When the answer leans on top-ups the card names the **next tier up** it beat
("Cheaper than Scale at RM399/mo"), by its whole option ("Scale + 2 × 50
credits at RM489") — never a lower tier: at 260 orders Starter + 1 × 200 ties
Pro + 2 × 50, and "cheaper than" it would be false. The MYR/SGD split at 130 a
week is honest arithmetic, not a bug: in ringgit a 200-pack credit (RM0.80)
undercuts what Scale charges per credit above Pro (RM0.83), in dollars it
doesn't (S$0.375 vs S$0.30).

**A deliberate deviation from the ticket's wording.** The ticket said "Starter
up to 100, Pro up to 200"; its own rule — "the cheapest option whose credits
cover it" — makes **Starter + one 50-credit top-up** the answer from 101 to 150
orders a month (RM124 / S$51 against Pro's RM149 / S$59). The page follows the
rule, not the shorthand.

**S$15/hr is not an FX conversion.** RM25 converts to about S$7, which reads as
implausibly cheap labour to a Singaporean and would quietly undercut the
chase-cost half of the argument.

The anchor is **derived** from `PLAN_MONTHLY_PRICES` and `CREDIT_PACKS`, never
restated — the file once carried its own Pro literal (`PRO_PRICE`, since
deleted), a second copy of the price with nothing stopping it drifting.

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

- `OUTLET_ADDON_MONTHLY_PRICES` — RM49 / S$18 (S$18 confirmed by Arif, 1 Sep).
  **Quoted nowhere** since Scale became purchasable: outlets are "Coming soon",
  and a per-outlet price beside a live Subscribe button would sell something
  nobody can open. It waits for the outlets build.
- `COMPETITOR_MONTHLY_RANGE.SGD` — S$80–200 (vs RM200–500), the landing
  anchor's comparison band.

`starterPricePerDay()` is `floor + 1`, not `ceil`: at a price that divides
evenly (RM90 → exactly 3) `ceil` returns the daily rate itself and "less than
RM3 a day" becomes false. Strictly-true beats tightest-possible for a public
claim; the cost is one unit of slack on prices divisible by 30, and neither of
today's is.

## The three public tiers

| Tier | Price | Positioning | Credits a month (1 credit = 1 order) | People | Outlets |
| --- | --- | --- | --- | --- | --- |
| **Starter** | RM79/mo · S$29 | Single home seller, just starting | 100 | 1 (you) | 1 |
| **Pro** | RM149/mo · S$59 | Established single shop | 200 | 3 (you + 2) | 1 |
| **Scale** | **RM399/mo · S$149 flat — purchasable since 30 Sep 2026** | High-volume / multi-outlet seller | 500 | 6 (you + 5) | Up to 3 — **coming soon**, no add-on price quoted |
| *Off-Season Hold* | **RM19/mo · S$9** — a status, not a tier; **never on a public surface** (retired separately, `z8r3fdfuhr`) | A paid seller paused between seasons: ordering off, everything else live, one tap back | 0 | — | — |

The credits column is the **Kedaipal Credits** grant (ClickUp `86eye2ccu`,
[`credits.md`](./credits.md)): `PLAN_CREDIT_GRANT` in `convex/lib/plans.ts`,
from which `PLAN_CAPS.orderCap` is derived — one number, one source. Founding
Pro is granted 300 (never shown publicly) and the free trial 200, one-off. Top-up
packs: MY 50 for RM45 / 200 for RM160, SG 50 for S$22 / 200 for S$75
(`CREDIT_PACKS`). Scale moved from 400 to 500 on 17 Sep 2026, and the public
copy moved with the credits release (T5 `z8r3fdfu31`) — every number now read
from the constant, so the next move needs no copy edit.

**Founding pricing (RM104/S$41) is retired** (30 Aug 2026 pricing reset,
ClickUp z8r3fday21): no public surface advertises it any more — a guard in
`landing-redesign.test.ts` now covers `cost_*` too — and existing Founding
Members simply keep their rate (`FOUNDING_MONTHLY_PRICES` stays in billing for
them). Scale's launch price **is RM399/S$149** as of the companion backend
ticket (z8r3fday24, Arif's FINAL 6 Sep number; the S$19 outlet guess became the
confirmed S$18). The order allowances are the monthly credit grants —
100/200/500 (see the table note above). Every store is **free until
its first live order**; that order starts **14 days or 200 orders of everything
in Pro, whichever comes first** (Zaki, 30 Sep 2026 — the 14 days is the first
invoice's grace, `INVOICE_DUE_GRACE_DAYS`, and the 200 is `TRIAL_CREDIT_GRANT`),
then the seller picks a plan. A store with no order by day 15 gets its first
invoice then (the backstop), which the FAQ answers name and nothing contradicts.
The mechanism lives in
[`manual-subscription.md`](./manual-subscription.md#start-when-you-sell--off-season-hold-sep-2026-clickup-z8r3fday24)
and [`credits.md`](./credits.md#the-trial-14-days-or-200-orders-whichever-comes-first).
The Off-Season Hold stays an in-product status only — no public surface quotes
it.

All three prices are **flat** — no per-message fees and no cut of the seller's sales (Arif, 19 Jul 2026). Volume is bounded by the monthly credits, not metered per message: a seller who needs more tops up or upgrades ([`credits.md`](./credits.md)). The 1 Jul ICP
audit disqualified reseller/wholesale networks; our real payers outgrow Pro on
**outlets and team size** (the StoreHub axis), so Scale is the multi-outlet tier.
All reseller-band copy, the band table, and its i18n keys were **removed** (the old
`src/lib/resellerBands.ts` + `reseller-band-table.tsx` are deleted).

Presentation rules:

- **The annual toggle is live** (`SHOW_ANNUAL_TOGGLE = true` in `pricing.tsx`,
  flipped with the HitPay recurring rails, `86eyb6z4r`). Annual is framed as
  "2 months free", never a percentage. Credits stay monthly on either cycle —
  an annual seller is granted every month, never 12 months upfront
  ([`credits.md`](./credits.md#plan-changes)). See [Annual billing](#annual-billing).
- **Scale is purchasable** (z8r3fdfuhq, 30 Sep 2026): its card takes the same
  plan-aware CTA as the other two, on both the full page and the teaser, and
  Settings → Billing sells it (picker, plan change, first-invoice switch,
  annual). Both surfaces read `isPlanSelectable` rather than naming Scale, so a
  tier that closes again gets its "Coming soon" pill and disabled panel back
  from that one gate. What Scale sells TODAY is volume (500 credits) and team
  (you + 5); outlets, broadcasts, custom domain, production calendar and
  priority support keep their **Coming soon** badges, and the teaser marks
  outlets and broadcasts "Soon" on the card itself.
- **Tier CTAs are plan-aware for signed-in sellers** (`resolveTierCta` in
  `src/lib/pricing-cta.ts`): signed-out → trial link. For a signed-in seller,
  ownership is judged on **status, not just `plan`** — a trial stamps
  `plan:"pro"` on day one, so `plan` alone is "the tier being trialed", not
  owned. Only an **active** paid subscriber (or a **comped** account) of a tier
  gets the disabled **"Current plan"** pill; a trialing / past_due / cancelled
  seller gets an actionable **"Subscribe"** on every tier; an owner of another
  tier gets **"Upgrade"** (higher) or **"Manage plan"** (lower). All actionable
  CTAs route to **Settings → Billing** (`?tab=billing`), where subscribing and
  changing plan are self-serve. While Clerk auth + the plan query are still resolving, the
  purchasable-tier buttons show a **spinner** (`Button isLoading`) instead of a
  label, so a signed-in seller's CTA doesn't flip trial → dashboard → final on one
  refresh — the SSR render is the spinner too, so hydration matches. A storeless
  admin / genuinely-null plan then falls back to "Go to Dashboard". The full page
  reads plan/status via the narrow `retailers.getMyPlan` query (not the heavy
  `getMyRetailer` payload) so a marketing route doesn't sign storage URLs just to
  read an enum; the landing teaser stays plan-agnostic (a lighter surface that
  links here).
- **Order allowances are the credit grants.** One constant (`PLAN_CREDIT_GRANT`)
  feeds the ledger, the credit meter and the in-app plan cards' "{credits}
  credits a month" lines (Credits T3 — `PLAN_CAPS.orderCap` is derived from
  it) and the page — as a `{credits}` placeholder in every catalog line, never
  a literal (`pricing-copy.test.ts` fails on one). Cap numbers stay off the
  hero price; they live in the tier-card credits line ("{credits} credits a
  month — 1 per order") and the comparison table's "Credits a month" row,
  which reads PER MONTH in both toggle positions. The page never shows
  "Unlimited".
- Each tier card carries **"Flat price. We never take a cut of your sales."** — the
  value posture vs the metered/commission competitors.
- The comparison table carries a live **Insights row** (Starter –, Pro ✓, Scale ✓,
  no Coming soon badge): the strongest shipped Pro differentiator. The old "Sales
  reports" row was deleted per the 11 Jul Insights tiering decision.
- Scale-only rows (Outlets "Up to 3", custom domain, production calendar, priority
  support, higher broadcast quota) carry **Coming soon** badges until they ship.
  The "Additional outlets {price}/mo each" line was **removed** when Scale became
  purchasable — quoting an add-on nobody can buy beside a live CTA is the
  over-promise the badges exist to prevent.
- Founding is generic across plans: `FOUNDING_MONTHLY_PRICE` covers pro (RM104) +
  scale (RM209), 30% lifetime — not hardcoded to Pro. **Retired for new signups
  30 Aug 2026**; the constants remain only so existing members keep their rate.

## Annual billing

**10 months charged, 12 received.** Always "2 months free", never a percentage —
a standing % badge reads as a markdown on a flat price (Arif, 28 Jul + 9 Aug
2026).

`annualQuote(plan, founding, currency)` in `convex/lib/plans.ts` is the **single
author** of every annual number: `monthly`, `annualTotal`, `effectiveMonthly`,
`saving`, `monthsFree`. `annualTotal` *is* `planPrice(plan, "annual", …)`, pinned
by a test.

| Tier | MYR/yr | Effective/mo | Saves | SGD/yr | Effective/mo | Saves |
| --- | --- | --- | --- | --- | --- | --- |
| Starter | RM790 | RM65.84 | RM158 | S$290 | S$24.17 | S$58 |
| Pro | RM1,490 | RM124.17 | RM298 | S$590 | S$49.17 | S$118 |
| Scale | RM3,990 | RM332.50 | RM798 | S$1,490 | S$124.17 | S$298 |

(Scale's row moved with the pricing reset — RM399/S$149 → RM3,990/S$1,490 —
when `z8r3fday24` landed; the table derives from `annualQuote`.)

**One helper because the surfaces disagreed.** `/pricing` computed its yearly
total as `floor(monthly × 10 / 12) × 10` — a year priced at 8.33 months — so a
Starter card advertised **RM650/yr against an RM790 invoice**, under-quoting
every tier by RM140–500 / S$50–200. Two definitions of "annual", 17% apart, on
the same product. That code was behind the hidden toggle, so nobody had seen it;
it would have shipped the day the flag flipped.

Two more defects fixed in the same pass, both in that dead code:

- `pricingpage_billed_annual` read **"Billed RM{total}/yr"** in all three
  locales. It slipped past `pricing-copy.test.ts` because the guard was
  `/\bRM\s?\d/` and `RM{` is not `RM` + a digit. The guard is now
  `/\bRM\s?[\d{]/` — a symbol glued to a *placeholder* is exactly as wrong as
  one glued to `79`, and this is the third time a currency was spelled into
  `pricing_*` copy.
- A **`-17%`** badge sat on the toggle, four lines below the comment forbidding
  percentages. It now reads `pricingpage_annual_badge` ("2 months free").

`effectiveMonthly` rounds **up**: `Math.round` understated it (MYR Starter
6,583 × 12 = 78,996 against a 79,000 charge), and a seller multiplying the small
number by twelve must never land under the bill. Same
strictly-true-beats-tightest rule as `starterPricePerDay`.

**Where annual is actually sold:** the seller's Settings → Billing tab — the
self-serve plan picker for anyone choosing a plan, and the annual card for
proven monthly payers on **Pro and Scale** (a prefilled WhatsApp message).
Annual sellers are granted credits **monthly**, never twelve months at once, at
the grant locked for the year they paid for (`creditAccounts.annualGrant`); the
page says so under the toggle. The eligibility ladder,
the swap runbook and the credit-not-refund policy live in
[`manual-subscription.md`](./manual-subscription.md#annual-billing--the-in-app-offer-sep-2026).

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
