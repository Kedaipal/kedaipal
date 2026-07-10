import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
	logAdminAction,
	type RetailerAccess,
	requireRetailerAccess,
} from "./lib/auth";
import { rateLimiter } from "./lib/rateLimiter";
import { assertValidCategorySlug } from "./lib/slug";
import { productWithVariants } from "./products";
import { assertPlanFeature, assertSubscriptionActive } from "./subscriptions";

const NAME_MAX = 60;
const DESCRIPTION_MAX = 280;
/** Max categories a single product can belong to — a browse-structure sanity
 * cap in the same family as the 2-axis/50-variant product caps. */
export const MAX_CATEGORIES_PER_PRODUCT = 10;

// ---------------------------------------------------------------------------
// Auth helpers — mirror the pattern in convex/pickupLocations.ts so each
// module is self-contained.
// ---------------------------------------------------------------------------

// Owner-OR-admin access (see convex/lib/auth.ts) so a Kedaipal admin can set up
// a seller's categories during white-glove onboarding.
async function requireRetailerOwner(
	ctx: QueryCtx | MutationCtx,
	retailerId: Id<"retailers">,
): Promise<RetailerAccess> {
	return requireRetailerAccess(ctx, retailerId);
}

async function requireOwnedCategory(
	ctx: QueryCtx | MutationCtx,
	categoryId: Id<"categories">,
): Promise<{ category: Doc<"categories">; access: RetailerAccess }> {
	const category = await ctx.db.get(categoryId);
	if (!category) throw new Error("Category not found");
	const access = await requireRetailerAccess(ctx, category.retailerId);
	return { category, access };
}

async function requireUserId(ctx: QueryCtx | MutationCtx): Promise<string> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new Error("Not authenticated");
	return identity.subject;
}

// ---------------------------------------------------------------------------
// Sanitizers
// ---------------------------------------------------------------------------

function sanitizeName(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.length === 0) throw new ConvexError("Category name is required");
	if (trimmed.length > NAME_MAX) {
		throw new ConvexError(`Name must be at most ${NAME_MAX} characters`);
	}
	return trimmed;
}

function sanitizeDescription(raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined;
	const trimmed = raw.trim();
	if (trimmed.length === 0) return undefined;
	if (trimmed.length > DESCRIPTION_MAX) {
		throw new ConvexError(
			`Description must be at most ${DESCRIPTION_MAX} characters`,
		);
	}
	return trimmed;
}

function sanitizeSlug(raw: string): string {
	try {
		return assertValidCategorySlug(raw);
	} catch (err) {
		throw new ConvexError((err as Error).message);
	}
}

/**
 * Per-retailer slug uniqueness (by_retailer_slug). `excludeCategoryId` lets a
 * category keep its own slug on update. Archived categories still hold their
 * slug — restoring one must not find its URL stolen.
 */
async function assertCategorySlugUnique(
	ctx: QueryCtx | MutationCtx,
	retailerId: Id<"retailers">,
	slug: string,
	excludeCategoryId?: Id<"categories">,
): Promise<void> {
	const existing = await ctx.db
		.query("categories")
		.withIndex("by_retailer_slug", (q) =>
			q.eq("retailerId", retailerId).eq("slug", slug),
		)
		.first();
	if (existing && existing._id !== excludeCategoryId) {
		throw new ConvexError(
			`Another category already uses the link "${slug}" — pick a different one`,
		);
	}
}

/**
 * Count the storefront-visible products in a category: junction rows whose
 * product is active AND not hidden. Query-derived (never cached) so a tile
 * disappears the moment its last visible product is archived or hidden.
 */
