/**
 * Despatch labels (86eyp63mp) — Kedaipal's third PDF document, and the only one
 * that gets printed in stacks.
 *
 * Two entry points, deliberately separate rather than one action with a branch,
 * because they differ in exactly one important way — who may call them:
 *
 *  - `generateAwbPdf({ shortId })` — ONE label, from the order detail page.
 *    Auth is `resolveSharedOrder`'s owner-or-admin `shortId` arm, the same seam
 *    the receipt download uses, and it is ALL-TIER: a seller who ships a parcel
 *    must always be able to put an address on it.
 *  - `generateAwbBatchPdf(...)` — many labels merged into one PDF, from the
 *    order inbox's bulk bar and its "ready to ship" button. That is an Order
 *    Inbox surface (buckets/filters/bulk/CSV), so it rides the SAME `orderInbox`
 *    plan gate as `orders.exportOrders`, with admin act-as bypassing.
 *
 * Both render ON DEMAND and store nothing (the order-receipt precedent — the
 * bytes are deterministic from the order, so persisting a blob nobody may ever
 * download buys nothing). The subscription invoice's render-and-store is the
 * exception, not the rule.
 *
 * Pagination discipline mirrors `orders.exportOrders`: the batch resolves its
 * orders a page at a time so no single transaction has to hold 100 orders plus
 * their variants, and ownership is re-checked on every page.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	action,
	internalQuery,
	type QueryCtx,
} from "./_generated/server";
import { requireRetailerAccess } from "./lib/auth";
import { resolveAwbConfig } from "./lib/awbConfig";
import { type CartWeightItem, summarizeCartWeight } from "./lib/delivery";
import {
	AWB_BATCH_MAX,
	type AwbBatchItem,
	type AwbLabelData,
	type AwbSkipCounts,
	type AwbSort,
	awbSortKey,
	emptySkipCounts,
	isReadyToShipForLabel,
	labelSkipReason,
	orderToAwbLabelData,
	sortAwbItems,
} from "./lib/pdf/awb";
import { buildAwbPdf } from "./lib/pdf/render";
import { resolveSharedOrder } from "./orders";
import { assertPlanFeature } from "./subscriptions";

/** Orders resolved per transaction while a batch is assembled. */
const AWB_PAGE_SIZE = 20;
/** Ceiling on the ready-to-ship scan, matching the inbox's own window. */
const READY_SCAN_CAP = 1_000;

const awbSortValidator = v.union(
	v.literal("fulfilment"),
	v.literal("status"),
	v.literal("courier"),
	v.literal("area"),
);

/** The `/track/<token>` URL the label's QR points at. */
function trackUrlFor(order: Doc<"orders">): string | undefined {
	if (!order.trackingToken) return undefined;
	const appUrl = process.env.APP_URL ?? "https://kedaipal.com";
	return `${appUrl}/track/${order.trackingToken}`;
}

/**
 * Cart weight for the label, through the SAME summariser the weight/zone
 * delivery pricing uses — so an unweighable cart (a custom line, or a variant
 * with no `parcelWeightG`) resolves to `undefined` and the label simply prints
 * no weight instead of a number nobody can stand behind.
 */
async function resolveWeightGrams(
	ctx: QueryCtx,
	order: Doc<"orders">,
): Promise<number | undefined> {
	const items: CartWeightItem[] = await Promise.all(
		order.items.map(async (item): Promise<CartWeightItem> => {
			const variant = item.variantId ? await ctx.db.get(item.variantId) : null;
			return {
				parcelWeightG: variant?.parcelWeightG ?? 0,
				quantity: item.quantity,
				isCustom: variant?.isCustom === true,
			};
		}),
	);
	const summary = summarizeCartWeight(items);
	return summary.kind === "ok" ? summary.grams : undefined;
}

/** Build one label's view-model from an already-authorised order. */
async function buildLabel(
	ctx: QueryCtx,
	order: Doc<"orders">,
	retailer: Doc<"retailers">,
): Promise<AwbLabelData> {
	return orderToAwbLabelData({
		order,
		retailer,
		config: resolveAwbConfig(retailer.awbConfig),
		trackUrl: trackUrlFor(order),
		weightGrams: await resolveWeightGrams(ctx, order),
	});
}

/** URL of the seller's logo, when their template shows one and they have one. */
async function loadLogoUrl(
	ctx: QueryCtx,
	retailer: Doc<"retailers">,
): Promise<string | null> {
	if (!retailer.logoStorageId) return null;
	if (!resolveAwbConfig(retailer.awbConfig).showLogo) return null;
	return ctx.storage.getUrl(retailer.logoStorageId as Id<"_storage">);
}

