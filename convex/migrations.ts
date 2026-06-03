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
