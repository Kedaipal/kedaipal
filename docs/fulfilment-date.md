# Fulfilment date at checkout ("bila nak?")

The buyer picks **one date** at checkout — *"When do you need this?"* — for both
delivery and self-collect orders. It removes the seller's #1 follow-up question
(*"bila nak?"*) for date-anchored F&B businesses: cake decorators (delivery on a
specific day), kuih batch pre-orders, frozen cook-and-collect cycles.

ClickUp: [`86expm524`](https://app.clickup.com/t/86expm524) — the **lean** Date
Picker (single native date input). The advanced version (per-product lead time,
blackout dates, time-of-day, cutoffs) is a deferred follow-up.

## Scope decision — both methods, not pickup-only

The date applies to **delivery and self-collect equally**. The headline ICP case
(cake decorators) is a *delivery* one — a cake delivered on the wrong day is as
useless as one collected late — so restricting to self-collect would miss the
biggest use case. Label adapts to the chosen method ("When do you need it
delivered?" / "When will you collect?").

## Storage & timezone

`orders.fulfilmentDate?: number` — the epoch-ms of the chosen calendar day's
**midnight in Malaysia time (UTC+8, no DST)**. All retailers are MY, so a fixed
+08:00 offset is drift-free without a tz database and round-trips cleanly with
the native `<input type="date">` "YYYY-MM-DD" value.

All date logic lives in one shared, Convex-free module imported by both backend
and frontend (like `paymentMethod.ts`): [`convex/lib/fulfilmentDate.ts`](../convex/lib/fulfilmentDate.ts).
Key exports: `mytMidnightFromYmd` / `ymdFromEpoch` (round-trip),
`todayMytMidnight`, `fulfilmentDateBounds`, `assertValidFulfilmentDate`,
`formatFulfilmentDate`, `relativeFulfilmentLabel`, `matchesFulfilmentWindow`.

## Validation

A submitted date must be a whole MYT day within
**`[today + minNotice, today + 30]`**:

- **Min** = `today + retailers.minFulfilmentNoticeDays` (the retailer setting,
  default **0 = same-day allowed**; a seller who needs lead time raises it).
- **Max** = today + 30 days (hardcoded for v1).
- **Counter Checkout bypasses the notice** — the seller is keying the order in
  person, so it always validates against a 0-day notice (today is always valid),
  regardless of the storefront setting.

The mutation arg `fulfilmentDate` is **optional at the protocol level** (so the
~90 existing `orders.create` test/call sites and the link-in-bio path don't all
need it, and a dateless order is valid) but **required in the storefront UI**.
The server re-validates the range whenever a value is present
(`orders.create`, `counterCheckout.createOrderFromSession`). Validation throws a
plain `Error` from the lib; the mutations wrap it in `ConvexError` (same pattern
as `assertValidAddress`).

## Where it surfaces (end-to-end)

| Surface | What shows |
| --- | --- |
| Storefront checkout (`checkout-sheet.tsx`) | Required native date picker below the address/pickup block, above the optional note. Bounds from the retailer's notice setting. |
| Counter Checkout (`app.checkout.tsx`) | "Collection date" input **defaulted to today** (the walk-in case); seller adjusts for pre-orders. The order is always created `confirmed`; when it was **paid in person**, the success screen offers an **optional "Mark as completed"** button (one tap → `delivered` via `orders.updateStatus`) so the seller can close out a hand-over sale without clicking through the status pipeline — a choice, not automatic (a paid deposit on an unready item stays confirmed). |
| Buyer's WhatsApp order message | `🗓️ Collect/Deliver on: Sat, 28 Jun 2026` line, so the seller sees it in-chat immediately. |
| New-order / order-confirmed email | "📅 Needed by: …" line (en + ms). |
| Order inbox (`searchOrders`) | **Default sort = fulfilment date ascending** (soonest first; dateless orders sink to the bottom, then newest-created). **Due: Today / Tomorrow / This week** chip filters. Per-card urgency badge. |
| Order detail | Fulfilment section shows "Collect/Deliver on" + urgency badge. |
| Buyer tracking page (`/track/<token>`) | "Collect/Delivery on …" reassurance line. |

The inbox chips and the per-order badge lead with **urgency** —
`relativeFulfilmentLabel` colours Overdue (red) / Today (orange) / Tomorrow
(amber); further-out dates show the plain date. The "Due" chips sit **inline
above** the advanced filter sheet, not buried inside it, because "what's due
today?" is a primary axis for an F&B seller, not a secondary filter.

## Retailer setting

`retailers.minFulfilmentNoticeDays?: number` — Settings → **Fulfilment** tab,
top card ("Order date notice"). A checkout-wide timing rule that governs both
delivery and pickup, so it lives above the per-method toggles, not in a separate
"Checkout" tab. Clamped to `[0, 30]`; `updateSettings` rejects out-of-range
values. Undefined reads as the default (**0**, same-day allowed).

## Deliberate non-goals (this PR)

- The templated WhatsApp **confirm reply** to the buyer does not echo the date —
  the buyer's own order message already carries it in the same chat thread, and
  threading it through the localized template var system is out of lean scope.
- No per-product lead time, blackout dates, time-of-day, or cutoffs — these are
  the deferred "Date Picker — Advanced" task, to be informed by real usage.

## Unblocks

The **Pickup Reminder** portion of Automated Reminders (Sprint 4) — a reminder
can't fire without a committed date.
