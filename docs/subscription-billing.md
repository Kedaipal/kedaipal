# Subscription Billing — v1 (manual) + WhatsApp cost model

**Status:** Planning notes / design sketch for the billing v1 ticket — NOT yet built.
**Date:** 15 Jun 2026
**Tickets:** Billing v1 [`86expn2qg`](https://app.clickup.com/t/86expn2qg) ("[Billing] Manual subscription v1 — invoice + mark-paid + entitlement + Founding Member badge", _to do_) · WABA Protection & Kill Switch [`86expmgep`](https://app.clickup.com/t/86expmgep) (_backlog_, Sprint 4) · 10 paying customers milestone [`86exq9kxy`](https://app.clickup.com/t/86exq9kxy)
**Related:** [`order-status-customization.md`](./order-status-customization.md) (the ≤5 notify-stage interim cap lives here) · [`messaging-channels.md`](./messaging-channels.md) (the `canSend()` seam) · CLAUDE.md (pricing table, sprint plan)

> These are **planning notes captured before the ticket starts** so the cost
> analysis + schema design aren't lost. All money figures are **interim
> placeholders** to re-tune with real usage data once we have live orders.

> **Update (28 Jun 2026):** the "unlimited Scale" margin trap flagged below was
> resolved — Scale now carries **finite soft caps (2,000 orders/mo, 500
> broadcasts/mo)**, exactly the fair-use direction this doc recommended. Canonical
> caps live in `convex/lib/plans.ts` + [`manual-subscription.md`](./manual-subscription.md);
> the "unlimited" rows below are kept as the original analysis only.

---

## 0. Why this doc

Before building manual subscription billing we worked through: (a) what WhatsApp
actually costs per message, (b) how many messages a Kedaipal order generates and
which are paid, (c) what that means per tier, and (d) how to price overage so it
covers cost and nudges upgrades. Then we sketched the entitlement schema so the
future `canSend()` gateway can read limits directly. All of it is below.

---

## 1. WhatsApp message cost (Malaysia, post–1 Jul 2025)

Meta switched from per-*conversation* to **per-delivered-message** billing on
1 Jul 2025. Meta bills in **USD**; MYR floats with FX (~RM4.42/USD), so treat
these as planning numbers and confirm against Meta's official rate card before
locking prices.

| Category | ~USD | ~MYR | Kedaipal usage |
|---|---|---|---|
| **Service** (free-form reply to a buyer msg, within 24h) | Free | **Free** | The confirm reply after `wa.me` checkout |
| **Utility** template | ~$0.014 | **~RM0.06** | Status/stage updates, payment-received |
| **Marketing** template | ~$0.086 | **~RM0.38** | **Broadcasts** |
| Authentication | ~$0.014 | ~RM0.06 | (not used) |

**The lever that changes everything:** since 1 Apr 2025, **utility templates are
FREE inside the 24-hour customer-service window** (within 24h of the buyer's last
message). The buyer opens that window the moment they `wa.me` us their order.

Sources:
[Meta pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) ·
[Meta July-2025 update](https://developers.facebook.com/docs/whatsapp/pricing/updates-to-pricing/) ·
[Xwork MY cost guide](https://www.xwork.my/whatsapp-automation-malaysia-cost/) ·
[Controlhippo update](https://controlhippo.com/blog/whatsapp/whatsapp-business-api-pricing-update/)

---

## 2. Messages per order — which are actually paid

Because the buyer initiates checkout via `wa.me`, the early messages ride the free
24h window:

- **Confirm reply** → free (buyer just messaged).
- **Payment-received** → usually free (buyer interacted recently).
- **Status/stage updates** → utility. **Free if within 24h** of the buyer's last
  message; **~RM0.06 if later.** "Packed" (hours later) is often free; "shipped"/
  "delivered" (next day+) usually fall outside the window = **paid**.

**Realistic: ~RM0.06–0.18 per order** (1–3 paid utility messages).
**Worst case** (a seller enables notify on all 5 stages and all land outside the
window): **~RM0.30/order**. → this is exactly why notify stages are capped at 5,
but it's a **minor** lever vs broadcasts (§5).

---

## 3. Cost vs tier price — margin risk

| Tier | Price | Orders/mo | Status-msg WA cost (realistic → worst) |
|---|---|---|---|
| Starter | RM79 | 100 | ~RM6–12 → RM30 — ✅ comfortable |
| Pro | RM149 | 500 | ~RM30–90 → **RM150** — ⚠️ worst case ≈ whole price |
| Scale | RM299 | unlimited | **unbounded** — ⚠️ a 2,000-order seller ≈ RM120–600 |

Two flags:
- **"Unlimited" on Scale is a margin trap** at RM299 once WA cost is real → needs a
  fair-use ceiling (proposed 3,000 orders) + overage past it.
- This is **before broadcasts**, the bigger leak (§5).

---

## 4. Timing (from the roadmap)

- **Billing v1 [`86expn2qg`]** — _to do_, assigned to Zaki. Already scopes
  **entitlement** → the per-tier limit config below should live there.
- **WABA Protection & Kill Switch [`86expmgep`]** — _backlog_, Sprint 4. The
  **enforcement** (`canSend()` gateway, rate limits, opt-outs, quality, kill switch)
  lands here, AFTER billing.
- CLAUDE.md: Subscription Billing = S1–S3 (target **first paying customer Jul 5,
  2026**); WABA Protection = S4.

**Implication:** v1 = store + meter + surface usage, enforce **softly**. Hard
blocking wires in when `canSend()` ships in S4. The schema below is designed so
that gateway reads it directly with no rework.

---

## 5. The real cost driver is broadcasts, not status updates

Status notifies are utility (~RM0.06, often free in-window). **Broadcasts are
marketing (~RM0.38 each), always paid.** Pro includes 100/mo (~RM38 cost); Scale's
"unlimited broadcasts" is the genuinely uncapped exposure. **When setting tier
numbers, prioritise the broadcast quota + overage over the status-notify cap.**

---

## 6. Proposed tier numbers (interim — validate with real data)

Designed so overage > our cost everywhere, and the math nudges an upgrade.

| | Starter RM79 | Pro RM149 | Scale RM299 |
|---|---|---|---|
| Included orders | 100 | 500 | "unlimited" → fair-use **3,000** |
| Order overage | **RM0.70/order** | **RM0.50/order** | RM0.30/order past fair-use |
| Notify stages | ≤5 | ≤5 | ≤5 |
| Broadcasts/mo | 0 | 100 (then RM0.50) | 2,000 fair-use (then RM0.50) |
| Seats | 1 | 2 | 5 |
| Custom domain | — | — | ✓ |

Upgrade-pressure math:
- **Starter @ RM0.70:** ~200 orders → `79 + 100×0.70 = RM149` = Pro price but 2.5× less
  headroom → upgrade is the obvious move. Covers the ~RM0.30 worst-case cost.
- **Pro @ RM0.50:** ~800 orders → `149 + 300×0.50 = RM299` = Scale price → nudge at the
  right volume.
- Overage everywhere comfortably exceeds cost → volume never loses money, "ouch" is
  mild enough to feel fair.

---

## 7. Entitlement schema sketch

**3-layer split** so `canSend()` reads entitlement directly, no re-derivation:
catalog (code) → subscription (per-retailer state) → usage (per-period counters).
Plus an invoices table for the manual invoice → mark-paid flow.

### A. Tier catalog — `convex/lib/tiers.ts` (pure, no Convex imports)

Code constant, not a DB table: 3 tiers, rarely change, pure = unit-testable +
shareable with the pricing page. Per-retailer deviations (founding deals,
grandfathering) are `overrides` on the subscription doc → no `plans` table needed.

```ts
export type Tier = "starter" | "pro" | "scale";

export type TierLimits = {
  ordersPerMonth: number | null;    // null = "unlimited" → ordersFairUse applies
  ordersFairUse: number | null;     // soft ceiling for unlimited tiers (Scale)
  seats: number;
  broadcastsPerMonth: number;
  notifyStagesMax: number;          // supersedes the flat MAX_NOTIFY_STAGES=5
  customDomain: boolean;
  orderOverageSen: number | null;   // minor units (sen); null = hard cap (block, don't bill)
  broadcastOverageSen: number | null;
};

export type TierPlan = TierLimits & { priceSen: number; label: string };

// All money in minor units (sen) — matches the orders/mockup convention.
export const TIERS: Record<Tier, TierPlan> = {
  starter: { label: "Starter", priceSen: 7900, ordersPerMonth: 100, ordersFairUse: null,
             seats: 1, broadcastsPerMonth: 0, notifyStagesMax: 5, customDomain: false,
             orderOverageSen: 70, broadcastOverageSen: null },
  pro:     { label: "Pro", priceSen: 14900, ordersPerMonth: 500, ordersFairUse: null,
             seats: 2, broadcastsPerMonth: 100, notifyStagesMax: 5, customDomain: false,
             orderOverageSen: 50, broadcastOverageSen: 50 },
  scale:   { label: "Scale", priceSen: 29900, ordersPerMonth: null, ordersFairUse: 3000,
             seats: 5, broadcastsPerMonth: 2000, notifyStagesMax: 5, customDomain: true,
             orderOverageSen: 30, broadcastOverageSen: 50 },
};
```

### B. `subscriptions` table (per-retailer, 1:1)

Separate table, not fields on `retailers` — billing is a distinct lifecycle; keeps
the hot retailer doc lean.

```ts
subscriptions: defineTable({
  retailerId: v.id("retailers"),
  tier: v.union(v.literal("starter"), v.literal("pro"), v.literal("scale")),
  status: v.union(
    v.literal("trialing"), v.literal("active"),
    v.literal("past_due"), v.literal("canceled"), v.literal("expired"),
  ),
  billingInterval: v.union(v.literal("monthly"), v.literal("annual")),
  currentPeriodStart: v.number(),   // drives the usage period key
  currentPeriodEnd: v.number(),
  trialEndsAt: v.optional(v.number()),
  foundingMember: v.boolean(),      // v1 badge + any locked-in deal
  overrides: v.optional(v.object({  // each optional; unset → TIERS[tier]
    ordersPerMonth: v.optional(v.number()),
    broadcastsPerMonth: v.optional(v.number()),
    notifyStagesMax: v.optional(v.number()),
    priceSen: v.optional(v.number()),
  })),
  externalRef: v.optional(v.string()),   // bank ref / future Stripe sub id
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_retailer", ["retailerId"])
  .index("by_status", ["status"])              // past_due / trialing sweeps
  .index("by_periodEnd", ["currentPeriodEnd"]) // renewal + trial-expiry cron
```

### C. `subscriptionUsage` table (per-retailer × period, high-churn counters)

Split out per the Convex high-churn guideline; counters increment on every order/
message. **Denormalized counters — never `.collect().length`.** Keyed by
`periodStart` so each cycle is its own row → overage invoicing = "read last period".

```ts
subscriptionUsage: defineTable({
  retailerId: v.id("retailers"),
  periodStart: v.number(),     // == subscription.currentPeriodStart at the time
  orders: v.number(),
  waUtilityPaid: v.number(),   // utility sent OUTSIDE the 24h window (billable)
  waUtilityFree: v.number(),   // in-window/free — visibility only, not billed
  waMarketing: v.number(),     // broadcasts (always paid)
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_retailer_period", ["retailerId", "periodStart"])
```

Increment points: `orders.create` → `orders += 1`; the channel adapter `send` (or
`canSend`) → bump the right `wa*` counter by category + free/paid window.

### D. `invoices` table (manual v1)

```ts
invoices: defineTable({
  retailerId: v.id("retailers"),
  periodStart: v.number(),
  periodEnd: v.number(),
  tier: v.union(v.literal("starter"), v.literal("pro"), v.literal("scale")),
  lineItems: v.array(v.object({
    kind: v.union(v.literal("subscription"), v.literal("order_overage"),
                  v.literal("broadcast_overage")),
    description: v.string(),
    quantity: v.number(),
    unitSen: v.number(),
    amountSen: v.number(),
  })),
  totalSen: v.number(),
  currency: v.string(),
  status: v.union(v.literal("draft"), v.literal("sent"),
                  v.literal("paid"), v.literal("void")),
  issuedAt: v.optional(v.number()),
  dueAt: v.optional(v.number()),
  paidAt: v.optional(v.number()),
  markedPaidByUserId: v.optional(v.string()),  // admin who clicked "mark paid"
  externalRef: v.optional(v.string()),         // bank transfer ref
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_retailer", ["retailerId"])
  .index("by_status", ["status"])
```

### E. Read path the gateway uses

```ts
// pure (lib/tiers.ts) — catalog ⊕ overrides ⊕ trial
export function resolveEntitlement(sub): TierLimits {
  const base = TIERS[sub.tier];
  return { ...base, ...stripUndefined(sub.overrides ?? {}) };
}

// convex/lib/billing.ts (or wabaProtection) — composed check
async function canSend(ctx, retailerId, category /* "utility" | "marketing" */) {
  const sub = await getSubscription(ctx, retailerId);
  const ent = resolveEntitlement(sub);
  const usage = await getCurrentUsage(ctx, retailerId, sub.currentPeriodStart);

  // 1. tier quota (this layer)
  if (category === "marketing" && usage.waMarketing >= ent.broadcastsPerMonth
      && ent.broadcastOverageSen == null) return { allowed: false, reason: "broadcast_quota" };
  // utility (status updates) is cheap → allow + meter; orders quota guards volume
  // 2. + opt-out, 3. + Meta quality status, 4. + global kill-switch  ← WABA Protection (S4)
  return { allowed: true, willIncurOverage: /* usage >= included */ };
}
```

`canSend` **composes** the tier-quota layer (this ticket) with opt-out + quality +
kill-switch (the S4 ticket) — all reading the same `subscriptions`/
`subscriptionUsage` rows.

---

## 8. Key decisions baked in

- **Money in minor units (sen), integers** — matches the order/price convention; no floats.
- **Catalog in code + per-retailer `overrides`** — no `plans` table for v1; founding-member deals are override fields.
- **Usage split out & per-period** — high-churn isolation + free overage history for invoicing.
- **Manual = Stripe-shaped** — `externalRef` + `markedPaidByUserId` capture the manual trail; when Stripe lands it writes the same fields, so nothing downstream changes.
- **Soft enforcement in v1** — store + meter + surface "X/100 orders used" on the dashboard; hard blocking waits for `canSend` in S4.

---

## 9. Follow-up wires to remember

- **`notifyStagesMax` should come from entitlement, not the flat `MAX_NOTIFY_STAGES = 5`**
  (in `convex/lib/orderStatus.ts`). `collectStageConfigErrors` is pure and takes no
  entitlement today → either pass the cap in as a param, or keep 5 as the floor and
  raise per tier later. Conscious step, not a surprise. See
  [`order-status-customization.md`](./order-status-customization.md) §Limits.
- **Trial tier** — decide which limits `trialing` grants (suggest Pro-equivalent for
  14 days), then a cron flips `trialing → expired` at `trialEndsAt` via the
  `by_periodEnd` index.
- **Re-tune all interim numbers** (overage rates, fair-use ceiling, notify cap) with
  real per-order message data in the WABA Protection ticket. Related memory:
  WhatsApp notify cost gating.
