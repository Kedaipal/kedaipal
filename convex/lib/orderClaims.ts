/**
 * Claim links (86eyq0epn) — pure rules shared by the server (convex/orderClaims.ts)
 * and the client (send dialog, claims list, buyer claim page), so the two sides
 * can never disagree about a window, a cooldown, or whether a claim is still
 * alive. No Convex imports — unit-testable in isolation.
 *
 * The timer semantics (locked with Zaki, 26 Aug 2026):
 *  - The window gates buyer COMPLETION only (option (a)): an expired link kills
 *    the locked price and the checkout; a committed order's payment follows the
 *    normal flow (HitPay pay-now / manual transfer + reminders).
 *  - Resend NEVER resets the deadline — same link, same clock.
 *  - Resend is cooled down + capped so a seller can't spam the buyer's WhatsApp.
 */

/** Selectable windows in the send dialog (minutes). 15 min = live-drop urgency,
 * 24 h = the ticket's default for DM/phone orders. */
export const CLAIM_WINDOW_CHOICES_MINUTES = [15, 60, 24 * 60] as const;

/** The ticket's default (24 h) — used when the store has never sent one. */
export const DEFAULT_CLAIM_WINDOW_MINUTES = 24 * 60;

/** Hard bounds on a window. The floor keeps a fat-fingered 1-minute link from
 * being dead before WhatsApp delivers it; the ceiling keeps "price locked"
 * honest (a week-old locked price is a stale quote, not a live deal). */
export const MIN_CLAIM_WINDOW_MINUTES = 5;
export const MAX_CLAIM_WINDOW_MINUTES = 7 * 24 * 60;

/** Resend guard: one WhatsApp nudge per cooldown, hard-capped per claim. The
 * cooldown is deliberately shorter than the manual payment reminder's 6 h —
 * a 15-minute live window would otherwise never allow a single resend. */
export const CLAIM_RESEND_COOLDOWN_MS = 5 * 60 * 1000;
export const CLAIM_MAX_SENDS = 3;

/** Dead claims (expired / cancelled) hold buyer PII (phone + name) — purged
 * after the same retention as dead counter sessions. Completed claims are kept
 * (they link to an order; order retention is the PDPA pack's job). */
export const CLAIM_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Validate + normalize a seller-chosen window. Throws on a non-integer or
 * out-of-bounds value — the dialog only offers valid choices, so this only
 * fires on a hand-rolled call. */
export function sanitizeClaimWindowMinutes(minutes: number): number {
	if (!Number.isInteger(minutes))
		throw new Error("Window must be a whole number of minutes");
	if (minutes < MIN_CLAIM_WINDOW_MINUTES)
		throw new Error(
			`Window must be at least ${MIN_CLAIM_WINDOW_MINUTES} minutes`,
		);
	if (minutes > MAX_CLAIM_WINDOW_MINUTES)
		throw new Error("Window must be 7 days or less");
	return minutes;
}

export type ClaimStatus = "open" | "completed" | "cancelled" | "expired";

/**
 * The claim's status as it should read RIGHT NOW: an `open` claim past its
 * deadline reads `expired` even before the cron flips the row — so no read
 * (buyer page, claims list, commit gate) ever trusts a stale "open".
 * Same posture as counterCheckout's effectiveStatus.
 */
export function effectiveClaimStatus(
	claim: { status: ClaimStatus; expiresAt: number },
	now: number,
): ClaimStatus {
	if (claim.status === "open" && now > claim.expiresAt) return "expired";
	return claim.status;
}

export type ClaimResendState =
	| { canResend: true }
	| {
			canResend: false;
			reason: "cooldown" | "max_sends";
			/** When the cooldown lifts (cooldown reason only). */
			nextAt?: number;
	  };

/**
 * May this claim be re-sent to the buyer's WhatsApp right now? Judged from the
 * send counters only — callers gate on the claim being effectively `open`
 * first. Drives BOTH the server refusal and the disabled-with-reason Resend
 * button (which counts down to `nextAt`).
 */
export function claimResendState(
	claim: { sentCount: number; lastSentAt: number },
	now: number,
): ClaimResendState {
	if (claim.sentCount >= CLAIM_MAX_SENDS)
		return { canResend: false, reason: "max_sends" };
	const nextAt = claim.lastSentAt + CLAIM_RESEND_COOLDOWN_MS;
	if (now < nextAt) return { canResend: false, reason: "cooldown", nextAt };
	return { canResend: true };
}

/**
 * Human wording for a window, for the WhatsApp template body + dialog copy.
 * Whole hours say hours, whole days say days, anything else says minutes —
 * "90 minutes" reads better in a chat message than "1.5 hours". `lang` follows
 * TEMPLATE_LANGUAGE's two arms (zh stores ride the EN template).
 */
export function describeClaimWindow(
	minutes: number,
	lang: "en" | "ms" = "en",
): string {
	if (minutes % (24 * 60) === 0) {
		const days = minutes / (24 * 60);
		if (lang === "ms") return days === 1 ? "24 jam" : `${days} hari`;
		return days === 1 ? "24 hours" : `${days} days`;
	}
	if (minutes % 60 === 0) {
		const hours = minutes / 60;
		if (lang === "ms") return `${hours} jam`;
		return hours === 1 ? "1 hour" : `${hours} hours`;
	}
	return lang === "ms" ? `${minutes} minit` : `${minutes} minutes`;
}
