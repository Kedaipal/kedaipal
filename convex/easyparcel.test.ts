/// <reference types="vite/client" />
// EasyParcel integration (z8r3fdcje2) — polled-status application (the
// webhook-apply contract without a webhook: idempotency, order
// auto-transitions, AWB/label mirroring), the commit mirror, the shared
// one-active-job invariant across providers, and the registry country gate.
// Pure client mechanics are covered in convex/lib/easyparcel.test.ts.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER = "user_easyparcel_tests";

async function seedRetailer(
	t: ReturnType<typeof setup>,
	overrides: Partial<Doc<"retailers">> = {},
) {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Kedai SG",
		slug: "kedai-sg-easyparcel",
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	// A connected, enabled EasyParcel SG account with a pickup address — what
	// the connect action would have stored (plaintext key: env key unset in
	// tests, encryptSecret passthrough).
	await t.run(async (ctx) => {
		await ctx.db.patch(retailer._id, {
			country: "SG",
			currency: "SGD",
			easyparcel: {
				enabled: true,
				apiKey: "ep-test-key",
				apiKeyHint: "-key",
				isDemo: true,
				balanceMinor: 5000,
				balanceCurrency: "SGD",
				balanceCheckedAt: Date.now(),
				pickupAddress: {
					unit: "#05-11",
					address1: "10 Anson Road",
					postcode: "079903",
				},
				connectedAt: Date.now(),
			},
			...overrides,
		});
	});
	return retailer;
}

let orderSeq = 0;
async function seedOrder(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	overrides: Partial<Doc<"orders">> = {},
): Promise<Id<"orders">> {
	return t.run(async (ctx) => {
		const now = Date.now();
		orderSeq += 1;
		return ctx.db.insert("orders", {
			retailerId,
			shortId: `ORD-E${String(orderSeq).padStart(3, "0")}`,
			items: [],
			subtotal: 4500,
			total: 4500,
			currency: "SGD",
			status: "confirmed",
			channel: "whatsapp",
			customer: { name: "Mei Ling", waPhone: "6598765432" },
			deliveryMethod: "delivery",
			deliveryAddress: {
				line1: "Blk 123 Bedok North Ave 3",
				city: "Singapore",
				state: "Singapore",
				postcode: "460123",
			},
			createdAt: now,
			updatedAt: now,
			...overrides,
		});
	});
}

async function seedJob(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	orderId: Id<"orders">,
	overrides: Partial<Doc<"deliveryJobs">> = {},
): Promise<Id<"deliveryJobs">> {
	return t.run(async (ctx) => {
		const now = Date.now();
		return ctx.db.insert("deliveryJobs", {
			orderId,
			retailerId,
			provider: "easyparcel",
			providerOrderId: "EI-5UFAI",
			status: "assigning",
			costActual: 800,
			quotationId: "EP-CS0IC",
			vehicleType: "EP-CS0IC",
			serviceName: "Teleport Pink",
			createdAt: now,
			updatedAt: now,
			...overrides,
		});
	});
}

const T1 = Date.parse("2026-10-20T04:00:00.000Z");
const T2 = Date.parse("2026-10-20T05:00:00.000Z");

describe("applyStatusSync — the poll plays the webhook's part", () => {
	test("Collected auto-ships a confirmed order with the AWB mirrored on it", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId);

		await t.mutation(internal.easyparcel.applyStatusSync, {
			jobId,
			shipStatus: "Collected",
			awb: "SGAWB001",
			labelUrl: "https://demo.connect.easyparcel.sg/?ac=AWBLabel&id=1",
			syncedAt: T1,
		});

		const { order, job } = await t.run(async (ctx) => ({
			order: await ctx.db.get(orderId),
			job: await ctx.db.get(jobId),
		}));
		expect(job?.status).toBe("picked_up");
		expect(job?.awb).toBe("SGAWB001");
		expect(job?.labelUrl).toContain("AWBLabel");
		expect(order?.status).toBe("shipped");
		expect(order?.courierName).toBe("Teleport Pink");
		expect(order?.trackingNo).toBe("SGAWB001");
	});

	test("Successfully Delivered auto-delivers; a repeated poll is a no-op", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, { status: "shipped" });
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "picked_up",
			awb: "SGAWB002",
		});

		const row = {
			jobId,
			shipStatus: "Successfully Delivered",
			awb: "SGAWB002",
			syncedAt: T2,
		};
		await t.mutation(internal.easyparcel.applyStatusSync, row);
		await t.mutation(internal.easyparcel.applyStatusSync, row); // next poll

		const { order, job, events } = await t.run(async (ctx) => ({
			order: await ctx.db.get(orderId),
			job: await ctx.db.get(jobId),
			events: await ctx.db
				.query("orderEvents")
				.withIndex("by_order", (q) => q.eq("orderId", orderId))
				.collect(),
		}));
		expect(job?.status).toBe("completed");
		expect(order?.status).toBe("delivered");
		expect(events.filter((e) => e.status === "delivered")).toHaveLength(1);
	});

	test("On Hold surfaces a reason without moving the job or the order", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "picked_up",
		});

		await t.mutation(internal.easyparcel.applyStatusSync, {
			jobId,
			shipStatus: "On Hold",
			syncedAt: T1,
		});

		const { order, job } = await t.run(async (ctx) => ({
			order: await ctx.db.get(orderId),
			job: await ctx.db.get(jobId),
		}));
		expect(job?.status).toBe("picked_up");
		expect(job?.failureReason).toContain("on hold");
		expect(order?.status).toBe("confirmed");
	});

	test("a seller-cancelled job keeps its own story even when the poll disagrees", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "canceled",
			failureReason: "Cancelled by you (in EasyParcel)",
		});

		// The unpaid order later EXPIRES at EasyParcel — a DIFFERENT terminal
		// status, so this reaches the sellerCancelled guard rather than the
		// no-change branch. "Cancelled by you" must not be rewritten into a
		// story about expiry.
		await t.mutation(internal.easyparcel.applyStatusSync, {
			jobId,
			shipStatus: "Expired (Unpaid)",
			syncedAt: T2,
		});

		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.status).toBe("canceled");
		expect(job?.failureReason).toBe("Cancelled by you (in EasyParcel)");
	});

	test("the AWB mirror never overwrites a seller's manual tracking entry", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, {
			courierName: "NinjaVan",
			trackingNo: "MANUAL-1",
		});
		const jobId = await seedJob(t, retailer._id, orderId);

		await t.mutation(internal.easyparcel.applyStatusSync, {
			jobId,
			shipStatus: "Pending For Collection",
			awb: "SGAWB003",
			syncedAt: T1,
		});

		const { order, job } = await t.run(async (ctx) => ({
			order: await ctx.db.get(orderId),
			job: await ctx.db.get(jobId),
		}));
		expect(job?.awb).toBe("SGAWB003"); // the job keeps provider truth
		expect(order?.trackingNo).toBe("MANUAL-1"); // the seller's entry wins
		expect(order?.courierName).toBe("NinjaVan");
	});
});

