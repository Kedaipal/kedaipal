# Pricing reset 30 Aug — confirmed numbers + wave-2 copy pack

> **Status: working handoff doc**, owned by ClickUp `z8r3fday21` (Arif, decision + copy)
> with companion `z8r3fday24` (Zaki, backend). Wave 1 (the `/cost` Founding-anchor
> retirement) shipped with this doc. **The backend landed 9 Sep 2026** (z8r3fday24,
> stacked on the `86eyb6z4r` auto-renewal PR): constants, start-when-you-sell, the
> Off-Season Hold status, and the dashboard/email copy from §4 — so **wave 2 is
> unblocked**. Two backend decisions the copy must match: the first invoice bills
> **Pro** (the trialed tier), switchable to Starter before paying; and a paused
> store's ordering is refused **server-side** on every order-create path, not just
> hidden in the UI. When wave 2 ships, fold what's durable into
> [`pricing.md`](./pricing.md) and delete this file.

All three moves confirmed by Arif, 1 Sep 2026, against the 30 Aug "Kedaipal
Pricing Reset" artifact.

> **30 Sep 2026 — superseded in part by Credits T5 (`z8r3fdfu31`).** The trial
> changed shape (Zaki, 30 Sep): free until the first order, then **14 days or
> 200 orders** of everything in Pro, whichever comes first. The `/pricing` rows
> in §2 and the landing's `pricing_sub` / `faq_a_8` shipped in T5 with that
> model and with Kedaipal Credits — the tables below now show the SHIPPED copy
> for those keys, `{placeholders}` and all. **§3 (the Off-Season Hold card and
> teaser strip) will not ship**: no public surface mentions the Hold (the
> credits decision; the status itself is retired in `z8r3fdfuhr`). The
> authoritative map of public credits copy is
> [`credits.md` → Public surfaces](./credits.md#public-surfaces-t5).

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

> **Landing rows shipped 13 Sep 2026** in `z8r3fdegej` (landing v2), verbatim.
> The `/pricing` rows below are still open here.

Framing rule: the promise is **"free until you sell"** — full product from day
one, the first invoice fires on the **first live order or day 15, whichever
comes first**. Never call it a trial-with-a-deadline; the deadline is the
backstop, the order is the trigger.

### Landing (`messages/*.json`)

| Key | en (new) | ms (new) | zh (new) |
| --- | --- | --- | --- |
| `nav_start_free` | Start free | Mula percuma | 免费开始 |
| `hero_trust` _(retired in landing v2 — the trust line's render site was cut with the old hero; kept here as the record of the copy)_ | Free until your first order · No credit card · No Meta setup · Live in 5 minutes | Percuma sehingga pesanan pertama · Tiada kad kredit · Tiada setup Meta · Hidup dalam 5 minit | 收到第一笔订单前完全免费 · 无需信用卡 · 无需 Meta 设置 · 5 分钟即可上线 |
| `pricing_sub` _(T5, 30 Sep)_ | Start free on every plan — no credit card. Your first order gives you {days} days or {orders} orders, whichever comes first, to try everything in Pro; then you pick your plan. Kedaipal never touches your order money — your customers pay you directly. | Mula percuma untuk setiap pelan — tiada kad kredit. Pesanan pertama anda memberi {days} hari atau {orders} pesanan, mana yang dahulu, untuk mencuba semua ciri Pro; kemudian anda pilih pelan. Kedaipal tidak pernah sentuh wang pesanan anda — pelanggan bayar terus kepada anda. | 每个方案都免费开始 —— 不需要信用卡。从第一笔订单起，您有 {days} 天或 {orders} 张订单（以先到者为准）免费体验 Pro 的全部功能，之后再选择方案。Kedaipal 从不经手您的订单款项 —— 顾客直接付款给您。 |
| `pricing_sub_credits` _(new, T5)_ | Every plan includes a monthly order allowance — 1 credit per order, with top-ups for a busy month. | Setiap pelan termasuk peruntukan pesanan bulanan — 1 kredit setiap pesanan, dan boleh tambah kredit pada bulan sibuk. | 每个方案每月都包含订单额度 —— 每张订单用 1 点，旺季不够还可以充值。 |
| `pricing_cta` | Start free — pay when you sell | Mula percuma — bayar bila anda menjual | 免费开始 —— 有生意才付费 |
| `faq_q_8` | When do I start paying? | Bila saya mula membayar? | 我什么时候开始付费？ |
| `faq_a_8` _(T5, 30 Sep — literal numbers: FAQ answers render param-less for the FAQPage mirror, pinned to the constants by `landing-redesign.test.ts`)_ | Not until you sell. Sign up and set up free, with no credit card. Your first live order gives you 14 days or 200 orders — whichever comes first — to try everything in Pro, and brings your first invoice, due when those 14 days are up: pick your plan and pay it then. Haven't sold by day 15? The invoice comes anyway, on the same terms. Cancel before paying and you owe nothing. | Tidak sehingga anda menjual. Daftar dan sediakan kedai secara percuma, tanpa kad kredit. Pesanan pertama anda memberi 14 hari atau 200 pesanan — mana yang dahulu — untuk mencuba semua ciri Pro, dan membawa invois pertama anda, yang perlu dibayar bila 14 hari itu tamat: pilih pelan anda dan bayar ketika itu. Belum ada jualan menjelang hari ke-15? Invois tetap tiba, dengan syarat yang sama. Batalkan sebelum membayar dan anda tidak berhutang apa-apa. | 有生意才需要付费。免费注册、免费设置，不需要信用卡。您的第一笔订单会给您 14 天或 200 张订单（以先到者为准）免费体验 Pro 的全部功能，同时开出第一张发票，在这 14 天结束时到期：届时选择方案并付款即可。到第 15 天还没有订单？发票也会照常开出，条件相同。付款前取消，完全不收费。 |
| `final_sub` | Free until you sell. No credit card. No Meta setup. Your storefront is live in 5 minutes. | Percuma sehingga anda menjual. Tiada kad kredit. Tiada setup Meta. Etalase anda hidup dalam 5 minit. | 有生意才付费。不需要信用卡。不用设置 Meta。您的商店 5 分钟内就能上线。 |
| `final_cta` | Start free — pay when you sell | Mula percuma — bayar bila anda menjual | 免费开始 —— 有生意才付费 |

### `/pricing` (`pricingpage_*`) — shipped 30 Sep 2026 in T5

The `{days}` / `{orders}` / `{backstopDay}` placeholders are
`INVOICE_DUE_GRACE_DAYS` / `TRIAL_CREDIT_GRANT` / `TRIAL_DAYS + 1`.

| Key | en (new) | ms (new) | zh (new) |
| --- | --- | --- | --- |
| `pricingpage_hero_highlight` | Free until you sell. | Percuma sehingga anda menjual. | 有生意才付费。 |
| `pricingpage_hero_sub` | No credit card, no Meta setup. Your first order gives you {days} days or {orders} orders — whichever comes first — to try everything in Pro. Then pick the plan that fits. | Tiada kad kredit, tiada persediaan Meta. Pesanan pertama anda memberi {days} hari atau {orders} pesanan — mana yang dahulu — untuk mencuba semua ciri Pro. Kemudian pilih pelan yang sesuai. | 不需要信用卡，不用设置 Meta。从第一笔订单起，您有 {days} 天或 {orders} 张订单（以先到者为准）免费体验 Pro 的全部功能，之后再选择适合的方案。 |
| `pricingpage_cta_trial` | Start free — pay when you sell | Mula percuma — bayar bila anda menjual | 免费开始 —— 有生意才付费 |
| `pricingpage_faq_q5` | When do I start paying? | Bila saya mula membayar? | 我什么时候开始付费？ |
| `pricingpage_faq_a5` | Not until you sell — sign up free, no credit card. Your first order gives you {days} days or {orders} orders, whichever comes first, to try everything in Pro, and brings your first invoice: pick Starter, Pro or Scale and pay it before those {days} days are up. Haven't sold by day {backstopDay}? The invoice comes then instead, on the same terms. Cancel before paying and you owe nothing. | Tidak sehingga anda menjual — daftar percuma, tanpa kad kredit. Pesanan pertama anda memberi {days} hari atau {orders} pesanan, mana yang dahulu, untuk mencuba semua ciri Pro, dan membawa invois pertama anda: pilih Starter, Pro atau Scale dan bayar sebelum {days} hari itu tamat. Belum ada jualan menjelang hari ke-{backstopDay}? Invois tiba ketika itu, dengan syarat yang sama. Batalkan sebelum membayar dan anda tidak berhutang apa-apa. | 有生意才需要付费 —— 免费注册，不需要信用卡。您的第一笔订单会给您 {days} 天或 {orders} 张订单（以先到者为准）免费体验 Pro 的全部功能，同时开出第一张发票：在这 {days} 天结束前选择 Starter、Pro 或 Scale 并付款即可。到第 {backstopDay} 天还没有订单？发票会在当天开出，条件相同。付款前取消，完全不收费。 |
| `pricingpage_cta_heading` | Start free. Pay when you sell. | Mula percuma. Bayar bila anda menjual. | 免费开始。有生意才付费。 |
| `pricingpage_cta_sub` | No credit card. No Meta setup. Your first order gives you {days} days or {orders} orders to try everything in Pro — cancel anytime and keep your data. | Tiada kad kredit. Tiada persediaan Meta. Pesanan pertama anda memberi {days} hari atau {orders} pesanan untuk mencuba semua ciri Pro — batalkan bila-bila masa dan data anda kekal milik anda. | 不需要信用卡。不用设置 Meta。第一笔订单起有 {days} 天或 {orders} 张订单免费体验 Pro 的全部功能 —— 随时可以取消，资料始终归您所有。 |
| `pricingpage_cta_trial_btn` | Start free — pay when you sell | Mula percuma — bayar bila anda menjual | 免费开始 —— 有生意才付费 |

### SEO / structured data (hardcoded, moves WITH the RM399 constant)

- `src/routes/pricing.tsx` `SEO_DESC` _(T5, 30 Sep — now DERIVED from
  `PLAN_MONTHLY_PRICES` + `PLAN_CREDIT_GRANT`)_: "Free until you sell. Starter
  RM79, Pro RM149, Scale RM399 a month — 100, 200 or 500 orders included, no
  per-message fees. S$ pricing for Singapore." (SEO desc keeps currency by
  design, see `pricing.md`.)
- `src/routes/index.tsx`: landing `SEO_DESC` drops "14-day free trial" for
  "free until you sell"; JSON-LD `highPrice: "299"` → `"399"`, offer
  `description` → "Free until your first order, no credit card required".

## 3. Off-Season Hold — card copy (wave 2, this ticket) — WILL NOT SHIP

> **Retired 30 Sep 2026.** The credits decision keeps the Off-Season Hold off
> every public surface (no card, no teaser strip, no FAQ entry); the status
> itself is retired separately in `z8r3fdfuhr`. Kept below only as the record of
> what was drafted.

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

1. ~~`z8r3fday24` constants + trial rework + hold status landed.~~ **Done 9 Sep 2026**
   (merges behind PR #250, `86eyb6z4r`).
2. `86eyb9zwt` (Scale reposition, production in review, still RM299) fast-followed
   with RM399 — must not close stale.
3. Meta October service rates re-checked against the margin model (artifact lock
   item, due before the new list goes live).
4. `docs/pricing.md` price table + trial CTA rules updated in the same PR;
   `docs/onboarding.md` locked-pricing line; `PROJECT_CONTEXT.md` pricing table.
