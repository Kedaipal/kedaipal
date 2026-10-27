/**
 * Which live courier price the buyer pays (z8r3fdbvdy).
 *
 * A store may now arm more than one booking provider (86eyjpv6z), and the
 * checkout fee is priced by ONE tool while dispatch may use ANOTHER. That
 * gap is a measured leak, not a hypothetical: a Lalamove-priced store
 * collected RM4.00 and the vendor then booked Delyva Instant at RM4.75,
 * eating RM0.75 on every such order.
 *
 * The fee is a PREDICTION of which tool ships, and any prediction drifts, so
 * the only real question is who absorbs the drift. We charge the HIGHER of
 * the quotes (Zaki, reconfirmed 4 Sep): whichever tool the seller picks at
 * dispatch, the collected fee covers it, and a seller who deliberately books
 * the cheaper one keeps the difference — the dispatch card shows "buyer paid
 * X" beside every price, so that choice is always informed. Min-pricing
 * would be friendlier to the buyer and would recreate exactly the leak above.
 * The over-collection is small in practice because Lalamove answers nothing
 * outside its service area: the both-quote case is the intra-city one, where
 * rider and courier prices sit close together.
 *
 * This module is PURE — the rule is the part that must never drift, so it is
 * testable without a network or a database. Fetching lives in the action.
 */

import type { CourierProviderId } from "./courierProviders";
import { type CartWeightItem, lacksParcelWeight } from "./delivery";

export type LiveQuoteProvider = CourierProviderId;

/** One provider's answer. Failure kinds are deliberately provider-neutral:
 * the buyer-facing copy keys off the resolved outcome, never off which API
 * happened to be called. */
export type ProviderQuote =
	| {
			provider: LiveQuoteProvider;
			status: "quoted";
			/** Minor units (sen/cents). */
			fee: number;
			/** The currency the PROVIDER priced in. A Delyva account belonging
			 * to another market prices in its own currency, and a fee the buyer
			 * can't be charged in is worse than no fee at all — see the currency
			 * guard in chooseLiveQuote. */
			currency: string;
			/** Lalamove only: the 5-minute quotation this fee belongs to. */
			quotationId?: string;
			/** Lalamove only. */
			vehicleType?: string;
			/** Delyva only: which service in its list produced this price. */
			serviceCode?: string;
			serviceName?: string;
	  }
	| {
			provider: LiveQuoteProvider;
			/** No courier serves this address — a PERMANENT answer, so the buyer
			 * is told to change the address, never to retry. */
			status: "out_of_range";
	  }
	| {
			provider: LiveQuoteProvider;
			/** This provider has no service for the cart's item type (Delyva
			 * filters CHILLED/FROZEN server-side). Distinct from out_of_range:
			 * the address is fine, the account lacks the service. */
			status: "no_cold_service";
	  }
	| {
			provider: LiveQuoteProvider;
			/** The SELLER's setup is broken (missing keys, no pickup address) —
			 * not the buyer's fault and not retryable by them. */
			status: "store_unavailable";
	  }
	| {
			provider: LiveQuoteProvider;
			/** Riders only (25 Oct 2026): the cart is heavier than every rider
			 * vehicle's published load (`chooseRiderVehicle`), so no rider bids.
			 * Not a coverage answer — the address is fine. */
			status: "too_heavy";
	  }
	| { provider: LiveQuoteProvider; status: "unavailable" };

export type LiveQuoteOutcome =
	| {
			kind: "quoted";
			/** Which provider's price the buyer pays. */
			provider: LiveQuoteProvider;
			fee: number;
			currency: string;
			quotationId?: string;
			vehicleType?: string;
			serviceCode?: string;
			serviceName?: string;
			/** Audit trail: every quote that was considered, winner included.
			 * "Why was I charged RM5.70" has to be answerable months later. */
			considered: Array<{
				provider: LiveQuoteProvider;
				fee: number;
				currency: string;
			}>;
	  }
	| {
			kind: "unquotable";
			reason:
				| "out_of_range"
				| "no_cold_service"
				| "too_heavy"
				| "store_unavailable"
				| "unavailable";
	  };

/**
 * Does this cart need a temperature-controlled courier?
 *
 * v1 reads the STORE's default parcel type, exactly as dispatch does — which
 * is what let this ticket start before the per-item temperature flag
 * (86eyrmv1j) exists. A frozen store quotes frozen, an ambient store quotes
 * parcel, and nothing is ever silently priced as ambient. When per-item
 * flags land, only this function changes: the cart decides instead of the
 * store, and every caller keeps working.
 */
