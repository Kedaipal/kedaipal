// The seller gate is PER ORDER (Credits T3.1, ClickUp z8r3fdmg4h,
// docs/credits.md). An order is workable once its own credit is paid for, and
// stays workable forever after that. Only orders that arrived while the
// balance was already at or below zero WAIT, and they come off the queue
// oldest first as credits arrive.
//
// Two things follow, and they are the whole design:
//
//  1. A GATED ORDER IS INVISIBLE, not merely un-actionable (Zaki, 6 Oct 2026).
//     Greying the buttons out leaves the buyer's phone number on screen, so a
//     seller settles the order by hand in WhatsApp and the gate collects
//     nothing. So the REDACTION lives on the server read path — see
//     `convex/lib/orderGate.ts` — and every seller-facing read of an order or
//     a customer runs through it. Hiding it in the client would be theatre.
//  2. NOTHING ELSE IS GATED. Products, categories, insights, settings and
//     every funded order carry on untouched: those are paid for by the
//     subscription, not by credits (Zaki, 6 Oct 2026 — this replaced a
//     store-wide lock that was built, switched off and never shipped). The
//     store-wide `assertCreditsAvailable` is gone with it; there is one gate
//     and it takes an order.
//
// Which public writes carry the gate is a TEST, not prose —
// creditLockCoverage.test.ts.
//
// A SECOND, broader lock sits beside this one (`assertSubscriptionActive`,
// which makes a lapsed store fully view-only). The two are deliberately
// separate guards: the credit gate must leave cancel, refund, settings and the
// catalogue open, and cancel runs through the same `updateStatus` as confirm.
// They compose without double-messaging because the subscription lock is
// checked FIRST at every site and outranks this one in `useAreaLock` too.
//
// CALL IT UNCONDITIONALLY. Both locks let Kedaipal admins through on their own
// `isAdmin` check (identity, `ADMIN_USER_IDS`), which is a SUPERSET of the
// call site's `access.actingAsAdmin` — that flag is set only for an admin
// subject, and misses an admin on their own store, whom both guards also pass.
// So a call site never wraps this guard in an act-as test. Ten sites shipped
// it looking wrapped (PR #320 review, 2 Oct):
//
//   if (!access.actingAsAdmin)
//     await assertSubscriptionActive(ctx, id);
//     await assertOrderCreditAvailable(ctx, order);   // ← NOT inside the if
//
// Right by accident, and a lie about the control flow in auth-adjacent code.
// Those sites now brace the `if`; `creditLockCoverage.test.ts` fails on the
// dangling shape for any `assert*` guard, and `creditLock.test.ts` pins the
// white-glove bypass itself, so moving it goes red instead of quiet.

import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalQuery,
	type MutationCtx,
	type QueryCtx,
	query,
} from "./_generated/server";
import {
	countOrdersAwaitingCredit,
	loadCreditAccount,
	projectedCredits,
} from "./credits";
import {
	isAdmin,
	requireRetailerAccess,
	storeOwnerIsAdmin,
	tryRetailerAccess,
} from "./lib/auth";
import {
	type CreditUnlockRoute,
	GATED_CELL_LABEL,
	cancelRefundDecision,
	creditLockAudience,
	creditLockErrorData,
	creditLockExempt,
	creditUnlockRoute,
	creditsToUnlockOrder,
	orderCreditFunded,
	ordersAwaitingCredit,
	sellerRefundsLeft,
	storeIsMetered,
} from "./lib/credits";
import {
	type SellerCustomer,
	type SellerOrder,
	isCustomerGated,
	redactGatedCustomer,
	redactGatedOrder,
} from "./lib/orderGate";
import { usagePeriodKey } from "./lib/usagePeriod";

type AnyCtx = QueryCtx | MutationCtx;

/**
 * What the dashboard needs to answer "is THIS order gated?" for every row it
 * holds, without a read per row — safe for every teammate (no balances; those
 * stay behind the `credits` grant, and a sequence number is not a balance).
 */
