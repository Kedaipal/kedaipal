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

## How we decide — "what would a CTO do?"
The product owner is the **CTO / sole dev**; decisions we make together should pass a CTO's bar, not just "does it work." When designing or reviewing any change:
- **Think end-to-end about the human in the flow.** A feature isn't done when the happy path works — it's done when the seller and the buyer are *eased through* it: clear copy, sensible defaults, no dead ends, no states that silently confuse. When a backend change opens a new state, ask "what does each side now see, and is it obvious what to do next?" and patch the UI/UX, emails, and bot replies to match.
- **Polish proportional to impact** — not every feature needs to be gold-plated, but every feature should at least cover the obvious UX easements (a disabled-with-reason button beats a wrong-but-enabled one; a one-line "here's what happens next" beats silence).
- **Decisions are decisions.** A call made here is a decision to build on, production-grade and for the long run — not a demo or a stopgap awaiting sign-off. Surface trade-offs and flag follow-ups proactively (think ahead), but don't stall.
- **Always ship code + tests + docs together** as the baseline (see existing memory). Tests prove the easement holds; docs keep the next person oriented.
- **No lazy / convenient placement — own the structure.** Never park a feature wherever code already happens to exist, append a new option to the end of a list, or reuse the nearest tab/section just because it's less work. Decide *where* something belongs (information architecture, tab/section, list position, naming) by **meaning and urgency**, and proactively restructure when the right home doesn't exist yet (e.g. a new settings tab). The CTO should not have to point out that an order-flow setting doesn't belong under "WhatsApp", or that an urgent filter shouldn't sit last — get it right the first time and state the reasoning. When you touch adjacent lazy patterns (hardcoded duplicates, stale copy), fix them in passing rather than matching them.

## WhatsApp Model — Shared WABA (permanent)
Kedaipal owns **one Meta-verified WhatsApp Business Account** that handles outbound messaging for every retailer. Retailers do NOT need their own WABA, business verification, or SSM registration. Retailer brand surfaces via `{store_name}` in message content; sender number is Kedaipal's.

**Implication:** "No Meta verification needed — live in 5 minutes" is the structural moat vs. WATI / SleekFlow / EasyStore / Orderla. WABA quality is a shared resource — protections live in [`Sprint 4 WABA Protection task`](https://app.clickup.com/t/86expmgep).

Pricing, business model, and founder/entity details: see [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md#business-model).

## Tech Stack
- **Messaging:** WhatsApp Cloud API direct (no BSP). Production WABA verified Apr 2026.
- **Backend/DB:** Convex (functions, HTTP actions for webhooks, scheduled jobs)
- **Frontend:** TanStack Start (React + Router/Query) + Tailwind, **mobile-first hard requirement**
- **Auth:** Clerk (retailer dashboard only)
- **Hosting:** Cloudflare Workers/Pages + Convex Cloud
- **Payments (planned):**
  - **Subscription billing (retailers → Kedaipal):** Stripe + HitPay/Billplz (FPX + e-wallets)
  - **Customer payments (shoppers → retailers):** HitPay Connect / Billplz / Stripe Connect — retailer-owned gateway accounts, Kedaipal never touches order money

MVP status, shipped features changelog, and the sprint-by-sprint roadmap: see [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md#whats-built) (kept there since it changes weekly — this file is for durable rules only).

## Architectural Constraints
- Schema must treat WhatsApp as one `channel` — leave room for marketplace connectors post-MVP
- **Messaging goes through the `ChannelAdapter` seam** (`convex/lib/channels/`): orchestration emits normalized `OutboundMessage`/`InboundEnvelope` via `getAdapter(channel)`; provider-specific wire logic (Meta payloads, signature scheme) lives inside the adapter. Add a channel = new adapter + registry entry + webhook route, no order-flow changes. See [`docs/messaging-channels.md`](./docs/messaging-channels.md).
- Mobile-first: ≥44px tap targets, single-column, sticky CTAs, bottom-anchored actions
- Multi-tenant via slugs from day one
- **All outbound messages flow through `wabaProtection.canSend()` gateway** once Sprint 4 ships — enforces rate limits + opt-outs + Meta quality status (sits inside the adapter's `send`)
- **Inbound `POST /webhook/whatsapp` verifies Meta's `X-Hub-Signature-256`** (HMAC-SHA256 with `WHATSAPP_APP_SECRET`) and **fails closed** — set the env var before deploying or webhooks 500
- **Customers are keyed by `(retailerId, waPhone)`; aggregates are denormalized** (refreshed on order create/cancel via `linkOrderToCustomer`/`decrementAggregatesForCancel`, counted once per order). Display name resolves `name → waProfileName → phone` via `getDisplayName`, mirrored in `convex/lib/customer.ts` + `src/lib/customer.ts`. A retailer-edited `name` is never overwritten by an inbound pushname.
- Customer payment gateway is **retailer-owned** (HitPay Connect / Billplz / Stripe Connect) — Kedaipal is never the merchant of record for shopper transactions

Competitive positioning vs Orderla: see [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md#competitive-landscape).

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