export function cartItemType(storeDefault: string | undefined): string {
	return storeDefault ?? "PARCEL";
}

export function isColdItemType(itemType: string): boolean {
	return itemType === "CHILLED" || itemType === "FROZEN";
}

/**
 * The parcel weight a courier is asked to price when the cart holds an item
 * with NO parcel weight: one kilogram, in grams.
 *
 * Until 23 Oct 2026 an unweighed line meant Delyva "simply didn't bid", and
 * on a store whose rider can't reach the address that was the whole
 * checkout: Mandos (prod, every tee stored at 0 g) refused every delivery
 * order with "pricing isn't working for this store" — a seller-side gap the
 * BUYER paid for with a dead end, found only when a customer complained.
 * Parcel weight is an optional product field, so blank is a normal state,
 * not a misconfiguration to punish the buyer for.
 *
 * Why a floor and not a per-item guess: nearly every Malaysian parcel
 * service bills its first kilogram flat, so a light unweighed cart (tees,
 * kuih) is priced exactly right, and a heavier one is UNDER-quoted — the
 * seller who left the weight blank absorbs the next band when they book,
 * never the buyer. Counting each unweighed item as a kilo would instead
 * overcharge a buyer three tees for a rule they never saw. The seller is
 * told in three places: the delivery-pricing readiness list names the
 * products, the dispatch dialog asks for the packed weight before any
 * booking, and the product form's weight field stays optional.
 */
export const LIVE_QUOTE_WEIGHT_FLOOR_G = 1000;

/**
 * Cart weight for a live courier quote, in kilograms.
 *
 * Weighed lines sum (weight × quantity). A line with no usable weight — an
 * unweighed variant, a custom line, a variant that isn't this store's — adds
 * nothing, and a cart holding one is never quoted under
 * `LIVE_QUOTE_WEIGHT_FLOOR_G`. A fully weighed cart keeps its real sum, even
 * under a kilo: the floor exists for the gap, not to re-price what the
 * seller already answered.
 *
 * `null` only for an EMPTY list: a surface that supplied no cart can't be
 * priced, and that stays a store-side refusal (PR #253 made `items`
 * required on every buyer surface precisely so this never happens).
 */
export function liveQuoteWeightKg(items: CartWeightItem[]): number | null {
	return liveQuoteWeightFacts(items)?.kg ?? null;
}

/**
 * What the courier was asked to price, with the audit trail the ORDER needs:
 * whether the floor fired and how many lines had no weight. Recorded on the
 * quote row and frozen onto the order's delivery snapshot, so the seller's
 * order page can say "priced at the 1 kg floor — 2 items had no weight"
 * instead of showing a fee with no hint of why it may under-collect.
 *
 * `unweighedLines` counts NON-custom lines only: a custom line's weight is
 * unknowable by design, so it floors the quote (`floored`) without being
 * something the seller can go and set.
 */
export function liveQuoteWeightFacts(items: CartWeightItem[]): {
	kg: number;
	/** The cart was quoted at `LIVE_QUOTE_WEIGHT_FLOOR_G` rather than its sum. */
	floored: boolean;
	/** Cart lines a product weight would have priced. */
	unweighedLines: number;
} | null {
	if (items.length === 0) return null;
	let grams = 0;
	let gap = false;
	let unweighedLines = 0;
	for (const item of items) {
		if (item.isCustom) {
			gap = true;
			continue;
		}
		if (lacksParcelWeight(item)) {
			gap = true;
			unweighedLines += 1;
			continue;
		}
		grams += Math.round(item.parcelWeightG) * Math.max(0, item.quantity);
	}
	const floored = gap && grams < LIVE_QUOTE_WEIGHT_FLOOR_G;
	if (gap) grams = Math.max(grams, LIVE_QUOTE_WEIGHT_FLOOR_G);
	return { kg: grams / 1000, floored, unweighedLines };
}

/**
 * What a won quote records about weight it could not see (PR #416 review).
 * Only a courier prices by weight, so a rider's price records nothing.
 *
 * Two different gaps, both worth telling the seller:
 * - `weightFloored`: the cart was priced at the one-kilo floor;
 * - `unweighedLines`: lines a product weight would have priced. Recorded
 *   whenever there are any, NOT only when the floor fired — a 1.5 kg cart
 *   with five unweighed tees was priced at 1.5 kg, under-collecting exactly
 *   as much as a floored one, and used to leave no note.
 */
