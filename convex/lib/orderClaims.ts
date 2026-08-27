/**
 * Claim links (86eyq0epn) — pure rules shared by the server (convex/orderClaims.ts)
 * and the client (send dialog, claims list, buyer claim page), so the two sides
 * can never disagree about a window, a cooldown, or whether a claim is still
 * alive. No Convex imports — unit-testable in isolation.
 *
 * The timer semantics (locked with Zaki, 26–27 Aug 2026):
 *  - Before commit, the window gates buyer COMPLETION: an expired link kills
 *    the locked price and the checkout.
 *  - At commit the SAME deadline carries onto the order as `paymentDueAt`
 *    (floored to a payment runway) and keeps running until real money — the
 *    Agoda model; see the payment-deadline section at the bottom of this file.
 *  - Resend NEVER resets the deadline — same link, same clock.
 *  - Resend is cooled down + capped so a seller can't spam the buyer's WhatsApp.
 */

/**
 * Selectable windows in the send dialog (minutes). 10/15 min = live-drop
 * urgency, 24 h = the ticket's default for DM/phone orders.
 *
 * Note what a SHORT window actually buys: it compresses the time to COMPLETE
 * the checkout, not the whole hold — payment always gets
 * `CLAIM_PAYMENT_RUNWAY_MS` from commit (you cannot ask someone to open a
 * bank app and pay in 60 seconds). That is why the 5-minute floor is a bound
 * and not a chip: at 5 minutes the runway dominates entirely, so the chip
 * would promise an urgency the system doesn't deliver. The dialog copy says
 * this in the seller's words.
 */
export const CLAIM_WINDOW_CHOICES_MINUTES = [10, 15, 60, 24 * 60] as const;

/**
 * Origin chips in the send dialog — where the buyer came from, in the
 * seller's own words. Deliberately short: a claim link's realistic origins
 * are a live, a DM, or "someone rang me". Keys are `attributionBucket` keys
 * (KNOWN_SOURCE_LABELS in convex/lib/attribution.ts owns their display
 * names); `undefined` = untagged, which buckets "direct" like any
 * unattributed order.
 */
export const CLAIM_SOURCE_CHOICES = [
	"tiktok-live",
	"instagram-live",
	"facebook-live",
	"whatsapp",
] as const;

/**
 * The default for a store that has never sent a claim (after that, the
 * seller's own last choice is remembered and this stops applying).
 *
 * 15 minutes, not the ticket's 24 h: the flagship case is a live drop, where
 * an all-day hold on live-priced stock is the opposite of what the seller
 * wants — and the whole point of the deadline is that stock comes back. A
 * seller doing DM quotes reaches for 24 h once and never thinks about it
 * again, which is the cheaper direction to be wrong in.
 */
export const DEFAULT_CLAIM_WINDOW_MINUTES = 15;

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

// ---------------------------------------------------------------------------
// The payment deadline (the timer carried onto the order — Zaki, 27 Aug 2026)
// ---------------------------------------------------------------------------
// Stock decrements at claim COMMIT, so an unpaid committed order holds real
// inventory. The claim's window therefore doesn't die at commit: it carries
// onto the order as `orders.paymentDueAt` (the Agoda model — the hold runs
// until money), and a sweep auto-cancels a due order so the stock comes back.
// The rule that keeps it honest: THE CLOCK ONLY RUNS WHILE THE BUYER CAN
// ACTUALLY PAY, and any moment payment starts or becomes possible guarantees
// a minimum runway.

/** The minimum time a buyer always has to actually PAY — floors the deadline
 * at commit (a buyer who spent 14 of 15 minutes on the form still gets a real
 * chance), and re-arms it whenever payment starts (a HitPay checkout mint) or
 * first becomes possible (a fee-pending order getting its fee). */
export const CLAIM_PAYMENT_RUNWAY_MS = 15 * 60 * 1000;

/** How long after a HitPay checkout mint the sweep keeps its hands off —
 * matches the request's ~1h life at HitPay, so a buyer sitting on the hosted
 * page can't be cancelled mid-payment (money landing on a cancelled order is
 * the worst outcome this feature can produce; the gatewayPaymentIssue
 * machinery would catch it, but that's a safety net, not a plan). */
export const GATEWAY_SESSION_GRACE_MS = 60 * 60 * 1000;

/** The deadline stamped at claim commit: the claim's own deadline, floored to
 * a full runway — the timer visibly CONTINUES from the claim page, it never
 * shortens below "enough time to actually pay". */
export function paymentDueAtCommit(
	claimExpiresAt: number,
	now: number,
): number {
	return Math.max(claimExpiresAt, now + CLAIM_PAYMENT_RUNWAY_MS);
}

/** Bounded extension when a payment session starts / payment becomes possible.
 * Never shortens, never freezes indefinitely (a freeze would be exploitable:
 * tap Pay, close the tab, hold the stock forever). The buyer sees the clock
 * jump — visible and honest. */
export function extendedPaymentDue(currentDueAt: number, now: number): number {
	return Math.max(currentDueAt, now + CLAIM_PAYMENT_RUNWAY_MS);
}

/**
 * May the sweep cancel this order right now? The single author — the cron and
 * the tests judge with the same predicate. Every `false` arm is a deliberate
 * protection, not an optimization:
 *  - no deadline / not yet due — nothing to do;
 *  - `claimed` — the buyer says they've paid; a human verifies. A false claim
 *    pauses the clock, yes — but it escalates to the seller (who checks the
 *    bank and rejects it, at which point the already-past deadline makes the
 *    next sweep cancel). Cancelling a TRUE claim would burn a paid buyer.
 *  - `received` — paid; the deadline should already be cleared (belt+braces);
 *  - past pending/confirmed — the seller started fulfilling an unpaid order
 *    on purpose; a robot must not un-decide that;
 *  - `deliveryFeePending` — the buyer CANNOT pay until the seller prices it;
 *  - `gatewayPaymentIssue` — money already moved oddly; a human is sorting it;
 *  - live gateway session — the buyer may be mid-payment on HitPay's page.
 */
export function isAutoCancelDue(
	order: {
		paymentDueAt?: number;
		status: string;
		paymentStatus?: string;
		deliveryFeePending?: boolean;
		gatewayPaymentIssue?: unknown;
		gatewayRequestedAt?: number;
	},
	now: number,
): boolean {
	if (order.paymentDueAt === undefined || now <= order.paymentDueAt)
		return false;
	if (order.status !== "pending" && order.status !== "confirmed") return false;
	if ((order.paymentStatus ?? "unpaid") !== "unpaid") return false;
	if (order.deliveryFeePending === true) return false;
	if (order.gatewayPaymentIssue !== undefined && order.gatewayPaymentIssue !== null)
		return false;
	if (
		order.gatewayRequestedAt !== undefined &&
		now - order.gatewayRequestedAt < GATEWAY_SESSION_GRACE_MS
	)
		return false;
	return true;
}
