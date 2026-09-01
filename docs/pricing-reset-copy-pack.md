# Pricing reset 30 Aug — confirmed numbers + wave-2 copy pack

> **Status: working handoff doc**, owned by ClickUp `z8r3fday21` (Arif, decision + copy)
> with companion `z8r3fday24` (Zaki, backend). Wave 1 (the `/cost` Founding-anchor
> retirement) shipped with this doc; **wave 2 below is GATED on the backend ticket**
> — none of this copy may go live before the billing mechanism it describes exists.
> When wave 2 ships, fold what's durable into [`pricing.md`](./pricing.md) and
> delete this file.

All three moves confirmed by Arif, 1 Sep 2026, against the 30 Aug "Kedaipal
Pricing Reset" artifact.

## 1. Confirmed numbers (Zaki's constants, `convex/lib/plans.ts`)

| Constant | Current | Confirmed |
| --- | --- | --- |
| `PLAN_MONTHLY_PRICES.MYR.scale` | 29900 | **39900** (RM399) |
| `PLAN_MONTHLY_PRICES.SGD.scale` | 11900 | **14900** (S$149) |
| `OUTLET_ADDON_MONTHLY_PRICES.SGD` | 1900 (UNCONFIRMED) | **1800** (S$18, per the reset artifact; MYR 4900 holds) |
| `HOLD_MONTHLY_PRICES` (new) | — | **`{ MYR: 1900, SGD: 900 }`** (RM19 / S$9) — frontend renders the Hold price from this, so the `pricing-copy.test.ts` currency-literal guard keeps holding |
| `TRIAL_DAYS = 14` | calendar trial | reinterpreted: **first invoice on first live order or day 15, whichever first** (day-15 backstop = the existing day-14 trial end + invoice) |

Starter 7900/2900 and Pro 14900/5900 hold. Founding constants stay (existing
members keep their rate) but no new signup path may reach them.

**Off-Season Hold is a subscription STATUS, not a `Plan`** — do not widen the
`Plan` union, `PLANS`, `TIER_FACTS` or the feature matrix. Semantics: bills
RM19/S$9 while held, effective order cap 0 ("ordering off" — storefront checkout
closed at the UI level, never a hard block on the order pipeline), storefront +
catalog + buyer list + order history stay live, one-tap resume to the prior tier.

## 2. Start-when-you-sell — public copy replacements (wave 2, this ticket)

Framing rule: the promise is **"free until you sell"** — full product from day
one, the first invoice fires on the **first live order or day 15, whichever
comes first**. Never call it a trial-with-a-deadline; the deadline is the
backstop, the order is the trigger.

### Landing (`messages/*.json`)

| Key | en (new) | ms (new) | zh (new) |
| --- | --- | --- | --- |
| `nav_start_free` | Start free | Mula percuma | 免费开始 |
| `hero_trust` | Free until your first order · No credit card · No Meta setup · Live in 5 minutes | Percuma sehingga pesanan pertama · Tiada kad kredit · Tiada setup Meta · Hidup dalam 5 minit | 收到第一笔订单前完全免费 · 无需信用卡 · 无需 Meta 设置 · 5 分钟即可上线 |
| `pricing_sub` | Start free on every plan — your first bill only comes when your first live order does, or on day 15. No credit card to start. Kedaipal never touches your order money — your customers pay you directly. | Mula percuma untuk setiap pelan — bil pertama anda hanya tiba bila pesanan pertama masuk, atau pada hari ke-15. Tiada kad kredit untuk bermula. Kedaipal tidak pernah sentuh wang pesanan anda — pelanggan bayar terus kepada anda. | 每个方案都免费开始 —— 第一张账单只在您收到第一笔订单（或第 15 天）时才产生。开始不需要信用卡。随时取消，随时导出您的资料。 |
| `pricing_cta` | Start free — pay when you sell | Mula percuma — bayar bila anda menjual | 免费开始 —— 有生意才付费 |
| `faq_q_8` | When do I start paying? | Bila saya mula membayar? | 我什么时候开始付费？ |
| `faq_a_8` | You get the full product free from day one — no credit card. Your first invoice only fires when you take your first live order, or on day 15, whichever comes first. Cancel any time before that and pay nothing. | Anda dapat produk penuh percuma dari hari pertama — tiada kad kredit. Invois pertama anda hanya dikeluarkan bila anda terima pesanan pertama, atau pada hari ke-15, mana yang dulu. Batalkan bila-bila masa sebelum itu dan tak perlu bayar apa-apa. | 从第一天起就能免费使用完整产品 —— 不需要信用卡。第一张发票只在您收到第一笔订单（或第 15 天，以先到者为准）时才开出。在那之前随时取消，完全不收费。 |
| `final_sub` | Free until you sell. No credit card. No Meta setup. Your storefront is live in 5 minutes. | Percuma sehingga anda menjual. Tiada kad kredit. Tiada setup Meta. Etalase anda hidup dalam 5 minit. | 有生意才付费。不需要信用卡。不用设置 Meta。您的商店 5 分钟内就能上线。 |
| `final_cta` | Start free — pay when you sell | Mula percuma — bayar bila anda menjual | 免费开始 —— 有生意才付费 |