async function visibleProductCount(
	ctx: QueryCtx,
	categoryId: Id<"categories">,
): Promise<number> {
	const rows = await ctx.db
		.query("productCategories")
		.withIndex("by_category_sort", (q) => q.eq("categoryId", categoryId))
		.collect();
	let count = 0;
	for (const row of rows) {
		const product = await ctx.db.get(row.productId);
		if (product && product.active && product.hidden !== true) count++;
	}
	return count;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Retailer-scoped list of every category (active + archived) for the
 * management page + the product-form picker. Active first (in their
 * sortOrder), archived sunk to the end — same "All" ordering as products.
 * Each row carries a live `productCount` (visible products only) + resolved
 * `imageUrl`.
 */
export const listForRetailer = query({
	args: { retailerId: v.id("retailers") },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<
		Array<Doc<"categories"> & { productCount: number; imageUrl: string | null }>
	> => {
		await requireRetailerOwner(ctx, retailerId);
		const rows = await ctx.db
			.query("categories")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.collect();
		rows.sort(
			(a, b) => Number(b.active) - Number(a.active) || a.sortOrder - b.sortOrder,
		);
		return Promise.all(
			rows.map(async (row) => ({
				...row,
				productCount: await visibleProductCount(ctx, row._id),
				imageUrl: row.imageStorageId
					? await ctx.storage.getUrl(row.imageStorageId)
					: null,
			})),
		);
	},
});

/**
 * Public, unauthed category rail for a storefront. Returns only public-safe
 * fields, only ACTIVE categories, and only those with ≥1 visible product —
 * an empty category never renders a dead-end tile. Empty array = the
 * storefront shows today's flat grid, pixel-identical.
 */
export const listActivePublic = query({
	args: { retailerId: v.id("retailers") },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<
		Array<{
			_id: Id<"categories">;
			name: string;
			slug: string;
			description?: string;
			imageUrl: string | null;
			productCount: number;
		}>
	> => {
		const rows = await ctx.db
			.query("categories")
			.withIndex("by_retailer_active", (q) =>
				q.eq("retailerId", retailerId).eq("active", true),
			)
			.collect();
		rows.sort((a, b) => a.sortOrder - b.sortOrder);
		const withCounts = await Promise.all(
			rows.map(async (row) => ({
				_id: row._id,
				name: row.name,
				slug: row.slug,
				description: row.description,
				imageUrl: row.imageStorageId
					? await ctx.storage.getUrl(row.imageStorageId)
					: null,
				productCount: await visibleProductCount(ctx, row._id),
			})),
		);
		return withCounts.filter((row) => row.productCount > 0);
	},
});

/**
 * Public category page payload: the category header + its visible products in
 * within-category order, enriched to the exact storefront shape via
 * products.productWithVariants. Returns null for an unknown OR archived slug
 * so the route can `notFound()` — a stale deep link never lands on a silent
 * empty page.
 */
export const getPublicPage = query({
	args: { retailerId: v.id("retailers"), categorySlug: v.string() },
	handler: async (ctx, { retailerId, categorySlug }) => {
		const normalized = categorySlug.trim().toLowerCase();
		if (normalized.length === 0) return null;
		const category = await ctx.db
			.query("categories")
			.withIndex("by_retailer_slug", (q) =>
				q.eq("retailerId", retailerId).eq("slug", normalized),
			)
			.first();
		if (!category || !category.active) return null;

		const junctions = await ctx.db
			.query("productCategories")
			.withIndex("by_category_sort", (q) => q.eq("categoryId", category._id))
			.collect();
		const products = [];
		for (const junction of junctions) {
			const product = await ctx.db.get(junction.productId);
			// Same visibility rules as products.list: active + not hidden.
			if (!product || !product.active || product.hidden === true) continue;
			products.push(
				await productWithVariants(ctx, product, { activeOnly: true }),
			);
		}
		return {
			category: {
				_id: category._id,
				name: category.name,
				slug: category.slug,
				description: category.description,
				imageUrl: category.imageStorageId
					? await ctx.storage.getUrl(category.imageStorageId)
					: null,
			},
			products,
		};
	},
});

/**
 * The products assigned to one category, in within-category order — feeds the
 * edit dialog's "Arrange products" list. Owner/admin only. Includes archived
 * and hidden products (flagged) so a seller can see and reorder the FULL
 * membership; the public reads filter them out.
 */
export const listProductsForCategory = query({
	args: { categoryId: v.id("categories") },
	handler: async (
		ctx,
		{ categoryId },
	): Promise<
		Array<{
			productId: Id<"products">;
			name: string;
			active: boolean;
			hidden: boolean;
			imageUrl: string | null;
		}>
	> => {
		await requireOwnedCategory(ctx, categoryId);
		const junctions = await ctx.db
			.query("productCategories")
			.withIndex("by_category_sort", (q) => q.eq("categoryId", categoryId))
			.collect();
		const rows = [];
		for (const junction of junctions) {
			const product = await ctx.db.get(junction.productId);
			if (!product) continue;
			rows.push({
				productId: product._id,
				name: product.name,
				active: product.active,
				hidden: product.hidden === true,
				imageUrl: product.imageStorageIds[0]
					? await ctx.storage.getUrl(product.imageStorageIds[0])
					: null,
			});
		}
		return rows;
	},
});

/**
 * The category ids a product currently belongs to (junction order, which is
 * creation order — the picker doesn't care). Seeds the product editor.
 */
export const getProductCategoryIds = query({
	args: { productId: v.id("products") },
	handler: async (ctx, { productId }): Promise<Id<"categories">[]> => {
		const product = await ctx.db.get(productId);
		if (!product) return [];
		await requireRetailerOwner(ctx, product.retailerId);
		const rows = await ctx.db
			.query("productCategories")
			.withIndex("by_product", (q) => q.eq("productId", productId))
			.collect();
		return rows.map((row) => row.categoryId);
	},
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const create = mutation({
	args: {
		retailerId: v.id("retailers"),
		name: v.string(),
		// Always sent — the dialog auto-fills it from the name (editable). The
		// server validates shape + per-retailer uniqueness regardless.
		slug: v.string(),
		description: v.optional(v.string()),
		imageStorageId: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ retailerId, name, slug, description, imageStorageId },
	): Promise<{ categoryId: Id<"categories"> }> => {
		const access = await requireRetailerOwner(ctx, retailerId);
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		// Soft-lock (growth-write); admin act-as bypasses (white-glove).
		if (!access.actingAsAdmin) await assertSubscriptionActive(ctx, retailerId);
		// Building category structure is Pro (86ey81n63). Admin act-as bypasses.
		if (!access.actingAsAdmin)
			await assertPlanFeature(ctx, retailerId, "categories");

		const cleanName = sanitizeName(name);
		const cleanSlug = sanitizeSlug(slug);
		await assertCategorySlugUnique(ctx, retailerId, cleanSlug);
		const cleanDescription = sanitizeDescription(description);

		// New rows append to the end — same max+1 pattern as pickupLocations
		// (reduce, not Math.max(...spread), to dodge the arg-limit footgun).
		const existing = await ctx.db
			.query("categories")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.collect();
		const nextSortOrder =
			existing.reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1;

		const now = Date.now();
		const categoryId = await ctx.db.insert("categories", {
			retailerId,
			name: cleanName,
			slug: cleanSlug,
			description: cleanDescription,
			imageStorageId: imageStorageId?.trim() || undefined,
			active: true,
			sortOrder: nextSortOrder,
			createdAt: now,
			updatedAt: now,
		});
		await logAdminAction(ctx, access, "categories.create", categoryId);
		return { categoryId };
	},
});

export const update = mutation({
	args: {
		categoryId: v.id("categories"),
		name: v.optional(v.string()),
		slug: v.optional(v.string()),
		// Empty string clears. Undefined = no change.
		description: v.optional(v.string()),
		// null clears (and GCs the old blob). Undefined = no change.
		imageStorageId: v.optional(v.union(v.string(), v.null())),
	},
	handler: async (
		ctx,
		{ categoryId, name, slug, description, imageStorageId },
	): Promise<void> => {
		const { category, access } = await requireOwnedCategory(ctx, categoryId);
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		// Soft-lock (growth-write); admin act-as bypasses.
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, category.retailerId);
		// Editing category structure is Pro; archive/restore (setActive) is the
		// un-gated escape hatch, not this. Admin act-as bypasses.
		if (!access.actingAsAdmin)
			await assertPlanFeature(ctx, category.retailerId, "categories");

		const patch: Partial<{
			name: string;
			slug: string;
			description: string | undefined;
			imageStorageId: string | undefined;
			updatedAt: number;
		}> = { updatedAt: Date.now() };

		if (name !== undefined) patch.name = sanitizeName(name);
		if (slug !== undefined) {
			const cleanSlug = sanitizeSlug(slug);
			await assertCategorySlugUnique(
				ctx,
				category.retailerId,
				cleanSlug,
				categoryId,
			);
			patch.slug = cleanSlug;
		}
		if (description !== undefined)
			patch.description = sanitizeDescription(description);
		if (imageStorageId !== undefined) {
			const next =
				imageStorageId === null ? undefined : imageStorageId.trim() || undefined;
			// GC the replaced/cleared blob — same best-effort pattern as the
			// retailer logo/cover (a missing blob must not abort the save).
			if (category.imageStorageId && category.imageStorageId !== next) {
				try {
					await ctx.storage.delete(
						category.imageStorageId as Id<"_storage">,
					);
				} catch {
					// blob already gone — ignore
				}
			}
			patch.imageStorageId = next;
		}

		await ctx.db.patch(categoryId, patch);
		await logAdminAction(ctx, access, "categories.update", categoryId);
	},
});

/**
 * Archive / restore. Deliberately UN-gated by plan (only the soft-lock
 * applies): a seller who downgrades from Pro must always be able to take
 * categories off their storefront. Junction rows are untouched — restoring
 * brings the category back with its assignments intact. Reactivating appends
 * to the end of the list so it doesn't ambush the current ordering.
 */
export const setActive = mutation({
	args: { categoryId: v.id("categories"), active: v.boolean() },
	handler: async (ctx, { categoryId, active }): Promise<void> => {
		const { category, access } = await requireOwnedCategory(ctx, categoryId);
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		// Soft-lock (growth-write); admin act-as bypasses.
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, category.retailerId);
		if (category.active === active) return; // idempotent

		const patch: Partial<Doc<"categories">> = {
			active,
			updatedAt: Date.now(),
		};
		if (active) {
			const siblings = await ctx.db
				.query("categories")
				.withIndex("by_retailer", (q) =>
					q.eq("retailerId", category.retailerId),
				)
				.collect();
			patch.sortOrder =
				siblings.reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1;
		}
		await ctx.db.patch(categoryId, patch);
		await logAdminAction(ctx, access, "categories.setActive", categoryId);
	},
});

