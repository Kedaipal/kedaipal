# Order Status Customization (Per-Retailer Stages)

**Status:** Phase 1 **shipped** (14 Jun 2026); Phase 2 **shipped** (14 Jun 2026).
**Date:** 13 Jun 2026 (Phase 1 + 2 shipped 14 Jun 2026)
**Related:** [`order-lifecycle.md`](./order-lifecycle.md) · [`proof-approval.md`](./proof-approval.md) · [`messaging-channels.md`](./messaging-channels.md)
**ClickUp:** Bearcamp onboarding [`86exxt0g4`](https://app.clickup.com/t/86exxt0g4) · Discussion [`86exxt46h`](https://app.clickup.com/t/86exxt46h)

## Problem

The fulfilment pipeline ships with hardwired stage labels — `pending → confirmed →
packed → shipped → delivered` — and buyer-facing copy built around physical
shipping ("packed and ready to ship", "on the way"). That reads correctly for a
frozen-food seller mailing a parcel. It reads **wrong** for a service business or a
self-collect order: "Order shipped" on a tent the customer drives in to collect is
confusing enough to generate the exact _"dah siap?"_ status-inquiry messages
Kedaipal exists to kill.

Two distinct needs fall out of this:

1. **Wording** — a seller wants the stages named to fit their business
   ("Ready for collection", not "Shipped"). _(Phase 1.)_
2. **Granularity** — a seller's real process has more buyer-meaningful steps than
   the five fixed stages. A tent wash is _received → cleaning → washing → drying →
   ready for collection → collected_. The **buyer** is the one who needs to see
   exactly which step their order is at — that visibility is what cuts down the
   "is it done yet?" messages. _(Phase 2.)_

## Core architecture: two layers

Separate what the **system** reasons about from what **humans** see. This is the
load-bearing decision and it makes both phases safe.

### Layer 1 — Canonical skeleton (fixed, never exposed raw)

The five-literal `status` union on `orders` / `orderEvents` stays **exactly as-is**:
`pending → confirmed → packed → shipped → delivered` (+ `cancelled`). This is what
the _code_ keys off, and keeping it fixed is what protects every downstream
invariant:

| Canonical anchor | What the system hangs on it                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pending`        | Created at checkout; never a manual target. System-managed.                                                                     |
| `confirmed`      | Payment auto-confirm target; dashboard "new" count; notification eligibility.                                                   |
| `packed`         | **Mockup gate boundary** (`confirmed→packed` blocked until approved/waived); "production started".                              |
| `shipped`        | Unlocks `carrierTrackingUrl`.                                                                                                   |
| `delivered`      | Terminal success.                                                                                                               |
| `cancelled`      | Terminal; triggers stock restoration + customer-aggregate decrement (first transition only). System action, not a seller stage. |

Indexes (`by_retailer_status`), payment/mockup gating, cancel logic, dashboard
counts, and `notifyStatusChange` eligibility all continue to read these literals.
**No migration of the canonical state, ever.**

### Layer 2 — Buyer-visible journey (seller-defined, ordered, custom)

The seller defines their own ordered stages — _Drop-off received · Inspecting ·
Cleaning · Washing · Drying · Ready for collection · Collected_ — and **each custom
stage is pinned to one canonical anchor**. Multiple custom stages may share an
anchor (cleaning + washing + drying all map to `packed`).

- The **buyer** (tracking page) and the **seller** (dashboard) both see the
  _granular_ stage.
- The **system** silently tracks the _anchor_ underneath for all gating.
- Advancing within an anchor (Cleaning→Washing, both `packed`) does not move the
  canonical status — but the buyer sees the update and an audit event is written.
- Advancing across an anchor (Inspecting `confirmed` → Cleaning `packed`) flips the
  canonical status, so the mockup gate / carrier-URL rules fire automatically.

Phase 1 is the **N = 5 special case** of Layer 2 (exactly one stage per anchor,
relabel only). Phase 2 generalizes to _N_ stages. Phase 1's `statusLabels` migrate
straight in as the labels of Phase 2's seed stages — **Phase 1 is a foundation, not
throwaway.**

---

## Phase 1 — Per-retailer status labels (relabel)

> **✅ Shipped 14 Jun 2026.** As-built notes + deviations from this spec are in
> [_Phase 1 — as shipped_](#phase-1--as-shipped) at the end of this section.

**Goal:** a retailer can rename the five visible pipeline stages (EN + MS) to fit
their business. Unset → today's defaults; zero behaviour change for existing
retailers. No new pipeline states, no migration.

### Schema (`convex/schema.ts`)

Add an optional `statusLabels` block on `retailers`, mirroring the existing
`messageTemplates` shape (lines ~29–52) so the two override blocks stay parallel:

```ts
statusLabels: v.optional(
  v.object({
    en: v.optional(v.object({
      pending: v.optional(v.string()),
      confirmed: v.optional(v.string()),
      packed: v.optional(v.string()),
      shipped: v.optional(v.string()),
      delivered: v.optional(v.string()),
      cancelled: v.optional(v.string()),
    })),
    ms: v.optional(v.object({ /* same six keys */ })),
  }),
),
```

No new tables, no index changes. The `status` unions on `orders` / `orderEvents`
are **untouched**.

### Resolver (single source of truth)

- `convex/lib/orderStatus.ts` _(new)_ — pure, no Convex imports:
  - `resolveStatusLabel(status, { labels, deliveryMethod, locale })` →
    retailer override → delivery-method default (the existing
    delivery/self_collect presets) → base default.
  - `resolveTransitionLabel(target, { labels, deliveryMethod, locale })` → button
    copy. **Buttons are imperative, labels are nouns** — render as
    `"Mark as {label}"` (or keep the existing system verbs for `confirmed` /
    `cancelled`), never a bare noun like "Washing" on a button.
- `src/lib/orderStatus.ts` _(new, mirror)_ — same logic for the client, following
  the `convex/lib/customer.ts` ↔ `src/lib/customer.ts` mirroring convention. Keep
  the two in lockstep with a shared test table.

### Touch points

| File                                 | Change                                                                                                                                                                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `convex/schema.ts`                   | Add `statusLabels` to `retailers`.                                                                                                                                                                                                            |
| `convex/retailers.ts`                | Validator + `sanitizeStatusLabels` (trim, empty→unset, **24-char cap** enforced at the mutation), accept in the settings mutation, surface in `getMyRetailer` **and** the public storefront/order reads the tracking page uses.               |
| `convex/lib/orderStatus.ts` _(new)_  | Resolver (above).                                                                                                                                                                                                                             |
| `src/lib/orderStatus.ts` _(new)_     | Mirror resolver.                                                                                                                                                                                                                              |
| `src/routes/app.orders.index.tsx`    | Tab labels (`STATUSES`, ~15) + `StatusBadge` text via resolver. Styles unchanged.                                                                                                                                                             |
| `src/routes/app.orders.$shortId.tsx` | Status display + transition buttons (`getTransitionLabels`, ~138) via `resolveTransitionLabel`.                                                                                                                                               |
| `src/routes/app.index.tsx`           | Dashboard hero count labels.                                                                                                                                                                                                                  |
| `src/routes/track.$token.tsx`      | Fold retailer override into `getStatusConfig` (~104) + `STATUS_ORDER` timeline (~144). Retailer label wins over the method preset. **Requires the public order query to return the retailer's `statusLabels` + `locale` + `deliveryMethod`.** |
| Settings UI                          | New "Status labels" section on the settings screen that already edits `messageTemplates`; two-column EN/MS, six rows, placeholder = current default.                                                                                          |

### Out of scope for Phase 1 (corrections to the original spec)

- **Email** — `convex/lib/emailCopy.ts` is _retailer-facing alerts_ (`newOrder`,
  `orderConfirmed`, `paymentClaimed`, `mockup*`). There is **no buyer status-change
  email**. `statusLabels` does not touch email.
- **WhatsApp status wording** — the seller already has a per-status _full-message_
  override via `messageTemplates` (applied in `convex/whatsapp.ts:411`). Phase 1
  keeps WA on that existing seam; `statusLabels` drives the **UI surfaces** only.
  See `DECISION 4`.

### Edge cases

- **Empty / whitespace = unset** → fall back. Don't let a seller blank a stage to "".
- **Self-collect + override** — retailer label wins; unset keys still resolve to the
  `self_collect` default, not the delivery one.
- **Locale missing** — if the seller filled only EN, an MS buyer sees MS _defaults_
  for unset keys (never EN labels shown to an MS buyer).
- **Over-long / emoji-stuffed** — enforce the char cap at the mutation, not just CSS.
- **In-flight orders** — labels resolve at render time from live config; relabelling
  is retroactive and instant. No backfill.
- **Mobile** — relabelled pills keep ≥44px tap target, single line at 360px.

### Effort / tier

**S–M, ~1.5–2.5 days.** Additive, no migration, no state-machine change.
**Tier: ship ungated for now** — available on all current tiers (Starter/Pro). Scale
is on hold until packaging is decided, so there are no tier checks in Phase 1;
tier-gating (if any) is a separate future ticket. The existing free `self_collect`
preset is unchanged.

### Phase 1 — as shipped

Built exactly to the spec above, with these decisions/deviations worth recording:

- **Resolver** (`convex/lib/orderStatus.ts` + `src/lib/orderStatus.ts`, mirrored,
  shared test table): `resolveStatusLabel` (noun) and `resolveTransitionLabel`
  (button). `STATUS_LABEL_MAX_LENGTH = 24`, enforced at the mutation.
- **Tier:** shipped **ungated** on all tiers, per the Effort/tier call above. No
  tier-gating infra exists yet, so there are no guards and no TODO scattered —
  gating (if ever) is the separate future ticket. _(This intentionally overrides
  the "Scale-gated" line in the original implementation brief — the design doc is
  the source of truth and it says ungated.)_
- **Default labels are buyer-facing, and the dashboard now shares them.** The
  canonical defaults are the existing tracking-page nouns (`Order Received`,
  `Confirmed`, `Packed`, `On the Way`/`Ready for Pickup`, `Delivered`/`Collected`,
  `Cancelled`) + their MS equivalents. The **buyer** experience is byte-identical
  when unset. The **dashboard** previously showed the raw lowercase status
  (`pending`, `shipped`, …) on tabs / badges / hero; it now shows these resolved
  labels so seller + buyer share one vocabulary. Intended unification, but it is a
  visible default-wording change on the dashboard for every retailer.
- **Locale split.** The buyer tracking page resolves in the **store locale**
  (`retailerLocale`, returned by `orders.get`). All **dashboard** surfaces resolve
  in **EN** — the app chrome is English-only by the i18n-scope decision, so a
  retailer's EN custom labels flow onto their dashboard while MS labels are used
  only for MS buyers. (A retailer's MS-only labels therefore don't appear on the
  English dashboard — acceptable given the dashboard is English regardless.)
- **Transition buttons are uniformly `Mark as {label}`** (keeping `Confirm Order` /
  `Cancel Order` system verbs). This changed two defaults: delivery shipped
  `Mark as Shipped` → `Mark as On the Way`; self-collect shipped `Ready for Pickup`
  → `Mark as Ready for Pickup`. Per the spec's "never a bare noun on a button" rule.
- **Public query.** `orders.get` (used by both the buyer track page and the seller
  order-detail page) now returns `{ ...order, statusLabels, retailerLocale }` —
  one extra `db.get(retailerId)` on that path. `deliveryMethod` was already on the
  order. Labels resolve live (retroactive; no per-order snapshot).
- **Settings UI.** Dedicated **"Order status"** settings tab (grouped with Pickup
  as the fulfilment cluster — these labels are about the order process, not
  messaging; it's also where Phase 2's custom stages will live). Intro banner +
  a two-column EN/MS form, six rows, 24-char `maxLength`, placeholders = the
  resolved default for the retailer's primary fulfilment mode
  (`offerSelfCollect ? self_collect : delivery`). The settings route's tab
  allowlist is now derived from the tab list (`SETTINGS_TAB_IDS`) so it can't
  drift. _(Originally drafted under the WhatsApp tab next to message-templates;
  moved out — status labels are fulfilment-flow config, unrelated to WhatsApp.)_
- **Out of scope held:** WhatsApp copy still uses `messageTemplates` (DECISION 4a);
  email untouched.

---

## Phase 2 — Anchored custom stages (buyer-visible granularity)

> **✅ Shipped 14 Jun 2026.** As-built notes + deviations are in
> [_Phase 2 — as shipped_](#phase-2--as-shipped) at the end of this section.

**Goal:** a seller defines an ordered list of buyer-visible stages, each pinned to a
canonical anchor, with optional per-stage descriptions. The buyer sees the granular
journey on the tracking page; the seller advances stage-by-stage on the dashboard.

### Schema sketch

Stages are a **bounded, ordered list owned by the retailer** (cap ~20). Each stage
carries a **stable generated `id`** so orders/events can reference it across edits.

```ts
// retailers.orderStages (optional; absent = synthesize the 5 default stages)
orderStages: v.optional(v.array(v.object({
  id: v.string(),                  // stable, generated once
  anchor: v.union(                 // which canonical state this stage counts as
    v.literal("confirmed"),
    v.literal("packed"),
    v.literal("shipped"),
    v.literal("delivered"),
  ),
  label: v.object({ en: v.string(), ms: v.string() }),
  description: v.optional(v.object({ en: v.string(), ms: v.string() })), // buyer-visible
  notify: v.boolean(),             // push a WhatsApp on entry? (see DECISION 2)
  sortOrder: v.number(),
}))),

// orders
currentStageId: v.optional(v.string()),   // seller's stage; canonical `status` stays the source of truth for gates
```

`orderEvents` gains an optional `stageId` **and a frozen `stageLabel` snapshot** (the
`pickupSnapshot` pattern) so history stays readable even if a stage is later renamed
or deleted.

### Rules that keep the canonical machine sound

- Stages span the `confirmed → delivered` band only. `pending` (auto, on create) and
  `cancelled` (terminal action from any non-terminal state) are **system-managed, not
  seller stages** (`DECISION 3`).
- Stage anchors must be **monotonically non-decreasing** by `sortOrder` — you can't
  place a `packed` stage before a `confirmed` stage. Validated at the mutation.
- Advancing to a stage **sets `currentStageId`**, derives the canonical `status` from
  `anchor`, writes an `orderEvents` row, and (if `stage.notify`) sends one WhatsApp.
- The **mockup gate** now fires on the _first_ transition into any `packed`-anchored
  stage. The carrier-URL rule keys off the first `shipped`-anchored stage. All
  existing gate code reads the anchor, unchanged in spirit.

### Buyer & seller surfaces

- **Tracking page** renders the seller's full ordered stage list as the timeline,
  highlighting `currentStageId`, with the current stage's `description` shown inline.
  The buyer self-serves here anytime — this is the always-on visibility surface, so
  **not every stage needs a push** (you confirmed this).
- **Dashboard** shows the next stage(s) as advance buttons (driven by `sortOrder`,
  not the hardcoded `NEXT_STATUS` map).
- **Duration** lives in the per-stage free-text `description` ("Drying — usually 1–2
  days depending on weather"). No structured ETA/countdown in v1 (accuracy trap).

### Migration (additive, safe)

- Retailers with no `orderStages` → resolver synthesizes the 5 default stages from
  Phase 1's `statusLabels` (so a Phase-1 relabel is exactly a 5-stage Phase-2 config).
- Existing orders with no `currentStageId` → derived from canonical `status` at read
  time. No backfill required.

### Effort

**M–L, ~5–8 days** (schema + stage CRUD + ordered settings editor + dynamic
dashboard transitions + dynamic tracking timeline + per-stage WA copy/notify +
anchor-mapped gates + migration + tests + docs). Tier: TBD (revisit when Scale
packaging is decided; ships ungated unless gating infra exists by then).

### Phase 2 — as shipped

Built on the real Phase-1 surface (resolver + `statusLabels`), with these
decisions/deviations recorded:

- **Schema.** `retailers.orderStages` (≤20), `orders.currentStageId`, and
  `orderEvents.stageId` + frozen `stageLabel`. Stage `label` is `{ en: required,
  ms?: optional }` and `description` is `{ en?, ms? }` (both optional) — slightly
  humaner than the doc's `{en,ms}` so a seller can fill one language; MS falls
  back to EN at render. Canonical `status` unions untouched.
- **Resolver (convex + src mirror, shared tests).** `resolveStages` /
  `synthesizeDefaultStages` (the un-configured retailer flows through the SAME
  path — defaults are 4 anchor stages built from `statusLabels`), `resolveCurrentStage`
  (derives from `status` when `currentStageId` is missing/stale — no backfill),
  `stageLabel`/`stageDescription`, `collectStageConfigErrors`/`assertValidOrderStages`
  (cap, monotonic anchors, band, label caps), `stageNotifyPlan`, and
  `resolveAnchorLabel` (dashboard buckets speak the seller's vocabulary).
- **Advance.** New `orders.advanceToStage({orderId, stageId})` derives the
  canonical status from `stage.anchor`. `updateStatus` is **kept** for cancel
  (stock-restore/aggregates) and as the canonical path. The **mockup gate is
  checked by anchor ordinal** (`>= packed`), which also closes the bypass where a
  config skips the packed anchor — config can't ship a made-to-order item without
  mockup resolution. Carrier URL still only on a shipped-anchored entry.
- **Notify model (the one fork the spec didn't fully pin).** `stage.notify` is the
  single source of truth, routed by the pure `stageNotifyPlan`:
  anchor-**crossing** → `notifyStatusChange` (reuses the rich Phase-1 status copy
  **and `messageTemplates` overrides** — zero regression); **within** an anchor →
  the new generic `notifyStageEntry` (`renderStageUpdate`); `confirmed` → nothing
  (the confirm/payment flow owns buyer comms then, as today).
- **Anchor crossings speak the seller's stage vocabulary (2026-07-03, `86ey570am`).**
  The original crossing path sent only the generic canonical copy ("packed and
  ready for pickup") even when the seller renamed the stage ("Ready for
  Collection") and wrote a buyer-visible description — so WhatsApp contradicted
  the tracking timeline. `notifyStatusChange` now renders the entered stage's
  **label + description** via `renderStageUpdate` (keeping the carrier link on
  shipped crossings) whenever the retailer has configured `orderStages`.
  Precedence: authored `messageTemplates` override → custom stage copy → default
  catalog. Sellers on default (synthesized) stages and `cancelled` keep the rich
  canonical copy — zero regression. Stage resolution prefers the order's
  `currentStageId`, falling back to the first stage on the anchor for plain
  `updateStatus` transitions.
- **Migration: none.** Intentionally read-time + additive — synthesis covers
  retailers without `orderStages`, derivation covers orders without
  `currentStageId`, and every new field is optional. A no-op migration would be
  dead scaffolding, so none was written. _(Deviation from the brief's "use the
  migrations component".)_
- **Settings UI.** The dedicated stage editor (Order status tab) **replaces** the
  Phase-1 `StatusLabelsForm` — stages are the general model, so renaming a stage
  subsumes relabeling. Add/remove, EN+MS label, optional EN+MS buyer note, anchor
  dropdown ("counts as → Accepted / In production / Ready / Done", DECISION 1),
  per-stage notify toggle (new intermediate stages default **off**, DECISION 2),
  inline validation, and a "Reset to defaults". **Reorder via the shared
  `SortableList` (@dnd-kit), not up/down arrows** — the project's recorded
  drag-to-sort standard overrides the brief's "up/down" note.
- **Dashboard.** Order detail advances via the seller's stage list (next stage +
  Cancel), not the hardcoded `NEXT_STATUS`. Orders-list filter tabs + hero stay
  canonical-status **buckets** but label via `resolveAnchorLabel`; per-row badges
  + the detail badge show the order's **current stage** label.
- **Tracking page.** Timeline renders the full ordered stage list (pending node +
  stages), highlights the current stage, shows its description inline, and splices
  the mockup node at the production boundary (first packed-or-later stage).
- **Limits (refines DECISION 3 + 5).** ≤20 stages total. **Boundary milestones are
  singular: exactly one "Accepted" (confirmed) and one "Done" (delivered)** — the
  multi-stage granularity lives in the middle (In production / Ready) band. This
  keeps "accepted"/"done" as natural single moments and avoids a multi-Done
  dashboard-advance edge + a dead notify toggle on extra Accepted stages.
  **At most 5 stages may notify on WhatsApp** (confirmed never sends, so it's not
  counted) — an **interim cost guard**, to be re-tuned alongside the WABA
  rate-limit / per-tier messaging-cost work (so a Scale-vs-Starter seller can't
  blow the shared WABA budget by ticking notify on every stage). All three are
  enforced in `collectStageConfigErrors` (inline in the editor) + the mutation.
- **Tier:** ungated (consistent with Phase 1).

---

## Open decisions (for Zaki's sign-off)

> Each is a recommendation, not a baked-in choice. Confirm or override before code.

- **DECISION 1 — Anchor-picker UX (Phase 2).** When a seller adds a stage, how do
  they set its anchor? **Recommend:** a friendly dropdown — _"counts as → Accepted /
  In production / Ready / Done"_ — pre-filled sensibly by the default template, so
  most sellers never touch it. (Alt: infer from position — rejected, too magic.)
- **DECISION 2 — Default for per-stage `notify` (Phase 2).** **Recommend:** default
  **off** for newly-added intermediate stages, **on** for the anchor-crossing
  milestones (confirmed/ready/done). Keeps WhatsApp cost + buyer annoyance down;
  buyer still sees everything on the tracking page.
- **DECISION 3 — Cancel/pending stay system-managed.** **Recommend:** yes — sellers
  customize the `confirmed → delivered` band only. `pending` and `cancelled` are not
  editable stages. Keeps the terminal/cancel logic untouchable by config.
- **DECISION 4 — Phase 1 WhatsApp wording.** **Decided: option (a)** — `statusLabels`
  drive UI only; WA keeps the existing `messageTemplates` full-message override.
  Bearcamp is self-collect (existing WA copy already says "ready for pickup"/
  "collected"), so there's no gap on day one, and Phase 2's per-stage copy subsumes
  this.
- **DECISION 5 — Stage cap (Phase 2).** **Decided + extended:** 20 stages / retailer,
  **plus** exactly one Accepted (confirmed) and one Done (delivered) stage, **plus**
  ≤5 notify-enabled stages (interim WhatsApp cost guard — confirmed excluded; revisit
  with the WABA rate-limit / per-tier cost work). See _Phase 2 — as shipped → Limits_.
