/// <reference types="vite/client" />
// Delyva integration (86eyjpv6z) — webhook event application (idempotency,
// out-of-order safety, order auto-transitions, AWB mirroring) + the shared
// one-active-job reservation invariant across providers. Pure client
// mechanics are covered in convex/lib/delyva.test.ts.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { COUNTRY_COURIER_BOOKING } from "./lib/courierProviders";
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

	test("a timed self-collect order never reaches dispatch (z8r3fdff97)", async () => {
		// A pickup carries a time since z8r3fdff97. It must not look bookable:
		// the method gate refuses before anything reads the moment.
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, {
			deliveryMethod: "self_collect",
			deliveryAddress: undefined,
			fulfilmentDate: Date.now() - (Date.now() % 86_400_000),
			fulfilmentTimeMinutes: 930,
		});
		const shortId = (await t.run(async (ctx) => ctx.db.get(orderId)))
			?.shortId as string;
		const asUser = t.withIdentity({ subject: USER });
		const state = await asUser.query(api.delyva.getDispatchState, { shortId });
		expect(state?.blockReason).toBe("not_delivery");
		const context = await asUser.query(internal.delyva.getDispatchContext, {
			shortId,
		});
		expect(context).toMatchObject({ ok: false, reason: "not_delivery" });
	});

	test("bookingEnabled reads false when paused, and when the connect never finished", async () => {
		// Pins the shared armed predicate (delyvaBookingArmed) the card's bit
		// now comes from — the two ways a stored key is not a working setup.
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const shortId = (await t.run(async (ctx) => ctx.db.get(orderId)))
			?.shortId as string;
		const asUser = t.withIdentity({ subject: USER });
		const patchDelyva = (patch: Partial<Doc<"retailers">["delyva"]>) =>
			t.run(async (ctx) => {
				const row = await ctx.db.get(retailer._id);
				if (!row?.delyva) throw new Error("seed missing delyva");
				await ctx.db.patch(retailer._id, { delyva: { ...row.delyva, ...patch } });
			});

		await patchDelyva({ enabled: false });
		expect(
			(await asUser.query(api.delyva.getDispatchState, { shortId }))
				?.bookingEnabled,
		).toBe(false);

		await patchDelyva({ enabled: true, customerId: undefined });
		expect(
			(await asUser.query(api.delyva.getDispatchState, { shortId }))
				?.bookingEnabled,
		).toBe(false);
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

describe("Singapore stores (z8r3fdbqmc; SG retired with EasyParcel, z8r3fdcje2)", () => {
	// Delyva SG closed in the registry when EasyParcel became the SG parcel
	// lane (the SG tenant ships an empty service catalogue). The address rules
	// and the country-stamp MECHANISM still hold — they are what a future
	// re-open relies on — so the mechanism tests below re-open the registry
	// row for their own duration and the afterEach restores the real decision.
	afterEach(() => {
		COUNTRY_COURIER_BOOKING.delyva.SG = false;
	});
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

	test("SG reads country-closed — but a connected account keeps its unwind path", async () => {
		const t = setup();
		const retailer = await seedSgRetailer(t);
		const asUser = t.withIdentity({ subject: USER });
		const view = await asUser.query(api.delyva.getSettings, {
			retailerId: retailer._id,
		});
		// The retirement (z8r3fdcje2): no NEW SG bookings through Delyva…
		expect(view.countryAllowed).toBe(false);
		// …while the connection stays visible, so a connected store can still
		// see and disconnect it (the settings card's country-blocked note).
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
		// Mechanism test: runs with the registry row re-opened (see describe).
		COUNTRY_COURIER_BOOKING.delyva.SG = true;
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

describe("overseas buyer numbers (z8r3fdh274) — the courier calls the store", () => {
	// Buyers may type a WhatsApp number from any country, but a Delyva booking
	// lives inside the store's country. A foreign buyer number hands the
	// courier the STORE's number instead, with the buyer's real one leading
	// the booking note — Lalamove's rule, applied to parcels.
	const UK_BUYER = "447700900123";
	const SELLER = "60198765432";

	/** The shared seed plus the store's own WhatsApp number (the shared seed
	 * has none); `undefined` = a store that never saved one. */
	async function seedStoreWithPhone(
		t: ReturnType<typeof setup>,
		waPhone: string | undefined,
	) {
		const retailer = await seedRetailer(t);
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, { waPhone });
		});
		return retailer;
	}

	async function contextFor(
		t: ReturnType<typeof setup>,
		retailerId: Id<"retailers">,
		overrides: Partial<Doc<"orders">>,
	) {
		const orderId = await seedOrder(t, retailerId, overrides);
		const shortId = (await t.run(async (ctx) => ctx.db.get(orderId)))
			?.shortId as string;
		const asUser = t.withIdentity({ subject: USER });
		const context = await asUser.query(internal.delyva.getDispatchContext, {
			shortId,
		});
		if (!context.ok) throw new Error(`expected ok, got ${context.reason}`);
		const state = await asUser.query(api.delyva.getDispatchState, { shortId });
		return { context, state };
	}

	test("a UK buyer: the courier gets the store's number, the buyer's leads the note", async () => {
		const t = setup();
		const retailer = await seedStoreWithPhone(t, SELLER);
		const { context, state } = await contextFor(t, retailer._id, {
			customer: { name: "Aisha", waPhone: UK_BUYER },
			customerNote: "Leave with the guard",
			deliveryAddress: {
				line1: "7 Jalan Bukit Bintang",
				city: "Kuala Lumpur",
				state: "Kuala Lumpur",
				postcode: "55100",
				notes: "Blue gate",
			},
		});
		// Bare digits — Delyva takes MSISDNs without the '+'.
		expect(context.destination.phone).toBe(SELLER);
		expect(context.origin.phone).toBe(SELLER);
		expect(context.note?.split(" · ")).toEqual([
			`Buyer WhatsApp: +${UK_BUYER}`,
			"Blue gate",
			"Leave with the guard",
		]);
		expect(context.buyerContactFallback).toBe(true);
		// …and the card hears about it before any quote.
		expect(state?.buyerContactFallback).toBe(true);
		expect(state?.country).toBe("MY");
	});

	test("the cross-border +65 buyer on a Malaysian store falls back too", async () => {
		const t = setup();
		const retailer = await seedStoreWithPhone(t, SELLER);
		const { context } = await contextFor(t, retailer._id, {
			customer: { name: "Aisha", waPhone: "6581815321" },
		});
		expect(context.destination.phone).toBe(SELLER);
		expect(context.note).toBe("Buyer WhatsApp: +6581815321");
		expect(context.buyerContactFallback).toBe(true);
	});

	test("a local buyer keeps their own number — no fallback, nothing added to the note", async () => {
		const t = setup();
		const retailer = await seedStoreWithPhone(t, SELLER);
		const { context, state } = await contextFor(t, retailer._id, {
			customer: { name: "Aisha", waPhone: "60123456789" },
		});
		expect(context.destination.phone).toBe("60123456789");
		expect(context.note).toBeUndefined();
		expect(context.buyerContactFallback).toBe(false);
		expect(state?.buyerContactFallback).toBe(false);
	});

	test("a store with no number of its own keeps the buyer's — never an empty contact", async () => {
		const t = setup();
		const retailer = await seedStoreWithPhone(t, undefined);
		const { context, state } = await contextFor(t, retailer._id, {
			customer: { name: "Aisha", waPhone: UK_BUYER },
		});
		expect(context.destination.phone).toBe(UK_BUYER);
		expect(context.note).toBeUndefined();
		expect(context.buyerContactFallback).toBe(false);
		// Nothing was swapped, so the card has nothing to warn about.
		expect(state?.buyerContactFallback).toBe(false);
	});

	test("an order with no buyer number is not an 'overseas' one — no empty 'Buyer WhatsApp: +' note", async () => {
		// The pre-existing rule for a number-less order (the courier reaches
		// the store) stands; it just isn't a fallback worth warning about.
		const t = setup();
		const retailer = await seedStoreWithPhone(t, SELLER);
		const { context, state } = await contextFor(t, retailer._id, {
			customer: { name: "Aisha" },
		});
		expect(context.destination.phone).toBe(SELLER);
		expect(context.note).toBeUndefined();
		expect(context.buyerContactFallback).toBe(false);
		expect(state?.buyerContactFallback).toBe(false);
	});

	test("a Singapore store judges by ITS country: a +60 buyer is the foreign one", async () => {
		// Mechanism test — the registry closed Delyva SG (z8r3fdcje2), so the
		// row re-opens for this test's duration and restores after.
		COUNTRY_COURIER_BOOKING.delyva.SG = true;
		try {
			const t = setup();
			const retailer = await seedStoreWithPhone(t, "6581815321");
			await t.run(async (ctx) => {
				await ctx.db.patch(retailer._id, { country: "SG" });
			});
		const { context, state } = await contextFor(t, retailer._id, {
				currency: "SGD",
				customer: { name: "Aisha", waPhone: "60123456789" },
				deliveryAddress: {
					line1: "1 Raffles Place",
					city: "Singapore",
					state: "Singapore",
					postcode: "048616",
				},
			});
			expect(context.destination.phone).toBe("6581815321");
			expect(context.note).toBe("Buyer WhatsApp: +60123456789");
			expect(state?.buyerContactFallback).toBe(true);
			expect(state?.country).toBe("SG");
		} finally {
			COUNTRY_COURIER_BOOKING.delyva.SG = false;
		}
	});
});

describe("the tracking link lands at collection, never at booking (z8r3fe0t4e)", () => {
	// J&T answered "information not found" for DapoGo's waybill for the day
	// between booking and the first scan — the number is right, the page is
	// not live yet. So the NUMBER mirrors at booking and the LINK at 500.
	const TOKEN = "trk0t4eabcdefghijklmnopqrstuvwxyz0123456789";

	test("order.created (100) puts the number on the order and holds the link; 500 lands it and ships", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, { trackingToken: TOKEN });
		const jobId = await seedJob(t, retailer._id, orderId, {
			quotationId: "JNTMY-PN-B200",
			vehicleType: "JNTMY-PN-B200",
			serviceName: "J&T Express",
			itemType: "PARCEL",
		});

		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 100,
			consignmentNo: "632195694574",
			eventAt: T1,
		});
		let order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.courierName).toBe("J&T Express");
		expect(order?.trackingNo).toBe("632195694574");
		expect(order?.carrierTrackingUrl).toBeUndefined();
		expect(order?.status).toBe("confirmed");
		// The buyer's read says so — the page words the wait instead of
		// rendering a link slot with nothing in it.
		let buyerView = await t.query(api.orders.get, { token: TOKEN });
		expect(buyerView?.courierLinkPending).toBe(true);

		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 500,
			eventAt: T2,
		});
		order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.status).toBe("shipped");
		// The registry deep link, because the service name is a known courier.
		expect(order?.carrierTrackingUrl).toBe(
			"https://www.jtexpress.my/tracking/632195694574",
		);
		buyerView = await t.query(api.orders.get, { token: TOKEN });
		expect(buyerView?.courierLinkPending).toBeUndefined();
	});

	test("a collection event that carries the AWB itself lands number and link in one go", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId);

		// No order.created ever applied — the 500 is the first event we see.
		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 500,
			consignmentNo: "MY0099",
			eventAt: T2,
		});
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.trackingNo).toBe("MY0099");
		// Ninja Cold isn't in the courier registry → Delyva's own page.
		expect(order?.carrierTrackingUrl).toBe(
			"https://my.delyva.app/customer/strack?trackingNo=MY0099",
		);
		expect(order?.status).toBe("shipped");
	});

	test("a stale order.created replayed after the 500 still lands the link — the job knows it was collected", async () => {
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
			consignmentNo: "MY0100",
			eventAt: T1, // older than the applied 500
		});
		const { order, job } = await t.run(async (ctx) => ({
			order: await ctx.db.get(orderId),
			job: await ctx.db.get(jobId),
		}));
		expect(job?.status).toBe("picked_up"); // never regressed
		expect(job?.awb).toBe("MY0100");
		expect(order?.trackingNo).toBe("MY0100");
		expect(order?.carrierTrackingUrl).toContain("MY0100");
	});

	test("a link the seller added by hand before collection is kept — the mirror only ever fills", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, {
			courierName: "Ninja Cold",
			trackingNo: "MY0012345678",
			carrierTrackingUrl: "https://seller.example/track/MY0012345678",
		});
		const jobId = await seedJob(t, retailer._id, orderId, {
			awb: "MY0012345678",
		});

		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 500,
			eventAt: T2,
		});
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.carrierTrackingUrl).toBe(
			"https://seller.example/track/MY0012345678",
		);
		expect(order?.status).toBe("shipped");
	});

	test("cancelled (900) with the number on the order never writes a link — and takes the dead number back off (z8r3fe11y8)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, {
			courierName: "Ninja Cold",
			trackingNo: "MY0012345678",
		});
		const jobId = await seedJob(t, retailer._id, orderId, {
			awb: "MY0012345678",
		});

		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 900,
			eventAt: T2,
		});
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.carrierTrackingUrl).toBeUndefined();
		// The mirror is fill-if-unset, so a dead number left on the order
		// would block the NEXT booking's AWB from ever reaching the buyer.
		expect(order?.trackingNo).toBeUndefined();
		expect(order?.courierName).toBeUndefined();
	});

	test("a seller's own manual number survives a cancelled booking (not ours to take)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, {
			courierName: "Pos Laju",
			trackingNo: "MANUAL-9",
		});
		const jobId = await seedJob(t, retailer._id, orderId, {
			awb: "MY0012345678",
		});
		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 900,
			eventAt: T2,
		});
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.trackingNo).toBe("MANUAL-9");
		expect(order?.courierName).toBe("Pos Laju");
	});

	test("commitBooking follows the same rule: a booked response mirrors the number, a collected one the link too", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId, {
			providerOrderId: undefined,
		});

		await t.mutation(internal.delyva.commitBooking, {
			jobId,
			providerOrderId: "DLV-COMMIT",
			costActual: 500,
			awb: "MY0200",
			statusCode: 100,
		});
		let order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.trackingNo).toBe("MY0200");
		expect(order?.carrierTrackingUrl).toBeUndefined();

		// A replayed confirm whose process response already says collected.
		await t.mutation(internal.delyva.commitBooking, {
			jobId,
			providerOrderId: "DLV-COMMIT",
			costActual: 500,
			awb: "MY0200",
			statusCode: 500,
		});
		order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.carrierTrackingUrl).toContain("MY0200");
	});

	test("the buyer read never promises a link for a seller's own manual entry", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, {
			trackingToken: TOKEN,
			courierName: "Ninja Cold",
			trackingNo: "MANUAL-7",
		});
		await seedJob(t, retailer._id, orderId, { awb: "MY0300" });

		const buyerView = await t.query(api.orders.get, { token: TOKEN });
		expect(buyerView?.courierLinkPending).toBeUndefined();
	});
});

