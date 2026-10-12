// The voucher REDEMPTION seam (`z8r3fdr617`, docs/vouchers.md) — the three
// ctx-taking operations every door shares. Separate from `lib/vouchers.ts`,
// which stays pure (no Convex imports) so the storefront can import its maths.
//
// There are exactly three doors that can spend a voucher — `orders.create`
// (storefront), `counterCheckout.createOrderFromSession` (counter) and
// `orderClaims.commitClaim` (claim link) — and all three do it the same way:
//
//   1. `resolveVoucherForOrder` BEFORE the insert, to get the terms the total
//      is computed from. Reads only.
//   2. `redeemVoucher` AFTER the insert, which needs the new order's id.
//
// Both inside ONE mutation, which is what makes the race safe: the read in
// step 1 joins the transaction's read set, so two checkouts racing one code
// conflict on Convex's OCC, one of them retries, and the retry sees `redeemed`
// and is refused. There is deliberately no "reserved" state to leak.

import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getAccess } from "../subscriptions";
import {
	normalizeVoucherCode,
	refusalForVoucher,
	voucherDiscountFor,
	type VoucherRefusal,
	voucherRefusalErrorData,
	voucherRefusalMessage,
	type VoucherSnapshot,
	type VoucherTerms,
} from "./vouchers";

/** What a door gets back. A refusal is DATA, not a throw, so the caller
 * decides whether a bad code refuses the order (the storefront, where the
 * buyer can fix it) or merely drops the discount with a notice (the claim
 * page, where refusing would dead-end a buyer who followed a link). */
export type VoucherResolution =
	| { ok: true; voucher: Doc<"vouchers">; terms: VoucherTerms }
	| { ok: false; refusal: VoucherRefusal; usedOnOrder?: string };

/**
 * Look a typed code up for THIS store and say whether it can be spent.
 *
 * Writes nothing. Every door calls this rather than trusting an earlier check
 * — including the claim link, whose voucher was validated at send and may have
 * been spent or voided since.
 *
 * Cross-store codes resolve here and are refused as `not_found`: codes are
 * globally unique (`by_code`), so a row that exists under another
 * `retailerId` is a real row that this store must not be able to spend, and
 * saying "not found" avoids confirming that it exists at all.
 */
/**
 * Can this STORE redeem a voucher right now? (`z8r3fdr617`)
 *
 * Vouchers are a Pro capability, and a capability that survives a downgrade
 * is not one. The sibling feature already settled the shape: `isPromoActive`
 * folds the plan in, which "is why a downgraded store's storefront quietly
 * sells at list while the config survives" — the config is kept, the benefit
 * is not. Vouchers follow, so the two levers can't mean different things.
 *
 * Deliberately a property of the SHOP, read through the same `getAccess` the
 * seller's own `assertPlanFeature` uses, so the door a buyer knocks on and
 * the door the seller issues from can never disagree. It takes no view of the
 * caller — a buyer is anonymous, and a code must not redeem or refuse based
 * on who is holding the phone.
 *
 * Nothing is destroyed: the rows stay `active`, the seller keeps the list and
 * keeps Void, and re-upgrading makes every unspent code spendable again.
 *
 * KNOWN EDGE: `assertPlanFeature` lets an ADMIN issue past the gate (its
 * white-glove bypass, keyed on the caller). A voucher minted that way for a
 * store below Pro cannot be redeemed, because this door asks about the store.
 * That is the right precedence — the shop's entitlement decides what its
 * buyers get — but it means admin-issued codes on a Starter store are inert.
 */
export async function storeCanUseVouchers(
	ctx: QueryCtx,
	retailerId: Id<"retailers">,
): Promise<boolean> {
	return (await getAccess(ctx, retailerId)).features.vouchers;
}

/**
 * Should a checkout show the voucher ENTRY at all? (`z8r3fdr617`)
 *
 * Two conditions, and they answer different questions:
 *   1. `storeCanUseVouchers` — could a code redeem here? (the gate)
 *   2. has this store ever issued one — could a code EXIST here?
 *
 * A store that has never issued a voucher has no code for anyone to type, so
 * the field can only ever refuse; a store below Pro likewise. Showing it
 * anyway puts a dead control on the buyer's checkout, which is the surface we
 * most want uncluttered.
 *
 * "Ever issued" rather than "has an ACTIVE voucher" on purpose. A live count
 * would hide the field at the worst possible moment — the buyer whose code
 * was just voided would find no input at all, instead of the honest "This
 * voucher is no longer valid" we built for exactly that. It also leaks less:
 * "this shop has used vouchers at some point" says far less than "there is a
 * live code out there right now", which is the thing the rate limiter exists
 * to protect.
 *
 * The affordance implies the gate, never the reverse: anything this returns
 * true for can redeem, but `resolveVoucherForOrder` still re-asks, because a
 * `?voucher=` link reaches the door without passing the field.
 */
