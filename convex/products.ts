import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { rateLimiter } from "./lib/rateLimiter";

const MAX_IMAGES_PER_PRODUCT = 5;
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
 * Ensure no other product owned by this retailer already uses the same SKU.
 * `excludeProductId` is passed on update so a product doesn't collide with
 * itself. Throws `ConvexError` on conflict.
 */
async function assertSkuUnique(
	ctx: QueryCtx | MutationCtx,
	retailerId: Id<"retailers">,
	sku: string,
	excludeProductId?: Id<"products">,
): Promise<void> {
	const existing = await ctx.db
		.query("products")
		.withIndex("by_retailer_sku", (q) =>
			q.eq("retailerId", retailerId).eq("sku", sku),
		)
		.first();
	if (existing && existing._id !== excludeProductId)
		throw new ConvexError(`SKU "${sku}" is already used by another product`);
}

async function requireUserId(
	ctx: QueryCtx | MutationCtx,
): Promise<string> {
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

export const list = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }) => {
		const rows = await ctx.db
			.query("products")
			.withIndex("by_retailer_active", (q) =>
				q.eq("retailerId", retailerId).eq("active", true),
			)
			.collect();
		return Promise.all(rows.map((row) => withImageUrls(ctx, row)));
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
		return Promise.all(rows.map((row) => withImageUrls(ctx, row)));
	},
});

export const get = query({
	args: { productId: v.id("products") },
	handler: async (ctx, { productId }) => {
		const row = await ctx.db.get(productId);
		if (!row) return null;
		return withImageUrls(ctx, row);
	},
});

export const create = mutation({
	args: {
		retailerId: v.id("retailers"),
		sku: v.optional(v.string()),
		name: v.string(),
		description: v.optional(v.string()),
		price: v.number(),
		currency: v.string(),
		stock: v.number(),
		imageStorageIds: v.array(v.string()),
		sortOrder: v.number(),
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

		if (args.price < 0) throw new ConvexError("Price must be non-negative");
		if (!Number.isInteger(args.stock) || args.stock < 0)
			throw new ConvexError("Stock must be a non-negative integer");
		if (args.imageStorageIds.length > MAX_IMAGES_PER_PRODUCT)
			throw new ConvexError(`Maximum ${MAX_IMAGES_PER_PRODUCT} images per product`);
		if (args.name.trim().length === 0) throw new ConvexError("Name is required");

		const sku = normalizeSku(args.sku, "Product");
		if (sku) await assertSkuUnique(ctx, args.retailerId, sku);

		const now = Date.now();
		return ctx.db.insert("products", {
			retailerId: args.retailerId,
			sku,
			name: args.name.trim(),
			description: args.description,
			price: args.price,
			currency: args.currency,
			stock: args.stock,
			imageStorageIds: args.imageStorageIds,
			sortOrder: args.sortOrder,
			active: true,
			channel: "whatsapp",
			createdAt: now,
			updatedAt: now,
		});
	},
});