/**
 * Bulk-reorder the ACTIVE categories — full-permutation rewrite, exactly the
 * pickupLocations.reorder contract: `orderedIds` must be the complete set of
 * active category ids, no dupes, no foreign/archived ids.
 */
export const reorder = mutation({
	args: {
		retailerId: v.id("retailers"),
		orderedIds: v.array(v.id("categories")),
	},
	handler: async (ctx, { retailerId, orderedIds }): Promise<void> => {
		const access = await requireRetailerOwner(ctx, retailerId);
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		// Soft-lock (growth-write); admin act-as bypasses.
		if (!access.actingAsAdmin) await assertSubscriptionActive(ctx, retailerId);
		// Arranging the rail is structure-building — Pro. Admin act-as bypasses.
		if (!access.actingAsAdmin)
			await assertPlanFeature(ctx, retailerId, "categories");

		const activeRows = await ctx.db
			.query("categories")
			.withIndex("by_retailer_active", (q) =>
				q.eq("retailerId", retailerId).eq("active", true),
			)
			.collect();
		if (orderedIds.length !== activeRows.length) {
			throw new ConvexError(
				"Order list must contain every active category exactly once",
			);
		}
		const activeIds = new Set(activeRows.map((r) => r._id));
		const seen = new Set<string>();
		for (const id of orderedIds) {
			if (!activeIds.has(id)) {
				throw new ConvexError("Category not found or no longer active");
			}
			if (seen.has(id)) throw new ConvexError("Duplicate id in order list");
			seen.add(id);
		}

		const now = Date.now();
		for (let i = 0; i < orderedIds.length; i++) {
			await ctx.db.patch(orderedIds[i], { sortOrder: i, updatedAt: now });
		}
		await logAdminAction(ctx, access, "categories.reorder", retailerId);
	},
});

