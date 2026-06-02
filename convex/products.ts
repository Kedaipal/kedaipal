import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { rateLimiter } from "./lib/rateLimiter";
import {
	cartesian,
	isValidCombination,
	type OptionAxis,
	normalizeOptions,
	sameOptionValues,
	variantLabel,
} from "./lib/variant";

const MAX_IMAGES_PER_PRODUCT = 5;
const MAX_IMAGES_PER_VARIANT = 3;
const MAX_BULK_IMPORT_BATCH = 50;
const MAX_PRODUCTS_PER_RETAILER = 50; // beta cap
const MAX_SKU_LENGTH = 60;

/**
 * Normalize an optional SKU: trim; treat empty string as "no SKU". Throws
 * `ConvexError` on length violation. Returns the stored value (string or
 * undefined).
 */
function normalizeSku(raw: string | undefined, context: string): string | undefined {
	if (raw === undefined) return undefined;
	const trimmed = raw.trim();
	if (trimmed.length === 0) return undefined;
	if (trimmed.length > MAX_SKU_LENGTH)
		throw new ConvexError(`${context}: sku must be at most ${MAX_SKU_LENGTH} characters`);
	return trimmed;
}

/**
 * Ensure no other variant owned by this retailer already uses the same SKU.
 * SKU uniqueness moved from products to variants — variants are the sellable
 * units that SKUs identify. `excludeVariantId` lets a variant skip itself on
 * update. Throws `ConvexError` on conflict.
 */
async function assertVariantSkuUnique(
	ctx: QueryCtx | MutationCtx,
	retailerId: Id<"retailers">,
	sku: string,
	excludeVariantId?: Id<"productVariants">,
): Promise<void> {
	const existing = await ctx.db
		.query("productVariants")
		.withIndex("by_retailer_sku", (q) =>
			q.eq("retailerId", retailerId).eq("sku", sku),
		)
		.first();
	if (existing && existing._id !== excludeVariantId)
		throw new ConvexError(`SKU "${sku}" is already used by another variant`);
}

async function requireUserId(ctx: QueryCtx | MutationCtx): Promise<string> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new Error("Not authenticated");
	return identity.subject;
}

async function requireRetailerOwnership(
	ctx: QueryCtx | MutationCtx,
	retailerId: Id<"retailers">,
): Promise<Doc<"retailers">> {
	const userId = await requireUserId(ctx);
	const retailer = await ctx.db.get(retailerId);
	if (!retailer) throw new Error("Retailer not found");
	if (retailer.userId !== userId) throw new Error("Forbidden");
	return retailer;
}

async function requireProductOwnership(
	ctx: MutationCtx,
	productId: Id<"products">,
): Promise<Doc<"products">> {
	const product = await ctx.db.get(productId);
	if (!product) throw new Error("Product not found");
	await requireRetailerOwnership(ctx, product.retailerId);
	return product;
}

async function requireVariantOwnership(
	ctx: MutationCtx,
	variantId: Id<"productVariants">,
): Promise<Doc<"productVariants">> {
	const variant = await ctx.db.get(variantId);
	if (!variant) throw new Error("Variant not found");
	await requireRetailerOwnership(ctx, variant.retailerId);
	return variant;
}

async function withImageUrls<T extends { imageStorageIds: string[] }>(
	ctx: QueryCtx,
	row: T,
): Promise<T & { imageUrls: string[] }> {
	const urls = await Promise.all(
		row.imageStorageIds.map((id) => ctx.storage.getUrl(id)),
	);
	return {
		...row,
		imageUrls: urls.filter((u): u is string => u !== null),
	};
}

/** Load a product's variants (sorted), each with resolved image URLs. */
async function loadVariants(ctx: QueryCtx, productId: Id<"products">) {
	const rows = await ctx.db
		.query("productVariants")
		.withIndex("by_product", (q) => q.eq("productId", productId))
		.collect();
	rows.sort((a, b) => a.sortOrder - b.sortOrder);
	return Promise.all(rows.map((row) => withImageUrls(ctx, row)));
}

