/**
 * Product-analytics vocabulary + identifier hygiene (86eyrayux).
 *
 * Pure module, no Convex imports — shared by BOTH the server (the authoritative
 * re-sanitize in `orders.create`, the capture action) and the client (the boot
 * hook, the checkout read) so the two sides can never disagree on what an event
 * name or a distinct id means. Mirrors the `attribution.ts` posture.
 *
 * WHY A DISTINCT ID CROSSES THE WIRE AT ALL
 *
 * Kedaipal's funnel crosses the device boundary: the buyer browses the
 * storefront in a browser, hands off to WhatsApp, and the order is then
 * confirmed and paid *server-side* — with no browser session to fire from.
 * Client-only analytics therefore cannot see the two steps that matter
 * (confirmed, paid). The fix is to carry the browser's PostHog `distinct_id`
 * into the order at create, so the server-fired events land on the SAME person
 * as the anonymous pageviews that preceded them.
 *
 * The id is an opaque UUID minted by posthog-js. It is not PII, and PostHog
 * only ever receives it alongside non-PII order properties — never the buyer's
 * name, phone, or address. See docs/analytics.md § PostHog.
 */

/** PostHog rejects a `distinct_id` longer than this (documented API limit). */
export const POSTHOG_MAX_DISTINCT_ID = 200;

/**
 * Event names. Kedaipal fires a small, explicit set — autocapture is OFF (see
 * `src/lib/posthog.ts`), so this object is the complete server-side vocabulary
 * and the one place a name is spelled.
 */
export const ANALYTICS_EVENTS = {
	/** A storefront order row was committed. Fired from `orders.create`. */
	orderCreated: "order_created",
} as const;

export type AnalyticsEvent =
	(typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/**
 * Values PostHog itself treats as junk distinct ids — a client that failed to
 * mint a real one will happily send the string "undefined", and PostHog would
 * then merge every such buyer into one shared person. Cheaper to drop the id
 * (the event still records, unattributed) than to poison the funnel.
 *
 * Compared lowercase after trimming.
 */
const INVALID_DISTINCT_IDS: ReadonlySet<string> = new Set([
	"0",
	"anonymous",
	"distinct_id",
	"distinctid",
	"false",
	"guest",
	"id",
	"nan",
	"none",
	"null",
	"true",
	"undefined",
	"[object object]",
]);

/**
 * Sanitize a raw `distinct_id` into a storable one.
 *
 *   - `undefined`/`null`/blank → `undefined` (no analytics id — the event is
 *     simply not attributed to a person; nothing downstream breaks).
 *   - Control characters stripped, then trimmed and capped at
 *     {@link POSTHOG_MAX_DISTINCT_ID}.
 *   - A known-junk value ({@link INVALID_DISTINCT_IDS}) → `undefined`.
 *
 * Never throws — a bad id must never block checkout, exactly like
 * `sanitizeAttributionSource`.
 */
export function sanitizeDistinctId(
	raw: string | null | undefined,
): string | undefined {
	if (raw == null) return undefined;
	const cleaned = raw
		// Strip C0 controls + DEL. A stray newline or NUL would either corrupt
		// the JSON body we POST or split one person into two.
		.replace(/[\u0000-\u001f\u007f]/g, "")
		.trim()
		.slice(0, POSTHOG_MAX_DISTINCT_ID)
		.trim();
	if (cleaned === "") return undefined;
	if (INVALID_DISTINCT_IDS.has(cleaned.toLowerCase())) return undefined;
	return cleaned;
}
