# Kedaipal — Project Context

> Business, customer, and product context for Kedaipal. Code-level conventions and architectural constraints live in [`CLAUDE.md`](./CLAUDE.md). This document is the narrative — the "why" behind the code.

---

## Product

**Kedaipal** = "kedai" (Malay: shop) + "pal" (friend). A WhatsApp-first B2B SaaS **order hub for small retailers**. Friendly, SMB-facing tone. Positioned as the shopkeeper's buddy.

Name is finalized. Earlier working names (KedaiSync, GearChat) are retired.

**One-liner:** *"An order hub for small retailers that starts with WhatsApp and connects to Shopee, Lazada, TikTok Shop, and more, so they can manage every sale in one place."*

---

## Target Customer

- **Who:** 1–5 employee shops, 50–500 SKUs.
- **Where:** Malaysia first (locale support shipped for `en` and `ms`). Singapore is an adjacent market. Product is not locked to the region long-term.
- **First vertical:** outdoor / camping & hiking gear retailers. Vertical-agnostic by design — outdoor gear is the beachhead, not the ceiling.
- **How they sell today:** physical store + WhatsApp + Shopee / Lazada / TikTok Shop.
- **Core pains:**
  - Orders getting lost in WhatsApp chat history.
  - Inventory mismatches across channels.
  - No unified order view across physical + online channels.

The founder has an existing personal network of MY camping/hiking shop owners — first customer base and early moat driver.

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

**Current phase:** MVP is substantially implemented. Focus is piloting with the first real shop(s) from the founder's network and iterating based on validation signal.

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

- Solo dev-founder. Sub-$5K budget.
- Target pricing: **RM79–149/month**.
- Meta setup requires no company registration for MVP: personal Facebook account → free Meta Business Account → WhatsApp Business Account → Developer App → test number. Business verification deferred until real volume.

---

## Founder & Operating Entity

- **Founder:** Arif Rahman — **Singaporean**, currently based in Malaysia.
- **Operating entity:** Singapore (ACRA) — sole proprietorship for the leanest start, or Pte Ltd if liability separation becomes worth ~SGD 600/yr in secretarial overhead. No special status needed for Singaporeans.
- **Why not a Malaysian entity:** SSM sole proprietorship is restricted to Malaysian citizens / PRs. A 100% foreign-owned Sdn Bhd in trading / e-commerce requires **RM 1,000,000 paid-up capital** — a non-starter for an MVP. A Malaysian co-founder structure would lower that bar but adds dependency.
- **SaaS billing:** Stripe Singapore or HitPay (MAS-licensed, supports SGD + cross-border MY methods like FPX, DuitNow QR, TNG, GrabPay). Settled to the SG entity. Final pick deferred until first paid retailer.
- **Tax flag:** Staying in Malaysia ≥183 days/year can trigger Malaysian personal tax residency on personal income even with the company in SG. Worth a one-hour conversation with a cross-border accountant before scaling revenue — not an MVP blocker.

---

## Competitive Landscape

- **Horizontal competitors** (Orderla.my, Take App, Boutir): leave the outdoor/camping niche underserved. No vertical-specific catalog templates, sync workflows, or community tooling.
- **Enterprise tools** (SleekFlow, Respond.io): too complex and expensive for 1–5 employee shops. Not the competition.
- **Kedaipal's opening:** the underserved small-retailer segment in MY, starting with a specific vertical the founder already has trust in.

### Moat drivers

**Real moats (invest here):**
- Existing MY retailer relationships and community trust in the camping retail niche.
- Switching costs via accumulated order and catalog data.
- WhatsApp Business API verification lead time.
- MY/SG localization depth — Ringgit pricing, Shopee/Lazada/TikTok Shop integrations, bilingual copy.

**Weak moats (don't over-index on):**
- Tech stack choices.
- Pricing.
- First-mover status.

---

## Guiding Principles

- **Vertical specificity is the primary wedge.** Outdoor gear is not a limitation — it's the beachhead.
- **Validate before building.** MVP sequencing prioritizes conversations with shop owners before engineering effort.
- **Invest in real moats** (data, community, localization) — not weak ones.
- **Phone-first by default.** Storefront is phone-only; the dashboard is phone-primary but ships a real desktop layout for retailers doing bulk work on a laptop.
- **Keep the `channel` abstraction intact.** Every future marketplace connector depends on it.

---

## Open Questions

- **Stripe Singapore vs HitPay** for SaaS subscription billing — decide at first paid retailer.
- **First retailer-side gateway to officially support and document end-to-end** — CHIP vs Billplz vs ToyyibPay (each retailer can still bring others later).
- **SG sole prop vs Pte Ltd** — defer until liability or cap-table considerations force the call.
- Inventory source of truth once retailers also sell on Shopee / Lazada (Kedaipal vs sync vs webhook-driven reconciliation).
- Marketplace connector ordering post-MVP (Shopee likely first in MY).
- Domain status for `kedaipal.com`.
