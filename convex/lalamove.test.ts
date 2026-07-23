/// <reference types="vite/client" />
// Lalamove integration — webhook event application (idempotency, out-of-order
// safety, order auto-transitions) + checkout quote consumption at
// orders.create. The pure client mechanics are covered in
// convex/lib/lalamove.test.ts; signature auth in lalamoveSignature.test.ts.
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

const USER = "user_lalamove_tests";

async function seedRetailer(t: ReturnType<typeof setup>) {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Fruit Hut",
		slug: "fruit-hut-lalamove",
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
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
			subtotal: 5000,
			total: 5000,
			currency: "MYR",
			status: "confirmed",
			channel: "whatsapp",
			customer: { name: "Aisha", waPhone: "60123456789" },
			deliveryMethod: "delivery",
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
			provider: "lalamove",
			providerOrderId: "LLM-1",
			status: "assigning",
			costActual: 1350,
			quotationId: "quot-1",
			vehicleType: "MOTORCYCLE",
			createdAt: now,
			updatedAt: now,
			...overrides,
		});
	});
}

const SHARE = "https://share.lalamove.com/?MY123";

function statusEvent(status: string, updatedAt: string, extra: Record<string, unknown> = {}) {
	return {
		order: { orderId: "LLM-1", status, shareLink: SHARE, ...extra },
		updatedAt,
	};
}

describe("applyWebhookEvent — ORDER_STATUS_CHANGED", () => {
	test("PICKED_UP auto-ships a confirmed order with the tracking link", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId);

		await t.mutation(internal.lalamove.applyWebhookEvent, {
			jobId,
			eventType: "ORDER_STATUS_CHANGED",
			data: statusEvent("PICKED_UP", "2026-07-21T04:00:00.000Z"),
			eventTimestamp: Date.parse("2026-07-21T04:00:00.000Z"),
		});

		const { order, job } = await t.run(async (ctx) => ({
			order: await ctx.db.get(orderId),
			job: await ctx.db.get(jobId),
		}));
		expect(job?.status).toBe("picked_up");
		expect(job?.shareLink).toBe(SHARE);
		expect(order?.status).toBe("shipped");
		expect(order?.carrierTrackingUrl).toBe(SHARE);
	});

	test("COMPLETED auto-delivers; repeat delivery of the same event is a no-op", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, { status: "shipped" });
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "picked_up",
		});

		const event = {
			jobId,
			eventType: "ORDER_STATUS_CHANGED",
			data: statusEvent("COMPLETED", "2026-07-21T05:00:00.000Z"),
			eventTimestamp: Date.parse("2026-07-21T05:00:00.000Z"),
		};
		await t.mutation(internal.lalamove.applyWebhookEvent, event);
		await t.mutation(internal.lalamove.applyWebhookEvent, event); // retry

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
		// One delivered event, not two — the second webhook found the order
		// already delivered and did nothing.
		expect(events.filter((e) => e.status === "delivered")).toHaveLength(1);
	});

	test("out-of-order: an older event never regresses the job", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "picked_up",
			lastEventAt: Date.parse("2026-07-21T04:00:00.000Z"),
		});

		await t.mutation(internal.lalamove.applyWebhookEvent, {
			jobId,
			eventType: "ORDER_STATUS_CHANGED",
			data: statusEvent("ON_GOING", "2026-07-21T03:00:00.000Z"),
			eventTimestamp: Date.parse("2026-07-21T03:00:00.000Z"),
		});
		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.status).toBe("picked_up");
	});

	test("driver bail: a NEWER regression moves the job back, order stays shipped", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, {
			status: "shipped",
			carrierTrackingUrl: SHARE,
		});
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "picked_up",
			lastEventAt: Date.parse("2026-07-21T04:00:00.000Z"),
			shareLink: SHARE,
		});

		await t.mutation(internal.lalamove.applyWebhookEvent, {
			jobId,
			eventType: "ORDER_STATUS_CHANGED",
			data: statusEvent("ASSIGNING_DRIVER", "2026-07-21T04:30:00.000Z"),
			eventTimestamp: Date.parse("2026-07-21T04:30:00.000Z"),
		});
		const { order, job } = await t.run(async (ctx) => ({
			order: await ctx.db.get(orderId),
			job: await ctx.db.get(jobId),
		}));
		expect(job?.status).toBe("assigning"); // job follows provider truth
		expect(order?.status).toBe("shipped"); // order never regresses
	});

	test("EXPIRED marks the job failed with a reason; order untouched", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId);

		await t.mutation(internal.lalamove.applyWebhookEvent, {
			jobId,
			eventType: "ORDER_STATUS_CHANGED",
			data: statusEvent("EXPIRED", "2026-07-21T04:10:00.000Z"),
			eventTimestamp: Date.parse("2026-07-21T04:10:00.000Z"),
		});
		const { order, job } = await t.run(async (ctx) => ({
			order: await ctx.db.get(orderId),
			job: await ctx.db.get(jobId),
		}));
		expect(job?.status).toBe("expired");
		expect(job?.failureReason).toMatch(/No driver/);
		expect(order?.status).toBe("confirmed");
	});

	test("ORDER_REPLACED revives a clone-cancelled job under the new provider id", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "canceled",
			failureReason: "Cancelled by Lalamove",
			lastEventAt: Date.parse("2026-07-21T04:00:00.000Z"),
		});

		await t.mutation(internal.lalamove.applyWebhookEvent, {
			jobId,
			eventType: "ORDER_REPLACED",
			data: {
				order: { orderId: "LLM-CLONE-2" },
				updatedAt: "2026-07-21T04:01:00.000Z",
			},
			eventTimestamp: Date.parse("2026-07-21T04:01:00.000Z"),
		});

		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.providerOrderId).toBe("LLM-CLONE-2");
		expect(job?.status).toBe("assigning");
		expect(job?.failureReason).toBeUndefined();
	});

	test("a cancelled order is never touched by rider events", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, { status: "cancelled" });
		const jobId = await seedJob(t, retailer._id, orderId);

		await t.mutation(internal.lalamove.applyWebhookEvent, {
			jobId,
			eventType: "ORDER_STATUS_CHANGED",
			data: statusEvent("PICKED_UP", "2026-07-21T04:00:00.000Z"),
			eventTimestamp: Date.parse("2026-07-21T04:00:00.000Z"),
		});
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.status).toBe("cancelled");
	});

	test("a pending (unconfirmed) order never auto-ships", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, { status: "pending" });
		const jobId = await seedJob(t, retailer._id, orderId);

		await t.mutation(internal.lalamove.applyWebhookEvent, {
			jobId,
			eventType: "ORDER_STATUS_CHANGED",
			data: statusEvent("PICKED_UP", "2026-07-21T04:00:00.000Z"),
			eventTimestamp: Date.parse("2026-07-21T04:00:00.000Z"),
		});
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.status).toBe("pending");
	});
});

