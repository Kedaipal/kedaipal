# Claim links — seller keys the order, buyer completes it (86eyq0epn)

**Status: built (dev).** The TikTok Live funnel: a seller collecting "mine"
claims in live chat keys each claim in Counter Checkout (items, qty, the price
they called out — including per-line overrides, 86eyphh8r), attaches the
buyer's phone, and **sends the rest of checkout to the buyer** as a WhatsApp
link. The buyer opens `/claim/<token>` — a pre-filled, **price-locked**
checkout — adds address, fulfilment date/time and (on the order page next)
payment. The order commits, and stock decrements, **only at buyer
completion**. Also covers general order-on-behalf: phone orders, DM quotes,
repeat customers.

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

## The timer (Zaki's checkout window — locked 26 Aug 2026)

- The window is a **fixed deadline** stamped at send (`expiresAt`), chosen in
  the send dialog: **15 min / 1 hour / 24 hours** chips
  (`CLAIM_WINDOW_CHOICES_MINUTES`), 24 h the ticket default. The chosen value
  is remembered as the store's default (`retailers.claimLinkWindowMinutes`,
  updated at send — the dialog says so; deliberately no separate Settings
  card).
- **Option (a): the timer gates buyer COMPLETION only.** An expired link
  kills the checkout and the locked price; a committed order's payment then
  follows the normal flow (HitPay Pay-now / manual transfer + the reminder
  machinery). There is **no auto-cancel of committed-but-unpaid orders** —
  that can't work honestly for manual-transfer stores, where "paid" is a
  human-verified claim. A HitPay-only "pay to complete" is the v1.1 candidate
  if hard pay-within-window semantics are ever wanted.
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

## Seller side (Counter Checkout)

- **Build screen:** "Send to buyer to complete" under Review order — rendered
  only for identified buyers (an anonymous sale has nobody to send to),
  disabled-with-reason until every line is priced. Opens `SendClaimDialog`
  (window chips + what-the-buyer-fills chips); on send, back to the counter
  landing with a toast.
- **Counter landing:** `ClaimsPanel` ("Waiting on buyers") under the open
  checkouts — live countdown chip per open claim (amber), **Copy link**
  (always available), **Resend** (cooldown-gated), **Cancel**, plus recent
  outcomes: completed (→ the order), expired ("Send a fresh link" reopens
  the session). Renders nothing until a first claim exists — the build
  screen's button is the feature's front door.
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

- Meta template registration (EN + MS) with Arif — until then every claim
  shows the copy-link fallback.
- Stock reservation at send ("claim holds the piece for 15 min") — arrives
  with the reservation ledger (86eybbxhf).
- HitPay-only "pay to complete" (payment inside the window) — v1.1 candidate.
- Live Session Pricing (86eycz9ap) — the storefront half of the TikTok track.
- Claim analytics (send→open→commit funnel) — PostHog isn't in the repo yet.
