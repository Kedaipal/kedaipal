/// <reference types="vite/client" />
// Dashboard alert feed — stamps + auth. See docs/order-notifications.md.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const OWNER = "user_notify_owner";
const STRANGER = "user_notify_stranger";

async function seed(t: ReturnType<typeof setup>) {
	const asOwner = t.withIdentity({ subject: OWNER });
	await asOwner.mutation(api.retailers.createRetailer, {
		storeName: "Alert Mart",
		slug: "alert-mart",
	});
	const retailer = await asOwner.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

async function seedOrder(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	overrides: Partial<Doc<"orders">> = {},
): Promise<Id<"orders">> {
	return t.run(async (ctx) => {
		const now = Date.now();
		return ctx.db.insert("orders", {
			retailerId,
			shortId: `ORD-${Math.floor(Math.random() * 9000) + 1000}`,
			items: [],
			subtotal: 1000,
			total: 1000,
			currency: "MYR",
			status: "confirmed",
			channel: "whatsapp",
			customer: { name: "Aina" },
			deliveryMethod: "delivery",
			createdAt: now,
			updatedAt: now,
			...overrides,
		});
	});
}

describe("notifications.latestActivity", () => {
	test("returns the newest order stamp and the newest failed booking", async () => {
		const t = setup();
		const retailer = await seed(t);
		const asOwner = t.withIdentity({ subject: OWNER });

		const empty = await asOwner.query(api.notifications.latestActivity, {
			retailerId: retailer._id,
		});
		expect(empty.newestOrder).toBeNull();
		expect(empty.newestFailedBooking).toBeNull();

		await seedOrder(t, retailer._id, { createdAt: 1000 });
		const orderB = await seedOrder(t, retailer._id, { createdAt: 2000 });
		await t.run(async (ctx) => {
			const order = await ctx.db.get(orderB);
			await ctx.db.insert("deliveryJobs", {
				orderId: orderB,
				retailerId: retailer._id,
				provider: "lalamove",
				providerOrderId: "LLM-N1",
				status: "expired",
				costActual: 1200,
				quotationId: "q1",
				vehicleType: "MOTORCYCLE",
				failureReason: "No driver found",
				createdAt: 3000,
				updatedAt: 3500,
			});
			if (!order) throw new Error("order missing");
		});

		const res = await asOwner.query(api.notifications.latestActivity, {
			retailerId: retailer._id,
		});
		expect(res.newestOrder?.createdAt).toBe(2000);
		expect(res.newestFailedBooking?.failedAt).toBe(3500);
		expect(res.newestFailedBooking?.reason).toBe("No driver found");
	});

	test("a stranger can't read another store's activity", async () => {
		const t = setup();
		const retailer = await seed(t);
		const asStranger = t.withIdentity({ subject: STRANGER });
		await expect(
			asStranger.query(api.notifications.latestActivity, {
				retailerId: retailer._id,
			}),
		).rejects.toThrow();
	});
});