describe("applyWebhookEvent — other event types", () => {
	test("DRIVER_ASSIGNED stores driver + mirrors shareLink onto the order", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId);

		await t.mutation(internal.lalamove.applyWebhookEvent, {
			jobId,
			eventType: "DRIVER_ASSIGNED",
			data: {
				order: { orderId: "LLM-1", shareLink: SHARE },
				driver: {
					name: "Rahim",
					phone: "+60111111111",
					plateNumber: "WXY 1234",
				},
				updatedAt: "2026-07-21T03:59:00.000Z",
			},
			eventTimestamp: Date.parse("2026-07-21T03:59:00.000Z"),
		});
		const { order, job } = await t.run(async (ctx) => ({
			order: await ctx.db.get(orderId),
			job: await ctx.db.get(jobId),
		}));
		expect(job?.driver).toEqual({
			name: "Rahim",
			phone: "+60111111111",
			plateNumber: "WXY 1234",
		});
		expect(job?.shareLink).toBe(SHARE);
		expect(order?.carrierTrackingUrl).toBe(SHARE);
	});

	test("ORDER_AMOUNT_CHANGED updates the ledger's actual cost", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId);

		await t.mutation(internal.lalamove.applyWebhookEvent, {
			jobId,
			eventType: "ORDER_AMOUNT_CHANGED",
			data: {
				order: { orderId: "LLM-1", priceBreakdown: { total: "18.5" } },
				updatedAt: "2026-07-21T04:20:00.000Z",
			},
			eventTimestamp: Date.parse("2026-07-21T04:20:00.000Z"),
		});
		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.costActual).toBe(1850);
	});

	test("ORDER_REPLACED follows the clone's new provider order id", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId);

		await t.mutation(internal.lalamove.applyWebhookEvent, {
			jobId,
			eventType: "ORDER_REPLACED",
			data: {
				order: { orderId: "LLM-2" },
				updatedAt: "2026-07-21T04:25:00.000Z",
			},
			eventTimestamp: Date.parse("2026-07-21T04:25:00.000Z"),
		});
		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.providerOrderId).toBe("LLM-2");
	});
});

