import { ConvexError, v } from "convex/values";
import { isMytMidnight, MAX_NOTICE_DAYS } from "./lib/fulfilmentDate";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
	internalMutation,
	mutation,
	type MutationCtx,
	query,
	type QueryCtx,
} from "./_generated/server";
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
import { sanitizeMinQuantity } from "./lib/minOrderRules";
import {
	assertProductCap,
	MAX_PRODUCTS_PER_RETAILER,
	productCapState,
} from "./lib/productCap";
import { deleteProductCascade } from "./lib/productDelete";
import {
	POPULAR_SCAN_CAP,
	POPULAR_TOP_CANDIDATES,
	rankPopularProducts,
} from "./lib/popularProducts";
import { rateLimiter } from "./lib/rateLimiter";
import { SLUG_MAX, SLUG_MIN, slugify } from "./lib/slug";
import { assertSubscriptionActive } from "./subscriptions";
import {
	cartesian,
	DEFAULT_CUSTOM_LABEL,
	isValidCombination,
	MAX_CUSTOM_LABEL_LENGTH,
	MAX_CUSTOM_PROMPT_LENGTH,
	MAX_VARIANTS_PER_PRODUCT,
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

/**
 * How many products this store holds — TOTAL rows, active AND archived, which
 * is exactly what the cap counts (see convex/lib/productCap.ts for why). One
 * author so the gate, the import preview and the dashboard counter can't
 * disagree about what "used" means.
 */
async function countProductsForRetailer(
	ctx: QueryCtx | MutationCtx,
	retailerId: Id<"retailers">,
): Promise<number> {
	const rows = await ctx.db
		.query("products")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.collect();
	return rows.length;
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
	opts: { activeOnly: boolean; forOwner?: boolean },
) {
	const base = await withImageUrls(ctx, product);
	// Seller-only fields are stripped unless the caller is an owner/admin surface.
	// `orderedAt` is sales-derived — it says whether a product has EVER sold and
	// when it first did — and this helper's `...base` spread feeds the public,
	// unauthenticated reads (`list`, `getPublicBySlug`, the category page). Left
	// in, anyone could diff a store's catalog for the SKUs that have never sold a
	// single unit. That's the same line `popularProducts` already draws by
	// returning ids only so sales volume never crosses the public wire.
	//
	// NOT keyed off `activeOnly`: the two look interchangeable but aren't —
	// `listForCounter` is owner-gated and still passes `activeOnly: true`, so
	// reusing it as an owner proxy would be right by accident today and wrong the
	// next time a surface mixes them. This is also the seam for any future
	// seller-only column: add it to the destructure, not to the payload.
	// Typed as `typeof base` (where `orderedAt` is already optional) rather than
	// letting TS infer a union: a Convex query has ONE return type regardless of
	// the runtime auth branch, so the shape has to admit the field being absent.
	// The stripped object is assignable precisely because the field is optional.
	const { orderedAt: _orderedAt, ...publicBase } = base;
	const visibleBase: typeof base =
		opts.forOwner === true ? base : publicBase;
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
		...visibleBase,
		// Always usable by the storefront's product-page links, even before the
		// slug backfill has stamped this row.
		slug: effectiveSlug(product),
		variants,
		variantCount: variants.length,
		priceFrom: prices.length ? Math.min(...prices) : 0,
		priceTo: prices.length ? Math.max(...prices) : 0,
		hasQuotePricing,
		totalOnHand,
		inStock,
	};
}

/**
 * Allocate a unique, permanent URL slug for a product within its retailer —
 * /$slug/p/<productSlug> (86eybrhrt PR2). Auto-derived from the name (never a
 * seller input) and STABLE once assigned: renames don't touch it, so a link a
 * seller pasted into WhatsApp keeps working. Uniqueness spans the retailer's
 * ENTIRE catalog incl. archived/hidden rows — restoring a product must never
 * find its URL stolen. Name collisions suffix -2, -3, … (category precedent).
 */
