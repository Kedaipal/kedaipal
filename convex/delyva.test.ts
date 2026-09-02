/// <reference types="vite/client" />
// Delyva integration (86eyjpv6z) — webhook event application (idempotency,
// out-of-order safety, order auto-transitions, AWB mirroring) + the shared
// one-active-job reservation invariant across providers. Pure client
// mechanics are covered in convex/lib/delyva.test.ts.
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

const USER = "user_delyva_tests";

async function seedRetailer(t: ReturnType<typeof setup>) {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Kedai Beku",
		slug: "kedai-beku-delyva",
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	// A connected, enabled Delyva account with a pickup address — what the
	// connect action would have stored (plaintext creds: env key unset in
	// tests, encryptSecret passthrough).
	await t.run(async (ctx) => {
		await ctx.db.patch(retailer._id, {
			delyva: {
				enabled: true,
				apiKey: "dx-test-key",
				apiSecret: "dx-test-secret",
				apiKeyHint: "-key",
				customerId: 128399,
				accountName: "Kedai Beku",
				defaultItemType: "CHILLED",
				pickupAddress: {
					address1: "12 Jalan Ampang",
					city: "Kuala Lumpur",
					state: "Kuala Lumpur",
					postcode: "50450",
				},
				connectedAt: Date.now(),
				webhooksSubscribedAt: Date.now(),
			},
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
			shortId: `ORD-9${String(orderSeq).padStart(3, "0")}`,
			items: [],
			subtotal: 5000,
			total: 5000,
			currency: "MYR",
			status: "confirmed",
			channel: "whatsapp",
			customer: { name: "Aisha", waPhone: "60123456789" },
			deliveryMethod: "delivery",
			deliveryAddress: {
				line1: "7 Jalan Bukit Bintang",
				city: "Kuala Lumpur",
				state: "Kuala Lumpur",
				postcode: "55100",
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
			provider: "delyva",
			providerOrderId: "DLV-1",
			status: "assigning",
			costActual: 1850,
			quotationId: "NINJA-COLD",
			vehicleType: "NINJA-COLD",
			serviceName: "Ninja Cold",
			itemType: "CHILLED",
			createdAt: now,
			updatedAt: now,
			...overrides,
		});
	});
}

const T1 = Date.parse("2026-08-27T04:00:00.000Z");
const T2 = Date.parse("2026-08-27T05:00:00.000Z");

describe("applyWebhookEvent — status flow", () => {
	test("collected (500) auto-ships a confirmed order with the AWB on it", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId);

		// order.created delivers the consignment number first…
		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 100,
			consignmentNo: "MY0012345678",
			eventAt: T1,
		});
		// …then the courier collects.
		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 500,
			eventAt: T2,
		});

		const { order, job } = await t.run(async (ctx) => ({
			order: await ctx.db.get(orderId),
			job: await ctx.db.get(jobId),
		}));
		expect(job?.status).toBe("picked_up");
		expect(job?.awb).toBe("MY0012345678");
		expect(job?.lastEventAt).toBe(T2);
		expect(order?.status).toBe("shipped");
		// The buyer-visible manual-courier fields (86eyehvk4) carry the AWB.
		expect(order?.courierName).toBe("Ninja Cold");
		expect(order?.trackingNo).toBe("MY0012345678");
		expect(order?.carrierTrackingUrl).toContain("MY0012345678");
	});

	test("completed (700) auto-delivers; a replay is a no-op", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, { status: "shipped" });
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "picked_up",
		});

		const event = { jobId, statusCode: 700, eventAt: T2 };
		await t.mutation(internal.delyva.applyWebhookEvent, event);
		await t.mutation(internal.delyva.applyWebhookEvent, event); // retry

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

	test("out-of-order: an older event never regresses the job", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "picked_up",
			lastEventAt: T2,
		});

		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 200, // courier accepted — an OLDER stage
			eventAt: T1,
		});
		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.status).toBe("picked_up");
	});

	test("a stale event still fills a missing AWB (gap fill, no regression)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, { status: "shipped" });
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "picked_up",
			lastEventAt: T2,
		});

		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 100,
			consignmentNo: "MY0099",
			eventAt: T1, // older than lastEventAt
		});
		const { job, order } = await t.run(async (ctx) => ({
			job: await ctx.db.get(jobId),
			order: await ctx.db.get(orderId),
		}));
		expect(job?.status).toBe("picked_up"); // unchanged
		expect(job?.awb).toBe("MY0099"); // filled
		expect(order?.trackingNo).toBe("MY0099");
	});

	test("the AWB mirror never overwrites a seller's manual shipment entry", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, {
			courierName: "J&T Express",
			trackingNo: "MANUAL-123",
		});
		const jobId = await seedJob(t, retailer._id, orderId);

		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 100,
			consignmentNo: "MY0055",
			eventAt: T1,
		});
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.courierName).toBe("J&T Express");
		expect(order?.trackingNo).toBe("MANUAL-123");
	});

	test("failed delivery attempt (650) surfaces without failing the job", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, { status: "shipped" });
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "picked_up",
			lastEventAt: T1,
		});

		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 650,
			statusText: "Delivery failed - receiver not available",
			eventAt: T2,
		});
		const { job, order } = await t.run(async (ctx) => ({
			job: await ctx.db.get(jobId),
			order: await ctx.db.get(orderId),
		}));
		expect(job?.status).toBe("picked_up"); // parcel is still with the courier
		expect(job?.failureReason).toContain("receiver not available");
		expect(order?.status).toBe("shipped"); // never regresses
	});

	test("cancelled (900) fails the job but keeps a seller cancel's own reason", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "canceled",
			failureReason: "Cancelled by you",
			lastEventAt: T1,
		});

		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 900,
			eventAt: T2,
		});
		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.status).toBe("canceled");
		expect(job?.failureReason).toBe("Cancelled by you");
	});

	test("failed collection (475) from active fails the job with the reason", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "ongoing",
			lastEventAt: T1,
		});

		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 475,
			statusText: "Pickup failed",
			eventAt: T2,
		});
		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.status).toBe("rejected");
		expect(job?.failureReason).toBe("Pickup failed");
	});

	test("a cancelled order is never touched by courier events", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, { status: "cancelled" });
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "ongoing",
		});

		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 500,
			eventAt: T2,
		});
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.status).toBe("cancelled");
	});

	test("unknown status codes are ignored, never thrown", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId);

		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 4242,
			eventAt: T1,
		});
		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.status).toBe("assigning");
		expect(job?.lastEventAt).toBeUndefined();
	});
});

