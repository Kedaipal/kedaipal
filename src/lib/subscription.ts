// Pure helpers for rendering subscription state in the dashboard chrome (tier
// pill, banner, plan-feature gates). Mirrors the server `AccessState` shape
// carried on `getMyRetailer().subscription`. See docs/manual-subscription.md.

import type { CompKind } from "../../convex/lib/comp";
import type {
	BillingCurrency,
	ListedPlan,
	Plan,
	PlanFeature,
} from "../../convex/lib/plans";
import { type CreditUnlockRoute, creditTone } from "./credits-ui";

const DAY_MS = 24 * 60 * 60 * 1000;

export type SubscriptionView = {
	plan: Plan;
	status: "trialing" | "active" | "past_due" | "cancelled" | "on_hold";
	/** Optional on the mirror (the server always sends it) so a payload rendered
	 * from an older cache degrades to "monthly" rather than throwing. */
	billingCycle?: "monthly" | "annual";
	comped?: boolean;
	/** Admin-granted comp (z8r3fdeub2) — seller-facing slice only: the sponsor
	 * label for the billing tab's "Sponsored by X" line. Comps have no end date.
	 * Absent on legacy/fail-open comped rows. */
	comp?: { kind: CompKind; label?: string };
	/** Set while an expired seller's lock came from an admin turning their comp
	 * upgrade off (z8r3fdeub2), not from an unpaid bill. Only meaningful with
	 * `status: "past_due"`. */
	compEnded?: { at: number };
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
	/** Saved-method auto-renewal summary (86eyb6z4r) — owner payload only.
	 * `stopped`: auto-charging is stopped over a stranded charge — nothing
	 * charges until a bill is settled (docs/hitpay-recurring.md). */
	autoRenew?: {
		method: string;
		methodLabel: string;
		failedAttempts: number;
		failing: boolean;
		stopped: boolean;
		/** A charge was sent and its outcome is still being confirmed —
		 * never promise a charge or invite a manual payment while true. */
		confirming: boolean;
		nextChargeAt?: number;
	};
	autoRenewSetupPending?: boolean;
	/** Never price from this — see `billingGatewayAvailable.foundingPricing`. */
	foundingIntent?: boolean;
	/** A downgrade taking effect at the end of the paid period (86eyb6z4r). */
	pendingPlanChange?: {
		plan: ListedPlan;
		effectiveAt: number;
	};
	/** The Enterprise contract's seller-facing terms (Credits T6), present
	 * iff `plan` is `enterprise` — never the contact, notes or who set it. */
	enterprise?: {
		baseFeeMinor: number;
		currency: BillingCurrency;
		includedCredits: number;
		overageRateMinor: number;
		blockSize: number;
	};
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

/**
 * True when this dashboard is VIEW-ONLY (z8r3fdeub2, 19 Sep 2026): the store's
 * subscription lapsed — an unpaid invoice, or an admin turning its comp upgrade
 * off — so the server refuses every seller write, orders included. Same shape
 * and same fail-open posture as `isCrmLocked`: a payload still loading, or one
 * with no subscription at all, reads as NOT locked, because a control that
 * flickers disabled mid-load is worse than one that refuses a tap.
 *
 * `actingAsAdmin` and `isAdmin` mirror the server's two bypasses — white-glove
 * support on a lapsed store keeps working, and an admin's own store is never
 * billed (see `assertSubscriptionActive`).
 */
export function isStoreReadOnly(
	retailer:
		| { actingAsAdmin?: boolean; subscription?: SubscriptionView }
		| null
		| undefined,
	isAdmin = false,
): boolean {
	if (!retailer || retailer.actingAsAdmin || isAdmin) return false;
	const sub = retailer.subscription;
	return sub?.status === "past_due" && sub.comped !== true;
}

/**
 * The one sentence every view-only surface says — the banner, a disabled
 * control's note, the toast if a tap gets through. Deliberately the same shape
 * as the server's `ConvexError`, so a seller who sees both reads one message
 * twice rather than two rules.
 */
export function storeReadOnlyReason(
	sub: SubscriptionView | undefined,
	/** A TEAMMATE can't settle the bill and can't open Billing (86exr91r4), so
	 * they get the fact and who to ask — never an instruction they can't act on. */
	isMember = false,
): string {
	if (isMember)
		return sub?.compEnded
			? "This store's sponsored access has ended, so the dashboard is view-only until the owner picks a plan."
			: "This store's subscription is past due, so the dashboard is view-only until the owner renews.";
	return sub?.compEnded
		? "Your sponsored access has ended, so your store is view-only. Choose a plan to start working again."
		: "Your subscription is past due, so your store is view-only. Pay your invoice to start working again.";
}

/** Canonical short tier labels (Starter/Pro/Enterprise) for the nav pill +
 * billing UI. */
export const PLAN_LABEL: Record<SubscriptionView["plan"], string> = {
	starter: "Starter",
	pro: "Pro",
	enterprise: "Enterprise",
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

/**
 * True while the paid period has run out but the renewal has not settled yet.
 *
 * A narrow window — the daily cron issues the renewal (and auto-charges a saved
 * method) within a day of the lapse — but the seller keeps full access through
 * it by design, so `status` is still "active" while `currentPeriodEnd` is in
 * the past. Rendered naively that reads "Active · expires 29 Aug 2026" beside
 * "Next charge on 29 Aug 2026", both dates already gone (Zaki, 13 Sep 2026).
 *
 * Lives here rather than in either card so the plan pill and the auto-renewal
 * line can never disagree about whether a seller is in it.
 */
export function isRenewing(
	sub: SubscriptionView | undefined,
	now: number,
): boolean {
	return (
		sub !== undefined &&
		sub.comped !== true &&
		sub.status === "active" &&
		sub.currentPeriodEnd !== undefined &&
		sub.currentPeriodEnd <= now
	);
}

export const PAYMENT_WARN_DAYS = 5;

/**
 * What the dashboard subscription banner should show. Pure so it's unit-tested.
 * Precedence: a real `past_due` lock → OUT OF CREDITS (Credits T3 — it blocks
 * work right now, so it outranks every deadline) → a declined auto-charge → a
 * soon-due **pending invoice** (the most concrete "pay me" — applies whether
 * trialing or active) → Off-Season Hold → the free period → credits running
 * LOW (the lowest nudge, like the soft order cap it replaced). Comped →
 * nothing (never locked, never nudged). A store whose comp was turned off
 * (z8r3fdeub2) reads `compEnded` instead of `pastDue` — no bill sits behind
 * that lock. `pendingDueAt` is the soonest pending invoice's due date
 * (undefined when none); `credits` is the lock state from the dashboard
 * payload plus, for someone who can see credits, the balance.
 */
export type BannerState =
	| { kind: "none" }
	| { kind: "pastDue" }
	/** An expired seller whose lock came from their comp being turned off
	 * (z8r3fdeub2): same lock as past-due, but there is no bill to pay — they
	 * choose a plan. */
	| { kind: "compEnded" }
	/** Auto-charging stopped over a stranded charge: an earlier charge landed
	 * after its bill was voided, and a human is sorting the money out. */
	| { kind: "autoRenewStopped" }
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
	/** Credits T3: out of credits — accepting/updating orders and editing
	 * products are paused; orders keep arriving. Persistent. */
	| {
			kind: "creditsLocked";
			ordersWaiting: number;
			route: CreditUnlockRoute;
	  }
	/** Credits T3: into the last 20% of the month's credits (`lowCreditLine`
	 * — the meter's amber and the low email's line). Dismissable. */
	| { kind: "creditsLow"; total: number };

/** What the banner knows about credits. `locked` + `route` + `ordersWaiting`
 * ride the dashboard payload for everyone; the balance only for someone who
 * can see credits (undefined → no low nudge). */
export type BannerCredits = {
	locked: boolean;
	route: CreditUnlockRoute;
	ordersWaiting: number;
	total?: number;
	periodGrant?: number;
	customGrant?: boolean;
	/** A store that can never be locked (an admin's own, a sponsored one) —
	 * it has nothing to run low on, so it's never nudged. */
	exempt?: boolean;
};

export function resolveBannerState(
	sub: SubscriptionView | undefined,
	pendingDueAt: number | undefined,
	now: number,
	warnDays = PAYMENT_WARN_DAYS,
	credits?: BannerCredits,
): BannerState {
	// A comp has no bill, trial, cap or end date, and is never locked or
	// nudged for credits — nothing to warn about.
	if (!sub || sub.comped) return { kind: "none" };
	if (sub.status === "past_due")
		return sub.compEnded ? { kind: "compEnded" } : { kind: "pastDue" };

	// Out of credits blocks work NOW — above every deadline below, and above
	// the saved-method banners: those are about how the next bill gets paid,
	// this is about orders not being taken today.
	if (credits?.locked)
		return {
			kind: "creditsLocked",
			ordersWaiting: credits.ordersWaiting,
			route: credits.route,
		};

	// Stopped outranks declined: it is the CURRENT truth about the saved
	// method (nothing will charge it), and it changes what the seller should
	// do — "pay it yourself" could make them pay twice while we sort out an
	// earlier charge. Clears when any bill settles.
	if (sub.autoRenew?.stopped) return { kind: "autoRenewStopped" };

	// A charge being CONFIRMED silences every pay-me banner: both the
	// declined banner and the due-soon countdown say "pay it yourself", and
	// that is the double payment while the sent charge may have landed. The
	// auto-renewal card carries the explanation; resolution is ≤ a daily
	// sweep away, after which the right banner (if any) returns.
	if (sub.autoRenew?.confirming) return { kind: "none" };

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

	// `low` OR `out`. While the lock is on, `creditsLocked` above catches the
	// zero-and-below store — but that branch reads `credits.locked`, and with
	// the lock switched off (CREDIT_LOCK_ENABLED) it never fires, which left a
	// store already into next month's credits with no banner at all. The two
	// tones share one banner whose lead-in names which it is; when the lock
	// returns, `creditsLocked` outranks this again and nothing here changes.
	if (
		credits?.total !== undefined &&
		credits.periodGrant !== undefined &&
		!credits.customGrant &&
		!credits.exempt &&
		creditTone(credits.total, credits.periodGrant) !== "ok"
	)
		return { kind: "creditsLow", total: credits.total };

	return { kind: "none" };
}

export type TierTone =
	| "neutral"
	| "trial"
	| "warn"
	| "founding"
	| "admin"
	| "sponsored"
	| "unclaimed";

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
 * soft-locked, so a countdown would be a lie. A comped store reads
 * "Sponsored" for the same reason (z8r3fdeub2), and once its comp has ended
 * it reads "Expired" rather than "Past due" — there's no bill behind it. */
export function tierPill(
	sub: SubscriptionView,
	now: number,
	foundingRank?: number,
	isAdmin = false,
	/** A pre-built store nobody owns yet (docs/prebuilt-stores.md). */
	unclaimed = false,
): TierPill {
	if (isAdmin) return { label: "Admin", tone: "admin" };
	// Before the comped branch, and that order is the whole point. A pre-built
	// store runs on an `internal` comp while an admin builds it, so the comped
	// branch would label it "Sponsored" — a word that is simply false (it is
	// being set up, not sponsored) on a SELLER-FACING chip, which is the screen
	// an admin shows the vendor during the handover demo. Same precedence the
	// admin directory already uses (`sellerBucket` puts unclaimed above comped);
	// this chip was the surface that missed it.
	if (unclaimed) return { label: "Unclaimed", tone: "unclaimed" };
	const fm = foundingRank ? `Founding #${foundingRank}` : null;
	if (sub.comped)
		return { label: fm ? `${fm} · Sponsored` : "Sponsored", tone: "sponsored" };
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
		case "past_due": {
			const state = sub.compEnded ? "Expired" : "Past due";
			return { label: fm ? `${fm} · ${state}` : state, tone: "warn" };
		}
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
