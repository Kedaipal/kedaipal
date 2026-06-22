// Pure helpers for rendering subscription state in the dashboard chrome (tier
// pill, banner). Mirrors the server `AccessState` shape carried on
// `getMyRetailer().subscription`. See docs/manual-subscription.md.

const DAY_MS = 24 * 60 * 60 * 1000;

export type SubscriptionView = {
	plan: "starter" | "pro" | "scale";
	status: "trialing" | "active" | "past_due" | "cancelled";
	comped?: boolean;
	trialEndsAt?: number;
};

const PLAN_LABEL: Record<SubscriptionView["plan"], string> = {
	starter: "Starter",
	pro: "Pro",
	scale: "Scale",
};

/** Whole days until a future timestamp (rounded up, never negative). */
export function daysUntil(ts: number | undefined, now: number): number {
	if (ts === undefined) return 0;
	return Math.max(0, Math.ceil((ts - now) / DAY_MS));
}

/** Whole days left in trial (rounded up, never negative). */
export function trialDaysLeft(
	trialEndsAt: number | undefined,
	now: number,
): number {
	return daysUntil(trialEndsAt, now);
}

export const PAYMENT_WARN_DAYS = 5;

/**
 * What the dashboard subscription banner should show. Pure so it's unit-tested.
 * Precedence: a real `past_due` lock → a soon-due **pending invoice** (the most
 * concrete "pay me" — applies whether trialing or active) → a trial ending soon.
 * Comped/paid-with-nothing-due → nothing. `pendingDueAt` is the soonest pending
 * invoice's due date (undefined when none).
 */
export type BannerState =
	| { kind: "none" }
	| { kind: "pastDue" }
	| { kind: "invoiceWarn"; daysLeft: number }
	| { kind: "trialWarn"; daysLeft: number; ended: boolean };

export function resolveBannerState(
	sub: SubscriptionView | undefined,
	pendingDueAt: number | undefined,
	now: number,
	warnDays = PAYMENT_WARN_DAYS,
): BannerState {
	if (!sub || sub.comped) return { kind: "none" };
	if (sub.status === "past_due") return { kind: "pastDue" };

	if (pendingDueAt !== undefined) {
		const daysLeft = daysUntil(pendingDueAt, now);
		if (daysLeft <= warnDays) return { kind: "invoiceWarn", daysLeft };
	}

	if (sub.status === "trialing") {
		const daysLeft = trialDaysLeft(sub.trialEndsAt, now);
		if (daysLeft <= warnDays)
			return { kind: "trialWarn", daysLeft, ended: daysLeft <= 0 };
	}

	return { kind: "none" };
}

export type TierTone = "neutral" | "trial" | "warn";

export type TierPill = { label: string; tone: TierTone };

/** Compact tier label for the nav pill — "Pro", "Trial · 5 days left", "Past due". */
export function tierPill(sub: SubscriptionView, now: number): TierPill {
	switch (sub.status) {
		case "trialing": {
			const days = trialDaysLeft(sub.trialEndsAt, now);
			return {
				label:
					days <= 0
						? "Trial ended"
						: `Trial · ${days} day${days === 1 ? "" : "s"} left`,
				tone: days <= 0 ? "warn" : "trial",
			};
		}
		case "past_due":
			return { label: "Past due", tone: "warn" };
		case "cancelled":
			return { label: "Cancelled", tone: "warn" };
		default:
			return { label: PLAN_LABEL[sub.plan], tone: "neutral" };
	}
}

/** Whether the dashboard should surface a "pay your invoice" nudge. True while a
 * trial is in its last stretch or once it's past due. */
export function shouldNudgePayment(
	sub: SubscriptionView,
	now: number,
	trialNudgeDaysLeft = 3,
): boolean {
	if (sub.status === "past_due") return true;
	if (sub.status === "trialing")
		return trialDaysLeft(sub.trialEndsAt, now) <= trialNudgeDaysLeft;
	return false;
}