describe("reserveBooking — one active job per order, across providers", () => {
	test("a live LALAMOVE job blocks a Delyva reservation", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		await seedJob(t, retailer._id, orderId, {
			provider: "lalamove",
			providerOrderId: "LLM-9",
			status: "ongoing",
		});

		await expect(
			t.mutation(internal.delyva.reserveBooking, {
				orderId,
				retailerId: retailer._id,
				serviceCode: "DHLEC-MY",
				serviceName: "DHL eCommerce",
				itemType: "PARCEL",
			}),
		).rejects.toThrow(/already in progress/);
	});

	test("a terminal prior job frees the slot; the reservation is a delyva row", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		await seedJob(t, retailer._id, orderId, { status: "canceled" });

		const jobId = await t.mutation(internal.delyva.reserveBooking, {
			orderId,
			retailerId: retailer._id,
			serviceCode: "DHLEC-MY",
			serviceName: "DHL eCommerce",
			itemType: "PARCEL",
		});
		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.provider).toBe("delyva");
		expect(job?.providerOrderId).toBeUndefined(); // reservation marker
		expect(job?.costActual).toBe(0);
		expect(job?.serviceName).toBe("DHL eCommerce");
	});
});

describe("commitBooking + webhook correlation", () => {
	test("commit finalizes the reservation and the webhook context finds it by provider+id", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await t.mutation(internal.delyva.reserveBooking, {
			orderId,
			retailerId: retailer._id,
			serviceCode: "NINJA-COLD",
			serviceName: "Ninja Cold",
			itemType: "CHILLED",
		});
		await t.mutation(internal.delyva.commitBooking, {
			jobId,
			providerOrderId: "delyva-uuid-1",
			costActual: 1850,
			awb: "MY0012345678",
			statusCode: 100,
		});

		const { job, order } = await t.run(async (ctx) => ({
			job: await ctx.db.get(jobId),
			order: await ctx.db.get(orderId),
		}));
		expect(job?.providerOrderId).toBe("delyva-uuid-1");
		expect(job?.status).toBe("assigning");
		expect(job?.costActual).toBe(1850);
		expect(order?.trackingNo).toBe("MY0012345678");

		const context = await t.query(internal.delyva.getWebhookContext, {
			delyvaOrderId: "delyva-uuid-1",
		});
		expect(context?.jobId).toBe(jobId);
		expect(context?.apiSecret).toBe("dx-test-secret");
		expect(context?.customerId).toBe(128399);
	});

	test("a lalamove job with the same provider order id never matches", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		await seedJob(t, retailer._id, orderId, {
			provider: "lalamove",
			providerOrderId: "SHARED-ID",
		});
		const context = await t.query(internal.delyva.getWebhookContext, {
			delyvaOrderId: "SHARED-ID",
		});
		expect(context).toBeNull();
	});

	test("releaseReservation keeps the amber failed card, no-ops once committed", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await t.mutation(internal.delyva.reserveBooking, {
			orderId,
			retailerId: retailer._id,
			serviceCode: "DHLEC-MY",
			serviceName: "DHL eCommerce",
			itemType: "PARCEL",
		});
		await t.mutation(internal.delyva.releaseReservation, {
			jobId,
			reason: "Not enough credit",
		});
		let job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.status).toBe("canceled");
		expect(job?.failureReason).toBe("Not enough credit");

		// A committed row is immune to release (and to the expiry sweep).
		const jobId2 = await t.mutation(internal.delyva.reserveBooking, {
			orderId,
			retailerId: retailer._id,
			serviceCode: "DHLEC-MY",
			serviceName: "DHL eCommerce",
			itemType: "PARCEL",
		});
		await t.mutation(internal.delyva.commitBooking, {
			jobId: jobId2,
			providerOrderId: "delyva-uuid-2",
			costActual: 600,
		});
		await t.mutation(internal.delyva.releaseReservation, {
			jobId: jobId2,
			reason: "should not apply",
		});
		await t.mutation(internal.delyva.expireStaleReservation, { jobId: jobId2 });
		job = await t.run(async (ctx) => ctx.db.get(jobId2));
		expect(job?.status).toBe("assigning");
		expect(job?.failureReason).toBeUndefined();
	});
});

