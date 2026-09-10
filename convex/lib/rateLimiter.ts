import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";

/**
 * Rate limit definitions.
 *
 * - `orderCreate` + `orderCreateDaily`: the public order creation endpoint,
 *   guarded by a PAIR of limiters, both keyed by retailerId so each storefront
 *   is throttled independently. They answer different questions:
 *
 *   `orderCreate` (burst of 60, refill 120/min) shapes traffic WITHIN a live
 *   sale. The original 5-burst / 30-per-min settings silently capped a store
 *   at five near-simultaneous checkouts: a drop with forty buyers tapping
 *   "Place order" inside ten seconds would have taken about five orders and
 *   rejected the rest, and a throttled buyer costs a real sale.
 *
 *   `orderCreateDaily` (500/day, continuous refill) bounds TOTAL exposure.
 *   It exists because a spam order no longer costs just an inventory hold and
 *   some noise: since the confirmation push (86eyf1rck), `orders.create`
 *   schedules a Meta-billed template send to a caller-chosen number, and that
 *   send rides the `transactional` category — which BYPASSES the WABA
 *   kill switch, caps, opt-outs and quality throttle by design (core promise).
 *   The per-minute bucket alone would let one storefront key drive ~172k such
 *   sends/day at the shared WABA, whose quality score is cross-tenant and not
 *   self-healing. 500/day is more orders than the top plan tier's MONTHLY
 *   order cap, so no legitimate seller can meet this ceiling — while an
 *   attacker's reach drops ~345×. Continuous refill (~1 credit/3min) rather
 *   than a midnight window, so recovery is gradual and there's no reset to
 *   time an attack against. If a real store ever hits it, that's a support
 *   conversation, not a config tweak.
 * - `productWrite`: authenticated retailer mutations. Keyed by Clerk subject so
 *   a single user cannot bulk-trash inventory.
 * - `addressUpdate`: public mutation that lets a shopper edit their delivery
 *   address while the order is still pending. Keyed by shortId so abuse on
 *   one order can't starve others. Token bucket allows a small burst then
 *   refills at 5/min steady state — typical edits are 1-2 per shopper.
 * - `paymentClaim`: public mutation where a shopper claims they've paid for
 *   their order. Keyed by shortId. A single shopper may legitimately re-submit
 *   if they fix the reference or replace the screenshot, so the bucket allows
 *   a small burst.
 * - `proofUpload`: public mutation that mints a one-shot Convex storage upload
 *   URL for a payment screenshot. Keyed by shortId so a single order can't
 *   exhaust the system. Slightly tighter than paymentClaim — one upload URL
 *   per claim attempt is the realistic ceiling.
 * - `googleAutocomplete`: public (storefront) + authenticated (settings)
 *   Convex action that proxies Google Places autocomplete. Keyed by retailerId
 *   for storefront callers and Clerk subject for settings callers. Bucket sized
 *   for typing bursts (debounced ~300ms client-side, so ~3 reqs/sec ceiling).
 * - `googlePlaceDetails`: paired action that fetches structured place details
 *   after the user picks an autocomplete suggestion. Tighter — one details
 *   fetch per "session" is the realistic ceiling.
 */
