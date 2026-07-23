import { ConvexError, v } from "convex/values";
import { MAX_NOTICE_DAYS } from "./lib/fulfilmentDate";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import {
	adminUserIds,
	logAdminAction,
	type RetailerAccess,
	requireRetailerAccess,
} from "./lib/auth";
import {
	bumpCategoryCountsForProduct,
	isProductVisible,
} from "./lib/categoryCounts";
import { rateLimiter } from "./lib/rateLimiter";
import { assertSubscriptionActive } from "./subscriptions";
import {
	cartesian,
	DEFAULT_CUSTOM_LABEL,
	isValidCombination,
	MAX_CUSTOM_LABEL_LENGTH,
	MAX_CUSTOM_PROMPT_LENGTH,
	type OptionAxis,
	normalizeOptions,
	sameOptionValues,
	variantLabel,
} from "./lib/variant";

/** Per-product fulfilment-notice override (made-to-order items). Integer days
 * in [0, MAX_NOTICE_DAYS]; 0 normalizes to unset so "no override" has one
 * spelling. Checkout/create take the MAX across cart items + store setting. */
function sanitizeMinNoticeDays(raw: number | undefined): number | undefined {
	if (raw === undefined) return undefined;
	if (!Number.isInteger(raw) || raw < 0 || raw > MAX_NOTICE_DAYS) {
		throw new ConvexError(
			`Minimum notice must be a whole number of days between 0 and ${MAX_NOTICE_DAYS}`,
		);
	}
	return raw === 0 ? undefined : raw;
}

const MAX_IMAGES_PER_PRODUCT = 5;
const MAX_IMAGES_PER_VARIANT = 3;
const MAX_BULK_IMPORT_BATCH = 50;
const MAX_PRODUCTS_PER_RETAILER = 50;
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

// Owner-OR-admin retailer access (see convex/lib/auth.ts). Kept as a thin local
// alias so every call site in this file reads uniformly and returns the
// `actingAsAdmin` flag the mutations use to skip the soft-lock + write audit rows.
async function requireRetailerOwnership(
	ctx: QueryCtx | MutationCtx,
	retailerId: Id<"retailers">,
): Promise<RetailerAccess> {
	return requireRetailerAccess(ctx, retailerId);
}

async function requireProductOwnership(
	ctx: MutationCtx,
	productId: Id<"products">,
): Promise<{ product: Doc<"products">; access: RetailerAccess }> {
	const product = await ctx.db.get(productId);
	if (!product) throw new Error("Product not found");
	const access = await requireRetailerAccess(ctx, product.retailerId);
	return { product, access };
}

