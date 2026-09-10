// Pure helpers for rendering subscription state in the dashboard chrome (tier
// pill, banner, plan-feature gates). Mirrors the server `AccessState` shape
// carried on `getMyRetailer().subscription`. See docs/manual-subscription.md.

import { isUnlimited, type PlanFeature } from "../../convex/lib/plans";

const DAY_MS = 24 * 60 * 60 * 1000;

export type SubscriptionView = {
	plan: "starter" | "pro" | "scale";
	status: "trialing" | "active" | "past_due" | "cancelled" | "on_hold";
	/** Optional on the mirror (the server always sends it) so a payload rendered
	 * from an older cache degrades to "monthly" rather than throwing. */
	billingCycle?: "monthly" | "annual";
	comped?: boolean;
	/** The free period's backstop deadline (signup + 14 days). */
	trialEndsAt?: number;
	/** Start-when-you-sell (z8r3fday24): set once the free period ended (first
	 * live order or backstop) and the first invoice was issued. */
	freePeriodEndedAt?: number;
	freePeriodEndReason?: "first_order" | "backstop";
	/** Off-Season Hold (z8r3fday24): paused between seasons. */
	held?: boolean;
	heldAt?: number;
	periodPaidBy?: "plan" | "hold";
	currentPeriodEnd?: number;
	caps?: { orderCap: number; userCap: number; broadcastQuota: number };
	features?: Record<PlanFeature, boolean>;
	/** Saved-method auto-renewal summary (86eyb6z4r) — owner payload only. */
	autoRenew?: {
		method: string;
		methodLabel: string;
		failedAttempts: number;
		failing: boolean;
		nextChargeAt?: number;
	};
	autoRenewSetupPending?: boolean;
	foundingIntent?: boolean;
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

/**
 * One truth for "must the CRM stay un-rendered AND un-queried for this
 * dashboard payload?" — Starter plan, not admin act-as, payload loaded.
 * Shared by every route that touches a Pro-gated `api.customers.*` query
 * (customers list/detail, order detail's CRM context line).
 *
 * Call sites must skip the query while the payload is still LOADING too
 * (`retailer && !isCrmLocked(retailer) ? args : "skip"`) — this helper stays
 * false then so upgrade walls never flash mid-load, but firing a Pro-gated
 * query before the plan is known trips the server gate, and a route-level
 * useQuery throw takes the whole page down (the Starter order-detail crash,
 * fixed on 86eyeea1n).
 */
export function isCrmLocked(
	retailer:
		| { actingAsAdmin?: boolean; subscription?: SubscriptionView }
		| null
		| undefined,
): boolean {
	return (
		!!retailer &&
		!retailer.actingAsAdmin &&
		!hasFeature(retailer.subscription, "crm")
	);
}

/**
 * True when this seller cannot use the ORDER INBOX filters (Starter, not admin
 * act-as) — the same shape as `isCrmLocked`, for the same reason: a control
 * that silently does nothing is worse than one that isn't offered. Used by the
 * order detail's "Came from" row, whose drill-down applies an inbox filter
 * (86eyq0eq9); on Starter the origin still shows, just as plain text.
 */
export function isOrderInboxLocked(
	retailer:
		| { actingAsAdmin?: boolean; subscription?: SubscriptionView }
		| null
		| undefined,
): boolean {
	return (
		!!retailer &&
		!retailer.actingAsAdmin &&
		!hasFeature(retailer.subscription, "orderInbox")
	);
}

/** Canonical short tier labels (Starter/Pro/Scale) for the nav pill + billing UI. */
export const PLAN_LABEL: Record<SubscriptionView["plan"], string> = {
	starter: "Starter",
	pro: "Pro",
	scale: "Scale",
};

/** Whole days until a future timestamp (rounded up, never negative). */
export function daysUntil(ts: number | undefined, now: number): number {
	if (ts === undefined) return 0;
	return Math.max(0, Math.ceil((ts - now) / DAY_MS));
}

/** Whole days left until the free period's BACKSTOP (rounded up, never
 * negative). The period usually ends earlier, at the first live order — see
 * `freePeriodState`. */
export function trialDaysLeft(
	trialEndsAt: number | undefined,
	now: number,
): number {
	return daysUntil(trialEndsAt, now);
}

/**
 * Where a trialing store is in its free period (start-when-you-sell,
 * z8r3fday24). `free`: still free, `daysLeft` to the backstop. `ended`: the
 * first invoice has been issued — by the first order or the backstop — and
 * that invoice's due date is now the clock (the pending invoice, not this
 * helper, says how long is left). Non-trialing rows are `none`.
 */
export type FreePeriodState =
	| { kind: "none" }
	| { kind: "free"; daysLeft: number }
	| { kind: "ended"; reason: "first_order" | "backstop" };

export function freePeriodState(
	sub: SubscriptionView | undefined,
	now: number,
): FreePeriodState {
	if (!sub || sub.status !== "trialing") return { kind: "none" };
	if (sub.freePeriodEndedAt !== undefined)
		return { kind: "ended", reason: sub.freePeriodEndReason ?? "backstop" };
	return { kind: "free", daysLeft: trialDaysLeft(sub.trialEndsAt, now) };
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
	| { kind: "autoRenewFailed" }
	| { kind: "invoiceWarn"; daysLeft: number }
	/** Off-Season Hold: ordering is paused — a calm, persistent reminder. */
	| { kind: "held" }
	/** Start-when-you-sell: the free period ended. With a pending invoice,
	 * `daysLeft` counts to its due date; without one (the minutes before the
	 * machine writes it, or a voided bill awaiting the cron's rewrite) it is
	 * absent — "your first invoice is on its way". */
	| {
			kind: "firstInvoice";
			reason: "first_order" | "backstop";
			daysLeft?: number;
	  }
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

	// A declined auto-charge outranks the generic invoice countdown: it names
	// the actual problem (the saved method) and its fix, while access is still
	// on. Persistent, not dismissable — it clears when the invoice settles.
	if (sub.autoRenew?.failing) return { kind: "autoRenewFailed" };

	if (pendingDueAt !== undefined) {
		const daysLeft = daysUntil(pendingDueAt, now);
		if (daysLeft <= warnDays) return { kind: "invoiceWarn", daysLeft };
	}

	// A paused store: below every payment deadline (a hold invoice due soon is
	// still "pay me"), above the free-period + cap nudges (neither applies).
	if (sub.status === "on_hold" || sub.held) return { kind: "held" };

	if (sub.status === "trialing") {
		const free = freePeriodState(sub, now);
		if (free.kind === "ended") {
			// The first invoice is the clock now. While it pends (and isn't yet
			// inside the invoiceWarn window above) — a soft "it's ready" nudge.
			// No invoice on file at all (voided / failed) → the old ended state,
			// until the cron writes it again.
			if (pendingDueAt !== undefined)
				return {
					kind: "firstInvoice",
					reason: free.reason,
					daysLeft: daysUntil(pendingDueAt, now),
				};
			// No invoice on file yet (the minutes-long issue delay, or a voided
			// bill the cron will rewrite) → "on its way", never the red ended
			// state: the machine writes the bill, the seller has nothing to fix.
			return { kind: "firstInvoice", reason: free.reason };
		}
		if (free.kind === "free" && free.daysLeft <= warnDays)
			return { kind: "trialWarn", daysLeft: free.daysLeft, ended: false };
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

/** How many days before the backstop the pill switches from "until your first
 * order" to a countdown — the same window the banner warns in. */
const PILL_COUNTDOWN_DAYS = PAYMENT_WARN_DAYS;

/** Compact tier label for the nav pill. A free store reads "Free · until first
 * order" (start-when-you-sell — the order is the trigger, the day-14 backstop
 * only surfaces as a countdown in its last days); once the first invoice is
 * out it reads "First invoice due". With a `foundingRank`, founding members
 * read "Founding #N · …" instead. A held store reads "On hold". When `isAdmin`
 * is set (a Kedaipal admin viewing their OWN store), the pill reads "Admin"
 * instead of any state — admins run the app for free and are never
 * soft-locked, so a countdown would be a lie. */
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
			const free = freePeriodState(sub, now);
			if (free.kind === "ended") {
				return {
					label: fm ? `${fm} · First invoice due` : "First invoice due",
					tone: "warn",
				};
			}
			const days = free.kind === "free" ? free.daysLeft : 0;
			const left =
				days <= PILL_COUNTDOWN_DAYS
					? `${days} day${days === 1 ? "" : "s"} left`
					: "until first order";
			if (fm) return { label: `${fm} · ${left}`, tone: "founding" };
			return { label: `Free · ${left}`, tone: "trial" };
		}
		case "on_hold":
			return { label: fm ? `${fm} · On hold` : "On hold", tone: "trial" };
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

/** Whether the dashboard should surface a "pay your invoice" nudge. True once
 * the first invoice is out, while the free period's backstop is in its last
 * stretch, or once past due. */
export function shouldNudgePayment(
	sub: SubscriptionView,
	now: number,
	trialNudgeDaysLeft = 3,
): boolean {
	if (sub.status === "past_due") return true;
	if (sub.status === "trialing") {
		const free = freePeriodState(sub, now);
		if (free.kind === "ended") return true;
		return free.kind === "free" && free.daysLeft <= trialNudgeDaysLeft;
	}
	return false;
}
