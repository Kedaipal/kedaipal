# Pricing surface — tiers, Scale multi-outlet, Enterprise-hidden

The public pricing presentation. Backend caps + billing live in
[`manual-subscription.md`](./manual-subscription.md); this doc is the **display**
contract. Scale's multi-outlet repositioning tracked in ClickUp `86eyb9zwt`
(supersedes the reseller-banded positioning from `86ey4gaju`).

## Where it renders

- **`src/routes/pricing.tsx`** — the full `/pricing` page: tier cards + feature
  comparison table + FAQ.
- **`src/components/landing/pricing-teaser.tsx`** — the landing-page teaser; same
  three tiers, links to the full page.
- Copy lives in `messages/en.json` + `messages/ms.json` (`pricing_*` for the
  teaser, `pricingpage_*` for the full page). Both locales are kept in lockstep —
  no mid-card English fallback.

## The three public tiers

| Tier | Price | Positioning | Orders (soft) | Seats | Outlets |
| --- | --- | --- | --- | --- | --- |
| **Starter** | RM79/mo | Single home seller, just starting | 100/mo | 1 | 1 |
| **Pro** | RM149/mo (founding RM104) | Established single shop | 500/mo | 2 | 1 |
| **Scale** | **RM299/mo flat — Coming soon** (founding RM209) | Multi-outlet / team seller | 2,000/mo | 5 | Up to 3 (+RM49/mo each additional) |

All three prices are **flat** — no metering of any kind (Arif, 19 Jul 2026). The
1 Jul ICP audit disqualified reseller/wholesale networks; our real payers outgrow
Pro on **outlets and team size** (the StoreHub axis), so Scale is the multi-outlet
tier. All reseller-band copy, the band table, and its i18n keys were **removed**
(the old `src/lib/resellerBands.ts` + `reseller-band-table.tsx` are deleted).

Presentation rules:

- Every card, Scale included, follows the **monthly/annual toggle** (annual =
  10 months paid / 12 received, same formula for all tiers — Scale RM249/mo
  billed annually). Flat pricing makes the annual number honest.
- Scale is **not purchasable**: the CTA is a disabled **"Coming soon"** panel
  (trials are Pro-only), on both the full page and the teaser.
- Displayed numbers **match `PLAN_CAPS`** (`convex/lib/plans.ts`): orders
  100/500/2,000, seats 1/2/5, broadcasts –/100/500. No "Unlimited" anywhere —
  the pricing table must never contradict shipped code.
- The comparison table carries an **Insights row** (Starter –, Pro ✓, Scale ✓,
  live — no Coming soon badge): the strongest shipped Pro differentiator. The
  old "Sales reports" row was deleted per the 11 Jul Insights tiering decision.
- Scale-only rows (multi-outlet/Outlets "Up to 3", custom domain, production
  calendar, priority support) carry **Coming soon** badges until the Scale build
  ships. The "Additional outlets RM49/mo each" line is display copy only — the
  billing lever ships with the Scale build.
- Founding is generic across plans: `FOUNDING_MONTHLY_PRICE` covers pro (RM104)
  + scale (RM209), 30% lifetime — not hardcoded to Pro.

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
