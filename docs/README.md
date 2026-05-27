# Kedaipal Documentation

Central index for engineering docs. New here? Start with **[Onboarding](#start-here)** and follow the reading order.

> Strategy and code conventions live at the repo root: [`PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md) (business strategy) and [`CLAUDE.md`](../CLAUDE.md) (conventions, MVP status, roadmap, architectural constraints).

## Start here

| Doc | What it covers |
|---|---|
| **[onboarding.md](./onboarding.md)** | KT path for a new CTO/engineer: strategy → architecture → local setup → codebase tour → domain reading order → conventions → first contribution. |

## Domain logic

How the product actually works. Read in this order.

| Doc | What it covers |
|---|---|
| [data-model.md](./data-model.md) | Convex schema: entities, relationships, multi-tenancy, indexes, ER diagram. |
| [order-lifecycle.md](./order-lifecycle.md) | Checkout → `wa.me` handoff → confirmation → fulfilment state machine. |
| [payment-handshake.md](./payment-handshake.md) | The `unpaid → claimed → received` payment flow (shipped). |
| [customer-database.md](./customer-database.md) | CRM-lite: customer entity, denormalized aggregates, name resolution, search. |
| [validation-and-rate-limits.md](./validation-and-rate-limits.md) | Trust boundaries, rate limits, input validation, mirrored validators, legal consent. |

## Architecture & security

| Doc | What it covers |
|---|---|
| [messaging-channels.md](./messaging-channels.md) | ChannelAdapter seam — WhatsApp as one of N channels; how a 2nd channel lands. |
| [whatsapp-webhook-security.md](./whatsapp-webhook-security.md) | Inbound webhook signature verification (HMAC-SHA256), fail-closed. |
| [email-notifications.md](./email-notifications.md) | Retailer email alerts (Resend) — new order, confirmed, payment claimed. |

## Roadmaps (designed / in-progress)

Forward-looking design docs. Confirm current status against [`CLAUDE.md`](../CLAUDE.md) and the [ClickUp roadmap](https://app.clickup.com/90182681518/v/li/901818308046) before building.

| Doc | Status note |
|---|---|
| [payment-handshake-roadmap.md](./payment-handshake-roadmap.md) | **Shipped** — superseded by [payment-handshake.md](./payment-handshake.md); kept for design rationale. |
| [bulk-product-upload-roadmap.md](./bulk-product-upload-roadmap.md) | CSV/XLSX import feature menu + execution order. |
| [product-variants-roadmap.md](./product-variants-roadmap.md) | Variant schema design (size/color). |
| [marketplace-integration.md](./marketplace-integration.md) | Shopee / TikTok Shop integration research + phased roadmap. |

## Conventions

Before touching Convex code, read [`convex/_generated/ai/guidelines.md`](../convex/_generated/ai/guidelines.md) — it overrides general Convex knowledge. Tooling: Biome (lint/format), Vitest + `convex-test` (tests), TanStack Start + Tailwind (frontend, mobile-first).