describe("getDispatchState", () => {
	test("owner sees the job view and a live/blocked reason", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		await seedJob(t, retailer._id, orderId, {
			status: "picked_up",
			awb: "MY0012345678",
		});
		const shortId = (await t.run(async (ctx) => ctx.db.get(orderId)))
			?.shortId as string;

		const asUser = t.withIdentity({ subject: USER });
		const state = await asUser.query(api.delyva.getDispatchState, { shortId });
		expect(state?.job?.status).toBe("picked_up");
		expect(state?.job?.awb).toBe("MY0012345678");
		expect(state?.job?.serviceName).toBe("Ninja Cold");
		expect(state?.bookingEnabled).toBe(true);
		expect(state?.defaultItemType).toBe("CHILLED");
		// The live job occupies the slot.
		expect(state?.blockReason).toBe("job_active");
	});

	test("empty cart weight surfaces as missing_weights for the dialog", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const shortId = (await t.run(async (ctx) => ctx.db.get(orderId)))
			?.shortId as string;
		const asUser = t.withIdentity({ subject: USER });
		const state = await asUser.query(api.delyva.getDispatchState, { shortId });
		expect(state?.computedWeightKg).toBeNull();
		expect(state?.weightIssue).toBe("missing_weights");
	});
});

describe("Singapore stores (z8r3fdbqmc)", () => {
	// SG has no Lalamove at all, so Delyva is that market's only courier
	// automation — the country gate and the address rules have to hold here,
	// not just in Malaysia.
	async function seedSgRetailer(t: ReturnType<typeof setup>) {
		const retailer = await seedRetailer(t);
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, {
				country: "SG",
				delyva: {
					enabled: true,
					apiKey: "dx-test-key",
					apiSecret: "dx-test-secret",
					apiKeyHint: "-key",
					customerId: 128399,
					defaultItemType: "PARCEL",
					pickupAddress: {
						address1: "10 Bayfront Ave",
						city: "Singapore",
						state: "Singapore",
						postcode: "018956",
					},
					connectedAt: Date.now(),
					webhooksSubscribedAt: Date.now(),
				},
			});
		});
		return retailer;
	}

	test("booking is allowed in SG — the gate is per provider, not inherited", async () => {
		const t = setup();
		const retailer = await seedSgRetailer(t);
		const asUser = t.withIdentity({ subject: USER });
		const view = await asUser.query(api.delyva.getSettings, {
			retailerId: retailer._id,
		});
		expect(view.countryAllowed).toBe(true);
		expect(view.connected).toBe(true);
	});

	test("accepts a 6-digit SG postal code", async () => {
		const t = setup();
		const retailer = await seedSgRetailer(t);
		const asUser = t.withIdentity({ subject: USER });
		await asUser.mutation(api.delyva.updateSettings, {
			retailerId: retailer._id,
			pickupAddress: {
				address1: "1 Raffles Place",
				city: "Singapore",
				state: "Singapore",
				postcode: "048616",
			},
		});
		const view = await asUser.query(api.delyva.getSettings, {
			retailerId: retailer._id,
		});
		expect(view.pickupAddress?.postcode).toBe("048616");
	});

	test("refuses a 5-digit code on an SG store — the MY rule must not leak", async () => {
		const t = setup();
		const retailer = await seedSgRetailer(t);
		const asUser = t.withIdentity({ subject: USER });
		await expect(
			asUser.mutation(api.delyva.updateSettings, {
				retailerId: retailer._id,
				pickupAddress: {
					address1: "1 Raffles Place",
					city: "Singapore",
					state: "Singapore",
					postcode: "04861",
				},
			}),
		).rejects.toThrow(/6-digit postal code/i);
	});

	test("refuses a 6-digit code on a MY store — and the reverse", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const asUser = t.withIdentity({ subject: USER });
		await expect(
			asUser.mutation(api.delyva.updateSettings, {
				retailerId: retailer._id,
				pickupAddress: {
					address1: "12 Jalan Ampang",
					city: "Kuala Lumpur",
					state: "Kuala Lumpur",
					postcode: "504501",
				},
			}),
		).rejects.toThrow(/5-digit postcode/i);
	});

	test("stamps SG on both waypoints — an MY literal would quote nothing", async () => {
		const t = setup();
		const retailer = await seedSgRetailer(t);
		const orderId = await seedOrder(t, retailer._id, {
			deliveryAddress: {
				line1: "1 Raffles Place",
				city: "Singapore",
				state: "Singapore",
				postcode: "048616",
			},
		});
		const shortId = (await t.run(async (ctx) => ctx.db.get(orderId)))
			?.shortId as string;
		const context = await t
			.withIdentity({ subject: USER })
			.query(internal.delyva.getDispatchContext, { shortId });
		expect(context.ok).toBe(true);
		if (!context.ok) return;
		expect(context.origin.country).toBe("SG");
		expect(context.destination.country).toBe("SG");
	});
});

