// Kedaipal Credits (ClickUp 86eye2ccu, docs/credits.md) — the PURE rules of the
// order-credit ledger. No Convex imports, so the dashboard, the tests and the
// server all read one author of every rule below.
//
// The model in one paragraph: 1 credit = 1 order, used when the order is
// created on any channel. Each store holds two buckets. PLAN credits are the
// monthly allowance: they refresh at every usage period (the MYT calendar
// month), a positive leftover never carries over, and a debt (orders taken
// past zero) comes off the next refresh. PURCHASED credits (packs, referral
// rewards, admin grants) carry over for 12 months, spent oldest-first. Orders
// spend plan credits first, then purchased, then take the plan bucket below
// zero — the ledger NEVER rejects an order: the storefront never pauses, and
// running out only locks the SELLER (T3).
//
// Three constraints, true by construction and pinned where reachable:
//  - credits are non-transferable between stores (every ledger row and every
//    lot is keyed to one retailerId; no function moves credits between two);
//  - credits are never redeemable for cash (no path converts credits into a
//    payment or refund of money — a top-up refund is an admin `adjust`);
//  - credits are spent only on Kedaipal's own service — orders today — never
//    on a third party (Lalamove, Delyva and Meta are never paid in credits).

import {
	FOUNDING_PRO_CREDIT_GRANT,
	PLAN_CREDIT_GRANT,
	type Plan,
	SELLER_CANCEL_REFUNDS_PER_PERIOD,
	TRIAL_CREDIT_GRANT,
} from "./plans";

export type CreditBucket = "plan" | "purchased";

/** A subscription's status, or `null` for a store with no subscription row
 * (the fail-safe `resolveAccess` treats as comped full access). */
export type CreditBillingStatus =
	| "trialing"
	| "active"
	| "past_due"
	| "cancelled"
	| "on_hold"
	| null;

export type CreditRegimeInputs = {
	status: CreditBillingStatus;
	/** The subscription's plan (the tier a comped / held store keeps). */
	plan: Plan;
	comped: boolean;
	/** The store is owned by a Kedaipal admin (dogfooding — never billed, stays
	 * `trialing` forever, so it must not live on the one-off trial grant). */
	ownerIsAdmin: boolean;
	/** `foundingPriceEligible` for this store right now. */
	foundingEligible: boolean;
	/** `creditAccounts.grantOverride` — an admin-set custom monthly grant. */
	override: number | undefined;
	/** The grant an annual payment locked in for its prepaid term. */
	annualGrant: { grant: number; until: number } | undefined;
	now: number;
};

/**
 * How a store is granted plan credits.
 *  - `monthly`: `grant` lands at every usage-period boundary (and a positive
 *    leftover is forfeited);
 *  - `trial`: a ONE-OFF `grant` for the whole trial, never re-granted at a
 *    month boundary (the boundary leaves the trial balance untouched);
 *  - `none`: no grant — `past_due`, `on_hold`, `cancelled`. The boundary still
 *    forfeits a positive leftover; the grant lands when the store pays or
 *    resumes (`landing` in convex/credits.ts).
 */
export type CreditRegime =
	| { kind: "monthly"; grant: number }
	| { kind: "trial"; grant: number }
	| { kind: "none" };

/**
 * The monthly plan grant, ignoring whether the status earns one. Precedence
 * (locked 17 Sep 2026): admin override → the grant an annual payment locked
 * for its term → Founding Pro 300 → the plan's grant.
 */
export function monthlyCreditGrant(inputs: CreditRegimeInputs): number {
	if (inputs.override !== undefined) return inputs.override;
	if (inputs.annualGrant !== undefined && inputs.now < inputs.annualGrant.until)
		return inputs.annualGrant.grant;
	if (inputs.foundingEligible && inputs.plan === "pro")
		return FOUNDING_PRO_CREDIT_GRANT;
	return PLAN_CREDIT_GRANT[inputs.plan];
}

/**
 * Which grant regime a store is in right now. Stores that are metered but
 * never locked — comped, admin-owned, and the missing-row fail-safe — are on
 * the monthly grant whatever their status says: an admin store sits in
 * `trialing` forever, and a one-off trial grant would turn its "honest meter"
 * into a debt that never refreshes.
 */
