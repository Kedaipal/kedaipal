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

/** Whole days left in trial (rounded up, never negative). */
export function trialDaysLeft(
	trialEndsAt: number | undefined,
	now: number,
): number {
	if (trialEndsAt === undefined) return 0;
	return Math.max(0, Math.ceil((trialEndsAt - now) / DAY_MS));
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
