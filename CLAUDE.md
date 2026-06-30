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
- **Make every feature discoverable — no hidden behavior.** We exist to make the vendor's and buyer's life *easier*, not to add behavior they have to stumble onto. Every feature, setting, and rule (a TTL/expiry, a configurable limit, an auto-action, a new tab, a constraint like "buyers can't pick a date sooner than N days") must be **surfaced in-product to whichever side it affects** — a one-line helper/subtitle, an empty-state hint, a tooltip, or inline copy — so they know it exists and how to use it. If a behavior would make someone wonder "wait, where did that go?" or "why can't I…?", that's a missing piece of UI, not acceptable. This applies to **every** future feature; when you build one, name where the user is told about it. Don't make the CTO point out that a feature is invisible.
- **Polish proportional to impact** — not every feature needs to be gold-plated, but every feature should at least cover the obvious UX easements (a disabled-with-reason button beats a wrong-but-enabled one; a one-line "here's what happens next" beats silence).
- **Decisions are decisions.** A call made here is a decision to build on, production-grade and for the long run — not a demo or a stopgap awaiting sign-off. Surface trade-offs and flag follow-ups proactively (think ahead), but don't stall.
- **Always ship code + tests + docs together** as the baseline (see existing memory). Tests prove the easement holds; docs keep the next person oriented.
- **No lazy / convenient placement — own the structure.** Never park a feature wherever code already happens to exist, append a new option to the end of a list, or reuse the nearest tab/section just because it's less work. Decide *where* something belongs (information architecture, tab/section, list position, naming) by **meaning and urgency**, and proactively restructure when the right home doesn't exist yet (e.g. a new settings tab). The CTO should not have to point out that an order-flow setting doesn't belong under "WhatsApp", or that an urgent filter shouldn't sit last — get it right the first time and state the reasoning. When you touch adjacent lazy patterns (hardcoded duplicates, stale copy), fix them in passing rather than matching them.

## Definition of Done — ship PR-ready, every time
Every change must land in a state that would **pass PR review on the first read**, so review becomes a rubber-stamp, not a rework loop. Before calling anything done, it must clear this bar — no "I'll clean it up later":
- **Verify the ticket against reality first.** Tickets may be stale or AI-drafted against assumptions that no longer hold. Audit the actual schema/code before coding (does the table/field/function already exist? does the proposed change collide with live code?), and reconcile the plan to what's really there — don't build what the ticket says if the codebase says otherwise. Flag the divergence.
- **Code + tests + docs in the same change** (existing baseline). Tests cover the happy path *and* the failure/edge states the change introduces; docs (`docs/*.md` + any CLAUDE.md status line) keep the next person oriented.
- **Green gates:** typecheck, lint, and the full test suite pass locally before it's "done" (run `/ship` or the equivalent). No new warnings introduced. No `any`/`@ts-ignore`/dead code/commented-out blocks/stray `console.log` left behind.
- **End-to-end human flow covered** (per "How we decide"): every new state has UI/copy/email/bot-reply on both sides, sensible defaults, disabled-with-reason over wrong-but-enabled, and the feature is discoverable where it's used.
- **Self-review the diff** as a reviewer would: naming and structure match surrounding code, no scope creep, no unrelated churn, migrations are safe (widen→migrate→narrow), secrets/prod untouched. If something is a deliberate trade-off or a follow-up, **call it out in the summary** rather than leaving it for review to catch.
- **Convex specifics:** new validators/indexes are correct and used; reads stay on indexes (no full scans on hot paths); schema changes follow the dev-only, migration-safe path.

The goal: when a change is handed over, the reviewer finds nothing to send back. If a gap is unavoidable, name it up front — don't make review discover it.

## WhatsApp Model — Shared WABA (permanent)
Kedaipal owns **one Meta-verified WhatsApp Business Account** that handles outbound messaging for every retailer. Retailers do NOT need their own WABA, business verification, or SSM registration. Retailer brand surfaces via `{store_name}` in message content; sender number is Kedaipal's.