export async function storeShowsVoucherEntry(
	ctx: QueryCtx,
	retailerId: Id<"retailers">,
): Promise<boolean> {
	if (!(await storeCanUseVouchers(ctx, retailerId))) return false;
	const anyVoucher = await ctx.db
		.query("vouchers")
		.withIndex("by_retailer_created", (q) => q.eq("retailerId", retailerId))
		.first();
	return anyVoucher !== null;
}

export async function resolveVoucherForOrder(
	ctx: QueryCtx,
	args: { retailerId: Id<"retailers">; code: string; now: number },
): Promise<VoucherResolution> {
	const code = normalizeVoucherCode(args.code);
	if (code === null) return { ok: false, refusal: "malformed" };

	const voucher = await ctx.db
		.query("vouchers")
		.withIndex("by_code", (q) => q.eq("code", code))
		.unique();
	if (!voucher || voucher.retailerId !== args.retailerId)
		return { ok: false, refusal: "not_found" };

	// Asked only once a real code for THIS store is in hand: an unknown code
	// should cost a subscription read, and "not found" is the honest answer
	// to it either way.
	if (!(await storeCanUseVouchers(ctx, args.retailerId)))
		return { ok: false, refusal: "store_ineligible" };

	const refusal = refusalForVoucher(voucher, args.now);
	if (refusal !== null) {
		// Name the order a spent voucher went to — it's the one refusal where
		// the buyer tends to insist, and the seller can look the order up.
		const usedOnOrder =
			refusal === "redeemed" && voucher.redeemedOrderId
				? ((await ctx.db.get(voucher.redeemedOrderId))?.shortId ?? undefined)
				: undefined;
		return { ok: false, refusal, usedOnOrder };
	}

	return {
		ok: true,
		voucher,
		terms: { kind: voucher.kind, value: voucher.value },
	};
}

/** Resolve, or throw the typed refusal. The shape the two doors that REFUSE
 * a bad code (storefront + counter) want, so neither hand-rolls the throw. */
export async function resolveVoucherOrThrow(
	ctx: QueryCtx,
	args: { retailerId: Id<"retailers">; code: string; now: number },
): Promise<{ voucher: Doc<"vouchers">; terms: VoucherTerms }> {
	const resolved = await resolveVoucherForOrder(ctx, args);
	if (!resolved.ok)
		throw new ConvexError(
			voucherRefusalErrorData(resolved.refusal, {
				usedOnOrder: resolved.usedOnOrder,
			}),
		);
	return { voucher: resolved.voucher, terms: resolved.terms };
}

/**
 * Spend it — in the SAME mutation that inserted `orderId`.
 *
 * Re-asserts redeemability off a fresh read rather than trusting the row the
 * caller resolved a few statements earlier. That is belt-and-braces given the
 * OCC guarantee above, and it is cheap; what it actually buys is a correct
 * refusal if a future door ever resolves in one mutation and redeems in
 * another, which would otherwise double-spend silently.
 */
export async function redeemVoucher(
	ctx: MutationCtx,
	args: { voucherId: Id<"vouchers">; orderId: Id<"orders">; now: number },
): Promise<void> {
	const fresh = await ctx.db.get(args.voucherId);
	if (!fresh) throw new ConvexError(voucherRefusalErrorData("not_found"));
	const refusal = refusalForVoucher(fresh, args.now);
	if (refusal !== null)
		throw new ConvexError(voucherRefusalErrorData(refusal));
	await ctx.db.patch(args.voucherId, {
		status: "redeemed",
		redeemedOrderId: args.orderId,
		redeemedAt: args.now,
		updatedAt: args.now,
	});
}

/**
 * The state of a CLAIM's frozen voucher, for the claim page's read and the
 * commit's maths — asked in both places so the price the buyer confirms is the
 * price the commit computes.
 *
 * `dropped` is the state that matters: the claim carries a voucher that can no
 * longer be spent (keyed at the counter meanwhile, voided, lapsed). The page
 * renders `message` above the ticket and prices without it; the commit then
 * agrees. The alternative — refusing the commit — would strand a buyer who did
 * nothing wrong, since only the seller can issue a new link.
 */
