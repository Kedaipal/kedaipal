# Pricing surface — tiers, Scale banding, Enterprise-hidden

The public pricing presentation. Backend caps + billing live in
[`manual-subscription.md`](./manual-subscription.md); this doc is the **display**
contract. Repositioning tracked in ClickUp `86ey4gaju`.

## Where it renders

- **`src/routes/pricing.tsx`** — the full `/pricing` page: tier cards + feature
  comparison table + FAQ.
- **`src/components/landing/pricing-teaser.tsx`** — the landing-page teaser; same
  three tiers, links to the full page.
- **`src/lib/resellerBands.ts`** — single source of truth for the Scale band table
  (299 / 499 / 799 / custom), shared by both surfaces so the numbers can't drift.
- **`src/components/landing/reseller-band-table.tsx`** — the shared band-table UI.
- Copy lives in `messages/en.json` + `messages/ms.json` (`pricing_*` for the
  teaser, `pricingpage_*` for the full page). Both locales are kept in lockstep —
  no mid-card English fallback.

## The three public tiers

| Tier | Price | Positioning | Orders (display) | Seats |
| --- | --- | --- | --- | --- |
| **Starter** | RM79/mo | Single home seller, just starting | 100/mo | 1 |
| **Pro** | RM149/mo (founding RM104) | Established single shop | 500/mo | 2 |
| **Scale** | **from RM299/mo — Coming soon** | Supplier / distributor with a reseller network | **Unlimited** | 5 |

Pro copy deliberately **does not** imply reseller/wholesale features — those are
Scale's differentiator.

## Scale = banded supplier tier (Coming soon)

Scale is priced on **active resellers** (a reseller who placed ≥1 order that
month), in bands, not a live per-seat meter:

| Active resellers | Price/mo |
| --- | --- |
| Up to 10 | RM299 |
| 11–30 | RM499 |
| 31–75 | RM799 |
| 75+ | Custom (talk to us) |

Presentation rules:

- The Scale card anchors on **"from RM299"** and **ignores the monthly/annual
  toggle** — an annual number would be misleading before banded billing exists.
- The card is **not purchasable**: the CTA is a disabled **"Coming soon"** panel
  (trials are Pro-only), on both the full page and the teaser.
- **"Unlimited orders / broadcasts"** is copy only. The backend cap stays
  `PLAN_CAPS.scale = 2000/5/500` until the separate Scale build (active-reseller
  counting + banded billing) ships and flips Scale to purchasable. Founding on
  Scale follows the band the member lands on (RM209 / 349 / 559) — founding price
  logic is not hardcoded to Pro (`FOUNDING_MONTHLY_PRICE` covers pro + scale).

## Enterprise — hidden

Enterprise is drafted in strategy (quote-based ceiling) but must **not** appear on
any public or in-app pricing surface yet (ICP is still F&B home sellers). There is
**no** `enterprise` plan enum — the exposed set is exactly `starter | pro | scale`
(`convex/lib/plans.ts`, guarded by a test in `plans.test.ts`). The
`UNLIMITED`/`isUnlimited` sentinel stays exported for that future tier but no v1
plan uses it.

## Mobile-first

Cards stack single-column and the band table is 2 columns only, so nothing scrolls
horizontally on a phone; tap targets stay ≥44px.
