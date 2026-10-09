// Pure helpers for order creation. No Convex imports — keep testable in isolation.

import { todayMytMidnight } from "./fulfilmentDate";
import { type VoucherTerms, voucherDiscountFor } from "./vouchers";

// Alphabet excludes O, 0, I, 1 to avoid visual ambiguity in WhatsApp messages.
const SHORT_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SHORT_ID_LENGTH = 4;

export function generateShortId(): string {
	let id = "ORD-";
	for (let i = 0; i < SHORT_ID_LENGTH; i++) {
		id += SHORT_ID_ALPHABET[Math.floor(Math.random() * SHORT_ID_ALPHABET.length)];
	}
	return id;
}

// URL-safe alphabet for the tracking token (no padding chars). 24 chars over a
// 62-symbol alphabet ≈ 142 bits of entropy.
const TOKEN_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const TOKEN_LENGTH = 24;

/**
 * High-entropy, unguessable capability token for the buyer's no-auth tracking
 * page. Unlike `shortId` (a short human ref), this MUST be cryptographically
 * random — it's the only thing standing between an attacker and a customer's
 * order/PII on the public `/track/<token>` page. Uses Web Crypto
 * (`crypto.getRandomValues`), available in both Convex runtimes. Rejection-free
 * modulo bias is negligible here (62 divides evenly enough into 256 that the
 * skew is far below any practical concern for a capability token).
 */
export function generateTrackingToken(): string {
	const bytes = new Uint8Array(TOKEN_LENGTH);
	crypto.getRandomValues(bytes);
	let token = "";
	for (let i = 0; i < TOKEN_LENGTH; i++) {
		token += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
	}
	return token;
}

/** Longest short, buyer-visible reason a seller writes about an order.
 * Shared by every path that needs one so they can't drift: declining a
 * booking request, cancelling a booking, an ordinary cancel, and keeping part
 * of a security deposit. */
export const CANCELLATION_NOTE_MAX = 200;

export type OrderItemPricing = {
	price: number;
	quantity: number;
};

export type OrderTotals = {
	/** Σ lines. Always GROSS — the voucher discount is never netted into it.
	 * Load-bearing: the min-order rules and the free-delivery thresholds judge
	 * the pre-discount subtotal (docs/vouchers.md guard rails), and both read
	 * this number. Netting it here would silently move every threshold. */
	subtotal: number;
	/** What the voucher took off (minor units). 0 when there is none. Mirrored
	 * onto `orders.voucherDiscount` by every site that patches a total. */
	discount: number;
	total: number;
};

/** Charges and deductions folded into `total` on top of the line-item
 * subtotal. Everything here is ADDITIVE except `voucher` — see the field. */
export type OrderExtras = {
	/** Seller's quote for made-to-order/custom work (minor units), set on the
	 * mockup. Re-priceable across mockup rounds. */
	quotedAmount?: number;
	/** Flat fee of the chosen pickup location (minor units), frozen onto the
	 * order at create — see orders.pickupFee / pickupSnapshot.fee. */
	pickupFee?: number;
	/** Delivery charge (minor units), frozen onto the order at create — see
	 * orders.deliveryFee / deliverySnapshot.fee. Delivery orders only. */
	deliveryFee?: number;
	/** Refundable security deposit (minor units), frozen onto a BOOKING order
	 * at request time — see orders.securityDeposit. Collected in the one
	 * payment, returned after check-out; part of `total`, never revenue
	 * (see revenueExcludingDeposit). */
	securityDeposit?: number;
	/**
	 * The order's voucher TERMS (`z8r3fdr617`) — the one and only SUBTRACTIVE
	 * term the total has ever carried, and the reason this seam now returns
	 * three numbers instead of two.
	 *
	 * The TERMS ride here, not the computed sen, deliberately: a percentage
	 * voucher means "10% off this order", so when the items change under it —
	 * the custom-decline keeps part of a mixed basket — the deduction has to
	 * follow the new subtotal rather than freeze a figure that no longer
	 * matches anything. A fixed voucher is the same expression with a flat
	 * value, re-clamped to whatever the basket is now worth.
	 */
	voucher?: VoucherTerms;
};

/**
 * `subtotal` is the sum of line snapshots. `total` adds the optional additive
 * extras (minor units) — the mockup quote, the pickup-location fee, the
 * delivery charge and a booking's security deposit are independent charges and
 * always ADD, never overwrite — then takes off the voucher discount, which is
 * clamped to the item subtotal inside `voucherDiscountFor`. Negative extras
 * floor to 0.
 *
 * SINGLE SOURCE OF TRUTH for the order total. Every recompute site (mockup
 * re-price, custom-decline, pickup switch, address re-price, seller
 * set-delivery-fee) must pass the extras it wants to KEEP — which is why no
 * site hand-lists them any more: they all spread `orderExtras(order)` and
 * override only the one term they are changing. Hand-listing is how the
 * security deposit came to be dropped from five of the six (see that helper).
 */
