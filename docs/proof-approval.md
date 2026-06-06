# Proof / Mockup Approval — Feature Spec

Design spec + implementation reference for a **made-to-order proof approval**
workflow: the seller sends the buyer a mockup before producing the final item,
and production is **gated** on the buyer's approval.

**Status: implemented** on `zaki/<proof-approval branch>` — schema, the
`confirmed→packed` gate, the mockup state machine + mutations, dashboard +
tracking UI, and notifications (WhatsApp mockup-image-to-buyer + seller email on
approve/changes). Tests green. **Deferred:** proactive reminder *nudges* (the v1
waiver is purely time-based — see the note below); per-round mockup images.

> **Naming (build decision, 2026-06-04):** code identifiers use **`mockup`**, not
> `proof`, because the codebase already uses "proof" throughout for the buyer's
> **payment** screenshot (`paymentProofStorageId`, `getPaymentProofUrl`,
> `generateOrderProofUploadUrl`, the `proofUpload` rate-limit key). So: `mockupStatus`,
> `mockupImageStorageId`, `mockupChangeNote`, `submitMockup`, `approveMockup`,
> `requestMockupChanges`, `waiveMockup`, `generateMockupUploadUrl`. Read "proof"
> below as "mockup" in code.
>
> **v1 scope:** the waiver unlock is **time-based only** (the Reminders Cron in §8
> is Sprint 4, not built yet) — `waiveMockup` is guarded by elapsed time since the
> mockup was submitted; proactive buyer/seller nudges are an additive follow-up.

## 1. Why this feature

Made-to-order sellers must get a **proof approved before producing the final
product** — otherwise they produce the wrong thing and eat the rework/material
cost. Confirmed pain from a printing-service seller: buyer pays → seller is
*supposed* to send a mockup before printing → but at high order volume he
**forgets**, prints the final product, and only then realises the mockup step was
skipped.

