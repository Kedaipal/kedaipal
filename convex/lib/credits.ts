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


/**
 * Who the custom-grant lever is FOR, now that Enterprise contracts exist
 * (z8r3fdkp8h follow-up, Zaki 2 Oct 2026): a recurring custom allowance is
 * either SPONSORED (a comp) or CONTRACTED (Enterprise, where the lever edits
 * the contract's included credits) — never a quiet tweak on a list-price
 * plan. A Pro store with 1,500 credits is an Enterprise deal with no
 * contract record: nothing says what was agreed, with whom, or what it
 * bills. The contract can carry Pro's exact fee, so "same price, more
 * credits" is a contract too. Said beside the admin form's disabled lever
 * and thrown by `credits.adminSetGrantOverride` — one author.
 */
export const GRANT_LEVER_CONTRACT_REFUSAL =
	"A custom allowance on a listed plan is an Enterprise deal with no contract record. Put the store on a contract — it can keep this plan's exact terms — or comp it if it's sponsored. Clearing an old custom grant still works.";

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
 *
 * An ENTERPRISE store's grant IS its override: the contract's included
 * credits are written through to `grantOverride` in the same mutation that
 * sets the contract (T6), so the first line answers it. Enterprise has no
 * list grant to fall back to; should the override ever be missing, the store
 * keeps Pro's allowance rather than dropping to zero and locking a contract
 * customer over a data fault.
 */
export function monthlyCreditGrant(inputs: CreditRegimeInputs): number {
	if (inputs.override !== undefined) return inputs.override;
	if (inputs.annualGrant !== undefined && inputs.now < inputs.annualGrant.until)
		return inputs.annualGrant.grant;
	if (inputs.foundingEligible && inputs.plan === "pro")
		return FOUNDING_PRO_CREDIT_GRANT;
	return PLAN_CREDIT_GRANT[
		inputs.plan === "enterprise" ? "pro" : inputs.plan
	];
}

/**
 * Which grant regime a store is in right now. Stores that are metered but
 * never locked — comped and the missing-row fail-safe — are on the monthly
 * grant whatever their status says: a sponsored store sits in whatever status
 * it had, and a one-off trial grant would turn its "honest meter" into a debt
 * that never refreshes.
 *
 * An UNMETERED store (`storeIsMetered`) has no regime at all and never
 * reaches here — `regimeFor` in convex/credits.ts answers `null` for it.
 */
