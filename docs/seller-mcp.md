# Seller MCP server — "ask your business" from Claude/ChatGPT

ClickUp [`z8r3fdff6p`](https://app.clickup.com/t/z8r3fdff6p). A remote
[MCP](https://modelcontextprotocol.io) server sellers connect to their own AI
assistant (Claude or ChatGPT custom connector) to ask for their business
numbers in plain language — "how were sales this week?", "who hasn't paid?",
"what's due tomorrow?". **Read-only v1, free (never credit-metered), Pro+,
active subscription required.**

## The decisions this feature encodes (16 Sep 2026, Zaki)

| Decision | Rule |
|---|---|
| **Pricing** | MCP calls are **free** and never debit order credits. The locked principle: *a credit is spent only where Kedaipal incurs a real per-unit cost* (Meta sends, future server-side AI). Reads cost ~nothing; the guard is rate limiting, not metering. One assistant question fans out into 5–20 tool calls the seller doesn't control — metering that is a surprise bill. |
| **Gating** | Pro + Scale (`PLAN_FEATURES.mcp`), a size signal per the feature-gate audit rule. Starter sees the settings card disabled-with-reason. |
| **Sub lock** | An expired (`past_due`) subscription refuses MCP calls with a renew message. This is a **deliberate divergence** from dashboard reads (which stay open while past_due): MCP access is a vendor action, and the decision is that an expired sub locks vendor actions. Frozen outranks the plan pitch — "pay your invoice" beats an upsell. |
| **Read-only** | Hard line. Every tool is a query; there is no write tool. A write reachable from a third-party AI client could message real buyers off a hallucination. Writes, if ever, come later with explicit confirmation flows. |
| **Shared tool layer** | The analytics logic lives in `convex/sellerTools.ts` as plain internal Convex functions. MCP is transport **client #1**; the planned in-app / WhatsApp "ask your business" assistant is client #2 of the same functions. Never put query logic in the HTTP handler. |

## Architecture

```
Claude / ChatGPT connector
        │  OAuth 2.1 ("Sign in with Kedaipal", Clerk is the auth server)
        ▼
POST https://<deployment>.convex.site/mcp        (convex/http.ts)
        │  1. verify Bearer token → Clerk GET /oauth/userinfo → Clerk user id
        │  2. resolveMcpContext(clerkUserId) → retailer + gates   ← tenant boundary
        │  3. checkMcpRateLimit(retailerId)  → 60/min burst 30, 2 000/day
        ▼
convex/sellerTools.ts   (internal queries — the shared tool layer)
        │  reuses analytics.scanRange + lib/insights + lib/orderBuckets
        ▼
the same numbers the dashboard shows
```

- **Protocol**: stateless streamable HTTP — a single `POST /mcp` handling
  JSON-RPC `initialize`, `ping`, `tools/list`, `tools/call`; notifications get
  202; `GET /mcp` is 405 (no SSE stream to resume). Protocol constants, the
  tool catalog, period math and gate copy are pure in `convex/lib/mcp.ts`.
- **Auth**: Clerk OAuth access tokens are **opaque** (not JWTs), so `ctx.auth`
  can't validate them — the route verifies each against Clerk's
  `oauth/userinfo` (reusing `CLERK_JWT_ISSUER_DOMAIN`; no new env var) and
  resolves the user to **their own** retailer. **The client never supplies a
  retailerId** — there is no such parameter in the protocol, which is the
  tenant boundary. Missing issuer env → 500 "server misconfigured" (house
  convention: our fault ≠ caller's fault).
- **Discovery**: `/.well-known/oauth-protected-resource[/mcp]` names Clerk as
  the authorization server (401 responses carry the pointer in
  `WWW-Authenticate`); `/.well-known/oauth-authorization-server` proxies
  Clerk's live metadata so dashboard changes (e.g. enabling dynamic client
  registration) surface without a deploy.
- **CORS**: permissive on the MCP + well-known routes only — it's a
  bearer-token JSON API (no cookies, no ambient auth), and browser-based MCP
  clients preflight. The rest of `http.ts` stays CORS-less as before.
- **Rate limiting**: `mcpToolCall` (60/min, burst 30 — sized so one question's
  fan-out never trips it) + `mcpToolCallDaily` (2 000/day) via the
  `@convex-dev/rate-limiter` component, keyed by retailerId. Over-limit is a
  relayable "try again in ~Ns" tool error, never a silent drop.
- **Gate refusals are tool results with `isError`**, not protocol errors — the
  text is copy the assistant relays to the seller verbatim, so it's written as
  seller-facing sentences (`MCP_GATE_COPY` in `convex/lib/mcp.ts`).

## Tools (v1)

All money leaves the server in **major units** with a `currency` field stamped
on every payload (sen integers read as 100× typos in chat); dates are
`YYYY-MM-DD` MYT. Every list result carries the shared `capped` /
`totalMatching` honesty flags — never silent truncation.

| Tool | Answers | Source of truth |
|---|---|---|
| `sales_summary` | earned (deposit-net), collected, order count, AOV, top products, payment + source splits for a period | `analytics.scanRange` + `reduceInsights` — **identical to `/app/insights`** |
| `top_products` | ranked products by revenue/quantity | same reduce, wider K |
| `order_counts` | inbox buckets (new / in progress / completed / cancelled), unpaid open orders + amount, due today | `orderBucket` — the one legal leaf derivation; unpaid/dueToday mirror `searchOrders`' tally rules (counter orders never count toward dueToday) |
| `unpaid_orders` | the chase list — open, not received, newest first | same scan |
| `upcoming_fulfilments` | dated open orders in today/tomorrow/this-week (indexed on `by_retailer_fulfilment`) + active/starting bookings | `matchesFulfilmentWindow` / `matchesBookingPeriod` |
| `top_customers` | all-time best customers by spend/orders (`totalSpent` is **gross** — the description warns it won't reconcile with deposit-net earned) | `by_retailer_ltv` / `by_retailer_orderCount` |
| `low_stock` | stock-tracked variants at/below a threshold; made-to-order never appears | `(variant.blockWhenOutOfStock ?? product.blockWhenOutOfStock) === true` — the shared idiom |
| `credit_balance` | **stub** — says credits aren't live until Credits T1 (`86eye2ccu`) ships its ledger, then swaps to a real `getBalance` read |

Reporting periods (`convex/lib/mcp.ts` `resolvePeriod`): today, yesterday,
last_7_days, last_30_days, this_month, last_month. Rolling windows **include
today** — a seller asking "last 7 days" means "up to now", unlike Insights'
closed historical ranges.

## Seller-facing surface

Settings → **Integrations → AI assistant** card
(`src/components/settings/ai-assistant-card.tsx`): what it is, the read-only
promise, the server URL (`<convex>.convex.site/mcp`, copy button), connect
steps for Claude and ChatGPT, the disconnect story ("remove the connector in
the AI app"), and the Pro gate as a visible disabled-with-reason note. No
connection status / revoke list in v1 — the OAuth grant lives with Clerk and
the connector inside the seller's AI app; surfacing grant management is a
follow-up if Clerk exposes it per-user.

## Operator setup (once, before the first real connect)

1. **Clerk Dashboard → OAuth applications**: enable **dynamic client
   registration** (claude.ai and ChatGPT connectors register themselves). Our
   instance already serves the full authorization-server metadata; DCR is the
   one missing toggle (verified 16 Sep — no `registration_endpoint` yet).
2. Confirm the consent screen copy reads sensibly ("Kedaipal" name + logo).
3. Terms: one line in the data-processor clause (`z8r3fdf90k`, Arif) noting
   that a seller who connects an AI assistant sends their store data (which can
   include customer names/phones they already see in the dashboard) through
   their chosen AI provider.

No new Convex env vars. No schema changes (the rate-limiter component owns its
own tables).

## Tests

- `convex/lib/mcp.test.ts` — period math (MYT boundaries), formatting, JSON-RPC
  shapes, catalog sanity.
- `convex/sellerTools.test.ts` — **tenant isolation** (the mutation-test-grade
  block: a Clerk user can only ever resolve to their own store), gate order
  (frozen outranks plan), Insights-semantics agreement (deposit-net earned,
  pending/cancelled excluded), bucket rules (counter ≠ dueToday), the
  variant-prefers-product stock idiom, the 30-burst rate limit edge.
- `convex/mcpHttp.test.ts` — end-to-end over `t.fetch` with a stubbed Clerk
  `userinfo`: 401 + `WWW-Authenticate` pointer, handshake, catalog, real tool
  dispatch, gate copy as `isError` results, end-to-end isolation (the bearer
  token is the only tenant selector), and the .well-known discovery routes.