export const update = mutation({
	args: {
		productId: v.id("products"),
		// `sku: null` clears an existing SKU; omitting leaves it unchanged.
		sku: v.optional(v.union(v.string(), v.null())),
		name: v.optional(v.string()),
		description: v.optional(v.string()),
		price: v.optional(v.number()),
		currency: v.optional(v.string()),
		stock: v.optional(v.number()),
		imageStorageIds: v.optional(v.array(v.string())),
		sortOrder: v.optional(v.number()),
		active: v.optional(v.boolean()),
	},
	handler: async (ctx, { productId, ...fields }): Promise<void> => {
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		const existing = await requireProductOwnership(ctx, productId);

		if (fields.price !== undefined && fields.price < 0)
			throw new ConvexError("Price must be non-negative");
		if (
			fields.stock !== undefined &&
			(!Number.isInteger(fields.stock) || fields.stock < 0)
		)
			throw new ConvexError("Stock must be a non-negative integer");
		if (
			fields.imageStorageIds !== undefined &&
			fields.imageStorageIds.length > MAX_IMAGES_PER_PRODUCT
		)
			throw new ConvexError(`Maximum ${MAX_IMAGES_PER_PRODUCT} images per product`);

		const updates: Record<string, unknown> = { updatedAt: Date.now() };
		for (const [key, value] of Object.entries(fields)) {
			if (key === "sku") continue;
			if (value !== undefined) updates[key] = value;
		}

		if (fields.sku !== undefined) {
			if (fields.sku === null) {
				updates.sku = undefined;
			} else {
				const normalized = normalizeSku(fields.sku, "Product");
				if (normalized)
					await assertSkuUnique(ctx, existing.retailerId, normalized, productId);
				updates.sku = normalized;
			}
		}

		await ctx.db.patch(productId, updates);
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

/**
 * Shared pre-validation for bulk-import items. Mirrors the CSV/XLSX client
 * parser rules so we reject identical inputs with the same messages. Throws
 * ConvexError with a Row N prefix on the first failure — matches
 * all-or-nothing batch semantics.
 */
function preValidateBulkItems(
	items: { sku?: string; name: string; price: number; stock: number }[],
): NormalizedBulkItem[] {
	const normalized: NormalizedBulkItem[] = items.map((item, i) => {
		const rowNum = i + 1;
		if (item.name.trim().length === 0)
			throw new ConvexError(`Row ${rowNum}: name is required`);
		if (item.name.length > 120)
			throw new ConvexError(
				`Row ${rowNum}: name must be at most 120 characters`,
			);
		if (item.price < 0)
			throw new ConvexError(`Row ${rowNum}: price must be non-negative`);
		if (!Number.isInteger(item.stock) || item.stock < 0)
			throw new ConvexError(
				`Row ${rowNum}: stock must be a non-negative integer`,
			);
		const sku = normalizeSku(item.sku, `Row ${rowNum}`);
		return { sku, item: item as NormalizedBulkItem["item"] };
	});

	// Intra-batch SKU uniqueness: duplicates in the same upload are always a
	// mistake (typo or copy-paste).
	const skuSeen = new Map<string, number>();
	normalized.forEach(({ sku }, i) => {
		if (!sku) return;
		const prev = skuSeen.get(sku);
		if (prev !== undefined)
			throw new ConvexError(
				`Duplicate sku "${sku}" in rows ${prev + 1} and ${i + 1}`,
			);
		skuSeen.set(sku, i);
	});

	return normalized;
}

export const bulkUpsert = mutation({
	args: {
		retailerId: v.id("retailers"),
		currency: v.string(),
		items: v.array(bulkImportItemValidator),
	},
	handler: async (
		ctx,
		args,
	): Promise<{ created: number; updated: number }> => {
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productBulkImport", {
			key: userId,
			throws: true,
		});
		await requireRetailerOwnership(ctx, args.retailerId);

		if (args.items.length === 0)
			throw new ConvexError("No products to import");
		if (args.items.length > MAX_BULK_IMPORT_BATCH)
			throw new ConvexError(
				`Maximum ${MAX_BULK_IMPORT_BATCH} products per batch (received ${args.items.length})`,
			);

		const normalized = preValidateBulkItems(args.items);

		// First pass: classify every row as insert or update by looking up SKU.
		// Must precede the cap check — otherwise a pure-update batch could be
		// falsely rejected for exceeding the beta cap.
		const classifications: (NormalizedBulkItem & {
			existingId: Id<"products"> | null;
		})[] = [];
		for (const entry of normalized) {
			if (!entry.sku) {
				classifications.push({ ...entry, existingId: null });
				continue;
			}
			const existing = await ctx.db
				.query("products")
				.withIndex("by_retailer_sku", (q) =>
					q.eq("retailerId", args.retailerId).eq("sku", entry.sku),
				)
				.first();
			classifications.push({ ...entry, existingId: existing?._id ?? null });
		}

		const insertCount = classifications.filter(
			(c) => c.existingId === null,
		).length;

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
		for (const [i, { sku, item, existingId }] of classifications.entries()) {
			if (existingId) {
				// Preserve channel, active, imageStorageIds, sortOrder, createdAt,
				// and the SKU itself (matched by it). Refresh currency to whatever
				// the retailer has configured now.
				await ctx.db.patch(existingId, {
					name: item.name.trim(),
					description: item.description,
					price: item.price,
					currency: args.currency,
					stock: item.stock,
					updatedAt: now,
				});
				updated++;
			} else {
				await ctx.db.insert("products", {
					retailerId: args.retailerId,
					sku,
					name: item.name.trim(),
					description: item.description,
					price: item.price,
					currency: args.currency,
					stock: item.stock,
					imageStorageIds: [],
					sortOrder: now + i,
					active: true,
					channel: "whatsapp",
					createdAt: now,
					updatedAt: now,
				});
				created++;
			}
		}

		return { created, updated };
	},
});

/**
 * Non-mutating dry-run for `bulkUpsert`. Returns a per-row action plan and
 * summary counts so the UI can show "3 new · 12 updates · 2 unchanged"
 * before the retailer commits. Advisory only — `bulkUpsert` re-classifies
 * at commit time because the DB state can change between preview and
 * commit (another tab, another user, another import).
 */
export const bulkUpsertPreview = query({
	args: {
		retailerId: v.id("retailers"),
		items: v.array(bulkImportItemValidator),
	},
	handler: async (ctx, args) => {
		await requireRetailerOwnership(ctx, args.retailerId);

		if (args.items.length > MAX_BULK_IMPORT_BATCH)
			throw new ConvexError(
				`Preview exceeds max batch size ${MAX_BULK_IMPORT_BATCH}`,
			);

		const normalized = preValidateBulkItems(args.items);

		const plan: Array<{
			rowNumber: number;
			sku: string | undefined;
			action: "insert" | "update";
			productId: Id<"products"> | null;
			diff: {
				name?: { before: string; after: string };
				description?: {
					before: string | undefined;
					after: string | undefined;
				};
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
				plan.push({
					rowNumber,
					sku: undefined,
					action: "insert",
					productId: null,
					diff: {},
				});
				continue;
			}
			const existing = await ctx.db
				.query("products")
				.withIndex("by_retailer_sku", (q) =>
					q.eq("retailerId", args.retailerId).eq("sku", sku),
				)
				.first();
			if (!existing) {
				inserts++;
				plan.push({
					rowNumber,
					sku,
					action: "insert",
					productId: null,
					diff: {},
				});
				continue;
			}

			const newName = item.name.trim();
			const diff: (typeof plan)[number]["diff"] = {};
			if (existing.name !== newName)
				diff.name = { before: existing.name, after: newName };
			// Both sides normalize blank to undefined so toggling between "" and
			// existing value is a real change worth showing.
			if ((existing.description ?? undefined) !== (item.description ?? undefined))
				diff.description = {
					before: existing.description,
					after: item.description,
				};
			if (existing.price !== item.price)
				diff.price = { before: existing.price, after: item.price };
			if (existing.stock !== item.stock)
				diff.stock = { before: existing.stock, after: item.stock };

			const hasChange = Object.keys(diff).length > 0;
			if (hasChange) updates++;
			else noChange++;
			plan.push({
				rowNumber,
				sku,
				action: "update",
				productId: existing._id,
				diff,
			});
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
