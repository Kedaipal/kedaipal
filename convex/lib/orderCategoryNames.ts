// Category names frozen onto order lines at create (86eyrtz74). Lives in lib so
// EVERY order door — storefront (`orders.create`), counter, claim, booking —
// stamps through the same helper. Each door builds its own line snapshot, so a
// frozen field kept in one module was stamped by one door only: counter, claim
// and booking orders shipped with no categories and read "Uncategorized" in the
// inbox filter whatever the seller had filed. See docs/order-inbox.md.

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * A cache that lets `resolveCategoryNames` be called repeatedly without
 * re-reading the same products and categories. One order at checkout doesn't
 * need it (a fresh map per call is the same thing); the backfill, which walks a
 * whole store's orders over the same handful of products, very much does.
 */
export interface CategoryNameMemo {
	/** productId → its sorted category names. */
	byProduct: Map<string, string[]>;
	/** categoryId → name, so a category shared by 40 products is read once. */
	byCategory: Map<string, string>;
}

export function createCategoryNameMemo(): CategoryNameMemo {
	return { byProduct: new Map(), byCategory: new Map() };
}

/**
 * Category names for a set of products, resolved once per distinct id. Used at
 * ORDER CREATE to freeze `items[].categoryNames`, so every later read — table,
 * export, search — is free.
 *
 * Archived categories are included: they name a real grouping the seller was
 * using at the time, and this is a record of that moment.
 */
export async function resolveCategoryNames(
	ctx: MutationCtx,
	productIds: Iterable<Id<"products">>,
	memo: CategoryNameMemo = createCategoryNameMemo(),
): Promise<Map<string, string[]>> {
	const out = new Map<string, string[]>();
	for (const productId of new Set(productIds)) {
		const cached = memo.byProduct.get(productId);
		if (cached) {
			out.set(productId, cached);
			continue;
		}
		const joins = await ctx.db
			.query("productCategories")
			.withIndex("by_product", (q) => q.eq("productId", productId))
			.collect();
		const names: string[] = [];
		for (const j of joins) {
			let name = memo.byCategory.get(j.categoryId);
			if (name === undefined) {
				const cat = await ctx.db.get(j.categoryId);
				if (!cat) continue;
				name = cat.name;
				memo.byCategory.set(j.categoryId, name);
			}
			names.push(name);
		}
		names.sort((a, b) => a.localeCompare(b));
		memo.byProduct.set(productId, names);
		out.set(productId, names);
	}
	return out;
}

/**
 * The order lines with `categoryNames` frozen on each — the one call every
 * order door makes just before its insert. Always stamped, `[]` included:
 * PRESENT means "we recorded what this product was filed under when it sold",
 * and "filed under nothing" is a real answer. Absent is reserved for orders
 * that predate the field, so the two never look alike.
 */
export async function withCategoryNames<
	T extends { productId: Id<"products"> },
>(
	ctx: MutationCtx,
	lines: readonly T[],
): Promise<(T & { categoryNames: string[] })[]> {
	const names = await resolveCategoryNames(
		ctx,
		lines.map((l) => l.productId),
	);
	return lines.map((l) => ({
		...l,
		categoryNames: names.get(l.productId) ?? [],
	}));
}

/**
 * Orders scanned per batch when a product gains a category. The first batch
 * runs inside the seller's save, so the save can say how many orders it filed;
 * the rest run as scheduled batches. 200 orders is a small read next to the
 * inbox's own 1,000-order window.
 */
export const PAST_ORDER_FILING_PAGE = 200;

export interface PastOrderFilingPage {
	/** Orders in this batch that had a line filed. */
	filed: number;
	isDone: boolean;
	continueCursor: string;
}

/**
 * File one batch of a store's orders, newest first, under a product's CURRENT
 * categories — but only the lines of that product that recorded none (`[]`, or
 * absent on an order that predates the field). A line that already carries
 * names keeps them: that is the sale-time record freezing exists to keep.
 *
 * Why this exists: a seller who sets up categories after taking orders found
 * every one of them "Uncategorized" in the inbox filter, with nothing on screen
 * saying why (Dr Niki Trainings, 28 Oct 2026). "Filed under nothing" was true
 * when sold, but the seller filing the product now is telling us where those
 * orders belong.
 *
 * `updatedAt` is left alone, as in `backfillOrderCategoryNames`: recording
 * metadata about a sale is not a change to the sale.
 */
export async function filePastOrdersPage(
	ctx: MutationCtx,
	args: {
		retailerId: Id<"retailers">;
		productId: Id<"products">;
		cursor: string | null;
	},
): Promise<PastOrderFilingPage> {
	const names =
		(await resolveCategoryNames(ctx, [args.productId])).get(args.productId) ??
		[];
	// Nothing to file under (every category removed before a scheduled batch
	// ran): stop here rather than walk the whole history writing nothing.
	if (names.length === 0)
		return { filed: 0, isDone: true, continueCursor: args.cursor ?? "" };
	const product = await ctx.db.get(args.productId);
	if (!product)
		return { filed: 0, isDone: true, continueCursor: args.cursor ?? "" };

	// No index reaches an order by its lines, so this walks the store's orders —
	// but only those placed after the product existed, since no older order can
	// hold it. A brand-new product (the create page files it too) reads nothing.
	const page = await ctx.db
		.query("orders")
		.withIndex("by_retailer", (q) =>
			q
				.eq("retailerId", args.retailerId)
				.gte("_creationTime", product._creationTime),
		)
		.order("desc")
		.paginate({ numItems: PAST_ORDER_FILING_PAGE, cursor: args.cursor });

	let filed = 0;
	for (const order of page.page) {
		const needsFiling = (line: (typeof order.items)[number]) =>
			line.productId === args.productId &&
			(line.categoryNames === undefined || line.categoryNames.length === 0);
		if (!order.items.some(needsFiling)) continue;
		await ctx.db.patch(order._id, {
			items: order.items.map((line) =>
				needsFiling(line) ? { ...line, categoryNames: names } : line,
			),
		});
		filed++;
	}
	return {
		filed,
		isDone: page.isDone,
		continueCursor: page.continueCursor,
	};
}
