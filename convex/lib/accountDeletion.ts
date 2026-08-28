/**
 * Account-deletion cascade phases (86eyetzbk, the PDPA erasure path). Runs the
 * table-by-table teardown behind `retailers.deleteUser` — the driver there
 * self-chains via the scheduler, calling `runDeletionPhase` with a bounded
 * batch each invocation so a large tenant can never exceed the single-mutation
 * read/write limits the old one-shot ACID version had.
 *
 * PHASE ORDER (`DELETION_PHASES`). Only two orderings are load-bearing:
 *  - `products` runs before `productCategories`/`categories` — the product
 *    cascade drops each product's junction rows itself, so the junction phase
 *    is just a leftovers sweep and the category rows go last.
 *  - `retailer` is LAST: the retailer row is the tenant anchor a continuation
 *    batch re-resolves by `userId`, so it must survive until every other phase
 *    has finished. Everything else is grouped roughly buyer-PII-first.
 *
 * RETAINED BY DECISION (documented, not omissions):
 *  - `invoices` rows + their frozen `pdfStorageId` blobs — financial/billing
 *    records of what Kedaipal charged the seller. They carry seller billing
 *    data only (no buyer PII) and must survive the tenant for bookkeeping/tax.
 *    Their `retailerId`/`subscriptionId` refs dangle after deletion — expected
 *    for a retained record of a deleted tenant.
 *  - `adminAuditLog` rows — an audit trail must outlive the tenant it audited
 *    (`targetId`s are doc ids / last-4 only, never buyer PII).
 *  - `optOuts` rows are the buyer's standing suppression instruction, GLOBAL
 *    across every retailer on the shared WABA — deleting one would re-enable
 *    messages the buyer said stop to. The phase only clears
 *    `triggeredByRetailerId` on rows pointing at the deleted tenant, so no
 *    dangling ref remains while the suppression itself stands.
 *
 * Every phase is idempotent (take-a-batch-and-delete, or a cursor scan whose
 * matches are patched exactly once), so re-entry after a crash just resumes.
 */

import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { deleteOrderOwnedBlobs } from "./orderBlobs";
import { collectQrStorageIds } from "./payment";
import { deleteProductCascade } from "./productDelete";

export const DELETION_PHASES = [
	"orders",
	"products",
	"productCategories",
	"categories",
	"deliveryJobs",
	"deliveryQuotes",
	"customers",
	"pickupLocations",
	"counterCheckoutSessions",
	"subscriptions",
	"subscriptionUsage",
	"foundingMembers",
	"retailerSendingLimits",
	"outboundMessageLog",
	"slugHistory",
	"optOuts",
	"retailer",
] as const;

export type DeletionPhase = (typeof DELETION_PHASES)[number];

/** Arg validator for the driver's continuation state. Built from
 * DELETION_PHASES so adding a phase can't drift the validator. */
export const deletionPhaseValidator = v.union(
	...DELETION_PHASES.map((phase) => v.literal(phase)),
);

export type DeletionPhaseResult = {
	/**
	 * Documents processed this call — deleted rows for the indexed phases,
	 * SCANNED rows for the two full-table-scan phases (`slugHistory`,
	 * `optOuts`), because scanning is what consumes the transaction budget
	 * there even when nothing matches.
	 */
	processed: number;
	/** True when this phase has nothing left for the tenant. */
	done: boolean;
	/** Continuation cursor — only meaningful for the full-table-scan phases. */
	cursor?: string | null;
};

/** Tolerant blob delete — a missing blob is not an error worth aborting for. */
async function deleteBlob(
	ctx: MutationCtx,
	storageId: string | undefined,
): Promise<void> {
	if (!storageId) return;
	try {
		await ctx.storage.delete(storageId as Id<"_storage">);
	} catch {
		// already gone — ignore
	}
}

/**
 * Run one bounded batch of a deletion phase for the tenant. `limit` caps the
 * documents processed (must be ≥ 1); `cursor` is threaded only by the
 * full-table-scan phases. The final `retailer` phase deletes the retailer's
 * own blobs (logo, cover, payment QRs) and then the row itself.
 */