async function ensureUniqueProductSlug(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
	name: string,
	excludeProductId?: Id<"products">,
): Promise<string> {
	// Degenerate names (emoji-only, 1–2 chars after slugification) pad into the
	// shared 3–32 slug shape instead of failing product creation over a URL.
	let base = slugify(name);
	if (base.length < SLUG_MIN) base = base.length > 0 ? `item-${base}` : "item";
	// Bounded past the per-store product cap — a clash loop can't run away. Only
	// reachable if a store's whole catalog shares one slug base, and an
	// admin-exempt store sitting above the cap just gets the same clear throw
	// below rather than an unbounded scan.
	for (let n = 1; n <= MAX_PRODUCTS_PER_RETAILER + 10; n++) {
		const suffix = n === 1 ? "" : `-${n}`;
		const trimmed = base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, "");
		const candidate = `${trimmed}${suffix}`;
		const clash = await ctx.db
			.query("products")
			.withIndex("by_retailer_slug", (q) =>
				q.eq("retailerId", retailerId).eq("slug", candidate),
			)
			.unique();
		if (!clash || clash._id === excludeProductId) return candidate;
	}
	throw new ConvexError("Could not allocate a unique product link");
}

/**
 * The slug a product is addressable by RIGHT NOW. Stored slug when it has one;
 * otherwise derived from the name on the fly. Legacy rows created before slugs
 * existed only get a stored one when they're next edited or when
 * `backfillProductSlugs` runs — without this fallback they'd be un-openable
 * between a deploy and that backfill, since the storefront's only product view
 * is the URL-addressed page. Derived slugs resolve through the name-match arm
 * of `getPublicBySlug`.
 */
