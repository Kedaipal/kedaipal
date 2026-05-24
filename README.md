# Kedaipal

**Kedaipal** ("kedai" = shop + "pal") is a WhatsApp-first B2B SaaS order hub for serious WhatsApp sellers in Malaysia. Shoppers receive a CTA link, browse a hosted storefront, build a cart, and complete the order via a `wa.me` deep link. The retailer dashboard handles products, inventory, customers, and order management in real time.

**Current cohort focus:** Established **F&B home sellers** (cake decorators, frozen food + reseller networks, kuih and pastry sellers) doing 20+ orders/week. Product is positioned broadly enough to serve any pre-order WhatsApp business.

**Differentiator:** Kedaipal runs a shared Meta-verified WhatsApp Business Account, so retailers don't need to set up their own WABA or complete Meta business verification. Sign up, share your storefront link, live in 5 minutes.

---

## Business Overview

| Concern | Detail |
|---|---|
| Storefront | `kedaipal.com/<retailer-slug>` — no shopper auth required |
| Dashboard | Clerk-protected retailer admin |
| Order flow | WhatsApp CTA → storefront → cart → `wa.me` deep link with `ORD-XXXX` → Convex confirms |
| Catalog | Hosted in Convex (not Meta Commerce Catalog) |
| WhatsApp | Shared Kedaipal-owned WABA — no Meta verification required of retailers |
| Pricing | 3 tiers: Starter RM79 / Pro RM149 / Scale RM299 + 14-day trial (no card) |
| Customer payments | Retailer-owned gateway (HitPay Connect / Billplz / Stripe Connect) — Kedaipal never touches order money |
| Subscription billing | Stripe Singapore + HitPay/Billplz |
| Roadmap | Shopee, Lazada, TikTok Shop, StoreHub connectors — parked behind F&B core |

See [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md) for full strategic context and [`CLAUDE.md`](./CLAUDE.md) for code-level conventions.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | [TanStack Start](https://tanstack.com/start) (React + TanStack Router/Query) |
| Styling | Tailwind CSS — mobile-first, ≥44px tap targets |
| Backend / DB | [Convex](https://convex.dev) — functions, HTTP actions, scheduled jobs |
| Auth | [Clerk](https://clerk.com) — retailer dashboard only |
| Hosting | Cloudflare Workers / Pages + Convex Cloud |
| Messaging | WhatsApp Cloud API (Meta test number for MVP) |
| Linting / Formatting | [Biome](https://biomejs.dev/) |
| Testing | [Vitest](https://vitest.dev/) |
| Package manager | pnpm |

---

## Getting Started

```bash
pnpm install
pnpm dev
```

### Environment variables

Frontend vars live in `.env.local`; backend vars are set on the Convex deployment (`npx convex env set KEY value`, add `--prod` for production).

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_CONVEX_URL` | frontend | Convex deployment URL |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex | Clerk JWT issuer for auth |
| `APP_URL` | Convex | Base URL used in WhatsApp/tracking links |
| `WHATSAPP_ACCESS_TOKEN` | Convex | Cloud API bearer token (outbound sends) |
| `WHATSAPP_PHONE_NUMBER_ID` | Convex | Sender phone number ID |
| `WHATSAPP_VERIFY_TOKEN` | Convex | Webhook subscription handshake (GET) |
| `WHATSAPP_APP_SECRET` | Convex | **Webhook signature verification** — Meta App → Settings → Basic. The webhook **fails closed**, so set this before deploying or inbound webhooks return 500. See [`docs/whatsapp-webhook-security.md`](./docs/whatsapp-webhook-security.md). |
| `WHATSAPP_CHECKOUT_PHONE` | Convex | Number the storefront `wa.me` handoff targets |
| `RESEND_API_KEY`, `EMAIL_FROM` | Convex | Retailer email notifications (see [`docs/email-notifications.md`](./docs/email-notifications.md)) |

### Build for production

```bash
pnpm build
```

### Tests

```bash
pnpm test
```

### Lint & format

```bash
pnpm lint
pnpm format
pnpm check
```

---

## Project Structure

Routes are file-based under `src/routes/`. The root layout lives in `src/routes/__root.tsx`.

- `src/routes/index.tsx` — public landing page
- `src/routes/app.tsx` — retailer dashboard (Clerk-protected)
- `convex/` — backend schema, queries, mutations, HTTP actions

---

## Routing

This project uses [TanStack Router](https://tanstack.com/router) with file-based routing.

```tsx
import { Link } from "@tanstack/react-router";

<Link to="/about">About</Link>
```

---

## Server Functions

```tsx
import { createServerFn } from '@tanstack/react-start'

const getServerTime = createServerFn({ method: 'GET' }).handler(async () => {
  return new Date().toISOString()
})
```

---

## Learn More

- [TanStack documentation](https://tanstack.com)
- [TanStack Start](https://tanstack.com/start)
- [Convex documentation](https://docs.convex.dev)
