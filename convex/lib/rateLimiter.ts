import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";

/**
 * Rate limit definitions.
 *
 * - `orderCreate`: public order creation endpoint. Keyed by retailerId so each
 *   storefront is throttled independently. Token bucket allows a burst of 5
 *   then refills at 30/min steady state.
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
		rate: 30,
		period: MINUTE,
		capacity: 5,
	},
	productWrite: {
		kind: "fixed window",
		rate: 20, // beta: tightened from 60
		period: MINUTE,
	},
	// Bulk import is heavier per call (writes many products in one transaction)
	// but called in small bursts during a single import session.
	productBulkImport: {
		kind: "token bucket",
		rate: 5, // beta: tightened from 20
		period: MINUTE,
		capacity: 2,
	},
	addressUpdate: {
		kind: "token bucket",
		rate: 5,
		period: MINUTE,
		capacity: 3,
	},
	paymentClaim: {
		kind: "token bucket",
		rate: 5,
		period: MINUTE,
		capacity: 3,
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
	googlePlaceDetails: {
		kind: "token bucket",
		rate: 10,
		period: MINUTE,
		capacity: 3,
	},
	// Authenticated seller opening a Counter Checkout session (keyed by Clerk
	// subject). A busy counter mints one per buyer, so allow a healthy burst, but
	// cap runaway creation (each session is a row + a QR render). See
	// convex/counterCheckout.ts.
	checkoutSessionCreate: {
		kind: "token bucket",
		rate: 30,
		period: MINUTE,
		capacity: 10,
	},
});