function effectiveSlug(product: Doc<"products">): string {
	if (product.slug !== undefined) return product.slug;
	const base = slugify(product.name);
	return base.length >= SLUG_MIN ? base : `item-${product._id.slice(0, 6)}`;
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

function plural(n: number, word: string): string {
	return n === 1 ? word : `${word}s`;
}

/** "Options [Size: S, M]" / "A product with no options" — names what the server rebuilt the grid from. */
function describeAxes(options: OptionAxis[]): string {
	if (options.length === 0) return "A product with no options";
	return `Options [${options.map((a) => `${a.name}: ${a.values.join(", ")}`).join("] × [")}]`;
}

/**
 * Render a combo list for an error, with the empty tuple shown as
 * "(no options)". Truncated — at the 50-variant cap the full list is a ~1KB
 * string in a seller-facing banner, and the first few already identify the
 * mismatch.
 */
const MAX_COMBOS_IN_ERROR = 6;
function describeCombos(combos: readonly (readonly string[])[]): string {
	if (combos.length === 0) return "none";
	const shown = combos
		.slice(0, MAX_COMBOS_IN_ERROR)
		.map((c) => (c.length === 0 ? "(no options)" : `"${variantLabel(c)}"`))
		.join(", ");
	const rest = combos.length - MAX_COMBOS_IN_ERROR;
	return rest > 0 ? `${shown} …and ${rest} more` : shown;
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

	/**
	 * A product's sellable lines are the cartesian **matrix ∪ the custom line**,
	 * so a product whose ONLY line is bespoke is legitimate — that's the "Made to
	 * order" product type (ClickUp `86eyfq04j`): a tent wash, a commissioned
	 * cake. It carries no matrix because there is nothing to enumerate; the
	 * custom line IS the offer, which is what gives the buyer the request box and
	 * the qty-1 lock for free.
	 *
	 * Requires no axes: axes with an empty matrix would be a grid describing
	 * combinations nothing sells. Everything else keeps the exact old rules, and
	 * this only ever LOOSENS them, so no stored product becomes invalid.
	 */
	const customOnly =
		matrix.length === 0 && customLines.length === 1 && options.length === 0;

	if (matrix.length === 0 && !customOnly)
		throw new ConvexError("A product needs at least one variant");

	const expected = cartesian(options); // includes [[]] for no-axes products
	if (!customOnly && matrix.length !== expected.length)
		throw new ConvexError(
			`${describeAxes(options)} makes ${expected.length} ${plural(expected.length, "combination")} ` +
				`(${describeCombos(expected)}), but ${matrix.length} ${plural(matrix.length, "variant")} ` +
				`arrived (${describeCombos(matrix.map((vr) => vr.optionValues))}).`,
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
	// Skipped for a custom-only product: `cartesian([])` is `[[]]`, so this would
	// demand the empty matrix row the made-to-order type exists to avoid.
	for (const combo of customOnly ? [] : expected) {
		if (!cleaned.some((vr) => sameOptionValues(vr.optionValues, combo)))
			throw new ConvexError(
				`Missing variant for combination "${variantLabel(combo)}" — ` +
					`${describeAxes(options)} needs ${describeCombos(expected)}, ` +
					`but only ${describeCombos(cleaned.map((vr) => vr.optionValues))} arrived.`,
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
			rows.map((row) =>
				// Owner-gated read (counter checkout), so seller-only fields are safe.
				productWithVariants(ctx, row, { activeOnly: true, forOwner: true }),
			),
		);
	},
});

/**
 * Just the store's product-cap state — a handful of numbers, no catalog. The
 * create surfaces (`/app/products/new`) need to know whether there's room
 * before letting a seller build a product they couldn't save, and pulling the
 * whole hydrated catalog (variants + signed image URLs) to derive one integer
 * would be absurd. The products list keeps deriving it from the `listAll` it
 * already holds; both go through `productCapState`, so the flags can't drift.
 */
export const capState = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }) => {
		const access = await requireRetailerOwnership(ctx, retailerId);
		return productCapState(
			await countProductsForRetailer(ctx, retailerId),
			access.actingAsAdmin,
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
				// Owner-gated dashboard read — seller-only fields stay in.
			rows.map((row) =>
				productWithVariants(ctx, row, { activeOnly: false, forOwner: true }),
			),
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
		//
		// `!row.active` (archived) is in the same bucket and was missing: every
		// other public read excludes archived products (`list` and
		// `getPublicBySlug` both scope to `active`), so a bare id was the one way
		// to pull an archived product's full public payload. Pre-existing, found
		// in the PR #155 review.
		if ((!row.active || row.hidden || row.hiddenByCategory) && !canEdit)
			return null;
		// Shared endpoint: the same `canEdit` that decides whether inactive variants
		// are visible also decides whether seller-only fields are. An
		// unauthenticated buyer hitting this by id gets the public shape.
		return productWithVariants(ctx, row, {
			activeOnly: !canEdit,
			forOwner: canEdit,
		});
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
		// Minimum order quantity (summed across variants). 0/1 normalize to unset.
		minQuantity: v.optional(v.number()),
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

		// Product cap — counts archived rows too, so deleting (not archiving) is
		// what frees a slot. An admin operating the store (act-as) is exempt: a
		// white-glove Enterprise catalog gets stocked past the ceiling by hand,
		// the same posture as the subscription soft-lock bypass above.
		assertProductCap(
			await countProductsForRetailer(ctx, args.retailerId),
			1,
			access.actingAsAdmin,
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
			slug: await ensureUniqueProductSlug(ctx, args.retailerId, args.name),
			description: args.description,
			currency: args.currency,
			imageStorageIds: args.imageStorageIds,
			options,
			blockWhenOutOfStock: args.blockWhenOutOfStock,
			requiresProof: args.requiresProof,
			minNoticeDays: sanitizeMinNoticeDays(args.minNoticeDays),
			hidden: args.hidden,
			minQuantity: sanitizeMinQuantity(args.minQuantity),
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
		// Minimum order quantity. 0 (or 1) clears the rule; undefined = no change.
		minQuantity: v.optional(v.number()),
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
		if (fields.minQuantity !== undefined)
			// 0/1 sanitize to undefined, which patch treats as "remove the field" —
			// so sending 0 clears the rule (one spelling for "no minimum").
			updates.minQuantity = sanitizeMinQuantity(fields.minQuantity);

		// Lazy slug convergence for legacy rows (pre-slug catalog): the first
		// edit gives the product its permanent URL, using the freshest name.
		// Existing slugs are STABLE — a rename never rewrites them, so links a
		// seller already shared keep working. backfillProductSlugs covers rows
		// that are never edited.
		if (ownedProduct.slug === undefined) {
			updates.slug = await ensureUniqueProductSlug(
				ctx,
				ownedProduct.retailerId,
				(updates.name as string | undefined) ?? ownedProduct.name,
				productId,
			);
		}

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
					// `onHand` is deliberately ABSENT (86eypn8ye). The form renders a
					// count when it opens; by the time Save is tapped that number can
					// be minutes stale, and writing it back resurrects everything sold
					// in between — from a save the seller made to fix a typo. Stock
					// moves only through `adjustStock`, where it is the thing being
					// asked for. The client still sends `onHand` because the same
					// validator serves the INSERT below, where it is correct: a
					// brand-new combination has no stock of its own to protect.
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

/**
 * Per-row variant edit (price, sku, weight, images, active).
 *
 * Stock is NOT here: it moves only through `adjustStock` (86eypn8ye). This
 * mutation writes whatever it is handed, so an `onHand` argument would be a
 * second absolute-write door onto the field the whole ticket exists to protect.
 */
export const updateVariant = mutation({
	args: {
		variantId: v.id("productVariants"),
		sku: v.optional(v.union(v.string(), v.null())),
		price: v.optional(v.number()),
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

/**
 * The ONLY way stock changes by hand (86eypn8ye).
 *
 * Every other write path used to set `onHand` to an absolute number rendered
 * minutes earlier, so saving an unrelated field — a typo in the name — wrote
 * back a count that sales had since moved, resurrecting units that were already
 * out the door. Stock is now removed from the product save entirely and moved
 * here, where changing it is something the seller *asked* to do.
 *
 * Two shapes per adjustment, and the difference is the whole point:
 *
 * - `delta` is a MOVEMENT ("I baked 20 more", "sold 3 at the stall"). It is
 *   correct against any starting number, so a sale landing between the seller's
 *   last look and this mutation cannot corrupt it. The read happens inside this
 *   transaction, so two adjustments racing each other both land.
 * - `setTo` is an OVERWRITE, for the one real job a delta can't express: a
 *   physical stock count. It carries `expectedOnHand` — what the seller could
 *   see when they confirmed — and is refused if reality has moved since, so the
 *   seller re-confirms against a number they have actually seen rather than
 *   silently writing a sale out of existence.
 *
 * Takes a LIST because the multi-variant stock sheet moves several counts at
 * once ("after the market day"). One mutation is one transaction, so a sheet
 * either applies whole or not at all — N separate calls would leave the seller
 * with some rows moved and some not, and no way to tell which.
 *
 * Floored at zero rather than throwing, matching `decrementAggregatesForCancel`
 * and the usage meter: an over-subtraction self-heals instead of dead-ending.
 * Reserved units are not netted off here — that is the reservation ledger
 * (86eybbxhf), still unbuilt.
 */
export const adjustStock = mutation({
	args: {
		adjustments: v.array(
			v.object({
				variantId: v.id("productVariants"),
				/** Signed movement. Mutually exclusive with `setTo`. */
				delta: v.optional(v.number()),
				/** Absolute count from a stock take. Requires `expectedOnHand`. */
				setTo: v.optional(v.number()),
				/** The count the seller was looking at when they confirmed `setTo`. */
				expectedOnHand: v.optional(v.number()),
			}),
		),
	},
	returns: v.array(
		v.object({ variantId: v.id("productVariants"), onHand: v.number() }),
	),
	handler: async (
		ctx,
		args,
	): Promise<{ variantId: Id<"productVariants">; onHand: number }[]> => {
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });

		if (args.adjustments.length === 0)
			throw new ConvexError("Nothing to adjust");
		// Mirrors the per-product variant cap: the sheet that sends a batch can
		// never hold more rows than one product's grid.
		if (args.adjustments.length > MAX_VARIANTS_PER_PRODUCT)
			throw new ConvexError(
				`At most ${MAX_VARIANTS_PER_PRODUCT} stock changes at once`,
			);
		const seen = new Set<string>();
		for (const a of args.adjustments) {
			if (seen.has(a.variantId))
				throw new ConvexError("Each variant may appear only once");
			seen.add(a.variantId);
		}

		const now = Date.now();
		const results: { variantId: Id<"productVariants">; onHand: number }[] = [];

		for (const adjustment of args.adjustments) {
			const { variant, access } = await requireVariantOwnership(
				ctx,
				adjustment.variantId,
			);
			if (!access.actingAsAdmin)
				await assertSubscriptionActive(ctx, variant.retailerId);

			// A bespoke line is priced on a quote and never counted — `onHand` is
			// coerced to 0 on every write path. Offering to adjust it would invent a
			// concept the product deliberately doesn't have.
			if (variant.isCustom)
				throw new ConvexError("A custom order line has no stock to count.");

			const hasDelta = adjustment.delta !== undefined;
			const hasSetTo = adjustment.setTo !== undefined;
			if (hasDelta === hasSetTo)
				throw new ConvexError("Send exactly one of delta or setTo");

			let next: number;
			if (hasDelta) {
				const delta = adjustment.delta as number;
				if (!Number.isInteger(delta))
					throw new ConvexError("Stock movement must be a whole number");
				next = Math.max(0, variant.onHand + delta);
			} else {
				const setTo = adjustment.setTo as number;
				// No upper bound, matching every other stock write path — an invented
				// ceiling here would be a rule nothing else enforces and nothing tells
				// the seller about.
				if (!Number.isInteger(setTo) || setTo < 0)
					throw new ConvexError("Stock must be a whole number, 0 or more");
				if (adjustment.expectedOnHand === undefined)
					throw new ConvexError("Setting an exact count needs expectedOnHand");
				// The stale-overwrite guard. Deliberately NOT a silent merge: only the
				// seller knows whether they counted the shelf before or after those
				// units left, so the answer has to come from them.
				if (adjustment.expectedOnHand !== variant.onHand)
					throw new ConvexError(
						`Stock changed to ${variant.onHand} while you were counting — check the number and confirm again.`,
					);
				next = setTo;
			}

			if (next !== variant.onHand)
				await ctx.db.patch(adjustment.variantId, {
					onHand: next,
					updatedAt: now,
				});
			await logAdminAction(
				ctx,
				access,
				"products.adjustStock",
				adjustment.variantId,
			);
			results.push({ variantId: adjustment.variantId, onHand: next });
		}

		return results;
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

/**
 * Permanently erase a product — the escape valve that makes the product cap an
 * honest contract rather than a one-way ratchet (86eyjmf4q). Distinct from
 * `archive`, which only takes a product off the storefront and KEEPS its slot:
 * the cap counts total rows, so deleting is the ONLY way to free one.
 *
 * **Refuses once the product has ever been ordered** (`orderedAt` set). Order
 * lines carry `items[].productId` as a hard reference beside the frozen
 * name/price snapshot, so erasing a sold product would orphan those references
 * (Insights groups top products by productId and resolves the row for its
 * thumbnail). A sold product is archived instead — history stays intact. That
 * still leaves every row that actually clogs a cap deletable: test products,
 * typos, duplicated imports, and seasonal SKUs that never sold.
 *
 * Owner-OR-admin, matching `archive` — this is a seller's own catalog
 * housekeeping, NOT the admin-only posture of the order hard delete (orders are
 * financial records; a never-sold product is not). Deliberately not
 * subscription-gated for the same reason `archive` isn't: reducing is always
 * allowed, so a past_due or downgraded seller is never trapped.
 */
export const deletePermanently = mutation({
	args: { productId: v.id("products") },
	handler: async (ctx, { productId }): Promise<void> => {
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		const { product, access } = await requireProductOwnership(ctx, productId);

		if (product.orderedAt !== undefined)
			throw new ConvexError(
				"This product has been ordered before, so it can't be deleted — its past orders still reference it. Archive it instead to take it off your storefront.",
			);

		// Decrement the categories this product was counted in BEFORE the cascade
		// drops its junction rows (the bump reads them to know which categories to
		// touch). Archived/hidden products were never counted, so nothing to undo.
		if (isProductVisible(product))
			await bumpCategoryCountsForProduct(ctx, productId, -1);

		await deleteProductCascade(ctx, product);
		// `logAdminAction` (owner writes not logged), NOT the always-audit
		// `logDestructiveAdminAction` that `orders.hardDelete` uses — deliberate.
		// That one exists because an order erase is admin-only and destroys a
		// financial record, so it must always answer "who did this?". This
		// mutation is owner-or-admin by design, so always-auditing would file
		// every seller's routine typo cleanup into `adminAuditLog` under an
		// `adminUserId` that isn't an admin. A never-sold product also leaves no
		// history to reconstruct — that's precisely what `orderedAt` guarantees.
		await logAdminAction(ctx, access, "products.deletePermanently", productId);
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

/**
 * CSV import. Rows are matched to existing variants by SKU.
 *
 * ## Why `updateStock` exists and defaults to OFF (86eypn8ye)
 *
 * This is the same last-write-wins hazard as the product editor, with a far
 * bigger window: the seller exports at 10am, edits the sheet over lunch, and
 * imports at 3pm — and every unit sold in those five hours comes back. Unlike
 * the editor, the fix cannot be "never write stock here": export → edit →
 * re-import is a documented round-trip and `stock` is a required column, so a
 * genuine stock take pasted into a spreadsheet has to keep working.
 *
 * So the side effect becomes a choice. Names, prices, descriptions and weights
 * always update; the sheet's stock column is applied only when the seller ticks
 * the box, having been told how many counts it replaces and how many of those
 * would go UP (the resurrection direction — see `bulkUpsertPreview`).
 *
 * Products being CREATED always take the sheet's stock: they have no orders and
 * therefore no sales to overwrite.
 */
export const bulkUpsert = mutation({
	args: {
		retailerId: v.id("retailers"),
		currency: v.string(),
		products: v.array(importProductValidator),
		/** Apply the sheet's `stock` column to products that already exist.
		 * Absent = off: stock is left exactly as the store holds it. */
		updateStock: v.optional(v.boolean()),
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

		// Product cap — only the rows that would be INSERTED consume a slot; a
		// sheet that just updates existing products by SKU never touches it.
		// Admin act-as is exempt (see products.create).
		const insertCount = classified.filter((x) => x.c.mode === "create").length;
		assertProductCap(
			await countProductsForRetailer(ctx, args.retailerId),
			insertCount,
			access.actingAsAdmin,
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
					slug: await ensureUniqueProductSlug(
						ctx,
						args.retailerId,
						product.name,
					),
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
						// Opt-in only — see the note on this mutation. Omitting the key
						// (rather than writing `existing.onHand` back) means an untouched
						// count is never rewritten at all.
						...(args.updateStock ? { onHand: variant.onHand } : {}),
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
	/** Matched variants whose sheet stock differs from the stored count — what
	 * `updateStock` would overwrite. 0 on a create (nothing to overwrite). */
	stockChanges: number;
	/** The subset of those that would go UP. This is the direction that invents
	 * units, and the likeliest cause is a sale made after the sheet was exported,
	 * so it is counted separately and named in the UI. */
	stockIncreases: number;
	/** The increases themselves, so the seller can look rather than trust a
	 * number. Capped per product — the point is to make the risk concrete, not
	 * to render a spreadsheet. */
	stockIncreaseSamples: { sku: string; from: number; to: number }[];
};

/** Per-product cap on `stockIncreaseSamples`. */
const MAX_STOCK_SAMPLES_PER_PRODUCT = 5;

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
		const access = await requireRetailerOwnership(ctx, args.retailerId);
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
					stockChanges: 0,
					stockIncreases: 0,
					stockIncreaseSamples: [],
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
						stockChanges: 0,
						stockIncreases: 0,
						stockIncreaseSamples: [],
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
					// A new product has no stored count to overwrite — its stock comes
					// from the sheet regardless of the `updateStock` choice.
					stockChanges: 0,
					stockIncreases: 0,
					stockIncreaseSamples: [],
				});
			} else {
				updates++;
				let changed = 0;
				let skipped = 0;
				let stockChanges = 0;
				let stockIncreases = 0;
				const stockIncreaseSamples: PreviewEntry["stockIncreaseSamples"] = [];
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
					if (existing.onHand !== variant.onHand) {
						stockChanges++;
						if (variant.onHand > existing.onHand) {
							stockIncreases++;
							if (stockIncreaseSamples.length < MAX_STOCK_SAMPLES_PER_PRODUCT)
								stockIncreaseSamples.push({
									sku,
									from: existing.onHand,
									to: variant.onHand,
								});
						}
					}
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
					stockChanges,
					stockIncreases,
					stockIncreaseSamples,
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
				// Summed from the plan so the import screen can state the cost of
				// ticking "Update stock too" without walking the entries itself.
				stockChanges: plan.reduce((n, e) => n + e.stockChanges, 0),
				stockIncreases: plan.reduce((n, e) => n + e.stockIncreases, 0),
			},
			// Cap state so the import screen can warn BEFORE the seller confirms —
			// the sheet is chunked across several bulkUpsert calls, so without this
			// a too-large import would half-apply and then throw partway through.
			// Same for every chunk (no writes happen during a preview), so the
			// client can read it off any one of them.
			cap: productCapState(
				await countProductsForRetailer(ctx, args.retailerId),
				access.actingAsAdmin,
			),
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

// ---------------------------------------------------------------------------
// Product pages — /$slug/p/<productSlug> (86eybrhrt PR2)
// ---------------------------------------------------------------------------

/**
 * Public product-page read. Applies the exact storefront visibility rules of
 * `list` (active, not hidden, not category-suppressed) so a counter-only or
 * archived product's URL answers null (→ 404) instead of leaking it. Unknown
 * slug → null. Same `productWithVariants` shape as `list`, so the page, the
 * grid and the detail sheet can never disagree about a product.
 */
export const getPublicBySlug = query({
	args: { retailerId: v.id("retailers"), slug: v.string() },
	handler: async (ctx, { retailerId, slug }) => {
		const normalized = slug.trim().toLowerCase();
		if (normalized.length === 0) return null;
		const indexed = await ctx.db
			.query("products")
			.withIndex("by_retailer_slug", (q) =>
				q.eq("retailerId", retailerId).eq("slug", normalized),
			)
			.unique();
		// Fallback for rows the slug backfill hasn't stamped yet: match on the
		// slug derived from the name. Bounded by the 50-product cap. A HIT on a
		// migrated catalog never reaches here (the index arm answers first); a
		// MISS — an unknown or probed slug — always does, which is the same
		// bounded scan `list` already runs on every storefront page load.
		// Keeps every product addressable the moment the page ships,
		// independent of when the backfill is run.
		const row =
			indexed ??
			(
				await ctx.db
					.query("products")
					.withIndex("by_retailer_active", (q) =>
						q.eq("retailerId", retailerId).eq("active", true),
					)
					.collect()
			).find((p) => p.slug === undefined && effectiveSlug(p) === normalized);
		if (
			!row ||
			!row.active ||
			row.hidden === true ||
			row.hiddenByCategory === true
		)
			return null;
		return productWithVariants(ctx, row, { activeOnly: true });
	},
});

/**
 * Every storefront-visible product as `{storeSlug, productSlug, updatedAt}` for
 * `/sitemap.xml`. Without this the product pages would be undiscoverable: the
 * grid's `<Link>`s make them crawlable once a bot is already on a storefront,
 * but the sitemap is what tells Google the pages exist at all — and the pages
 * carry `robots: index, follow`, a canonical and `Product` JSON-LD that are
 * inert until something points at them.
 *
 * Same visibility rules as `list`, applied per retailer (active, not hidden,
 * not category-suppressed) — a counter-only or archived product must not appear
 * in a public sitemap any more than it appears on the storefront. Slug-less
 * legacy rows are SKIPPED rather than emitted via `effectiveSlug`: a derived
 * slug is a temporary address, and publishing one to a crawler risks indexing a
 * URL the backfill is about to change. Cross-retailer scan, like
 * `retailers.listSlugsForSitemap` — the route caches for an hour.
 */
export const listForSitemap = query({
	args: {},
	handler: async (
		ctx,
	): Promise<
		Array<{ storeSlug: string; productSlug: string; updatedAt: number }>
	> => {
		const retailers = await ctx.db.query("retailers").collect();
		const out: Array<{
			storeSlug: string;
			productSlug: string;
			updatedAt: number;
		}> = [];
		for (const retailer of retailers) {
			const rows = await ctx.db
				.query("products")
				.withIndex("by_retailer_active", (q) =>
					q.eq("retailerId", retailer._id).eq("active", true),
				)
				.filter((q) =>
					q.and(
						q.neq(q.field("hidden"), true),
						q.neq(q.field("hiddenByCategory"), true),
					),
				)
				.collect();
			for (const row of rows) {
				if (row.slug === undefined) continue;
				out.push({
					storeSlug: retailer.slug,
					productSlug: row.slug,
					updatedAt: row._creationTime,
				});
			}
		}
		return out;
	},
});

/**
 * PUBLIC (unauthenticated storefront) — ranked product-id candidates for the
 * landing's "Popular this week" feature card (86eybrhrt PR3). Real order data,
 * zero seller curation; ranking + thresholds live in `lib/popularProducts.ts`.
 *
 * Returns ONLY ids, and only ids of products the storefront actually lists —
 * no sales counts ever cross the public wire, and an archived or counter-only
 * product is never named to an unauthenticated caller.
 *
 * **Visibility is filtered before the cap, and that order matters.** Ranking
 * reads `orders.items[].productId` with no product lookup, so counter-only
 * SKUs (hidden from the storefront, fully counter-sellable, and their orders
 * count) rank like anything else. Capping to ten first and letting the client
 * discard them — which is what this did until the PR #155 review — spends
 * slots on products that can never render, with nothing to back-fill them: a
 * stall seller whose top ten are counter-only got an empty shelf.
 *
 * Live stock and minimum-quantity stay a CLIENT concern: they change by the
 * minute and the client already has them reactively in `products.list`, so
 * re-deriving them here would just be a staler copy.
 *
 * Cache discipline (the insights precedent): `since` must be an MYT-midnight
 * epoch — every buyer on the same date sends identical args and shares one
 * cached result, instead of a per-pageview `Date.now()` fragmenting the
 * cache. The newest-first `take(POPULAR_SCAN_CAP)` bounds the indexed read
 * whatever window a hand-rolled client asks for.
 */
export const popularProducts = query({
	args: { retailerId: v.id("retailers"), since: v.number() },
	handler: async (ctx, { retailerId, since }) => {
		if (!isMytMidnight(since)) {
			throw new ConvexError("since must be an MYT-midnight epoch");
		}
		const recent = await ctx.db
			.query("orders")
			.withIndex("by_retailer", (q) =>
				q.eq("retailerId", retailerId).gte("_creationTime", since),
			)
			.order("desc")
			.take(POPULAR_SCAN_CAP);
		const ranked = rankPopularProducts(
			recent.map((o) => ({ status: o.status, items: o.items })),
		);
		if (ranked.length === 0) return [];
		// Exactly `list`'s visibility rules, read the same way (one indexed query
		// over this retailer's active products, capped small) so the shelf and
		// the grid can never disagree about what's public.
		const listable = await ctx.db
			.query("products")
			.withIndex("by_retailer_active", (q) =>
				q.eq("retailerId", retailerId).eq("active", true),
			)
			.filter((q) =>
				q.and(
					q.neq(q.field("hidden"), true),
					q.neq(q.field("hiddenByCategory"), true),
				),
			)
			.collect();
		const listableIds = new Set<string>(listable.map((p) => p._id));
		return ranked
			.filter((id) => listableIds.has(id))
			.slice(0, POPULAR_TOP_CANDIDATES);
	},
});

/**
 * One-shot backfill: give every legacy product (created before slugs existed)
 * its permanent URL. Idempotent (rows with a slug are skipped) and batched +
 * self-scheduling to stay inside transaction limits. Run once per deployment
 * after the schema lands:
 *
 *   npx convex run products:backfillProductSlugs
 *
 * Until it has run, slug-less rows stay reachable through `effectiveSlug` (the
 * derived name-slug arm of `getPublicBySlug`) — nothing 404s, the URLs just
 * aren't stored yet. Run it right after the deploy anyway: `ensureUniqueProductSlug`
 * only sees STORED slugs, so until every row has one a brand-new product can be
 * handed the slug a legacy row is currently answering to, and the older product's
 * link would resolve to the newer one.
 */
export const backfillProductSlugs = internalMutation({
	args: { cursor: v.optional(v.string()) },
	handler: async (ctx, { cursor }): Promise<void> => {
		const page = await ctx.db
			.query("products")
			.paginate({ numItems: 25, cursor: cursor ?? null });
		for (const row of page.page) {
			if (row.slug !== undefined) continue;
			const slug = await ensureUniqueProductSlug(
				ctx,
				row.retailerId,
				row.name,
				row._id,
			);
			await ctx.db.patch(row._id, { slug });
		}
		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, internal.products.backfillProductSlugs, {
				cursor: page.continueCursor,
			});
		}
	},
});

/**
 * One-shot backfill for `products.orderedAt` (86eyjmf4q). Existing products
 * predate the stamp, so without this every one of them would look "never
 * ordered" and `deletePermanently` would happily erase a product that live
 * order lines still reference. Run once per deployment after the schema lands:
 *
 *   npx convex run products:backfillProductOrderedAt
 *
 * Paginates ORDERS (the source of truth) rather than products, since the fact
 * lives in `orders.items[]` and there's no index from a product back to its
 * orders. Batched + self-scheduling to stay inside transaction limits, like the
 * slug backfill above. Converges on the EARLIEST order per product, because
 * page order is not chronological — the stamp is only read as a boolean today,
 * but a half-true timestamp is the kind of thing a later feature trips over.
 */
export const backfillProductOrderedAt = internalMutation({
	args: { cursor: v.optional(v.string()) },
	handler: async (ctx, { cursor }): Promise<void> => {
		const page = await ctx.db
			.query("orders")
			.paginate({ numItems: 25, cursor: cursor ?? null });
		for (const order of page.page) {
			// Cancelled orders count: the line still names the product, so erasing
			// it would orphan that reference exactly as a live order would.
			const orderedAt = order.createdAt;
			const seen = new Set<string>();
			for (const item of order.items) {
				if (seen.has(item.productId)) continue;
				seen.add(item.productId);
				const product = await ctx.db.get(item.productId);
				if (!product) continue; // already erased with its store
				if (product.orderedAt !== undefined && product.orderedAt <= orderedAt)
					continue;
				await ctx.db.patch(item.productId, { orderedAt });
			}
		}
		if (!page.isDone) {
			await ctx.scheduler.runAfter(
				0,
				internal.products.backfillProductOrderedAt,
				{ cursor: page.continueCursor },
			);
		}
	},
});