async function requireVariantOwnership(
	ctx: MutationCtx,
	variantId: Id<"productVariants">,
): Promise<{ variant: Doc<"productVariants">; access: RetailerAccess }> {
	const variant = await ctx.db.get(variantId);
	if (!variant) throw new Error("Variant not found");
	const access = await requireRetailerAccess(ctx, variant.retailerId);
	return { variant, access };
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
 * filters to active variants for the public storefront. Exported for
 * convex/categories.ts — the public category page enriches its product rows
 * through the exact same shape so the storefront grid can't diverge.
 */
export async function productWithVariants(
	ctx: QueryCtx,
	product: Doc<"products">,
	opts: { activeOnly: boolean },
) {
	const base = await withImageUrls(ctx, product);
	const all = await loadVariants(ctx, product._id);
	// Resolve the per-variant flags, falling back to the (deprecated) product-level
	// defaults so legacy variants that predate the per-variant columns keep behaving
	// exactly as before. Downstream callers (storefront sellability, order create)
	// read these resolved values, never the raw nullable columns.
	const resolved = all.map((vr) => ({
		...vr,
		blockWhenOutOfStock: vr.blockWhenOutOfStock ?? product.blockWhenOutOfStock,
		requiresProof: vr.requiresProof ?? product.requiresProof,
	}));
	const variants = opts.activeOnly ? resolved.filter((vr) => vr.active) : resolved;
	// A made-to-order variant at price 0 is "price on quote" — the seller sets the
	// real price on the mockup. Exclude those from the displayed range so a mixed
	// listing reads "from RM50" (its priced sizes) instead of a misleading "RM0".
	const isQuoteVariant = (vr: { requiresProof?: boolean; price: number }) =>
		vr.requiresProof === true && vr.price === 0;
	const prices = variants.filter((vr) => !isQuoteVariant(vr)).map((vr) => vr.price);
	const hasQuotePricing = variants.some(isQuoteVariant);
	const totalOnHand = variants.reduce((sum, vr) => sum + vr.onHand, 0);
	// Availability is always judged on ACTIVE variants only, regardless of which
	// set we're returning — otherwise the dashboard read (activeOnly:false) would
	// count deactivated variants' stock and report a sold-out product as in stock.
	// A variant contributes to "in stock" if it's made-to-order (never blocks) OR
	// it hard-blocks but still has on-hand units. Now resolved per-variant, so a
	// mixed product (fixed sizes + a made-to-order "Custom") is in stock whenever
	// ANY active variant is sellable.
	const inStock = resolved
		.filter((vr) => vr.active)
		.some((vr) => (vr.blockWhenOutOfStock ? vr.onHand > 0 : true));
	return {
		...base,
		variants,
		variantCount: variants.length,
		priceFrom: prices.length ? Math.min(...prices) : 0,
		priceTo: prices.length ? Math.max(...prices) : 0,
		hasQuotePricing,
		totalOnHand,
		inStock,
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
	// default variant of a no-axes product AND for the custom line (the two are
	// told apart by `isCustom`, never by optionValues).
	optionValues: v.array(v.string()),
	sku: v.optional(v.string()),
	price: v.number(),
	onHand: v.number(),
	parcelWeightG: v.optional(v.number()),
	imageStorageIds: v.optional(v.array(v.string())),
	active: v.optional(v.boolean()),
	blockWhenOutOfStock: v.optional(v.boolean()),
	requiresProof: v.optional(v.boolean()),
	// Custom / made-to-order line — lives outside the cartesian. See
	// validateVariantSet + docs/custom-option.md.
	isCustom: v.optional(v.boolean()),
	customLabel: v.optional(v.string()),
	customPrompt: v.optional(v.string()),
});

type VariantInput = {
	optionValues: string[];
	sku?: string;
	price: number;
	onHand: number;
	parcelWeightG?: number;
	imageStorageIds?: string[];
	active?: boolean;
	blockWhenOutOfStock?: boolean;
	requiresProof?: boolean;
	isCustom?: boolean;
	customLabel?: string;
	customPrompt?: string;
};

/**
 * Validate, normalize, and coerce the single custom / made-to-order line. It
 * lives OUTSIDE the cartesian: no optionValues, always made-to-order +
 * mockup-gated, optional price (0 = "price on quote"), optional label/prompt.
 * Throws `ConvexError` on violation. See docs/custom-option.md.
 */
function validateCustomLine(variant: VariantInput): VariantInput {
	const context = "Custom option";
	if (variant.optionValues.length !== 0)
		throw new ConvexError(`${context} must not be tied to any option values`);
	if (!Number.isInteger(variant.price) || variant.price < 0)
		throw new ConvexError(`${context}: price must be a non-negative integer (sen)`);
	if (
		variant.imageStorageIds !== undefined &&
		variant.imageStorageIds.length > MAX_IMAGES_PER_VARIANT
	)
		throw new ConvexError(`${context}: at most ${MAX_IMAGES_PER_VARIANT} images`);

	const label = (variant.customLabel ?? "").trim() || DEFAULT_CUSTOM_LABEL;
	if (label.length > MAX_CUSTOM_LABEL_LENGTH)
		throw new ConvexError(
			`${context}: name must be at most ${MAX_CUSTOM_LABEL_LENGTH} characters`,
		);
	const prompt = (variant.customPrompt ?? "").trim();
	if (prompt.length > MAX_CUSTOM_PROMPT_LENGTH)
		throw new ConvexError(
			`${context}: prompt must be at most ${MAX_CUSTOM_PROMPT_LENGTH} characters`,
		);

	return {
		optionValues: [],
		price: variant.price,
		// Always made-to-order + mockup-gated; stock is meaningless for a bespoke
		// line, so these are coerced server-side regardless of what the client sent.
		onHand: 0,
		active: variant.active ?? true,
		blockWhenOutOfStock: false,
		requiresProof: true,
		imageStorageIds: variant.imageStorageIds,
		isCustom: true,
		customLabel: label,
		customPrompt: prompt.length > 0 ? prompt : undefined,
		// A bespoke line carries no SKU — it's not an inventory unit.
		sku: undefined,
	};
}

/**
 * Validate a full set of variant inputs. The set is split into the cartesian
 * MATRIX (isCustom falsy) and an optional CUSTOM line (isCustom true). The matrix
 * must cover the product's option axes exactly (no missing, extra, or duplicate
 * combos) and pass field-level checks; the custom line (at most one) is validated
 * + coerced separately and appended. Normalizes SKUs and enforces intra-batch SKU
 * uniqueness across the matrix. Returns the cleaned inputs (matrix, then custom).
 * Throws `ConvexError` on any violation.
 */
function validateVariantSet(
	options: OptionAxis[],
	variants: VariantInput[],
): VariantInput[] {
	const matrix = variants.filter((vr) => !vr.isCustom);
	const customLines = variants.filter((vr) => vr.isCustom);

	if (customLines.length > 1)
		throw new ConvexError("A product can have at most one custom option");
	if (matrix.length === 0)
		throw new ConvexError("A product needs at least one variant");

	const expected = cartesian(options); // includes [[]] for no-axes products
	if (matrix.length !== expected.length)
		throw new ConvexError(
			`Expected ${expected.length} variants for these options, got ${matrix.length}`,
		);

	const seenCombos: string[][] = [];
	const skuSeen = new Set<string>();
	const cleaned: VariantInput[] = matrix.map((variant, i) => {
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

		// Price is stored as integer minor units (sen) — reject fractional sen.
		if (!Number.isInteger(variant.price) || variant.price < 0)
			throw new ConvexError(`${context}: price must be a non-negative integer (sen)`);
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
		// Defensive: matrix rows must never carry custom-line fields.
		return { ...variant, sku, isCustom: false, customLabel: undefined, customPrompt: undefined };
	});

	// Confirm every expected combination is present (covers the "missing combo"
	// case that the count check alone can't catch once duplicates are ruled out).
	for (const combo of expected) {
		if (!cleaned.some((vr) => sameOptionValues(vr.optionValues, combo)))
			throw new ConvexError(
				`Missing variant for combination "${variantLabel(combo)}"`,
			);
	}

	if (customLines.length === 1) cleaned.push(validateCustomLine(customLines[0]));
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

// Render order: ascending `sortOrder`, with `createdAt` as a stable tie-break
// (reordered products sit first; not-yet-ordered ones fall back to creation
// order — new products get `sortOrder: Date.now()` in create(), so they append).
function bySortOrder(a: Doc<"products">, b: Doc<"products">): number {
	return a.sortOrder - b.sortOrder || a.createdAt - b.createdAt;
}

// Dashboard "All" order: active products first (in their sortOrder), archived
// sunk to the end. Keeps the storefront-relevant products clustered at the top
// for easy reordering, and archiving a product naturally moves it down without
// any renumbering.
function byActiveThenSort(a: Doc<"products">, b: Doc<"products">): number {
	return Number(b.active) - Number(a.active) || bySortOrder(a, b);
}

export const list = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }) => {
		const rows = await ctx.db
			.query("products")
			.withIndex("by_retailer_active", (q) =>
				q.eq("retailerId", retailerId).eq("active", true),
			)
			// Off-storefront products are counter-only — never surfaced on the public
			// storefront. Two reasons, both excluded here: the seller's own `hidden`
			// toggle, and `hiddenByCategory` (every category the product is in is
			// hidden — see docs/product-categories.md). Filtered in-memory: the set
			// is one retailer's active products (capped small), cheaper than a
			// compound index. See docs/hidden-products.md.
			.filter((q) =>
				q.and(
					q.neq(q.field("hidden"), true),
					q.neq(q.field("hiddenByCategory"), true),
				),
			)
			.collect();
		rows.sort(bySortOrder);
		return Promise.all(
			rows.map((row) => productWithVariants(ctx, row, { activeOnly: true })),
		);
	},
});

