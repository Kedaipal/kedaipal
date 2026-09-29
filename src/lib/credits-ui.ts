// Kedaipal Credits — the dashboard's pure display rules (Credits T3,
// docs/credits.md). Order counts only: a balance is "42 orders left" or
// "15 orders owed", never an RM amount, and never "wallet", "fee",
// "commission", a percentage or "pay as you go" (credits-copy.test.ts greps
// for them).

import type { CancelCreditOutlook } from "../../convex/creditLock";
import type { CreditBalanceView } from "../../convex/credits";
import {
	type CreditUnlockRoute,
	LOW_CREDIT_THRESHOLD,
} from "../../convex/lib/credits";
import { SELLER_CANCEL_REFUNDS_PER_PERIOD } from "../../convex/lib/plans";

export {
	creditLockMessage,
	LOW_CREDIT_THRESHOLD,
} from "../../convex/lib/credits";
export type { CreditUnlockRoute };

/** Share of the month's grant at which the meter turns amber ("amber at 20%
 * remaining, red at 0"). */
export const CREDIT_LOW_RATIO = 0.2;

export type CreditTone = "ok" | "low" | "out";

/** Where a balance sits: red at or below zero, amber in the last fifth of the
 * month's grant (never below the 10-left warning line), else calm. */
export function creditTone(total: number, periodGrant: number): CreditTone {
	if (total <= 0) return "out";
	const lowLine = Math.max(
		LOW_CREDIT_THRESHOLD,
		Math.ceil(periodGrant * CREDIT_LOW_RATIO),
	);
	return total <= lowLine ? "low" : "ok";
}

/** "42 orders left" / "1 order left" / "0 orders left" / "15 orders owed". */
export function ordersBalanceLabel(total: number): string {
	if (total < 0) {
		const owed = -total;
		return `${owed} ${owed === 1 ? "order" : "orders"} owed`;
	}
	return `${total} ${total === 1 ? "order" : "orders"} left`;
}

/** The one button a lock surface offers, by what puts credits back. Links to
 * Settings → Billing; `topup: 1` opens the pack picker (Credits T2). */
export function lockCta(route: CreditUnlockRoute): {
	label: string;
	search: { tab: "billing"; topup?: 1 };
} {
	switch (route) {
		case "topup":
			return { label: "Top up", search: { tab: "billing", topup: 1 } };
		case "pick_plan":
			return { label: "Pick a plan", search: { tab: "billing" } };
		case "pay_invoice":
			return { label: "Pay invoice", search: { tab: "billing" } };
		case "resume":
			return { label: "Resume plan", search: { tab: "billing" } };
		case "subscribe":
			return { label: "Choose a plan", search: { tab: "billing" } };
	}
}

/** The inbox bulk bar's line while the store is out of credits — shorter than
 * `creditLockMessage` because it sits in a narrow popover; the note at the top
 * of the inbox carries the full sentence and the way back. */
export const BULK_CREDIT_LOCK_NOTE =
	"Out of credits — moving orders on is paused. Cancelling still works.";

/** Waiting-orders line for the lock surfaces: "3 new orders since you ran out". */
export function ordersWaitingLabel(n: number): string | null {
	if (n <= 0) return null;
	const count = n >= 99 ? "99+" : String(n);
	return `${count} new ${n === 1 ? "order" : "orders"} since you ran out`;
}

type ActivityRow = {
	type: "grant" | "purchase" | "debit" | "refund" | "adjust" | "expire";
	reason:
		| "plan"
		| "trial"
		| "order"
		| "purchase"
		| "referral_referee"
		| "referral_referrer"
		| "adjust"
		| "expiry";
	amount: number;
	refLabel?: string;
	periodKey: string;
	cause?: "seller" | "system" | "buyer" | "admin";
};

const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

function monthName(periodKey: string): string {
	const month = Number(periodKey.slice(5, 7));
	return MONTH_NAMES[month - 1] ?? periodKey;
}

/** What a ledger row means, in the seller's words — so the activity list
 * answers "why do I have 37 left?" without a glossary. */