/**
 * Reorder the products WITHIN one category (the junction rows' sortOrder,
 * independent of each product's global sortOrder). `orderedProductIds` must be
 * exactly the set of products currently assigned to the category — including
 * archived/hidden ones, which the dashboard still shows so their position
 * isn't silently lost.
 */
export const reorderProducts = mutation({
	args: {
		categoryId: v.id("categories"),
		orderedProductIds: v.array(v.id("products")),
	},
	handler: async (ctx, { categoryId, orderedProductIds }): Promise<void> => {
		const { category, access } = await requireOwnedCategory(ctx, categoryId);
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		// Soft-lock (growth-write); admin act-as bypasses.
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, category.retailerId);
		// Structure-building — Pro. Admin act-as bypasses.
		if (!access.actingAsAdmin)
			await assertPlanFeature(ctx, category.retailerId, "categories");

		const junctions = await ctx.db
			.query("productCategories")
			.withIndex("by_category_sort", (q) => q.eq("categoryId", categoryId))
			.collect();
		if (orderedProductIds.length !== junctions.length) {
			throw new ConvexError(
				"Order list must contain every product in this category exactly once",
			);
		}
		const byProductId = new Map(junctions.map((j) => [j.productId, j]));
		const seen = new Set<string>();
		for (const id of orderedProductIds) {
			if (!byProductId.has(id)) {
				throw new ConvexError("Product is not in this category");
			}
			if (seen.has(id)) throw new ConvexError("Duplicate id in order list");
			seen.add(id);
		}

		for (let i = 0; i < orderedProductIds.length; i++) {
			const junction = byProductId.get(orderedProductIds[i]);
			if (junction && junction.sortOrder !== i) {
				await ctx.db.patch(junction._id, { sortOrder: i });
			}
		}
		await logAdminAction(ctx, access, "categories.reorderProducts", categoryId);
	},
});

