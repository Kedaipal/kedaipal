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
 *  - `creditLedger` rows (Credits, 86eye2ccu) — the financial record of what
 *    the seller bought and spent (purchased credits are deferred revenue until
 *    spent or expired). Like invoices: seller billing data, no buyer PII, kept
 *    for bookkeeping. Their `retailerId`/`orderId` refs dangle — expected.
 *  - `creditPurchases` rows + their `receiptPdfStorageId` blobs (Credits T2,
 *    z8r3fdf8ht) — what the seller paid Kedaipal for top-up packs, the same
 *    kind of record as an invoice. Their `creditPurchases` PHASE doesn't
 *    delete them: it closes every still-pending checkout (below).
 *  - `adminAuditLog` rows — an audit trail must outlive the tenant it audited
 *    (`targetId`s are doc ids / last-4 only, never buyer PII).
 *  - `messageLogRollups` rows — the PERMANENT WhatsApp cost ledger (retailer ×
 *    MYT month × category × status). `purgeExpiredOutboundLog` folds every
 *    expiring `outboundMessageLog` row into its bucket precisely so aggregate
 *    cost accounting survives the 90-day purge "forever" (lib/retention.ts),
 *    and Meta bills us per send from Oct 2026 — so this is a record of what
 *    Kedaipal was CHARGED for a seller's traffic, the same class as an
 *    invoice. The rollup deliberately drops `toWaPhone`/`templateName`, so it
 *    carries counts and no buyer PII. The raw per-send rows (which do carry
 *    the buyer's number) ARE deleted, by the `outboundMessageLog` phase.
 *    `retailerId` is left dangling rather than cleared: it is the ledger's
 *    grouping key, and blanking it would merge a deleted tenant's months into
 *    the tenant-less bucket and corrupt both.
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
import { internal } from "../_generated/api";
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
	"bookingBlocks",
	"deliveryJobs",
	"deliveryQuotes",
	"customers",
	"pickupLocations",
	"counterCheckoutSessions",
	"orderClaims",
	"subscriptions",
	"subscriptionUsage",
	"creditPurchases",
	"creditAccounts",
	"creditLots",
	"foundingMembers",
	"retailerMembers",
	"retailerSendingLimits",
	"outboundMessageLog",
	"slugHistory",
	"optOuts",
	"retailer",
] as const;

export type DeletionPhase = (typeof DELETION_PHASES)[number];

/**
 * Phases that read via `.paginate()`. Convex permits ONE paginated query per
 * mutation invocation, so the driver must hand off to a scheduled continuation
 * instead of entering a second paginated phase in the same transaction. Found
 * the hard way (z8r3fdbmc9): on a small tenant `slugHistory` finished inside
 * its invocation's budget, the loop rolled straight into `optOuts`, and the
 * second `.paginate()` threw — aborting the invocation, rolling back its
 * writes, and stalling the cascade with no continuation scheduled. convex-test
 * does not enforce the limit, so only a real deployment surfaces this.
 */