export type CreditGateState = {
	/** Nothing in this store is ever gated: comped, admin-owned, no
	 * subscription row, or no credit account yet. Fail open. */
	exempt: boolean;
	/** The watermark. An order is workable iff `creditSeq <= fundedThrough`. */
	fundedThrough: number;
	/** Credits owed on orders that are waiting — `debitSeq - fundedThrough`,
	 * the arithmetic bound on the queue (it counts positions, so an order
	 * cancelled while it waited still holds one). */
	creditsOwed: number;
	/** LIVE orders waiting on credits, capped at 99 — the number every surface
	 * SHOWS. Read from the queue rather than derived from `creditsOwed`, so a
	 * seller who cancelled a waiting order isn't told it is still waiting. */
	ordersWaiting: number;
	/** What puts credits back — decides the copy and the one button. */
	unlockRoute: CreditUnlockRoute;
};

/** A store where nothing is gated. */
function openGate(unlockRoute: CreditUnlockRoute): CreditGateState {
	return {
		exempt: true,
		// Above every possible `creditSeq`, so `orderCreditFunded` says yes for
		// every order without the caller having to check `exempt` as well.
		fundedThrough: Number.POSITIVE_INFINITY,
		creditsOwed: 0,
		ordersWaiting: 0,
		unlockRoute,
	};
}

/**
 * The ONE gate resolver — the server guards, the read-path redaction and the
 * dashboard payload all read it. Exempt stores (comped, admin-owned, no
 * subscription row) and a store with no credit account yet are never gated
 * (fail open, like the past-due lock's missing-row fail-safe).
 *
 * A KEDAIPAL ADMIN is never gated, here rather than at each call site: the
 * redaction, the guards, the batch skip and the dashboard payload all read
 * this one answer, so white-glove support sees a store exactly as it is and
 * the client has no admin special-case left to get wrong. `isAdmin` is the
 * identity check (`ADMIN_USER_IDS`), a SUPERSET of a call site's
 * `access.actingAsAdmin` — it also covers an admin on their own store.
 */
export async function resolveCreditGate(
	ctx: AnyCtx,
	retailer: Doc<"retailers">,
	now: number,
): Promise<CreditGateState> {
	const sub = await ctx.db
		.query("subscriptions")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
		.first();
	const status = sub?.status ?? null;
	const unlockRoute = creditUnlockRoute(status);
	// A Kedaipal admin CALLER is never gated (see the doc above) — identity,
	// not store ownership, so it also covers white-glove act-as.
	if (await isAdmin(ctx)) return openGate(unlockRoute);
	// An admin's own STORE is UNMETERED (z8r3fdp4er): it holds no balance, so
	// there is nothing to be at zero. `projectedCredits` below would answer
	// null and reach the same open gate, but a gate resolver should say where
	// it fails open, not make the reader follow three hops to find out.
	if (!storeIsMetered({ ownerIsAdmin: storeOwnerIsAdmin(retailer) }))
		return openGate(unlockRoute);
	// SPONSORED: comped, or the missing-subscription fail-safe.
	if (creditLockExempt({ status, comped: sub?.comped === true }))
		return openGate(unlockRoute);
	const account = await loadCreditAccount(ctx, retailer._id);
	if (!account) return openGate(unlockRoute);
	const projected = await projectedCredits(ctx, retailer._id, account, now);
	if (!projected) return openGate(unlockRoute);
	const { debitSeq, fundedThrough } = projected;
	const creditsOwed = ordersAwaitingCredit(debitSeq, fundedThrough);
	return {
		exempt: false,
		unlockRoute,
		fundedThrough,
		creditsOwed,
		// Only read the queue when the arithmetic says there could be something
		// in it — which for a store in credit is never, so the common case costs
		// nothing at all.
		ordersWaiting:
			creditsOwed === 0
				? 0
				: await countOrdersAwaitingCredit(ctx, retailer._id, fundedThrough),
	};
}

/**
 * The gate for one store from its id — what the READ paths use, since a query
 * about to redact a page of orders holds a `retailerId` and not the retailer
 * row. A missing store returns an open gate: a read that found no store has a
 * better answer of its own than a credit refusal.
 */
export async function creditGateFor(
	ctx: AnyCtx,
	retailerId: Id<"retailers">,
	now: number = Date.now(),
): Promise<CreditGateState> {
	const retailer = await ctx.db.get(retailerId);
	return retailer
		? await resolveCreditGate(ctx, retailer, now)
		: openGate("topup");
}