export function creditRegime(inputs: CreditRegimeInputs): CreditRegime {
	if (inputs.status === null || inputs.comped || inputs.ownerIsAdmin)
		return { kind: "monthly", grant: monthlyCreditGrant(inputs) };
	switch (inputs.status) {
		case "active":
			return { kind: "monthly", grant: monthlyCreditGrant(inputs) };
		case "trialing":
			return { kind: "trial", grant: TRIAL_CREDIT_GRANT };
		case "past_due":
		case "on_hold":
		case "cancelled":
			return { kind: "none" };
	}
}

/** The plan bucket after a period refresh: the new grant plus any debt —
 * a positive leftover never carries over, a negative one always does
 * ("at -15, Starter refreshes to 85"). Also the trial → paid conversion. */
export function refreshedPlanBalance(prevPlan: number, grant: number): number {
	return grant + Math.min(0, prevPlan);
}

/** Which bucket an order's credit comes out of: plan first, then purchased,
 * then the plan bucket goes below zero (orders are never refused). */
export function debitBucket(plan: number, purchased: number): CreditBucket {
	if (plan > 0) return "plan";
	if (purchased > 0) return "purchased";
	return "plan";
}

/** Who ended an order — decides whether its credit comes back. */
export type CancelCause =
	/** The seller (or an admin working their store) cancelled or declined. */
	| "seller"
	/** An automatic sweep: an unanswered booking request expired, an unpaid
	 * claim-link order passed its payment deadline. */
	| "system"
	/** The buyer backed out (declined the custom item on a custom-only order). */
	| "buyer"
	/** A Kedaipal admin hard-deleted a live order. */
	| "admin";

/** Statuses an order holds before the seller has accepted it. */
const NEVER_ACCEPTED_STATUSES: ReadonlySet<string> = new Set([
	"pending",
	"booking_requested",
]);

export type CancelRefundDecision =
	| { refund: true; countsAgainstAllowance: boolean }
	| { refund: false; reason: "accepted" | "allowance_used" };

/**
 * Does a cancelled order's credit come back? (Zaki, 30 Sep 2026: "only an
 * order that never got going".) Automatic when the system, the buyer or an
 * admin ended it. A SELLER cancel or decline refunds only an order they never
 * accepted, and at most `SELLER_CANCEL_REFUNDS_PER_PERIOD` a month — so
 * cancelling finished orders can't buy a locked store its way back above zero.
 * An accepted order keeps its credit: the WhatsApp that cost Kedaipal money
 * went out when it was created.
 */
export function cancelRefundDecision(args: {
	cause: CancelCause;
	/** The order's status at the moment it was cancelled. */
	statusAtCancel: string;
	/** Seller refunds already given this usage period. */
	sellerRefundsUsed: number;
}): CancelRefundDecision {
	if (args.cause !== "seller")
		return { refund: true, countsAgainstAllowance: false };
	if (!NEVER_ACCEPTED_STATUSES.has(args.statusAtCancel))
		return { refund: false, reason: "accepted" };
	if (args.sellerRefundsUsed >= SELLER_CANCEL_REFUNDS_PER_PERIOD)
		return { refund: false, reason: "allowance_used" };
	return { refund: true, countsAgainstAllowance: true };
}

/** Seller refunds still available this period. */
export function sellerRefundsLeft(used: number): number {
	return Math.max(0, SELLER_CANCEL_REFUNDS_PER_PERIOD - used);
}

/** The ONE balance check (T3): the seller can work while the total is above
 * zero. Exemptions (comped, admin-owned) are the gate's business, not this. */
export function creditsExhausted(total: number): boolean {
	return total <= 0;
}

/** Why a store can't buy a top-up pack right now, or `null` when it can
 * (register item 7c + T2). Credits top up a live subscription; they never
 * replace one. Comped stores and the missing-row fail-safe can buy. */
export type TopUpBlock = "trialing" | "past_due" | "on_hold" | "cancelled";

export function topUpBlock(
	status: CreditBillingStatus,
	comped: boolean,
): TopUpBlock | null {
	if (status === null || comped || status === "active") return null;
	return status;
}