/**
 * Resolve a product to its storefront/dashboard shape: product images +
 * variants + rollups (price range, total on-hand, in-stock). `activeOnly`
 * filters to active variants for the public storefront.
 */
async function productWithVariants(
	ctx: QueryCtx,
	product: Doc<"products">,
	opts: { activeOnly: boolean },
) {
	const base = await withImageUrls(ctx, product);
	const all = await loadVariants(ctx, product._id);
	const variants = opts.activeOnly ? all.filter((vr) => vr.active) : all;
	const prices = variants.map((vr) => vr.price);
	const totalOnHand = variants.reduce((sum, vr) => sum + vr.onHand, 0);
	return {
		...base,
		variants,
		variantCount: variants.length,
		priceFrom: prices.length ? Math.min(...prices) : 0,
		priceTo: prices.length ? Math.max(...prices) : 0,
		totalOnHand,
		// "In stock" for made-to-order products is always true; for hard-block
		// products it requires at least one variant with on-hand stock.
		inStock: product.blockWhenOutOfStock ? totalOnHand > 0 : true,
	};
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const optionAxisValidator = v.object({
	name: v.string(),
	values: v.array(v.string()),
});

const variantInputValidator = v.object({
	// Positionally aligned with the product's option axes; [] for the implicit
	// default variant of a no-axes product.
	optionValues: v.array(v.string()),
	sku: v.optional(v.string()),
	price: v.number(),
	onHand: v.number(),
	parcelWeightG: v.optional(v.number()),
	imageStorageIds: v.optional(v.array(v.string())),
	active: v.optional(v.boolean()),
});

type VariantInput = {
	optionValues: string[];
	sku?: string;
	price: number;
	onHand: number;
	parcelWeightG?: number;
	imageStorageIds?: string[];
	active?: boolean;
};

/**
 * Validate a full set of variant inputs against the product's option axes:
 * every variant must name a valid combination, the set must cover the cartesian
 * exactly (no missing, no extra, no duplicate combos), and each row must pass
 * field-level checks. Normalizes SKUs and enforces intra-batch SKU uniqueness.
 * Returns the cleaned variant inputs. Throws `ConvexError` on any violation.
 */
function validateVariantSet(
	options: OptionAxis[],
	variants: VariantInput[],
): VariantInput[] {
	if (variants.length === 0)
		throw new ConvexError("A product needs at least one variant");

	const expected = cartesian(options); // includes [[]] for no-axes products
	if (variants.length !== expected.length)
		throw new ConvexError(
			`Expected ${expected.length} variants for these options, got ${variants.length}`,
		);

	const seenCombos: string[][] = [];
	const skuSeen = new Set<string>();
	const cleaned: VariantInput[] = variants.map((variant, i) => {
		const context = `Variant ${i + 1}`;
		if (!isValidCombination(options, variant.optionValues))
			throw new ConvexError(
				`${context}: "${variantLabel(variant.optionValues)}" is not a valid option combination`,
			);
		if (seenCombos.some((c) => sameOptionValues(c, variant.optionValues)))
			throw new ConvexError(
				`${context}: duplicate combination "${variantLabel(variant.optionValues)}"`,
			);
		seenCombos.push(variant.optionValues);

		if (variant.price < 0)
			throw new ConvexError(`${context}: price must be non-negative`);
		if (!Number.isInteger(variant.onHand) || variant.onHand < 0)
			throw new ConvexError(`${context}: stock must be a non-negative integer`);
		if (
			variant.parcelWeightG !== undefined &&
			(!Number.isInteger(variant.parcelWeightG) || variant.parcelWeightG < 0)
		)
			throw new ConvexError(`${context}: parcel weight must be a non-negative integer`);
		if (
			variant.imageStorageIds !== undefined &&
			variant.imageStorageIds.length > MAX_IMAGES_PER_VARIANT
		)
			throw new ConvexError(`${context}: at most ${MAX_IMAGES_PER_VARIANT} images per variant`);

		const sku = normalizeSku(variant.sku, context);
		if (sku) {
			if (skuSeen.has(sku))
				throw new ConvexError(`Duplicate SKU "${sku}" within this product`);
			skuSeen.add(sku);
		}
		return { ...variant, sku };
	});

	// Confirm every expected combination is present (covers the "missing combo"
	// case that the count check alone can't catch once duplicates are ruled out).
	for (const combo of expected) {
		if (!cleaned.some((vr) => sameOptionValues(vr.optionValues, combo)))
			throw new ConvexError(
				`Missing variant for combination "${variantLabel(combo)}"`,
			);
	}
	return cleaned;
}

/** Re-run options normalization, re-wrapping plain Errors as ConvexError. */
function normalizeOptionsOrThrow(
	raw: OptionAxis[] | undefined,
): OptionAxis[] {
	try {
		return normalizeOptions(raw);
	} catch (err) {
		throw new ConvexError((err as Error).message);
	}
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const list = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }) => {
		const rows = await ctx.db
			.query("products")
			.withIndex("by_retailer_active", (q) =>
				q.eq("retailerId", retailerId).eq("active", true),
			)
			.collect();
		return Promise.all(
			rows.map((row) => productWithVariants(ctx, row, { activeOnly: true })),
		);
	},
});