export function creditRegime(inputs: CreditRegimeInputs): CreditRegime {
	if (inputs.status === null || inputs.comped)
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

/** Why a store's SUBSCRIPTION stops it buying a top-up pack, or `null` when
 * it doesn't (register item 7c + T2). Credits top up a live subscription;
 * they never replace one. Comped stores and the missing-row fail-safe pass
 * this rule — T2's `topUpRefusal` refuses them on its own ground: they are
 * never locked, so a pack would buy nothing. */
export type TopUpBlock = "trialing" | "past_due" | "on_hold" | "cancelled";

export function topUpBlock(
	status: CreditBillingStatus,
	comped: boolean,
): TopUpBlock | null {
	if (status === null || comped || status === "active") return null;
	return status;
}

// ---------------------------------------------------------------------------
// The seller lock at zero (Credits T3, ClickUp z8r3fdf8hy)
// ---------------------------------------------------------------------------

/**
 * The share of the month's credits at which a store is RUNNING LOW (Zaki,
 * 1 Oct 2026 — was a flat 10 left): the meter turns amber, the dashboard
 * banner offers a top-up and the low email goes out, all at the same moment.
 * Measured on what's left IN TOTAL (monthly + bought) against the month's
 * grant — exactly "20% of the monthly credits left" for a store with no
 * bought credits, and a store with bought credits banked isn't told to buy
 * more while it has plenty.
 */
export const LOW_CREDIT_RATIO = 0.2;

/** Orders left at or below which a store is running low — 20 on Starter's
 * 100, 40 on Pro's 200, 60 on Founding Pro's 300, 40 of a 200-order trial.
 * Zero for a store with no grant this month (it has nothing to run low on). */
export function lowCreditLine(periodGrant: number): number {
	return Math.ceil(Math.max(0, periodGrant) * LOW_CREDIT_RATIO);
}

// ---------------------------------------------------------------------------
// The gate is PER ORDER (Credits T3.1, ClickUp z8r3fdmg4h)
// ---------------------------------------------------------------------------

/**
 * An order is workable once its OWN credit is paid for — and stays workable
 * forever after that, even when the store goes back into debt. Only orders
 * that arrived while the balance was already at or below zero wait, and they
 * come off the queue OLDEST FIRST as credits arrive. You charge a credit for
 * an order; you don't then hold that order hostage because a LATER one went
 * unfunded (Zaki, 2 Oct 2026 — this replaced a store-wide lock that was built,
 * switched off and never shipped to a seller).
 *
 * **The mechanism is two counters and one number per order**, so every
 * question below is arithmetic rather than a walk of the ledger:
 *
 *  - `creditAccounts.debitSeq` — how many order debits this store has ever
 *    taken. Monotonic; one order gets one number, for life.
 *  - `creditAccounts.fundedThrough` — the high-water mark of debit positions
 *    that are paid for. Only ever RISES.
 *  - `orders.creditSeq` — this order's position in that sequence.
 *
 * An order is funded iff `creditSeq <= fundedThrough`, so the inbox answers it
 * per row off a number it already holds — no per-row read. `debitSeq -
 * fundedThrough` is how many orders are waiting, so the meter's count is
 * arithmetic too.
 *
 * **Why the watermark only rises.** A purchased lot that expires can push the
 * balance below zero long after the orders it funded were worked. Those orders
 * were paid for and must stay workable ("expiry must not retroactively unfund
 * an order already worked"), and a watermark that cannot fall gives that for
 * free — there is no code path that un-funds anything.
 */

/**
 * Does a freshly written debit leave its order PAID FOR?
 *
 * The order spent a real credit iff the total AFTER the debit is still at or
 * above zero: a store sitting on 1 credit takes an order, the debit leaves the
 * total at 0, and that order did pay for its credit. Only below zero is a
 * debt, and only a debt waits. (The ticket specified "unfunded iff the debit
 * left the total at or below zero", which gates the order that spent the
 * store's last credit — an off-by-one, corrected here.)
 */
export function debitIsFunded(totalAfterDebit: number): boolean {
	return totalAfterDebit >= 0;
}

/**
 * Is THIS order's credit paid for? An order with NO `creditSeq` is funded: it
 * never spent a credit through this gate — placed before T3.1 shipped, or its
 * debit faulted and the ledger deliberately kept the order anyway
 * (`recordOrderCreated` swallows a debit fault so checkout never fails). Fail
 * OPEN, like every other missing-data answer in this file: a ledger fault must
 * never be what hides a buyer's order from the seller.
 */
export function orderCreditFunded(
	creditSeq: number | undefined,
	fundedThrough: number,
): boolean {
	return creditSeq === undefined || creditSeq <= fundedThrough;
}

/** How many credits THIS order is waiting on — its own place in the queue, so
 * a gated order says "waiting on 3 credits" instead of a store-wide sentence.
 * 0 once it is funded. */
export function creditsToUnlockOrder(
	creditSeq: number | undefined,
	fundedThrough: number,
): number {
	return orderCreditFunded(creditSeq, fundedThrough)
		? 0
		: (creditSeq as number) - fundedThrough;
}

/** How many of the store's orders are waiting on credits right now. */
export function ordersAwaitingCredit(
	debitSeq: number,
	fundedThrough: number,
): number {
	return Math.max(0, debitSeq - fundedThrough);
}

/**
 * How far the queue moves when credits land: **one credit in frees one waiting
 * order**, oldest first.
 *
 * Deliberately NOT "fill the balance back to zero first". The two agree
 * exactly whenever the debt was created by waiting orders — a store at −101
 * buying a 100-pack unlocks the 100 oldest and keeps the 101st waiting, which
 * is the rule as specified. They diverge only where a store owes credits that
 * no waiting order created: a purchased lot that expired under a negative plan
 * balance, or the debt a store was already carrying when this gate shipped
 * (those orders are grandfathered — they have no `creditSeq`). There, "fill
 * the balance first" would swallow a seller's whole pack and unlock nothing:
 * money in, nothing happens, no explanation on screen. One credit, one order
 * is the rule a seller can predict — and the debt still sits on the balance
 * and still comes off the next refresh, so nothing is given away.
 */
export function fundingAdvance(waiting: number, creditsIn: number): number {
	return Math.max(0, Math.min(waiting, creditsIn));
}

/**
 * Does the credit system apply to this store AT ALL (z8r3fdp4er)?
 *
 * A Kedaipal admin's OWN store is UNMETERED: no credit account, no monthly
 * grant, no debit per order, no meter, no activity list and nothing gated.
 * That is a strictly stronger state than `creditLockExempt` below, which
 * still meters — a sponsored seller's comp can end, so their balance has to
 * be real and visible. An admin runs the product: "200 of 200" over a bar
 * with a refresh date reads as a cap to every eye however carefully the
 * sentence under it is worded, and the volume it was there to show already
 * lives in Insights and the admin console.
 *
 * The ONE gate is `regimeFor` (convex/credits.ts), which answers `null` here
 * — every reader and writer of a balance already funnels through it and
 * already has a `null` branch. Sponsored stores are deliberately untouched.
 */
export function storeIsMetered(args: { ownerIsAdmin: boolean }): boolean {
	return !args.ownerIsAdmin;
}

/** What an admin lever says when it is pointed at a store credits don't apply
 * to — the console's adjust and custom-grant forms. One author, because
 * falling through to "Store not found" is what they did before the gate. */
export const UNMETERED_STORE_REFUSAL =
	"Kedaipal admin stores aren't metered — there are no credits to adjust. Credits apply to seller stores only.";

/** WHY a metered store is never locked: it is SPONSORED (comped, or the
 * missing-row fail-safe `resolveAccess` treats as comped), so Kedaipal is
 * covering it. `null` for every store the lock applies to. An admin's own
 * store is not here — it is unmetered, so it has no balance to exempt. */
export type CreditLockExemption = "sponsored";

export function creditLockExemption(args: {
	status: CreditBillingStatus;
	comped: boolean;
}): CreditLockExemption | null {
	if (args.status === null || args.comped) return "sponsored";
	return null;
}

/** Stores that are metered but NEVER locked: comped and the missing-row
 * fail-safe. They get no balance notices either. */
export function creditLockExempt(args: {
	status: CreditBillingStatus;
	comped: boolean;
}): boolean {
	return creditLockExemption(args) !== null;
}

/** What puts credits back for a locked store — it decides the lock copy and
 * the one button the lock surface offers. */
export type CreditUnlockRoute =
	| "topup" // active: top up or upgrade (or wait for the monthly refresh)
	| "pick_plan" // trialing: the trial's orders are used — subscribe
	| "pay_invoice" // past_due: paying lands the month's credits
	| "resume" // on_hold: resuming lands them
	| "subscribe"; // cancelled

export function creditUnlockRoute(status: CreditBillingStatus): CreditUnlockRoute {
	switch (status) {
		case "trialing":
			return "pick_plan";
		case "past_due":
			return "pay_invoice";
		case "on_hold":
			return "resume";
		case "cancelled":
			return "subscribe";
		default:
			return "topup";
	}
}

/** "1 order" / "15 orders" — counts are always in orders, never money. */
function orders(n: number): string {
	return `${n} ${n === 1 ? "order" : "orders"}`;
}

/** What the gate holds back, in the seller's words. Per-order, so it names
 * the orders that are waiting and NOT the store: the catalogue, insights and
 * every already-funded order carry on untouched (Zaki, 6 Oct 2026 — those are
 * paid for by the subscription, not by credits). */
function gateWaiting(n: number): string {
	return n === 1
		? "1 order is waiting on credits, so you can't open it yet"
		: `${orders(n)} are waiting on credits, so you can't open them yet`;
}

/** The reassurance half, which is most of the point: this is not a frozen
 * store. Said in the same breath as the refusal, every time. */
const GATE_STILL_OPEN =
	"Your other orders, your products and your settings all carry on as normal — and you can cancel a waiting order to release the buyer.";

/**
 * Who is reading a gate sentence, by what they can do about it: the OWNER
 * (every way back), a teammate who may buy packs (`member_topup` — Credits
 * write, T2, and a top-up is the way back), or a teammate who can only ask.
 */
export type CreditLockAudience = "owner" | "member_topup" | "member";

export function creditLockAudience(args: {
	isMember: boolean;
	/** Holds Credits WRITE — may buy a pack on HitPay's page (T2). */
	canBuyCredits: boolean;
	route: CreditUnlockRoute;
}): CreditLockAudience {
	if (!args.isMember) return "owner";
	// Paying an invoice, picking or resuming a plan are billing writes —
	// owner-only — so a pack is the only way back a teammate can take.
	return args.canBuyCredits && args.route === "topup"
		? "member_topup"
		: "member";
}

/**
 * The ONE sentence a gated seller reads — the server's refusal and the
 * dashboard's gate surfaces both come from here, so they can't disagree. It
 * says how many orders are waiting, what still works, and the way out THIS
 * reader can take: a teammate who may buy packs is sent to top up; one who
 * can't is pointed at the owner.
 *
 * `waiting` is the store's whole queue (`ordersAwaitingCredit`), not one
 * order's position — an individual order says "waiting on 3 credits" from
 * `creditsToUnlockOrder` at the surface that shows it.
 */
export function creditLockMessage(
	route: CreditUnlockRoute,
	audience: CreditLockAudience,
	waiting: number,
): string {
	const held = gateWaiting(Math.max(1, waiting));
	if (audience === "member")
		return `${held}. Ask the store owner to add credits. ${GATE_STILL_OPEN}`;
	if (audience === "member_topup")
		return `${held}. Top up in Settings → Billing to open ${waiting === 1 ? "it" : "them"}. ${GATE_STILL_OPEN}`;
	switch (route) {
		case "pick_plan":
			return `${held} — your trial's orders are used up. Pick a plan in Settings → Billing to carry on. ${GATE_STILL_OPEN}`;
		case "pay_invoice":
			return `${held}. Pay your invoice in Settings → Billing and this month's credits land straight away. ${GATE_STILL_OPEN}`;
		case "resume":
			return `${held}. Resume your plan in Settings → Billing and this month's credits land straight away. ${GATE_STILL_OPEN}`;
		case "subscribe":
			return `${held}. Choose a plan in Settings → Billing to carry on. ${GATE_STILL_OPEN}`;
		case "topup":
			return `${held}. Top up or upgrade in Settings → Billing to open ${waiting === 1 ? "it" : "them"}. ${GATE_STILL_OPEN}`;
	}
}

/** The one line a GATED ORDER carries, wherever it appears — the locked inbox
 * row, the locked order page, the disabled action. It names the order's own
 * position, never the store's total, so a seller topping up one credit knows
 * exactly what that credit opens. */
export function orderGatedLine(creditsToUnlock: number): string {
	return creditsToUnlock <= 1
		? "Waiting on 1 credit"
		: `Waiting on ${creditsToUnlock} credits`;
}

/** The phrase every gate refusal and every gate surface contains — what the
 * copy tests and the toast matchers key on, now that the opening words carry
 * a live count and can't be a fixed prefix. */
export const CREDIT_GATE_PHRASE = "waiting on credits";

/**
 * The gate's label where a redacted row would otherwise render a BLANK — the
 * CSV's Customer cell, the inbox chip, the customer list's name. One author,
 * because three hand-typed copies of a user-facing phrase is how the CSV ends
 * up saying something the screen doesn't.
 *
 * It exists because "blank" is never an acceptable rendering of a redaction:
 * an empty name reads as corrupt data, and a seller who thinks the record is
 * broken files a bug instead of topping up.
 */
export const GATED_CELL_LABEL = "Waiting on credits";

/**
 * The TYPED refusal every gated seller write throws (`ConvexError` data), so
 * the dashboard can put the one way back next to the sentence instead of just
 * printing it — a courier booking that can't land offers "Top up" in place,
 * never a dead end. `message` is `creditLockMessage`; `audience` says whether
 * the reader can act on `unlockRoute` (`member` can't — they ask the owner).
 *
 * The `kind` stays `credits_locked`: it is the wire contract `format.ts` and
 * every toast already match on, and renaming it would buy nothing.
 */
export type CreditLockErrorData = {
	kind: "credits_locked";
	message: string;
	unlockRoute: CreditUnlockRoute;
	audience: CreditLockAudience;
	/** How many credits THIS order is waiting on (`creditsToUnlockOrder`), so
	 * a refusal names the order rather than the store. 0 when the refusal
	 * wasn't about one order — a bulk move, a batch of despatch labels. */
	creditsToUnlock: number;
	/** The store's whole queue (`ordersAwaitingCredit`). */
	ordersWaiting: number;
};

export function creditLockErrorData(args: {
	route: CreditUnlockRoute;
	audience: CreditLockAudience;
	creditsToUnlock: number;
	ordersWaiting: number;
}): CreditLockErrorData {
	return {
		kind: "credits_locked",
		message: creditLockMessage(args.route, args.audience, args.ordersWaiting),
		unlockRoute: args.route,
		audience: args.audience,
		creditsToUnlock: args.creditsToUnlock,
		ordersWaiting: args.ordersWaiting,
	};
}

/** Is this `ConvexError` payload the credit gate's? */
export function isCreditLockErrorData(
	data: unknown,
): data is CreditLockErrorData {
	if (typeof data !== "object" || data === null) return false;
	const d = data as Record<string, unknown>;
	return d.kind === "credits_locked" && typeof d.message === "string";
}

/** Which balance notice the store is owed, given where the balance sits now
 * and what has already gone out. Pure, so the evaluator's dedupe is testable.
 *  - `locked`: at or below zero and this lock hasn't been announced;
 *  - `still_locked`: a new period's refresh left the store below zero again;
 *  - `unlocked`: back above zero after an announced lock;
 *  - `low`: at or below the low line (`lowCreditLine` — 20% of the month's
 *    credits), once a period, and never for a
 *    store on a custom grant (its allowance was negotiated, no nudging). */
export type CreditNoticeKind = "low" | "locked" | "still_locked" | "unlocked";

export function dueCreditNotice(args: {
	total: number;
	sent: readonly string[];
	/** The period rolled since the lock was announced (a refresh happened). */
	refreshedWhileLocked: boolean;
	customGrant: boolean;
	/** `lowCreditLine` of the month's grant. */
	lowLine: number;
}): CreditNoticeKind | null {
	const lockAnnounced = args.sent.includes("locked");
	if (args.total <= 0) {
		if (!lockAnnounced) return "locked";
		if (args.refreshedWhileLocked && !args.sent.includes("still_locked"))
			return "still_locked";
		return null;
	}
	if (lockAnnounced) return "unlocked";
	if (
		args.total <= args.lowLine &&
		!args.customGrant &&
		!args.sent.includes("low")
	)
		return "low";
	return null;
}