// Counter checkout catalog: like `list` (active products, active variants) but
// INCLUDES hidden products, so a seller can ring up an in-person-only event SKU
// that shoppers never see online. Owner-OR-admin gated — hidden products must
// not leak through the public, unauthenticated `list`. See docs/hidden-products.md.
export const listForCounter = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }) => {
		await requireRetailerOwnership(ctx, retailerId);
		const rows = await ctx.db
			.query("products")
			.withIndex("by_retailer_active", (q) =>
				q.eq("retailerId", retailerId).eq("active", true),
			)
			.collect();
		rows.sort(bySortOrder);
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
		rows.sort(byActiveThenSort);
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
		// Inactive variants (price/stock/SKU) are owner-only. The owning retailer —
		// or a Kedaipal admin operating the store (act-as) — editing in the dashboard
		// sees the full set; any other caller, including an unauthenticated direct
		// query, gets active variants only.
		const identity = await ctx.auth.getUserIdentity();
		const owner = await ctx.db.get(row.retailerId);
		const canEdit =
			identity !== null &&
			(owner?.userId === identity.subject ||
				adminUserIds().includes(identity.subject));
		// Off-storefront products are counter-only — a non-owner caller (incl. an
		// unauthenticated direct query) must not read one, matching the promise
		// that they never leak through a public query. Both the seller's own
		// `hidden` toggle and category suppression (`hiddenByCategory`) apply.
		// Owner/admin still see it to edit. See docs/hidden-products.md.
		if ((row.hidden || row.hiddenByCategory) && !canEdit) return null;
		return productWithVariants(ctx, row, { activeOnly: !canEdit });
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
		requiresProof: v.optional(v.boolean()),
		minNoticeDays: v.optional(v.number()),
		hidden: v.optional(v.boolean()),
		variants: v.array(variantInputValidator),
	},
	handler: async (ctx, args): Promise<Id<"products">> => {
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		const access = await requireRetailerOwnership(ctx, args.retailerId);
		// Soft-lock: a past_due seller can't grow their catalog (storefront + order
		// pipeline stay live). Admins onboarding a store (act-as) bypass it —
		// white-glove happens before the seller has paid. See docs/manual-subscription.md.
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, args.retailerId);

		const existingCount = await ctx.db
			.query("products")
			.withIndex("by_retailer", (q) => q.eq("retailerId", args.retailerId))
			.collect()
			.then((r) => r.length);
		if (existingCount >= MAX_PRODUCTS_PER_RETAILER)
			throw new ConvexError(
				`Maximum ${MAX_PRODUCTS_PER_RETAILER} products per retailer`,
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
			requiresProof: args.requiresProof,
			minNoticeDays: sanitizeMinNoticeDays(args.minNoticeDays),
			hidden: args.hidden,
			sortOrder: args.sortOrder,
			active: true,
			channel: "whatsapp",
			createdAt: now,
			updatedAt: now,
		});

		await insertVariants(ctx, productId, args.retailerId, variants, now);
		await logAdminAction(ctx, access, "products.create", productId);
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
			blockWhenOutOfStock: variant.blockWhenOutOfStock,
			requiresProof: variant.requiresProof,
			isCustom: variant.isCustom,
			customLabel: variant.customLabel,
			customPrompt: variant.customPrompt,
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
		requiresProof: v.optional(v.boolean()),
		// 0 clears the override (normalized to unset); undefined = no change.
		minNoticeDays: v.optional(v.number()),
		hidden: v.optional(v.boolean()),
	},
	handler: async (ctx, { productId, ...fields }): Promise<void> => {
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		const { product: ownedProduct, access } = await requireProductOwnership(
			ctx,
			productId,
		);
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, ownedProduct.retailerId);

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
		if (fields.requiresProof !== undefined)
			updates.requiresProof = fields.requiresProof;
		if (fields.minNoticeDays !== undefined)
			updates.minNoticeDays = sanitizeMinNoticeDays(fields.minNoticeDays);
		if (fields.hidden !== undefined) updates.hidden = fields.hidden;

		// Keep the denormalized category counts accurate when this edit flips the
		// product's storefront visibility (active and/or hidden). Compute the
		// transition before patching; only bump when it actually changes.
		const wasVisible = isProductVisible(ownedProduct);
		const willVisible = isProductVisible({
			active: fields.active ?? ownedProduct.active,
			hidden: fields.hidden ?? ownedProduct.hidden,
		});

		await ctx.db.patch(productId, updates);
		if (wasVisible !== willVisible)
			await bumpCategoryCountsForProduct(ctx, productId, willVisible ? 1 : -1);
		await logAdminAction(ctx, access, "products.update", productId);
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
		const { product, access } = await requireProductOwnership(
			ctx,
			args.productId,
		);
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, product.retailerId);

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
			// Identity = (isCustom, optionValues). The custom line and a no-axes
			// default BOTH have optionValues [] — keying on optionValues alone would
			// fuse them, so the isCustom flag disambiguates. Excludes already-matched
			// rows so two []-keyed rows can't both bind to the same prior.
			const prior = existing.find(
				(e) =>
					!matched.has(e._id) &&
					Boolean(e.isCustom) === Boolean(variant.isCustom) &&
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
					blockWhenOutOfStock: variant.blockWhenOutOfStock,
					requiresProof: variant.requiresProof,
					isCustom: variant.isCustom,
					customLabel: variant.customLabel,
					customPrompt: variant.customPrompt,
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
					blockWhenOutOfStock: variant.blockWhenOutOfStock,
					requiresProof: variant.requiresProof,
					isCustom: variant.isCustom,
					customLabel: variant.customLabel,
					customPrompt: variant.customPrompt,
					sortOrder: i,
					createdAt: now,
					updatedAt: now,
				});
			}
		}
		// Remove combinations the grid no longer contains. A removed variant that
		// an in-flight order (still cancellable) references must NOT be hard-
		// deleted — its row is needed so cancel-restock can return that order's
		// stock (updateStatus skips a variant it can't load). Soft-deactivate
		// those instead; hard-delete the rest.
		const removed = existing.filter((e) => !matched.has(e._id));
		if (removed.length > 0) {
			const referenced = new Set<Id<"productVariants">>();
			for (const status of ["pending", "confirmed", "packed"] as const) {
				const openOrders = await ctx.db
					.query("orders")
					.withIndex("by_retailer_status", (q) =>
						q.eq("retailerId", product.retailerId).eq("status", status),
					)
					.collect();
				for (const order of openOrders) {
					for (const item of order.items) {
						if (item.variantId) referenced.add(item.variantId);
					}
				}
			}
			for (const prior of removed) {
				if (referenced.has(prior._id)) {
					await ctx.db.patch(prior._id, { active: false, updatedAt: now });
				} else {
					await ctx.db.delete(prior._id);
				}
			}
		}

		await ctx.db.patch(args.productId, { options, updatedAt: now });
		await logAdminAction(ctx, access, "products.saveVariantGrid", args.productId);
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
		const { variant: existing, access } = await requireVariantOwnership(
			ctx,
			variantId,
		);

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
		await logAdminAction(ctx, access, "products.updateVariant", variantId);
	},
});