/** Redact one order for a seller surface, given the store's gate — the ONE
 * call every seller-facing read of an order makes, so a surface can never
 * forget half of the rule (whether the row is gated and what it is waiting
 * for always travel together). */
export function forSeller(
	gate: CreditGateState,
	order: Doc<"orders">,
): SellerOrder {
	return redactGatedOrder(order, {
		gated: isOrderGated(gate, order),
		creditsToUnlock: creditsToUnlock(gate, order),
	});
}

/** `forSeller` for a customer record. */
export function customerForSeller(
	gate: CreditGateState,
	customer: Doc<"customers">,
): SellerCustomer {
	return redactGatedCustomer(
		customer,
		!gate.exempt && isCustomerGated(customer, gate.fundedThrough),
	);
}

/**
 * Is THIS order waiting on credits, resolved from the order alone — for the
 * per-order seller reads (the timeline, the payment proofs, the item, mockup
 * and reference images) that hand back something OTHER than an order row and
 * so have nothing for `forSeller` to redact. They return their own empty
 * answer instead: no events, no claims, no image URLs.
 *
 * It is the gate, not the images, that is the point here: a mockup photo or a
 * payment screenshot carries the buyer's name and sometimes their number, and
 * an order the seller can't see must not leak through its attachments.
 */
export async function orderGatedForSeller(
	ctx: AnyCtx,
	order: Doc<"orders">,
): Promise<boolean> {
	const retailer = await ctx.db.get(order.retailerId);
	if (!retailer) return false;
	return isOrderGated(await resolveCreditGate(ctx, retailer, Date.now()), order);
}

/** Is this order waiting on credits? The one predicate every surface asks —
 * the redaction, the guards, the inbox filter and the UI. */
export function isOrderGated(
	gate: CreditGateState,
	order: { creditSeq?: number },
): boolean {
	return !orderCreditFunded(order.creditSeq, gate.fundedThrough);
}

/**
 * The guest name a BOOKING surface may show (Credits T3.1).
 *
 * The booking calendar, the day sheet and the two impact lists each read whole
 * order rows off `bookingsOverlapping` rather than through `forSeller`, so the
 * allowlist never reached them — and a booking REQUEST debits its credit at
 * request time (`bookings.ts`), so a request that lands at or below zero is
 * born gated. `holdsCapacity` keeps every non-cancelled status, so that gated
 * request sits on the grid with the guest's name and the nights beside it:
 * for the booking vertical that is the whole manual-settlement bypass, since
 * the guest simply turns up on the date and no phone number is needed. The
 * `.ics` feed skipped gated bookings for exactly this reason; these four
 * surfaces are the in-app mirror of it.
 *
 * The name is BLANKED rather than the row dropped, deliberately. These lists
 * exist to stop a seller blocking or closing a date that already has someone
 * on it — drop the row and the feature actively misleads, which is worse than
 * the leak it was closing. The count, the nights and the status stay real;
 * only the identity goes.
 */
export function guestNameForSeller(
	gate: CreditGateState,
	order: { creditSeq?: number; customer: { name?: string } },
	fallback?: string,
): string | undefined {
	if (isOrderGated(gate, order)) return GATED_CELL_LABEL;
	return order.customer.name?.trim() || fallback;
}

/** How many credits THIS order is waiting on (0 when it's workable). */
export function creditsToUnlock(
	gate: CreditGateState,
	order: { creditSeq?: number },
): number {
	return creditsToUnlockOrder(order.creditSeq, gate.fundedThrough);
}

/**
 * The guard for every gated seller write (see the file header). Kedaipal
 * admins pass, as they do the past-due lock — on their own store or acting as
 * a seller. Throws a TYPED `ConvexError` (`CreditLockErrorData`) whose
 * `message` is `creditLockMessage` and whose `creditsToUnlock` names THIS
 * order's place in the queue, so the refusal a seller reads is the sentence
 * the gate surfaces show — and the dashboard can offer the way back.
 *
 * Takes the ORDER, never a retailerId: there is no store-wide credit refusal
 * any more, and a guard that can't name an order can't be the credit gate.
 */
export async function assertOrderCreditAvailable(
	ctx: AnyCtx,
	order: Doc<"orders">,
): Promise<void> {
	if (await isAdmin(ctx)) return;
	const retailer = await ctx.db.get(order.retailerId);
	if (!retailer) return;
	const gate = await resolveCreditGate(ctx, retailer, Date.now());
	if (!isOrderGated(gate, order)) return;
	throw new ConvexError(
		await gateRefusal(ctx, order.retailerId, gate, creditsToUnlock(gate, order)),
	);
}