describe("providers coexist; the order's booking slot arbitrates (Zaki, 2 Sep)", () => {
	// The revised model: a store may arm Lalamove riders AND Delyva couriers
	// and pick per order. What stays strict is the per-ORDER invariant — one
	// active job across both providers — plus the money fact that makes the
	// whole thing safe: the buyer's fee was collected at checkout, before any
	// booking existed.
	async function withLalamovePricing(
		t: ReturnType<typeof setup>,
		retailerId: Id<"retailers">,
	) {
		await t.run(async (ctx) => {
			await ctx.db.patch(retailerId, {
				deliveryConfig: { mode: "lalamove", onUnquotable: "block" },
				businessAddress: {
					label: "12 Jalan Ampang, KL",
					latitude: 3.15,
					longitude: 101.7,
				},
				deliveryBooking: {
					enabled: true,
					vehicleType: "MOTORCYCLE",
					apiKey: "pk_test_key",
					apiSecret: "sk_test_secret",
				},
			});
		});
	}

	test("Delyva stays bookable under Lalamove live-quote pricing", async () => {
		const t = setup();
		const retailer = await seedRetailer(t); // delyva enabled by the seed
		await withLalamovePricing(t, retailer._id);
		const orderId = await seedOrder(t, retailer._id);
		const shortId = (await t.run(async (ctx) => ctx.db.get(orderId)))
			?.shortId as string;
		const state = await t
			.withIdentity({ subject: USER })
			.query(api.delyva.getDispatchState, { shortId });
		expect(state?.blockReason).toBeNull();
		expect(state?.bookingEnabled).toBe(true);
	});

	test("switching pricing to lalamove no longer needs Delyva paused", async () => {
		const t = setup();
		const retailer = await seedRetailer(t); // delyva enabled
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, {
				businessAddress: {
					label: "12 Jalan Ampang, KL",
					latitude: 3.15,
					longitude: 101.7,
				},
				deliveryBooking: {
					enabled: true,
					vehicleType: "MOTORCYCLE",
					apiKey: "pk_test_key",
					apiSecret: "sk_test_secret",
				},
			});
		});
		const asUser = t.withIdentity({ subject: USER });
		await asUser.mutation(api.retailers.updateSettings, {
			deliveryConfig: { mode: "lalamove", onUnquotable: "block" },
		});
		const row = await t.run(async (ctx) => ctx.db.get(retailer._id));
		expect(row?.deliveryConfig?.mode).toBe("lalamove");
		expect(row?.delyva?.enabled).toBe(true); // untouched — never auto-paused
	});

	test("an active LALAMOVE job still blocks a Delyva booking on that order", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		await seedJob(t, retailer._id, orderId, {
			provider: "lalamove",
			providerOrderId: "LLM-77",
			status: "ongoing",
		});
		const shortId = (await t.run(async (ctx) => ctx.db.get(orderId)))
			?.shortId as string;
		const state = await t
			.withIdentity({ subject: USER })
			.query(api.delyva.getDispatchState, { shortId });
		expect(state?.blockReason).toBe("job_active");
	});
});