export const archive = mutation({
	args: { productId: v.id("products") },
	handler: async (ctx, { productId }): Promise<void> => {
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		const { product, access } = await requireProductOwnership(ctx, productId);
		const wasVisible = isProductVisible(product);
		await ctx.db.patch(productId, {
			active: false,
			updatedAt: Date.now(),
		});
		// A newly-archived product drops off every category tile it was on.
		if (wasVisible) await bumpCategoryCountsForProduct(ctx, productId, -1);
		await logAdminAction(ctx, access, "products.archive", productId);
	},
});

// ---------------------------------------------------------------------------
// Bulk import — variant-aware (one-row-per-variant; see
// docs/bulk-product-upload-roadmap.md + product-variants.md §9).
//
// The client groups a sheet into products with their full (auto-filled) variant
// set and sends them here. Per product we either CREATE (insert the product +
// full variant set) or UPDATE-by-SKU (rows whose SKU matches existing variants
// update those variants in place). Import is UPSERT-ONLY: it never deletes
// variants the sheet omits, and it never adds a new variant into an existing
// product (that's a dashboard edit — surfaced as a skip in the preview).
// ---------------------------------------------------------------------------

const importVariantValidator = v.object({
	optionValues: v.array(v.string()),
	sku: v.optional(v.string()),
	price: v.number(), // minor units
	onHand: v.number(),
	parcelWeightG: v.optional(v.number()),
	active: v.boolean(),
});

