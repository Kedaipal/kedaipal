// Bulk promotions (`z8r3fducfd`) — the pure half. A promotion is ONE set of
// terms applied to many products; this module holds the rules that decide
// what each member product receives and what phase the promotion is in, so the
// server writes and the dashboard display can never disagree.
//
// It prices nothing at read time: `convex/lib/promo.ts` stays the one
// authority for what a variant sells at. A promotion only WRITES the existing
// per-product `promo` config and per-variant `promoPrice`.
//
// Pure on purpose (the `promo.ts` posture) so `src/lib` can import it.

import type { PromoConfig } from "./promo";

/** Most products one promotion can hold — the whole catalogue (the flat
 * product cap), so "every product, 20% off" is always one promotion. */
export const MAX_PROMOTION_PRODUCTS = 200;

/** Most sale prices (one per choice) one promotion can carry. The catalogue
 * allows 200 products × 100 choices; past this the promotion's own reads (the
 * detail page, the edit review) stop fitting a single query, so the picker
 * says so before the seller gets there instead of a save failing. */
export const MAX_PROMOTION_PRICES = 4000;

/** Writes one batch of the apply/clear queue may make (a product row plus its
 * variants each count one). Well inside a transaction's write budget; a
 * promotion bigger than this is finished by a scheduled continuation. */
export const PROMOTION_BATCH_WRITES = 400;

export type PromotionTerms = {
	label?: string;
	startsAt?: number;
	endsAt?: number;
	unitCap?: number;
	maxPerOrder?: number;
	payWithinMinutes?: number;
};

/**
 * The promo config ONE member product receives. Flash extras are dropped on a
 * booking or event listing — capacity and seats already cap those, which is
 * what `assertFlashFieldsAllowed` refuses on a single-product save. Here the
 * promotion still applies its PRICE to them, and the review step says so,
 * rather than refusing a whole promotion over one listing.
 */
export function memberPromoInput(
	terms: PromotionTerms,
	listing: { isBooking: boolean; isEvent: boolean },
): Omit<PromoConfig, "runId"> {
	const flash = !listing.isBooking && !listing.isEvent;
	return {
		label: terms.label,
		startsAt: terms.startsAt,
		endsAt: terms.endsAt,
		unitCap: flash ? terms.unitCap : undefined,
		maxPerOrder: flash ? terms.maxPerOrder : undefined,
		payWithinMinutes: flash ? terms.payWithinMinutes : undefined,
	};
}

/**
 * The sale price a variant should carry, or `undefined` for "not on sale".
 * A listed price only sticks when it undercuts a real list price — a quote
 * line (price 0) or a price at/above list is written as no sale, the same
 * rule `effectivePrice` reads with, so a member can never store a sale price
 * that would silently not speak.
 */
export function targetPromoPrice(
	variant: { price: number },
	listed: number | undefined,
): number | undefined {
	if (listed === undefined) return undefined;
	if (variant.price <= 0) return undefined;
	if (listed <= 0 || listed >= variant.price) return undefined;
	return listed;
}

export type PromotionPhase =
	| "applying"
	| "scheduled"
	| "live"
	| "ended"
	| "ending";

/**
 * Where a promotion stands. Ended wins over everything (an "End now" still
 * clearing its last batch reads as `ending`); then the queue (`applying`
 * while prices are still being written); then the window, by the same rule
 * `promoPhase` applies to one product. A promotion whose window has passed
 * reads `ended` with no seller action — nothing is flipped by a cron.
 */
export function promotionPhase(
	promotion: { startsAt?: number; endsAt?: number; endedAt?: number },
	queue: { pending: number; clearing: number },
	now: number,
): PromotionPhase {
	if (promotion.endedAt !== undefined)
		return queue.clearing > 0 ? "ending" : "ended";
	if (promotion.endsAt !== undefined && now >= promotion.endsAt) return "ended";
	if (queue.pending > 0) return "applying";
	if (promotion.startsAt !== undefined && now < promotion.startsAt)
		return "scheduled";
	return "live";
}

/** Is this promotion still holding its products? A product in an OPEN
 * promotion can't join another without an explicit move; one whose promotion
 * has ended (by hand or by its window) is free. */
export function promotionIsOpen(
	promotion: { endsAt?: number; endedAt?: number },
	now: number,
): boolean {
	if (promotion.endedAt !== undefined) return false;
	return promotion.endsAt === undefined || now < promotion.endsAt;
}
