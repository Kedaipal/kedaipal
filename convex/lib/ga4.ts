/**
 * GA4 Measurement Protocol helpers (z8r3fdd1v1) — the SERVER-side sibling of
 * the client event catalog in `src/lib/ga-events.ts`. Pure functions only:
 * the fetch itself lives in `convex/analytics.ts` so everything here is
 * unit-testable without a network.
 *
 * Server events exist because activation = the first REAL order confirmed,
 * which happens in Convex (often while the seller is offline), never in the
 * seller's browser. Kept as a separate catalog from `FunnelEvent` on purpose:
 * the client module boots react-ga4 and reads sessionStorage — nothing a
 * Convex action can (or should) import.
 */

/**
 * The server key-event catalog — the only names the emitter accepts, so a
 * typo'd call site is a compile error (GA validates nothing at send time).
 * Widen here, and mirror docs/analytics.md.
 */
export type ServerKeyEvent = "first_order" | "subscribe_paid";

/** Where Measurement Protocol events are POSTed (query carries the ids). */
export const GA4_MP_ENDPOINT = "https://www.google-analytics.com/mp/collect";

/**
 * GA4's wire format for a client id: `<random>.<timestamp>` — two
 * dot-separated integers. Anything else (including a raw `GA1.1.…` cookie
 * value) is rejected so garbage from the client can never reach the wire.
 */
export function isValidGaClientId(value: string): boolean {
	return /^\d+\.\d+$/.test(value);
}

/**
 * Extract the GA client id from a document.cookie string. The `_ga` cookie
 * holds `GA1.<n>.<random>.<timestamp>`; the client id is the last two parts.
 * Property-scoped `_ga_<STREAM>` cookies are session cookies, not the client
 * id, and are deliberately ignored. Undefined on any miss — attribution is
 * best-effort, never fatal.
 */
export function extractGaClientId(
	cookieHeader: string | undefined,
): string | undefined {
	if (!cookieHeader) return undefined;
	for (const pair of cookieHeader.split(";")) {
		const eq = pair.indexOf("=");
		if (eq === -1) continue;
		if (pair.slice(0, eq).trim() !== "_ga") continue;
		const parts = pair.slice(eq + 1).trim().split(".");
		if (parts.length < 4) return undefined;
		const clientId = parts.slice(-2).join(".");
		return isValidGaClientId(clientId) ? clientId : undefined;
	}
	return undefined;
}

/**
 * Deterministic fallback client id when the retailer signed up without a GA
 * cookie (ad-blocker, GA unbooted). Events sent under it still count and
 * segment by `src`, but won't stitch to the client-side funnel — see
 * docs/analytics.md. FNV-1a over the seed, twice with different offsets, so
 * the same retailer always maps to the same synthetic id.
 */
export function syntheticGaClientId(seed: string): string {
	const fnv1a = (input: string, offset: number): number => {
		let hash = offset >>> 0;
		for (let i = 0; i < input.length; i++) {
			hash ^= input.charCodeAt(i);
			hash = Math.imul(hash, 0x01000193) >>> 0;
		}
		return hash;
	};
	return `${fnv1a(seed, 0x811c9dc5)}.${fnv1a(seed, 0x7ee36237)}`;
}

/** Event params GA4 accepts: flat string/number/boolean values. */
export type MpEventParams = Record<string, string | number | boolean>;

export interface MpPayload {
	client_id: string;
	events: Array<{ name: ServerKeyEvent; params: MpEventParams }>;
}

/**
 * Build the Measurement Protocol request body for one key event. The stored
 * acquisition `src` rides as a param (absent = untagged/direct — never a
 * placeholder value, matching `signupSource` semantics). A nonzero
 * `engagement_time_msec` is required for the event to register against an
 * active user in GA4 reports.
 */
export function buildMpPayload(input: {
	clientId: string;
	event: ServerKeyEvent;
	src?: string;
	params?: MpEventParams;
}): MpPayload {
	return {
		client_id: input.clientId,
		events: [
			{
				name: input.event,
				params: {
					engagement_time_msec: 1,
					...(input.src !== undefined ? { src: input.src } : {}),
					...input.params,
				},
			},
		],
	};
}
