# Kedaipal — Project Context

> Business, customer, and product context for Kedaipal. Code-level conventions and architectural constraints live in [`CLAUDE.md`](./CLAUDE.md). This document is the narrative — the "why" behind the code.

---

## Product

**Kedaipal** = "kedai" (Malay: shop) + "pal" (friend). A WhatsApp-first B2B SaaS **order hub for small retailers**. Friendly, SMB-facing tone. Positioned as the shopkeeper's buddy.

Name is finalized. Earlier working names (KedaiSync, GearChat) are retired.

**One-liner:** *"An order hub for small retailers that starts with WhatsApp and connects to Shopee, Lazada, TikTok Shop, and more, so they can manage every sale in one place."*

---

## Target Customer

- **Who:** Established WhatsApp-first sellers doing **20–500 orders/month**, solo or 1–3 helpers, ~10–200 SKUs.
- **Where:** Malaysia first (locale support shipped for `en` and `ms`). Singapore is an adjacent market. Product is not locked to the region long-term.
- **Current cohort focus:** **F&B home sellers** — cake decorators (booking 30–80 cakes/month at RM180–500 AOV), frozen food sellers with reseller networks (RM15–80k/month, 10–80 resellers), kuih and pastry sellers running pre-order businesses. *Outdoor gear was the original beachhead but real-world adoption skewed F&B; product is positioned broadly enough to serve any pre-order WhatsApp business.*
- **How they sell today:** WhatsApp (primary) + Instagram / Facebook Status for promotion + sometimes Shopee Food / TikTok for awareness.
- **Universal core pains:**
  - **"I'm missing orders buried in WhatsApp chat history."** Every seller above ~20 orders/week feels this.
  - **"I'm chasing customers for payment confirmation."** Endless "sis dah bayar ke?" messages.
  - **"I can't remember who this returning customer is."** No recall of past orders, preferences, dietary notes.
- **Cohort-specific pains:**
  - **Cakes:** double-booked delivery dates, design briefs scattered across chat, deposit chasing.
  - **Frozen + reseller:** "stock ada lagi tak?" chaos, accidental oversells, no wholesale pricing tier.
  - **Kuih/pastry:** route management, weekend rush, repeat-order shortcut.
- **What unlocks them:** the universal pains are the wedge; cohort pains are the depth.

The founder's existing MY camping/hiking shop network remains useful for referrals, but the active distribution motion targets F&B home sellers via direct WhatsApp/IG outreach and the "Graduate from Orderla" acquisition channel (planned Sprint 5–6).

---

## Vision

Omnichannel order hub. WhatsApp is the wedge; the roadmap is to unify orders from the marketplaces retailers already sell on — **Shopee, Lazada, TikTok Shop, StoreHub** — into one dashboard.

The database schema already treats WhatsApp as one `channel` on retailers/products/orders so marketplace connectors can slot in without rewrites.

---

## Core Flow

1. Customer messages the retailer on WhatsApp.
2. Bot replies with a CTA URL button.
3. Button opens the hosted storefront at `kedaipal.com/<retailer-slug>` (no shopper auth).
4. Customer browses the catalog and builds a cart on mobile web.
5. Tapping **Order** bounces them back to WhatsApp via a `wa.me` deep link with an `ORDER#<shortId>` payload.
6. A Convex HTTP action parses the payload, confirms the order in chat, and runs the status pipeline:
   `pending → confirmed → packed → shipped → delivered` (with a `cancelled` branch).

**Catalog is hosted by Kedaipal in Convex — NOT Meta Commerce Catalog.** Full design control, works on Meta's free test number, no Commerce approval needed.

---

## Tech Stack (as built)

| Layer | Choice |
|---|---|
| Messaging | Meta WhatsApp Cloud API direct (no BSP). Free test number for MVP. |
| Backend / DB | Convex — queries, mutations, HTTP actions, scheduled jobs, rate limiter |
| Frontend | TanStack Start (React + Router/Query), file-based routing |
| Styling | Tailwind, **mobile-first** |
| i18n | Paraglide (`en`, `ms`) |
| Auth | Clerk (retailer dashboard only; storefront has no shopper auth) |
| Hosting | Cloudflare Workers/Pages + Convex Cloud |
| Tooling | pnpm, Biome, Vitest |

**Storefront — strictly mobile-first.** Storefront traffic comes from WhatsApp's in-app browser on phones, so the public `/<slug>` experience is single-column, ≥44px tap targets, sticky/bottom-anchored CTAs. Desktop is not a target there.

**Dashboard — mobile + desktop responsive.** Retailers triage orders on a phone in the field but do bulk product editing, settings, and order review on a laptop. The `/app/*` shell renders a bottom-tab layout below `lg` (1024px) and a collapsible left sidebar with a centered `max-w-6xl` content column on `lg+`. Both layouts share the same routes and data hooks; the switch is CSS-only.