/** The typed refusal, with the way back THIS reader can take. */
async function gateRefusal(
	ctx: AnyCtx,
	retailerId: Id<"retailers">,
	gate: CreditGateState,
	creditsToUnlockOrder: number,
) {
	const access = await tryRetailerAccess(ctx, retailerId, { anyMember: true });
	const isMember = access?.role === "member";
	// A teammate holding Credits write may buy a pack (T2), so for them a
	// top-up is a way back they can take themselves.
	const canBuyCredits =
		!isMember ||
		(await tryRetailerAccess(ctx, retailerId, {
			area: "credits",
			level: "write",
		})) !== null;
	return creditLockErrorData({
		route: gate.unlockRoute,
		audience: creditLockAudience({
			isMember,
			canBuyCredits,
			route: gate.unlockRoute,
		}),
		creditsToUnlock: creditsToUnlockOrder,
		ordersWaiting: gate.ordersWaiting,
	});
}

/**
 * The same gate for seller ACTIONS (courier booking, despatch labels, the
 * payment reminder, the seller's receipt), which have no `ctx.db` and know a
 * `shortId` and nothing else. A shortId that resolves to nothing passes — the
 * action's own "not found" is the clearer answer.
 *
 * OWNER- and MEMBER-gated exactly like `subscriptions.assertWritable`: these
 * run first in public actions, so an anonymous or foreign caller must get the
 * action's own answer, never a gate refusal that would reveal a store's credit
 * state.
 */
export const assertCreditsForOrder = internalQuery({
	args: { shortId: v.string() },
	handler: async (ctx, { shortId }): Promise<null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const order = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.unique();
		if (!order) return null;
		const access = await tryRetailerAccess(ctx, order.retailerId, {
			anyMember: true,
		});
		if (!access || access.role === "admin") return null;
		await assertOrderCreditAvailable(ctx, order);
		return null;
	},
});

/** Whether cancelling THIS order gives its credit back — so the cancel dialog
 * can say so before the tap (no hidden rule). */
export type CancelCreditOutlook =
	/** `gated` ⇒ the credit comes back and this cancel costs no allowance, so
	 * the dialog must not quote a remaining count that won't move. */
	| { kind: "refund"; refundsLeftAfter: number; gated?: true }
	| { kind: "kept"; reason: "accepted" | "allowance_used" }
	/** No credit was ever used for this order (placed before credits). */
	| { kind: "not_charged" };

export const cancelOutlook = query({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }): Promise<CancelCreditOutlook | null> => {
		const order = await ctx.db.get(orderId);
		if (!order) return null;
		await requireRetailerAccess(ctx, order.retailerId, {
			area: "orders",
			level: "read",
		});
		if (order.status === "cancelled") return null;
		const rows = await ctx.db
			.query("creditLedger")
			.withIndex("by_retailer_ref_type", (q) =>
				q.eq("retailerId", order.retailerId).eq("refId", order._id),
			)
			.collect();
		const net =
			rows.filter((r) => r.type === "debit").length -
			rows.filter((r) => r.type === "refund").length;
		if (net <= 0) return { kind: "not_charged" };
		const account = await loadCreditAccount(ctx, order.retailerId);
		const periodKey = usagePeriodKey(Date.now());
		const used =
			account?.sellerRefunds?.periodKey === periodKey
				? account.sellerRefunds.count
				: 0;
		const gated = !orderCreditFunded(
			order.creditSeq,
			account?.fundedThrough ?? 0,
		);
		const decision = cancelRefundDecision({
			cause: "seller",
			statusAtCancel: order.status,
			sellerRefundsUsed: used,
			gated,
		});
		if (!decision.refund) return { kind: "kept", reason: decision.reason };
		// A gated cancel spends no allowance, so the count it would quote is
		// the count it already had — say nothing about it rather than imply
		// this cancel used one up.
		return gated
			? { kind: "refund", refundsLeftAfter: sellerRefundsLeft(used), gated }
			: { kind: "refund", refundsLeftAfter: sellerRefundsLeft(used + 1) };
	},
});