**Implication:** "No Meta verification needed — live in 5 minutes" is the structural moat vs. WATI / SleekFlow / EasyStore / Orderla. WABA quality is a shared resource — protections (kill switch, per-seller caps, opt-out, quality auto-throttle) shipped as the [`WABA Protection`](https://app.clickup.com/t/86expmgep) real-now core; see [`docs/waba-protection.md`](./docs/waba-protection.md).

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

## MVP Status (shipped Apr 2026)
1. Hosted storefront at `/<slug>` — browse, cart ✅
2. WhatsApp bot CTA URL button entry ✅
3. Cart → `wa.me` handoff with order ID ✅
4. Convex parses order, confirms in chat ✅
5. Automated status updates (confirmed/packed/shipped/delivered) ✅
6. Retailer dashboard (products, inventory, orders, settings — live via Convex) ✅
7. Customer tracking page with "I've paid" flow + manual payment claim ✅

## Recently Shipped (post-MVP)
- **Invoice & Receipt PDFs + CSV export** ✅ (ClickUp `86ext578n`) — two PDF documents plus a bookkeeping export. **(A) Order receipts** are buyer-facing and **generated on demand** (not stored — deterministic from the order); the buyer self-serves from `/track/<token>`, the seller from order detail, both via `orders.generateReceiptPdf` behind the `resolveSharedOrder` auth seam. **(B) Subscription invoices** (Kedaipal→seller) are **rendered + stored at issue time** (`invoices.pdfStorageId`, frozen so mutable `billingConfig` bank details can't drift); downloadable from the billing tab + admin console via the ownership-checked `getInvoicePdfUrl`. **Bulk export** from the orders inbox is **CSV** (not a PDF bundle — bookkeeping is the real job), honouring the live inbox filter or a ticked selection via the `orders.exportOrders` **action**, which paginates the full result set (not the inbox's 1000-doc reactive cap) with a `capped` backstop so books are never silently truncated. The ticket was **stale** — UC B's spine already existed (`86expn2qg`), so we extended the live `invoices` table rather than building the ticket's colliding generic table. pdf-lib renders in the default Convex runtime; pure logic in `convex/lib/pdf/` + `convex/lib/orderInboxFilter.ts` (extracted from `searchOrders`) + `convex/lib/orderCsv.ts` (with formula-injection defense). See [`docs/invoices-receipts.md`](./docs/invoices-receipts.md).
- **WABA Protection — real-now core** ✅ (ClickUp `86expmgep`, dev) — the gateway every outbound WhatsApp message passes through, protecting the shared number. `canSend(retailerId, toPhone, category)` + `makeGuardedSender` (wraps all 14 send sites). **Category policy:** `transactional` order messages **bypass all gating** (per ticket edge cases); only `session_message`/templates are gated — so the kill switch/caps mainly govern session replies today and become fully load-bearing with Broadcast. Ships: per-retailer **kill switch** (`retailerSendingLimits.pausedAt`, CLI `wabaProtection:pauseRetailer`/`resumeRetailer` + dashboard banner + email), **tiered caps** (50 first-30d / 200 Pro / 500 Scale + 30/5min), **cross-retailer opt-out** (STOP/BERHENTI/START → global `optOuts`), **quality-webhook auto-throttle** (LOW→pause non-transactional), **`outboundMessageLog`** audit. Admin UI relocated → Admin Console `86ey25er1`; spam-detection/Marketing-pause/ramp/health-widget → Broadcast. **Needs Meta dashboard:** subscribe webhook fields `phone_number_quality_update` + `account_update` for auto-throttle (fails open to healthy until then). See [`docs/waba-protection.md`](./docs/waba-protection.md).
- **Customer Database (CRM-lite)** ✅ — `customers` entity keyed by `(retailerId, waPhone)` with denormalized lifetime aggregates, auto-captured WhatsApp pushname, private notes, and a `/app/customers` dashboard (list + detail). Backend + UI. The S1 "Customer DB" roadmap item. See [`docs/customer-database.md`](./docs/customer-database.md). Blocks Automated Reminders + Broadcast.
- **Webhook signature verification** ✅ — inbound `POST /webhook/whatsapp` verifies Meta's `X-Hub-Signature-256`. See [`docs/whatsapp-webhook-security.md`](./docs/whatsapp-webhook-security.md).
- **Channel adapter seam** ✅ (Phases 1–3) — WhatsApp is now one of N messaging channels behind a uniform `ChannelAdapter` (`convex/lib/channels/`). Outbound/inbound/signature all flow through `getAdapter("whatsapp")`; the order orchestration is channel-neutral. Pure refactor, zero behavior change (one delta: signed-but-malformed webhook body → `200`+log, not `400`). Identity migration (`waPhone` → `channelUserId`, Phases 4–6) deferred until a 2nd channel is greenlit. See [`docs/messaging-channels.md`](./docs/messaging-channels.md).
- **Mockup / proof approval** ✅ — made-to-order custom products gate production on buyer sign-off. Per-product `requiresProof` toggle → orders get a third independent dimension `mockupStatus` (`pending → submitted → approved`, + `changes_requested` loop) that blocks `confirmed→packed` until the buyer **approves on the tracking page** or the seller **waives** after a 48h grace. Seller uploads + WhatsApp-sends the mockup; buyer approves/requests-changes; seller emailed on each. Code uses **`mockup`** (not `proof` — that's the payment screenshot). Reminder nudges deferred (waiver is time-based). See [`docs/proof-approval.md`](./docs/proof-approval.md).
- **Product Variants** ✅ — products generalized from flat single-SKU to **option-axes + variant-rows** (Shopify/Shopee/TikTok shape). New `productVariants` table holds per-variant price/stock/SKU/weight/image; `products` keeps **0–2 option axes** + a `blockWhenOutOfStock` (made-to-order) toggle. Every product resolves to ≥1 variant (implicit `optionValues:[]`) — no separate simple-product path. Storefront pill pickers + two-reason grey-out + markdown descriptions; dashboard variant-grid editor (axis presets, bulk-fill, per-row image/deactivate). Caps (2 axes / 50 variants) = TikTok/Shopee/Lazada parity. Schema **widened** (dev only); the production backfill→narrow migration is a separate task. See [`docs/product-variants.md`](./docs/product-variants.md). Mockup requirement is now **per-variant** (not all-items), and payment moved to **after** mockup approval for custom orders.
- **Self-collect pickup locations** ✅ — multi-location pickup with dashboard setup; frugal scope (free-text address + Waze/Google Maps deep links, no Places API). Map URLs patched for Waze mobile/desktop + place details. ClickUp `86exq8ymf`. See [`docs/fulfilment.md`](./docs/fulfilment.md).
- **Optional delivery (symmetric fulfilment)** ✅ — delivery is now a first-class toggle (`retailers.offerDelivery`) like self-collect, so sellers offer delivery-only, pickup-only, or both. A **working-method invariant** (enforced in `retailers.updateSettings` + `pickupLocations.setActive`, mirrored in the UI + storefront) guarantees a storefront never loses its last way to receive an order — "working" self-collect requires ≥1 active pickup location. Legacy default asymmetry: `offerDelivery` undefined → **true** (vs `offerSelfCollect` → false), no migration. Settings "Pickup" tab → **"Fulfilment"** (two toggle cards), checklist step → "Set up delivery & pickup" (shown to all). ClickUp `86exu4grm`. See [`docs/fulfilment.md`](./docs/fulfilment.md).
- **Order note at checkout** ✅ — shopper attaches one free-text instruction to an order. See [`docs/order-note.md`](./docs/order-note.md).
- **Fulfilment date at checkout** ✅ — the lean Date Picker (ClickUp `86expm524`). One required native `<input type="date">` at checkout — *"when do you need this?"* — for **both** delivery and self-collect (the ICP case, cake delivery, is delivery-led). Stored as `orders.fulfilmentDate` (epoch-ms of MYT midnight; MY is UTC+8/no-DST). Validated to `[today + minNotice, today + 30]`; `retailers.minFulfilmentNoticeDays` (default **0 = same-day allowed**) lives in Settings → **Fulfilment**. **Counter Checkout** defaults the date to **today**, bypasses the buyer notice, and — when paid in person — offers an optional **"Mark as completed"** button on the success screen (one tap → `delivered`; a choice, not automatic). Surfaces end-to-end: buyer's WhatsApp message + new-order email + tracking page, and the **order inbox now defaults to fulfilment-date-ascending sort** with **Today/Tomorrow/This-week** chips + per-card urgency badge. All date logic in the shared `convex/lib/fulfilmentDate.ts` (imported by both sides). Unblocks the Pickup Reminder. See [`docs/fulfilment-date.md`](./docs/fulfilment-date.md).
- **One-tap copy payment details** ✅ — shoppers copy acc no / DuitNow ID from the order details page. ClickUp `86exv7772`.
- **Store description on storefront** ✅ — retailers set a short public blurb (`retailers.storeDescription`, ≤280 chars) that renders under the store name on `/<slug>`, replaces the generic tagline when set, and feeds the SEO/OG description. Plain-text, escaped, line-clamped. ClickUp `86extzdmd`. See [`docs/store-description.md`](./docs/store-description.md).
- **Payment handshake** ✅ in production — the manual two-button payment confirmation flow; canonical doc is [`docs/payment-handshake.md`](./docs/payment-handshake.md) (roadmap doc superseded).
- **Landing + pricing + cost redesign** ✅ (merged Jun 11, PRs #24/#25) — animated mobile-first UI, branded OG image + fresh structured data (SEO), dark-background logo variant, Kris's FROZEN-led assets live. **Founding-spot CTAs open WhatsApp contact, not sign-up.** Setup Wizard + Legal Pack (AUP/Terms/Privacy) + ROI weekly digest also complete in ClickUp.

## Active Roadmap (17 tasks, 6 sprints, May 25 → Aug 16, 2026)
Tracked in [ClickUp Product Roadmap](https://app.clickup.com/90182681518/v/li/901818308046). High-level:
- **S1–S3 (revenue plumbing):** Customer DB, Order Inbox, Date Picker, Subscription Billing, Legal Pack, Landing+Pricing Rewrite, Setup Wizard, White-Glove Scheduler, PostHog → **first paid customer by Jul 5**
- **S4 (WhatsApp depth):** WABA Protection, Automated Reminders Cron, PWA + Push
- **S5 (growth surface):** Customer Payment Gateway, "Graduate from Orderla" landing + CSV import
- **S6 (acquisition on):** Broadcast, Targeted Ads (validation-first budget)

**Status (12 Jun 2026):** Of S1–S3, done = Customer DB, Legal Pack, Landing+Pricing rewrite, Setup Wizard. **Subscription billing v1 slipped to ~Jun 30** — 7 subtasks under `86expn2qg`, all to-do, Zaki. Still open: Order Inbox (`86expm4xx`). **Date Picker (`86expm524`) — done** (lean version; see Recently Shipped). In progress: Multiple payment methods (banks + QR, `86extzdpk`); in review: bulk product import rework for variants (`86exu482j`).

## Architectural Constraints
- Schema must treat WhatsApp as one `channel` — leave room for marketplace connectors post-MVP
- **Messaging goes through the `ChannelAdapter` seam** (`convex/lib/channels/`): orchestration emits normalized `OutboundMessage`/`InboundEnvelope` via `getAdapter(channel)`; provider-specific wire logic (Meta payloads, signature scheme) lives inside the adapter. Add a channel = new adapter + registry entry + webhook route, no order-flow changes. See [`docs/messaging-channels.md`](./docs/messaging-channels.md).
- Mobile-first: ≥44px tap targets, single-column, sticky CTAs, bottom-anchored actions
- Multi-tenant via slugs from day one
- **All outbound messages flow through the `wabaProtection.canSend()` gateway** (via `makeGuardedSender(ctx, retailerId, category)`) — enforces the kill switch, per-seller caps, global opt-outs, and Meta quality status. **`transactional` order messages bypass all gating** (core promise); only `session_message`/templates are gated. See [`docs/waba-protection.md`](./docs/waba-protection.md)
- **Inbound `POST /webhook/whatsapp` verifies Meta's `X-Hub-Signature-256`** (HMAC-SHA256 with `WHATSAPP_APP_SECRET`) and **fails closed** — set the env var before deploying or webhooks 500
- **Customers are keyed by `(retailerId, waPhone)`; aggregates are denormalized** (refreshed on order create/cancel via `linkOrderToCustomer`/`decrementAggregatesForCancel`, counted once per order). Display name resolves `name → waProfileName → phone` via `getDisplayName`, mirrored in `convex/lib/customer.ts` + `src/lib/customer.ts`. A retailer-edited `name` is never overwritten by an inbound pushname.
- Customer payment gateway is **retailer-owned** (HitPay Connect / Billplz / Stripe Connect) — Kedaipal is never the merchant of record for shopper transactions
- **The buyer's no-auth tracking page (`/track/<token>`) is capability-secured by `orders.trackingToken`** (high-entropy, crypto-random), NOT the human `shortId` (which is short + enumerable, so never a secret). Public buyer endpoints key on the token; endpoints shared with the seller dashboard (`orders.get`/`getMockupUrls`/`getCustomerImageUrl`) accept the token (buyer, unauth) **or** an authenticated + ownership-checked `shortId` (seller) via `resolveSharedOrder`. New order data/mutations exposed to buyers must key on the token. See [`docs/infra-cost-scaling.md` §6](./docs/infra-cost-scaling.md).

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
