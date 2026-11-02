/**
 * The buyer's "I've paid" submissions, kept as HISTORY (z8r3fdn2uj).
 *
 * `claimPayment` used to overwrite `orders.paymentReference` /
 * `paymentProofStorageId` on every resubmit, and the seller's order page only
 * showed the proof while the claim was open — so once a payment was marked
 * received, the screenshot the seller relied on was unreachable, and any
 * earlier screenshot was lost outright. Each submission is now a
 * `paymentClaims` row; the order's own fields stay as the latest values for the
 * email + WhatsApp readers.
 *
 * Orders claimed before the table existed have no rows. `legacyClaimFromOrder`
 * rebuilds their one submission from the order, so the seller sees it before
 * `migrations:backfillPaymentClaims` has run — and `recordPaymentClaim` writes
 * that row first on the next resubmit, so the legacy proof can't be lost then
 * either.
 */

import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** How many submissions one order keeps. A real buyer resubmits once or twice
 * (a typo'd reference, a forgotten screenshot); the cap only stops a script
 * from growing one order's history without bound — the per-minute rate limit
 * alone would let it reach thousands in a day. */
export const MAX_PAYMENT_CLAIMS_PER_ORDER = 20;

/** Buyer-facing refusal once the cap is hit — points at the human channel. */
export const PAYMENT_CLAIM_LIMIT_MESSAGE =
	"You've already sent your payment details many times — message the seller on WhatsApp if something's changed.";

/**
 * Buyer-facing refusal for a claim that would leave the order with nothing to
 * verify against (z8r3fdnpxf).
 *
 * The rule is on the ORDER, not on the submission: the seller's whole reason
 * for a claim is an image they can check a bank statement against, and once
 * one is on file a later reference-only resubmit (the forgotten-reference fix)
 * doesn't take it away. So only the FIRST claim is required to carry a
 * screenshot — see `claimPayment`.
 *
 * English, like every other refusal on this mutation: the buyer's sheet blocks
 * this case before it can be submitted and says so in their own language, so
 * this message is the direct-call backstop, not the copy a buyer reads.
 */
export const PAYMENT_PROOF_REQUIRED_MESSAGE =
	"Attach a screenshot of your payment so the seller can verify it.";

/** One submission, as the seller's order page lists it. */
export type PaymentClaimEntry = {
	reference?: string;
	proofStorageId?: string;
	createdAt: number;
};

/**
 * The order's single pre-history submission, rebuilt from its own fields — or
 * null when the buyer never claimed. Keyed on `paymentClaimedAt` (only
 * `claimPayment` sets it), never on the reference alone: HitPay settlement
 * writes its payment id into `paymentReference`, and that's not something the
 * buyer sent, so it's dropped here too.
 */
export function legacyClaimFromOrder(
	order: Doc<"orders">,
): PaymentClaimEntry | null {
	if (order.paymentClaimedAt === undefined) return null;
	const reference =
		order.paymentReference !== undefined &&
		order.paymentReference !== order.gatewayPaymentId
			? order.paymentReference
			: undefined;
	// A bare "I've paid" with nothing attached has nothing to show.
	if (reference === undefined && order.paymentProofStorageId === undefined) {
		return null;
	}
	return {
		...(reference !== undefined ? { reference } : {}),
		...(order.paymentProofStorageId !== undefined
			? { proofStorageId: order.paymentProofStorageId }
			: {}),
		createdAt: order.paymentClaimedAt,
	};
}

/** The order's claim rows, oldest first, bounded by the per-order cap. */
export async function paymentClaimRows(
	ctx: QueryCtx | MutationCtx,
	orderId: Id<"orders">,
): Promise<Doc<"paymentClaims">[]> {
	return await ctx.db
		.query("paymentClaims")
		.withIndex("by_order_createdAt", (q) => q.eq("orderId", orderId))
		.take(MAX_PAYMENT_CLAIMS_PER_ORDER);
}

/**
 * Every submission the buyer made on this order, oldest first: the stored rows,
 * or — for an order claimed before the table existed — its one rebuilt entry.
 */
export async function orderPaymentClaims(
	ctx: QueryCtx | MutationCtx,
	order: Doc<"orders">,
): Promise<PaymentClaimEntry[]> {
	const rows = await paymentClaimRows(ctx, order._id);
	if (rows.length > 0) {
		return rows.map((row) => ({
			...(row.reference !== undefined ? { reference: row.reference } : {}),
			...(row.proofStorageId !== undefined
				? { proofStorageId: row.proofStorageId }
				: {}),
			createdAt: row.createdAt,
		}));
	}
	const legacy = legacyClaimFromOrder(order);
	return legacy ? [legacy] : [];
}

/**
 * Append one submission. Called by `claimPayment` BEFORE it patches the order,
 * so a legacy order's pre-table submission is still readable from the order
 * and gets written as the first row — otherwise the patch would overwrite the
 * only copy. Refuses past the per-order cap.
 */
export async function recordPaymentClaim(
	ctx: MutationCtx,
	order: Doc<"orders">,
	submission: { reference?: string; proofStorageId?: string },
	now: number,
): Promise<void> {
	// A bare "I've paid" (both fields optional) still flips the order to
	// claimed, but leaves nothing to look at — recording it would only add
	// noise rows, and twenty of them would lock the buyer out of ever
	// attaching a screenshot.
	if (
		submission.reference === undefined &&
		submission.proofStorageId === undefined
	) {
		return;
	}
	const rows = await paymentClaimRows(ctx, order._id);
	if (rows.length >= MAX_PAYMENT_CLAIMS_PER_ORDER) {
		throw new ConvexError(PAYMENT_CLAIM_LIMIT_MESSAGE);
	}
	if (rows.length === 0) {
		const legacy = legacyClaimFromOrder(order);
		if (legacy) await ctx.db.insert("paymentClaims", { orderId: order._id, ...legacy });
	}
	await ctx.db.insert("paymentClaims", {
		orderId: order._id,
		...(submission.reference !== undefined
			? { reference: submission.reference }
			: {}),
		...(submission.proofStorageId !== undefined
			? { proofStorageId: submission.proofStorageId }
			: {}),
		createdAt: now,
	});
}

/**
 * Which submission leads the seller's card: the newest one carrying a
 * screenshot — the image the seller checks the transfer against, and the one
 * `orders.paymentProofStorageId` points at — else the newest of all. A later
 * reference-only resubmit doesn't erase a screenshot, so it mustn't bump it
 * out of the lead either. Index into `entries` (oldest first); -1 when empty.
 */
export function currentClaimIndex(
	entries: readonly PaymentClaimEntry[],
): number {
	for (let i = entries.length - 1; i >= 0; i--) {
		if (entries[i].proofStorageId !== undefined) return i;
	}
	return entries.length - 1;
}

/**
 * The reference to show beside the lead when it belongs to a DIFFERENT
 * submission — the newest reference the buyer sent anywhere in this order's
 * history, with when it was sent. Null when the lead already carries that
 * newest reference, or nobody ever sent one.
 *
 * **The newest reference wins, even over one the lead carries itself.** A
 * resubmit is always a correction or an addition, never a regression: a buyer
 * who sends a screenshot with a typo'd reference and then sends the corrected
 * one must not leave the seller reconciling by the typo. This used to return
 * null whenever the lead had any reference of its own, which is also why the
 * seller's two cards disagreed — the amber card read the ORDER's
 * `paymentReference` (always the newest) while the green card read the lead's
 * own, so the same order showed one number while the seller was deciding and
 * another after the payment was in (found by driving it, z8r3fdnpxf).
 *
 * The lead is still the submission carrying the SCREENSHOT (`currentClaimIndex`)
 * — the image is the evidence, the reference is just the string beside it.
 */
export function borrowedLeadReference(
	entries: readonly PaymentClaimEntry[],
	leadIndex: number,
): { reference: string; createdAt: number } | null {
	if (leadIndex < 0) return null;
	for (let i = entries.length - 1; i >= 0; i--) {
		const reference = entries[i].reference;
		if (reference === undefined) continue;
		// The newest reference anywhere. If the lead is already carrying it,
		// there is nothing to attribute elsewhere.
		return i === leadIndex ? null : { reference, createdAt: entries[i].createdAt };
	}
	return null;
}