describe("pickup vs drop-off, and the courier's label (z8r3fe11x3)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function mockLabelFetch(
		respond: () => Response,
	): ReturnType<typeof vi.fn> {
		const fetchMock = vi.fn(async (input: string | URL | Request) => {
			const url = String(input instanceof Request ? input.url : input);
			if (/\/order\/[^/]+\/label$/.test(url)) return respond();
			throw new Error(`unmocked fetch ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);
		return fetchMock;
	}

	async function shortIdOf(t: ReturnType<typeof setup>, orderId: Id<"orders">) {
		return (await t.run(async (ctx) => ctx.db.get(orderId)))?.shortId as string;
	}

	test("the reservation stores the picked service's class verbatim, and the card reads it", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await t.mutation(internal.delyva.reserveBooking, {
			orderId,
			retailerId: retailer._id,
			serviceCode: "JNTMY-PN-B200",
			serviceName: "J&T Express",
			serviceType: "NDD-DROP",
			itemType: "PARCEL",
		});
		await t.mutation(internal.delyva.commitBooking, {
			jobId,
			providerOrderId: "delyva-drop-1",
			costActual: 500,
			awb: "632195694574",
			statusCode: 100,
		});
		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.serviceType).toBe("NDD-DROP");

		const asUser = t.withIdentity({ subject: USER });
		const state = await asUser.query(api.delyva.getDispatchState, {
			shortId: await shortIdOf(t, orderId),
		});
		expect(state?.job?.serviceType).toBe("NDD-DROP");
	});

	test("a quote row with no class stores nothing — never a guessed pickup", async () => {
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
		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.serviceType).toBeUndefined();
	});

	test("getLabel: a PDF body comes back as bytes with a filename, fetched with the seller's key", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		await seedJob(t, retailer._id, orderId, {
			providerOrderId: "delyva-drop-1",
			serviceType: "NDD-DROP",
		});
		const fetchMock = mockLabelFetch(
			() =>
				new Response(new TextEncoder().encode("%PDF-1.4 label"), {
					status: 200,
					headers: { "content-type": "application/pdf" },
				}),
		);
		const shortId = await shortIdOf(t, orderId);
		const result = await t
			.withIdentity({ subject: USER })
			.action(api.delyva.getLabel, { shortId });
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.kind).toBe("pdf");
		expect(result.filename).toBe(`shipping-label-${shortId}.pdf`);
		if (result.kind === "pdf")
			expect(new TextDecoder().decode(result.pdf)).toContain("%PDF");
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.delyva.app/v1.0/order/delyva-drop-1/label");
		expect((init.headers as Record<string, string>)["X-Delyvax-Access-Token"]).toBe(
			"dx-test-key",
		);
	});

	test("getLabel: a JSON envelope's URL comes back to open", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		await seedJob(t, retailer._id, orderId, { providerOrderId: "delyva-1" });
		mockLabelFetch(
			() =>
				new Response(
					JSON.stringify({ data: { url: "https://cdn.delyva.app/labels/1.pdf" } }),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		);
		const result = await t
			.withIdentity({ subject: USER })
			.action(api.delyva.getLabel, { shortId: await shortIdOf(t, orderId) });
		expect(result).toMatchObject({
			ok: true,
			kind: "url",
			url: "https://cdn.delyva.app/labels/1.pdf",
		});
	});

	test("getLabel: a refusal surfaces Delyva's own message, never silence", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		await seedJob(t, retailer._id, orderId, { providerOrderId: "delyva-1" });
		mockLabelFetch(
			() =>
				new Response(
					JSON.stringify({ error: { message: "Label not generated yet" } }),
					{ status: 422, headers: { "content-type": "application/json" } },
				),
		);
		const result = await t
			.withIdentity({ subject: USER })
			.action(api.delyva.getLabel, { shortId: await shortIdOf(t, orderId) });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected failure");
		expect(result.message).toContain("Label not generated yet");
	});

	test("getLabel: a body that is neither PDF nor a URL is a failure, not an empty tab", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		await seedJob(t, retailer._id, orderId, { providerOrderId: "delyva-1" });
		mockLabelFetch(
			() =>
				new Response("<html>sign in</html>", {
					status: 200,
					headers: { "content-type": "text/html" },
				}),
		);
		const result = await t
			.withIdentity({ subject: USER })
			.action(api.delyva.getLabel, { shortId: await shortIdOf(t, orderId) });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected failure");
		expect(result.message).toMatch(/couldn't be read/);
	});

	test("getLabel: before Delyva confirms, and after the first scan, it refuses with the reason and never calls out", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const asUser = t.withIdentity({ subject: USER });
		const fetchMock = mockLabelFetch(() => new Response("", { status: 200 }));

		const reservedOrder = await seedOrder(t, retailer._id);
		await seedJob(t, retailer._id, reservedOrder, { providerOrderId: undefined });
		const reserved = await asUser.action(api.delyva.getLabel, {
			shortId: await shortIdOf(t, reservedOrder),
		});
		expect(reserved).toMatchObject({ ok: false });
		if (!reserved.ok) expect(reserved.message).toMatch(/hasn't confirmed/);

		const collectedOrder = await seedOrder(t, retailer._id);
		await seedJob(t, retailer._id, collectedOrder, {
			providerOrderId: "delyva-2",
			status: "picked_up",
		});
		const collected = await asUser.action(api.delyva.getLabel, {
			shortId: await shortIdOf(t, collectedOrder),
		});
		expect(collected).toMatchObject({ ok: false });
		if (!collected.ok) expect(collected.message).toMatch(/already has this parcel/);

		const bareOrder = await seedOrder(t, retailer._id);
		const bare = await asUser.action(api.delyva.getLabel, {
			shortId: await shortIdOf(t, bareOrder),
		});
		expect(bare).toMatchObject({ ok: false });
		if (!bare.ok) expect(bare.message).toMatch(/No Delyva booking/);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("the checkout quote carries the cheapest service's class onto the deliveryQuotes row", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const quoteId = await t.mutation(internal.lalamove.saveCheckoutQuote, {
			retailerId: retailer._id,
			provider: "delyva",
			fee: 500,
			currency: "MYR",
			serviceCode: "JNTMY-PN-B200",
			serviceName: "J&T Express",
			serviceType: "NDD-DROP",
			postcode: "55100",
		});
		const row = await t.run(async (ctx) => ctx.db.get(quoteId));
		expect(row?.serviceType).toBe("NDD-DROP");
	});
});

describe("failure codes, the refresh pull and the stale sweep (z8r3fe11y8)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const HOUR = 60 * 60 * 1000;

	async function scheduledNames(t: ReturnType<typeof setup>) {
		return t.run(async (ctx) =>
			(await ctx.db.system.query("_scheduled_functions").collect()).map(
				(j) => j.name,
			),
		);
	}

	function mockOrderPull(respond: (url: string) => Response) {
		const fetchMock = vi.fn(async (input: string | URL | Request) => {
			const url = String(input instanceof Request ? input.url : input);
			if (/\/order\/[^/]+$/.test(url)) return respond(url);
			throw new Error(`unmocked fetch ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);
		return fetchMock;
	}

	function fullOrder(over: Record<string, unknown>) {
		return {
			data: {
				id: "DLV-1",
				consignmentNo: "MY0012345678",
				statusCode: 100,
				status: "created",
				customerId: 128399,
				failedReason: null,
				cancelledReason: null,
				updatedAt: "2026-11-05T01:00:00.000Z",
				waypoint: [],
				...over,
			},
		};
	}

	test("99 (create failed) rejects the job with the one sentence, emails the seller, and takes the dead number off the order", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId);
		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 100,
			consignmentNo: "MY0099",
			eventAt: T1,
		});
		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 99,
			eventAt: T2,
		});
		const { job, order } = await t.run(async (ctx) => ({
			job: await ctx.db.get(jobId),
			order: await ctx.db.get(orderId),
		}));
		expect(job?.status).toBe("rejected");
		expect(job?.failureReason).toBe("Delyva could not create the order");
		expect(order?.status).toBe("confirmed");
		expect(order?.trackingNo).toBeUndefined();
		expect(order?.courierName).toBeUndefined();
		expect(
			(await scheduledNames(t)).filter((n) => n.includes("notifyDeliveryJobFailed")),
		).toHaveLength(1);
	});

	test("654 / 655 reject with Delyva's words, or ours when they send none", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		for (const [code, text, expected] of [
			[654, "Failed - Driver cancel", "Failed - Driver cancel"],
			[654, undefined, "Courier cancelled the pickup"],
			[655, undefined, "The courier reported the booking as failed"],
		] as const) {
			const orderId = await seedOrder(t, retailer._id);
			const jobId = await seedJob(t, retailer._id, orderId, {
				status: "ongoing",
				lastEventAt: T1,
			});
			await t.mutation(internal.delyva.applyWebhookEvent, {
				jobId,
				statusCode: code,
				statusText: text,
				eventAt: T2,
			});
			const job = await t.run(async (ctx) => ctx.db.get(jobId));
			expect(job?.status).toBe("rejected");
			expect(job?.failureReason).toBe(expected);
		}
	});

	test("651 (lost / damaged) keeps the job live with the claim line, and the order shipped", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, { status: "shipped" });
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "picked_up",
			lastEventAt: T1,
		});
		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 651,
			statusText: "Failed delivery - Lost/Damage",
			eventAt: T2,
		});
		const { job, order } = await t.run(async (ctx) => ({
			job: await ctx.db.get(jobId),
			order: await ctx.db.get(orderId),
		}));
		expect(job?.status).toBe("picked_up");
		expect(job?.failureReason).toBe("Lost or damaged, claim with Delyva");
		expect(order?.status).toBe("shipped");
		expect(
			(await scheduledNames(t)).filter((n) => n.includes("notifyDeliveryJobFailed")),
		).toHaveLength(1);
	});

	test("661 then 701: returning keeps picked_up, returned completes the job as RETURNED and leaves the order shipped", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, { status: "shipped" });
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "picked_up",
			awb: "MY0012345678",
			lastEventAt: T1,
		});
		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 661,
			eventAt: T2,
		});
		let job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.status).toBe("picked_up");
		expect(job?.failureReason).toBe("Returning to sender");
		expect(job?.returned).toBeUndefined();

		const T3 = T2 + HOUR;
		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 701,
			statusText: "Item Returned",
			eventAt: T3,
		});
		// A replay changes nothing and emails nobody twice.
		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 701,
			statusText: "Item Returned",
			eventAt: T3,
		});
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.status).toBe("completed");
		expect(job?.returned).toBe(true);
		expect(job?.failureReason).toBe("Returned to you");
		expect(order?.status).toBe("shipped");
		const names = await scheduledNames(t);
		expect(names.filter((n) => n.includes("notifyDeliveryJobReturned"))).toHaveLength(1);
		expect(names.filter((n) => n.includes("notifyDeliveryJobFailed"))).toHaveLength(1); // the 661 notice
		// The slot is free: a rebook reserves.
		await expect(
			t.mutation(internal.delyva.reserveBooking, {
				orderId,
				retailerId: retailer._id,
				serviceCode: "JNTMY-PN-B200",
				serviceName: "J&T Express",
				itemType: "PARCEL",
			}),
		).resolves.toBeTruthy();
	});

	test("663 (failed to return) is returned too, with its own line", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, { status: "shipped" });
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "picked_up",
			lastEventAt: T1,
		});
		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 663,
			eventAt: T2,
		});
		const { job, order } = await t.run(async (ctx) => ({
			job: await ctx.db.get(jobId),
			order: await ctx.db.get(orderId),
		}));
		expect(job?.status).toBe("completed");
		expect(job?.returned).toBe(true);
		expect(job?.failureReason).toMatch(/Failed to return/);
		expect(order?.status).toBe("shipped");
	});

	test("the out-of-order guard still holds the reverse: a 661 after a 701 is ignored", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, { status: "shipped" });
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "completed",
			returned: true,
			failureReason: "Returned to you",
			lastEventAt: T2,
		});
		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 661,
			eventAt: T1,
		});
		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.status).toBe("completed");
		expect(job?.failureReason).toBe("Returned to you");
	});

	test("a pull that finds the same state is a check, not an event: lastPulledAt moves, lastEventAt doesn't", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "ongoing",
			lastEventAt: T1,
		});
		const now = T2 + HOUR;
		const applied = await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 200,
			eventAt: now,
			pulledAt: now,
		});
		expect(applied?.changed).toBe(false);
		let job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.lastEventAt).toBe(T1);
		expect(job?.lastPulledAt).toBe(now);

		// A pull that finds something new is the freshest truth and wins.
		const later = now + HOUR;
		const moved = await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 500,
			eventAt: later,
			pulledAt: later,
		});
		expect(moved?.changed).toBe(true);
		job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.status).toBe("picked_up");
		expect(job?.lastEventAt).toBe(later);
	});

	test("the sweep's pull flags a booking still unchanged after it — once — and the next real event clears it", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const now = Date.now();
		const jobId = await seedJob(t, retailer._id, orderId, {
			createdAt: now - 25 * HOUR,
			awb: "632195694574",
		});
		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 100,
			eventAt: now,
			pulledAt: now,
			markStale: true,
		});
		let job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.staleSince).toBeTypeOf("number");
		expect(job?.lastEventAt).toBeUndefined();
		const first = job?.staleSince;

		// The next sweep an hour later: still stale, still ONE email.
		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 100,
			eventAt: now + HOUR,
			pulledAt: now + HOUR,
			markStale: true,
		});
		job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.staleSince).toBe(first);
		expect(
			(await scheduledNames(t)).filter((n) => n.includes("notifyDeliveryJobStale")),
		).toHaveLength(1);

		// The parcel is finally scanned: amber ends.
		await t.mutation(internal.delyva.applyWebhookEvent, {
			jobId,
			statusCode: 500,
			eventAt: now + 2 * HOUR,
		});
		job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.staleSince).toBeUndefined();
		expect(job?.status).toBe("picked_up");
	});

	test("the card's Refresh is not the sweep: it never flags, it only applies what Delyva says", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId, {
			createdAt: Date.now() - 25 * HOUR,
		});
		mockOrderPull(() => Response.json(fullOrder({ statusCode: 100 })));
		const asUser = t.withIdentity({ subject: USER });
		const shortId = (await t.run(async (ctx) => ctx.db.get(orderId)))?.shortId as string;
		const result = await asUser.action(api.delyva.refreshJob, { shortId });
		expect(result).toEqual({ ok: true, changed: false });
		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.staleSince).toBeUndefined();
		expect(job?.lastPulledAt).toBeTypeOf("number");
	});

	test("Refresh heals a missed webhook: the pulled 500 ships the order and lands the link, with the seller's key on the wire", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId);
		const fetchMock = mockOrderPull(() =>
			Response.json(fullOrder({ statusCode: 500, status: "collected" })),
		);
		const asUser = t.withIdentity({ subject: USER });
		const shortId = (await t.run(async (ctx) => ctx.db.get(orderId)))?.shortId as string;
		const result = await asUser.action(api.delyva.refreshJob, { shortId });
		expect(result).toEqual({ ok: true, changed: true });
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("https://api.delyva.app/v1.0/order/DLV-1");
		expect((init.headers as Record<string, string>)["X-Delyvax-Access-Token"]).toBe("dx-test-key");
		const { job, order } = await t.run(async (ctx) => ({
			job: await ctx.db.get(jobId),
			order: await ctx.db.get(orderId),
		}));
		expect(job?.status).toBe("picked_up");
		expect(job?.awb).toBe("MY0012345678");
		expect(order?.status).toBe("shipped");
		expect(order?.carrierTrackingUrl).toContain("MY0012345678");
	});

	test("Refresh is one call per job per minute, and says so", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		await seedJob(t, retailer._id, orderId);
		const fetchMock = mockOrderPull(() => Response.json(fullOrder({})));
		const asUser = t.withIdentity({ subject: USER });
		const shortId = (await t.run(async (ctx) => ctx.db.get(orderId)))?.shortId as string;
		await asUser.action(api.delyva.refreshJob, { shortId });
		const second = await asUser.action(api.delyva.refreshJob, { shortId });
		expect(second.ok).toBe(false);
		if (!second.ok) expect(second.message).toMatch(/less than a minute ago/);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test("Refresh on a booking Delyva no longer knows (404) rejects it with the honest reason and frees the slot", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId, {
			awb: "MY0012345678",
			staleSince: Date.now() - HOUR,
		});
		await t.run(async (ctx) =>
			ctx.db.patch(orderId, { courierName: "Ninja Cold", trackingNo: "MY0012345678" }),
		);
		mockOrderPull(
			() => new Response(JSON.stringify({ error: { message: "Not found" } }), { status: 404 }),
		);
		const asUser = t.withIdentity({ subject: USER });
		const shortId = (await t.run(async (ctx) => ctx.db.get(orderId)))?.shortId as string;
		const result = await asUser.action(api.delyva.refreshJob, { shortId });
		expect(result).toEqual({ ok: true, changed: true });
		const { job, order } = await t.run(async (ctx) => ({
			job: await ctx.db.get(jobId),
			order: await ctx.db.get(orderId),
		}));
		expect(job?.status).toBe("rejected");
		expect(job?.failureReason).toBe("Delyva has no record of this booking");
		expect(job?.staleSince).toBeUndefined();
		expect(order?.trackingNo).toBeUndefined();
		await expect(
			t.mutation(internal.delyva.reserveBooking, {
				orderId,
				retailerId: retailer._id,
				serviceCode: "NINJA-COLD",
				serviceName: "Ninja Cold",
				itemType: "CHILLED",
			}),
		).resolves.toBeTruthy();
		// Nothing to refresh any more.
		expect(await asUser.action(api.delyva.refreshJob, { shortId })).toEqual({
			ok: false,
			message: "No live Delyva booking to refresh.",
		});
	});

	test("a Delyva outage is a sentence, not a stuck card", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId);
		mockOrderPull(() => new Response("gateway timeout", { status: 502 }));
		const asUser = t.withIdentity({ subject: USER });
		const shortId = (await t.run(async (ctx) => ctx.db.get(orderId)))?.shortId as string;
		const result = await asUser.action(api.delyva.refreshJob, { shortId });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toMatch(/HTTP 502/);
		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.status).toBe("assigning");
		expect(job?.lastPulledAt).toBeUndefined();
	});

	test("the hourly sweep selects only stale bookings: a day old, no event in a day, confirmed by Delyva, not a demo account", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const now = Date.now();
		const stale = await seedJob(t, retailer._id, await seedOrder(t, retailer._id), {
			createdAt: now - 25 * HOUR,
		});
		const staleOngoing = await seedJob(t, retailer._id, await seedOrder(t, retailer._id), {
			status: "ongoing",
			createdAt: now - 30 * HOUR,
			lastEventAt: now - 26 * HOUR,
		});
		await seedJob(t, retailer._id, await seedOrder(t, retailer._id), {
			createdAt: now - HOUR, // fresh booking
		});
		await seedJob(t, retailer._id, await seedOrder(t, retailer._id), {
			createdAt: now - 30 * HOUR,
			lastEventAt: now - HOUR, // moving
		});
		await seedJob(t, retailer._id, await seedOrder(t, retailer._id), {
			createdAt: now - 30 * HOUR,
			providerOrderId: undefined, // never confirmed — expires on its own
		});
		await seedJob(t, retailer._id, await seedOrder(t, retailer._id), {
			status: "picked_up",
			createdAt: now - 30 * HOUR, // past its first scan
		});
		const result = await t.mutation(internal.delyva.sweepStaleJobs, {});
		expect(result.scheduled).toBe(2);
		const scheduled = await t.run(async (ctx) =>
			(await ctx.db.system.query("_scheduled_functions").collect()).filter((j) =>
				j.name.includes("delyva:syncJob"),
			),
		);
		expect(scheduled.map((j) => (j.args[0] as { jobId: string }).jobId).sort()).toEqual(
			[stale, staleOngoing].sort(),
		);
	});

	test("the sweep skips demo accounts — no courier ever comes there", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await t.run(async (ctx) => {
			const r = await ctx.db.get(retailer._id);
			await ctx.db.patch(retailer._id, { delyva: { ...r?.delyva, isDemo: true } as never });
		});
		await seedJob(t, retailer._id, await seedOrder(t, retailer._id), {
			createdAt: Date.now() - 25 * HOUR,
		});
		expect(await t.mutation(internal.delyva.sweepStaleJobs, {})).toEqual({ scheduled: 0 });
	});

	test("the sweep caps at 200 pulls per run", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const now = Date.now();
		await t.run(async (ctx) => {
			for (let i = 0; i < 203; i++) {
				const orderId = await ctx.db.insert("orders", {
					retailerId: retailer._id,
					shortId: `ORD-C${String(i).padStart(3, "0")}`,
					items: [],
					subtotal: 1000,
					total: 1000,
					currency: "MYR",
					status: "confirmed",
					channel: "whatsapp",
					customer: { name: "A", waPhone: "60123456789" },
					deliveryMethod: "delivery",
					createdAt: now,
					updatedAt: now,
				});
				await ctx.db.insert("deliveryJobs", {
					orderId,
					retailerId: retailer._id,
					provider: "delyva",
					providerOrderId: `DLV-C${i}`,
					status: "assigning",
					costActual: 500,
					quotationId: "X",
					vehicleType: "X",
					createdAt: now - 25 * HOUR,
					updatedAt: now,
				});
			}
		});
		expect(await t.mutation(internal.delyva.sweepStaleJobs, {})).toEqual({ scheduled: 200 });
	});

	test("Mark order as returned: the order goes back to Packed with a note, the dead number comes off, and the card can book again", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, {
			status: "shipped",
			courierName: "J&T Express",
			trackingNo: "632195694574",
			carrierTrackingUrl: "https://jtexpress.my/track/632195694574",
		});
		await seedJob(t, retailer._id, orderId, {
			status: "completed",
			returned: true,
			failureReason: "Returned to you",
			serviceName: "J&T Express",
			awb: "632195694574",
		});
		const asUser = t.withIdentity({ subject: USER });
		const shortId = (await t.run(async (ctx) => ctx.db.get(orderId)))?.shortId as string;
		await asUser.mutation(api.delyva.markOrderReturned, { shortId });
		const { order, events, state } = await t.run(async (ctx) => ({
			order: await ctx.db.get(orderId),
			events: await ctx.db
				.query("orderEvents")
				.withIndex("by_order", (q) => q.eq("orderId", orderId))
				.collect(),
			state: null,
		}));
		expect(order?.status).toBe("packed");
		expect(order?.trackingNo).toBeUndefined();
		expect(order?.courierName).toBeUndefined();
		expect(order?.carrierTrackingUrl).toBeUndefined();
		expect(events.at(-1)?.note).toContain("632195694574");
		expect(events.at(-1)?.note).toMatch(/returned by J&T Express/);
		void state;
		// Book again is open: the dispatch state no longer blocks on status.
		const dispatch = await asUser.query(api.delyva.getDispatchState, { shortId });
		expect(dispatch?.blockReason).toBeNull();
		expect(dispatch?.job?.returned).toBe(true);
	});

	test("Mark order as returned refuses when Delyva hasn't reported a return", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, { status: "shipped" });
		await seedJob(t, retailer._id, orderId, { status: "picked_up" });
		const asUser = t.withIdentity({ subject: USER });
		const shortId = (await t.run(async (ctx) => ctx.db.get(orderId)))?.shortId as string;
		await expect(
			asUser.mutation(api.delyva.markOrderReturned, { shortId }),
		).rejects.toThrow(/hasn't reported this parcel as returned/);
	});

	test("getDispatchState carries the three new fields, and orders.get tells both doors about a return", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, {
			status: "shipped",
			courierName: "J&T Express",
			trackingNo: "632195694574",
			carrierTrackingUrl: "https://jtexpress.my/track/632195694574",
		});
		const now = Date.now();
		await seedJob(t, retailer._id, orderId, {
			status: "completed",
			returned: true,
			awb: "632195694574",
			staleSince: now - HOUR,
			lastPulledAt: now,
		});
		const asUser = t.withIdentity({ subject: USER });
		const shortId = (await t.run(async (ctx) => ctx.db.get(orderId)))?.shortId as string;
		const state = await asUser.query(api.delyva.getDispatchState, { shortId });
		expect(state?.job?.returned).toBe(true);
		expect(state?.job?.staleSince).toBe(now - HOUR);
		expect(state?.job?.lastPulledAt).toBe(now);
		const order = await asUser.query(api.orders.get, { shortId });
		expect(order?.courierReturned).toBe(true);
	});

	test("orders.get keeps telling the buyer about the return after the seller marked it (Packed, number gone) — until something newer carries the parcel", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const asUser = t.withIdentity({ subject: USER });
		const read = async (orderId: Id<"orders">) => {
			const shortId = (await t.run(async (ctx) => ctx.db.get(orderId)))
				?.shortId as string;
			return (await asUser.query(api.orders.get, { shortId }))?.courierReturned;
		};
		// Marked returned: the buyer saw "On the Way" become "Packed" and is
		// owed the reason.
		const marked = await seedOrder(t, retailer._id, { status: "packed" });
		await seedJob(t, retailer._id, marked, {
			status: "completed",
			returned: true,
			awb: "632195694574",
		});
		expect(await read(marked)).toBe(true);
		// Booked again: a live job is carrying it now.
		const rebooked = await seedOrder(t, retailer._id, { status: "packed" });
		await seedJob(t, retailer._id, rebooked, {
			status: "completed",
			returned: true,
			awb: "632195694574",
			createdAt: Date.now() - 60_000,
		});
		await seedJob(t, retailer._id, rebooked, { status: "assigning" });
		expect(await read(rebooked)).toBeUndefined();
		// The seller sent it another way: their own number on the order.
		const manual = await seedOrder(t, retailer._id, {
			status: "packed",
			trackingNo: "MY-OWN-123",
		});
		await seedJob(t, retailer._id, manual, {
			status: "completed",
			returned: true,
			awb: "632195694574",
		});
		expect(await read(manual)).toBeUndefined();
		// A packed delivery order with no booking history pays the read and
		// says nothing — the ordinary case.
		const plain = await seedOrder(t, retailer._id, { status: "packed" });
		expect(await read(plain)).toBeUndefined();
	});
});
