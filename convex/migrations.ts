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
