/**
 * The one place that knows every storage blob an ORDER row owns (86eyetzbk).
 * Two very different callers erase orders — the surgical admin hard delete
 * (`deleteOrderCascade` in convex/orders.ts) and the account-deletion cascade
 * (`retailers.deleteUser`) — and before this each open-coded its own blob
 * list, so the account cascade quietly freed only the payment proof while
 * leaking the buyer's reference image and the mockup image(s). One shared
 * helper means a future order-owned blob field is freed by both callers or
 * neither, never by just one. (Same posture as `productDelete.ts` for the
 * product side.)
 *
 * "Owned" = uploaded for THIS order and referenced nowhere else: the buyer's
 * custom-order reference image, the payment-proof screenshot(s) — the latest
 * on the order plus any earlier ones in `paymentClaims` — and the seller's
 * mockup image(s). NOT included, deliberately: order receipt/invoice PDFs are
 * generated on demand and never persisted (nothing to reclaim), and
 * subscription invoices are billing artefacts on their own table, tied to
 * `subscriptions` rather than orders. Delivery POD photos live on
 * `deliveryJobs`, which each cascade sweeps itself.
 */

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { paymentClaimRows } from "./paymentClaims";

/**
 * Deduped ids of every blob the order owns. The legacy singular
 * `mockupImageStorageId` is kept in sync as `mockupImageStorageIds[0]`
 * (see docs/proof-approval.md), hence the dedupe via a Set.
 */
export function orderOwnedBlobIds(order: Doc<"orders">): Set<string> {
	const ids = new Set<string>();
	if (order.customerImageStorageId) ids.add(order.customerImageStorageId);
	if (order.paymentProofStorageId) ids.add(order.paymentProofStorageId);
	for (const id of order.mockupImageStorageIds ??
		(order.mockupImageStorageId ? [order.mockupImageStorageId] : [])) {
		ids.add(id);
	}
	return ids;
}

/**
 * Delete every blob the order owns — its own fields plus every screenshot in
 * its `paymentClaims` history (z8r3fdn2uj), whose rows go with them: a claim
 * row is nothing but a pointer at an order's blob, so the two are freed in one
 * place and both cascades get it. Per-blob errors are swallowed — a blob may
 * already be gone, and a missing blob must never abort a deletion cascade.
 */
export async function deleteOrderOwnedBlobs(
	ctx: MutationCtx,
	order: Doc<"orders">,
): Promise<void> {
	const ids = orderOwnedBlobIds(order);
	// Bounded by MAX_PAYMENT_CLAIMS_PER_ORDER, so one read clears the history.
	for (const claim of await paymentClaimRows(ctx, order._id)) {
		if (claim.proofStorageId) ids.add(claim.proofStorageId);
		await ctx.db.delete(claim._id);
	}
	for (const id of ids) {
		try {
			await ctx.storage.delete(id as Id<"_storage">);
		} catch {
			// already deleted / never existed — nothing to reclaim
		}
	}
}
