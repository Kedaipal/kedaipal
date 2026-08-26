/**
 * Storefront source attribution (86eyq0eq9) — the buyer-side "where did this
 * order come from" tag. A storefront visit arriving with `?src=` (fallback
 * `utm_source`) persists the tag client-side for the session and stamps it
 * onto the order at create as `orders.attributionSource`; the Insights page
 * reports orders + revenue per source (Pro).
 *
 * Pure module, no Convex imports — shared by BOTH the server (the
 * authoritative re-sanitize in `orders.create`, the insights reduce) and the
 * client (capture hook, poster/QR preset builders, breakdown labels) so the
 * two sides can never disagree on what a tag means. Mirrors the
 * `productCap.ts` / `minOrderRules.ts` posture.
 *
 * Semantics:
 *   - Absent tag = DIRECT. `attributionSource` is only ever stamped when the
 *     buyer actually arrived with a tag; the report derives "direct" from its
 *     absence, so there is no "direct" spelling to migrate.
 *   - Free-form tags are allowed (a seller can invent `?src=raya-promo` and
 *     see it verbatim) — the KNOWN set below only supplies pretty labels.
 *   - Present-but-garbage sanitizes to "other" (the tag existed, so the visit
 *     was NOT direct — collapsing it to direct would hide tampering).
 *   - Counter-checkout orders are NEVER stamped: their bucket derives from
 *     the existing `orders.source === "counter"` (see `attributionBucket`),
 *     so the report still shows a Counter row without a redundant write.
 */

/** Longest stored tag — matches the slug cap; anything longer is truncated. */
export const ATTRIBUTION_MAX_LENGTH = 32;

/** Bucket for a tag that was present but unusable after sanitizing. */
export const ATTRIBUTION_OTHER = "other";

/** Derived bucket keys (never stored on the order row). */
export const ATTRIBUTION_DIRECT = "direct";
export const ATTRIBUTION_COUNTER = "counter";

/**
 * Query params consulted on a storefront hit, in precedence order. `src` is
 * Kedaipal's own reserved convention (poster QRs, despatch-label QR);
 * `utm_source` catches links tagged by external tools.
 */
export const ATTRIBUTION_PARAMS = ["src", "utm_source"] as const;

/**
 * Pretty labels for the tags Kedaipal itself emits or promotes as presets.
 * Anything not listed renders verbatim (free-form seller tags). "counter"
 * covers BOTH the poster's counter-QR storefront fallback and derived
 * counter-checkout orders — one bucket, "the buyer was at your counter".
 */
export const KNOWN_SOURCE_LABELS: Record<string, string> = {
	[ATTRIBUTION_DIRECT]: "Direct / shared link",
	[ATTRIBUTION_COUNTER]: "Counter",
	tiktok: "TikTok",
	// Reserved for claim-link orders minted from a live session (86eyq0epn).
	"tiktok-live": "TikTok Live",
	instagram: "Instagram",
	facebook: "Facebook",
	whatsapp: "WhatsApp",
	// The poster's online QR + despatch-label QR — Kedaipal's printed surfaces.
	online: "Poster QR",
	awb: "Parcel label QR",
	[ATTRIBUTION_OTHER]: "Other",
};

/** Display label for a bucket key — known tags prettified, the rest verbatim. */
export function sourceLabel(source: string): string {
	return KNOWN_SOURCE_LABELS[source] ?? source;
}

/**
 * The channel presets the poster's online QR + the QR dialog's share links
 * offer (86eyq0eq9) — the places a TikTok Live seller actually pastes their
 * link. One list, both surfaces, so they can't drift.
 */
export const SHARE_TAG_PRESETS = [
	{ tag: "tiktok", label: "TikTok" },
	{ tag: "instagram", label: "Instagram" },
	{ tag: "facebook", label: "Facebook" },
	{ tag: "whatsapp", label: "WhatsApp" },
] as const;

export type ShareTagPreset = (typeof SHARE_TAG_PRESETS)[number]["tag"];

/**
 * Sanitize a raw `?src=`/`utm_source` value into a storable tag.
 *
 *   - `undefined`/`null`/blank → `undefined` (no tag arrived — direct; an
 *     empty `?src=` is an authoring accident, not a signal).
 *   - Otherwise: lowercase, spaces→`-`, strip everything outside
 *     `[a-z0-9_-]`, collapse runs of separators, trim them off the ends, cap
 *     at {@link ATTRIBUTION_MAX_LENGTH}.
 *   - Content that leaves nothing behind → {@link ATTRIBUTION_OTHER} (the
 *     tag existed; bucket it rather than silently reclassifying as direct).
 *
 * Never throws — a bad tag must never block checkout (ticket AC).
 */
export function sanitizeAttributionSource(
	raw: string | null | undefined,
): string | undefined {
	if (raw == null) return undefined;
	const trimmed = raw.trim();
	if (trimmed === "") return undefined;
	const cleaned = trimmed
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9_-]/g, "")
		.replace(/[-_]{2,}/g, "-")
		.replace(/^[-_]+|[-_]+$/g, "")
		.slice(0, ATTRIBUTION_MAX_LENGTH);
	return cleaned === "" ? ATTRIBUTION_OTHER : cleaned;
}

/**
 * The report bucket for an order: the stamped tag when one exists, else
 * "counter" for counter-checkout orders, else "direct". The one author of
 * the derivation — the insights reduce and any future surface both call this.
 */
export function attributionBucket(order: {
	source?: string;
	attributionSource?: string;
}): string {
	if (order.attributionSource) return order.attributionSource;
	if (order.source === ATTRIBUTION_COUNTER) return ATTRIBUTION_COUNTER;
	return ATTRIBUTION_DIRECT;
}