export function weightGapStamp(args: {
	provider: LiveQuoteProvider;
	weightFloored: boolean;
	unweighedLines: number;
}): { weightFloored?: true; unweighedLines?: number } {
	if (args.provider !== "delyva") return {};
	const lines =
		args.weightFloored || args.unweighedLines > 0
			? args.unweighedLines
			: undefined;
	return {
		...(args.weightFloored ? { weightFloored: true as const } : {}),
		...(lines !== undefined ? { unweighedLines: lines } : {}),
	};
}

/**
 * Apply the rule to whatever the providers answered.
 *
 * `storeCurrency` is the currency the buyer will actually be charged in.
 * Any quote priced in a different one is DISCARDED rather than converted:
 * we hold no exchange rate, and charging a Singapore buyer a ringgit number
 * would be a silent mispricing. (Reachable today — a Malaysian Delyva
 * account attached to a Singapore store prices in MYR.)
 */
export function chooseLiveQuote(args: {
	quotes: ProviderQuote[];
	storeCurrency: string;
	cold: boolean;
}): LiveQuoteOutcome {
	const { quotes, storeCurrency, cold } = args;

	// A cold cart is Delyva's alone: a rider carries no temperature guarantee,
	// so a cheaper rider quote must never win — nor stand in when Delyva has
	// nothing. Falling back would price a frozen cart as an ambient trip,
	// which is the one outcome this design refuses.
	const eligible = cold
		? quotes.filter((q) => q.provider === "delyva")
		: quotes;

	const priced = eligible.filter(
		(q): q is Extract<ProviderQuote, { status: "quoted" }> =>
			q.status === "quoted" &&
			Number.isFinite(q.fee) &&
			q.fee >= 0 &&
			q.currency === storeCurrency,
	);

	if (priced.length > 0) {
		// Higher wins. Ties keep the first — order is the caller's provider
		// order, so the result is deterministic rather than accidental.
		let winner = priced[0];
		for (const q of priced) if (q.fee > winner.fee) winner = q;
		return {
			kind: "quoted",
			provider: winner.provider,
			fee: winner.fee,
			currency: winner.currency,
			quotationId: winner.quotationId,
			vehicleType: winner.vehicleType,
			serviceCode: winner.serviceCode,
			serviceName: winner.serviceName,
			considered: priced.map((q) => ({
				provider: q.provider,
				fee: q.fee,
				currency: q.currency,
			})),
		};
	}

	// Nothing priceable. The reason the buyer sees is the most ACTIONABLE one
	// present, not the first: "your account has no cold-chain service" beats
	// "temporarily unavailable" when both are true, and a seller-side breakage
	// outranks a generic failure because its copy points somewhere useful.
	const reasons = new Set(eligible.map((q) => q.status));
	if (cold && reasons.has("no_cold_service"))
		return { kind: "unquotable", reason: "no_cold_service" };
	// Too heavy for a rider, and nothing else priced it: the buyer can act on
	// that (pickup, a smaller order), so it outranks the seller-side and
	// generic answers — and it is never "change your address".
	if (reasons.has("too_heavy"))
		return { kind: "unquotable", reason: "too_heavy" };
	if (reasons.has("store_unavailable"))
		return { kind: "unquotable", reason: "store_unavailable" };
	// Every provider that answered says the address is outside its coverage —
	// only then is it safe to tell the buyer their address is the problem.
	if (
		reasons.size > 0 &&
		eligible.every((q) => q.status === "out_of_range")
	)
		return { kind: "unquotable", reason: "out_of_range" };
	return { kind: "unquotable", reason: "unavailable" };
}

/**
 * Do two line lists describe the same priced cart? (PR #253 review.)
 *
 * Delyva's bid depends on the summed variant weight, so a quote row minted
 * for one cart must not be redeemable against another — quoting an emptier
 * cart and checking out a heavier one buys a cheaper courier band. Compared
 * as a MULTISET of (variantId → summed quantity): order within the cart is
 * presentation, split lines of the same variant weigh the same, and lines
 * without a variantId (custom / legacy) are ignored on both sides because
 * they were never summable into the quote's weight to begin with.
 */
export function sameQuotedLines(
	a: ReadonlyArray<{ variantId?: string; quantity: number }>,
	b: ReadonlyArray<{ variantId?: string; quantity: number }>,
): boolean {
	const tally = (
		lines: ReadonlyArray<{ variantId?: string; quantity: number }>,
	) => {
		const m = new Map<string, number>();
		for (const line of lines) {
			if (!line.variantId) continue;
			m.set(line.variantId, (m.get(line.variantId) ?? 0) + line.quantity);
		}
		return m;
	};
	const ta = tally(a);
	const tb = tally(b);
	if (ta.size !== tb.size) return false;
	for (const [k, v] of ta) if (tb.get(k) !== v) return false;
	return true;
}