---

## What's Built (as of 2026-04-09)

**Convex schema** (`convex/schema.ts`):
- `retailers` — Clerk-linked, slug-addressed, with logo, currency, locale, per-retailer WA message template overrides (en/ms), and optional payment instructions (bank, QR image, note).
- `slugHistory` — preserves old slugs for redirects after renames.
- `products` — price, stock, multiple images, sort order, active flag.
- `orders` — shortId, line items, customer, full status pipeline.
- `orderEvents` — per-order status history.

**Convex modules:** `whatsapp.ts`, `lib/whatsapp.ts`, `lib/whatsappCopy.ts` (templated bilingual copy), `lib/order.ts`, `lib/slug.ts`, `lib/rateLimiter.ts`, `lib/currency.ts`, `http.ts` (webhooks), `crons.ts`, `seed.ts`. Test coverage on orders, products, retailers, whatsapp, and whatsappCopy.

**Frontend routes** (`src/routes/`):
- Public storefront: `/$slug`
- Onboarding, sign-in, sign-up
- Dashboard: `/app` (index, products list/new/detail/import, orders list/detail, settings)

**Current phase (May 2026):** MVP fully shipped. Active focus is the 12-week launch sprint to first paid customer (target Jul 5, 2026) and predictable acquisition channel (target Aug 16, 2026). 17-task backlog tracked in [ClickUp Product Roadmap](https://app.clickup.com/90182681518/v/li/901818308046) across 6 two-week sprints. Critical path:
- **S1 (May 25 → Jun 7):** Customer DB, Order Inbox, Legal Pack, Subscription Billing start
- **S2 (Jun 8 → Jun 21):** Landing Rewrite, Setup Wizard, White-Glove Scheduler, PostHog
- **S3 (Jun 22 → Jul 5):** Subscription Billing finish, Pricing Page, Date Picker → **first revenue collectable**
- **S4 (Jul 6 → Jul 19):** WABA Protection, Automated Reminders, PWA + Push
- **S5 (Jul 20 → Aug 2):** Customer Payment Gateway, "Graduate from Orderla" landing + CSV import
- **S6 (Aug 3 → Aug 16):** Broadcast, Targeted Ads (Phase 0 validation only)

**Pilots (as of 2026-05-22):**
| Retailer | Location | Vertical | Status |
|---|---|---|---|
| Karls Outdoor | JB | Outdoor gear | Onboarded Apr 10 — holdover from outdoor beachhead, needs cohort-aware re-engagement |
| ModeLoop | KL | Jewelry | Bug-hunting only — wrong vertical |
| PK.Tacticals | KL | Clothing | Bug-hunting only — wrong vertical |

**Distribution goal:** 2–4 paying retailers by Jul 5, 2026 — concentrated on cake decorator + frozen reseller cohorts via direct outreach, replacing the existing wrong-vertical pilots.

---

## MVP Scope

1. Hosted storefront at `/<slug>` — browse, cart.
2. WhatsApp CTA URL button as the entry point.
3. Cart → `wa.me` handoff with order ID.
4. Convex parses the order and confirms in chat.
5. Automated status updates (confirmed / packed / shipped / delivered).
6. Retailer dashboard (products, inventory, orders, settings — live via Convex).

## Out of Scope (MVP)

Meta Commerce Catalog, Meta business verification, marketplace connectors, marketing / abandoned-cart automations, native mobile apps, advanced analytics.

Online payments are deferred to the first paid release — see [Payments Architecture](#payments-architecture). For MVP, retailers surface offline / COD / bank-transfer / DuitNow QR instructions in the WA confirmation reply and reconcile by hand.

---

## Payments Architecture

**Kedaipal is a platform, not a PSP — it never touches order money.** Two money flows, two merchants of record:

| Flow | Merchant of record | Entity location |
|---|---|---|
| Shopper → Retailer (order payment) | The **retailer** (already SSM-registered as a shop owner) | Malaysia |
| Retailer → Kedaipal (SaaS subscription) | **Kedaipal** | Singapore |

**Order-payment integration model (post-MVP):**
- Each retailer brings their own Malaysian gateway account — **CHIP**, **Billplz**, or **ToyyibPay** (the latter accepts personal accounts with no SSM, so it's the easiest on-ramp for the smallest retailers).
- Retailer pastes API keys + webhook secret into their Kedaipal dashboard.
- Gateway hits a Convex HTTP action on payment success → order flips to `paid` → WhatsApp confirmation fires automatically.
- Manual fallback (current MVP): bank transfer / DuitNow QR instructions, reconciled by hand.

**Indicative gateway cost (per successful order, RM ~80 FPX-typical):**

| Gateway | FPX B2C | Card (local) | Setup | Annual |
|---|---|---|---|---|
| ToyyibPay | RM 1.00 | ~2.0% (RM 100 add-on) | RM 0 | RM 0 / RM 100 (cards) |
| CHIP | RM 1.00 | 2.0% | RM 0 | RM 0 |
| Billplz (Free / Standard) | RM 1.10 / RM 0.70 | ~1.0–2.0% | RM 0 | RM 0 / RM 999 |

**Why this shape:**
- Avoids PSP / acquiring-bank licensing entirely.
- Mirrors how Shopee / Lazada / TikTok Shop settle directly to retailers — same architecture extends cleanly to those connectors post-MVP.
- Removes the founder's foreign-entity blocker (see [Founder & Operating Entity](#founder--operating-entity)) from the critical path.

---

## Business Model

- Solo dev-founder. Sub-USD$5K initial budget.
- **Pricing locked (May 2026):** 3 tiers, 14-day free trial (no card), no free tier yet.

| Tier | Monthly | Annual | Orders/mo | Users | Target customer |
|---|---|---|---|---|---|
| **Starter** | RM79 | RM790 | 100 | 1 | Just starting to feel pain (10–50 orders/mo) |
| **Pro** ★ | RM149 | RM1,490 | 500 | 2 | **Target tier** — established seller (50–300 orders/mo) |
| **Scale** | RM299 | RM2,990 | Unlimited | 5 | Reseller + wholesale models (300+ orders/mo) |

- Annual = 10 months paid, 12 received (~17% off).
- No transaction fees, no per-user surcharges, no per-message billing (Meta charges WA template messages directly — transparent pass-through).
- **Free tier deferred** until 50+ paying customers validate the paid motion; revisit if 30%+ of inbound prospects cite "Orderla is free" as the primary blocker.
- Detailed strategy: [`pricing-strategy.md`](../../Documents/Kedaipal/01_Strategy/pricing-strategy.md).

### Revenue collection
- **Subscription billing (retailers → Kedaipal):** Stripe + HitPay/Billplz, settled to the Singapore entity (see [Founder & Operating Entity](#founder--operating-entity)).
- **Customer payments (shoppers → retailers):** never touched by Kedaipal — retailer-owned gateway accounts (see [Payments Architecture](#payments-architecture)).

### WhatsApp infrastructure model — shared WABA (permanent)
Kedaipal operates a **single Meta-verified WhatsApp Business Account** shared across all retailers. Meta business verification completed Apr 2026. Retailers do NOT need their own WABA, business verification, or SSM registration.

This is a deliberate strategic choice, not a stopgap:
- **Differentiator:** every competitor (WATI, SleekFlow, Respond, EasyStore + WhatsApp) requires retailers to set up their own WABA. That kills 70–80% of SMB signups before they see the product. Kedaipal's "no Meta setup needed, live in 5 minutes" is the structural moat.
- **Trade-off:** WABA risk is concentrated — one bad-actor retailer can degrade deliverability for everyone. Mitigated by the [WABA Protection task](https://app.clickup.com/t/86expmgep) (per-retailer rate limits, cross-retailer opt-out enforcement, Meta quality webhook integration, admin kill switches).
- **Future:** when scaling past ~500 retailers, add additional Kedaipal-owned numbers to the WABA and load-balance retailers across them. Architecturally trivial.

---

## Founder & Operating Entity

- **Founder:** Arif Rahman — **Singaporean**, currently based in Malaysia.
- **Operating entity:** Singapore (ACRA) — sole proprietorship for the leanest start, or Pte Ltd if liability separation becomes worth ~SGD 600/yr in secretarial overhead. No special status needed for Singaporeans.
- **Why not a Malaysian entity:** SSM sole proprietorship is restricted to Malaysian citizens / PRs. A 100% foreign-owned Sdn Bhd in trading / e-commerce requires **RM 1,000,000 paid-up capital** — a non-starter for an MVP. A Malaysian co-founder structure would lower that bar but adds dependency.
- **SaaS billing:** Stripe Singapore or HitPay (MAS-licensed, supports SGD + cross-border MY methods like FPX, DuitNow QR, TNG, GrabPay). Settled to the SG entity. Final pick deferred until first paid retailer.
- **Tax flag:** Staying in Malaysia ≥183 days/year can trigger Malaysian personal tax residency on personal income even with the company in SG. Worth a one-hour conversation with a cross-border accountant before scaling revenue — not an MVP blocker.

---

## Competitive Landscape

**Direct competitor (the one that matters):** **Orderla.my** — built by iReka Soft, 20,000+ MY merchants, RM100M+ GMV over 5 years. Free / Plus RM30 / Pro RM100. Their product is a **form** that pre-fills a WhatsApp message; Kedaipal's product is a **full storefront** with cart, catalog, and real-time order pipeline. Orderla themselves acknowledged the form model's ceiling by building Orderla Commerce (orderla.co) as a separate storefront product.

**Kedaipal's public positioning vs Orderla:** *"Where Orderla users graduate to when their order form falls apart."* Targeting their existing 20k merchants who've outgrown forms is cheaper than cold-educating new prospects. See [`benchmark-orderla.md`](../../Documents/Kedaipal/01_Strategy/benchmark-orderla.md) for the full deep dive.

**Adjacent / oblique competitors:**
- **EasyStore (RM249–399)** — full e-commerce platform, overserves the home-seller cohort, requires retailer to set up WhatsApp connector separately. Different shape.
- **StoreHub (RM102+)** — POS-first, requires hardware, restaurant-focused. Not the same buyer.
- **WATI / SleekFlow / Respond.io ($59–399)** — WhatsApp inbox/CRM tools, not order hubs. Also require retailer to set up their own WABA + Meta business verification.
- **Interakt (India, ~RM55–190)** — messaging-first, doesn't solve order management at home-seller scale.
- **Free tools (Google Sheets + WhatsApp Business)** — works until ~20 orders/week, then collapses. Kedaipal's wedge upgrade.

**Kedaipal's opening:** the gap between Orderla's free-form simplicity and EasyStore's expensive e-commerce overkill. The bullseye is *established WhatsApp pre-order sellers doing 20–500 orders/month*, mainly F&B for now.

### Moat drivers

**Real moats (invest here):**
- **No-Meta-setup acquisition advantage** — every competitor in WhatsApp commerce requires retailers to set up their own WABA. Kedaipal's shared-WABA model eliminates the #1 onboarding friction.
- **Switching costs via accumulated order, customer, and broadcast data** — once a retailer has 6 months of customer history and a working broadcast list, leaving is painful.
- **MY/SG localization depth** — Ringgit pricing, FPX/HitPay payment integration, bilingual (en/ms) WhatsApp templates, planned Shopee/Lazada/TikTok Shop integrations.
- **F&B-specific workflow features** (Sprint 2+) — date picker, capacity caps, custom design briefs, tiered pricing — features Orderla's form model can't bolt on cleanly.

**Weak moats (don't over-index on):**
- Tech stack choices.
- Pricing — easily matched, and Orderla can drop prices to defend.
- First-mover status — Orderla had 5 years; we don't have that lead.

---

## Guiding Principles

- **Universal pain × universal TAM beats vertical depth at this stage.** Solve "missed WhatsApp orders + payment chase" for any pre-order F&B seller — pitch the same product with cohort-specific examples (cake / frozen / kuih) rather than building separate vertical products.
- **Shared-WABA is a feature, not a stopgap.** Eliminating Meta verification friction is the structural moat. Don't accept BYO WABA pressure from anyone.
- **Validate before scaling spend.** Especially for paid acquisition — the Sprint 6 Targeted Ads task has a Phase 0 RM500–1k validation gate before any meaningful spend.
- **Invest in real moats** (data, opt-outs / customer DB lock-in, MY localization, shared-WABA acquisition friction) — not weak ones (tech stack, pricing parity, first-mover).
- **Phone-first by default.** Both shoppers and retailers live on mobile, so the storefront, dashboard, and PWA are designed for thumbs first — but the dashboard ships a real desktop layout for retailers doing bulk work on a laptop.
- **Keep the `channel` abstraction intact.** Every future marketplace connector (Shopee, Lazada, TikTok Shop) depends on it — even though those connectors are now parked behind F&B core.

---

## Open Questions

- **HitPay vs Billplz** as the first MY subscription billing rail (Stripe Singapore handles cards) — decide before Sprint 3.
- **Which retailer-side customer payment gateway to officially document first** — HitPay Connect vs Billplz vs Stripe Connect (Sprint 5 task).
- **SG sole prop vs Pte Ltd** — defer until liability or cap-table considerations force the call.
- **When to revisit free tier** — current trigger: ≥30% of inbound prospects citing "Orderla is free" as their primary blocker, OR 50+ paying customers reached.
- **Inventory source of truth** once retailers also sell on Shopee / Lazada (Kedaipal as master vs sync vs webhook-driven reconciliation) — parked, not active.
- **Marketplace connector ordering** post-F&B core (Shopee likely first in MY) — parked behind the 6-sprint roadmap.
- **Lawyer engagement trigger** — currently template-based (Iubenda/Termly + self-drafted AUP). Revisit on first enterprise deal, first fundraise, first legal threat, 50+ paying customers, or SG/ID expansion.