const importProductValidator = v.object({
	name: v.string(),
	description: v.optional(v.string()),
	options: v.array(optionAxisValidator),
	variants: v.array(importVariantValidator),
});

type ImportProduct = {
	name: string;
	description?: string;
	options: OptionAxis[];
	variants: VariantInput[];
};

type ImportClassification =
	| { mode: "create" }
	| {
			mode: "update";
			product: Doc<"products">;
			existingBySku: Map<string, Doc<"productVariants">>;
	  };

/**
 * Classify an imported product as a create or an update. Update wins if ANY of
 * its SKUs already exists on a variant; all matched SKUs must belong to the same
 * product (else a cross-product clash — rejected).
 */
async function classifyImportProduct(
	ctx: MutationCtx | QueryCtx,
	retailerId: Id<"retailers">,
	product: ImportProduct,
): Promise<ImportClassification> {
	let target: Doc<"products"> | null = null;
	const existingBySku = new Map<string, Doc<"productVariants">>();
	for (const variant of product.variants) {
		const sku = normalizeSku(variant.sku, "Variant");
		if (!sku) continue;
		const existing = await ctx.db
			.query("productVariants")
			.withIndex("by_retailer_sku", (q) =>
				q.eq("retailerId", retailerId).eq("sku", sku),
			)
			.first();
		if (!existing) continue;
		if (target && existing.productId !== target._id)
			throw new ConvexError(
				`SKU "${sku}" belongs to a different product than the rest of "${product.name}"`,
			);
		if (!target) {
			const p = await ctx.db.get(existing.productId);
			if (!p) continue;
			target = p;
		}
		existingBySku.set(sku, existing);
	}
	if (!target) return { mode: "create" };
	return { mode: "update", product: target, existingBySku };
}