export function computeOrderTotals(
	items: ReadonlyArray<OrderItemPricing>,
	extras?: OrderExtras,
): OrderTotals {
	const subtotal = items.reduce(
		(sum, item) => sum + item.price * item.quantity,
		0,
	);
	const quote = Math.max(0, extras?.quotedAmount ?? 0);
	const pickupFee = Math.max(0, extras?.pickupFee ?? 0);
	const deliveryFee = Math.max(0, extras?.deliveryFee ?? 0);
	const securityDeposit = Math.max(0, extras?.securityDeposit ?? 0);
	// Clamped to `subtotal` by `voucherDiscountFor`, which is what keeps the
	// total at or above zero: every term above is non-negative, so the most the
	// discount can do is cancel the goods and leave the fees standing.
	const discount = extras?.voucher
		? voucherDiscountFor(extras.voucher, subtotal)
		: 0;
	return {
		subtotal,
		discount,
		total: subtotal + quote + pickupFee + deliveryFee + securityDeposit - discount,
	};
}

/**
 * The value `orders.voucherDiscount` takes for a computed discount — the house
 * "0 is never stored" posture that `pickupFee` and `deliveryFee` already
 * follow, in one place so a patch site can't invent a second spelling. Every
 * site that writes `total` writes this beside it; readers use
 * `voucherDiscount ?? 0`.
 */
export function storedDiscount(discount: number): number | undefined {
	return discount > 0 ? discount : undefined;
}

/** The order fields `orderExtras` reads — a subset of the orders doc, so a
 * caller can pass the whole row. */
export type OrderExtrasSource = {
	mockupQuotedAmount?: number;
	pickupFee?: number;
	deliveryFee?: number;
	securityDeposit?: number;
	voucherSnapshot?: VoucherTerms;
};

/**
 * Read an EXISTING order's extras off the row — the one author for "what is
 * already folded into this order's total".
 *
 * Why this exists. Until `z8r3fdr617` every recompute site hand-listed the
 * three or four extras it happened to know about, and the list drifted: all
 * six omitted `securityDeposit`, so a booking order that reached
 * `updateDeliveryAddress` (which refuses `self_collect` but NOT `booking`) had
 * its deposit silently deleted from `total` — a real money bug found while
 * threading the voucher through. Adding a subtractive term to six hand-written
 * lists would have been the same bet a seventh time, and a missed site there
 * charges the buyer full price.
 *
 * So the rule is now mechanical: a recompute site spreads this and overrides
 * ONLY the term it is changing —
 *
 *     computeOrderTotals(order.items, {
 *       ...orderExtras(order),
 *       deliveryFee: resolved.snapshot?.fee,
 *     })
 *
 * — which means a future extra is carried by every site the moment it is added
 * here, and `order-extras.test.ts` pins that no site hand-lists them again.
 */
export function orderExtras(order: OrderExtrasSource): OrderExtras {
	return {
		quotedAmount: order.mockupQuotedAmount,
		pickupFee: order.pickupFee,
		deliveryFee: order.deliveryFee,
		securityDeposit: order.securityDeposit,
		voucher: order.voucherSnapshot,
	};
}

/**
 * The order's REVENUE figure — `total` minus the refundable security deposit
 * (held money the seller gives back after check-out; counting it would
 * overstate every revenue surface and then understate it again at return).
 * The ONE author for CRM `totalSpent` (link / cancel-decrement / move /
 * backfill) and Insights (earned, collected, payment slices); non-booking
 * orders have no deposit, so this is `total` verbatim for them. Recompute
 * deltas (`total - order.total`) need no netting — the deposit is frozen, so
 * it cancels out of any difference.
 *
 * A voucher needs no term here: `computeOrderTotals` has already taken the
 * discount off `total`, so every revenue surface counts what the seller
 * actually earned without knowing vouchers exist (`z8r3fdr617`).
 */
export function revenueExcludingDeposit(order: {
	total: number;
	securityDeposit?: number;
}): number {
	return Math.max(0, order.total - (order.securityDeposit ?? 0));
}

/** The mockup fields needed to evaluate the gate — a subset of the orders doc. */
export type MockupGateFields = {
	mockupStatus?: "pending" | "submitted" | "changes_requested" | "approved";
	mockupWaivedAt?: number;
};

/**
 * The mockup gate is "closed" while a custom item still needs buyer sign-off:
 * the order carries a `mockupStatus`, it isn't `approved`, and the seller hasn't
 * waived. While closed, BOTH production (→ packed) and payment (buyer claim /
 * seller mark-received) are blocked — the buyer isn't asked to pay until the
 * design + price are agreed. Opens on approve, waive, or removing the custom
 * item (which clears `mockupStatus`). Non-custom orders (no `mockupStatus`) are
 * never gated.
 *
 * **Single source of truth** — imported by `convex/orders.ts`,
 * `convex/whatsapp.ts`, and the dashboard/tracking pages. Define the gate here
 * only; if the rule changes (e.g. a new "seller-cancelled" state), change it here.
 */