describe("getWebhookContext (secret resolution)", () => {
	test("job → the retailer's own secret is the only candidate", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, {
				deliveryBooking: {
					enabled: true,
					vehicleType: "MOTORCYCLE" as const,
					apiKey: "pk_byo",
					apiSecret: "sk_byo",
				},
			});
		});
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId);

		const context = await t.query(internal.lalamove.getWebhookContext, {
			providerOrderId: "LLM-1",
			apiKey: "pk_byo",
		});
		expect(context.jobId).toBe(jobId);
		expect(context.secrets).toEqual(["sk_byo"]);
	});

	test("no job: no secrets — unmatched traffic is unverifiable by design", async () => {
		const t = setup();
		await seedRetailer(t);
		const foreign = await t.query(internal.lalamove.getWebhookContext, {
			providerOrderId: "UNKNOWN",
			apiKey: "pk_somebody_else",
		});
		expect(foreign.jobId).toBeNull();
		expect(foreign.secrets).toEqual([]);
	});
});

describe("orders.create — live quote consumption", () => {
	const address = {
		line1: "12 Jln Mawar 3",
		city: "Petaling Jaya",
		state: "Selangor",
		postcode: "47301",
		latitude: 3.1073,
		longitude: 101.6067,
	};

	async function seedLalamoveStore(t: ReturnType<typeof setup>) {
		const retailer = await seedRetailer(t);
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, {
				businessAddress: {
					label: "Fruit Hut HQ",
					latitude: 3.139,
					longitude: 101.6869,
				},
				deliveryBooking: { enabled: true, vehicleType: "MOTORCYCLE" as const },
				deliveryConfig: {
					mode: "lalamove" as const,
					onUnquotable: "arrange" as const,
				},
			});
		});
		const asUser = t.withIdentity({ subject: USER });
		const productId = await asUser.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Fruit Box",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			blockWhenOutOfStock: false,
			requiresProof: false,
			variants: [{ optionValues: [], price: 2500, onHand: 100 }],
		});
		return { retailer, productId };
	}

	test("a fresh matching quote freezes the fee + audit snapshot and is consumed", async () => {
		const t = setup();
		const { retailer, productId } = await seedLalamoveStore(t);
		const quoteId = await t.mutation(internal.lalamove.saveCheckoutQuote, {
			retailerId: retailer._id,
			quotationId: "quot-99",
			fee: 1350,
			vehicleType: "MOTORCYCLE",
			latitude: address.latitude,
			longitude: address.longitude,
		});

		const result = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Aisha", waPhone: "60123456789" },
			deliveryMethod: "delivery",
			deliveryAddress: address,
			deliveryQuoteId: quoteId,
		});
		expect(result.deliveryFee).toBe(1350);
		expect(result.deliveryFeePending).toBeFalsy();

		const { order, quoteRow } = await t.run(async (ctx) => {
			const orders = await ctx.db.query("orders").collect();
			return {
				order: orders.find((o) => o.shortId === result.shortId),
				quoteRow: await ctx.db.get(quoteId),
			};
		});
		expect(order?.deliverySnapshot).toMatchObject({
			fee: 1350,
			mode: "lalamove",
			quotationId: "quot-99",
			vehicleType: "MOTORCYCLE",
		});
		expect(order?.total).toBe(2500 + 1350);
		expect(quoteRow).toBeNull(); // consumed — one quote, one order
	});

	test("stale/mismatched/missing quote falls back to fee-pending (arrange)", async () => {
		const t = setup();
		const { retailer, productId } = await seedLalamoveStore(t);

		// Stale row (bypass saveCheckoutQuote to control quotedAt).
		const staleId = await t.run(async (ctx) =>
			ctx.db.insert("deliveryQuotes", {
				retailerId: retailer._id,
				quotationId: "quot-old",
				fee: 900,
				vehicleType: "MOTORCYCLE",
				latitude: address.latitude,
				longitude: address.longitude,
				quotedAt: Date.now() - 31 * 60 * 1000,
			}),
		);
		const stale = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Ana", waPhone: "60123456789" },
			deliveryMethod: "delivery",
			deliveryAddress: address,
			deliveryQuoteId: staleId,
		});
		expect(stale.deliveryFee).toBeUndefined();
		expect(stale.deliveryFeePending).toBe(true);

		// Coordinate mismatch — a quote priced for a different pin is refused.
		const farId = await t.mutation(internal.lalamove.saveCheckoutQuote, {
			retailerId: retailer._id,
			quotationId: "quot-far",
			fee: 700,
			vehicleType: "MOTORCYCLE",
			latitude: address.latitude + 0.05,
			longitude: address.longitude,
		});
		const far = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Ben", waPhone: "60123456780" },
			deliveryMethod: "delivery",
			deliveryAddress: address,
			deliveryQuoteId: farId,
		});
		expect(far.deliveryFeePending).toBe(true);

		// No quote at all.
		const none = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Cah", waPhone: "60123456781" },
			deliveryMethod: "delivery",
			deliveryAddress: address,
		});
		expect(none.deliveryFeePending).toBe(true);
	});

	test("onUnquotable=block refuses checkout without a live quote", async () => {
		const t = setup();
		const { retailer, productId } = await seedLalamoveStore(t);
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, {
				deliveryConfig: {
					mode: "lalamove" as const,
					onUnquotable: "block" as const,
				},
			});
		});
		await expect(
			t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer: { name: "Dee", waPhone: "60123456782" },
				deliveryMethod: "delivery",
				deliveryAddress: address,
			}),
		).rejects.toThrow(/couldn't price delivery/);
	});
});

