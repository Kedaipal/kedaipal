// Pure helpers for rendering subscription state in the dashboard chrome (tier
// pill, banner, plan-feature gates). Mirrors the server `AccessState` shape
// carried on `getMyRetailer().subscription`. See docs/manual-subscription.md.

import { isUnlimited, type PlanFeature } from "../../convex/lib/plans";

const DAY_MS = 24 * 60 * 60 * 1000;

export type SubscriptionView = {
	plan: "starter" | "pro" | "scale";
	status: "trialing" | "active" | "past_due" | "cancelled";
	comped?: boolean;
	trialEndsAt?: number;
	caps?: { orderCap: number; userCap: number; broadcastQuota: number };
	features?: Record<PlanFeature, boolean>;
};

/**
 * Client-side mirror of the server plan-feature gate (`assertPlanFeature`) —
 * drives the upgrade walls + hidden inbox controls. Fail-open on a missing
 * subscription/features (same fail-safe as `resolveAccess`): the server gate
 * is the real lock, this only decides what to render.
 */
export function hasFeature(
	sub: SubscriptionView | undefined,
	feature: PlanFeature,
): boolean {
	if (!sub?.features) return true;
	return sub.features[feature];
}

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

/**
 * Whether the retailer has converted from the free trial to a paid plan — the
 * gate for "onboarding complete" in the dashboard setup checklist. True once
 * they leave `trialing` (active / past_due / cancelled all imply a first payment
 * was made, or they're no longer a trial prospect to nudge) or are `comped`
 * (pilots never pay, so they're never asked to subscribe). A missing
 * subscription fails open to subscribed — same fail-safe as `resolveAccess`.
 */
export function hasSubscribed(sub: SubscriptionView | undefined): boolean {
	if (!sub) return true;
	return sub.comped === true || sub.status !== "trialing";
}

export const PAYMENT_WARN_DAYS = 5;

/** Fraction of the monthly order cap at which the soft nudge starts. */
export const ORDER_CAP_WARN_RATIO = 0.8;

/**
 * Where this month's order count sits against the plan's SOFT cap. Pure — the
 * meter (`ordersThisMonth`) comes from the retailer payload. Orders are never
 * blocked; "over" only escalates the upgrade nudge. Comped subs and
 * unlimited/missing caps never nudge.
 */
export type OrderCapState =
	| { kind: "none" }
	| { kind: "near"; used: number; cap: number }
	| { kind: "over"; used: number; cap: number };

export function orderCapState(
	sub: SubscriptionView | undefined,
	ordersThisMonth: number | undefined,
): OrderCapState {
	if (!sub || sub.comped) return { kind: "none" };
	const cap = sub.caps?.orderCap;
	if (
		cap === undefined ||
		cap <= 0 ||
		isUnlimited(cap) ||
		ordersThisMonth === undefined
	)
		return { kind: "none" };
	if (ordersThisMonth >= cap)
		return { kind: "over", used: ordersThisMonth, cap };
	if (ordersThisMonth >= Math.ceil(cap * ORDER_CAP_WARN_RATIO))
		return { kind: "near", used: ordersThisMonth, cap };
	return { kind: "none" };
}

/**
 * What the dashboard subscription banner should show. Pure so it's unit-tested.
 * Precedence: a real `past_due` lock → a soon-due **pending invoice** (the most
 * concrete "pay me" — applies whether trialing or active) → a trial ending soon
 * → the soft order-cap nudge (over, then near — upsell ranks below any payment
 * deadline). Comped/paid-with-nothing-due → nothing. `pendingDueAt` is the
 * soonest pending invoice's due date (undefined when none); `ordersThisMonth`
 * is the usage meter (undefined → no cap nudge).
 */
export type BannerState =
	| { kind: "none" }
	| { kind: "pastDue" }
	| { kind: "invoiceWarn"; daysLeft: number }
	| { kind: "trialWarn"; daysLeft: number; ended: boolean }
	| { kind: "orderCapOver"; used: number; cap: number }
	| { kind: "orderCapNear"; used: number; cap: number };

export function resolveBannerState(
	sub: SubscriptionView | undefined,
	pendingDueAt: number | undefined,
	now: number,
	warnDays = PAYMENT_WARN_DAYS,
	ordersThisMonth?: number,
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

	const cap = orderCapState(sub, ordersThisMonth);
	if (cap.kind === "over")
		return { kind: "orderCapOver", used: cap.used, cap: cap.cap };
	if (cap.kind === "near")
		return { kind: "orderCapNear", used: cap.used, cap: cap.cap };

	return { kind: "none" };
}

export type TierTone = "neutral" | "trial" | "warn" | "founding" | "admin";

export type TierPill = { label: string; tone: TierTone };

/** Compact tier label for the nav pill. With a `foundingRank`, founding members
 * read "Founding #N · 28 days left" / "Founding #N" instead of a plain "Trial".
 * When `isAdmin` is set (a Kedaipal admin viewing their OWN store), the pill reads
 * "Admin" instead of any trial/plan/past-due state — admins run the app for free
 * and are never soft-locked, so a "days left" countdown would be a lie. */
export function tierPill(
	sub: SubscriptionView,
	now: number,
	foundingRank?: number,
	isAdmin = false,
): TierPill {
	if (isAdmin) return { label: "Admin", tone: "admin" };
	const fm = foundingRank ? `Founding #${foundingRank}` : null;
	switch (sub.status) {
		case "trialing": {
			const days = trialDaysLeft(sub.trialEndsAt, now);
			const ended = days <= 0;
			const left = ended
				? "trial ended"
				: `${days} day${days === 1 ? "" : "s"} left`;
			if (fm) {
				return {
					label: `${fm} · ${left}`,
					tone: ended ? "warn" : "founding",
				};
			}
			return {
				label: ended ? "Trial ended" : `Trial · ${left}`,
				tone: ended ? "warn" : "trial",
			};
		}
		case "past_due":
			return { label: fm ? `${fm} · Past due` : "Past due", tone: "warn" };
		case "cancelled":
			return { label: fm ? `${fm} · Cancelled` : "Cancelled", tone: "warn" };
		default:
			return {
				label: fm ?? PLAN_LABEL[sub.plan],
				tone: fm ? "founding" : "neutral",
			};
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