This is a **recognisable pattern, not a one-off**: printing, custom cakes
(persona #1 — pairs with the deferred "message on cake" personalisation),
engraving, custom apparel all need the same proof loop. Solving it well opens the
**custom / made-to-order segment**, not just one seller.

**Fit with existing infrastructure** — this is mostly *wiring*, not new systems:
- Order pipeline + the "payment is a separate dimension" precedent ([`payment-handshake.md`](./payment-handshake.md)).
- WhatsApp **image send** (already used for the payment QR — see [`order-lifecycle.md`](./order-lifecycle.md)).
- **Customer tracking page** with buyer-facing actions (already has "I've paid").
- **`orderEvents`** audit log.
- **Automated Reminders Cron** (Sprint 4 roadmap) for nudges + the deadlock escape.

## 2. Goal

A seller flags a product as needing a proof. Any order containing such a product
is **hard-gated**: it cannot move into production until the seller sends a mockup
and the **buyer approves it** on the tracking page. The buyer can request changes
(looping the seller), and a deadlock (unresponsive buyer) is escapable by the
seller through a deliberate, audited waiver after reminders + a grace window.

## 3. User stories

- As a retailer, I mark a product "needs proof approval" so its orders can't be produced before the buyer signs off.
- As a retailer, I see at a glance which paid orders are **waiting on a mockup from me**.
- As a retailer, I upload + send a mockup to the buyer in one step (it goes out over WhatsApp).
- As a buyer, I review the mockup on the order page and **Approve** or **Request changes** with a note.
- As a retailer, I'm notified the moment the buyer approves (or asks for changes) so I can act.
- As a retailer, when a buyer goes silent, I can still proceed — but only deliberately, after they've been reminded.

## 4. The proof state machine (independent dimension)

Proof is a **third independent track** alongside fulfilment `status` and
`paymentStatus` — consistent with the data model's "payment is a separate
dimension from fulfilment" principle. It **gates one transition** rather than
adding a stage to the linear pipeline.

```
fulfilment:  pending → confirmed → packed → shipped → delivered
payment:     unpaid → claimed → received                  (independent)
proof:       (none) → pending → submitted → approved       (independent, NEW)
                                     ↘ changes_requested ↗  (loops back to seller)
```

| `proofStatus` | Meaning | Set by |
|---|---|---|
| *(undefined)* | Order has no proof-required item — no gate. | default |
| `pending` | Order needs a mockup; seller hasn't sent one yet. | order create (gated order) |
| `submitted` | Seller sent the mockup; awaiting the buyer. | seller `submitProof` |
| `changes_requested` | Buyer asked for changes (see `proofChangeNote`); back to seller. | buyer `requestProofChanges` |
| `approved` | Buyer approved; production gate open. | buyer `approveProof` |

**The hard gate:** for a gated order, the fulfilment transition **`confirmed → packed`** (= "start/finish producing") is **blocked** unless
`proofStatus === "approved"` **OR** the order has been waived (`proofWaivedAt` set, §8). Later stages (`shipped`/`delivered`) are transitively gated since they can't skip `packed`.

## 5. Acceptance criteria

- Each **variant** has a `requiresProof` toggle (default off), set per-row in the variant-grid editor (alongside price/stock). Reads fall back to the deprecated product-level flag when a variant's own is unset. Independent of other settings. This lets a single listing pair ready-made fixed sizes (no proof) with a made-to-order "Custom" variant (proof required) — the art-on-print case.
- **Whole-order gating:** an order containing **≥1** `requiresProof` **variant** is gated. Mixed orders (some custom, some ready-made) gate the **entire** order. Orders with no such variant are never gated (`proofStatus`/`mockupStatus` stays undefined).
- A gated order starts at `proofStatus: "pending"` on creation and is **badged "Mockup needed"** in the dashboard.
- The seller can upload an image mockup and send it; doing so sets `submitted`, stores the image, and **sends the mockup over WhatsApp** to the buyer with a tracking-page link.
- The **tracking page** shows the current mockup and, while `submitted`, two buyer actions: **Approve** and **Request changes** (with a free-text note, capped length).
- **Approve** → `approved`, stamps `proofApprovedAt`, writes an `orderEvents` row, notifies the seller (email; WhatsApp optional).
- **Request changes** → `changes_requested`, stores `proofChangeNote`, writes an event, notifies the seller. Seller re-uploads → back to `submitted` (loop; each round is an event).
- Attempting `→ packed` on a gated order that is not `approved`/waived **throws** with a clear message ("Awaiting mockup approval").
- **Deadlock escape (§8):** after the buyer has been reminded and a grace window elapses, the seller may **waive** approval — an explicit, audited action that opens the gate.
- Every proof transition appends an `orderEvents` row (`mockup_submitted`, `changes_requested`, `mockup_approved`, `proof_waived`) for a full history.
- Mobile-first: mockup upload + buyer approve/request flows usable on a phone; ≥44px tap targets.

## 6. Schema changes (`convex/schema.ts`)

**`productVariants`** — add:
- `requiresProof: v.optional(v.boolean())` — the **per-variant** toggle. (`products.requiresProof` remains as a deprecated read-fallback for legacy variants.)

**`orders`** — add the independent proof dimension (code uses `mockup*`, not `proof*`):
- `mockupStatus: v.optional(v.union(v.literal("pending"), v.literal("submitted"), v.literal("changes_requested"), v.literal("approved")))`
- `mockupImageStorageId: v.optional(v.string())` — current mockup.
- `mockupChangeNote: v.optional(v.string())` — buyer's requested changes.
- `mockupSubmittedAt`, `mockupApprovedAt`, `mockupWaivedAt`: `v.optional(v.number())`.
- `mockupQuotedAmount: v.optional(v.number())` — **the seller's price for the custom work** (minor units), set on the mockup submission and folded into `total` via `computeOrderTotals`. See §11.

Multiple mockup rounds are captured by `orderEvents` (history), not a child table —
keeps v1 simple. (If per-round images become a requirement later, promote to a
`proofRounds` child table.)

## 11. Custom-work pricing (quote-on-mockup) + decline

Made-to-order "Custom" variants sell at **RM0** on the storefront ("Price on
quote") because the real price isn't known until the mockup is designed. The
quote rides on the mockup approval — they're one decision for the buyer.

**Flow (pay-once-after-quote):**
1. Buyer orders the custom variant (snapshot price 0). In-stock lines are reserved as usual; nothing is paid yet.
2. Seller **submits the mockup with a price** (`submitMockup({ storageId, quotedAmount })`). The quote is re-enterable each round — the latest wins. It folds into `total` immediately as a *proposed* total, and the customer's denormalized `totalSpent` is kept in step via `adjustAggregatesForTotalChange`.
3. Buyer **approves** (design + price → gate opens, total locks), **requests changes** (loop), or **declines the item**.
4. Buyer pays the finalized `total` through the existing payment flow — unchanged.

**Decline (`declineMockupItem`, capability = `shortId`):** drops every
`requiresProof` line, recomputes `total` (quote cleared), and **re-evaluates the
gate** — with no proof-required line left, `mockupStatus` clears and the
ready-made remainder proceeds. A custom-only order that's declined is
**cancelled** (stock restored, aggregates reversed). The seller is emailed
(`notifyMockupDeclined`).

**Why order-level, not per-line:** one mockup ⇒ one quote per order. Pricing the
custom work at the order level (a single `mockupQuotedAmount` folded into the
total) is unambiguous for any number of custom lines and reads cleanly on the
receipt (*Items · Custom work · Total*). `subtotal` stays line-derived.

**Split fulfilment is deliberately out of scope** — fulfilment stays
whole-order. Because payment follows the quote, there are no already-paid items
held behind an un-approved custom item, so the motivation for partial pickup is
absent. Revisit as its own feature if real demand appears.

## 7. Code touch points

- **`convex/schema.ts`** — `productVariants.requiresProof` (per-variant), the `orders` mockup fields. `products.requiresProof` kept as deprecated fallback.
- **`convex/products.ts`** — accept `requiresProof` per variant in create/`saveVariantGrid`; resolve `variant.requiresProof ?? product.requiresProof` on reads.
- **`convex/orders.ts`**
  - `create`: if any line's variant resolves `requiresProof` (override ?? product), set `mockupStatus: "pending"`.
  - `updateStatus`: **gate** `→ packed` on `proofStatus === "approved" || proofWaivedAt`.
  - `submitProof(orderId, storageId)` (owner): set `submitted`, store image, event, schedule WhatsApp send.
  - `approveProof(shortId)` / `requestProofChanges(shortId, note)` (public, capability = `shortId`, rate-limited like `claimPayment`): transition + event + notify seller.
  - `waiveProof(orderId)` (owner): set `proofWaivedAt`, event; server-guards the grace window (§8).
  - `generateProofUploadUrl(orderId)` (owner) — mockup upload URL.
- **Channel adapter (`convex/lib/channels/`)** — outbound: send the mockup **image** + a "review your mockup" message with the tracking link; seller notifications on approve/changes. Render-only; no order-flow change.
- **`convex/email.ts` / `emailCopy.ts`** — seller alerts: "mockup approved", "changes requested".
- **`convex/crons.ts`** — reminder sweeps (§8): nudge the buyer while `submitted`, nudge the seller while `pending`/`changes_requested`, and unlock the waiver after the grace window.
- **Dashboard order detail (`src/routes/app.orders.$shortId.tsx`)** — "Mockup needed" badge, upload+send control, current proof state, the post-grace **"Proceed without approval"** waiver (with warning), and the `→ packed` button disabled with reason while gated.
- **Dashboard orders list / index** — a "Mockup pending" filter/badge so a high-volume seller sees them at a glance (the core anti-forgetting surface).
- **Tracking page (`src/routes/track.$shortId.tsx`)** — render the mockup + **Approve / Request changes** (note box) while `submitted`; show approved/awaiting states otherwise.

## 8. Deadlock escape — reminders, then a deliberate waiver

A hard gate + buyer approval can **stall forever** if the buyer ghosts (paid order,
mockup sent, no response) — a worse failure than the original forgetting problem.
The escape must keep a human in the loop and **never silently auto-produce**:

1. **Reminders (Cron):** while `submitted`, nudge the **buyer** (WhatsApp) to review
   — e.g. at +24h, +48h. While `pending`/`changes_requested`, nudge the **seller**.
2. **Waiver unlock:** once the buyer has been reminded **and** a grace window has
   elapsed since the mockup was submitted (default **48h**, configurable), the
   dashboard surfaces **"Proceed without approval"** for that order.
3. **Deliberate, audited override:** the seller clicks it → `proofWaivedAt` is set,
   an `orderEvents` `proof_waived` row is written, and the `→ packed` gate opens.
   It is **opt-in per order**, never automatic.

> **Why not auto-proceed after X hours?** Auto-producing an unapproved item is
> exactly the failure this feature prevents. The grace window gates *when the
> manual escape becomes available*, not an automatic action. Server-side guard:
> `waiveProof` rejects unless `now - proofSubmittedAt ≥ GRACE_MS`. (Open question:
> strict server window vs. always-available-but-logged — recommend the guarded
> window for v1; revisit if sellers report legit early-waive cases, e.g. verbal
> approval over a call.)

## 9. Edge cases

- **Mixed orders** — any proof-required **variant** gates the **whole** order (decided). Simpler than per-line gating. Gating is decided per-variant (`requiresProof` resolves override ?? product), so one listing can mix gated and ungated variants while the order-level gate stays all-or-nothing.
- **Re-submission loop** — `changes_requested → submitted → …` any number of rounds; each is an `orderEvents` entry. Latest `proofImageStorageId` wins.
- **Cancellation** — a gated order can still be cancelled at any time (proof gate only blocks *forward* production, not cancel).
- **Toggle changed after order exists** — `mockupStatus` is stamped at order-create time from the then-current per-variant `requiresProof`; flipping a variant's toggle later doesn't retro-gate existing orders (frozen-intent, like other snapshots).
- **No tracking phone / link-in-bio** — the buyer still reviews via the tracking page (capability = `shortId`); WhatsApp delivery of the mockup is best-effort, same as other notifications.
- **Proof timing** — this seller's flow is **pay → mockup → produce**, so the gate sits post-confirm. (Some businesses approve *before* payment; configurable timing is a possible later extension, out of scope.)

## 10. Dependencies / relationships

- **Reminders Cron** (Sprint 4) — the buyer/seller nudges + waiver unlock ride it. Can ship a manual-only v1 first, add reminders when the cron lands.
- **Personalisation fields** (deferred "message on cake") — complementary: a personalised line item is exactly what you'd want a proof approved for. Same custom-order cohort.
- **Channel adapter** — reuses outbound image send; no inbound changes.
- Independent of Product Variants, but both serve the made-to-order vertical.

## 11. Effort estimate

**M–L (~3–5 days).** Schema + the proof mutations + the `updateStatus` gate are
straightforward (~40%). The dashboard surfaces (badge/filter, upload+send, waiver)
and the tracking-page approve/request-changes loop are the bulk. Reminders are a
small add once the cron exists. Tests: state-machine transitions, the hard gate,
the waiver guard, whole-order gating with mixed items.

## 12. Tier impact

**Pro / Scale** — a custom-workflow differentiator for the made-to-order segment
(printing, cake, engraving). Starter omits it. Final tier placement is a pricing
call.
