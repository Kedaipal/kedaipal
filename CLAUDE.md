# Kedaipal — WhatsApp-First Order Hub

See full project context: [`./PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md)

## Quick Summary
**Kedaipal** ("kedai" + "pal") — B2B SaaS order hub for serious WhatsApp sellers in Malaysia. WhatsApp is the wedge; long-term vision is omnichannel (Shopee, Lazada, TikTok Shop, StoreHub).

**Target cohort (current):** Established **F&B home sellers** doing 20+ orders/week — cake decorators, frozen food sellers (with reseller networks), kuih and pastry sellers. The outdoor-gear vertical was the original beachhead but real-world adoption shifted to F&B; positioning is now anchored on universal F&B pain.

**Universal pain × universal TAM:**
1. *"I'm missing orders buried in WhatsApp chat history."*
2. *"I'm chasing customers for payment confirmation."*

- Storefront: `kedaipal.com/<retailer-slug>` (no shopper auth)
- Dashboard: Clerk-protected
- Catalog: hosted in Convex (NOT Meta Commerce Catalog)
- Flow: WhatsApp → CTA URL button → web storefront → cart → `wa.me` deep link with `ORD-XXXX` → Convex confirms

## WhatsApp Model — Shared WABA (permanent)
Kedaipal owns **one Meta-verified WhatsApp Business Account** that handles outbound messaging for every retailer. Retailers do NOT need their own WABA, business verification, or SSM registration. Retailer brand surfaces via `{store_name}` in message content; sender number is Kedaipal's.

**Implication:** "No Meta verification needed — live in 5 minutes" is the structural moat vs. WATI / SleekFlow / EasyStore / Orderla. WABA quality is a shared resource — protections live in [`Sprint 4 WABA Protection task`](https://app.clickup.com/t/86expmgep).

## Pricing (locked, 3 tiers + 14-day trial)
| Tier | Price | Orders/mo | Users | Includes |
|---|---|---|---|---|
| **Starter** | RM79 | 100 | 1 | Storefront, order pipeline, manual payment claim, basic CRM |
| **Pro** ★ | RM149 | 500 | 2 | + Customer DB, date picker, order inbox, reminders, broadcast (100/mo) |
| **Scale** | RM299 | Unlimited | 5 | + Tiered pricing, reseller portal, unlimited broadcasts, sales reports, custom domain |

**14-day free trial, no credit card.** No free tier yet — revisit at 50 paying customers.
**Annual:** 10 months paid, 12 received (~17% off).
**Detailed strategy:** [`/Users/arifrahman/Workspaces/Documents/Kedaipal/01_Strategy/pricing-strategy.md`](../../../Documents/Kedaipal/01_Strategy/pricing-strategy.md)

## Tech Stack
- **Messaging:** WhatsApp Cloud API direct (no BSP). Production WABA verified Apr 2026.
- **Backend/DB:** Convex (functions, HTTP actions for webhooks, scheduled jobs)
- **Frontend:** TanStack Start (React + Router/Query) + Tailwind, **mobile-first hard requirement**
- **Auth:** Clerk (retailer dashboard only)
- **Hosting:** Cloudflare Workers/Pages + Convex Cloud
- **Payments (planned):**
  - **Subscription billing (retailers → Kedaipal):** Stripe + HitPay/Billplz (FPX + e-wallets)
  - **Customer payments (shoppers → retailers):** HitPay Connect / Billplz / Stripe Connect — retailer-owned gateway accounts, Kedaipal never touches order money

## MVP Status (shipped Apr 2026)
1. Hosted storefront at `/<slug>` — browse, cart ✅
2. WhatsApp bot CTA URL button entry ✅
3. Cart → `wa.me` handoff with order ID ✅
4. Convex parses order, confirms in chat ✅
5. Automated status updates (confirmed/packed/shipped/delivered) ✅
6. Retailer dashboard (products, inventory, orders, settings — live via Convex) ✅
7. Customer tracking page with "I've paid" flow + manual payment claim ✅

## Recently Shipped (post-MVP)
- **Customer Database (CRM-lite)** ✅ — `customers` entity keyed by `(retailerId, waPhone)` with denormalized lifetime aggregates, auto-captured WhatsApp pushname, private notes, and a `/app/customers` dashboard (list + detail). Backend + UI. The S1 "Customer DB" roadmap item. See [`docs/customer-database.md`](./docs/customer-database.md). Blocks Automated Reminders + Broadcast.
- **Webhook signature verification** ✅ — inbound `POST /webhook/whatsapp` verifies Meta's `X-Hub-Signature-256`. See [`docs/whatsapp-webhook-security.md`](./docs/whatsapp-webhook-security.md).

## Active Roadmap (17 tasks, 6 sprints, May 25 → Aug 16, 2026)
Tracked in [ClickUp Product Roadmap](https://app.clickup.com/90182681518/v/li/901818308046). High-level:
- **S1–S3 (revenue plumbing):** Customer DB, Order Inbox, Date Picker, Subscription Billing, Legal Pack, Landing+Pricing Rewrite, Setup Wizard, White-Glove Scheduler, PostHog → **first paid customer by Jul 5**
- **S4 (WhatsApp depth):** WABA Protection, Automated Reminders Cron, PWA + Push
- **S5 (growth surface):** Customer Payment Gateway, "Graduate from Orderla" landing + CSV import
- **S6 (acquisition on):** Broadcast, Targeted Ads (validation-first budget)

## Architectural Constraints
- Schema must treat WhatsApp as one `channel` — leave room for marketplace connectors post-MVP
- Mobile-first: ≥44px tap targets, single-column, sticky CTAs, bottom-anchored actions
- Multi-tenant via slugs from day one
- **All outbound messages flow through `wabaProtection.canSend()` gateway** once Sprint 4 ships — enforces rate limits + opt-outs + Meta quality status
- **Inbound `POST /webhook/whatsapp` verifies Meta's `X-Hub-Signature-256`** (HMAC-SHA256 with `WHATSAPP_APP_SECRET`) and **fails closed** — set the env var before deploying or webhooks 500
- **Customers are keyed by `(retailerId, waPhone)`; aggregates are denormalized** (refreshed on order create/cancel via `linkOrderToCustomer`/`decrementAggregatesForCancel`, counted once per order). Display name resolves `name → waProfileName → phone` via `getDisplayName`, mirrored in `convex/lib/customer.ts` + `src/lib/customer.ts`. A retailer-edited `name` is never overwritten by an inbound pushname.
- Customer payment gateway is **retailer-owned** (HitPay Connect / Billplz / Stripe Connect) — Kedaipal is never the merchant of record for shopper transactions

## Competitive Positioning (Orderla)
Orderla.my (20k+ MY merchants, RM30 Plus / RM100 Pro) is the entrenched incumbent for WhatsApp ordering. Their product is a **form**; Kedaipal is a **full storefront**. Public positioning: *"Where Orderla users graduate to when their order form falls apart."* Detailed analysis: [`/Users/arifrahman/Workspaces/Documents/Kedaipal/01_Strategy/benchmark-orderla.md`](../../../Documents/Kedaipal/01_Strategy/benchmark-orderla.md).

## Out of Scope (current sprint horizon)
- Meta Commerce Catalog integration
- BYO WhatsApp Business Account (per-retailer WABA) — deliberately ruled out, see shared-WABA section
- Free tier (deferred until 50 paying customers)
- Marketplace connectors (Shopee, Lazada, TikTok Shop) — original roadmap, parked until F&B core is stable
- Native mobile apps — PWA gets ~80% of the value
- Lawyer-drafted legal docs — using Iubenda/Termly templates + self-drafted AUP for v1

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->