export const rateLimiter = new RateLimiter(components.rateLimiter, {
	orderCreate: {
		kind: "token bucket",
		rate: 120,
		period: MINUTE,
		capacity: 60,
	},
	orderCreateDaily: {
		kind: "token bucket",
		rate: 500,
		period: 24 * 60 * MINUTE,
		capacity: 500,
	},
	productWrite: {
		kind: "fixed window",
		rate: 20, // tightened from 60 at launch
		period: MINUTE,
	},
	// Bulk import is heavier per call (writes many products in one transaction)
	// but called in small bursts during a single import session.
	productBulkImport: {
		kind: "token bucket",
		rate: 5, // tightened from 20 at launch
		period: MINUTE,
		capacity: 2,
	},
	addressUpdate: {
		kind: "token bucket",
		rate: 5,
		period: MINUTE,
		capacity: 3,
	},
	// Buyer correcting the WhatsApp number on their own order after the
	// confirmation push failed (86eyf1rck). Tighter than addressUpdate because
	// every accepted save triggers a fresh template send, which costs money —
	// a couple of genuine typo fixes is the realistic ceiling.
	buyerPhoneUpdate: {
		kind: "token bucket",
		rate: 3,
		period: 10 * MINUTE,
		capacity: 2,
	},
	paymentClaim: {
		kind: "token bucket",
		rate: 5,
		period: MINUTE,
		capacity: 3,
	},
	// Buyer committing a claim link (86eyq0epn) — public token-authenticated
	// mutation. Keyed by the claim token so abuse of one link can't starve
	// others; a couple of validation-fix retries is the realistic ceiling.
	// The commit ALSO runs the retailer-keyed orderCreate/orderCreateDaily
	// pair (it schedules the same Meta-billed confirmation push an order
	// create does, so it must share that spend ceiling).
	claimCommit: {
		kind: "token bucket",
		rate: 5,
		period: MINUTE,
		capacity: 3,
	},
	// Buyer's "Pay now" tap (86eyb6z3a) — mints (or reuses) a HitPay payment
	// request. Keyed by tracking token. Each fresh mint is an outbound API call
	// on the SELLER's HitPay account, so sized like paymentClaim: a burst of
	// retries after a flaky redirect is legitimate, a firehose isn't.
	gatewayCheckout: {
		kind: "token bucket",
		rate: 5,
		period: MINUTE,
		capacity: 3,
	},
	// Redirect-return reconcile against HitPay's status API (86eyb6z3a), keyed
	// by tracking token. Fires once per checkout landing (+ a manual refresh or
	// two while "Confirming payment…" shows).
	gatewayVerify: {
		kind: "token bucket",
		rate: 6,
		period: MINUTE,
		capacity: 4,
	},
	proofUpload: {
		kind: "token bucket",
		rate: 3,
		period: MINUTE,
		capacity: 2,
	},
	// Public mutation that mints an upload URL for a buyer's reference image on a
	// custom/made-to-order line — BEFORE the order exists, so keyed by retailerId
	// (no shortId yet). Sized like proofUpload — one image per checkout.
	customImageUpload: {
		kind: "token bucket",
		rate: 3,
		period: MINUTE,
		capacity: 2,
	},
	// Public buyer mockup approve / request-changes actions (keyed by retailerId).
	mockupReview: {
		kind: "token bucket",
		rate: 5,
		period: MINUTE,
		capacity: 3,
	},
	// Authenticated seller mockup actions (upload URL, submit, quote update),
	// keyed by Clerk subject. Separate from `productWrite` so a bulk product edit
	// can't starve a seller out of sending a time-sensitive mockup for a waiting
	// order (and vice versa).
	mockupSubmit: {
		kind: "token bucket",
		rate: 10,
		period: MINUTE,
		capacity: 5,
	},
	googleAutocomplete: {
		kind: "token bucket",
		rate: 30,
		period: MINUTE,
		capacity: 10,
	},
	// Public checkout action that fetches a live Lalamove delivery quote (fires
	// once per picked address, debounced client-side). Keyed by retailerId.
	// Tighter than autocomplete: each call spends the seller's Lalamove API
	// quota (100 quotes/min account-wide in prod), and repeated probing of a
	// price-by-coordinates oracle is the same trilateration exposure the radius
	// quote guards against — band-coarse pricing is accepted, a firehose isn't.
	lalamoveQuote: {
		kind: "token bucket",
		rate: 10,
		period: MINUTE,
		capacity: 4,
	},
	googlePlaceDetails: {
		kind: "token bucket",
		rate: 10,
		period: MINUTE,
		capacity: 3,
	},
	// Seller self-serve billing (86eyb6z4r): subscribeSelf + the auto-renewal
	// setup/reconcile actions. Authenticated, keyed by retailer/Clerk subject;
	// each accepted call is at most one outbound HitPay API call on KEDAIPAL's
	// own account. A couple of retries after a flaky redirect is legitimate.
	billingSelfServe: {
		kind: "token bucket",
		rate: 6,
		period: MINUTE,
		capacity: 4,
	},
	// Public poster scan (`KPS-<token>`) starting a buyer-initiated counter
	// session. The token is printed on a wall, so this limit IS the security
	// model (with the per-store open-session cap): keyed by
	// `<retailerId>:<buyerPhone>` so one prankster can't spam a store while
	// legit walk-ins stay unaffected. Rescans re-claim the open session without
	// consuming the limit. See docs/counter-checkout.md (86ey5m35w).
	storeQrScan: {
		kind: "token bucket",
		rate: 3,
		period: 60 * MINUTE,
		capacity: 3,
	},
	// NOTE: the per-seller outbound WhatsApp guardrails (whatsappSendPerMinute /
	// whatsappSendDaily) are intentionally NOT registered here. They're enforced
	// by the guarded send gateway (convex/wabaProtection.ts) with an INLINE config
	// per call so a retailer's custom cap (retailers.sendRatePerMinute /
	// sendDailyCap, defaults in lib/wabaLimits.ts) takes effect — the rate-limiter
	// only allows inline config overrides for names that aren't pre-registered.
});