function totalImportVariants(products: ImportProduct[]): number {
	return products.reduce((sum, p) => sum + p.variants.length, 0);
}

/** Intra-batch SKU uniqueness across ALL products in the payload. */
function assertNoDuplicateSkusInBatch(products: ImportProduct[]): void {
	const seen = new Set<string>();
	for (const p of products) {
		for (const variant of p.variants) {
			const sku = normalizeSku(variant.sku, "Variant");
			if (!sku) continue;
			if (seen.has(sku))
				throw new ConvexError(`Duplicate SKU "${sku}" within this import`);
			seen.add(sku);
		}
	}
}

export const bulkUpsert = mutation({
	args: {
		retailerId: v.id("retailers"),
		currency: v.string(),
		products: v.array(importProductValidator),
	},
	handler: async (ctx, args): Promise<{ created: number; updated: number }> => {
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productBulkImport", { key: userId, throws: true });
		const access = await requireRetailerOwnership(ctx, args.retailerId);

		const products = args.products as ImportProduct[];
		if (products.length === 0) throw new ConvexError("No products to import");
		const variantTotal = totalImportVariants(products);
		if (variantTotal > MAX_BULK_IMPORT_BATCH)
			throw new ConvexError(
				`Maximum ${MAX_BULK_IMPORT_BATCH} variant rows per batch (received ${variantTotal})`,
			);

		assertNoDuplicateSkusInBatch(products);

		// Classify every product (create vs update) before any writes.
		const classified: { product: ImportProduct; c: ImportClassification }[] = [];
		for (const product of products) {
			classified.push({
				product,
				c: await classifyImportProduct(ctx, args.retailerId, product),
			});
		}

		// Product cap — only creates count.
		const insertCount = classified.filter((x) => x.c.mode === "create").length;
		const existingCount = await ctx.db
			.query("products")
			.withIndex("by_retailer", (q) => q.eq("retailerId", args.retailerId))
			.collect()
			.then((r) => r.length);
		if (existingCount + insertCount > MAX_PRODUCTS_PER_RETAILER)
			throw new ConvexError(
				`Would exceed the ${MAX_PRODUCTS_PER_RETAILER}-product limit per retailer (currently ${existingCount}, +${insertCount} new)`,
			);

		const now = Date.now();
		let created = 0;
		let updated = 0;

		for (const { product, c } of classified) {
			if (c.mode === "create") {
				// Same validation as the single-product create: full cartesian,
				// integer price/stock, per-retailer SKU uniqueness.
				const options = normalizeOptionsOrThrow(product.options);
				const variants = validateVariantSet(options, product.variants);
				for (const variant of variants) {
					if (variant.sku)
						await assertVariantSkuUnique(ctx, args.retailerId, variant.sku);
				}
				const productId = await ctx.db.insert("products", {
					retailerId: args.retailerId,
					name: product.name.trim(),
					description: product.description,
					currency: args.currency,
					imageStorageIds: [],
					options,
					sortOrder: now + created,
					active: true,
					channel: "whatsapp",
					createdAt: now,
					updatedAt: now,
				});
				await insertVariants(ctx, productId, args.retailerId, variants, now);
				created++;
			} else {
				await ctx.db.patch(c.product._id, {
					name: product.name.trim(),
					description: product.description,
					currency: args.currency,
					updatedAt: now,
				});
				// Update matched variants in place; skip unmatched (never add a new
				// variant to an existing product, never delete unlisted ones).
				for (const variant of product.variants) {
					const sku = normalizeSku(variant.sku, "Variant");
					if (!sku) continue;
					const existing = c.existingBySku.get(sku);
					if (!existing) continue;
					if (!Number.isInteger(variant.price) || variant.price < 0)
						throw new ConvexError(
							`Variant "${sku}": price must be a non-negative integer (sen)`,
						);
					if (!Number.isInteger(variant.onHand) || variant.onHand < 0)
						throw new ConvexError(
							`Variant "${sku}": stock must be a non-negative integer`,
						);
					await ctx.db.patch(existing._id, {
						price: variant.price,
						onHand: variant.onHand,
						parcelWeightG: variant.parcelWeightG ?? existing.parcelWeightG,
						updatedAt: now,
					});
				}
				updated++;
			}
		}

		await logAdminAction(ctx, access, "products.bulkUpsert", args.retailerId);
		return { created, updated };
	},
});