describe("updateSettings — deliveryBooking guards", () => {
	const asUser = (t: ReturnType<typeof setup>) =>
		t.withIdentity({ subject: USER });
	const ADDRESS = {
		label: "Fruit Hut HQ",
		latitude: 3.139,
		longitude: 101.6869,
	};

	test("enabling requires a business address (disabled-with-reason server side)", async () => {
		const t = setup();
		await seedRetailer(t);
		await expect(
			asUser(t).mutation(api.retailers.updateSettings, {
				deliveryBooking: { enabled: true, vehicleType: "MOTORCYCLE" },
			}),
		).rejects.toThrow(/business address/i);
	});

	test("half a credential is refused; both parts accepted; secret never leaves", async () => {
		const t = setup();
		await seedRetailer(t);
		await asUser(t).mutation(api.retailers.updateSettings, {
			businessAddress: ADDRESS,
		});
		await expect(
			asUser(t).mutation(api.retailers.updateSettings, {
				deliveryBooking: {
					enabled: false,
					vehicleType: "MOTORCYCLE",
					apiKey: "pk_byo_only",
				},
			}),
		).rejects.toThrow(/both/i);

		await asUser(t).mutation(api.retailers.updateSettings, {
			deliveryBooking: {
				enabled: true,
				vehicleType: "CAR",
				apiKey: "pk_byo_abcd",
				apiSecret: "sk_byo_secret",
			},
		});
		const retailer = await asUser(t).query(api.retailers.getMyRetailer);
		expect(retailer?.deliveryBooking).toEqual({
			enabled: true,
			vehicleType: "CAR",
			hasCredentials: true,
			promptBookOnPacked: false,
			apiKeyHint: "abcd",
		});
		// The raw secret must never appear anywhere in the owner payload.
		expect(JSON.stringify(retailer)).not.toContain("sk_byo_secret");
	});

	test("re-saving without keys keeps the stored ones; empty string clears", async () => {
		const t = setup();
		await seedRetailer(t);
		await asUser(t).mutation(api.retailers.updateSettings, {
			businessAddress: ADDRESS,
			deliveryBooking: {
				enabled: true,
				vehicleType: "MOTORCYCLE",
				apiKey: "pk_byo_abcd",
				apiSecret: "sk_byo_secret",
			},
		});
		// Vehicle flip, keys omitted → keys survive.
		await asUser(t).mutation(api.retailers.updateSettings, {
			deliveryBooking: { enabled: true, vehicleType: "CAR" },
		});
		let retailer = await asUser(t).query(api.retailers.getMyRetailer);
		expect(retailer?.deliveryBooking?.hasCredentials).toBe(true);
		// BYO-only: clearing the keys while booking stays ENABLED is refused —
		// there is no platform fallback to fall back to.
		await expect(
			asUser(t).mutation(api.retailers.updateSettings, {
				deliveryBooking: {
					enabled: true,
					vehicleType: "CAR",
					apiKey: "",
					apiSecret: "",
				},
			}),
		).rejects.toThrow(/API key/i);
		// Disable + clear together → fine; nothing resolvable remains.
		await asUser(t).mutation(api.retailers.updateSettings, {
			deliveryBooking: {
				enabled: false,
				vehicleType: "CAR",
				apiKey: "",
				apiSecret: "",
			},
		});
		retailer = await asUser(t).query(api.retailers.getMyRetailer);
		expect(retailer?.deliveryBooking?.hasCredentials).toBe(false);
		expect(retailer?.deliveryBooking?.apiKeyHint).toBeUndefined();
	});

	test("enabling without the seller's own keys is refused (BYO-only)", async () => {
		const t = setup();
		await seedRetailer(t);
		await expect(
			asUser(t).mutation(api.retailers.updateSettings, {
				businessAddress: ADDRESS,
				deliveryBooking: { enabled: true, vehicleType: "MOTORCYCLE" },
			}),
		).rejects.toThrow(/API key/i);
	});

	test("clearing the address under an enabled booking is refused", async () => {
		const t = setup();
		await seedRetailer(t);
		await asUser(t).mutation(api.retailers.updateSettings, {
			businessAddress: ADDRESS,
			deliveryBooking: {
				enabled: true,
				vehicleType: "MOTORCYCLE",
				apiKey: "pk_byo",
				apiSecret: "sk_byo",
			},
		});
		await expect(
			asUser(t).mutation(api.retailers.updateSettings, {
				businessAddress: null,
			}),
		).rejects.toThrow(/turn off delivery booking/i);
	});

	test("lalamove pricing mode requires an enabled booking; un-stranding guards hold", async () => {
		const t = setup();
		await seedRetailer(t);
		// Pricing before booking → refused.
		await expect(
			asUser(t).mutation(api.retailers.updateSettings, {
				deliveryConfig: { mode: "lalamove", onUnquotable: "arrange" },
			}),
		).rejects.toThrow(/booking first/i);
		// Booking on (trial = Pro features), then pricing → ok.
		await asUser(t).mutation(api.retailers.updateSettings, {
			businessAddress: ADDRESS,
			deliveryBooking: {
				enabled: true,
				vehicleType: "MOTORCYCLE",
				apiKey: "pk_byo",
				apiSecret: "sk_byo",
			},
		});
		await asUser(t).mutation(api.retailers.updateSettings, {
			deliveryConfig: { mode: "lalamove", onUnquotable: "arrange" },
		});
		// Disabling booking (or clearing it) while priced by live quote → refused.
		await expect(
			asUser(t).mutation(api.retailers.updateSettings, {
				deliveryBooking: { enabled: false, vehicleType: "MOTORCYCLE" },
			}),
		).rejects.toThrow(/switch the delivery charge/i);
		await expect(
			asUser(t).mutation(api.retailers.updateSettings, {
				deliveryBooking: null,
			}),
		).rejects.toThrow(/switch the delivery charge/i);
		// Switching pricing away un-strands, then disabling is free.
		await asUser(t).mutation(api.retailers.updateSettings, {
			deliveryConfig: null,
			deliveryBooking: { enabled: false, vehicleType: "MOTORCYCLE" },
		});
		const retailer = await asUser(t).query(api.retailers.getMyRetailer);
		expect(retailer?.deliveryBooking?.enabled).toBe(false);
		expect(retailer?.deliveryConfig).toBeUndefined();
	});
});
