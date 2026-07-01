/**
 * Pure parser for WhatsApp Business Account HEALTH webhooks — the
 * `phone_number_quality_update` and `account_update` change-events Meta posts to
 * the SAME webhook URL as inbound messages. Maps Meta's event vocabulary to our
 * HIGH/MEDIUM/LOW/UNKNOWN rating + messaging tier. No Convex imports (unit-tested
 * in isolation).
 *
 * These fields must be subscribed in the Meta App dashboard (App → WhatsApp →
 * Configuration → Webhook fields) — subscription is a dashboard toggle, not code.
 * `message_template_status_update` is also subscribed (for the out-of-window
 * templates work, ClickUp 86ey1fgjw) but is not a health signal, so it's ignored
 * here and merely logged by the webhook handler. See docs/waba-protection.md.
 */

import type { QualityRating } from "./wabaLimits";

export type WabaHealthEvent = {
	qualityRating: QualityRating;
	/** Messaging limit tier (250/1000/10000/100000); 0 when not reported. */
	messagingTier: number;
	notes?: string;
};

/** Meta's `current_limit` string → numeric daily messaging tier. */
function tierFromLimit(limit: unknown): number {
	switch (typeof limit === "string" ? limit.toUpperCase() : "") {
		case "TIER_50":
			return 50;
		case "TIER_250":
			return 250;
		case "TIER_1K":
			return 1000;
		case "TIER_10K":
			return 10000;
		case "TIER_100K":
			return 100000;
		case "TIER_UNLIMITED":
			return 1_000_000;
		default:
			return 0;
	}
}

/**
 * Quality EVENT → rating. Meta sends an event, not the colour:
 *   FLAGGED → LOW, DOWNGRADE → MEDIUM, UNFLAGGED/UPGRADE/ONBOARDING → HIGH,
 *   anything else → UNKNOWN.
 */
function ratingFromQualityEvent(event: unknown): QualityRating {
	switch (typeof event === "string" ? event.toUpperCase() : "") {
		case "FLAGGED":
			return "LOW";
		case "DOWNGRADE":
			return "MEDIUM";
		case "UNFLAGGED":
		case "UPGRADE":
		case "ONBOARDING":
			return "HIGH";
		default:
			return "UNKNOWN";
	}
}

const SEVERE_ACCOUNT_RE = /RESTRICT|BAN|DISABL|VIOLAT/i;

export function extractWabaHealthEvents(payload: unknown): WabaHealthEvent[] {
	const out: WabaHealthEvent[] = [];
	if (!payload || typeof payload !== "object") return out;
	const entries = (payload as { entry?: unknown }).entry;
	if (!Array.isArray(entries)) return out;
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		const changes = (entry as { changes?: unknown }).changes;
		if (!Array.isArray(changes)) continue;
		for (const change of changes) {
			if (!change || typeof change !== "object") continue;
			const field = (change as { field?: unknown }).field;
			const value = (change as { value?: unknown }).value;
			const v =
				value && typeof value === "object"
					? (value as Record<string, unknown>)
					: {};
			const event = typeof v.event === "string" ? v.event : undefined;

			if (field === "phone_number_quality_update") {
				out.push({
					qualityRating: ratingFromQualityEvent(event),
					messagingTier: tierFromLimit(v.current_limit),
					notes: `quality:${event ?? "?"}`,
				});
			} else if (field === "account_update") {
				// Only a restriction/ban/violation is a health signal. Benign account
				// updates (verification, partner added, …) must NOT downgrade the
				// rating, so we emit nothing for them.
				if (event && SEVERE_ACCOUNT_RE.test(event)) {
					out.push({
						qualityRating: "LOW",
						messagingTier: 0,
						notes: `account:${event}`,
					});
				}
			}
			// message_template_status_update + others: ignored (not a health signal).
		}
	}
	return out;
}
