# Claim links — seller keys the order, buyer completes it (86eyq0epn)

**Status: built (dev).** The TikTok Live funnel: a seller collecting "mine"
claims in live chat keys each claim in Counter Checkout (items, qty, the price
they called out — including per-line overrides, 86eyphh8r), attaches the
buyer's phone, and **sends the rest of checkout to the buyer** as a WhatsApp
link. The buyer opens `/claim/<token>` — a pre-filled, **price-locked**
checkout — adds address and fulfilment date/time, confirms, then pays on the
order page. The order commits, and stock decrements, **only at buyer
completion**, and the same deadline keeps running on the order page **until
real money** — an unpaid order auto-cancels and the stock comes back. Also
covers general order-on-behalf: phone orders, DM quotes, repeat customers.

## The model

- **A claim is an OFFER, not an order.** `orderClaims` (schema) freezes the
  seller-keyed lines at send — the counter session draft is explicitly a
  non-authoritative scratchpad whose prices re-resolve at create, so "price
  locked" needs its own snapshot. Commit copies the frozen lines verbatim and
  re-reads variant rows **only** for live stock and parcel weight, never for
  price (pinned by test: a catalog re-price between send and open changes
  nothing).
- **No reservation in v1** (the stock ledger, 86eybbxhf, upgrades this
  later): stock is pre-checked at send so the seller can't dispatch a
  dead-on-arrival link, but only decremented at commit. Sold-out-at-commit
  names the line and points the buyer at the store — never a silent drop.
- **One live claim per session.** Sending again supersedes (cancels) the
  previous open claim — the old link must die when the cart or a price
  changed. Completing the sale at the counter, or dismissing the session,
  also cancels any open claim (`cancelOpenClaimsForSession`), so one cart is
  never sellable through two doors.

## The timer (Zaki's checkout window — locked 26 Aug, revised 27 Aug 2026)

- The window is **vendor-set per send**, not fixed: the send dialog offers
  **10 min / 15 min / 1 hour / 24 hours** chips
  (`CLAIM_WINDOW_CHOICES_MINUTES`), and
  the choice is remembered as the store's default
  (`retailers.claimLinkWindowMinutes`, updated at send — the dialog says so;
  deliberately no separate Settings card, and deliberately three chips rather
  than six: a long chip row is a decision tax on someone mid-livestream).
- **A short window compresses COMPLETION, not the whole hold.** Payment always
  gets `CLAIM_PAYMENT_RUNWAY_MS` from commit, so a buyer who confirms at 9:30
  of a 10-minute window still holds stock until ~24:30. That is why **5 minutes
  is a bound and not a chip**: at 5 the runway dominates entirely, so the chip
  would promise urgency the system doesn't deliver. The dialog says this in the
  seller's words ("how long they have to *complete* the order — then at least
  15 minutes to pay").
- **Bounds** (`sanitizeClaimWindowMinutes`, server-enforced under the chips):
  **5 minutes minimum** — below that a link can be dead before WhatsApp
  delivers it — and **7 days maximum**, because "price locked" has to stay
  honest (a week-old locked price is a stale quote), an open claim holds buyer
  PII until it dies, and a longer window would mean month-long inventory holds
  now that the deadline runs until payment.
