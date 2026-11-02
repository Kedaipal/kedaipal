/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { MISSING_WEIGHT_NAMED_MAX } from "./products";
import schema from "./schema";

/**
 * The weight & zone readiness check (86eye9xd4, 4A): the delivery-pricing page
 * names the products a weight-priced checkout would refuse. It must agree with
 * checkout exactly — `lacksParcelWeight` is shared — and never count what
 * checkout handles another way (custom choices, non-physical kinds, choices or
 * products that aren't live).
 */

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

async function seedRetailer(t: ReturnType<typeof convexTest>, userId: string) {
	const asUser = t.withIdentity({ subject: userId });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Weight Store",
		slug: `weight-${userId.replace(/[^a-z0-9]/g, "")}`,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return { asUser, retailerId: retailer._id };
}

/** One product with one variant, then its exact state written with t.run. */
async function seedProduct(
	t: ReturnType<typeof convexTest>,
	asUser: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
	retailerId: Id<"retailers">,
	name: string,
	state: {
		parcelWeightG: number;
		isCustom?: boolean;
		variantActive?: boolean;
		productActive?: boolean;
		kind?: "physical" | "service" | "booking";
	},
) {
	const productId = await asUser.mutation(api.products.create, {
		retailerId,
		name,
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: false,
		variants: [{ optionValues: [], price: 1000, onHand: 5 }],
	});
	await t.run(async (ctx) => {
		const variants = (await ctx.db.query("productVariants").collect()).filter(
			(v) => v.productId === productId,
		);
		for (const v of variants) {
			await ctx.db.patch(v._id, {
				parcelWeightG: state.parcelWeightG,
				isCustom: state.isCustom,
				active: state.variantActive ?? true,
			});
		}
		await ctx.db.patch(productId, {
			active: state.productActive ?? true,
			...(state.kind ? { kind: state.kind } : {}),
		});
	});
	return productId;
}

describe("products.missingParcelWeights", () => {
	test("names a live physical product with a weightless choice, and nothing else", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedRetailer(t, "user_weight_a");
		const missing = await seedProduct(t, asUser, retailerId, "Brownies", {
			parcelWeightG: 0,
		});
		await seedProduct(t, asUser, retailerId, "Weighed", { parcelWeightG: 500 });
		// Each of these is weightless, yet checkout treats it another way:
		await seedProduct(t, asUser, retailerId, "Custom cake", {
			parcelWeightG: 0,
			isCustom: true,
		});
		await seedProduct(t, asUser, retailerId, "Retired choice", {
			parcelWeightG: 0,
			variantActive: false,
		});
		await seedProduct(t, asUser, retailerId, "Hidden product", {
			parcelWeightG: 0,
			productActive: false,
		});
		await seedProduct(t, asUser, retailerId, "Tent wash", {
			parcelWeightG: 0,
			kind: "service",
		});

		const result = await asUser.query(api.products.missingParcelWeights, {
			retailerId,
		});
		expect(result).toEqual({
			count: 1,
			choiceCount: 1,
			named: [{ productId: missing, name: "Brownies" }],
		});
	});

	test("counts every product but names only the first few", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedRetailer(t, "user_weight_b");
		const total = MISSING_WEIGHT_NAMED_MAX + 2;
		for (let i = 0; i < total; i++) {
			await seedProduct(t, asUser, retailerId, `Item ${i}`, { parcelWeightG: 0 });
		}
		const result = await asUser.query(api.products.missingParcelWeights, {
			retailerId,
		});
		expect(result.count).toBe(total);
		expect(result.named).toHaveLength(MISSING_WEIGHT_NAMED_MAX);
	});

	test("another store's seller can't read it", async () => {
		const t = setup();
		const { retailerId } = await seedRetailer(t, "user_weight_c");
		const { asUser: stranger } = await seedRetailer(t, "user_weight_d");
		await expect(
			stranger.query(api.products.missingParcelWeights, { retailerId }),
		).rejects.toThrow();
	});
});
