/**
 * WABA send-guardrail constants + pure helpers (ClickUp 86expmgep). No Convex
 * imports so it's unit-testable in isolation and shared by the gateway + tests.
 *
 * Kedaipal sends every retailer's WhatsApp through ONE shared, Meta-verified
 * number, so one bad actor can degrade the shared quality rating / trip Meta's
 * per-number limits for everyone. These caps + the category policy are the
 * always-on backstop; the per-retailer kill switch is the manual lever on top.
 * See docs/waba-protection.md.
 */

import type { Plan } from "./plans";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const BURST_WINDOW_MS = 5 * 60 * 1000;

/**
 * New retailers are capped hard for their first 30 days regardless of tier — the
 * anti-abuse ramp (a fresh signup mass-sending is the classic spam pattern).
 */
export const NEW_ACCOUNT_DAYS = 30;
export const NEW_ACCOUNT_DAILY_CAP = 50;

/** Burst ceiling: max sends per retailer per 5-min window. */
export const DEFAULT_BURST_CAP_5MIN = 30;

/** Steady-state daily cap by tier (after the first 30 days). */
const TIER_DAILY_CAP: Record<Plan, number> = {
	starter: 50,
	pro: 200,
	scale: 500,
};

/**
 * Effective per-retailer caps. An explicit admin override (>0) wins; otherwise
 * the daily cap is the tier cap, floored to NEW_ACCOUNT_DAILY_CAP during the
 * first 30 days.
 */
export function resolveSendingLimits(args: {
	plan: Plan;
	accountCreatedAt: number;
	now: number;
	dailyCapOverride?: number;
	burstCapOverride?: number;
}): { dailyCap: number; burstCap5min: number } {
	const { plan, accountCreatedAt, now, dailyCapOverride, burstCapOverride } =
		args;
	const tierCap = TIER_DAILY_CAP[plan] ?? NEW_ACCOUNT_DAILY_CAP;
	const isNew = now - accountCreatedAt < NEW_ACCOUNT_DAYS * DAY_MS;
	const derived = isNew ? Math.min(NEW_ACCOUNT_DAILY_CAP, tierCap) : tierCap;
	return {
		dailyCap:
			dailyCapOverride && dailyCapOverride > 0 ? dailyCapOverride : derived,
		burstCap5min:
			burstCapOverride && burstCapOverride > 0
				? burstCapOverride
				: DEFAULT_BURST_CAP_5MIN,
	};
}

export type OptOutSource = "stop_keyword" | "berhenti_keyword" | "unsub_keyword";

/**
 * Classify an inbound message as an opt-out / opt-in keyword, or null. EXACT
 * (trimmed, case-insensitive) match only — Meta's convention, and it avoids
 * suppressing someone whose order note merely contains the word "stop". EN + MS.
 */
export function classifyOptOutKeyword(
	text: string,
): { kind: "out"; source: OptOutSource } | { kind: "in" } | null {
	const t = text.trim().toUpperCase();
	if (t === "STOP") return { kind: "out", source: "stop_keyword" };
	if (t === "BERHENTI") return { kind: "out", source: "berhenti_keyword" };
	if (t === "UNSUB" || t === "UNSUBSCRIBE")
		return { kind: "out", source: "unsub_keyword" };
	if (t === "START" || t === "MULA") return { kind: "in" };
	return null;
}

export type MessageCategory =
	| "transactional"
	| "utility_template"
	| "marketing_template"
	| "session_message";

export type QualityRating = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

/**
 * Transactional order messages (confirmations, status updates, payment received)
 * are the core promise — they bypass opt-out, retailer pause, caps, and the
 * quality halt. Everything else (session replies, broadcast/utility templates) is
 * gated. Centralised so the gateway and tests agree on the boundary.
 */
export function isTransactional(category: MessageCategory): boolean {
	return category === "transactional";
}

/**
 * Whether the current shared-number quality rating should block a given category.
 *   - LOW  → pause ALL non-transactional outbound.
 *   - MEDIUM / UNKNOWN → pause Marketing only (UNKNOWN treated as MEDIUM —
 *     conservative, per the ticket's edge case).
 *   - HIGH → nothing blocked.
 * Transactional is never blocked here.
 */
export function qualityBlocks(
	rating: QualityRating,
	category: MessageCategory,
): boolean {
	if (isTransactional(category)) return false;
	if (rating === "LOW") return true;
	if (rating === "MEDIUM" || rating === "UNKNOWN") {
		return category === "marketing_template";
	}
	return false; // HIGH
}