export const listAll = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }) => {
		await requireRetailerOwnership(ctx, retailerId);
		const rows = await ctx.db
			.query("products")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.collect();
		return Promise.all(
			rows.map((row) => productWithVariants(ctx, row, { activeOnly: false })),
		);
	},
});

export const get = query({
	args: { productId: v.id("products") },
	handler: async (ctx, { productId }) => {
		const row = await ctx.db.get(productId);
		if (!row) return null;
		return productWithVariants(ctx, row, { activeOnly: false });
	},
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const create = mutation({
	args: {
		retailerId: v.id("retailers"),
		name: v.string(),
		description: v.optional(v.string()),
		currency: v.string(),
		imageStorageIds: v.array(v.string()),
		sortOrder: v.number(),
		options: v.optional(v.array(optionAxisValidator)),
		blockWhenOutOfStock: v.optional(v.boolean()),
		variants: v.array(variantInputValidator),
	},
	handler: async (ctx, args): Promise<Id<"products">> => {
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		await requireRetailerOwnership(ctx, args.retailerId);

		const existingCount = await ctx.db
			.query("products")
			.withIndex("by_retailer", (q) => q.eq("retailerId", args.retailerId))
			.collect()
			.then((r) => r.length);
		if (existingCount >= MAX_PRODUCTS_PER_RETAILER)
			throw new ConvexError(
				`Beta limit: maximum ${MAX_PRODUCTS_PER_RETAILER} products per retailer`,
			);

		if (args.name.trim().length === 0) throw new ConvexError("Name is required");
		if (args.imageStorageIds.length > MAX_IMAGES_PER_PRODUCT)
			throw new ConvexError(`Maximum ${MAX_IMAGES_PER_PRODUCT} images per product`);

		const options = normalizeOptionsOrThrow(args.options);
		const variants = validateVariantSet(options, args.variants);

		// Cross-variant SKU uniqueness against the rest of this retailer's catalog.
		for (const variant of variants) {
			if (variant.sku)
				await assertVariantSkuUnique(ctx, args.retailerId, variant.sku);
		}

		const now = Date.now();
		const productId = await ctx.db.insert("products", {
			retailerId: args.retailerId,
			name: args.name.trim(),
			description: args.description,
			currency: args.currency,
			imageStorageIds: args.imageStorageIds,
			options,
			blockWhenOutOfStock: args.blockWhenOutOfStock,
			sortOrder: args.sortOrder,
			active: true,
			channel: "whatsapp",
			createdAt: now,
			updatedAt: now,
		});

		await insertVariants(ctx, productId, args.retailerId, variants, now);
		return productId;
	},
});

/** Insert a validated variant set for a product, in input order. */
async function insertVariants(
	ctx: MutationCtx,
	productId: Id<"products">,
	retailerId: Id<"retailers">,
	variants: VariantInput[],
	now: number,
): Promise<void> {
	for (let i = 0; i < variants.length; i++) {
		const variant = variants[i];
		await ctx.db.insert("productVariants", {
			productId,
			retailerId,
			optionValues: variant.optionValues,
			sku: variant.sku,
			price: variant.price,
			onHand: variant.onHand,
			reserved: 0,
			parcelWeightG: variant.parcelWeightG ?? 0,
			imageStorageIds: variant.imageStorageIds ?? [],
			active: variant.active ?? true,
			sortOrder: i,
			createdAt: now,
			updatedAt: now,
		});
	}
}

/** Product-level scalar fields only. Option/variant restructuring goes through
 * `saveVariantGrid`; per-row stock/price edits through `updateVariant`. */
export const update = mutation({
	args: {
		productId: v.id("products"),
		name: v.optional(v.string()),
		description: v.optional(v.union(v.string(), v.null())),
		currency: v.optional(v.string()),
		imageStorageIds: v.optional(v.array(v.string())),
		sortOrder: v.optional(v.number()),
		active: v.optional(v.boolean()),
		blockWhenOutOfStock: v.optional(v.boolean()),
	},
	handler: async (ctx, { productId, ...fields }): Promise<void> => {
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		await requireProductOwnership(ctx, productId);

		if (
			fields.imageStorageIds !== undefined &&
			fields.imageStorageIds.length > MAX_IMAGES_PER_PRODUCT
		)
			throw new ConvexError(`Maximum ${MAX_IMAGES_PER_PRODUCT} images per product`);
		if (fields.name !== undefined && fields.name.trim().length === 0)
			throw new ConvexError("Name is required");

		const updates: Record<string, unknown> = { updatedAt: Date.now() };
		if (fields.name !== undefined) updates.name = fields.name.trim();
		if (fields.description !== undefined)
			updates.description = fields.description === null ? undefined : fields.description;
		if (fields.currency !== undefined) updates.currency = fields.currency;
		if (fields.imageStorageIds !== undefined)
			updates.imageStorageIds = fields.imageStorageIds;
		if (fields.sortOrder !== undefined) updates.sortOrder = fields.sortOrder;
		if (fields.active !== undefined) updates.active = fields.active;
		if (fields.blockWhenOutOfStock !== undefined)
			updates.blockWhenOutOfStock = fields.blockWhenOutOfStock;

		await ctx.db.patch(productId, updates);
	},
});

/**
 * Atomically set a product's option axes + full variant grid, reconciling
 * against existing variants: matching combinations (by optionValues) are
 * patched in place (preserving their _id so historical orders' variantId stays
 * valid), new combinations inserted, and combinations no longer in the grid
 * deleted. This backs the dashboard variant-grid editor's structural save.
 */
export const saveVariantGrid = mutation({
	args: {
		productId: v.id("products"),
		options: v.optional(v.array(optionAxisValidator)),
		variants: v.array(variantInputValidator),
	},
	handler: async (ctx, args): Promise<void> => {
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		const product = await requireProductOwnership(ctx, args.productId);

		const options = normalizeOptionsOrThrow(args.options);
		const variants = validateVariantSet(options, args.variants);

		const existing = await ctx.db
			.query("productVariants")
			.withIndex("by_product", (q) => q.eq("productId", args.productId))
			.collect();

		// SKU uniqueness across the retailer, excluding variants of THIS product
		// (they're being rewritten) — checked against the cleaned set below.
		const myVariantIds = new Set(existing.map((e) => e._id));
		for (const variant of variants) {
			if (!variant.sku) continue;
			const clash = await ctx.db
				.query("productVariants")
				.withIndex("by_retailer_sku", (q) =>
					q.eq("retailerId", product.retailerId).eq("sku", variant.sku),
				)
				.first();
			if (clash && !myVariantIds.has(clash._id))
				throw new ConvexError(`SKU "${variant.sku}" is already used by another variant`);
		}

		const now = Date.now();
		const matched = new Set<Id<"productVariants">>();
		for (let i = 0; i < variants.length; i++) {
			const variant = variants[i];
			const prior = existing.find((e) =>
				sameOptionValues(e.optionValues, variant.optionValues),
			);
			if (prior) {
				matched.add(prior._id);
				await ctx.db.patch(prior._id, {
					sku: variant.sku,
					price: variant.price,
					onHand: variant.onHand,
					parcelWeightG: variant.parcelWeightG ?? prior.parcelWeightG,
					imageStorageIds: variant.imageStorageIds ?? prior.imageStorageIds,
					active: variant.active ?? prior.active,
					sortOrder: i,
					updatedAt: now,
				});
			} else {
				await ctx.db.insert("productVariants", {
					productId: args.productId,
					retailerId: product.retailerId,
					optionValues: variant.optionValues,
					sku: variant.sku,
					price: variant.price,
					onHand: variant.onHand,
					reserved: 0,
					parcelWeightG: variant.parcelWeightG ?? 0,
					imageStorageIds: variant.imageStorageIds ?? [],
					active: variant.active ?? true,
					sortOrder: i,
					createdAt: now,
					updatedAt: now,
				});
			}
		}
		// Delete combinations the grid no longer contains.
		for (const prior of existing) {
			if (!matched.has(prior._id)) await ctx.db.delete(prior._id);
		}

		await ctx.db.patch(args.productId, { options, updatedAt: now });
	},
});

/** Per-row variant edit (price, stock, sku, weight, images, active). */
export const updateVariant = mutation({
	args: {
		variantId: v.id("productVariants"),
		sku: v.optional(v.union(v.string(), v.null())),
		price: v.optional(v.number()),
		onHand: v.optional(v.number()),
		parcelWeightG: v.optional(v.number()),
		imageStorageIds: v.optional(v.array(v.string())),
		active: v.optional(v.boolean()),
	},
	handler: async (ctx, { variantId, ...fields }): Promise<void> => {
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		const existing = await requireVariantOwnership(ctx, variantId);

		if (fields.price !== undefined && fields.price < 0)
			throw new ConvexError("Price must be non-negative");
		if (
			fields.onHand !== undefined &&
			(!Number.isInteger(fields.onHand) || fields.onHand < 0)
		)
			throw new ConvexError("Stock must be a non-negative integer");
		if (
			fields.parcelWeightG !== undefined &&
			(!Number.isInteger(fields.parcelWeightG) || fields.parcelWeightG < 0)
		)
			throw new ConvexError("Parcel weight must be a non-negative integer");
		if (
			fields.imageStorageIds !== undefined &&
			fields.imageStorageIds.length > MAX_IMAGES_PER_VARIANT
		)
			throw new ConvexError(`Maximum ${MAX_IMAGES_PER_VARIANT} images per variant`);

		const updates: Record<string, unknown> = { updatedAt: Date.now() };
		if (fields.price !== undefined) updates.price = fields.price;
		if (fields.onHand !== undefined) updates.onHand = fields.onHand;
		if (fields.parcelWeightG !== undefined)
			updates.parcelWeightG = fields.parcelWeightG;
		if (fields.imageStorageIds !== undefined)
			updates.imageStorageIds = fields.imageStorageIds;
		if (fields.active !== undefined) updates.active = fields.active;

		if (fields.sku !== undefined) {
			if (fields.sku === null) {
				updates.sku = undefined;
			} else {
				const normalized = normalizeSku(fields.sku, "Variant");
				if (normalized)
					await assertVariantSkuUnique(
						ctx,
						existing.retailerId,
						normalized,
						variantId,
					);
				updates.sku = normalized;
			}
		}

		await ctx.db.patch(variantId, updates);
	},
});

export const archive = mutation({
	args: { productId: v.id("products") },
	handler: async (ctx, { productId }): Promise<void> => {
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		await requireProductOwnership(ctx, productId);
		await ctx.db.patch(productId, {
			active: false,
			updatedAt: Date.now(),
		});
	},
});

// ---------------------------------------------------------------------------
// Bulk import (single-variant products only — multi-variant import is a
// separate subtask that this feature blocks; see docs/product-variants.md §9).
// SKU now matches on the default variant. Each imported product owns exactly
// one variant (optionValues: []).
// ---------------------------------------------------------------------------

const bulkImportItemValidator = v.object({
	sku: v.optional(v.string()),
	name: v.string(),
	description: v.optional(v.string()),
	price: v.number(),
	stock: v.number(),
});

interface NormalizedBulkItem {
	sku: string | undefined;
	item: {
		sku?: string;
		name: string;
		description?: string;
		price: number;
		stock: number;
	};
}

function preValidateBulkItems(
	items: { sku?: string; name: string; price: number; stock: number }[],
): NormalizedBulkItem[] {
	const normalized: NormalizedBulkItem[] = items.map((item, i) => {
		const rowNum = i + 1;
		if (item.name.trim().length === 0)
			throw new ConvexError(`Row ${rowNum}: name is required`);
		if (item.name.length > 120)
			throw new ConvexError(`Row ${rowNum}: name must be at most 120 characters`);
		if (item.price < 0)
			throw new ConvexError(`Row ${rowNum}: price must be non-negative`);
		if (!Number.isInteger(item.stock) || item.stock < 0)
			throw new ConvexError(`Row ${rowNum}: stock must be a non-negative integer`);
		const sku = normalizeSku(item.sku, `Row ${rowNum}`);
		return { sku, item: item as NormalizedBulkItem["item"] };
	});

	const skuSeen = new Map<string, number>();
	normalized.forEach(({ sku }, i) => {
		if (!sku) return;
		const prev = skuSeen.get(sku);
		if (prev !== undefined)
			throw new ConvexError(`Duplicate sku "${sku}" in rows ${prev + 1} and ${i + 1}`);
		skuSeen.set(sku, i);
	});

	return normalized;
}

/** Find the single-variant product whose default variant carries this SKU. */
async function findProductByVariantSku(
	ctx: MutationCtx | QueryCtx,
	retailerId: Id<"retailers">,
	sku: string,
): Promise<{ product: Doc<"products">; variant: Doc<"productVariants"> } | null> {
	const variant = await ctx.db
		.query("productVariants")
		.withIndex("by_retailer_sku", (q) =>
			q.eq("retailerId", retailerId).eq("sku", sku),
		)
		.first();
	if (!variant) return null;
	const product = await ctx.db.get(variant.productId);
	if (!product) return null;
	return { product, variant };
}

export const bulkUpsert = mutation({
	args: {
		retailerId: v.id("retailers"),
		currency: v.string(),
		items: v.array(bulkImportItemValidator),
	},
	handler: async (ctx, args): Promise<{ created: number; updated: number }> => {
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productBulkImport", { key: userId, throws: true });
		await requireRetailerOwnership(ctx, args.retailerId);

		if (args.items.length === 0) throw new ConvexError("No products to import");
		if (args.items.length > MAX_BULK_IMPORT_BATCH)
			throw new ConvexError(
				`Maximum ${MAX_BULK_IMPORT_BATCH} products per batch (received ${args.items.length})`,
			);

		const normalized = preValidateBulkItems(args.items);

		const classifications: (NormalizedBulkItem & {
			existing: { product: Doc<"products">; variant: Doc<"productVariants"> } | null;
		})[] = [];
		for (const entry of normalized) {
			if (!entry.sku) {
				classifications.push({ ...entry, existing: null });
				continue;
			}
			const existing = await findProductByVariantSku(ctx, args.retailerId, entry.sku);
			classifications.push({ ...entry, existing });
		}

		const insertCount = classifications.filter((c) => c.existing === null).length;

		const existingCount = await ctx.db
			.query("products")
			.withIndex("by_retailer", (q) => q.eq("retailerId", args.retailerId))
			.collect()
			.then((r) => r.length);
		if (existingCount + insertCount > MAX_PRODUCTS_PER_RETAILER)
			throw new ConvexError(
				`Beta limit: would exceed ${MAX_PRODUCTS_PER_RETAILER} products per retailer (currently ${existingCount}, +${insertCount} new)`,
			);

		const now = Date.now();
		let created = 0;
		let updated = 0;
		for (const [i, { sku, item, existing }] of classifications.entries()) {
			if (existing) {
				await ctx.db.patch(existing.product._id, {
					name: item.name.trim(),
					description: item.description,
					currency: args.currency,
					updatedAt: now,
				});
				await ctx.db.patch(existing.variant._id, {
					price: item.price,
					onHand: item.stock,
					updatedAt: now,
				});
				updated++;
			} else {
				const productId = await ctx.db.insert("products", {
					retailerId: args.retailerId,
					name: item.name.trim(),
					description: item.description,
					currency: args.currency,
					imageStorageIds: [],
					options: [],
					sortOrder: now + i,
					active: true,
					channel: "whatsapp",
					createdAt: now,
					updatedAt: now,
				});
				await ctx.db.insert("productVariants", {
					productId,
					retailerId: args.retailerId,
					optionValues: [],
					sku,
					price: item.price,
					onHand: item.stock,
					reserved: 0,
					parcelWeightG: 0,
					imageStorageIds: [],
					active: true,
					sortOrder: 0,
					createdAt: now,
					updatedAt: now,
				});
				created++;
			}
		}

		return { created, updated };
	},
});

export const bulkUpsertPreview = query({
	args: {
		retailerId: v.id("retailers"),
		items: v.array(bulkImportItemValidator),
	},
	handler: async (ctx, args) => {
		await requireRetailerOwnership(ctx, args.retailerId);

		if (args.items.length > MAX_BULK_IMPORT_BATCH)
			throw new ConvexError(`Preview exceeds max batch size ${MAX_BULK_IMPORT_BATCH}`);

		const normalized = preValidateBulkItems(args.items);

		const plan: Array<{
			rowNumber: number;
			sku: string | undefined;
			action: "insert" | "update";
			productId: Id<"products"> | null;
			diff: {
				name?: { before: string; after: string };
				description?: { before: string | undefined; after: string | undefined };
				price?: { before: number; after: number };
				stock?: { before: number; after: number };
			};
		}> = [];
		let inserts = 0;
		let updates = 0;
		let noChange = 0;

		for (const [i, { sku, item }] of normalized.entries()) {
			const rowNumber = i + 1;
			if (!sku) {
				inserts++;
				plan.push({ rowNumber, sku: undefined, action: "insert", productId: null, diff: {} });
				continue;
			}
			const existing = await findProductByVariantSku(ctx, args.retailerId, sku);
			if (!existing) {
				inserts++;
				plan.push({ rowNumber, sku, action: "insert", productId: null, diff: {} });
				continue;
			}

			const newName = item.name.trim();
			const diff: (typeof plan)[number]["diff"] = {};
			if (existing.product.name !== newName)
				diff.name = { before: existing.product.name, after: newName };
			if ((existing.product.description ?? undefined) !== (item.description ?? undefined))
				diff.description = { before: existing.product.description, after: item.description };
			if (existing.variant.price !== item.price)
				diff.price = { before: existing.variant.price, after: item.price };
			if (existing.variant.onHand !== item.stock)
				diff.stock = { before: existing.variant.onHand, after: item.stock };

			const hasChange = Object.keys(diff).length > 0;
			if (hasChange) updates++;
			else noChange++;
			plan.push({ rowNumber, sku, action: "update", productId: existing.product._id, diff });
		}

		return { plan, summary: { inserts, updates, noChange } };
	},
});

export const generateUploadUrl = mutation({
	args: {},
	handler: async (ctx): Promise<string> => {
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		return ctx.storage.generateUploadUrl();
	},
});

export const reorder = mutation({
	args: {
		productId: v.id("products"),
		sortOrder: v.number(),
	},
	handler: async (ctx, { productId, sortOrder }): Promise<void> => {
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		await requireProductOwnership(ctx, productId);
		await ctx.db.patch(productId, {
			sortOrder,
			updatedAt: Date.now(),
		});
	},
});
