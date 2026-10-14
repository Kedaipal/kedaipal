import type { AdminAutoChargeState } from "../../convex/lib/hitpayBilling";
import { formatPrice, formatShortDate } from "./format";

/**
 * A Convex action runs for at most 10 minutes, so an attempt stamp older than
 * this is no longer a charge in flight — its outcome was lost. Younger ones
 * are simply charging, and saying "unconfirmed" there would cry wolf.
 */
export const IN_FLIGHT_GRACE_MS = 10 * 60 * 1000;

export type AutoChargeTone = "stopped" | "unconfirmed" | "failed" | "healthy";

export type AutoChargeDescription = {
	tone: AutoChargeTone;
	pill: string;
	/** What it means and what happens next — null when there is nothing to
	 * say. */
	detail: string | null;
	/** Stopped only: the headline fact, read before the instructions. */
	lead?: string;
	/** Stopped only: the HitPay reference the admin pastes into HitPay's
	 * dashboard to find the charge. */
	reference?: string;
};

/**
 * How the admin console reads a store's auto-charging — ONE reading for both
 * admin lists (pending bills + the auto-renewal overview), so the same store
 * can never be described two ways. Precedence is by who has to act:
 * stopped (a human must) > unconfirmed (the system is checking with HitPay)
 * > failed (dunning runs itself) > healthy.
 */
export function describeAutoCharge(
	state: AdminAutoChargeState,
	now: number,
): AutoChargeDescription {
	if (state.stranded) {
		const s = state.stranded;
		return {
			tone: "stopped",
			pill: "Auto-charge stopped",
			lead: `HitPay took ${formatPrice(s.amountSen, s.currency)} for voided ${s.invoiceNumber} — never recorded here.`,
			detail:
				"Decide with the seller: refund it in HitPay, or apply it by marking their open bill paid. Auto-charging resumes once a bill is settled.",
			reference: s.paymentId,
		};
	}
	if (
		state.unresolvedAttemptAt !== undefined &&
		now - state.unresolvedAttemptAt > IN_FLIGHT_GRACE_MS
	) {
		const error = state.lastChargeError ? ` (${state.lastChargeError})` : "";
		const next =
			state.nextRetryAt !== undefined
				? `The retry on ${formatShortDate(state.nextRetryAt)}`
				: "The next daily run";
		return {
			tone: "unconfirmed",
			pill: "Charge unconfirmed",
			detail: `A charge on ${formatShortDate(state.unresolvedAttemptAt)} never got an answer from HitPay${error}. ${next} asks HitPay first, so it can't charge twice.`,
		};
	}
	if (state.failedAttempts > 0) {
		const error = state.lastChargeError
			? `Last error: ${state.lastChargeError}. `
			: "";
		return {
			tone: "failed",
			pill: `Auto-charge failed ×${state.failedAttempts}`,
			detail:
				state.nextRetryAt !== undefined
					? `${error}Next retry ${formatShortDate(state.nextRetryAt)}.`
					: `${error}Retries exhausted — the seller is on the manual rail.`,
		};
	}
	return { tone: "healthy", pill: "Auto-renew", detail: null };
}
