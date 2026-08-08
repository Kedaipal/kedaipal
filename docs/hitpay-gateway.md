# HitPay online payments — buyer "Pay now" (86eyb6z3a)

The buyer side of universal pain #2: instead of save-QR → open bank app →
scan from gallery → screenshot → "I've paid" → wait for the seller to check
their bank app, a buyer taps **Pay now** on their order page, pays inside
their own bank/wallet app via HitPay's hosted checkout, and the order marks
itself paid — auto-confirming a pending order and sending the existing
payment-received WhatsApp message. Zero screenshots, zero manual claims,
zero seller reconciliation on gateway orders.

**Kedaipal never touches the money.** The seller connects their **own**
HitPay (MY) account — BYO credentials, exactly the Lalamove posture — and
every payment settles HitPay → the seller's bank. This also makes the
feature independent of the still-pending HitPay *Platform* enablement
(86eyb6z2d): the platform key/OAuth/unified-webhook layer is additive later,
nothing here gets rebuilt.

## The moving parts

| Piece | Where |
| --- | --- |
| Pure API contract (bases, HMAC, amount/method mapping) | `convex/lib/hitpay.ts` |
| Checkout mint + reconcile actions, webhook correlation | `convex/hitpay.ts` |
| Receive path (shared with manual mark-received) | `convex/orders.ts` (`applyPaymentReceived`, `receiveGatewayPayment`, `recordGatewayMethod`) |
| Webhook route | `convex/http.ts` (`POST /webhook/hitpay`) |
| Seller connect card | `src/components/settings/online-payments-card.tsx` (Settings → Payments) |
| Buyer Pay-now + confirming state + collapsed manual methods | `src/routes/track.$token.tsx` |
| Mismatch email | `convex/email.ts` `notifyGatewayPaymentMismatch` + `convex/lib/emailCopy.ts` `gatewayMismatch` (EN/MS/ZH) |
| Credentials | `retailers.hitpay { enabled, apiKey, salt, connectedAt }` — server-only; clients get `HitpaySummary` (hasCredentials/mode/apiKeyHint) |
| Order fields | `orders.gatewayRequestId/-CheckoutUrl/-RequestedAmount/-RequestedCurrency/-RequestedAt/-PaymentId` + index `by_gateway_request` |

## Flow

1. **Connect (seller, once).** Settings → Payments → "Online payments":
   paste the API key + salt from HitPay's dashboard (Settings → API Keys —
   they sit side by side). Sandbox keys are `test_`-prefixed → mode is
   **inferred from the key** (`inferHitpayMode`), no toggle; the card badges
   "Test mode" amber on a sandbox key. Enabling is Pro-gated
   (`PLAN_FEATURES.onlinePayments`); pause/disconnect never are, and
   pause keeps the keys so resuming is one tap. The card links the
   **print-ready vendor guide** `/guides/hitpay-setup.html` (86eyjmhby,
   Lalamove-guide precedent): sign-up → KYC (SSM) → enable MY methods →
   copy key + salt → connect → RM1 test.
2. **Pay now (buyer).** `orders.getPaymentMethods` returns
   `gatewayAvailable` per-order (connected + enabled + unpaid + both price
   holds clear + total ≥ RM0.30). The order page carries ONE payment door:
   - **gateway store** → "Pay now · RM X" opens the hosted checkout;
     "Paid by bank transfer instead? Tell the store" underneath;
   - **manual store** → the same "Pay now · RM X" button instead opens the
     **`ManualPaymentDialog`** sheet.
   All manual payment lives in that sheet (`manual-payment-dialog.tsx`,
   which absorbed the old always-visible "How to pay" section AND the old
   IvePaidDialog): "1 · Pay with any of these" (bank rows with one-tap
   copy, QR zoom + Save QR) → "2 · Then tell the store" (reference +
   receipt screenshot → `claimPayment`). "Update proof" on a claimed order
   reopens the same sheet. WhatsApp copy needed **zero changes** — the
   confirm template's URL button and the "Make payment" CTA already land on
   `/track/<token>`, the one payment door for storefront *and* counter
   pay-later orders.