/** Fetch the logo bytes in an action. A failure is never fatal — the label
 * leads with the store name, which is the part a courier reads. */
async function fetchLogoBytes(
	url: string | null,
): Promise<Uint8Array | undefined> {
	if (!url) return undefined;
	try {
		const res = await fetch(url);
		if (!res.ok) return undefined;
		return new Uint8Array(await res.arrayBuffer());
	} catch {
		return undefined;
	}
}

// --- Single label ----------------------------------------------------------

type SingleLabelResult =
	| { ok: true; label: AwbLabelData; paperSize: "a6" | "a4-4up"; logoUrl: string | null }
	| { ok: false; reason: "not_found" | "cancelled" | "no_address" };

/** Auth + view-model for one order's label. Owner-or-admin by `shortId` — a
 * buyer's tracking token is deliberately NOT accepted: the despatch label is a
 * seller document (it carries the sender's address and what's still to collect). */
export const singleLabelInputs = internalQuery({
	args: { shortId: v.string() },
	handler: async (ctx, { shortId }): Promise<SingleLabelResult> => {
		const order = await resolveSharedOrder(ctx, { shortId });
		if (!order) return { ok: false, reason: "not_found" };
		const skip = labelSkipReason(order);
		if (skip) return { ok: false, reason: skip === "cancelled" ? "cancelled" : "no_address" };
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) return { ok: false, reason: "not_found" };
		return {
			ok: true,
			label: await buildLabel(ctx, order, retailer),
			paperSize: resolveAwbConfig(retailer.awbConfig).paperSize,
			logoUrl: await loadLogoUrl(ctx, retailer),
		};
	},
});

/**
 * Render ONE order's despatch label. All-tier: the seller is shipping a parcel
 * either way, and a label with no address on it is not a business decision.
 * Returns `null` when the order can't carry a label, with the reason, so the
 * caller can say why rather than handing over an empty PDF.
 */
export const generateAwbPdf = action({
	args: { shortId: v.string() },
	handler: async (
		ctx,
		{ shortId },
	): Promise<
		| { ok: true; pdf: ArrayBuffer; filename: string }
		| { ok: false; reason: "not_found" | "cancelled" | "no_address" }
	> => {
		const inputs = await ctx.runQuery(internal.awb.singleLabelInputs, { shortId });
		if (!inputs.ok) return inputs;
		const bytes = await buildAwbPdf([inputs.label], {
			paperSize: inputs.paperSize,
			logo: await fetchLogoBytes(inputs.logoUrl),
		});
		return {
			ok: true,
			pdf: toArrayBuffer(bytes),
			filename: `Label-${shortId}.pdf`,
		};
	},
});

// --- Batch -----------------------------------------------------------------

type BatchPage = {
	items: AwbBatchItem[];
	skipped: AwbSkipCounts;
	paperSize: "a6" | "a4-4up";
	logoUrl: string | null;
};

/**
 * Owner OR Kedaipal admin acting-as, plus the Order Inbox plan gate — the exact
 * posture `orders.exportOrders` uses, because bulk label printing is the same
 * surface (the inbox's bulk bar) and the pricing table already sells bulk
 * actions as Pro. Single-label printing stays all-tier, so no seller is ever
 * unable to despatch.
 */
async function assertBatchAccess(
	ctx: QueryCtx,
	retailerId: Id<"retailers">,
): Promise<Doc<"retailers">> {
	const access = await requireRetailerAccess(ctx, retailerId);
	if (!access.actingAsAdmin)
		await assertPlanFeature(ctx, retailerId, "orderInbox");
	return access.retailer;
}

/** One page of an explicit id selection. Ownership is re-checked per order, so
 * a tampered id list can never pull another store's addresses. */
export const batchPageByIds = internalQuery({
	args: {
		retailerId: v.id("retailers"),
		orderIds: v.array(v.id("orders")),
	},
	handler: async (ctx, { retailerId, orderIds }): Promise<BatchPage> => {
		const retailer = await assertBatchAccess(ctx, retailerId);
		const skipped = emptySkipCounts();
		const items: AwbBatchItem[] = [];
		for (const id of orderIds) {
			const order = await ctx.db.get(id);
			if (!order || order.retailerId !== retailerId) {
				skipped.not_found++;
				continue;
			}
			const reason = labelSkipReason(order);
			if (reason) {
				skipped[reason]++;
				continue;
			}
			items.push({
				label: await buildLabel(ctx, order, retailer),
				sort: awbSortKey(order),
			});
		}
		return {
			items,
			skipped,
			paperSize: resolveAwbConfig(retailer.awbConfig).paperSize,
			logoUrl: await loadLogoUrl(ctx, retailer),
		};
	},
});

