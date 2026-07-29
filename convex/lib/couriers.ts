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
		// `/fle/tracking` is Flash's officially documented tracking path, but the
		// `?se=` prefill param is UNVERIFIED — flashexpress.my was returning 502
		// company-wide (root included) when this was checked on 30 Jul 2026, and
		// the .com host sits behind a bot shield. If the param turns out wrong the
		// buyer still lands on Flash's tracking form with our copyable number
		// beside the link; correct it here once their site is reachable again.
		label: "Flash Express",
		buildTrackingUrl: (no) =>
			`https://www.flashexpress.my/fle/tracking?se=${encodeURIComponent(no)}`,
	},
	{
		label: "City-Link Express",
		buildTrackingUrl: (no) =>
			`https://www.citylinkexpress.com/tracking-result/?track0=${encodeURIComponent(no)}`,
	},
	// Cold-chain couriers — the frozen/outstation ICP's carriers. Deliberately
	// name-only: none publishes a per-parcel tracking URL we can build. Checked
	// 30 Jul 2026 — Celsius is tracked through EasyParcel's EasyTrack (their
	// booking channel) and Ninja Cold rides Ninja Van's B2B dashboard, but
	// neither exposes a verifiable prefill param, and a link that silently
	// drops the number is worse than the copyable number we already show. If a
	// seller confirms a working deep link against a REAL consignment number,
	// add buildTrackingUrl here — the UI needs no change.
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
 * True when a stored tracking URL is safe to put in a buyer-facing `href`.
 * ONLY http(s) qualifies — a `javascript:`/`data:` URL in an anchor executes on
 * click, and the tracking page renders this link to the BUYER, so a hostile
 * value would be the seller attacking their own customer. Write-time sanitize
 * (below) keeps new values clean; render sites call this too so values stored
 * before the sanitize existed (the old `setCarrierTrackingUrl` accepted any
 * string) are neutralised on the way out rather than needing a backfill.
 */
export function isSafeTrackingUrl(url: string | undefined): boolean {
	return url !== undefined && /^https?:\/\//i.test(url);
}

/**
 * Normalize a seller-pasted tracking URL, or drop it. Scheme-less input
 * ("tracking.example/123") is the honest typo case, so it gets `https://`
 * rather than being silently discarded; anything carrying a non-http(s) scheme
 * is refused outright.
 */
function sanitizeTrackingUrl(raw: string | undefined): string | undefined {
	const trimmed = clip(raw, TRACKING_URL_MAX);
	if (!trimmed) return undefined;
	if (isSafeTrackingUrl(trimmed)) return trimmed;
	// Any other explicit scheme (javascript:, data:, file:, ftp:…) — refuse.
	if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return undefined;
	// Protocol-relative "//host/path" just needs the scheme.
	if (trimmed.startsWith("//")) return `https://${trimmed.slice(2)}`;
	// A bare path can't be resolved without a host — not a tracking link.
	if (trimmed.startsWith("/")) return undefined;
	return `https://${trimmed}`;
}

/**
 * Normalize raw shipment input into the fields stored on the order. One shared
 * resolver for every write path (mark-shipped opts, stage advance, the
 * edit-after card) so trimming/caps/URL derivation can't diverge.
 *
 * URL precedence: an explicitly pasted link wins ("Other" courier with a link
 * the registry doesn't know); otherwise the link derives from a known courier +
 * tracking number. A pasted link that isn't http(s) is dropped, which can fall
 * through to the derived link. All-empty input resolves to all-undefined
 * (= cleared).
 */
export function resolveShipmentFields(input: ShipmentFields): ShipmentFields {
	const courierName = clip(input.courierName, COURIER_NAME_MAX);
	const trackingNo = clip(input.trackingNo, TRACKING_NO_MAX);
	const explicitUrl = sanitizeTrackingUrl(input.carrierTrackingUrl);
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
