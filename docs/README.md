# Kedaipal Documentation

Central index for engineering docs. New here? Start with **[Onboarding](#start-here)** and follow the reading order.

> Strategy and code conventions live at the repo root: [`PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md) (business strategy) and [`CLAUDE.md`](../CLAUDE.md) (conventions, MVP status, roadmap, architectural constraints). `CLAUDE.md` is **rules and pointers only** — the shipped-feature record lives in [`shipped-log.md`](./shipped-log.md), and feature detail in the per-feature docs below.

## Start here

| Doc | What it covers |
|---|---|
| **[onboarding.md](./onboarding.md)** | KT path for a new CTO/engineer: strategy → architecture → local setup → codebase tour → domain reading order → conventions → first contribution. |
| **[shipped-log.md](./shipped-log.md)** | Everything shipped since the April 2026 MVP, newest first — what shipped, why it was built that way, what was rejected, which trap was found. The project's decision history; read it to understand *why* the code looks like it does. |

## Domain logic

How the product actually works. Read in this order.

| Doc | What it covers |
|---|---|
| [data-model.md](./data-model.md) | Convex schema: entities, relationships, multi-tenancy, indexes, ER diagram. |
| [order-lifecycle.md](./order-lifecycle.md) | Checkout → `wa.me` handoff → confirmation → fulfilment state machine. |
| [one-message-per-order.md](./one-message-per-order.md) | **The messaging policy every other doc defers to:** an order sends the buyer exactly ONE WhatsApp, when its price goes final; everything after lives on `/track/<token>`. Read before adding anything buyer-facing. |
| [order-note.md](./order-note.md) | Shopper's free-text note at checkout: persisted on the order, carried in the `wa.me` body, surfaced to the seller + echoed to the buyer. |
| [payment-handshake.md](./payment-handshake.md) | The `unpaid → claimed → received` payment flow (shipped). |
| [customer-database.md](./customer-database.md) | CRM-lite: customer entity, denormalized aggregates, name resolution, search. |
| [fulfilment.md](./fulfilment.md) | Delivery + self-collect as optional, symmetric methods: per-method toggles, the working-method invariant, multi-location pickup library, frozen snapshot lifecycle, WhatsApp confirm composition. |
| [delivery-live-pricing.md](./delivery-live-pricing.md) | **What the buyer pays for delivery when a store books couriers live:** the provider-aware rule (quote every armed provider, charge the higher), why min-pricing was rejected, cold-cart handling, and the cross-currency guard. |
| [delivery-lalamove.md](./delivery-lalamove.md) | Intra-city rider booking: live checkout quotes, the confirm-and-dispatch flow, webhook-driven status, and the disabled-with-reason taxonomy. |
| [delivery-delyva.md](./delivery-delyva.md) | Nationwide parcel + cold-chain courier booking: one-key connect, the service picker, webhooks, demo/sandbox detection, and the per-country tenancy facts. |
| [claim-links.md](./claim-links.md) | Claim links (TikTok Live): seller-keyed, price-locked checkout the buyer completes under a fixed window; resend guard, expiry, commit rules. |
| [despatch-labels.md](./despatch-labels.md) | The printed parcel label: per-store template config, A6 vs A4 4-up, single + bulk + one-click "ready to ship" printing, skip rules, and the in-repo QR / Code 128 encoders. |
| [product-variants.md](./product-variants.md) | Option-axes + variant-rows model: `productVariants` table, storefront pickers + grey-out, per-variant made-to-order + mockup-approval flags, variant-grid editor. |
| [landing-video-demo.md](./landing-video-demo.md) | The 30-second demo on `/`: why it sits directly under the hero, the 21.5 MB → 928 KB encode recipe, the `preload="none"` loading posture, and the player's autoplay/pause/reduced-motion rules. |
| [validation-and-rate-limits.md](./validation-and-rate-limits.md) | Trust boundaries, rate limits, input validation, mirrored validators, legal consent. |

## Architecture & security

| Doc | What it covers |
|---|---|
| [messaging-channels.md](./messaging-channels.md) | ChannelAdapter seam — WhatsApp as one of N channels; how a 2nd channel lands. |
| [whatsapp-webhook-security.md](./whatsapp-webhook-security.md) | Inbound webhook signature verification (HMAC-SHA256), fail-closed. |
| [dependency-security.md](./dependency-security.md) | `pnpm audit` policy, current advisory posture, why Clerk + TanStack are exact-pinned. |
| [founder-business-report.md](./founder-business-report.md) | Kedaipal's own weekly numbers: invoice-derived MRR per currency, the four-way `past_due` split, the secret-guarded endpoint, and prod-readable Convex MCP. |
| [email-notifications.md](./email-notifications.md) | Retailer email alerts (Resend) — new order, confirmed, payment claimed. |

## Roadmaps (designed / in-progress)

Forward-looking design docs. Confirm current status against [`CLAUDE.md`](../CLAUDE.md) and the [ClickUp roadmap](https://app.clickup.com/90182681518/v/li/901818308046) before building.

| Doc | Status note |
|---|---|
| [payment-handshake-roadmap.md](./payment-handshake-roadmap.md) | **Shipped** — superseded by [payment-handshake.md](./payment-handshake.md); kept for design rationale. |
| [bulk-product-upload-roadmap.md](./bulk-product-upload-roadmap.md) | CSV/XLSX import feature menu + execution order. |
| [product-variants-roadmap.md](./product-variants-roadmap.md) | **Shipped** — superseded by [product-variants.md](./product-variants.md); kept for the import/export shape discussion. |
| [proof-approval.md](./proof-approval.md) | **Implemented** — made-to-order mockup approval: per-variant gate, buyer approve/request-changes loop, time-based deadlock waiver. |
| [marketplace-integration.md](./marketplace-integration.md) | Shopee / TikTok Shop integration research + phased roadmap. |

## Conventions

| Doc | What it covers |
|---|---|
| [release-checklist.md](./release-checklist.md) | **Run this whenever `src/content/releases.ts` is touched.** Editing the release notes means a staging→main deploy is imminent: bump the version, then audit the diff for env vars, backfills, schema/index changes, crons, Meta templates and plan-gating moves, and write the findings — including "none" — into the release PR. |
| [whats-new.md](./whats-new.md) | Seller-facing release notes: where entries live, how to write one, and the rules deciding who gets interrupted (notable-only modal, unset-means-caught-up, act-as safety). **Read before writing a release note.** |

Before touching Convex code, read [`convex/_generated/ai/guidelines.md`](../convex/_generated/ai/guidelines.md) — it overrides general Convex knowledge. Tooling: Biome (lint/format), Vitest + `convex-test` (tests), TanStack Start + Tailwind (frontend, mobile-first).
