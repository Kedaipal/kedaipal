// The ONE promo-price authority (z8r3fdcw72), following the `eventSeats` /
// `bookingAvailability` precedent: the storefront card, the detail sheet, the
// product page, the counter default, the claim send, the booking pricer and
// every order door resolve the effective price through THIS module, so no two
// surfaces can disagree about what a variant costs right now.
//
// Model: a product carries ONE promo config (`products.promo`); each variant
// carries its own sale price (`productVariants.promoPrice`). Whether the sale
// price speaks is a pure function of the config window, the plan (Pro-gated —
// a downgraded store's promo is paused, never deleted) and, for a capped
// flash sale, whether units remain. Nothing is flipped by a cron: an ended
// promo resolves to the list price everywhere at read time.
//
// Pure on purpose — no ctx, no _generated imports beyond types' reach — so
// `src/lib` can re-export it for client-side previews without pulling server
// code into the bundle (the `convex/lib/customer.ts` posture).

import { featuresForPlan, type Plan } from "./plans";

export type PromoConfig = {
	/** Fresh per run — the flash tally groups sold units by this id. */
	runId: string;
	label?: string;
	startsAt?: number;
	endsAt?: number;
	unitCap?: number;
	maxPerOrder?: number;
	payWithinMinutes?: number;
};

export const PROMO_LABEL_MAX_CHARS = 20;
export const DEFAULT_PROMO_LABEL = "Promo";

/** Where a config sits relative to `now`. `scheduled` is the teaser state —
 * the storefront counts down to the drop while Add to cart stays at list. */
export type PromoPhase = "none" | "scheduled" | "live" | "ended";

export function promoPhase(
	promo: PromoConfig | undefined,
	now: number,
): PromoPhase {
	if (!promo) return "none";
	if (promo.startsAt !== undefined && now < promo.startsAt) return "scheduled";
	if (promo.endsAt !== undefined && now >= promo.endsAt) return "ended";
	return "live";
}

/** Window + plan gate in one answer. The plan check is why a downgraded
 * store's storefront quietly sells at list while the config survives. */
export function isPromoActive(
	product: { promo?: PromoConfig },
	plan: Plan,
	now: number,
): boolean {
	if (!featuresForPlan(plan).promo) return false;
	return promoPhase(product.promo, now) === "live";
}

/**
 * The price a line sells at right now. Falls back to the list price when the
 * promo is inactive, the variant has no (valid) sale price — a quote variant
 * with price 0 never discounts — or a capped sale has no units left.
 * `unitsLeft` is `undefined` for an uncapped promo (or a caller that already
 * knows the cap doesn't apply), and comes from `promoUnitsLeft` otherwise so
 * the display and the order door can never count two different ways.
 */
export function effectivePrice(
	variant: { price: number; promoPrice?: number },
	product: { promo?: PromoConfig },
	plan: Plan,
	now: number,
	unitsLeft?: number,
): number {
	if (!isPromoActive(product, plan, now)) return variant.price;
	const promoPrice = variant.promoPrice;
	if (
		promoPrice === undefined ||
		promoPrice <= 0 ||
		promoPrice >= variant.price
	)
		return variant.price;
	if (unitsLeft !== undefined && unitsLeft <= 0) return variant.price;
	return promoPrice;
}

/**
 * The "% off all variants" quick fill: writes an ABSOLUTE sen value per
 * variant (what's stored — the percent is never persisted), rounded to the
 * 5-sen cash grain and clamped strictly below the list price. Returns `null`
 * for a variant too cheap to discount at this grain (list ≤ 5 sen) or a
 * quote variant (list 0); the wizard marks those "not on promo" instead of
 * writing a nonsense price.
 */
export function promoPriceFromPercent(
	listPrice: number,
	percentOff: number,
): number | null {
	if (listPrice <= 5) return null;
	if (percentOff <= 0 || percentOff >= 100) return null;
	const raw = listPrice * (1 - percentOff / 100);
	const rounded = Math.round(raw / 5) * 5;
	return Math.min(Math.max(rounded, 5), listPrice - 5);
}