type PreviewEntry = {
	name: string;
	action: "create" | "update" | "error";
	productId: Id<"products"> | null;
	variantCount: number;
	changedVariants: number; // create: new active variants; update: variants whose price/stock change
	skippedVariants: number; // update: provided variants with no matching existing variant
	autoFilled: number; // inactive auto-filled combinations
	warnings: string[];
};

/**
 * Non-mutating dry-run for `bulkUpsert`. Classifies each product as create /
 * update / error and reports per-product + summary counts so the UI can show
 * "3 products · 11 variants · 2 new / 1 update" before committing. Advisory —
 * `bulkUpsert` re-classifies at commit time.
 */
export const bulkUpsertPreview = query({
	args: {
		retailerId: v.id("retailers"),
		products: v.array(importProductValidator),
	},
	handler: async (ctx, args) => {
		await requireRetailerOwnership(ctx, args.retailerId);
		const products = args.products as ImportProduct[];
		if (totalImportVariants(products) > MAX_BULK_IMPORT_BATCH)
			throw new ConvexError(
				`Preview exceeds ${MAX_BULK_IMPORT_BATCH} variant rows`,
			);

		const plan: PreviewEntry[] = [];
		let creates = 0;
		let updates = 0;
		let variantsTotal = 0;
		let autoFilledTotal = 0;

		for (const product of products) {
			const autoFilled = product.variants.filter((vr) => !vr.active).length;
			variantsTotal += product.variants.length;
			autoFilledTotal += autoFilled;

			let c: ImportClassification;
			try {
				c = await classifyImportProduct(ctx, args.retailerId, product);
			} catch (err) {
				plan.push({
					name: product.name,
					action: "error",
					productId: null,
					variantCount: product.variants.length,
					changedVariants: 0,
					skippedVariants: 0,
					autoFilled,
					warnings: [(err as Error).message],
				});
				continue;
			}

			if (c.mode === "create") {
				// Surface validation errors (incomplete grid, dup combo, etc.) now.
				try {
					const options = normalizeOptionsOrThrow(product.options);
					validateVariantSet(options, product.variants);
				} catch (err) {
					plan.push({
						name: product.name,
						action: "error",
						productId: null,
						variantCount: product.variants.length,
						changedVariants: 0,
						skippedVariants: 0,
						autoFilled,
						warnings: [(err as Error).message],
					});
					continue;
				}
				creates++;
				plan.push({
					name: product.name,
					action: "create",
					productId: null,
					variantCount: product.variants.length,
					changedVariants: product.variants.filter((vr) => vr.active).length,
					skippedVariants: 0,
					autoFilled,
					warnings: [],
				});
			} else {
				updates++;
				let changed = 0;
				let skipped = 0;
				const warnings: string[] = [];
				for (const variant of product.variants) {
					const sku = normalizeSku(variant.sku, "Variant");
					if (!sku) {
						if (variant.active) skipped++; // a real row we can't key on
						continue;
					}
					const existing = c.existingBySku.get(sku);
					if (!existing) {
						skipped++;
						warnings.push(
							`"${sku}" isn't an existing variant — add new variants in the dashboard`,
						);
						continue;
					}
					if (existing.price !== variant.price || existing.onHand !== variant.onHand)
						changed++;
				}
				plan.push({
					name: product.name,
					action: "update",
					productId: c.product._id,
					variantCount: product.variants.length,
					changedVariants: changed,
					skippedVariants: skipped,
					autoFilled,
					warnings,
				});
			}
		}

		return {
			plan,
			summary: {
				products: products.length,
				creates,
				updates,
				variants: variantsTotal,
				autoFilled: autoFilledTotal,
			},
		};
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

/**
 * Bulk reorder: assign `sortOrder = index` to the retailer's products in the
 * given order. `orderedIds` must be exactly the retailer's full product set
 * (active + archived) — the dashboard reorder list shows them all, and global
 * sortOrder keeps the storefront (active-only) order unambiguous. Mirrors
 * pickupLocations.reorder. Concurrent reorders are last-write-wins.
 */
export const reorder = mutation({
	args: {
		retailerId: v.id("retailers"),
		orderedIds: v.array(v.id("products")),
	},
	handler: async (ctx, { retailerId, orderedIds }): Promise<void> => {
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		const access = await requireRetailerOwnership(ctx, retailerId);

		const rows = await ctx.db
			.query("products")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.collect();
		if (orderedIds.length !== rows.length) {
			throw new ConvexError(
				"Order list must contain every product exactly once",
			);
		}
		const byId = new Map(rows.map((r) => [r._id, r]));
		const seen = new Set<string>();
		for (const id of orderedIds) {
			if (!byId.has(id)) throw new ConvexError("Product not found");
			if (seen.has(id)) throw new ConvexError("Duplicate id in order list");
			seen.add(id);
		}

		// Patch ONLY the products whose position actually changed — a drag usually
		// moves a few. Skipping the rest avoids needless `updatedAt` churn and
		// reduces OCC contention with a concurrent edit on an unmoved product.
		const now = Date.now();
		for (let i = 0; i < orderedIds.length; i++) {
			const row = byId.get(orderedIds[i]);
			if (row && row.sortOrder !== i) {
				await ctx.db.patch(orderedIds[i], { sortOrder: i, updatedAt: now });
			}
		}
		await logAdminAction(ctx, access, "products.reorder", retailerId);
	},
});