### `/pricing` (`pricingpage_*`)

| Key | en (new) | ms (new) | zh (new) |
| --- | --- | --- | --- |
| `pricingpage_hero_highlight` | Free until you sell. | Percuma sehingga anda menjual. | 有生意才付费。 |
| `pricingpage_hero_sub` | Try every Pro feature free — no credit card, no Meta setup. Your first invoice comes with your first live order, or on day 15, whichever comes first. | Cuba setiap ciri Pro percuma — tiada kad kredit, tiada persediaan Meta. Invois pertama anda tiba bersama pesanan pertama, atau pada hari ke-15, mana yang dulu. | 免费试用所有 Pro 功能 —— 不需要信用卡，不用设置 Meta。第一张发票随您的第一笔订单（或第 15 天，以先到者为准）才产生。 |
| `pricingpage_cta_trial` | Start free — pay when you sell | Mula percuma — bayar bila anda menjual | 免费开始 —— 有生意才付费 |
| `pricingpage_faq_q5` | When do I start paying? | Bila saya mula membayar? | 我什么时候开始付费？ |
| `pricingpage_faq_a5` | You get full access to Pro features free — no credit card to start. Your first invoice fires when you take your first live order, or on day 15, whichever comes first; then pick the plan that fits (Starter, Pro, or Scale) to keep going. Cancel any time before that and pay nothing. | Anda dapat akses penuh ciri Pro secara percuma — tiada kad kredit untuk mula. Invois pertama dikeluarkan bila anda terima pesanan pertama, atau pada hari ke-15, mana yang dulu; kemudian pilih pelan yang sesuai (Starter, Pro, atau Scale) untuk teruskan. Batalkan bila-bila masa sebelum itu dan tak perlu bayar apa-apa. | 您可以免费完整使用所有 Pro 功能 —— 开始不需要信用卡。第一张发票在您收到第一笔订单（或第 15 天，以先到者为准）时开出；之后选择适合的方案（Starter、Pro 或 Scale）继续使用。在那之前随时取消，完全不收费。 |
| `pricingpage_cta_heading` | Start free. Pay when you sell. | Mula percuma. Bayar bila anda menjual. | 免费开始。有生意才付费。 |
| `pricingpage_cta_sub` | No credit card. No Meta setup. Full access from day one — your first bill waits for your first order (or day 15). Cancel anytime and keep your data. | Tiada kad kredit. Tiada persediaan Meta. Akses penuh dari hari pertama — bil pertama anda menunggu pesanan pertama (atau hari ke-15). Batalkan bila-bila masa dan data anda kekal milik anda. | 不需要信用卡。不用设置 Meta。从第一天起就有完整使用权限 —— 第一张账单等到您的第一笔订单（或第 15 天）才产生。随时可以取消，资料始终归您所有。 |
| `pricingpage_cta_trial_btn` | Start free — pay when you sell | Mula percuma — bayar bila anda menjual | 免费开始 —— 有生意才付费 |

### SEO / structured data (hardcoded, moves WITH the RM399 constant)

- `src/routes/pricing.tsx` `SEO_DESC`: "Simple, transparent pricing for WhatsApp
  sellers. Start free — pay when you sell. Starter RM79/mo, Pro RM149/mo, Scale
  RM399/mo flat — S$ pricing for Singapore." (SEO desc keeps currency by design,
  see `pricing.md`.)