type ReadyIdsResult = {
	orderIds: Array<Id<"orders">>;
	/** How many ready orders exist beyond `AWB_BATCH_MAX` — surfaced, never
	 * silently dropped. */
	remaining: number;
};

/** Ids of everything packed, paid and going out by parcel — the one-click queue.
 * Newest-first scan over the same window the inbox reads, then reversed so the
 * OLDEST ready orders print first (they have been waiting longest). */
export const readyToShipIds = internalQuery({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<ReadyIdsResult> => {
		await assertBatchAccess(ctx, retailerId);
		const scanned = await ctx.db
			.query("orders")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.order("desc")
			.take(READY_SCAN_CAP);
		const ready = scanned.filter(isReadyToShipForLabel).reverse();
		return {
			orderIds: ready.slice(0, AWB_BATCH_MAX).map((o) => o._id),
			remaining: Math.max(0, ready.length - AWB_BATCH_MAX),
		};
	},
});

export type AwbBatchResult = {
	pdf: ArrayBuffer;
	filename: string;
	/** Labels actually in the PDF. */
	count: number;
	/** Orders that couldn't be labelled, by reason — the seller is always told. */
	skipped: AwbSkipCounts;
	/** Ready orders that didn't fit this batch (ready-to-ship mode only). */
	remaining: number;
};

/**
 * Render many despatch labels as ONE merged PDF.
 *
 * Two modes, mirroring `orders.exportOrders`:
 *   - `orderIds` supplied → exactly those owned orders (the seller's ticked
 *     selection). Over `AWB_BATCH_MAX` is refused, not truncated.
 *   - `orderIds` omitted → everything packed + paid + going out by parcel, the
 *     one-click despatch run. Capped at `AWB_BATCH_MAX` with `remaining`
 *     reported so the seller knows to print a second batch.
 *
 * Printing NEVER changes an order's status: a label in the printer tray is not
 * a parcel in a courier's hands, so the seller still marks them shipped when
 * they actually hand them over.
 */
export const generateAwbBatchPdf = action({
	args: {
		retailerId: v.id("retailers"),
		orderIds: v.optional(v.array(v.id("orders"))),
		sort: v.optional(awbSortValidator),
	},
	handler: async (ctx, { retailerId, orderIds, sort }): Promise<AwbBatchResult> => {
		let ids: Array<Id<"orders">>;
		let remaining = 0;
		let filenamePrefix: string;

		if (orderIds) {
			if (orderIds.length > AWB_BATCH_MAX) {
				throw new Error(
					`Print up to ${AWB_BATCH_MAX} labels at a time — you selected ${orderIds.length}.`,
				);
			}
			ids = orderIds;
			filenamePrefix = "labels";
		} else {
			const ready: ReadyIdsResult = await ctx.runQuery(
				internal.awb.readyToShipIds,
				{ retailerId },
			);
			ids = ready.orderIds;
			remaining = ready.remaining;
			filenamePrefix = "labels-ready-to-ship";
		}

		const items: AwbBatchItem[] = [];
		const skipped = emptySkipCounts();
		let paperSize: "a6" | "a4-4up" = "a4-4up";
		let logoUrl: string | null = null;
		// An empty selection still needs the store's paper size + logo resolved
		// (and its access checked), so the page loop always runs at least once.
		for (let i = 0; i < Math.max(1, ids.length); i += AWB_PAGE_SIZE) {
			const page: BatchPage = await ctx.runQuery(internal.awb.batchPageByIds, {
				retailerId,
				orderIds: ids.slice(i, i + AWB_PAGE_SIZE),
			});
			items.push(...page.items);
			for (const key of Object.keys(skipped) as Array<keyof AwbSkipCounts>) {
				skipped[key] += page.skipped[key];
			}
			paperSize = page.paperSize;
			logoUrl = page.logoUrl;
		}

		const ordered = sortAwbItems(items, (sort ?? "fulfilment") as AwbSort);
		const bytes = await buildAwbPdf(
			ordered.map((i) => i.label),
			{ paperSize, logo: await fetchLogoBytes(logoUrl) },
		);
		const stamp = new Date().toISOString().slice(0, 10);
		return {
			pdf: toArrayBuffer(bytes),
			filename: `${filenamePrefix}-${stamp}.pdf`,
			count: ordered.length,
			skipped,
			remaining,
		};
	},
});

/** Copy into a standalone ArrayBuffer so Convex serialises the exact bytes
 * (the `orders.generateReceiptPdf` precedent). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
}