export function isMockupGateClosed(order: MockupGateFields): boolean {
	return (
		order.mockupStatus !== undefined &&
		order.mockupStatus !== "approved" &&
		order.mockupWaivedAt === undefined
	);
}

/**
 * Is the order's price still unknown because the seller hasn't quoted the custom
 * work yet? A *narrower* question than `isMockupGateClosed`, and the one the
 * confirmation push asks (86eyd63r8, one-message-per-order).
 *
 * The seller names the price when they **submit** the mockup — `submitMockup`
 * folds `quotedAmount` into `total` there, before the buyer has approved
 * anything. So `submitted` (and `changes_requested`, which can only follow a
 * submit) already carries a real total, even though the *gate* stays closed
 * until sign-off. That's why the order's single WhatsApp message fires at
 * submit: it's the earliest moment the message can state a true price AND the
 * moment the buyer needs the tracking link to go approve.
 *
 * Only `pending` — quote never entered — is genuinely unsettled. A waiver
 * settles it too (the seller has given up on sign-off and proceeds at the
 * standing total).
 */
export function isMockupPriceUnsettled(order: MockupGateFields): boolean {
	return order.mockupStatus === "pending" && order.mockupWaivedAt === undefined;
}

/** The order fields the defaulted-counter-date test reads. */
export type CounterDateFields = {
	source?: string;
	fulfilmentDate?: number;
	createdAt: number;
};

/**
 * Is this counter order's date just the checkout default, rather than a day
 * anyone chose? (`z8r3fdff9u` follow-up, revising the 86ey8r734 badge rule.)
 *
 * The old rule hid the date on EVERY counter order because "the counter
 * defaults it to today — it's not a promised-by date". That was right for the
 * walk-in it described and wrong for the two counter orders whose date IS a
 * promise: a preorder the seller picked a later day for, and a walk-in RSVP
 * whose date the event forced. Both look identical to `source === "counter"`
 * and completely different to a human.
 *
 * So the test is the RATIONALE, not the source: a counter date equal to the
 * MYT day the order was created on is the default (noise — hide it); any other
 * counter date was set on purpose or by an event (information — show it).
 * Storefront/claim orders never hit this: their date is always buyer-chosen.
 *
 * **Single source of truth** — the inbox card's date badge and the order
 * detail's "Collect on" row both ask here, so the two seller surfaces can't
 * disagree about whether a counter date is worth showing.
 */
export function isDefaultedCounterDate(order: CounterDateFields): boolean {
	if (order.source !== "counter") return false;
	if (order.fulfilmentDate === undefined) return true;
	return order.fulfilmentDate === todayMytMidnight(order.createdAt);
}

/** The order fields the free-order test reads. */
export type FreeOrderFields = MockupGateFields & {
	total: number;
	deliveryFeePending?: boolean;
};

/**
 * Is there genuinely nothing to pay? (`z8r3fdff9u`, the free-event case.)
 *
 * A total of 0 is NOT enough on its own, and that's the whole reason this is a
 * shared predicate rather than an inline `total === 0`: a made-to-order order
 * sits at 0 until the seller quotes the mockup, and an out-of-zone delivery
 * sits at its item subtotal until she arranges the fee. Both are "price not
 * settled yet", the exact opposite of "free" — and telling those buyers their
 * order costs nothing is how a seller ends up doing RM400 of catering for
 * free.
 *
 * So: zero, AND no outstanding price to name. True only for an order that
 * really is on the house — a free RSVP event being the case this was built for.
 *
 * **Single source of truth** — the tracking page's payment section, the
 * WhatsApp/email confirmation copy and the seller's payment badge all ask it
 * here, so "free" can't mean three different things across three surfaces.
 */
export function isFreeOrder(order: FreeOrderFields): boolean {
	return (
		order.total === 0 &&
		!isMockupPriceUnsettled(order) &&
		order.deliveryFeePending !== true
	);
}

/** The order fields the collection gate reads (86eyg0n8e). */
export type CollectionGateFields = {
	deliveryDirection?: "standard" | "collection";
	collectedAt?: number;
};

/**
 * The collection gate is "closed" while a COLLECTION order's items are still
 * with the buyer: the rider brings the goods IN, so nothing downstream
 * ("packed", "cleaning", "ready to return") can be true before they arrive.
 * It opens when the rider's webhook stamps `collectedAt` — or when the seller
 * declares they collected in person, which stamps the same field, so the
 * question is asked once rather than at every stage.
 *
 * Standard delivery is never gated: there the rider takes goods OUT, so
 * packing legitimately precedes the trip.
 *
 * **Single source of truth** — imported by every seller-side status write
 * (`advanceToStage`, `updateStatus`, `bulkUpdateStatus`) and mirrored by the
 * order-detail stepper. The callers decide the ANCHOR they're moving into;
 * this only answers "are the goods here yet?".
 */
export function isCollectionGateClosed(order: CollectionGateFields): boolean {
	return (
		order.deliveryDirection === "collection" && order.collectedAt === undefined
	);
}
