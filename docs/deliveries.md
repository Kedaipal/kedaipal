# Deliveries — where delivery is checked (86eye9xd4, 6A)

Settings is where delivery is **configured**; `/app/deliveries` is where it is
**checked**, daily. It answers the three questions the settings page never
could: *what still has to go out, what's on the road, and what did delivery
cost me this month?* — plus the one that used to arrive as a failed booking:
*is there money in my courier wallet?*

## Where it lives

- **Sidebar:** right after **Orders** — it is the same orders, followed out
  the door. Not a settings tab (nothing here is configuration) and not a
  report under Insights (it is today's work).
- **Phone:** first row of the **More** panel (`MORE_ROUTES` includes it, so
  the More tab lights up on the page). The bottom bar's four tabs stay the
  daily loop.
- **Access:** the Orders area at read — `RouteAreaGuard` maps
  `/app/deliveries` → `orders`, and the server read requires the same.
- **Home:** a *Deliveries* card after the sales section, and the low-wallet
  banner near the top. Both read the page's own query, so Home and the page
  never disagree and the page opens from cache.

## What the page shows

It adapts to how the store ships, in urgency order:

| Section | Shown when | What's in it |
| --- | --- | --- |
| Low-wallet banner | the Lalamove wallet is under `LOW_WALLET_MINOR` (20.00) | the balance and where to top up |
| **To ship** | the store hands parcels to a courier (`shipsParcels`) | packed delivery orders with **no consignment number** and **nothing else carrying them** (no live or delivered booking), oldest first; **Print labels** opens the despatch queue; *Add number* opens the order |
| **Courier bookings** | the store books through Kedaipal (`booksCouriers`) | every Lalamove / Delyva booking, newest first, filterable All / Active / Completed / Failed; each row carries ONE action — *Track* (live link), *Photo* (proof), *Rebook* (a failure that still matters), else *View* |
| **In transit** | there are shipped parcels with a consignment number | courier + number + *Track* |
| Empty state | neither | how deliveries get here, linking to Fulfilment |

**A failed booking needs attention** only while it is the order's **newest**
booking **and** the order is still waiting (not shipped, delivered or
cancelled) — a rider that was rebooked, or an order that went out another
way, asks for nothing.

**This month** counts bookings that went out or are going (never failures),
in Malaysia/Singapore time. The read is bounded (`JOB_SCAN`); if it runs out
while still inside the month the glance reads `23+` — a floor, never
presented as the month.

**Status words** come from `src/lib/delivery-job-status.ts`, the one author
shared with the order page's rider card (a Delyva parcel speaks courier, a
collection trip *arrives* rather than *delivers*).

## Despatch labels moved here

The print queue (`PrintLabelsDialog` queue mode, see
[`despatch-labels.md`](./despatch-labels.md)) opens from **To ship** — the
queue it prints. Batch printing stays **Pro** (`orderInbox`, enforced by
`awb.generateAwbBatchPdf`): Starter sees the button disabled with the reason
and the Pro chip, and each order still prints its own label from its page.
The Orders inbox keeps its *Ready to ship* strip, now a
pointer with the same count that opens Deliveries; printing a ticked
**selection** stays in the inbox's bulk bar.

## The courier wallet

Lalamove reports the balance only on a `WALLET_BALANCE_CHANGED` webhook —
there is no endpoint to poll — and the event names no order, only the
sender's API key. Stored keys are encrypted at rest, so the key can't be
matched against them. Instead:

- `courierWallets` holds a **SHA-256 fingerprint of the plaintext key**,
  stamped in `retailers.updateSettings` (the only place the plaintext exists)
  via `syncLalamoveWallet`. A typed key re-stamps it and resets the balance
  (a different account); a cleared key removes the row.
- The route (`recordLalamoveWallet` in `convex/http.ts`) finds the wallet(s)
  by fingerprint and verifies the event with **that store's own secret**.
  Unattributable or forged events are acked and dropped — never a retry
  storm. An event older than the stored balance never overwrites it.
- Own table, not fields on `retailers`: the balance moves on every booking,
  and a retailer patch re-runs every open storefront tab.
- Settings → Integrations shows the balance **once**, beside the API key, as
  proof the key works.

**Operator step (once per deployment):** keys saved before the table existed
have no fingerprint, so their wallet events can't attribute until
`npx convex run courierWallets:backfillFingerprints` runs (idempotent,
self-continuing; it decrypts in an action).

## Credit gate

Every order the page touches passes `isOrderGated` (Credits T3.1): a gated
order keeps its **number and status** — the seller can see something is
waiting — and loses everything that leads back to the buyer: destination,
tracking links and proof photos. `deliveries` is in `READ_MODULES`
(`creditLockCoverage.test.ts`) and swept by `orderGate.test.ts`.

## Add a tip — a booking still finding a rider

A Lalamove booking nobody accepts **expires** (on the store this was built
against, 15 of 18 failed bookings had). Lalamove's priority fee —
`POST /v3/orders/{id}/priority-fee` — is the lever, so a booking still
`assigning` offers **Add tip** where it's seen: the order page's rider card and
its row here (with how long it has waited: "Finding rider · 12 min").

- **Fixed steps, a cap per booking** (`convex/lib/lalamoveTip.ts`, import-free
  so the dashboard reads the same numbers): MY RM 2 / 5 / 10 up to RM 20,
  SG S$1 / 2 / 5 up to S$10. Never a free amount field.
- **The dialog says the cost before the tap:** each step shows the trip's new
  total; it's charged to the seller's own Lalamove wallet; it can't be taken
  back; what's been added so far.
- **Server is the lock** (`lalamove.addPriorityFee`): orders WRITE, the order's
  own credit gate, only while `assigning`, only a listed step, never past the
  cap. **Reserve, then charge:** `reservePriorityFee` checks the cap and adds
  the step to `deliveryJobs.priorityFee` in one transaction BEFORE Lalamove is
  called, so two tabs tipping at once can't both pass it; a refused call
  `releasePriorityFee`s it back, a taken one `confirmPriorityFee`s it into
  `costActual` (so the month's spend and "Booking cost … (incl. RM 5 tip)"
  include it). A crash between reserve and confirm leaves the tip counted —
  it blocks a further tip, never allows an overspend. A refusal says why (a
  rider just took it, or the wallet is short).

## Not built (named follow-ups)

- Delivery spend in Insights, fed by the same ledger.
- Delyva wallet balance (Delyva has no balance webhook; would need polling).