export type ClaimVoucherState =
	| { kind: "none" }
	| {
			kind: "applied";
			voucherId: Id<"vouchers">;
			snapshot: VoucherSnapshot;
			terms: VoucherTerms;
		}
	| {
			kind: "dropped";
			snapshot: VoucherSnapshot;
			refusal: VoucherRefusal;
			message: string;
		};

/**
 * What a claim's voucher takes off, from its state alone (`z8r3fdr617`).
 *
 * Only an `applied` voucher discounts: a `dropped` one is exactly the case
 * where the buyer must be charged the full price and TOLD why, so it has to
 * return 0 here or the page would quote a discount the commit then refuses to
 * honour. Every surface that prices a claim asks this — the ticket, the
 * confirm button and the page header — so none of them can disagree.
 */
export function claimVoucherDiscount(
	voucher: ClaimVoucherState | undefined,
	itemSubtotal: number,
): number {
	return voucher?.kind === "applied"
		? voucherDiscountFor(voucher.terms, itemSubtotal)
		: 0;
}

export async function claimVoucherState(
	ctx: QueryCtx,
	claim: Doc<"orderClaims">,
	now: number,
): Promise<ClaimVoucherState> {
	if (!claim.voucherId || !claim.voucherSnapshot) return { kind: "none" };
	const snapshot = claim.voucherSnapshot;
	const voucher = await ctx.db.get(claim.voucherId);
	// Row gone: treat as voided rather than crashing the buyer's page — the
	// effect on them is identical, and "no longer valid" is true either way.
	if (!voucher)
		return {
			kind: "dropped",
			snapshot,
			refusal: "voided",
			message: voucherRefusalMessage("voided"),
		};
	// A claim sent while the store was Pro, opened after it dropped: the
	// discount is gone, and the page's `dropped` machinery is exactly how the
	// buyer is told before they fill the form.
	const refusal = (await storeCanUseVouchers(ctx, claim.retailerId))
		? refusalForVoucher(voucher, now)
		: ("store_ineligible" as const);
	if (refusal !== null) {
		const usedOnOrder =
			refusal === "redeemed" && voucher.redeemedOrderId
				? ((await ctx.db.get(voucher.redeemedOrderId))?.shortId ?? undefined)
				: undefined;
		return {
			kind: "dropped",
			snapshot,
			refusal,
			message: voucherRefusalMessage(refusal, { usedOnOrder }),
		};
	}
	return {
		kind: "applied",
		voucherId: voucher._id,
		// The FROZEN code (what the buyer was shown) with the LIVE terms, which
		// are the same thing today — a voucher's value is immutable once issued —
		// but reading the terms off the row keeps this honest if editing a
		// voucher's value is ever added.
		snapshot: { code: snapshot.code, kind: voucher.kind, value: voucher.value },
		terms: { kind: voucher.kind, value: voucher.value },
	};
}

/**
 * Give the voucher back when its order ends — ANY cause (docs/vouchers.md: the
 * seller issued it to that buyer, so a cancellation they didn't ask for must
 * not also cost them the discount).
 *
 * Called from the two places an order can die: `reverseCancellationEffects`
 * (which covers the status transitions and the admin hard delete) and the
 * custom-decline's own cancel branch, which open-codes its reversal. Idempotent
 * — re-cancelling, or releasing a voucher a later feature already voided, is a
 * no-op, so it can be called without checking first.
 *
 * A VOIDED voucher is deliberately NOT reactivated: the seller withdrew it on
 * purpose, and an order cancelling afterwards shouldn't put it back in play.
 */
export async function releaseOrderVoucher(
	ctx: MutationCtx,
	order: Doc<"orders">,
	now: number,
): Promise<void> {
	if (!order.voucherId) return;
	const voucher = await ctx.db.get(order.voucherId);
	// Row gone (tenant teardown mid-cascade), already handed back, or voided
	// since — nothing to do in any of those.
	if (!voucher || voucher.status !== "redeemed") return;
	// Only release a voucher THIS order is holding. Without this, cancelling an
	// order whose voucher had been released and re-spent elsewhere would steal
	// it back from the order that legitimately holds it now.
	if (voucher.redeemedOrderId !== order._id) return;
	await ctx.db.patch(order.voucherId, {
		status: "active",
		redeemedOrderId: undefined,
		redeemedAt: undefined,
		updatedAt: now,
	});
}