- `src/routes/index.tsx`: landing `SEO_DESC` drops "14-day free trial" for
  "free until you sell"; JSON-LD `highPrice: "299"` → `"399"`, offer
  `description` → "Free until your first order, no credit card required".

## 3. Off-Season Hold — card copy (wave 2, this ticket)

A **fourth card on `/pricing` only**, visually consistent with the tier cards
but data-separate (it is a status, not a plan — no signup CTA). The landing
teaser gets a one-line strip under the 3-card grid, not a fourth card: the
teaser converts new sellers, Hold retains existing ones.

New keys (price always a `{price}` param from `HOLD_MONTHLY_PRICES` — never a
literal, the currency guard stays intact):

| Key | en | ms | zh |
| --- | --- | --- | --- |
| `pricingpage_hold_name` | Off-Season Hold | Rehat Luar Musim | 淡季保留 |
| `pricingpage_hold_tagline` | Between seasons? Keep everything warm for {price}/mo — ordering switched off, one tap to reopen. | Di luar musim? Simpan semuanya untuk {price}/bulan — pesanan ditutup, satu ketukan untuk buka semula. | 淡季期间？每月 {price} 为您保留一切 —— 暂停接单，一键即可重新开张。 |
| `pricingpage_hold_keeps` | Your storefront, catalog, buyer list and order history stay live | Etalase, katalog, senarai pembeli dan sejarah pesanan anda kekal hidup | 您的商店、目录、买家名单和订单记录都保持在线 |
| `pricingpage_hold_off` | New orders are paused — buyers see your store, not a dead link | Pesanan baharu dijeda — pembeli nampak kedai anda, bukan pautan mati | 暂停接收新订单 —— 买家看到的是您的商店，而不是失效链接 |
| `pricingpage_hold_resume` | Switch it on from Settings → Billing when your season ends; one tap brings your plan back. | Aktifkan dari Tetapan → Pengebilan bila musim anda tamat; satu ketukan kembalikan pelan anda. | 季节结束后到 设置 → 账单 开启；一键即可恢复原方案。 |
| `pricing_hold_line` (teaser strip) | Seasonal seller? Pause for {price}/mo between seasons — your storefront stays live. | Penjual bermusim? Jeda untuk {price}/bulan di luar musim — etalase anda kekal hidup. | 季节性卖家？淡季每月 {price} 暂停 —— 商店保持在线。 |

FAQ addition (`/pricing`): **"What if I only sell part of the year?"** → "Switch
to Off-Season Hold for {price}/mo: ordering pauses but your storefront, catalog
and buyer list stay live, so the season restart is one tap — not a new setup."
(+ ms/zh parity, drafted at implementation.)

## 4. Dashboard + email copy (Zaki's branch consumes these — do not double-edit)

The mechanism changes the meaning of every "trial ends in N days" surface, so
this copy lands **with the backend**, in `z8r3fday24`:

- `subscription-banner.tsx` — amber: "Your free period ends in {days} — take
  your first order any time; billing starts then." · red/ended: "Your free
  period has ended. Choose a plan to continue — your storefront stays live."
- `billing-tab.tsx` chip + `TierPill` — "Free · until first order" /
  "Free · {d} day(s) left" once the backstop is the only clock left.
- `app.index.tsx` checklist step — "You're free until your first live order
  (or day 15). Your first invoice starts your plan — nothing to do before then."
- `billingEmailCopy.ts` (en/ms/zh × 3) — `trialEndingSoon` → "your free period
  ends in {days} — your first order starts your plan"; `trialEnded` keeps its
  storefront-stays-live promise. Exact strings drafted in Zaki's PR against the
  real state machine; the framing rule from §2 binds.
- Off-Season Hold seller UI (Settings → Billing switch, banner while held,
  resume flow) is designed in Zaki's ticket; the discoverability rule stands —
  the pause must be visible where billing lives, with the stays-live list.

## 5. Coordination gates (before wave 2 merges)

1. `z8r3fday24` constants + trial rework + hold status landed.
2. `86eyb9zwt` (Scale reposition, production in review, still RM299) fast-followed
   with RM399 — must not close stale.
3. Meta October service rates re-checked against the margin model (artifact lock
   item, due before the new list goes live).
4. `docs/pricing.md` price table + trial CTA rules updated in the same PR;
   `docs/onboarding.md` locked-pricing line; `PROJECT_CONTEXT.md` pricing table.