describe("pickup address import (profile → settings)", () => {
	// The connect action reads the seller's Delyva PROFILE address and hands
	// it to storeConnection so nobody retypes what Delyva already knows —
	// but only fill-if-unset: an address the seller saved here was possibly a
	// deliberate correction of what Delyva holds, and a reconnect must never
	// clobber it.
	const imported = {
		address1: "55 Jln Eco Majestic",
		address2: "7/1D",
		city: "Semenyih",
		state: "Selangor",
		postcode: "43500",
	};

	test("fills an empty pickup address at connect", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await t.run(async (ctx) => {
			const doc = await ctx.db.get(retailer._id);
			if (!doc?.delyva) throw new Error("seed missing delyva");
			await ctx.db.patch(retailer._id, {
				delyva: { ...doc.delyva, pickupAddress: undefined },
			});
		});
		await t.mutation(internal.delyva.storeConnection, {
			retailerId: retailer._id,
			apiKey: "enc.v1.rotated",
			apiKeyHint: "ated",
			customerId: 128399,
			importedPickupAddress: imported,
		});
		const asUser = t.withIdentity({ subject: USER });
		const view = await asUser.query(api.delyva.getSettings, {
			retailerId: retailer._id,
		});
		expect(view.pickupAddress?.address1).toBe("55 Jln Eco Majestic");
		expect(view.pickupAddress?.postcode).toBe("43500");
	});

	test("never overwrites an address the seller already saved", async () => {
		const t = setup();
		const retailer = await seedRetailer(t); // seeds 12 Jalan Ampang
		await t.mutation(internal.delyva.storeConnection, {
			retailerId: retailer._id,
			apiKey: "enc.v1.rotated",
			apiKeyHint: "ated",
			customerId: 128399,
			importedPickupAddress: imported,
		});
		const asUser = t.withIdentity({ subject: USER });
		const view = await asUser.query(api.delyva.getSettings, {
			retailerId: retailer._id,
		});
		expect(view.pickupAddress?.address1).toBe("12 Jalan Ampang");
		expect(view.pickupAddress?.postcode).toBe("50450");
	});

	test("getDispatchState renders the stored address as a one-line summary", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const shortId = (await t.run(async (ctx) => ctx.db.get(orderId)))
			?.shortId as string;
		const asUser = t.withIdentity({ subject: USER });
		const state = await asUser.query(api.delyva.getDispatchState, { shortId });
		expect(state?.pickupSummary).toBe("12 Jalan Ampang, 50450 Kuala Lumpur");
	});
});
