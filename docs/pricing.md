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
- Copy lives in `messages/en.json` + `messages/ms.json` + `messages/zh.json`
  (`pricing_*` for the teaser, `pricingpage_*` for the full page). All three
  locales are kept in lockstep — the i18n parity test fails otherwise, and a card
  must never fall back to English mid-render.

## The three public tiers

| Tier | Price | Positioning | Orders (display) | Seats | Outlets |
| --- | --- | --- | --- | --- | --- |
| **Starter** | RM79/mo | Single home seller, just starting | 100/mo | 1 | 1 |
| **Pro** | RM149/mo (founding RM104) | Established single shop | 200/mo | 2 | 1 |
| **Scale** | **RM299/mo flat — Coming soon** (founding RM209) | Multi-outlet / high-volume seller | ~400/mo | 5 | Up to 3 (+RM49/mo each additional) |

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
- **Order allowances lead enforcement.** The page advertises the *decided*
  allowances — **Starter 100 / Pro 200 / Scale ~400** (caps ticket `86eye2ccu`) —
  ahead of the soft-cap meter that ticket ships. `PLAN_CAPS.scale.orderCap` still
  reads 2,000 until then, so copy and the constant deliberately diverge. The page
  never advertises a number the business can't hold, and never shows "Unlimited".
  Cap numbers stay off the hero price; they live in the tier-card allowance line
  and the comparison table.
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
  scale (RM209), 30% lifetime — not hardcoded to Pro.

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
