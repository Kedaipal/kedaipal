/**
 * Dev seed script. Inserts 1 retailer + a mix of single- and multi-variant
 * products (so the storefront pickers + variant grid have something to render).
 *
 * Usage:
 *   npx convex run seed:run
 *   pnpm seed
 *
 * Idempotent — skips if the seed retailer slug already exists.
 * Never run against a production deployment.
 */
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { cartesian, variantLabel } from "./lib/variant";

const SEED_SLUG = "trailgear";

type SeedProduct = {
	name: string;
	description: string;
	// When present, drives the variant grid; otherwise a single default variant
	// is created from `price`/`stock`.
	options?: { name: string; values: string[] }[];
	blockWhenOutOfStock?: boolean;
	price?: number;
	stock?: number;
	// Per-combination price/stock overrides keyed by label ("1kg / Fillet").
	// Any combo not listed falls back to `price`/`stock`.
	variantOverrides?: Record<string, { price: number; stock: number }>;
};

const PRODUCTS: SeedProduct[] = [
	{ name: "Basecamp 2-Person Tent", description: "Lightweight 3-season tent, easy setup, 1.8 kg.", price: 39900, stock: 10, blockWhenOutOfStock: true },
	{ name: "Trailblazer Backpack 45L", description: "Ergonomic hiking pack with hip-belt pockets.", price: 24900, stock: 15, blockWhenOutOfStock: true },
	{ name: "Merino Wool Base Layer", description: "Temperature-regulating, odour-resistant top.\n\n**Sizes:** S–XL.", price: 8900, stock: 30, blockWhenOutOfStock: true,
		options: [{ name: "Size", values: ["S", "M", "L", "XL"] }] },
	{ name: "Trekking Pole Set (pair)", description: "Aluminium, collapsible, cork grip handles.", price: 14900, stock: 20, blockWhenOutOfStock: true },
	{ name: "Headlamp 350lm", description: "USB rechargeable, red-light mode, IPX4 rated.", price: 4900, stock: 50, blockWhenOutOfStock: true },
	// F&B-style made-to-order product with a Weight axis + per-variant pricing.
	{ name: "Frozen Salmon", description: "Norwegian salmon, vacuum-packed.\n\n**What's included:** ice-pack insulated box.", blockWhenOutOfStock: false,
		options: [{ name: "Weight", values: ["500g", "1kg"] }, { name: "Cut", values: ["Fillet", "Whole"] }],
		price: 4500, stock: 0,
		variantOverrides: {
			"500g / Fillet": { price: 4500, stock: 0 },
			"500g / Whole": { price: 4000, stock: 0 },
			"1kg / Fillet": { price: 8500, stock: 0 },
			"1kg / Whole": { price: 7800, stock: 0 },
		} },
] as const;

export const run = internalMutation({
	args: {},
	handler: async (ctx) => {
		// Idempotency check
		const existing = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", SEED_SLUG))
			.first();

		if (existing) {
			// Products already seeded — top up the categories layer if it's missing
			// (added later than the original seed), so older dev deployments get a
			// browsable category rail without a re-seed.
			const seededCategories = await ctx.db
				.query("categories")
				.withIndex("by_retailer", (q) => q.eq("retailerId", existing._id))
				.first();
			if (!seededCategories) {
				await seedCategories(ctx, existing._id);
				console.log(`Seed topped up — categories added to "${SEED_SLUG}".`);
				return { skipped: false, retailerId: existing._id };
			}
			console.log(`Seed already applied — retailer "${SEED_SLUG}" exists. Skipping.`);
			return { skipped: true };
		}

		const now = Date.now();

		const retailerId = await ctx.db.insert("retailers", {
			userId: "seed:dev",
			slug: SEED_SLUG,
			storeName: "TrailGear Malaysia",
			waPhone: "601234567890",
			currency: "MYR",
			channel: "whatsapp",
			createdAt: now,
			updatedAt: now,
		});

		for (let i = 0; i < PRODUCTS.length; i++) {
			const p = PRODUCTS[i];
			const options = p.options ?? [];
			const productId = await ctx.db.insert("products", {
				retailerId,
				name: p.name,
				description: p.description,
				currency: "MYR",
				imageStorageIds: [],
				options,
				blockWhenOutOfStock: p.blockWhenOutOfStock,
				active: true,
				channel: "whatsapp",
				sortOrder: i,
				createdAt: now,
				updatedAt: now,
			});

			const combos = cartesian(options); // [[]] when no options
			for (let j = 0; j < combos.length; j++) {
				const optionValues = combos[j];
				const override = p.variantOverrides?.[variantLabel(optionValues)];
				await ctx.db.insert("productVariants", {
					productId,
					retailerId,
					optionValues,
					price: override?.price ?? p.price ?? 0,
					onHand: override?.stock ?? p.stock ?? 0,
					reserved: 0,
					parcelWeightG: 0,
					imageStorageIds: [],
					active: true,
					sortOrder: j,
					createdAt: now,
					updatedAt: now,
				});
			}
		}

		await seedCategories(ctx, retailerId);

		console.log(`Seed complete — retailer "${SEED_SLUG}" with ${PRODUCTS.length} products inserted.`);
		return { skipped: false, retailerId };
	},
});

/** Categories keyed by product-name match — gives the storefront rail + nested
 * category pages something to render. "Camp Setup" and "On the Trail" overlap
 * on purpose (a product can sit in multiple categories). */
const CATEGORIES: { name: string; slug: string; productNames: string[] }[] = [
	{
		name: "Camp Setup",
		slug: "camp-setup",
		productNames: ["Basecamp 2-Person Tent", "Headlamp 350lm"],
	},
	{
		name: "On the Trail",
		slug: "on-the-trail",
		productNames: [
			"Trailblazer Backpack 45L",
			"Trekking Pole Set (pair)",
			"Merino Wool Base Layer",
			"Headlamp 350lm",
		],
	},
	{
		name: "Frozen Food",
		slug: "frozen-food",
		productNames: ["Frozen Salmon"],
	},
];

async function seedCategories(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
) {
	const now = Date.now();
	const products = await ctx.db
		.query("products")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.collect();
	const byName = new Map(products.map((p) => [p.name, p._id]));
	for (let i = 0; i < CATEGORIES.length; i++) {
		const c = CATEGORIES[i];
		const categoryId = await ctx.db.insert("categories", {
			retailerId,
			name: c.name,
			slug: c.slug,
			active: true,
			sortOrder: i,
			createdAt: now,
			updatedAt: now,
		});
		let sortOrder = 0;
		for (const name of c.productNames) {
			const productId = byName.get(name);
			if (!productId) continue;
			await ctx.db.insert("productCategories", {
				productId,
				categoryId,
				retailerId,
				sortOrder: sortOrder++,
				createdAt: now,
			});
		}
	}
}
