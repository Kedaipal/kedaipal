// Malaysian parcel-courier registry for manual shipment tracking (86eyehvk4).
// Pure — no Convex imports — imported by BOTH the backend (URL derivation at
// mark-shipped / edit time) and the dashboard picklist, so the two sides can't
// disagree on courier names (the minOrderRules pattern).
//
// Deep-link patterns are best-effort (checked Jul 2026): a stale pattern only
// costs the buyer a landing on the courier's tracking form — the tracking
// number is always shown copyable next to the link, so nothing dead-ends.
// Cold-chain couriers (Celsius, DD, Ninja Cold) have no public URL pattern —
// they're listed name-only so the frozen-seller ICP picks them in one tap.

export type CourierEntry = {
	/** Display name — stored verbatim on orders.courierName. */
	label: string;
	/** Builds the buyer-facing tracking deep link. Absent → plain-text only. */
	buildTrackingUrl?: (trackingNo: string) => string;
};

export const COURIERS: CourierEntry[] = [
	{
		label: "J&T Express",
		buildTrackingUrl: (no) =>
			`https://www.jtexpress.my/tracking/${encodeURIComponent(no)}`,
	},
	{
		label: "Pos Malaysia",
		buildTrackingUrl: (no) =>
			`https://tracking.pos.com.my/tracking/${encodeURIComponent(no)}`,
	},
	{
		label: "Ninja Van",
		buildTrackingUrl: (no) =>
			`https://www.ninjavan.co/en-my/tracking?id=${encodeURIComponent(no)}`,
	},
	{
		label: "SPX Express",
		buildTrackingUrl: (no) =>
			`https://spx.com.my/track?${encodeURIComponent(no)}`,
	},
	{
		label: "Flash Express",
		buildTrackingUrl: (no) =>
			`https://www.flashexpress.my/fle/tracking?se=${encodeURIComponent(no)}`,
	},
	{
		label: "City-Link Express",
		buildTrackingUrl: (no) =>
			`https://www.citylinkexpress.com/tracking-result/?track0=${encodeURIComponent(no)}`,
	},
	// Cold-chain couriers — the frozen/outstation ICP's carriers. No public
	// tracking-URL pattern; courier + number render as copyable text.
	{ label: "Celsius Express" },
	{ label: "DD Express (cold chain)" },
	{ label: "Ninja Cold" },
];

// Server-side sanitize caps. Generous — consignment notes run long (e.g.
// City-Link 20+ chars), but a pasted paragraph is never a tracking number.
export const COURIER_NAME_MAX = 60;
export const TRACKING_NO_MAX = 64;
export const TRACKING_URL_MAX = 500;

/** Registry lookup by display name (exact match — the picklist supplies labels verbatim). */
export function findCourier(label: string): CourierEntry | undefined {
	return COURIERS.find((c) => c.label === label);
}

export type ShipmentFields = {
	courierName?: string;
	trackingNo?: string;
	carrierTrackingUrl?: string;
};

/**
 * Normalize raw shipment input into the fields stored on the order. One shared
 * resolver for every write path (mark-shipped opts, stage advance, the
 * edit-after card) so trimming/caps/URL derivation can't diverge.
 *
 * URL precedence: an explicitly pasted link wins ("Other" courier with a link
 * the registry doesn't know); otherwise the link derives from a known courier +
 * tracking number. All-empty input resolves to all-undefined (= cleared).
 */
export function resolveShipmentFields(input: ShipmentFields): ShipmentFields {
	const courierName = clip(input.courierName, COURIER_NAME_MAX);
	const trackingNo = clip(input.trackingNo, TRACKING_NO_MAX);
	const explicitUrl = clip(input.carrierTrackingUrl, TRACKING_URL_MAX);
	const derivedUrl =
		courierName && trackingNo
			? findCourier(courierName)?.buildTrackingUrl?.(trackingNo)
			: undefined;
	return {
		courierName,
		trackingNo,
		carrierTrackingUrl: explicitUrl ?? derivedUrl,
	};
}

function clip(raw: string | undefined, max: number): string | undefined {
	const trimmed = raw?.trim();
	if (!trimmed) return undefined;
	return trimmed.slice(0, max);
}
