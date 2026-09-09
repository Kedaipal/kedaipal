// Off-Season Hold (z8r3fday24) — the pure rules + copy shared by the server
// (subscriptions.ts, the order-create paths) and the client (billing tab,
// storefront). No Convex imports. See docs/manual-subscription.md.
//
// A hold is a subscription STATUS (`on_hold`), never a Plan: a PAID seller
// pauses between seasons for HOLD_MONTHLY_PRICES (RM19 / S$9) a month.
// Ordering switches off — a STORE setting (`retailers.orderingPausedAt`) that
// the buyer-facing storefront and every order-create channel read, so the
// order pipeline still never reads billing status — while the storefront,
// catalog, buyer list, order history and editing all stay live. One tap
// resumes the tier on the row.

import type { SubscriptionStatus } from "../subscriptions";

export const HOLD_LABEL = "Off-Season Hold";

/** What a buyer reads on a paused store (storefront banner + the server's
 * refusal on every order-create path). Warm, not "closed": the store is
 * still there, it just isn't taking orders this season. */
export function orderingPausedMessage(storeName: string): string {
	return `${storeName} is on a seasonal break — ordering is paused for now. Browse the menu and check back when they reopen.`;
}

/** Statuses a hold can start from: a paying seller (active) or one who has
 * fallen behind on a plan invoice and would rather pause than pay the tier.
 * Never from a trial (the free period is already free — a seller who isn't
 * selling simply doesn't convert) and never from a comped row. */
export function canEnterHold(status: SubscriptionStatus, comped: boolean): boolean {
	return !comped && (status === "active" || status === "past_due");
}

/** Statuses a hold can be resumed from: the hold itself, or a lock over an
 * unpaid HOLD invoice (`pendingIsHold`) — coming back and paying for the tier
 * is exactly what a locked hold seller wants to do, so the hold bill is voided
 * and the tier bill issued instead. A lock over an unpaid PLAN invoice is not
 * a hold to resume from. */
export function canResumeHold(
	status: SubscriptionStatus,
	pendingIsHold: boolean,
): boolean {
	return status === "on_hold" || (status === "past_due" && pendingIsHold);
}

/**
 * When a hold starts billing. A seller who has paid the tier through a future
 * date owes nothing until then — the hold invoice is issued by the daily cron
 * at `currentPeriodEnd`. Anyone else (period over, or a pending plan invoice
 * just voided) gets the hold invoice at once, with the usual 14-day grace.
 */
export function holdBillsNow(args: {
	currentPeriodEnd: number | undefined;
	periodPaidBy: "plan" | "hold" | undefined;
	hadPendingInvoice: boolean;
	now: number;
}): boolean {
	if (args.hadPendingInvoice) return true;
	if (args.currentPeriodEnd === undefined) return true;
	if (args.currentPeriodEnd <= args.now) return true;
	// Paid through a future date by the plan → the cron bills at period end.
	return args.periodPaidBy === "hold";
}

/**
 * Whether resuming issues the tier invoice immediately. A period bought by the
 * PLAN and still running owes nothing (they already paid for the month); a
 * period bought by a HOLD invoice — or no live period at all — bills the tier
 * now, with the usual grace. The unused hold days are the seller's to forfeit;
 * stated in the UI before they tap.
 */
export function resumeBillsNow(args: {
	currentPeriodEnd: number | undefined;
	periodPaidBy: "plan" | "hold" | undefined;
	now: number;
}): boolean {
	if (args.currentPeriodEnd === undefined) return true;
	if (args.currentPeriodEnd <= args.now) return true;
	return args.periodPaidBy === "hold";
}
