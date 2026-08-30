/**
 * Data migrations for the flat→variant cutover (docs/product-variants.md §9).
 *
 * This is the *backfill* (migrate) stage of widen-migrate-narrow: the schema
 * already widened (products.price/stock optional, productVariants added). This
 * gives every pre-variant product its implicit default variant so reads can
 * switch to variant-first. The *narrow* stage (drop products.price/stock/sku,
 * make options required) is a separate, later task — do NOT fold it in here.
 *
 * Idempotent: a product that already owns ≥1 variant is skipped, so re-running
 * is safe. Batched + self-scheduling to stay within mutation transaction limits.
 *
 * Run: `npx convex run migrations:backfillDefaultVariants`
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { generateTrackingToken } from "./lib/order";
import { isOrderPaymentMethod } from "./lib/paymentMethod";
import { createCategoryNameMemo, resolveCategoryNames } from "./orders";

const BATCH_SIZE = 50;

export const backfillDefaultVariants = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, { cursor }) => {
		const page = await ctx.db
			.query("products")
			.paginate({ numItems: BATCH_SIZE, cursor: cursor ?? null });

		const now = Date.now();
		let created = 0;
		for (const product of page.page) {
			// Backfill the options array on pre-variant rows so the
			// implicit-default invariant ("every product has options, even []")
			// holds uniformly.
			if (product.options === undefined) {
				await ctx.db.patch(product._id, { options: [], updatedAt: now });
			}

			const existing = await ctx.db
				.query("productVariants")
				.withIndex("by_product", (q) => q.eq("productId", product._id))
				.first();
			if (existing) continue; // already migrated — idempotent skip

			await ctx.db.insert("productVariants", {
				productId: product._id,
				retailerId: product.retailerId,
				optionValues: [],
				sku: product.sku,
				price: product.price ?? 0,
				onHand: product.stock ?? 0,
				reserved: 0,
				parcelWeightG: 0,
				imageStorageIds: [],
				active: true,
				sortOrder: 0,
				createdAt: product.createdAt,
				updatedAt: now,
			});
			created++;
		}

		if (!page.isDone) {
			await ctx.scheduler.runAfter(
				0,
				internal.migrations.backfillDefaultVariants,
				{ cursor: page.continueCursor },
			);
		}
		return { created, isDone: page.isDone };
	},
});

/**
 * Materialize the per-variant `blockWhenOutOfStock` + `requiresProof` flags from
 * the (now-deprecated) product-level fields. Reads already fall back to the
 * product value (`variant.X ?? product.X`), so this is *not* required for
 * correctness — it's a clean-up so the per-variant columns become the single
 * source of truth and the product-level fields can be narrowed away later.
 *
 * Idempotent: only patches a variant whose flag is still `undefined`. A variant
 * the seller has since edited per-row (flag already set) is left untouched.
 * Batched + self-scheduling like backfillDefaultVariants.
 *
 * Run: `npx convex run migrations:backfillVariantFlags`
 */
export const backfillVariantFlags = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, { cursor }) => {
		const page = await ctx.db
			.query("productVariants")
			.paginate({ numItems: BATCH_SIZE, cursor: cursor ?? null });

		const now = Date.now();
		let patched = 0;
		// Cache product lookups within the batch — many variants share a product.
		const productCache = new Map<
			string,
			{ blockWhenOutOfStock?: boolean; requiresProof?: boolean } | null
		>();
		for (const variant of page.page) {
			if (
				variant.blockWhenOutOfStock !== undefined &&
				variant.requiresProof !== undefined
			)
				continue; // both already set — nothing to materialize

			const key = variant.productId;
			let product = productCache.get(key);
			if (product === undefined) {
				const doc = await ctx.db.get(variant.productId);
				product = doc
					? {
							blockWhenOutOfStock: doc.blockWhenOutOfStock,
							requiresProof: doc.requiresProof,
						}
					: null;
				productCache.set(key, product);
			}
			if (!product) continue; // orphan variant — leave for the integrity sweep

			const patch: {
				blockWhenOutOfStock?: boolean;
				requiresProof?: boolean;
				updatedAt: number;
			} = { updatedAt: now };
			if (variant.blockWhenOutOfStock === undefined)
				patch.blockWhenOutOfStock = product.blockWhenOutOfStock ?? false;
			if (variant.requiresProof === undefined)
				patch.requiresProof = product.requiresProof ?? false;
			await ctx.db.patch(variant._id, patch);
			patched++;
		}

		if (!page.isDone) {
			await ctx.scheduler.runAfter(
				0,
				internal.migrations.backfillVariantFlags,
				{ cursor: page.continueCursor },
			);
		}
		return { patched, isDone: page.isDone };
	},
});

