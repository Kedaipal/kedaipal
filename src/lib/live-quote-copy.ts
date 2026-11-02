/**
 * The helper under the delivery address on a live-priced store — ONE author
 * for the storefront checkout and the claim checkout, which used to carry
 * two hand-written twins (and the shorter one had quietly dropped the
 * coverage sentence).
 *
 * The sentence names WHO prices the address, from the `riders` / `couriers`
 * bits `delivery.quote` answers. Until 23 Oct 2026 it always said "by
 * rider … addresses outside the rider's coverage can't be delivered", which
 * on a store with Delyva armed was false: a courier priced an Alor Setar
 * address no rider could reach (`/test-code` on PR #415). A courier reaches
 * the whole country, so the coverage warning is RIDER-only copy and goes
 * away the moment a courier can bid.
 *
 * Deliberately vague about the range — the seller's pickup point is
 * owner-only data, never in the public payload, and rider coverage is a
 * city zone, not a radius we could quote.
 */
export function liveQuoteAddressHint({
	collectsFromCustomer,
	riders,
	couriers,
	selfCollectAvailable,
	overseasPostcodeLabel,
}: {
	/** Collection service (86eyg0n8e): the rider collects FROM the buyer. */
	collectsFromCustomer: boolean;
	riders: boolean;
	couriers: boolean;
	/** The store also offers self-collect, so there is an alternative to name. */
	selfCollectAvailable: boolean;
	/** Set on an overseas address ("postal code"): the lane's courier prices
	 * it from the code the buyer types, so no suggestion is needed. */
	overseasPostcodeLabel?: string;
}): string {
	const who =
		riders && couriers ? "rider or courier" : couriers ? "courier" : "rider";
	const verb = collectsFromCustomer ? "Collection" : "Delivery";
	if (overseasPostcodeLabel !== undefined)
		return `${verb} is by courier, so the fee depends on your address — you'll see it here once you've entered your ${overseasPostcodeLabel}.`;
	const lead = `${verb} is by ${who}, so the fee depends on your address — you'll see it here once you pick a suggestion`;
	// Only a rider has a coverage edge worth warning about.
	if (couriers) return `${lead}.`;
	const edge = collectsFromCustomer
		? "Addresses outside the rider's coverage can't be collected from"
		: "Addresses outside the rider's coverage can't be delivered";
	return `${lead}. ${edge}${selfCollectAvailable ? " — pick up instead" : ""}.`;
}
