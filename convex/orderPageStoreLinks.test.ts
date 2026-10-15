/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// The order page's exits (z8r3fducgw). The buyer's order read is that page's
// ONLY retailer read, so the two facts its exits hang on ride it: whether the
// store has a storefront to go back to (`storeOffline`), and whether it opted
// out of the /stores directory (`marketplaceUnlisted`, which hides "Discover
// more stores" exactly as the storefront's own footer does).

const modules = import.meta.glob("./**/*.ts");
const OWNER = "user_owner";

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

type T = ReturnType<typeof setup>;

async function seedOrder(t: T) {
	const asOwner = t.withIdentity({ subject: OWNER });
	await asOwner.mutation(api.retailers.createRetailer, {
		storeName: "Yap",
		slug: "yap",
	});
	const retailer = await asOwner.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	const productId = await asOwner.mutation(api.products.create, {
		retailerId: retailer._id,
		name: "Tent wash",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: false,
		requiresProof: false,
		variants: [{ optionValues: [], price: 5000, onHand: 10 }],
	});
	const { shortId } = await t.mutation(api.orders.create, {
		retailerId: retailer._id,
		items: [{ productId, quantity: 1 }],
		currency: "MYR",
		channel: "whatsapp",
		customer: { name: "Ali", waPhone: "60123456789" },
		deliveryAddress: {
			line1: "12 Jln Mawar 3",
			city: "Petaling Jaya",
			state: "Selangor",
			postcode: "47301",
		},
	});
	const order = await t.run((ctx) =>
		ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first(),
	);
	if (!order?.trackingToken) throw new Error("order seed failed");
	return { retailerId: retailer._id, token: order.trackingToken };
}

function setAdminMode(
	t: T,
	retailerId: Id<"retailers">,
	adminMode: "paused" | "offline",
) {
	return t.run((ctx) =>
		ctx.db.insert("storeAvailability", {
			retailerId,
			adminMode,
			adminAt: Date.now(),
			updatedAt: Date.now(),
		}),
	);
}

describe("the order read carries what the page's exits need", () => {
	test("a listed, open store: a slug to go back to, and the directory door open", async () => {
		const t = setup();
		const { token } = await seedOrder(t);
		const order = await t.query(api.orders.get, { token });
		expect(order?.retailerSlug).toBe("yap");
		expect(order?.storeOffline).toBe(false);
		expect(order?.marketplaceUnlisted).toBe(false);
	});

	test("a store that opted out of /stores reads as unlisted", async () => {
		const t = setup();
		const { retailerId, token } = await seedOrder(t);
		await t.run((ctx) =>
			ctx.db.patch(retailerId, { marketplaceUnlistedAt: Date.now() }),
		);
		const order = await t.query(api.orders.get, { token });
		expect(order?.marketplaceUnlisted).toBe(true);
	});

	test("a store Kedaipal took offline reads as offline — there is no storefront to go back to", async () => {
		const t = setup();
		const { retailerId, token } = await seedOrder(t);
		await setAdminMode(t, retailerId, "offline");
		const order = await t.query(api.orders.get, { token });
		expect(order?.storeOffline).toBe(true);
	});

	test("a PAUSED store is not offline — its storefront still browses", async () => {
		const t = setup();
		const { retailerId, token } = await seedOrder(t);
		await setAdminMode(t, retailerId, "paused");
		const order = await t.query(api.orders.get, { token });
		expect(order?.storeOffline).toBe(false);
	});
});