/**
 * Backfill the `trackingToken` capability on orders created before the
 * shortId→token hardening (docs/infra-cost-scaling.md §6). Every order needs an
 * unguessable token so its no-auth tracking page can't be enumerated. New orders
 * get one at create; this fills the gap for existing rows.
 *
 * Idempotent: only generates a token for orders that lack one. Batched +
 * self-scheduling to stay within mutation transaction limits.
 *
 * Run: `npx convex run migrations:backfillTrackingTokens`
 */
export const backfillTrackingTokens = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, { cursor }) => {
		const page = await ctx.db
			.query("orders")
			.paginate({ numItems: BATCH_SIZE, cursor: cursor ?? null });

		const now = Date.now();
		let patched = 0;
		for (const order of page.page) {
			if (order.trackingToken) continue; // already has one — idempotent skip
			await ctx.db.patch(order._id, {
				trackingToken: generateTrackingToken(),
				updatedAt: now,
			});
			patched++;
		}

		if (!page.isDone) {
			await ctx.scheduler.runAfter(
				0,
				internal.migrations.backfillTrackingTokens,
				{ cursor: page.continueCursor },
			);
		}
		return { patched, isDone: page.isDone };
	},
});

/**
 * Migrate early Counter Checkout orders that recorded the in-person method as a
 * synthetic `paymentReference` string ("In-person (cash)") to the structured
 * `paymentMethod` enum, clearing the synthetic reference. Idempotent: only
 * touches rows whose reference still matches that pattern. Batched +
 * self-scheduling.
 *
 * Run: `npx convex run migrations:backfillCounterPaymentMethod`
 */
export const backfillCounterPaymentMethod = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, { cursor }) => {
		const page = await ctx.db
			.query("orders")
			.paginate({ numItems: BATCH_SIZE, cursor: cursor ?? null });

		const now = Date.now();
		let patched = 0;
		for (const order of page.page) {
			if (order.paymentMethod) continue; // already structured
			const match = order.paymentReference?.match(/^In-person \((.+)\)$/i);
			if (!match) continue;
			const method = match[1].toLowerCase();
			if (!isOrderPaymentMethod(method)) continue;
			await ctx.db.patch(order._id, {
				paymentMethod: method,
				paymentReference: undefined, // drop the synthetic label
				updatedAt: now,
			});
			patched++;
		}

		if (!page.isDone) {
			await ctx.scheduler.runAfter(
				0,
				internal.migrations.backfillCounterPaymentMethod,
				{ cursor: page.continueCursor },
			);
		}
		return { patched, isDone: page.isDone };
	},
});

/**
 * Stamp `orders.items[].categoryNames` on orders that predate the field
 * (86eyrtz74).
 *
 * New orders freeze their categories at checkout, so the inbox table, the CSV
 * export and free-text search all read them for free. Orders placed before that
 * shipped have nothing to read, and would show a blank Categories cell forever.
 *
 * **This necessarily stamps TODAY's categorisation.** There is no record of
 * what a product was filed under last March, so a historical order gets the
 * catalogue as it stands the moment this runs — the one thing freezing exists
 * to avoid. That is an accepted trade for a one-time, manually-invoked catch-up
 * (a permanently empty column is worse than an approximate one), and it is why
 * this is a `npx convex run` and not something the app ever does by itself.
 * Everything from here on is exact.
 *
 * Idempotent: an order whose every line already carries the field is skipped,
 * so a second run is a no-op and a re-run after a crash resumes cleanly. The
 * order's `updatedAt` is deliberately NOT bumped — recording metadata about a
 * sale is not a change to the sale, and bumping it would make every order in
 * the store look freshly touched.
 *
 * Batched + self-scheduling, with one products/categories cache per batch so a
 * store selling the same 40 products across 500 orders reads each of them once
 * per batch rather than once per order.
 *
 * Run: `npx convex run migrations:backfillOrderCategoryNames`
 */
export const backfillOrderCategoryNames = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, { cursor }) => {
		const page = await ctx.db
			.query("orders")
			.paginate({ numItems: BATCH_SIZE, cursor: cursor ?? null });

		const memo = createCategoryNameMemo();
		let patched = 0;
		for (const order of page.page) {
			// Fully stamped already → nothing to do. `every`, not `some`: a
			// partially stamped order (an interrupted run, an order whose lines were
			// edited) still deserves finishing.
			if (order.items.every((i) => i.categoryNames !== undefined)) continue;
			const names = await resolveCategoryNames(
				ctx,
				order.items.map((i) => i.productId),
				memo,
			);
			await ctx.db.patch(order._id, {
				items: order.items.map((i) => ({
					...i,
					// Existing stamps win — this fills gaps, it never re-dates a line
					// that already carries its own record.
					categoryNames: i.categoryNames ?? names.get(i.productId) ?? [],
				})),
			});
			patched++;
		}

		if (!page.isDone) {
			await ctx.scheduler.runAfter(
				0,
				internal.migrations.backfillOrderCategoryNames,
				{ cursor: page.continueCursor },
			);
		}
		return { patched, isDone: page.isDone };
	},
});