describe("commitBooking — the pay response lands on the ledger and the order", () => {
	test("order number, cost, AWB and label commit; the mirror uses the courier name", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId, {
			providerOrderId: undefined,
			costActual: 0,
		});

		await t.mutation(internal.easyparcel.commitBooking, {
			jobId,
			providerOrderId: "EI-NEW01",
			costActual: 850,
			courierName: "J&T Express",
			awb: "JT000111",
			labelUrl: "https://x/label.pdf",
		});

		const { order, job } = await t.run(async (ctx) => ({
			order: await ctx.db.get(orderId),
			job: await ctx.db.get(jobId),
		}));
		expect(job?.providerOrderId).toBe("EI-NEW01");
		expect(job?.costActual).toBe(850);
		expect(job?.labelUrl).toBe("https://x/label.pdf");
		expect(order?.courierName).toBe("J&T Express");
		expect(order?.trackingNo).toBe("JT000111");
	});
});

describe("one active job per order — across providers", () => {
	test("an active Delyva job blocks an EasyParcel reservation (and vice versa)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		await seedJob(t, retailer._id, orderId, {
			provider: "delyva",
			providerOrderId: "DLV-9",
			status: "ongoing",
		});

		await expect(
			t.mutation(internal.easyparcel.reserveBooking, {
				orderId,
				retailerId: retailer._id,
				serviceId: "EP-CS0IC",
				serviceName: "Teleport Pink",
			}),
		).rejects.toThrow(/already in progress/);
	});

	test("a terminal job frees the slot; markCancelled is how a live one ends", async () => {
		const t = setup();
		const asUser = t.withIdentity({ subject: USER });
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const shortId = await t.run(
			async (ctx) => (await ctx.db.get(orderId))?.shortId ?? "",
		);
		await seedJob(t, retailer._id, orderId, { status: "assigning" });

		const cancelled = await asUser.mutation(api.easyparcel.markCancelled, {
			shortId,
		});
		expect(cancelled.ok).toBe(true);

		// The slot is free again — a new reservation inserts cleanly.
		const newJobId = await t.mutation(internal.easyparcel.reserveBooking, {
			orderId,
			retailerId: retailer._id,
			serviceId: "EP-CS5QE",
			serviceName: "J&T Express",
		});
		expect(newJobId).toBeDefined();
	});
});

describe("the registry country gate", () => {
	test("an MY store sees country_unsupported even with a key pasted", async () => {
		const t = setup();
		const asUser = t.withIdentity({ subject: USER });
		const retailer = await seedRetailer(t, { country: "MY", currency: "MYR" });
		const orderId = await seedOrder(t, retailer._id, {
			currency: "MYR",
			deliveryAddress: {
				line1: "7 Jalan Bukit Bintang",
				city: "Kuala Lumpur",
				state: "WP Kuala Lumpur",
				postcode: "55100",
			},
		});
		const shortId = await t.run(
			async (ctx) => (await ctx.db.get(orderId))?.shortId ?? "",
		);

		const state = await asUser.query(api.easyparcel.getDispatchState, {
			shortId,
		});
		expect(state?.blockReason).toBe("country_unsupported");
		expect(state?.bookingEnabled).toBe(false);
	});

	test("an SG store with everything in place has a live button (no block)", async () => {
		const t = setup();
		const asUser = t.withIdentity({ subject: USER });
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const shortId = await t.run(
			async (ctx) => (await ctx.db.get(orderId))?.shortId ?? "",
		);

		const state = await asUser.query(api.easyparcel.getDispatchState, {
			shortId,
		});
		expect(state?.blockReason).toBeNull();
		expect(state?.bookingEnabled).toBe(true);
		expect(state?.isDemo).toBe(true);
		expect(state?.pickupSummary).toContain("#05-11 10 Anson Road");
	});
});
