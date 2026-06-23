# Infrastructure, Cost & Scaling Map

> Living document. Snapshot of Kedaipal's full tech architecture, monthly cost
> drivers, the WhatsApp/WABA scaling model, security posture, and the
> observability plan. Written 2026-06-23 after the first paying customer went
> live. Update as tiers, pricing, or infra change.
>
> Companion docs: [`messaging-channels.md`](./messaging-channels.md),
> [`whatsapp-webhook-security.md`](./whatsapp-webhook-security.md),
> [`validation-and-rate-limits.md`](./validation-and-rate-limits.md),
> [`manual-subscription.md`](./manual-subscription.md). WABA protection design
> lives in ClickUp [`86expmgep`](https://app.clickup.com/t/86expmgep).

---

## 1. Architecture at a glance

```
                    ┌─────────────────────────────────────────┐
   WhatsApp user ──▶│ Meta WhatsApp Cloud API (ONE shared WABA)│
        ▲           └───────────────┬─────────────────────────┘
        │ wa.me deep link           │ webhook POST (HMAC-signed)
        │ (ORD-XXXX)                ▼
┌───────┴────────┐      ┌──────────────────────────────────────┐
│ Storefront     │      │ Convex Cloud (US region)             │
│ /<slug>        │      │  • HTTP actions: /webhook/whatsapp    │
│ (no shopper    │◀────▶│  • queries / mutations (multi-tenant) │
│  auth)         │      │  • internal actions → Meta Graph send │
└───────┬────────┘      │  • crons (2 daily: slug purge, billing)│
        │               │  • @convex-dev/rate-limiter component  │
┌───────┴────────┐      │  • file storage (logos, QR, proofs)    │
│ Dashboard /app │◀────▶│  ~20 tables (retailers, products,      │
│ (Clerk auth)   │      │   orders, customers, subscriptions…)  │
└───────┬────────┘      └───┬──────────┬──────────┬────────────┘
   TanStack Start           │          │          │
   on Cloudflare      Resend(email) Google     Clerk(auth)
   Workers/Pages                    Places(proxy)   GA4(client)
```

**Stack:** TanStack Start (React) on Cloudflare Workers/Pages · Convex Cloud
(functions + DB + storage + scheduler) · Clerk auth (dashboard only) · Meta
WhatsApp Cloud API (direct, no BSP) · Resend email · Google Places (server-side
proxy) · GA4. Code size: ~12.7k LOC Convex, ~30k LOC frontend.

**External dependencies and what each costs:** Meta (messaging — the swing
factor), Convex (compute+DB+storage), Cloudflare (edge hosting), Clerk (auth),
Resend (email), Google Places (address autocomplete), GA4 (free).

---

## 2. Cost breakdown

### Now (1 paying customer, low volume)
Effectively **~RM0–25/mo**. Everything sits in free tiers:

| Service | Free-tier headroom | Status |
|---|---|---|
| Convex | generous free tier | $0 |
| Cloudflare Workers/Pages | free tier | $0 |
| Clerk | <10k MAU (our MAU = retailers, tiny) | $0 |
| Resend | 3k emails/mo (100/day) | $0 |
| WhatsApp | service messages free (see §3) | ~$0 |
| Google Places | low session count | ~$0 |
| Domain | — | ~RM50/yr |

### At ~100 retailers / ~5,000 orders/mo (illustrative)

| Service | Cost driver | Est. /mo | Notes |
|---|---|---|---|
| Convex | functions + storage + bandwidth | ~$25–100 | Pro $25 base + usage |
| Cloudflare | Workers Paid | ~$5 | free tier may still cover |
| Clerk | dashboard users only | $0 | ~100–300 users |
| Resend | order-alert emails | ~$20 | 5k+ emails/mo |
| Google Places | checkout autocomplete | ~$50–90 | session-billed ~$17/1k |
| **WhatsApp** | **broadcasts + out-of-window templates** | **~$200–600** | **dominant variable, see §3–4** |
| **Total** | | **~$300–800** | WhatsApp + Places swing it |

> Figures are order-of-magnitude. **Verify current Meta Malaysia template rates
> and Google Places pricing** — both changed in 2024–2025.

---

## 3. The WhatsApp cost model (read this before touching tiers)

Meta bills **by message category**, not by raw count:

| Category | When | Cost (MY, approx — verify) |
|---|---|---|
| **Service / session** | reply within 24h of a user-initiated message | **FREE** |
| **Utility template** | transactional notification *outside* the 24h window | ~USD 0.015 (~RM0.07) |
| **Marketing template** | promotional / broadcast | ~USD 0.06 (~RM0.28) |

**The entire core order flow is free.** When a buyer taps the `wa.me` link, they
open a 24h service window; the confirm reply, payment ask, QR, and in-window
status updates all cost nothing. This is why the WhatsApp wedge is cheap to run.

**Cost only appears in two places:**
1. **Broadcasts** — every broadcast message is a marketing template (paid). This
   is the expensive one.
2. **Out-of-window notifications** — a "shipped" update sent 2 days after the
   buyer last messaged falls outside the 24h window and needs a utility template
   (paid). *Today the code sends these as free-form text, which Meta rejects
   outside the window — the send silently fails (see §6 / ticket).* 

---

## 4. Tier economics — why "Scale = infinite WA messages" must change

`convex/lib/plans.ts` currently sets `scale.broadcastQuota = Infinity`
(`UNLIMITED` sentinel). **This is an unbounded financial liability**: every
broadcast a Scale retailer sends is a marketing template Kedaipal pays Meta for,
with no ceiling. One Scale retailer broadcasting to 5k contacts twice a week ≈
40k marketing templates/mo ≈ **~RM11,000/mo of Meta cost on a single RM299
sub.** That is a direct loss.

### The hard constraint
Marketing templates cost ~RM0.28 each against an RM299 Scale sub:

| WhatsApp COGS budget | Marketing msgs that fit |
|---|---|
| 100% of RM299 (break-even, ignores all other cost) | ~1,068 |
| 25% of RM299 (healthy COGS) | ~265 |
| 20% of RM299 | ~213 |

At RM299 you **cannot** generously include thousands of broadcasts. The economics
force one of: (A) modest included quota + metered overage, (B) price Scale
higher, or (C) pure cost-plus pass-through.

### Recommendation — model (A), "included quota + metered overage"
This is what WATI / SleekFlow do, and it's the frugal, margin-safe choice.

| Tier | Included broadcasts/mo | Daily cap (deliverability) | Overage |
|---|---|---|---|
| Starter | 0 | n/a | — |
| Pro | 100 (current) | 200/day | n/a (or small metered) |
| **Scale** | **500** (was ∞) | **500/day** | **~RM0.45/marketing msg** (cost ~RM0.28 + margin) |

Notes:
- **Two different levers, both needed.** `broadcastQuota` is a *cost/billing*
  cap. The WABA `dailyCap` (ticket `86expmgep`) is a *deliverability* guard
  protecting the shared number's quality. They must share **one source of truth**
  — today they'd be defined in two places.
- **Utility templates (out-of-window status) scale with orders, not broadcasts**
  (~RM0.07 each) and are customer service, not marketing — budget them
  separately and do **not** cap them aggressively. At 500 orders/mo with ~half
  needing an out-of-window update, that's only ~RM18/mo.
- Pro's 100/mo broadcast cap may be low for a frozen-food reseller with 80
  resellers — flag as a product call, not an infra one.

### Structural ceiling: the shared WABA messaging tier
The shared number has **one** platform-wide messaging tier (250 → 1k → 10k →
100k msgs/24h, earned via volume + HIGH quality), shared across **all**
retailers. At ~100 retailers all wanting to broadcast, the platform tier — not
the dollar cost — becomes the cliff. The WABA ticket's "platform-wide cap at 80%
of current Meta tier" is what prevents hitting it. Watch this as closely as cost.

---

## 5. WABA scaling gaps (current state)

Outbound sends currently go straight `adapter.send → graph.facebook.com` with
**no** central gateway. Missing, all designed in ticket
[`86expmgep`](https://app.clickup.com/t/86expmgep) but still backlog (S4, ~July):

- **`wabaProtection.canSend(retailerId, toPhone, category)` gate** — every send
  should pass through it. Does not exist.
- **`optOuts`** — global STOP/BERHENTI handling. Legal + Meta-policy requirement
  the moment broadcast ships.
- **`wabaHealth`** — Meta quality-rating webhook ingestion + auto-pause.
- **`retailerSendingLimits`** — per-retailer caps + admin kill switch.
- **`outboundMessageLog`** — the message audit trail (also our WhatsApp cost
  ledger — see §7).

**Recommendation:** pull a **minimal** `canSend()` + `optOuts` +
`outboundMessageLog` forward *before* broadcast ships, even without the full
admin UI. Shared-WABA blast radius means one spammy retailer can degrade
deliverability for every paying customer simultaneously.

### Open question — Scale-tier BYO number
There's an idea to register a Scale retailer's *own* number onto the WABA. This
softens the "BYO WhatsApp Business Account — deliberately ruled out" line in
CLAUDE.md. If pursued, it changes the cost model (that retailer's volume no
longer competes for the shared tier) and the protection model (per-number quality
isolation). **Decision pending — do not build against it yet.**

---

## 6. Security posture

### Strong (no action)
- **Webhook auth** (`lib/whatsappSignature.ts`, `http.ts`): HMAC-SHA256 verify,
  fail-closed on missing secret (500) vs bad signature (401), constant-time
  compare, verify-before-parse. Textbook.
- **Price integrity** (`orders.create`): prices resolved server-side from the
  variant; client never dictates price. Stock reserved atomically in the same OCC
  transaction.
- **Tenant isolation:** `requireRetailerOwnership` / `requireRetailerOwner`
  applied consistently across product/order/customer/pickup mutations.
- **Secret scoping** (`src/lib/env.ts`): server vs `VITE_` client split correct;
  `.dev.vars` / `.env.local` gitignored.

### Findings (tracked as tickets)
- 🔴 **HIGH — `shortId` is a 4-char (~1M space) bearer token.** Same
  `ORD-XXXX` guards both reading the order (customer PII: name, phone, address,
  geo) and mutating it (`claimPayment`, `updateDeliveryAddress`,
  `updatePickupLocation`, `approveMockup`, …). Per-shortId rate limits don't stop
  *cross-ID enumeration*; `orders.get` (a query) has no throttle at all.
  Enumerable → PII harvest (PDPA exposure) + tampering. Also a collision risk
  past ~50–100k lifetime orders (32⁴, 3 retries).
- 🟠 **MEDIUM — status updates fail silently past 24h** (free-form text outside
  the service window; errors swallowed). UX dead-end + the reason out-of-window
  utility templates are needed.
- 🟡 **LOW — `seed:run` was a public mutation** → fixed to `internalMutation`.
- 🟡 **LOW — uploads aren't type/size-validated** (bounded storage-cost abuse).
- 🟡 **LOW — dead env var `ALLOW_TEST_HELPERS`** set in Convex but unused in
  code → remove.
- ℹ️ **PDPA / data residency:** Convex (US) + Cloudflare (global) hold Malaysian
  customer PII. Compliance item for the legal pack, not a code bug.
- ℹ️ **Admin = `ADMIN_USER_IDS` env allowlist** — fine for v1 (fails closed,
  server-checked); document rotation; graduates to Clerk role later.
- ℹ️ **Confirm `WHATSAPP_ACCESS_TOKEN` is a permanent System User token** (not a
  24h token), else sends silently die after a day.

---

## 7. Logging & observability — build vs. buy

Today: only Convex's built-in logs + dashboard, plus client GA4. No error
tracking, no searchable store. Frugal recommendation — **buy the generic,
build only the domain ledger:**

1. **Errors/exceptions → Sentry free tier** (5k errors/mo). Drop-in for the
   TanStack frontend + Convex actions. The standard frugal choice. $0.
2. **Searchable app logs → Convex Log Streams → Axiom free tier** (0.5 TB/mo).
   Native Convex export, zero code. Often not needed until past the dashboard
   viewer's limits.
3. **Product analytics → PostHog free tier** (1M events/mo). Already roadmapped
   (S2). Keep it.
4. **Build in-house: `outboundMessageLog`** — this is *not* generic logging,
   it's the **WhatsApp cost ledger + WABA audit trail** (already designed in
   ticket `86expmgep`). It's product/business data — who sent what, delivery
   status, category, per-retailer cost attribution. Keep it in Convex, queryable.
   Do not outsource.

**Net stack: Sentry + PostHog + Convex logs + own `outboundMessageLog` ≈ $0/mo
until well past 100 retailers.** No custom logging infra to build beyond the
message ledger you already designed.

---

## 8. Recommended action order
1. `shortId` capability hardening (HIGH security) — ticket.
2. Pull minimal WABA `canSend()` + `optOuts` + `outboundMessageLog` forward from
   S4 — comment on `86expmgep`.
3. Finite Scale `broadcastQuota` + single source of truth with WABA caps —
   ticket.
4. Out-of-window status updates via utility templates — ticket.
5. `seed:run` → internal + drop dead `ALLOW_TEST_HELPERS` — done in code.
6. Wire Sentry — ticket.