export const PAGINATED_PHASES: ReadonlySet<DeletionPhase> = new Set([
	"slugHistory",
	"optOuts",
]);

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
		case "bookingBlocks": {
			// Availability windows the seller closed off ("Maintenance — river
			// deck repair"). Tenant-owned calendar config: no buyer PII and no
			// money, so nothing argues for keeping it once the store is gone.
			// Grouped with the catalogue phases above rather than appended,
			// because a block is a product's availability — the `productId` it
			// may carry points at rows the `products` phase has already deleted.
			// Index prefix: by_retailer_start with only the retailerId bound
			// covers every window.
			const rows = await ctx.db
				.query("bookingBlocks")
				.withIndex("by_retailer_start", (q) => q.eq("retailerId", retailerId))
				.take(limit);
			for (const block of rows) await ctx.db.delete(block._id);
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
		case "orderClaims": {
			// DELETED, not retained (claim links, 86eyq0epn). A claim is an OFFER
			// the seller sent a buyer — required `waPhone`, optional `buyerName`,
			// plus the frozen line snapshot — and never a record of what Kedaipal
			// CHARGED the seller, which is the one thing the header's retention
			// block keeps. Nothing survives the tenant to justify holding a
			// buyer's number, so the rows go.
			//
			// This phase is the doer the claim cron defers to: `purgeStaleClaims`
			// sweeps `expired`/`cancelled` rows past CLAIM_RETENTION_MS and
			// deliberately exempts `completed` ones, on the grounds that "order
			// retention is the PDPA pack's job" (convex/lib/orderClaims.ts). That
			// job had no doer here, so a completed claim kept its buyer's phone
			// and name indefinitely after the store was erased.
			//
			// Index prefix: by_retailer_status with only the retailerId bound
			// covers every status (same shape as counterCheckoutSessions above).
			// No blobs to free — a claim holds no storage ids. Position is not
			// load-bearing: rows are found by retailer, never through the
			// `sessionId` the phase above has already deleted.
			const rows = await ctx.db
				.query("orderClaims")
				.withIndex("by_retailer_status", (q) => q.eq("retailerId", retailerId))
				.take(limit);
			for (const claim of rows) await ctx.db.delete(claim._id);
			return { processed: rows.length, done: rows.length < limit };
		}
		case "subscriptions": {
			// A deleted tenant must not leave MONEY rails live (86eyb6z4r):
			//  - the saved-method session at HitPay is cancelled remotely
			//    (best-effort — with the local row gone nothing can ever charge,
			//    the DELETE is hygiene so the token doesn't outlive the account);
			//  - pending invoices are VOIDED (they're retained by decision, so
			//    they must not stay forever-payable) and their Pay-now links
			//    killed — a payment into a deleted store is only ever a refund.
			// Idempotent: voided invoices drop out of the pending filter, and a
			// re-entered batch finds no subscription rows left to act on.
			// Bounded like every sibling phase (the driver re-enters until a
			// batch comes back short). Voided rows drop out of this filter, so
			// re-entry never redoes work.
			const pending = await ctx.db
				.query("invoices")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.filter((q) => q.eq(q.field("status"), "pending"))
				.take(limit);
			for (const invoice of pending) {
				await ctx.db.patch(invoice._id, {
					status: "void",
					voidedAt: Date.now(),
					voidReason: "Account deleted",
				});
				if (invoice.gatewayRequestId) {
					await ctx.scheduler.runAfter(
						0,
						internal.subscriptionPayments.expireInvoiceRequest,
						{ requestId: invoice.gatewayRequestId },
					);
				}
			}
			const rows = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.take(limit);
			for (const subscription of rows) {
				if (subscription.autoRenewSessionId) {
					await ctx.scheduler.runAfter(
						0,
						internal.subscriptionPayments.deleteRecurringSession,
						{ sessionId: subscription.autoRenewSessionId },
					);
				}
				await ctx.db.delete(subscription._id);
			}
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
		case "creditPurchases": {
			// Retained by decision (see the header) — but, like a pending
			// invoice, a live top-up checkout must not outlive the store: a
			// payment into a deleted store is only ever a refund. Expire every
			// pending purchase and kill its HitPay link; a payment that still
			// slips through is stamped `late_payment` and never credited.
			// Expired rows drop out of the index range, so re-entry never
			// redoes work.
			const pending = await ctx.db
				.query("creditPurchases")
				.withIndex("by_retailer_status_created", (q) =>
					q.eq("retailerId", retailerId).eq("status", "pending"),
				)
				.take(limit);
			for (const purchase of pending) {
				await ctx.db.patch(purchase._id, {
					status: "expired",
					expiredAt: Date.now(),
				});
				if (purchase.gatewayRequestId) {
					await ctx.scheduler.runAfter(
						0,
						internal.creditPurchases.deletePurchaseRequest,
						{ requestId: purchase.gatewayRequestId },
					);
				}
			}
			return { processed: pending.length, done: pending.length < limit };
		}
		case "creditAccounts": {
			// The cached balance row (Credits, 86eye2ccu) — derived state, gone with
			// the tenant. The LEDGER is retained (see the header).
			const rows = await ctx.db
				.query("creditAccounts")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.take(limit);
			for (const account of rows) await ctx.db.delete(account._id);
			return { processed: rows.length, done: rows.length < limit };
		}
		case "creditLots": {
			// Index prefix: by_retailer_open_expiry with only the retailerId bound
			// — open and spent lots alike.
			const rows = await ctx.db
				.query("creditLots")
				.withIndex("by_retailer_open_expiry", (q) =>
					q.eq("retailerId", retailerId),
				)
				.take(limit);
			for (const lot of rows) await ctx.db.delete(lot._id);
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
		case "retailerMembers": {
			// Team seats (86exr91r4). Rows are DELETED, not marked — erasing the
			// tenant erases its people-records (member email + name are PII), and
			// a removed-marker would dangle once the retailer row goes. Each
			// still-active member gets the "store closed" email with the store
			// name SNAPSHOTTED into the args, because by send time there is no
			// retailer row left to read.
			const rows = await ctx.db
				.query("retailerMembers")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.take(limit);
			for (const member of rows) {
				if (member.status === "active") {
					await ctx.scheduler.runAfter(0, internal.team.sendTeamEmail, {
						kind: "teamAccessRevoked",
						to: member.email,
						revokeReason: "store_deleted",
						storeNameOverride: retailer.storeName,
						localeOverride: retailer.locale,
					});
				}
				await ctx.db.delete(member._id);
			}
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
