# Pricing surface — Starter, Pro, and Enterprise by conversation

> **1 Oct 2026 (Credits T6 `z8r3fdkp8h`):** **Scale is retired before it ever
> went public; the third tier is Enterprise** — no list price, quoted per deal,
> reached through a "Talk to Arif" WhatsApp chat on every surface that sells a
> plan. A store is on Enterprise only while an admin has attached a contract,
> and every Enterprise invoice and monthly grant is read from that contract.
> Decided by Arif, 30 Sep 2026: Scale at RM399 for 500 credits was Pro plus
> packs under a new name (RM149 + 300 × RM0.80 = RM389), and its only real
> effect was anchoring an enterprise buyer on SME pricing. See
> [Enterprise](#enterprise--a-contract-not-a-price).

> **30 Sep 2026 (Credits T5 `z8r3fdfu31`):** every public allowance is **Kedaipal
> Credits read from `PLAN_CREDIT_GRANT`**, the trial reads **"14 days or 200
> orders from your first order"** wherever the page used to say "14-day free
> trial", `/cost` prices the plan the visitor's volume needs, and no public
> surface mentions the Off-Season Hold. The full map of what each surface says:
> [`credits.md` → Public surfaces](./credits.md#public-surfaces-t5). (T5 also
> opened Scale for purchase, `z8r3fdfuhq`; T6 cancelled that before release.)

> **13 Sep 2026 (`z8r3fdegej`):** `/`'s pricing teaser, hero, nav and closing CTA
> carry the start-when-you-sell copy (no "14-day"), the JSON-LD offer range is
> derived from `PLAN_MONTHLY_PRICES`, and the landing's MY/SG region is one
> shared `LandingRegionProvider` (Delivery + Pricing move together).

The public pricing presentation. Backend caps + billing live in
[`manual-subscription.md`](./manual-subscription.md); this doc is the **display**
contract, plus the Enterprise contract model. The order-allowance numbers come
from the credits ticket `86eye2ccu`.

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
- **Settings → Billing** — the in-app plan picker and plan-change card each
  carry an Enterprise row; a store on a contract sees its contract instead
  ([Enterprise](#enterprise--a-contract-not-a-price)).
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
cards, and a tier card read *"Additional outlets RM49/mo each"* beside S$119.

Enterprise's copy goes further: it carries **no number of its own at all**. The
only figure on the card is where the tier begins, and that arrives as
`{orders}` from `ENTERPRISE_FROM_ORDERS` (1,500) — the same guard fails on a
digit in any Enterprise key.

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
always covers the estimate (`monthlyOrdersFromWeekly`). For every **listed**
tier (Starter and Pro — Enterprise has no price to compare), `recommendPlan`
prices the plan plus the **cheapest whole top-up packs** covering the rest
(`cheapestTopUp` over `CREDIT_PACKS[currency]`), and takes the cheapest; a tie
goes to the **higher** tier (the same money, more credits built in, fewer
top-ups to remember). The leak is then compared against that price — the
savings, the ratio ("5.7× what Kedaipal costs you" — the plan plus its top-ups,
never "your subscription"), the "not worth it yet" verdict and the WhatsApp
message all name it. **The sticky CTA is the one exception:** it quotes the
recommended PLAN at the plan's own price ("Start with Pro — RM149/mo"), because
a plan-plus-top-ups total on a "Start" button reads like a plan price that
doesn't exist (Zaki's test round, 1 Oct 2026). The card above it says what the
top-ups add.

| Orders a week (≈ a month) | MYR | SGD |
| --- | --- | --- |
| 20 (87) | Starter — RM79 | Starter — S$29 |
| 30 (130) | Starter + 1 × 50 credits — RM124, cheaper than Pro at RM149 | Starter + 1 × 50 credits — S$51, cheaper than Pro at S$59 |
| 60 (260) | Pro + 2 × 50 credits — RM239 (ties Starter + 1 × 200) | Pro + 2 × 50 credits — S$103 |
| 130 (564) | Pro + 2 × 200 credits — RM469 | Pro + 2 × 200 credits — S$209 |

When the answer leans on top-ups the card names the **next tier up** it beat
("Cheaper than Pro at RM149/mo"), by its whole option — never a lower tier: at
260 orders Starter + 1 × 200 ties Pro + 2 × 50, and "cheaper than" it would be
false. Above Pro there is no listed tier, so from 151 orders a month on the
card carries no comparison. **Enterprise is never the recommendation**: the
busiest volume the slider expresses (200 a week ≈ 867 a month) is below where
Enterprise begins (`ENTERPRISE_FROM_ORDERS`, 1,500), a test pins that, and
`PlanOption.plan` is typed `ListedPlan` so it can't be offered by accident.

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

Marked `UNCONFIRMED` in `convex/lib/plans.ts`:

- `COMPETITOR_MONTHLY_RANGE.SGD` — S$80–200 (vs RM200–500), the landing
  anchor's comparison band.

(`OUTLET_ADDON_MONTHLY_PRICES` — RM49 / S$18 per extra outlet on Scale — was
quoted nowhere once Scale opened, and went with Scale in T6. Outlets are
Enterprise terms now, priced in the deal when they ship.)

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
| **Enterprise** | **Custom** — "Talk to Arif"; floor RM888/mo (not public) | Built for 1,500+ orders a month | Per contract (HSL: 1,500) | Unlimited | Multiple — **coming soon** |
| *Off-Season Hold* | **RM19/mo · S$9** — a status, not a tier; **never on a public surface** (retired separately, `z8r3fdfuhr`) | A paid seller paused between seasons: ordering off, everything else live, one tap back | 0 | — | — |

The credits column is the **Kedaipal Credits** grant (ClickUp `86eye2ccu`,
[`credits.md`](./credits.md)): `PLAN_CREDIT_GRANT` in `convex/lib/plans.ts`,
from which `PLAN_CAPS.orderCap` is derived — one number, one source. It has
**no Enterprise key**: an Enterprise grant is its contract's included credits,
written to `creditAccounts.grantOverride`. Founding Pro is granted 300 (never
shown publicly) and the free trial 200, one-off. Top-up packs: MY 50 for RM45 /
200 for RM160, SG 50 for S$22 / 200 for S$75 (`CREDIT_PACKS`).

**The type split.** `Plan` is `starter | pro | enterprise`; `ListedPlan`
(`starter | pro`) is what has a list price, a list grant and a self-serve door.
`PLAN_MONTHLY_PRICES`, `PLAN_CREDIT_GRANT`, `annualQuote` and every picker take
`ListedPlan`, so "quote Enterprise a list price" is a compile error rather than a
reviewer's catch. `PLAN_CAPS` and `PLAN_FEATURES` take `Plan` (an Enterprise
store has caps and features like any other).

**Founding pricing (RM104/S$41) is retired** (30 Aug 2026 pricing reset,
ClickUp z8r3fday21): no public surface advertises it any more — a guard in
`landing-redesign.test.ts` now covers `cost_*` too — and existing Founding
Members simply keep their rate (`FOUNDING_MONTHLY_PRICES`, Pro only, stays in
billing for them). Every store is **free until its first live order**; that
order starts **14 days or 200 orders of everything in Pro, whichever comes
first** (Zaki, 30 Sep 2026 — the 14 days is the first invoice's grace,
`INVOICE_DUE_GRACE_DAYS`, and the 200 is `TRIAL_CREDIT_GRANT`), then the seller
picks a plan. A store with no order by day 15 gets its first invoice then (the
backstop), which the FAQ answers name and nothing contradicts. The mechanism
lives in
[`manual-subscription.md`](./manual-subscription.md#start-when-you-sell--off-season-hold-sep-2026-clickup-z8r3fday24)
and [`credits.md`](./credits.md#the-trial-14-days-or-200-orders-whichever-comes-first).
The Off-Season Hold stays an in-product status only — no public surface quotes
it.

Starter and Pro are **flat** — no per-message fees and no cut of the seller's
sales (Arif, 19 Jul 2026). Enterprise is a flat contract fee plus overage blocks
at the contract's rate; still no cut. Volume is bounded by the monthly credits,
not metered per message: a seller who needs more tops up or moves up
([`credits.md`](./credits.md)). The 1 Jul ICP audit disqualified
reseller/wholesale networks; our real payers outgrow Pro on **volume, outlets
and team size**, which is the Enterprise conversation. All reseller-band copy,
the band table, and its i18n keys were **removed** (the old
`src/lib/resellerBands.ts` + `reseller-band-table.tsx` are deleted).

Presentation rules:

- **The annual toggle is live** (`SHOW_ANNUAL_TOGGLE = true` in `pricing.tsx`,
  flipped with the HitPay recurring rails, `86eyb6z4r`). Annual is framed as
  "2 months free", never a percentage. Credits stay monthly on either cycle —
  an annual seller is granted every month, never 12 months upfront
  ([`credits.md`](./credits.md#plan-changes)). See [Annual billing](#annual-billing).
  The Enterprise card ignores the toggle: "Custom" on both cycles.
- **Enterprise is a conversation, never a checkout.** Its card shows
  **"Custom"** where a price would be (in the same box, so the three cards'
  taglines and feature lists line up), "Built for 1,500+ orders a month" as
  its tagline, and a **"Talk to Arif"** button that opens WhatsApp with a prefilled message naming
  the threshold (`enterpriseTalkUrl`, `src/lib/enterprise-contact.ts` — the one
  author of that link on every surface; in-app it also names the store's
  slug). `enterprise_talk_clicked` records the tap with its `surface`
  ([`analytics.md`](./analytics.md)). What it sells TODAY is volume (credits
  sized to the deal) and team (unlimited seats); outlets and the rest keep
  their **Coming soon** badges, and the teaser marks them "Soon" on the card.
- **Tier CTAs are plan-aware for signed-in sellers** (`resolveTierCta` in
  `src/lib/pricing-cta.ts`): signed-out → trial link. For a signed-in seller,
  ownership is judged on **status, not just `plan`** — a trial stamps
  `plan:"pro"` on day one, so `plan` alone is "the tier being trialed", not
  owned. Only an **active** paid subscriber (or a **comped** account) of a tier
  gets the disabled **"Current plan"** pill; a trialing / past_due / cancelled
  seller gets an actionable **"Subscribe"** on every listed tier; an owner of
  another listed tier gets **"Upgrade"** (higher) or **"Manage plan"** (lower).
  The Enterprise card is always **"talk"**, except for an active Enterprise
  store ("Current plan") or a comped one ("Included · you're sponsored"). A
  store **on** a contract gets "talk" on every other card too — changing a
  contract is a conversation, never a billing-tab refusal — and no first-order
  guarantee line under Pro (it has been onboarded). All other actionable CTAs
  route to **Settings → Billing** (`?tab=billing`). While Clerk auth + the plan
  query are still resolving, the purchasable-tier buttons show a **spinner**
  (`Button isLoading`) instead of a label, so a signed-in seller's CTA doesn't
  flip trial → dashboard → final on one refresh — the SSR render is the spinner
  too, so hydration matches. A storeless admin / genuinely-null plan then falls
  back to "Go to Dashboard". The full page reads plan/status via the narrow
  `retailers.getMyPlan` query (not the heavy `getMyRetailer` payload) so a
  marketing route doesn't sign storage URLs just to read an enum; the landing
  teaser stays plan-agnostic (a lighter surface that links here).
- **Order allowances are the credit grants.** One constant (`PLAN_CREDIT_GRANT`)
  feeds the ledger, the credit meter and the in-app plan cards' "{credits}
  credits a month" lines (Credits T3 — `PLAN_CAPS.orderCap` is derived from
  it) and the page — as a `{credits}` placeholder in every catalog line, never
  a literal (`pricing-copy.test.ts` fails on one). Cap numbers stay off the
  hero price; they live in the tier-card credits line ("{credits} credits a
  month — 1 per order") and the comparison table's "Credits a month" row,
  which reads PER MONTH in both toggle positions (Enterprise: "Custom").
- **"Unlimited" is said about exactly one thing: Enterprise's seats**, because
  that cap really is unlimited (`PLAN_CAPS.enterprise.userCap` is `UNLIMITED`).
  `pricing-copy.test.ts` allows the word only in `pricing_feat_team_unlimited`
  and `pricingpage_val_team_unlimited`, in all three locales, and fails if
  either ever mentions orders or credits.
- Each tier card carries **"Flat price. We never take a cut of your sales."** — the
  value posture vs the metered/commission competitors.
- The comparison table carries a live **Insights row** (Starter –, Pro ✓,
  Enterprise ✓, no Coming soon badge): the strongest shipped Pro
  differentiator. The old "Sales reports" row was deleted per the 11 Jul
  Insights tiering decision.
- Enterprise-only rows (Outlets "Multiple", custom domain, production calendar,
  priority support; broadcasts "Custom") carry **Coming soon** badges until
  they ship. No per-outlet add-on price is quoted anywhere.

## Annual billing

**10 months charged, 12 received.** Always "2 months free", never a percentage —
a standing % badge reads as a markdown on a flat price (Arif, 28 Jul + 9 Aug
2026).

`annualQuote(plan, founding, currency)` in `convex/lib/plans.ts` is the **single
author** of every listed annual number: `monthly`, `annualTotal`,
`effectiveMonthly`, `saving`, `monthsFree`. `annualTotal` *is*
`planPrice(plan, "annual", …)`, pinned by a test.

| Tier | MYR/yr | Effective/mo | Saves | SGD/yr | Effective/mo | Saves |
| --- | --- | --- | --- | --- | --- | --- |
| Starter | RM790 | RM65.84 | RM158 | S$290 | S$24.17 | S$58 |
| Pro | RM1,490 | RM124.17 | RM298 | S$590 | S$49.17 | S$118 |
| Enterprise | the contract fee × 10 (`enterprisePrice`) — HSL: RM8,880 | — | — | the same, in SGD | — | — |

An Enterprise **term** is the contract's `billingCycle`: monthly, or a prepaid
year that bills the monthly fee × 10 and locks fee and rate for the year. It is
set on the contract by an admin, never switched self-serve — the annual card
never renders for an Enterprise store (its contract card states the term).

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
proven monthly payers on **Pro** (`ANNUAL_OFFER_PLANS`; a prefilled WhatsApp
message). Annual sellers are granted credits **monthly**, never twelve months
at once, at the grant locked for the year they paid for
(`creditAccounts.annualGrant`); the page says so under the toggle. The
eligibility ladder, the swap runbook and the credit-not-refund policy live in
[`manual-subscription.md`](./manual-subscription.md#annual-billing--the-in-app-offer-sep-2026).

## Enterprise — a contract, not a price

A store is on Enterprise **only while it carries a contract**, and only a
Kedaipal admin can attach one. There is no public price and no self-serve door.
First deal: HSL / Mama's Delights, RM888 a month, 1,500 credits included,
overage RM0.60 in 5,000-credit blocks, annual RM8,880 (closes 6 Oct; month 1
collected by hand, month 2 — 6 Nov — issued by the system).

### The contract (`subscriptions.enterprise`)

| Field | Meaning |
| --- | --- |
| `baseFeeMinor` | The monthly fee, minor units, in the contract's currency |
| `currency` | `MYR` or `SGD` — taken from the store's billing currency when the contract is created, then **frozen**. An SG deal is SGD minor units; nothing is ever converted |
| `includedCredits` | The store's monthly grant (up to `ADMIN_CREDIT_LIMIT`, 100,000) |
| `overageRateMinor` | Per credit, minor units; zero is allowed (a deal can include its blocks) |
| `blockSize` | Credits per overage block (default `ENTERPRISE_BLOCK_SIZE_DEFAULT`, 5,000) |
| `contactName`, `notes` | Admin-internal — never on a seller payload |
| `setBy`, `setAt` | Who last saved it (the form or the grant lever), and when |
| `enteredFrom` | The listed plan and cycle the store was on when the contract was attached — what bought the period still running. Cleared by the first plan bill that settles |

The term is the subscription's own `billingCycle`. Every rule a contract must
meet is one pure function, `enterpriseContractProblem` (`convex/lib/enterprise.ts`),
which the admin form shows beside its disabled button and `enterprise.setContract`
throws — one author for both.

### Setting it — Admin → Billing → seller sheet → Enterprise

`enterprise.setContract` (admin-only, audited as `enterprise.setContract`) in
one mutation:

- flips `plan` to `enterprise` and sets the term;
- on entering, writes Enterprise's caps (unlimited seats), **supersedes any
  scheduled downgrade** — a renewal must bill the contract, not a stale Starter
  — and stamps **`enteredFrom`**: the plan flips here, before any payment, so a
  store that comes on mid-period still has Pro days running, and its first
  contract bill must value them at Pro's price. Carried 1:1 they became
  contract days (25 Pro days worth RM124 turning into 25 days worth RM740; 300
  days of a yearly Pro becoming 300 days of the contract for one RM888);
  `settleInvoicePaid` reads the stamp for its carryover, so 10 Pro days buy 2
  contract days;
- writes `includedCredits` through to **`creditAccounts.grantOverride`** — the
  contract's credits and the grant lever are one field. Raising the number
  lands the difference this month; `credits.adminSetGrantOverride` on an
  Enterprise store edits the contract too, and **clearing** the override is
  refused while the store is on a contract.

It is refused for a **comped** store (end the comp first — and comping a
contract store is refused the other way round, so a store is never both), a
**founding** store (Founding Members stay on Founding Pro — `foundingIntent`
included), a store **on hold**, a store with a pending invoice at **another
tier**, and a **term change** while a contract bill at the other term is open
(settle takes the cycle from the bill, so paying it would silently put the old
term back). One author, `enterpriseTermChangeBlocker`, for the last two. The
form says every one of these before the tap — the admin row carries the open
bill's tier and term, the founding intent, and **`billingCurrency`**, the exact
currency (`renewalCurrency`: last paid bill's, else the country's) the server
freezes a new contract in, so the fee's label can never disagree with what is
stored. It is a page of the seller sheet — the same drill-in as the credit
ledger, one drawer with a back link.

### Billing it

`subscriptionPrice(plan, cycle, { founding, currency, enterprise })` is the one
author of a subscription's price: listed tiers go through `planPrice`,
Enterprise through `enterprisePrice` (the fee, × 10 for a prepaid year).
**Founding never applies.** Renewal issuance, `renewalQuote` (the pre-charge
notice and the billing tab's next-renewal line) and admin `issueInvoice` all
read it; an Enterprise row with no contract throws rather than bill something
invented. `insertPendingInvoice` takes an Enterprise bill's fee, currency **and
term** from the contract whatever its caller passed — the first-invoice path only
ever knew "monthly", so a trialing store on a yearly contract would have been
billed a month and then had its term rewritten at settle. That first bill gets
the plain "invoice issued" email, never the "your first invoice is for Pro —
switch before you pay" variant, and the free-period reminder skips a contract
store for the same reason. The invoice PDF's line reads **"Kedaipal Enterprise
Contract - Monthly Fee"** (or Annual; `subscriptionLineLabel`) and the email
calls it **"Enterprise contract · Monthly"** (`invoicePlanLabel`) — the
contract, never a plan price. Auto-renewal and Pay-now work exactly as for Pro:
HitPay charges the invoice total.

### Overage blocks

v1 is manual and on purpose: Arif raises a **manual invoice** for a block, and
once it's paid an admin lands it with `credits.adminAdjust` into the
**purchased** bucket with reason **`enterprise_block`** (contract stores only,
positive amounts only). The reason is what keeps a block apart from an ordinary
adjustment: the seller's activity list reads "Enterprise block — extra credits
under your contract", and the admin tile's "Unused bought credits" counts it as
service still owed, like any pack. The tile does **not** sum blocks as revenue —
the money is invoiced outside the system, and totalling block credits needs a
counter rather than a ledger scan (follow-up, once there is a second contract to
count). Blocks are bought credits like any pack: 12 months, spent after the
monthly credits. A **self-serve block
purchase is not built**. What the seller is told: their contract card states
"Blocks of 5,000 at RM0.60 a credit — RM3,000 a block", and the top-up dialog
names the same rate beside the packs with an "Ask us for a block" chat
(`topUpOptions.contractBlock`) — the owner only; a teammate or an acting admin
is told whose call it is. The 50/200 packs stay on sale to a contract store:
a small top-up late in a month is still a top-up.

### Running out

Same lock rules as Pro unless comped (`creditLockExemption`). A contract store
is never nudged to move up — `upgradeHint` is Starter-only and the running-low
email's plan line is too.

### The way off: a scheduled move to Pro

Clearing a contract outright is never offered — an Enterprise store must always
have one. An admin **schedules a move to Pro** (`enterprise.scheduleMoveToPro`,
audited), refused while any bill is open — paid, it would carry the store past
the date the move promises. The renewal then bills Pro **on the contract's own
term** (a yearly contract moves to a year of Pro; the confirm dialog says which,
with the price), and that bill's emails quote Pro's 200 credits, not the
contract's 1,500 still on the account. When it **settles**, `settleInvoicePaid`
clears the contract and its grant override **in the same mutation** — this
month's credits stay; the next month is Pro's allowance, and seats fall back to
Pro's (the existing drop-on-downgrade rules apply). The seller's contract card
states the move and its date; the admin sheet says "billed as INV-…" once the
renewal has issued it.

**Calling it off** (`enterprise.cancelMoveToPro`, audited) works before and
after the renewal: before, it clears the flag; after, the move IS the open Pro
bill, so it voids that bill too and the next daily run bills the contract. A
**plain void** of the move's bill does NOT call the move off — it re-arms it
(`voidInvoice` never deletes a scheduled change; see
[`manual-subscription.md`](./manual-subscription.md)) — so an unrelated void can
never quietly keep a customer on a contract they're leaving, or auto-charge them
RM888 for it. With nothing to call off, it says so instead of a false success.

### What the seller sees

- **Settings → Billing, on a contract:** `EnterpriseContractCard` — the fee
  and term ("RM888.00 a month", or "RM8,880.00 a year · RM888.00 a month, 2
  months free"), the included credits, the block price, the renewal date, any
  scheduled move to Pro, and "Need a block or a change? Message us" (a chat that
  names the store). It **replaces** the plan picker and the plan-change card;
  the annual card and the Off-Season Hold card don't render.
- **Settings → Billing, everyone else (except Founding Members):** an
  Enterprise row closes the plan picker and the plan-change card — "Built for
  1,500+ orders a month — credits sized to your volume and unlimited teammates,
  priced per deal", with "Talk to Arif". It sits **after** the pick →
  consequence → Subscribe run, never inside it. For a viewer who can't change
  billing (an admin acting-as, a teammate with billing READ) every Enterprise
  chat is a disabled button with the owner-only reason beside it — the house
  act-as rule: only the support card may open WhatsApp.
- **Every self-serve door refuses a contract store with one sentence**
  (`ENTERPRISE_SELF_SERVE_REFUSAL`): `subscribeSelf`, `changePlan`,
  `switchPendingPlan`, `cancelPlanChange` and `setSeasonalHold` (a hold bills
  Kedaipal's list hold price, which no contract agreed to — a contract pauses
  by agreement). An Enterprise invoice has nowhere to switch to.

### Deviations from the ticket, and why

- **The term is `billingCycle`, not a new `termMonths`.** Every issuance, quote
  and renewal path already keys on `billingCycle` (monthly = a 1-month term,
  annual = 12 months prepaid); a second field meaning the same thing would be
  two sources of truth.
- **The contract carries its `currency`.** The ticket said "currency from the
  store"; a store's billing currency can change (`renewalCurrency` follows the
  last paid invoice), and a contract agreed in SGD must stay SGD. Frozen at
  creation.
- **No `multiOutlet` / `prioritySupport` flags on `PLAN_FEATURES.enterprise`.**
  `PlanFeatures` is, by its own rule, only for features that are LIVE —
  coming-soon rows don't belong there until they ship, and a flag with no
  reader is dead code. Enterprise's entitlements today are Pro's features plus
  unlimited seats (`PLAN_CAPS.enterprise.userCap`). Broadcast quota is Pro's
  until broadcasts ship, when the contract decides it.
- **`includedCredits` is capped at 100,000** — the credit ledger's own grant
  ceiling (`ADMIN_CREDIT_LIMIT`), so the contract can never hold a number the
  grant lever would refuse.

### Schema, and the one prod check

`Plan` narrowed from `starter | pro | scale` to `starter | pro | enterprise` on
`subscriptions.plan`, `pendingPlanChange.plan`, `invoices.plan` and
`foundingMembers.plan` (`pro` only now), with `creditLedger.reason` gaining
`enterprise_block`. Widen → verify → narrow happens **in this one PR only
because prod holds zero `scale` rows** — the count must be verified on prod
before this deploys (the query is in the PR body). No backfill.

## Mobile-first

Cards stack single-column, the comparison table scrolls inside its own container,
and tap targets stay ≥44px. The in-app Enterprise row stacks its button under
the text below `sm`.