/**
 * Set the FULL category membership for one product (the editor's chip picker
 * submits the complete selection). Diffs the junction rows: inserts added
 * categories (appended to the end of each category's product order), deletes
 * removed ones, leaves kept rows untouched so their within-category position
 * survives an unrelated edit.
 *
 * Plan gate fires ONLY when the diff ADDS rows — removing/clearing stays
 * un-gated so a downgraded seller can always untangle their catalog
 * (chargeablePickup's set-gated/clear-ungated precedent).
 */
export const setProductCategories = mutation({
	args: {
		productId: v.id("products"),
		categoryIds: v.array(v.id("categories")),
	},
	handler: async (ctx, { productId, categoryIds }): Promise<void> => {
		const product = await ctx.db.get(productId);
		if (!product) throw new Error("Product not found");
		const access = await requireRetailerOwner(ctx, product.retailerId);
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		// Soft-lock (growth-write); admin act-as bypasses.
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, product.retailerId);

		const requested = new Set(categoryIds);
		if (requested.size !== categoryIds.length) {
			throw new ConvexError("Duplicate category in list");
		}
		if (requested.size > MAX_CATEGORIES_PER_PRODUCT) {
			throw new ConvexError(
				`A product can be in at most ${MAX_CATEGORIES_PER_PRODUCT} categories`,
			);
		}

		const existing = await ctx.db
			.query("productCategories")
			.withIndex("by_product", (q) => q.eq("productId", productId))
			.collect();
		const existingByCategory = new Map(existing.map((j) => [j.categoryId, j]));

		const added = categoryIds.filter((id) => !existingByCategory.has(id));
		const removed = existing.filter((j) => !requested.has(j.categoryId));

		// Pro gate only on ADDING structure; pure removal/clear stays un-gated.
		if (added.length > 0 && !access.actingAsAdmin)
			await assertPlanFeature(ctx, product.retailerId, "categories");

		// Validate additions: must be this retailer's ACTIVE categories.
		for (const categoryId of added) {
			const category = await ctx.db.get(categoryId);
			if (
				!category ||
				category.retailerId !== product.retailerId ||
				!category.active
			) {
				throw new ConvexError("Category not found or no longer active");
			}
		}

		const now = Date.now();
		for (const junction of removed) {
			await ctx.db.delete(junction._id);
		}
		for (const categoryId of added) {
			// Append to the end of the category's product order.
			const siblings = await ctx.db
				.query("productCategories")
				.withIndex("by_category_sort", (q) => q.eq("categoryId", categoryId))
				.collect();
			const nextSortOrder =
				siblings.reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1;
			await ctx.db.insert("productCategories", {
				productId,
				categoryId,
				retailerId: product.retailerId,
				sortOrder: nextSortOrder,
				createdAt: now,
			});
		}
		if (added.length > 0 || removed.length > 0) {
			await logAdminAction(
				ctx,
				access,
				"categories.setProductCategories",
				productId,
			);
		}
	},
});
