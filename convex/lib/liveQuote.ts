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

export type LiveQuoteProvider = "lalamove" | "delyva";

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
