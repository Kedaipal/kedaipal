/**
 * The Integrations row's "N of M" glance, and the visibility rule it shares
 * with the cards it counts. The count lived inline in the settings route and
 * drifted the moment a third courier arrived (EasyParcel shipped invisible to
 * it, z8r3fdcje2) — so the rule each card uses to decide whether it renders
 * is the SAME function the count asks. A card the seller can see is a card
 * the count includes; one hidden in their country is in neither.
 */

/** What `api.easyparcel.getSettings` says about showing its card. */
export type EasyparcelVisibility = { available: boolean; connected: boolean };

/**
 * The EasyParcel card renders where the integration serves this store, and
 * ALSO wherever something is connected — a store that switched country keeps
 * a way to see and disconnect what it linked. Undefined (still loading)
 * reads as not shown, so the count never jumps up then back down.
 */
export function easyparcelCardShown(
	settings: EasyparcelVisibility | undefined,
): boolean {
	return settings !== undefined && (settings.available || settings.connected);
}

export function integrationsGlance({
	lalamoveConnected,
	hitpayConnected,
	delyva,
	easyparcel,
}: {
	lalamoveConnected: boolean;
	hitpayConnected: boolean;
	/** `api.delyva.getSettings` — counted only where the country can book it. */
	delyva: { countryAllowed: boolean; connected: boolean } | undefined;
	easyparcel: EasyparcelVisibility | undefined;
}): { connected: number; total: number } {
	const accounts = [
		lalamoveConnected,
		hitpayConnected,
		...(delyva?.countryAllowed ? [delyva.connected] : []),
		...(easyparcel && easyparcelCardShown(easyparcel)
			? [easyparcel.connected]
			: []),
	];
	return {
		connected: accounts.filter(Boolean).length,
		total: accounts.length,
	};
}