/** Units still sellable at the sale price. `undefined` = uncapped. */
export function promoUnitsLeft(
	unitCap: number | undefined,
	taken: number,
): number | undefined {
	if (unitCap === undefined) return undefined;
	return Math.max(0, unitCap - taken);
}

/** Crypto-random run id (the `generateTrackingToken` posture, shorter — it
 * only has to be unique per product history, never unguessable). */
export function mintPromoRunId(): string {
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	const bytes = new Uint8Array(12);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** Bounds a payment hold must sit in — the claim-link window's own rails
 * (convex/lib/orderClaims.ts): floor 5 min, ceiling 7 days. */
export const MIN_PROMO_PAY_WINDOW_MINUTES = 5;
export const MAX_PROMO_PAY_WINDOW_MINUTES = 7 * 24 * 60;

/**
 * Validate + normalise a promo config at save. Throws a plain Error with
 * buyer-grade copy (the mutation surfaces it verbatim). Decisions encoded:
 *
 * - A new run keeps the previous `runId` unless the WINDOW changed (re-run =
 *   new dates ⇒ fresh cap pool); everything else (label, cap edits) keeps the
 *   pool, so tightening a live sale's cap doesn't reset what's been sold.
 * - A CAPPED promo always gets a concrete `startsAt` (stamped `now` when the
 *   seller said "start now"): the flash tally needs a left bound to stay a
 *   bounded index read.
 * - Start in the past is allowed (= starts now); end must be after start and
 *   after now (saving an already-ended window is a no-op pretending to work).
 */
export function sanitizePromo(
	next: Omit<PromoConfig, "runId">,
	prev: PromoConfig | undefined,
	now: number,
): PromoConfig {
	const label = next.label?.trim() || undefined;
	if (label !== undefined && label.length > PROMO_LABEL_MAX_CHARS)
		throw new Error(
			`Keep the promo label to ${PROMO_LABEL_MAX_CHARS} characters.`,
		);
	const { startsAt, endsAt } = next;
	if (
		startsAt !== undefined &&
		endsAt !== undefined &&
		endsAt <= startsAt
	)
		throw new Error("The promo must end after it starts.");
	if (endsAt !== undefined && endsAt <= now)
		throw new Error("That end time has already passed.");
	if (next.unitCap !== undefined) {
		if (!Number.isInteger(next.unitCap) || next.unitCap <= 0)
			throw new Error("The unit cap must be a whole number above zero.");
	}
	if (next.maxPerOrder !== undefined) {
		if (!Number.isInteger(next.maxPerOrder) || next.maxPerOrder <= 0)
			throw new Error("Max per order must be a whole number above zero.");
	}
	if (next.payWithinMinutes !== undefined) {
		if (
			!Number.isInteger(next.payWithinMinutes) ||
			next.payWithinMinutes < MIN_PROMO_PAY_WINDOW_MINUTES ||
			next.payWithinMinutes > MAX_PROMO_PAY_WINDOW_MINUTES
		)
			throw new Error(
				"The payment window must be between 5 minutes and 7 days.",
			);
	}
	const windowChanged =
		prev === undefined ||
		prev.startsAt !== startsAt ||
		prev.endsAt !== endsAt;
	const runId = windowChanged ? mintPromoRunId() : prev.runId;
	// `startsAt ?? now` ONLY when capped: the tally's left bound. An uncapped
	// "running now" promo keeps an open start so editing its label later never
	// looks like a re-run.
	const stampedStart =
		next.unitCap !== undefined && startsAt === undefined ? now : startsAt;
	return {
		runId,
		label,
		startsAt: stampedStart,
		endsAt,
		unitCap: next.unitCap,
		maxPerOrder: next.maxPerOrder,
		payWithinMinutes: next.payWithinMinutes,
	};
}

/** A variant's stored sale price must undercut its list price. Save-time
 * guard, shared by create and update so the two doors agree. */
export function assertValidPromoPrice(
	promoPrice: number,
	listPrice: number,
): void {
	if (listPrice <= 0)
		throw new Error(
			"Price-on-quote variants can't carry a promo price — they have no list price to undercut.",
		);
	if (promoPrice <= 0 || promoPrice >= listPrice)
		throw new Error("A promo price must be above zero and below the list price.");
}