export function creditActivityLabel(row: ActivityRow): string {
	switch (row.type) {
		case "grant":
			if (row.reason === "trial") return "Free trial orders";
			if (row.reason === "referral_referrer")
				return "Referral reward — a store you referred started selling";
			if (row.reason === "referral_referee") return "Referral bonus";
			return `${monthName(row.periodKey)} credits from your plan`;
		case "purchase":
			return row.refLabel ? `Bought ${row.refLabel}` : "Bought a credit pack";
		case "debit":
			return row.refLabel ? `Order ${row.refLabel}` : "Order";
		case "refund":
			if (row.cause === "buyer")
				return `${row.refLabel ?? "Order"} — the buyer backed out, credit returned`;
			if (row.cause === "system")
				return `${row.refLabel ?? "Order"} — expired unanswered or unpaid, credit returned`;
			if (row.cause === "admin")
				return `${row.refLabel ?? "Order"} — removed by Kedaipal, credit returned`;
			return `${row.refLabel ?? "Order"} — cancelled before you accepted it, credit returned`;
		case "adjust":
			return row.amount >= 0 ? "Added by Kedaipal" : "Removed by Kedaipal";
		case "expire":
			if (row.reason === "trial")
				return "Unused trial orders — your plan's credits took over";
			if (row.reason === "expiry") return "Bought credits expired (12 months)";
			return `Unused ${monthName(row.periodKey)} plan credits — they don't carry over`;
	}
}

/** The cancel dialog's credit sentence (the refund rule, docs/credits.md):
 * what happens to THIS order's credit if the seller cancels it now — said
 * before the tap, so nobody cancels expecting a credit that won't come back.
 * `null` when the order never used one. */
export function cancelCreditLine(outlook: CancelCreditOutlook): string | null {
	switch (outlook.kind) {
		case "not_charged":
			return null;
		case "refund":
			return outlook.refundsLeftAfter > 0
				? `The credit it used comes back to you (${outlook.refundsLeftAfter} more this month).`
				: "The credit it used comes back to you — the last one this month.";
		case "kept":
			return outlook.reason === "accepted"
				? "The credit it used stays used — you'd already accepted this order."
				: `The credit it used stays used — this month's ${SELLER_CANCEL_REFUNDS_PER_PERIOD} credits back from cancelling are used up.`;
	}
}

/** A plan's monthly allowance, as the plan cards state it. */
export function includedCreditsLabel(grant: number): string {
	return `${grant} credits a month`;
}

type PickBalance = Pick<
	CreditBalanceView,
	"regime" | "plan" | "periodGrant" | "periodKey"
>;

/**
 * What choosing a plan in the picker does to the store's credits, said before
 * the tap (Credits T3 — a trial converting to a smaller plan must see it):
 *  - a TRIAL converting keeps what it owes and starts the plan's allowance
 *    now; what's left of the trial doesn't carry over (the conversion is a
 *    refresh, docs/credits.md);
 *  - a lapsed store's allowance lands the moment the invoice is paid, less
 *    anything owed.
 * `null` while the store already has a running monthly allowance.
 */
export function planPickCreditLine(args: {
	balance: PickBalance;
	grant: number;
	planName: string;
}): string | null {
	const { balance, grant, planName } = args;
	const month = monthName(balance.periodKey);
	const owed = Math.max(0, -balance.plan);
	if (balance.regime === "trial") {
		const used = balance.periodGrant - balance.plan;
		const start = grant - owed;
		if (owed === 0)
			return `Your trial has used ${used} of its ${balance.periodGrant} orders. ${planName} includes ${grant} a month — you'd start with ${grant} for the rest of ${month}; unused trial orders don't carry over.`;
		if (start > 0)
			return `Your trial has used ${used} orders, ${owed} more than it included. ${planName} includes ${grant} a month, so you'd start with ${start} for the rest of ${month} — the ${owed} extra come off first.`;
		return `Your trial has used ${used} orders, ${owed} more than it included. ${planName} includes ${grant} a month, so you'd still be ${-start} short for ${month} — top up once you're subscribed to carry on.`;
	}
	if (balance.regime === "none")
		return owed > 0
			? `${planName} includes ${grant} orders a month. ${month}'s land the moment you pay, less the ${owed} owed.`
			: `${planName} includes ${grant} orders a month — ${month}'s land the moment you pay.`;
	return null;
}

/** The downgrade dialog's credits sentence: the smaller allowance beside this
 * month's orders, so a seller sees whether it fits before confirming
 * ("you've had 140 this month, Starter includes 100"). Plan credits refresh
 * on the 1st, so the new allowance starts at the first refresh after the move
 * lands. `null` for a store on a custom allowance, which doesn't change. */
export function downgradeCreditLine(args: {
	/** The first refresh on the new plan, already formatted. */
	fromLabel: string;
	currentGrant: number;
	targetGrant: number;
	/** This month's orders — absent when the viewer can't see credits. */
	ordersThisPeriod?: number;
	customGrant: boolean;
}): string | null {
	if (args.customGrant) return null;
	const n = args.ordersThisPeriod;
	const usage =
		n === undefined
			? ""
			: ` — you've had ${n} ${n === 1 ? "order" : "orders"} so far this month`;
	return `From ${args.fromLabel} you'll have ${args.targetGrant} credits a month instead of ${args.currentGrant}${usage}.`;
}