- **The deadline runs until MONEY, not until commit** (revised 27 Aug — the
  Agoda model; supersedes the first cut's option (a)). Before commit it gates
  completion (expired ⇒ dead link + released price). At commit it **carries
  onto the order as `orders.paymentDueAt`** — floored to
  `CLAIM_PAYMENT_RUNWAY_MS` (15 min) so a buyer who spent the window on the
  form still has a real chance to pay — because stock decrements at commit
  and an unpaid order would otherwise hold inventory forever. The buyer's
  order page shows the continuing countdown (`PaymentDueCountdown`); a
  1-minute sweep (`cancelUnpaidDueOrders`, `by_payment_due` index)
  **auto-cancels a due order** through `applyStatusTransition` (stock back,
  aggregates reversed, usage un-metered), stamping
  `cancelledReason: "payment_window_expired"` so the buyer's cancelled page
  explains itself.
- **The clock only runs while the buyer can actually pay** — every guard is
  in ONE predicate, `isAutoCancelDue`:
  - `claimed` ("I've paid") **pauses** it: a human verifies the transfer, and
    cancelling a true claim would burn a paid buyer. A false claim escalates
    to the seller, whose rejection re-exposes the past-due order to the next
    sweep. The countdown never races the handshake — the UI shows the
    "being confirmed" card instead of a clock.
  - `received` retires it (cleared in `applyPaymentReceived`, the one core
    every receive path runs through). Any cancellation clears it too — the
    index only ever holds live clocks.
  - **Starting a payment extends it, never freezes it**: a HitPay mint
    (`recordCheckoutRequest`) bumps the deadline to ≥ now + runway (the buyer
    sees the clock jump), and the sweep additionally leaves any order alone
    while the checkout session is live (`GATEWAY_SESSION_GRACE_MS`, ~1 h) —
    so nobody is cancelled mid-payment. A freeze was rejected as exploitable
    (tap Pay, close the tab, hold the stock forever).
  - `deliveryFeePending` **suspends** it (the buyer *can't* pay); the fee
    landing (`setDeliveryFee`) re-arms it with the same runway floor.
  - A seller who advanced an unpaid order past `confirmed` made a deliberate
    call — the robot keeps out.
  - Hard pay-within-window with no pauses at all would cancel paid manual-
    transfer buyers (a claim is verified hours later) — permanently rejected.
- **Resend never resets the clock** — same token, same deadline. Resend is
  guarded per claim: **5-minute cooldown, max 3 sends**
  (`claimResendState`), enforced server-side and mirrored as the
  disabled-with-reason Resend button (which counts down to the next slot).
- Expiry is judged **live** on every read (`effectiveClaimStatus` — the
  counter-session pattern), the buyer page flips to the expired state the
  second its own countdown hits zero, and a 5-min cron
  (`expireStaleClaims`) keeps the status buckets true. Dead claims
  (expired/cancelled) hold buyer PII and are purged after ~30 days
  (`purgeStaleClaims`); completed claims are kept (they link to an order).

## How the timer works, mechanically (dev)

One field, one brain, one sweep — the whole design in four parts.

### 1. The field

`orders.paymentDueAt` (epoch-ms) with the contract **"present = the clock is
live."** It is CLEARED on payment received (`applyPaymentReceived`) and on
EVERY cancellation (`applyStatusTransition`), which is what keeps the
`by_payment_due` index near-empty — the sweep's range read only ever sees live
clocks. `orders.cancelledReason: "payment_window_expired"` rides alongside so
the buyer's cancelled page can explain itself (absent = a human cancelled).

### 2. The brain — pure functions, no Convex imports

All in `convex/lib/orderClaims.ts`, matrix-tested in isolation:

| Function | Answers |
|---|---|
| `paymentDueAtCommit(claimExpiresAt, now)` | what deadline the order inherits |
| `extendedPaymentDue(currentDue, now)` | the bounded extension when payment starts |
| `isAutoCancelDue(order, now)` | may the sweep cancel this, right now |

### 3. The writers — five one-liners at existing chokepoints

| Site | Does |
|---|---|
| `orderClaims.commit` | stamps the inherited deadline |
| `hitpay.recordCheckoutRequest` (Pay-now mint) | extends it |
| `orders.setDeliveryFee` | re-arms it when a fee-pending order becomes payable |
| `applyPaymentReceived` | clears it (the ONE core every receive path runs through) |
| `applyStatusTransition` | clears it on any cancel |

### 4. The sweep — a Convex cron

`internal.orderClaims.cancelUnpaidDueOrders`, registered in `crons.ts` via
`crons.interval({ minutes: 1 })`. Indexed range read (`paymentDueAt < now`),
pages of 50 with a self-scheduling continuation, re-judges every row with
`isAutoCancelDue`, and cancels through `applyStatusTransition` — so stock
restore, customer-aggregate reversal and usage un-metering are the *same code*
the seller's own Cancel button runs. Each page is one OCC transaction: a
payment landing mid-sweep just retries the mutation and the predicate
re-judges. No WhatsApp (one-message-per-order policy — the tracking page
carries the state).

**The cron is unconditional.** Convex crons are wall-clock scheduled, not
event-driven: it fires every minute whether or not any order has a live clock.
With no due rows it is one indexed range read returning zero documents and
exits — the cheapest thing this codebase does on a schedule, and far below the
existing daily purges in work done. There is deliberately no "arm/disarm the
cron" mechanism: that would be mutable global state to keep in sync with row
state, and getting it wrong means deadlines that never fire.

### Carry-on, not reset, not stacked

The stamp is `max(claim deadline, commit + CLAIM_PAYMENT_RUNWAY_MS)`:

- **1-hour window, committed at minute 11** → carries on with 49 min. The
  buyer's remaining time is theirs.
- **15-min window, committed at minute 11** → strict carry-on leaves 4 minutes
  to open a bank app and land money. That is not a payment window, it is a
  trap — the floor lifts it to 15 min from commit.

The window's JOB changes at commit: before it, it creates claim urgency
("decide"); after it, it is a payment window and must be physically
completable. Straight `+window` stacking was rejected (rewards dawdling on
long windows) and so was resetting (a 24-h window snapping to 15 min at commit
is a rug-pull). The floor only ever engages when under 15 min remain.

### Refresh and tab-close are safe by construction

Both countdowns derive from an **absolute server timestamp**
(`claim.expiresAt`, `order.paymentDueAt`) minus `Date.now()` — never an
elapsed counter held in component state. A refresh re-reads the deadline from
the reactive Convex subscription and resumes exactly where it was; closing the
tab changes nothing at all, because the sweep is server-side. Neither page can
be "killed" by a reload.

### What the buyer sees as the clock runs out

Leaving the order page open through expiry gives three beats, no dead air:

1. **Ticking** — amber card: "Complete payment within 4:12 — after that this
   order is cancelled and the items are released."
2. **At zero** (instant, local) — the card switches to red honesty: "The
   payment window has ended. This order will be cancelled and the items
   released — unless your payment already went through, in which case it
   applies as normal." The hedge is deliberate: at that moment the page cannot
   know whether a webhook is in flight.
3. **Within ~1 min** (the sweep lands) — the page is a live Convex
   subscription, so it repaints itself with no refresh: status flips to
   Cancelled, the payment card disappears, and the cancelled banner explains
   *"the payment window for this order ran out, so it was cancelled and the
   items were released. Still want it? Message the store."*

If a payment landed in that window the sweep's predicate refuses to cancel,
and the buyer's page flips to Paid instead — the same subscription, the other
outcome.

## Seller side (Counter Checkout)

- **Build screen — the panel asks ONE question first** (redesigned 27 Aug):
  *"How is this order paid?"* is a segmented control above the blocks it
  governs, because the answer decides what every block below it means.
  - **Counter sale** — collection + payment, as before.
  - **Send to buyer** — collection and payment are **hidden**, and the absence
    is *stated*: "…fills in the rest — delivery or pickup, date & time, and
    payment. Nothing you key here would reach them." An unexplained absence
    reads as a bug; this was the original confusion (a seller keyed collection
    and payment, tapped Send, and none of it reached the buyer). In their
    place: the window chips and origin chips, **inline**.
  - **The modal is gone.** `SendClaimDialog` was retired — the two controls it
    held belong beside the cart they describe, not behind a dialog a seller has
    to open to discover them.
  - **Exactly one primary action**, labelled for its mode — `Review order · RM
    20.00` vs `Send link · RM 20.00`. Two competing full-width buttons in one
    slot was the other half of the confusion. The money is on both: it is what
    a send commits, and it is the figure directly above the button (labelled
    **"Locked total"** in send mode, since the buyer's delivery is added on
    their own page).
  - An **anonymous cash sale** disables the Send segment with its reason ("no
    number to send a link to") rather than hiding it — the same
    disabled-with-reason posture the Pay-later toggle already takes.
  - Mode defaults to **counter sale**, not to an unchosen state: that is the
    overwhelming majority of counter traffic and today's zero-tap flow, and the
    control keeps the alternative permanently visible and one tap away.
  - The rules that are rules rather than markup (which mode shows payment
    controls, what the primary says, why it's disabled) live in the pure
    `src/lib/counter-panel.ts` and are unit-tested — the panel itself is a
    2,600-line route component, so the seam is what makes them assertable.
- **Counter landing:** `ClaimsPanel` ("Waiting on buyers") under the open
  checkouts — live countdown chip per open claim (amber), **Copy link**
  (always available), **Resend** (cooldown-gated), **Cancel**, plus recent
  outcomes: completed (→ the order), expired ("Send a fresh link" reopens
  the session). Renders nothing until a first claim exists — the build
  screen's button is the feature's front door.
- **Marketing origin (86eyq0eq9).** The send dialog asks "Where's this order
  from?" — **TikTok Live / Instagram Live / Facebook Live / WhatsApp**,
  tap-again to clear. The **`-live` suffix is the point**: these are separate
  buckets from the bare `tiktok`/`instagram`/`facebook` tags the dashboard's
  tagged SHARE LINKS produce, because "my TikTok Lives made RM3,400" and "my
  TikTok bio link made RM800" are two different answers to "how did my socials
  do" — the acquisition mechanics, effort and conversion are nothing alike, and
  blending them would hide the one the live seller actually optimises. WhatsApp
  has **no** live arm on purpose: a WhatsApp claim is a DM or a broadcast reply,
  never a broadcast in the streaming sense. Live variants reuse their parent's
  brand glyph (`BRAND_GLYPHS`), so a "TikTok Live" row wears the TikTok logo —
  a bare label beside logo-bearing siblings reads as a missing icon, not as a
  different channel. The tag is
  frozen on the claim at send and carried onto the committed order's
  `attributionSource`, so Insights counts a live drop's revenue against the
  channel that produced it instead of "Direct / shared link". **Seller-chosen,
  never derived**: a claim link serves a live, a DM quote and a phone order
  alike, and only the seller knows which — staging reserved the `tiktok-live`
  bucket for this feature, but hardcoding it would have mislabelled every
  non-live use. Like the window, the choice is **remembered**
  (`retailers.claimLinkSource`), so it is one tap at the top of a live and
  zero for the next fifty claims. Untagged is fine and unchanged: the order
  buckets `direct` exactly as before.
- `sendClaim` / `resendClaim` / `cancelClaim` are owner-or-admin
  (`requireRetailerAccess`), admin-audited.

## Buyer side (`/claim/<token>`)

- Token capability = `generateTrackingToken()` (the `/track` posture:
  unguessable, noindex, never echoed into meta). Clerk-free buyer surface
  (`BUYER_ROUTE_IDS`), SSR via `ssrRead` soft-degrade.
- **Open:** the variant-A sticky timer bar ("Price locked for 14:32", mint
  clock + progress line, `ClaimTimerBar`) over a slimmed storefront checkout:
  read-only Order Ticket (frozen lines, "price set by the store"), numbered
  sections — 1 details (name editable, phone locked to the number the link
  was sent to), 2 method/address (shared `AddressFieldset`, pickup picker,
  live delivery-fee preview incl. Lalamove), 3 date/time (quick chips,
  opening-hours + notice clamps — the storefront machinery) — note field, and
  a CTA that says what happens next: **"Confirm order · RM X" + "you pay on
  your order page next"** (one payment door; the track page's Pay-now /
  manual sheet, zero new payment code).
- **Commit** (`orderClaims.commit`): public, token-authenticated,
  rate-limited (`claimCommit` by token + the retailer-keyed
  `orderCreate`/`orderCreateDaily` pair — it schedules the same Meta-billed
  confirmation push an order create does). Runs the **storefront validation
  set** (address shape by store country, delivery-on-offer, pickup
  resolution, notice floor = store ∨ strictest claim line, opening hours,
  live stock) but **deliberately skips the min-order rules and the mockup
  gate** — the seller keyed the lines and agreed the price (the counter
  posture; both pinned by test). Delivery fee resolves exactly like
  `orders.create` (shared `resolveDeliveryForOrder` /
  `loadCheckoutDeliveryQuote`, exported from `convex/orders.ts`), so
  fee-pending / blocked stores behave identically. Order lands
  `source: "claim"` with the normal fan-out (activation stamp, usage meter,
  `stampProductsOrdered`, customer link, retailer email + WA seller alert,
  buyer confirmation push). **Idempotent**: a second commit returns the
  existing order; a reopened completed link shows "already confirmed" +
  the track page.
- **After commit** the buyer lands on `/track/<token>`, where the SAME
  deadline keeps counting (`PaymentDueCountdown`, above the payment card)
  until real money — see the timer section for the pause/extension rules.
  An auto-cancelled order's page says why ("the payment window ran out…"),
  never a bare "Cancelled".
- **Expired / cancelled:** calm dead-end — nothing charged, wa.me into the
  seller's chat with a prefilled ask, "Browse the store instead".

## WhatsApp send

Every buyer- or seller-authored string entering `bodyParams` goes through
**`templateParam()`** (`convex/lib/whatsapp.ts`): Meta rejects parameters
containing newlines, tabs or 4+ consecutive spaces, and `classifyPushFailure`
treats that rejection (132007) as **terminal** — so one pasted tab in a
WhatsApp pushname would kill the send with no retry and no explanation to the
seller. It is the single choke point for that class, shared with the seller
alerts and the buyer confirm push.

**A failed send says WHICH failure, because the remedies differ.**
`lastSendOutcome` carries five values, not a boolean:

| Outcome | What the seller is told, and why |
|---|---|
| `sent` | nothing |
| `opted_out` | *"This buyer has opted out… they can reply **START**"* — the only case with a buyer-side remedy, and the common one in practice (a tester's own number usually carries an old STOP). Resend is disabled: it would be blocked identically. |
| `blocked` | a cap, quality throttle or kill switch — **ours**, not the buyer's. Wait, or copy the link. |
| `failed` | Meta rejected it, or the network died. Copy the link. |
| `unavailable` | claim-link sending isn't configured on this deployment — a SETUP fact, not a delivery failure. Copy link is the only offer. |

Collapsing these into one "couldn't be delivered" is how a real, fixable
opt-out read as a mystery delivery problem and cost a server-log dig to
diagnose. **In every non-sent case the link itself still works, deadline
intact** — which is why Copy link is always on the card.

`notifyClaimLink` (convex/whatsapp.ts) mirrors the confirm-push shape:
env-gated on **`WHATSAPP_CLAIM_LINK_TEMPLATE`** (unset ⇒ silently
unavailable; the send outcome stamps `failed` so the seller is handed the
copy-link fallback rather than assuming it sent), EN/MS via
`TEMPLATE_LANGUAGE` (zh rides EN), retries on the shared
`classifyPushFailure` schedule. Body params: `{{1}}` buyer name, `{{2}}`
store, `{{3}}` locked items total, `{{4}}` the window in words
(`describeClaimWindow`, localized); button URL base
**`https://kedaipal.com/claim/{{1}}`** registered via Meta's **Add
variable** (86eyheqzv lesson; the pre-router placeholder rescue is
route-agnostic and covers a mis-registration). Category is
**`utility_template`, deliberately NOT transactional** (ticket AC:
`wabaProtection.canSend` applies — a claim is a seller-initiated offer, so
the kill switch, caps, quality throttle and opt-outs all bind). A
blocked/failed send surfaces on the claims list with "copy the link and
send it yourself" — the link itself keeps working.

### The buyer copy never says "reserved"

v1 holds **no stock** — the claim locks a *price*, and `commit` can still fail
with "sold out while this link was open". So no buyer-facing surface claims a
reservation: the ticket masthead reads "Order ticket · To complete", the header
reads "Ready to complete", and the WhatsApp body says the order "is not
complete yet". The same rule killed the first BM template draft (below). If
stock reservation ever lands (86eybbxhf), this wording can change — and only
then.

### Keeping the template in the Utility category

Meta auto-categorizes templates from their **body text**, and a Marketing
classification is not a cosmetic difference: marketing sends are subject to
per-user frequency caps and require marketing opt-in, so a re-categorized
claim template would start dropping sends silently. The first BM draft was
flagged Marketing because it framed the window as a **price guarantee with
scarcity** — "harga ini dikunci untuk anda" (this price is locked for you) +
"harga akan dilepaskan" (the price will be released). That is the shape of a
limited-time offer, not a transaction update.

The rule for this template (and any future one): describe an **existing
order** and the action needed to finish it; let the **link/request** expire,
never the *price*. Avoid price guarantees, scarcity, deal/offer wording and
celebratory emoji. The price-hold detail is not lost — the buyer sees the live
"Price locked for 14:32" bar on the page the button opens.

## Deferred / follow-ups

- Claim-link **attribution presets** are three (`CLAIM_SOURCE_CHOICES`:
  TikTok Live / Instagram / WhatsApp). A seller who lives on another channel
  has no chip for it — the field takes any sanitized tag, so widening is a
  one-line change once someone asks. Deliberately not the full
  `SHARE_TAG_PRESETS` list: a long chip row is a decision tax mid-livestream.

- Meta template registration (EN + MS) with Arif — until then every claim
  shows the copy-link fallback.
- Stock reservation at send ("claim holds the piece for 15 min") — arrives
  with the reservation ledger (86eybbxhf).
- HitPay-only "pay to complete" (payment inside the window) — v1.1 candidate.
- Live Session Pricing (86eycz9ap) — the storefront half of the TikTok track.
- Claim analytics (send→open→commit funnel) — PostHog isn't in the repo yet.