export async function runDeletionPhase(
	ctx: MutationCtx,
	retailer: Doc<"retailers">,
	phase: DeletionPhase,
	limit: number,
	cursor: string | null,
): Promise<DeletionPhaseResult> {
	const retailerId = retailer._id;
	switch (phase) {
		case "orders": {
			const rows = await ctx.db
				.query("orders")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.take(limit);
			for (const order of rows) {
				// Per-order event timelines are small (dozens of rows at most), so a
				// collect inside the bounded order batch stays well within limits.
				const events = await ctx.db
					.query("orderEvents")
					.withIndex("by_order", (q) => q.eq("orderId", order._id))
					.collect();
				for (const event of events) await ctx.db.delete(event._id);
				// Shared with deleteOrderCascade (convex/lib/orderBlobs.ts) — buyer
				// reference image + payment proof + mockup image(s), deduped.
				await deleteOrderOwnedBlobs(ctx, order);
				await ctx.db.delete(order._id);
			}
			return { processed: rows.length, done: rows.length < limit };
		}
		case "products": {
			// Shared cascade (variants + their images, own images, junction rows)
			// so this can't drift from products.deletePermanently. Category
			// `productCount` is deliberately NOT maintained — the category rows are
			// deleted wholesale a phase later, patching them first is pure waste.
			const rows = await ctx.db
				.query("products")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.take(limit);
			for (const product of rows) await deleteProductCascade(ctx, product);
			return { processed: rows.length, done: rows.length < limit };
		}
		case "productCategories": {
			// Leftovers sweep — the products phase already dropped each product's
			// junctions; this catches any row orphaned by historical bugs.
			const rows = await ctx.db
				.query("productCategories")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.take(limit);
			for (const junction of rows) await ctx.db.delete(junction._id);
			return { processed: rows.length, done: rows.length < limit };
		}
		case "categories": {
			const rows = await ctx.db
				.query("categories")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.take(limit);
			for (const category of rows) {
				await deleteBlob(ctx, category.imageStorageId);
				await ctx.db.delete(category._id);
			}
			return { processed: rows.length, done: rows.length < limit };
		}
		case "deliveryJobs": {
			const rows = await ctx.db
				.query("deliveryJobs")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.take(limit);
			for (const job of rows) {
				for (const podId of job.podImageStorageIds ?? []) {
					await deleteBlob(ctx, podId);
				}
				await ctx.db.delete(job._id);
			}
			return { processed: rows.length, done: rows.length < limit };
		}
		case "deliveryQuotes": {
			const rows = await ctx.db
				.query("deliveryQuotes")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.take(limit);
			for (const quote of rows) await ctx.db.delete(quote._id);
			return { processed: rows.length, done: rows.length < limit };
		}
		case "customers": {
			const rows = await ctx.db
				.query("customers")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.take(limit);
			for (const customer of rows) await ctx.db.delete(customer._id);
			return { processed: rows.length, done: rows.length < limit };
		}
		case "pickupLocations": {
			// Holds manager name + phone — PII the old cascade orphaned.
			const rows = await ctx.db
				.query("pickupLocations")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.take(limit);
			for (const location of rows) await ctx.db.delete(location._id);
			return { processed: rows.length, done: rows.length < limit };
		}
		case "counterCheckoutSessions": {
			// Holds buyer waPhone + pushname — PII the old cascade orphaned.
			// Index prefix: by_retailer_status with only the retailerId bound
			// covers every status.
			const rows = await ctx.db
				.query("counterCheckoutSessions")
				.withIndex("by_retailer_status", (q) => q.eq("retailerId", retailerId))
				.take(limit);
			for (const session of rows) await ctx.db.delete(session._id);
			return { processed: rows.length, done: rows.length < limit };
		}
		case "subscriptions": {
			const rows = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.take(limit);
			for (const subscription of rows) await ctx.db.delete(subscription._id);
			return { processed: rows.length, done: rows.length < limit };
		}
		case "subscriptionUsage": {
			// Index prefix: by_retailer_month with only the retailerId bound.
			const rows = await ctx.db
				.query("subscriptionUsage")
				.withIndex("by_retailer_month", (q) => q.eq("retailerId", retailerId))
				.take(limit);
			for (const usage of rows) await ctx.db.delete(usage._id);
			return { processed: rows.length, done: rows.length < limit };
		}
		case "foundingMembers": {
			const rows = await ctx.db
				.query("foundingMembers")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.take(limit);
			for (const member of rows) await ctx.db.delete(member._id);
			return { processed: rows.length, done: rows.length < limit };
		}
		case "retailerSendingLimits": {
			const rows = await ctx.db
				.query("retailerSendingLimits")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.take(limit);
			for (const limits of rows) await ctx.db.delete(limits._id);
			return { processed: rows.length, done: rows.length < limit };
		}
		case "outboundMessageLog": {
			// Rows carry the buyer's toWaPhone. Index prefix: by_retailer_sent with
			// only the retailerId bound. (Rows with retailerId unset — system
			// replies to unknown senders — belong to no tenant and stay.)
			const rows = await ctx.db
				.query("outboundMessageLog")
				.withIndex("by_retailer_sent", (q) => q.eq("retailerId", retailerId))
				.take(limit);
			for (const log of rows) await ctx.db.delete(log._id);
			return { processed: rows.length, done: rows.length < limit };
		}
		case "slugHistory": {
			// No by-retailer index (small, TTL-pruned table) — a paginated
			// full-table scan deleting only this tenant's rows. Deleting returned
			// rows mid-pagination is safe: cursors are index positions.
			const page = await ctx.db
				.query("slugHistory")
				.paginate({ numItems: limit, cursor });
			for (const row of page.page) {
				if (row.retailerId === retailerId) await ctx.db.delete(row._id);
			}
			return {
				processed: page.page.length,
				done: page.isDone,
				cursor: page.continueCursor,
			};
		}
		case "optOuts": {
			// NEVER deleted — an opt-out is the buyer's standing suppression
			// instruction, global across the shared WABA. Only the attribution ref
			// is cleared so nothing dangles. No index on triggeredByRetailerId
			// (rare field, small table) — paginated full-table scan, and patched
			// rows keep their index position so the cursor walk is exact.
			const page = await ctx.db
				.query("optOuts")
				.paginate({ numItems: limit, cursor });
			for (const row of page.page) {
				if (row.triggeredByRetailerId === retailerId) {
					await ctx.db.patch(row._id, { triggeredByRetailerId: undefined });
				}
			}
			return {
				processed: page.page.length,
				done: page.isDone,
				cursor: page.continueCursor,
			};
		}
		case "retailer": {
			// Final phase — the tenant anchor goes last so a continuation batch can
			// always re-resolve the retailer by userId. Every QR image across the
			// methods array AND the legacy single object.
			await deleteBlob(ctx, retailer.logoStorageId);
			await deleteBlob(ctx, retailer.coverImageStorageId);
			for (const qrId of collectQrStorageIds(retailer)) {
				await deleteBlob(ctx, qrId);
			}
			await ctx.db.delete(retailerId);
			return { processed: 1, done: true };
		}
	}
}