3. **Mint (lazy, never at order create).** `hitpay.createCheckout` (public
   action, token capability, rate-limited) re-checks every guard
   server-side, then reuses the stored request when it's fresh (<55 min) and
   still matches the total, else `POST /v1/payment-requests` with
   `reference_number = ORD-XXXX`, `redirect_url = /track/<token>`,
   `webhook = <convex-site>/webhook/hitpay`, `expires_after = 1 hour`,
   `send_sms/send_email = false` (**SMS defaults ON upstream** — never drop
   that override). Lazy minting is why held orders (mockup /
   `deliveryFeePending`) can't be paid early and why a request always
   prices the current total. Buyer `name`/`phone` are passed; `email` is
   not (we don't collect it — see Known limitations).
4. **Settle.** Two independent, idempotent paths funnel into
   `orders.receiveGatewayPayment`:
   - **Webhook** `POST /webhook/hitpay` — form-encoded v1 callback. The
     `payment_request_id` resolves the order via `by_gateway_request`
     (before verification, Lalamove-style), then `hmac` is verified with the
     **seller's salt**: sort non-hmac fields by key, concatenate
     `key+value`, HMAC-SHA256. Unknown id → 200 ack; ours-but-no-salt →
     500 fail-closed; bad hmac → 401; non-`completed` → 200 ack.
   - **Redirect reconcile** — landing back on `/track/<token>?status&reference`
     triggers ONE `hitpay.verifyCheckout` (params stripped immediately,
     never trusted) which reads HitPay's status API. This is the safety net
     for a lost webhook, so a paid order can't sit "unpaid" in front of the
     buyer.
5. **Receive** (`receiveGatewayPayment`, the single judge): idempotent by
   `gatewayPaymentId`; **the paid amount+currency must equal the order's
   CURRENT total** — a stale link paid after a re-price writes a
   `gateway_amount_mismatch` orderEvent + emails the seller
   (`gatewayMismatch`, "not auto-marked paid — check HitPay, then settle by
   hand") and never auto-receives. A match applies the exact
   `markPaymentReceived` semantics via the shared `applyPaymentReceived`
   helper: `paymentStatus received`, pending → `confirmed` auto-confirm +
   activation stamp, orderEvents row, `notifyPaymentReceived` WhatsApp (an
   existing message — no new send types). `paymentReference` stores the
   HitPay payment id; the seller's order page shows "Paid online via HitPay
   · <rail> · Ref …", and the buyer's paid card carries the same
   "Payment ref …" with one-tap copy (86eyjmhby) — both sides quote one
   number when a payment question comes up.
6. **Method stamping.** The v1 webhook has no `payment_type`, so webhook
   receives stamp `other` and schedule `enrichPaymentMethod`, which fetches
   the real rail off the status API (`recordGatewayMethod` upgrades only an
   `other` stamp on the same payment — never a seller-picked method). The
   reconcile path has the rail inline. `paymentMethod` gained **`fpx`**;
   HitPay codes map `duitnow→duitnow`, `touch_n_go→tng`, `fpx→fpx`,
   `card→card`, everything else → `other`. Donut/inbox filter pick these up
   through the existing seam (donut opacity ramp widened to 8 slots).

## The enabled-methods probe — honest chips, validated keys

The UI never hardcodes which rails a store offers. HitPay resolves an
account's enabled methods per API key (echoed as `payment_methods[]` on
every payment-request create), so:

- **Connect-time probe** (`hitpay.refreshAccountMethods`, scheduled by
  `updateSettings` whenever a credential is stored): mints a throwaway
  RM1.00 / 5-min-expiry request ("Kedaipal connection check — safe to
  ignore" in the seller's HitPay dashboard) purely to read that echo. This
  doubles as **key validation**: 401/403 stamps `methodsCheckedAt` with NO
  list, and the connect card renders "HitPay rejected this API key" off
  exactly that shape. Transient failures record nothing (prior truth kept).
- **Opportunistic refresh**: every real checkout mint echoes the list, and
  `recordCheckoutRequest` re-stamps it — zero extra API calls, so the truth
  follows the seller's HitPay dashboard within one buyer tap.
- **Renders from truth only**: the settings card's "Buyers can pay with"
  chips (official plugin-repo marks keyed by API code, text-chip fallback
  for unknown codes) and the buyer page's "Pay by Touch 'n Go or DuitNow…"
  line (`describeGatewayMethods`) both read the stored list; unknown/empty
  → a generic "bank or eWallet app" line, never an invented rail. The
  DISCONNECTED card shows a capability row explicitly captioned "buyers
  only ever see the ones you've enabled". Replacing the API key clears the
  stored list (different account, different truth) and re-probes.

## Guard model — where each rule lives

- **Holds gate the MINT, not the webhook.** `createCheckout` refuses while
  the mockup gate is closed or the delivery fee is pending (same copy
  family as `claimPayment`). By webhook time money has moved, so the
  receive path deliberately has **no** hold guards — the amount check is
  the backstop (a held order's total can't have been minted, so a paid
  wrong amount lands in the mismatch flow, not silently applied).
- `claimed` blocks Pay now (the buyer already said they transferred —
  double-paying is the risk); a webhook settling a previously-claimed order
  still applies (real money beats a claim).
- **Replaced links stay payable at HitPay until their 60-min expiry** (PR
  #172 review, finding 1) — reuse-while-fresh only prevents *minting*
  duplicates, it can't kill an already-minted link. So a replacement does
  three things: the old id moves to `orders.gatewayPreviousRequestId`
  (indexed — the webhook and the reconcile resolve BOTH generations, so a
  payment on the old link always reaches `receiveGatewayPayment`, where the
  amount check applies it or records the mismatch), the action best-effort
  `DELETE`s the stale request at HitPay (sandbox-verified; failure just
  falls back to the correlation), and only ONE previous generation is kept
  (a third mint drops the oldest id, which has minutes of life left).
- **Pay-after-cancel never resurrects the order** (finding 2): a link
  minted before a cancel stays payable, so `receiveGatewayPayment` branches
  on `status === "cancelled"` → `gateway_paid_after_cancel` event + the
  `gatewayPaidCancelled` seller email (refund via HitPay dashboard), no
  state flip, no buyer WhatsApp. The seller's own `markPaymentReceived`
  keeps no such guard on purpose — that's a deliberate human act.
- Accepted v1 buyer-side gap: a buyer who paid a stale link sees the page
  still asking for payment (only the seller is emailed) until the seller
  settles it — the sheet/manual claim remains their self-serve signal.

## Verified against the real sandbox (7 Aug 2026)

- Sandbox **does** support MY rails now (their docs lag): TnG + DuitNow QR
  enable per-account; MYR requests accepted; the wallet hop is a "Payment
  Simulator" page. Cards/FPX in sandbox need a (dummy) bank account added.
- Redirect contract confirmed: `?status=completed&reference=<request id>`
  appended to `redirect_url`.
- Status API confirmed: `payments[0].payment_type` (`touch_n_go`), fees,
  `status: succeeded` — the reconcile + enrichment source.
- Sandbox API keys are `test_`-prefixed (basis of the mode inference).
- Test creds: register at `dashboard.sandbox.hit-pay.com` (separate from
  production), Settings → API Keys. Card `4242 4242 4242 4242`; QR flows
  simulate success when scanned/opened.

## Ops runbook

- **Mismatch email** → open the order (link in the email), check the
  payment in the seller's HitPay dashboard by the reference id, then either
  `Mark payment received` by hand or refund in HitPay. Nothing auto-unsets.
- **Refunds are HitPay-dashboard-only in v1** (deliberate): we never
  auto-unset `received` on `charge.updated` — the v1 per-request webhook
  doesn't deliver refund events at all, and the ticket keeps resolution
  manual.
- **Disconnect with an open link**: the buyer can still pay the live link
  until it expires (≤1h), but with the salt gone the webhook 500s — the
  payment then shows only in the seller's HitPay dashboard, and they mark
  received by hand. The disconnect confirm dialog says exactly this.
- **`CONVEX_SITE_URL`** (Convex system var) builds the webhook URL; if it's
  ever absent the mint degrades to no-webhook and the redirect reconcile
  carries settlement alone.

## Known limitations / deferred

- **HitPay's hosted page requires a buyer email** (verified in sandbox —
  prefilled+one-tap when `email` is passed, but we don't collect buyer
  emails and won't fabricate one). Buyers type an email once on HitPay's
  page. TODO: check Settings → Checkout Customisation for an email-optional
  toggle / ask HitPay support; revisit passing email if checkout ever
  collects it.
- **Platform layer** (OAuth connect instead of key-pasting, unified
  `charge.*` webhooks, commission %) waits on HitPay enabling Kedaipal's
  platform account (86eyb6z2d) — additive: swap the connect card's input
  for an OAuth button + register the platform events endpoint.
- **Refund statuses on the order** (refund_pending/refunded), pay-at-
  checkout auto-hop (same action, called right after order create),
  fee-passing UI (`add_admin_fee` — exists in the seller's own HitPay
  dashboard per-method anyway), counter pay-at-scan links (no amount exists
  before ring-up), and a printable `/guides/hitpay-setup.html` are all
  deliberate v1 cuts.
- Two near-simultaneous different-amount links: the pre-re-price link stays
  payable until expiry; covered by the mismatch guard, documented above.

Tests: `convex/lib/hitpay.test.ts` (HMAC round-trip/tamper, amount + method
mapping, request params incl. the send_sms override) +
`convex/hitpay.test.ts` (connect/gate/leak-hygiene, gatewayAvailable
matrix, mint/reuse/guards with mocked fetch, webhook auth/idempotency/
mismatch/fail-closed via `t.fetch`, reconcile + method enrichment).
