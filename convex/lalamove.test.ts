/// <reference types="vite/client" />
// Lalamove integration — webhook event application (idempotency, out-of-order
// safety, order auto-transitions) + checkout quote consumption at
// orders.create. The pure client mechanics are covered in
// convex/lib/lalamove.test.ts; signature auth in lalamoveSignature.test.ts.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	decryptSecret,
	encryptSecret,
	isEncrypted,
} from "./lib/credentialCrypto";
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

	// Encrypted-at-rest rows (86eyn25gk): the QUERY hands out the stored
	// ciphertext untouched (queries can't decrypt), and the webhook route's
	// decryptSecret call recovers the plaintext signing secret — pinned here
	// since the route itself is a one-line wrap around the sandbox-verified
	// verifier.
	test("encrypted secret: query returns ciphertext, decryptSecret recovers the signing secret", async () => {
		vi.stubEnv(
			"CREDENTIALS_ENCRYPTION_KEY",
			btoa("0123456789abcdef0123456789abcdef"),
		);
		try {
			const t = setup();
			const retailer = await seedRetailer(t);
			const storedSecret = await encryptSecret("sk_byo");
			await t.run(async (ctx) => {
				await ctx.db.patch(retailer._id, {
					deliveryBooking: {
						enabled: true,
						vehicleType: "MOTORCYCLE" as const,
						apiKey: await encryptSecret("pk_byo"),
						apiSecret: storedSecret,
						apiKeyHint: "_byo",
					},
				});
			});
			const orderId = await seedOrder(t, retailer._id);
			await seedJob(t, retailer._id, orderId);

			const context = await t.query(internal.lalamove.getWebhookContext, {
				providerOrderId: "LLM-1",
				apiKey: "pk_byo",
			});
			expect(context.secrets).toHaveLength(1);
			expect(isEncrypted(context.secrets[0])).toBe(true);
			expect(context.secrets[0]).not.toContain("sk_byo");
			expect(await decryptSecret(context.secrets[0])).toBe("sk_byo");
		} finally {
			vi.unstubAllEnvs();
		}
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

	test("stale/mismatched/missing quote REFUSES checkout — no quote, no order (strict, 27 Jul)", async () => {
		const t = setup();
		// Seed stores a legacy `onUnquotable: "arrange"` row — the resolver must
		// ignore it: a Lalamove seller is never handed fee homework, so there is
		// NO fee-pending fallback under lalamove pricing.
		const { retailer, productId } = await seedLalamoveStore(t);
		const base = {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp" as const,
			deliveryMethod: "delivery" as const,
			deliveryAddress: address,
		};

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
		await expect(
			t.mutation(api.orders.create, {
				...base,
				customer: { name: "Ana", waPhone: "60123456789" },
				deliveryQuoteId: staleId,
			}),
		).rejects.toThrow(/couldn't price delivery/);

		// Coordinate mismatch — a quote priced for a different pin is refused.
		const farId = await t.mutation(internal.lalamove.saveCheckoutQuote, {
			retailerId: retailer._id,
			quotationId: "quot-far",
			fee: 700,
			vehicleType: "MOTORCYCLE",
			latitude: address.latitude + 0.05,
			longitude: address.longitude,
		});
		await expect(
			t.mutation(api.orders.create, {
				...base,
				customer: { name: "Ben", waPhone: "60123456780" },
				deliveryQuoteId: farId,
			}),
		).rejects.toThrow(/couldn't price delivery/);

		// No quote at all.
		await expect(
			t.mutation(api.orders.create, {
				...base,
				customer: { name: "Cah", waPhone: "60123456781" },
			}),
		).rejects.toThrow(/couldn't price delivery/);

		// No map pin at all → the pick-a-suggestion message.
		await expect(
			t.mutation(api.orders.create, {
				...base,
				customer: { name: "Dee", waPhone: "60123456782" },
				deliveryAddress: {
					...address,
					latitude: undefined,
					longitude: undefined,
				},
			}),
		).rejects.toThrow(/Pick your address/);

		// Nothing landed — the fee-pending back door is closed for lalamove.
		const landed = await t.run(async (ctx) =>
			(await ctx.db.query("orders").collect()).length,
		);
		expect(landed).toBe(0);
	});

	test("address edit re-prices via a fresh live quote; refused without one", async () => {
		const t = setup();
		const { retailer, productId } = await seedLalamoveStore(t);
		const quoteId = await t.mutation(internal.lalamove.saveCheckoutQuote, {
			retailerId: retailer._id,
			quotationId: "quot-1",
			fee: 1350,
			vehicleType: "MOTORCYCLE",
			latitude: address.latitude,
			longitude: address.longitude,
		});
		const created = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Aisha", waPhone: "60123456789" },
			deliveryMethod: "delivery",
			deliveryAddress: address,
			deliveryQuoteId: quoteId,
		});
		const token = await t.run(async (ctx) => {
			const orders = await ctx.db.query("orders").collect();
			return orders.find((o) => o.shortId === created.shortId)?.trackingToken;
		});
		const newAddress = {
			...address,
			line1: "8 Jln Kenanga 1",
			latitude: address.latitude + 0.01,
		};

		// Without a fresh quote for the new pin → refused; old fee stands.
		await expect(
			t.mutation(api.orders.updateDeliveryAddress, {
				token: token!,
				deliveryAddress: newAddress,
			}),
		).rejects.toThrow(/couldn't price delivery/);

		// With one → the fee follows the address at the REAL rider price.
		const requoteId = await t.mutation(internal.lalamove.saveCheckoutQuote, {
			retailerId: retailer._id,
			quotationId: "quot-2",
			fee: 2200,
			vehicleType: "MOTORCYCLE",
			latitude: newAddress.latitude,
			longitude: newAddress.longitude,
		});
		await t.mutation(api.orders.updateDeliveryAddress, {
			token: token!,
			deliveryAddress: newAddress,
			deliveryQuoteId: requoteId,
		});
		const after = await t.run(async (ctx) => {
			const orders = await ctx.db.query("orders").collect();
			return orders.find((o) => o.shortId === created.shortId);
		});
		expect(after?.deliveryFee).toBe(2200);
		expect(after?.total).toBe(2500 + 2200);
		expect(after?.deliverySnapshot).toMatchObject({
			mode: "lalamove",
			quotationId: "quot-2",
		});
		expect(after?.deliveryFeePending).toBeUndefined();
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
			deliveryDirection: "standard",
			apiKeyHint: "abcd",
			// A non-`pk_test_` key is a live one (86eypncfy).
			env: "production",
		});
		// The raw secret must never appear anywhere in the owner payload.
		expect(JSON.stringify(retailer)).not.toContain("sk_byo_secret");
	});

	test("a pk_test_ key is stamped and reported as sandbox (86eypncfy)", async () => {
		const t = setup();
		await seedRetailer(t);
		await asUser(t).mutation(api.retailers.updateSettings, {
			businessAddress: ADDRESS,
			deliveryBooking: {
				enabled: true,
				vehicleType: "MOTORCYCLE",
				apiKey: "pk_test_sandboxkey",
				apiSecret: "sk_test_sandboxsecret",
			},
		});
		const sandbox = await asUser(t).query(api.retailers.getMyRetailer);
		expect(sandbox?.deliveryBooking?.env).toBe("sandbox");

		// Swapping to a live pair re-stamps — the badge must follow the key, or
		// a seller who fixes their setup keeps being told they're in test mode.
		await asUser(t).mutation(api.retailers.updateSettings, {
			deliveryBooking: {
				enabled: true,
				vehicleType: "MOTORCYCLE",
				apiKey: "pk_prod_livekey",
				apiSecret: "sk_prod_livesecret",
			},
		});
		const live = await asUser(t).query(api.retailers.getMyRetailer);
		expect(live?.deliveryBooking?.env).toBe("production");

		// A save that doesn't touch the keys keeps the stamp (the apiKeyHint
		// rule) — toggling vehicle must not blank the warning.
		await asUser(t).mutation(api.retailers.updateSettings, {
			deliveryBooking: { enabled: true, vehicleType: "CAR" },
		});
		expect(
			(await asUser(t).query(api.retailers.getMyRetailer))?.deliveryBooking
				?.env,
		).toBe("production");

		// Clearing the keys clears the stamp — an unset credential has no
		// environment to report.
		await asUser(t).mutation(api.retailers.updateSettings, {
			deliveryBooking: {
				enabled: false,
				vehicleType: "CAR",
				apiKey: "",
				apiSecret: "",
			},
		});
		expect(
			(await asUser(t).query(api.retailers.getMyRetailer))?.deliveryBooking
				?.env,
		).toBeUndefined();
	});

	test("getDeliveryJob reports the store's Lalamove environment", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await asUser(t).mutation(api.retailers.updateSettings, {
			businessAddress: ADDRESS,
			deliveryBooking: {
				enabled: true,
				vehicleType: "MOTORCYCLE",
				apiKey: "pk_test_sandboxkey",
				apiSecret: "sk_test_sandboxsecret",
			},
		});
		const orderId = await seedOrder(t, retailer._id);
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		const dispatch = await asUser(t).query(api.lalamove.getDeliveryJob, {
			shortId: order?.shortId ?? "",
		});
		// The card can only warn about test keys if the read carries the fact.
		expect(dispatch?.env).toBe("sandbox");
	});

	test("Singapore: enabling rider booking WORKS now (z8r3fdch3r)", async () => {
		// This test used to pin the refusal ("Malaysia-only"). The refusal was
		// OUR gate, not Lalamove's coverage — Lalamove serves SG via the Market
		// header — so the pin flips: an SG store with keys enables cleanly.
		const t = setup();
		await seedRetailer(t);
		await asUser(t).mutation(api.retailers.updateSettings, {
			businessAddress: ADDRESS,
			country: "SG",
			waPhone: "",
		});
		await asUser(t).mutation(api.retailers.updateSettings, {
			deliveryBooking: {
				enabled: true,
				vehicleType: "MOTORCYCLE",
				apiKey: "pk_byo_abcd",
				apiSecret: "sk_byo_secret",
			},
		});
		const me = await asUser(t).query(api.retailers.getMyRetailer);
		expect(me?.deliveryBooking?.enabled).toBe(true);
	});

	test("Singapore: a full SG setup is bookable end to end (z8r3fdch3r)", async () => {
		// The mirror of the Malaysia control test below: SG store, SG phone,
		// SG buyer — blockReason resolves to null, so the Book button renders.
		const t = setup();
		const retailer = await seedRetailer(t);
		await asUser(t).mutation(api.retailers.updateSettings, {
			businessAddress: ADDRESS,
			country: "SG",
			waPhone: "",
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, { waPhone: "6581815321" });
		});
		await asUser(t).mutation(api.retailers.updateSettings, {
			deliveryBooking: {
				enabled: true,
				vehicleType: "MOTORCYCLE",
				apiKey: "pk_byo_abcd",
				apiSecret: "sk_byo_secret",
			},
		});
		const orderId = await seedOrder(t, retailer._id, {
			currency: "SGD",
			deliveryAddress: {
				line1: "10 Bayfront Ave",
				city: "Singapore",
				postcode: "018956",
				state: "Singapore",
				latitude: 1.2838,
				longitude: 103.8591,
			},
		});
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		const dispatch = await asUser(t).query(api.lalamove.getDeliveryJob, {
			shortId: order?.shortId ?? "",
		});
		expect(dispatch?.blockReason).toBeNull();
		expect(dispatch?.bookingEnabled).toBe(true);
	});

	test("Singapore: a store with an MY phone blocks on no_seller_phone — not a +60 instruction (z8r3fdch3r)", async () => {
		// The descendant of Zaki's 86eyqgujv report. The rider contact must
		// belong to the store's own market, so an SG store still carrying its
		// old +60 number blocks — and the copy for no_seller_phone is now
		// market-neutral, so it can never again tell an SG seller to add a
		// Malaysian number.
		const t = setup();
		const retailer = await seedRetailer(t);
		await asUser(t).mutation(api.retailers.updateSettings, {
			businessAddress: ADDRESS,
			deliveryBooking: {
				enabled: true,
				vehicleType: "MOTORCYCLE",
				apiKey: "pk_byo_abcd",
				apiSecret: "sk_byo_secret",
			},
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, {
				country: "SG",
				waPhone: "60123456789",
			});
		});
		const orderId = await seedOrder(t, retailer._id, {
			currency: "SGD",
			deliveryAddress: {
				line1: "10 Bayfront Ave",
				city: "Singapore",
				postcode: "018956",
				state: "Singapore",
				latitude: 1.2838,
				longitude: 103.8591,
			},
		});
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		const dispatch = await asUser(t).query(api.lalamove.getDeliveryJob, {
			shortId: order?.shortId ?? "",
		});
		expect(dispatch?.blockReason).toBe("no_seller_phone");
		expect(dispatch?.bookingEnabled).toBe(true);
	});

	test("Malaysia is untouched — the same setup still books (86eyqgujv)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await asUser(t).mutation(api.retailers.updateSettings, {
			businessAddress: ADDRESS,
			waPhone: "60123456789",
			deliveryBooking: {
				enabled: true,
				vehicleType: "MOTORCYCLE",
				apiKey: "pk_byo_abcd",
				apiSecret: "sk_byo_secret",
			},
		});
		const orderId = await seedOrder(t, retailer._id, {
			deliveryAddress: {
				line1: "1 Jalan Test",
				city: "KL",
				postcode: "50000",
				state: "Kuala Lumpur",
				latitude: 3.14,
				longitude: 101.7,
			},
		});
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		const dispatch = await asUser(t).query(api.lalamove.getDeliveryJob, {
			shortId: order?.shortId ?? "",
		});
		expect(dispatch?.blockReason).toBeNull();
		expect(dispatch?.bookingEnabled).toBe(true);
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

describe("applyWebhookEvent — seller-cancel copy preservation", () => {
	test("a CANCELED webhook (cancelReason 'other') keeps the seller's 'Cancelled by you'", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		// Seller cancelled via the button → markJobCancelled copy.
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "canceled",
			failureReason: "Cancelled by you",
		});

		await t.mutation(internal.lalamove.applyWebhookEvent, {
			jobId,
			eventType: "ORDER_STATUS_CHANGED",
			data: statusEvent("CANCELED", "2026-07-21T04:20:00.000Z", {
				cancelReason: "other",
			}),
			eventTimestamp: Date.parse("2026-07-21T04:20:00.000Z"),
		});

		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.failureReason).toBe("Cancelled by you");
	});

	test("a Lalamove-initiated CANCELED with 'other' reads 'Cancelled by Lalamove'", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId, { status: "ongoing" });

		await t.mutation(internal.lalamove.applyWebhookEvent, {
			jobId,
			eventType: "ORDER_STATUS_CHANGED",
			data: statusEvent("CANCELED", "2026-07-21T04:20:00.000Z", {
				cancelReason: "other",
			}),
			eventTimestamp: Date.parse("2026-07-21T04:20:00.000Z"),
		});

		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.status).toBe("canceled");
		expect(job?.failureReason).toBe("Cancelled by Lalamove");
	});
});

describe("applyWebhookEvent — stale currentStageId cleared on auto-transition", () => {
	test("PICKED_UP on a stepper-packed order clears the stale stage pointer", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		// Seller tapped "Packed" on the stepper → both status AND stage stored.
		const orderId = await seedOrder(t, retailer._id, {
			status: "packed",
			currentStageId: "default:packed",
		});
		const jobId = await seedJob(t, retailer._id, orderId);

		await t.mutation(internal.lalamove.applyWebhookEvent, {
			jobId,
			eventType: "ORDER_STATUS_CHANGED",
			data: statusEvent("PICKED_UP", "2026-07-24T04:00:00.000Z"),
			eventTimestamp: Date.parse("2026-07-24T04:00:00.000Z"),
		});

		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.status).toBe("shipped");
		// The stale "packed" stage pointer must not survive the auto-transition —
		// it would pin the tracking page + order detail display back to "Packed".
		expect(order?.currentStageId).toBeUndefined();
	});
});

describe("reserve → commit booking (double-dispatch guard, PR #127 review)", () => {
	test("second concurrent confirm is rejected BEFORE any rider is placed", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);

		// Two confirms race with distinct quotations (phone + desktop). The slot
		// is claimed atomically before the external POST — loser throws here,
		// so its POST /v3/orders never happens.
		await t.mutation(internal.lalamove.reserveBooking, {
			orderId,
			retailerId: retailer._id,
			quotationId: "quot-phone",
			vehicleType: "MOTORCYCLE",
		});
		await expect(
			t.mutation(internal.lalamove.reserveBooking, {
				orderId,
				retailerId: retailer._id,
				quotationId: "quot-desktop",
				vehicleType: "MOTORCYCLE",
			}),
		).rejects.toThrow(/already in progress/);
	});

	test("commit finalizes the reservation and mirrors the tracking link", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await t.mutation(internal.lalamove.reserveBooking, {
			orderId,
			retailerId: retailer._id,
			quotationId: "quot-1",
			vehicleType: "MOTORCYCLE",
		});

		await t.mutation(internal.lalamove.commitBooking, {
			jobId,
			providerOrderId: "LLM-9",
			costActual: 1350,
			shareLink: SHARE,
			providerStatus: "ASSIGNING_DRIVER",
		});

		const { job, order } = await t.run(async (ctx) => ({
			job: await ctx.db.get(jobId),
			order: await ctx.db.get(orderId),
		}));
		expect(job?.providerOrderId).toBe("LLM-9");
		expect(job?.costActual).toBe(1350);
		expect(job?.status).toBe("assigning");
		expect(order?.carrierTrackingUrl).toBe(SHARE);
	});

	test("release frees an uncommitted reservation for one-tap rebook; no-op after commit", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await t.mutation(internal.lalamove.reserveBooking, {
			orderId,
			retailerId: retailer._id,
			quotationId: "quot-1",
			vehicleType: "MOTORCYCLE",
		});

		await t.mutation(internal.lalamove.releaseReservation, {
			jobId,
			reason: "Lalamove rejected the stop",
		});
		let job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.status).toBe("canceled");
		expect(job?.failureReason).toBe("Lalamove rejected the stop");

		// Slot is free again — the rebook reserve succeeds.
		const secondId = await t.mutation(internal.lalamove.reserveBooking, {
			orderId,
			retailerId: retailer._id,
			quotationId: "quot-2",
			vehicleType: "MOTORCYCLE",
		});
		await t.mutation(internal.lalamove.commitBooking, {
			jobId: secondId,
			providerOrderId: "LLM-10",
			costActual: 1350,
		});
		// Release after commit must not touch a real booking.
		await t.mutation(internal.lalamove.releaseReservation, {
			jobId: secondId,
			reason: "late error",
		});
		job = await t.run(async (ctx) => ctx.db.get(secondId));
		expect(job?.status).toBe("assigning");
		expect(job?.failureReason).toBeUndefined();
	});

	test("expiry sweep flags only a still-uncommitted reservation", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const jobId = await t.mutation(internal.lalamove.reserveBooking, {
			orderId,
			retailerId: retailer._id,
			quotationId: "quot-1",
			vehicleType: "MOTORCYCLE",
		});

		await t.mutation(internal.lalamove.expireStaleReservation, { jobId });
		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.status).toBe("expired");
		expect(job?.failureReason).toMatch(/check your Lalamove app/i);

		// Committed booking: the sweep is a no-op.
		const liveId = await t.mutation(internal.lalamove.reserveBooking, {
			orderId,
			retailerId: retailer._id,
			quotationId: "quot-2",
			vehicleType: "MOTORCYCLE",
		});
		await t.mutation(internal.lalamove.commitBooking, {
			jobId: liveId,
			providerOrderId: "LLM-11",
			costActual: 1000,
		});
		await t.mutation(internal.lalamove.expireStaleReservation, {
			jobId: liveId,
		});
		const live = await t.run(async (ctx) => ctx.db.get(liveId));
		expect(live?.status).toBe("assigning");
	});
});

describe("proof of delivery — storePodImages", () => {
	test("first store wins; a racing duplicate is cleaned up, not doubled", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, { status: "delivered" });
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "completed",
		});

		const [first, second] = await t.run(async (ctx) => [
			await ctx.storage.store(new Blob(["photo-1"])),
			await ctx.storage.store(new Blob(["photo-2"])),
		]);

		const winner = await t.mutation(internal.lalamove.storePodImages, {
			jobId,
			storageIds: [first],
		});
		expect(winner).toBe(true);
		// COMPLETED + POD_STATUS_CHANGED can double-fire the fetch — the loser
		// must delete its blobs and leave the stored set untouched.
		const loser = await t.mutation(internal.lalamove.storePodImages, {
			jobId,
			storageIds: [second],
		});
		expect(loser).toBe(false);

		const { job, firstUrl, secondUrl } = await t.run(async (ctx) => ({
			job: await ctx.db.get(jobId),
			firstUrl: await ctx.storage.getUrl(first),
			secondUrl: await ctx.storage.getUrl(second),
		}));
		expect(job?.podImageStorageIds).toEqual([first]);
		expect(firstUrl).not.toBeNull();
		expect(secondUrl).toBeNull(); // loser's blob deleted
	});
});

describe("proof of delivery — buyer tracking page (orders.get)", () => {
	test("delivered order exposes podImageUrls on the token (buyer) path", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, {
			status: "delivered",
			trackingToken: "tok_pod_test_123",
		});
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "completed",
		});
		const storageId = await t.run(async (ctx) =>
			ctx.storage.store(new Blob(["rider-photo"])),
		);
		await t.mutation(internal.lalamove.storePodImages, {
			jobId,
			storageIds: [storageId],
		});

		const order = await t.query(api.orders.get, { token: "tok_pod_test_123" });
		expect(order?.podImageUrls).toHaveLength(1);
		expect(order?.podImageUrls?.[0]).toMatch(/^https?:\/\//);
	});

	test("no photos / not delivered → podImageUrls stays undefined", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, {
			status: "shipped",
			trackingToken: "tok_pod_test_456",
		});
		await seedJob(t, retailer._id, orderId, { status: "picked_up" });
		const order = await t.query(api.orders.get, { token: "tok_pod_test_456" });
		expect(order?.podImageUrls).toBeUndefined();
	});
});

describe("collection service (86eyg0n8e) — reversed trips", () => {
	const asUser = (t: ReturnType<typeof setup>) =>
		t.withIdentity({ subject: USER });
	const BUYER_ADDRESS = {
		line1: "12 Jln Mawar 3",
		city: "Petaling Jaya",
		state: "Selangor",
		postcode: "47301",
		latitude: 3.1073,
		longitude: 101.6067,
	};

	/** A fully bookable collection-service store: pinned outlet, BYO keys,
	 * MY seller phone, direction "collection". */
	async function seedCollectionStore(t: ReturnType<typeof setup>) {
		const retailer = await seedRetailer(t);
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, {
				waPhone: "60198765432",
				businessAddress: {
					label: "Bearcamp Wash Bay",
					latitude: 3.139,
					longitude: 101.6869,
				},
				deliveryBooking: {
					enabled: true,
					vehicleType: "MOTORCYCLE" as const,
					deliveryDirection: "collection" as const,
					apiKey: "pk_test_collect",
					apiSecret: "sk_test_collect",
				},
			});
		});
		return retailer;
	}

	test("webhook PICKED_UP + COMPLETED move the JOB only — order status and tracking link untouched", async () => {
		const t = setup();
		const retailer = await seedCollectionStore(t);
		const orderId = await seedOrder(t, retailer._id, {
			deliveryDirection: "collection",
		});
		const jobId = await seedJob(t, retailer._id, orderId, {
			deliveryDirection: "collection",
		});

		await t.mutation(internal.lalamove.applyWebhookEvent, {
			jobId,
			eventType: "ORDER_STATUS_CHANGED",
			data: statusEvent("PICKED_UP", "2026-08-02T04:00:00.000Z"),
			eventTimestamp: Date.parse("2026-08-02T04:00:00.000Z"),
		});
		let state = await t.run(async (ctx) => ({
			order: await ctx.db.get(orderId),
			job: await ctx.db.get(jobId),
		}));
		// The job follows the rider; the order is the seller's to advance.
		expect(state.job?.status).toBe("picked_up");
		expect(state.order?.status).toBe("confirmed");
		expect(state.order?.carrierTrackingUrl).toBeUndefined();

		await t.mutation(internal.lalamove.applyWebhookEvent, {
			jobId,
			eventType: "ORDER_STATUS_CHANGED",
			data: statusEvent("COMPLETED", "2026-08-02T05:00:00.000Z"),
			eventTimestamp: Date.parse("2026-08-02T05:00:00.000Z"),
		});
		state = await t.run(async (ctx) => ({
			order: await ctx.db.get(orderId),
			job: await ctx.db.get(jobId),
		}));
		expect(state.job?.status).toBe("completed");
		expect(state.order?.status).toBe("confirmed"); // still not "delivered"
		expect(state.order?.carrierTrackingUrl).toBeUndefined();
	});

	test("DRIVER_ASSIGNED stores the driver on the job but never mirrors the link onto a collection order", async () => {
		const t = setup();
		const retailer = await seedCollectionStore(t);
		const orderId = await seedOrder(t, retailer._id, {
			deliveryDirection: "collection",
		});
		const jobId = await seedJob(t, retailer._id, orderId, {
			deliveryDirection: "collection",
		});

		await t.mutation(internal.lalamove.applyWebhookEvent, {
			jobId,
			eventType: "DRIVER_ASSIGNED",
			data: {
				order: { orderId: "LLM-1", shareLink: SHARE },
				driver: { name: "Farid", phone: "+60161234567", plateNumber: "WXY 1234" },
			},
			eventTimestamp: Date.now(),
		});

		const { order, job } = await t.run(async (ctx) => ({
			order: await ctx.db.get(orderId),
			job: await ctx.db.get(jobId),
		}));
		expect(job?.driver?.name).toBe("Farid");
		expect(job?.shareLink).toBe(SHARE); // seller card keeps live tracking
		expect(order?.carrierTrackingUrl).toBeUndefined(); // buyer surfaces don't
	});

	test("getDispatchContext swaps stops AND contacts for a collection store", async () => {
		const t = setup();
		const retailer = await seedCollectionStore(t);
		const orderId = await seedOrder(t, retailer._id, {
			deliveryAddress: BUYER_ADDRESS,
			deliveryDirection: "collection",
			deliveryFee: 1350,
		});
		const shortId = await t.run(async (ctx) => {
			const order = await ctx.db.get(orderId);
			return order?.shortId ?? "";
		});

		const context = await asUser(t).query(
			internal.lalamove.getDispatchContext,
			{ shortId },
		);
		if (!context.ok) throw new Error(`expected ok, got ${context.reason}`);
		// Origin = the BUYER's pin; destination = the outlet.
		expect(context.origin.latitude).toBe(BUYER_ADDRESS.latitude);
		expect(context.origin.longitude).toBe(BUYER_ADDRESS.longitude);
		expect(context.destination.latitude).toBe(3.139);
		expect(context.destination.address).toBe("Bearcamp Wash Bay");
		// Sender = the buyer (rider's pickup contact); recipient = the store.
		expect(context.sender).toEqual({ name: "Aisha", phone: "+60123456789" });
		expect(context.recipient.name).toBe("Fruit Hut");
		expect(context.recipient.phone).toBe("+60198765432");
		// Order ref still rides the recipient remarks (the hand-over stop).
		expect(context.recipient.remarks).toContain("ORD-");
		expect(context.deliveryDirection).toBe("collection");
	});

	test("getDispatchContext stays store→buyer for a standard store (regression pin)", async () => {
		const t = setup();
		const retailer = await seedCollectionStore(t);
		await t.run(async (ctx) => {
			const row = await ctx.db.get(retailer._id);
			const booking = row?.deliveryBooking;
			if (!booking) throw new Error("seed missing booking");
			await ctx.db.patch(retailer._id, {
				deliveryBooking: { ...booking, deliveryDirection: undefined },
			});
		});
		const orderId = await seedOrder(t, retailer._id, {
			deliveryAddress: BUYER_ADDRESS,
		});
		const shortId = await t.run(async (ctx) => {
			const order = await ctx.db.get(orderId);
			return order?.shortId ?? "";
		});

		const context = await asUser(t).query(
			internal.lalamove.getDispatchContext,
			{ shortId },
		);
		if (!context.ok) throw new Error(`expected ok, got ${context.reason}`);
		expect(context.origin.label).toBe("Bearcamp Wash Bay");
		expect(context.destination.latitude).toBe(BUYER_ADDRESS.latitude);
		expect(context.sender.name).toBe("Fruit Hut");
		expect(context.recipient.name).toBe("Aisha");
		expect(context.deliveryDirection).toBe("standard");
	});

	test("reserveBooking stamps the job's frozen direction; standard stays unset", async () => {
		const t = setup();
		const retailer = await seedCollectionStore(t);
		const orderA = await seedOrder(t, retailer._id);
		const orderB = await seedOrder(t, retailer._id);

		const collectionJob = await t.mutation(internal.lalamove.reserveBooking, {
			orderId: orderA,
			retailerId: retailer._id,
			quotationId: "quot-c",
			vehicleType: "MOTORCYCLE",
			deliveryDirection: "collection",
		});
		const standardJob = await t.mutation(internal.lalamove.reserveBooking, {
			orderId: orderB,
			retailerId: retailer._id,
			quotationId: "quot-s",
			vehicleType: "MOTORCYCLE",
			deliveryDirection: "standard",
		});

		const { a, b } = await t.run(async (ctx) => ({
			a: await ctx.db.get(collectionJob),
			b: await ctx.db.get(standardJob),
		}));
		expect(a?.deliveryDirection).toBe("collection");
		expect(b?.deliveryDirection).toBeUndefined(); // one spelling for default
	});

	test("getDeliveryJob splits store-now vs trip-then, so a switched mode never rewrites history", async () => {
		const t = setup();
		const retailer = await seedCollectionStore(t);
		const orderId = await seedOrder(t, retailer._id, {
			deliveryDirection: "collection",
		});
		// A completed COLLECTION job… then the seller flips the store back to
		// standard — the card must still describe what actually happened.
		await seedJob(t, retailer._id, orderId, {
			status: "completed",
			deliveryDirection: "collection",
		});
		await t.run(async (ctx) => {
			const row = await ctx.db.get(retailer._id);
			const booking = row?.deliveryBooking;
			if (!booking) throw new Error("seed missing booking");
			await ctx.db.patch(retailer._id, {
				deliveryBooking: { ...booking, deliveryDirection: undefined },
			});
		});
		const shortId = await t.run(async (ctx) => {
			const order = await ctx.db.get(orderId);
			return order?.shortId ?? "";
		});
		const dispatch = await asUser(t).query(api.lalamove.getDeliveryJob, {
			shortId,
		});
		// The store would book a STANDARD delivery now…
		expect(dispatch?.deliveryDirection).toBe("standard");
		// …but this trip was a collection, and the card describes it as one.
		expect(dispatch?.job?.deliveryDirection).toBe("collection");
	});

	test("the inverse: a pre-collection job on a now-collection store still reads standard", async () => {
		const t = setup();
		const retailer = await seedCollectionStore(t);
		const orderId = await seedOrder(t, retailer._id);
		// A job booked before collection mode existed carries no direction.
		await seedJob(t, retailer._id, orderId, { status: "completed" });
		const shortId = await t.run(async (ctx) => {
			const order = await ctx.db.get(orderId);
			return order?.shortId ?? "";
		});
		const dispatch = await asUser(t).query(api.lalamove.getDeliveryJob, {
			shortId,
		});
		expect(dispatch?.deliveryDirection).toBe("collection"); // store today
		expect(dispatch?.job?.deliveryDirection).toBe("standard"); // that trip
	});

	test("orders.create freezes deliveryDirection from the store setting", async () => {
		const t = setup();
		const retailer = await seedCollectionStore(t);
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, {
				deliveryConfig: {
					mode: "lalamove" as const,
					onUnquotable: "block" as const,
				},
			});
		});
		const productId = await asUser(t).mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Tent Wash",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			blockWhenOutOfStock: false,
			requiresProof: false,
			variants: [{ optionValues: [], price: 8000, onHand: 100 }],
		});
		const quoteId = await t.mutation(internal.lalamove.saveCheckoutQuote, {
			retailerId: retailer._id,
			quotationId: "quot-col",
			fee: 1500,
			vehicleType: "MOTORCYCLE",
			latitude: BUYER_ADDRESS.latitude,
			longitude: BUYER_ADDRESS.longitude,
		});
		const result = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Aisha", waPhone: "60123456789" },
			deliveryMethod: "delivery",
			deliveryAddress: BUYER_ADDRESS,
			deliveryQuoteId: quoteId,
		});
		const order = await t.run(async (ctx) => {
			const orders = await ctx.db.query("orders").collect();
			return orders.find((o) => o.shortId === result.shortId);
		});
		expect(order?.deliveryDirection).toBe("collection");
	});

	test("orders.get hides the POD photo from the buyer on a collection order (it shows the SELLER's doorstep)", async () => {
		const t = setup();
		const retailer = await seedCollectionStore(t);
		const orderId = await seedOrder(t, retailer._id, {
			status: "delivered",
			trackingToken: "tok_collect_pod_1",
			deliveryDirection: "collection",
		});
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "completed",
			deliveryDirection: "collection",
		});
		const storageId = await t.run(async (ctx) =>
			ctx.storage.store(new Blob(["outlet-doorstep-photo"])),
		);
		await t.mutation(internal.lalamove.storePodImages, {
			jobId,
			storageIds: [storageId],
		});

		const order = await t.query(api.orders.get, { token: "tok_collect_pod_1" });
		expect(order?.podImageUrls).toBeUndefined();
		// The seller's dispatch card still gets the photo.
		const shortId = order?.shortId ?? "";
		const dispatch = await asUser(t).query(api.lalamove.getDeliveryJob, {
			shortId,
		});
		expect(dispatch?.job?.podImageUrls).toHaveLength(1);
	});

	test("updateSettings: direction survives a booking-off save, explicit standard clears it, slug flag follows", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await asUser(t).mutation(api.retailers.updateSettings, {
			businessAddress: { label: "Wash Bay", latitude: 3.1, longitude: 101.6 },
			deliveryBooking: {
				enabled: true,
				vehicleType: "MOTORCYCLE",
				apiKey: "pk_test_dir",
				apiSecret: "sk_test_dir",
				deliveryDirection: "collection",
			},
		});
		let summary = (await asUser(t).query(api.retailers.getMyRetailer))
			?.deliveryBooking;
		expect(summary?.deliveryDirection).toBe("collection");
		let pub = await t.query(api.retailers.getRetailerBySlug, {
			slug: retailer.slug,
		});
		expect(
			pub.status === "ok" && pub.retailer.deliveryCollectsFromCustomer,
		).toBe(true);

		// Booking off WITHOUT the field (the pricing-mode-switch save shape) —
		// the stored direction must survive for the switch back.
		await asUser(t).mutation(api.retailers.updateSettings, {
			deliveryBooking: { enabled: false, vehicleType: "MOTORCYCLE" },
		});
		summary = (await asUser(t).query(api.retailers.getMyRetailer))
			?.deliveryBooking;
		expect(summary?.deliveryDirection).toBe("collection");

		// Explicit standard clears it (stored as unset — one default spelling).
		await asUser(t).mutation(api.retailers.updateSettings, {
			deliveryBooking: {
				enabled: true,
				vehicleType: "MOTORCYCLE",
				deliveryDirection: "standard",
			},
		});
		const raw = await t.run(async (ctx) => ctx.db.get(retailer._id));
		expect(raw?.deliveryBooking?.deliveryDirection).toBeUndefined();
		pub = await t.query(api.retailers.getRetailerBySlug, {
			slug: retailer.slug,
		});
		expect(
			pub.status === "ok" && pub.retailer.deliveryCollectsFromCustomer,
		).toBe(false);
	});
});

describe("collection service — live rider strip (orders.get)", () => {
	async function collectionOrderWithJob(
		t: ReturnType<typeof setup>,
		jobOverrides: Partial<Doc<"deliveryJobs">>,
	) {
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, {
			trackingToken: "tok_rider_strip",
			deliveryDirection: "collection",
		});
		await seedJob(t, retailer._id, orderId, {
			deliveryDirection: "collection",
			...jobOverrides,
		});
		return orderId;
	}

	test("active collection job → buyer sees trip state + driver + share link, nothing sensitive", async () => {
		const t = setup();
		await collectionOrderWithJob(t, {
			status: "ongoing",
			driver: { name: "Farid", phone: "+60161234567", plateNumber: "WXY 1234" },
			shareLink: SHARE,
		});
		const order = await t.query(api.orders.get, { token: "tok_rider_strip" });
		expect(order?.collectionRider).toEqual({
			status: "ongoing",
			driverName: "Farid",
			plateNumber: "WXY 1234",
			shareLink: SHARE,
		});
		// The rider's own phone never crosses to the buyer payload.
		expect(JSON.stringify(order?.collectionRider)).not.toContain(
			"60161234567",
		);
	});

	test("strip vanishes once the trip ends (completed job)", async () => {
		const t = setup();
		await collectionOrderWithJob(t, { status: "completed" });
		const order = await t.query(api.orders.get, { token: "tok_rider_strip" });
		expect(order?.collectionRider).toBeUndefined();
	});

	test("standard delivery orders never get the strip (their tracking is the shipped message)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, {
			trackingToken: "tok_rider_std",
		});
		await seedJob(t, retailer._id, orderId, { status: "ongoing" });
		const order = await t.query(api.orders.get, { token: "tok_rider_std" });
		expect(order?.collectionRider).toBeUndefined();
	});
});

describe("collection service — collectedAt (the goods-arrived stamp)", () => {
	test("a COMPLETED collection stamps the order without advancing it; replays never move it", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, {
			deliveryDirection: "collection",
		});
		const jobId = await seedJob(t, retailer._id, orderId, {
			deliveryDirection: "collection",
		});
		const event = {
			jobId,
			eventType: "ORDER_STATUS_CHANGED",
			data: statusEvent("COMPLETED", "2026-08-02T05:00:00.000Z"),
			eventTimestamp: Date.parse("2026-08-02T05:00:00.000Z"),
		};
		await t.mutation(internal.lalamove.applyWebhookEvent, event);
		const first = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(first?.collectedAt).toBe(Date.parse("2026-08-02T05:00:00.000Z"));
		// A stamp is not a status change — the lifecycle stays the seller's.
		expect(first?.status).toBe("confirmed");

		// A later replay (Lalamove retries for 24h) must not rewrite the moment.
		await t.mutation(internal.lalamove.applyWebhookEvent, {
			...event,
			data: statusEvent("COMPLETED", "2026-08-03T05:00:00.000Z"),
			eventTimestamp: Date.parse("2026-08-03T05:00:00.000Z"),
		});
		const second = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(second?.collectedAt).toBe(first?.collectedAt);
	});

	test("a standard delivery never gets the stamp (it reaches `delivered` instead)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, { status: "shipped" });
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "picked_up",
		});
		await t.mutation(internal.lalamove.applyWebhookEvent, {
			jobId,
			eventType: "ORDER_STATUS_CHANGED",
			data: statusEvent("COMPLETED", "2026-08-02T05:00:00.000Z"),
			eventTimestamp: Date.parse("2026-08-02T05:00:00.000Z"),
		});
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.collectedAt).toBeUndefined();
		expect(order?.status).toBe("delivered");
	});

	test("the buyer's tracking read exposes it, so the page can say 'Collected on'", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, {
			trackingToken: "tok_collected_at",
			deliveryDirection: "collection",
			collectedAt: Date.parse("2026-08-02T05:00:00.000Z"),
		});
		void orderId;
		const order = await t.query(api.orders.get, { token: "tok_collected_at" });
		expect(order?.collectedAt).toBe(Date.parse("2026-08-02T05:00:00.000Z"));
	});
});

describe("collection service — booking freezes the direction onto the order", () => {
	test("an order placed as STANDARD, booked after the seller switched, becomes a collection order", async () => {
		// Zaki's own dev-testing path: place test orders, then flip the toggle.
		// Dispatch reads the store's LIVE mode, but every gate and label reads the
		// ORDER — so without this the rider genuinely collects from the buyer
		// while the order still calls itself a delivery, invisible to the status
		// gate and to the buyer's live-rider strip.
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id); // no direction
		await t.mutation(internal.lalamove.reserveBooking, {
			orderId,
			retailerId: retailer._id,
			quotationId: "quot-switch",
			vehicleType: "MOTORCYCLE",
			deliveryDirection: "collection",
		});
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.deliveryDirection).toBe("collection");
	});

	test("a STANDARD booking never touches the order's direction", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id, {
			deliveryDirection: "collection",
		});
		await t.mutation(internal.lalamove.reserveBooking, {
			orderId,
			retailerId: retailer._id,
			quotationId: "quot-std",
			vehicleType: "MOTORCYCLE",
			deliveryDirection: "standard",
		});
		// Set-if-unset, never un-set: a standard booking can't erase a collection
		// order's nature (its buyer was told "we collect from you").
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.deliveryDirection).toBe("collection");
	});
});

describe("scheduled dispatch (86eyg0n8e follow-up)", () => {
	const asUser = (t: ReturnType<typeof setup>) =>
		t.withIdentity({ subject: USER });

	test("getDispatchContext composes the buyer's moment; timeless orders carry none", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, {
				waPhone: "60198765432",
				businessAddress: {
					label: "Fruit Hut HQ",
					latitude: 3.139,
					longitude: 101.6869,
				},
				deliveryBooking: {
					enabled: true,
					vehicleType: "MOTORCYCLE" as const,
					apiKey: "pk_test_sched",
					apiSecret: "sk_test_sched",
				},
			});
		});
		const day = 1_790_000_000_000 - (1_790_000_000_000 % 86_400_000) - 8 * 3_600_000;
		const withTime = await seedOrder(t, retailer._id, {
			deliveryAddress: {
				line1: "12 Jln Mawar 3",
				city: "PJ",
				state: "Selangor",
				postcode: "47301",
				latitude: 3.1,
				longitude: 101.6,
			},
			fulfilmentDate: day,
			fulfilmentTimeMinutes: 930,
		});
		const shortId = await t.run(async (ctx) => {
			const o = await ctx.db.get(withTime);
			return o?.shortId ?? "";
		});
		const context = await asUser(t).query(
			internal.lalamove.getDispatchContext,
			{ shortId },
		);
		if (!context.ok) throw new Error(`expected ok, got ${context.reason}`);
		expect(context.requestedMoment).toBe(day + 930 * 60_000);

		// Date without time — the pre-existing behaviour: nothing to schedule.
		const dateOnly = await seedOrder(t, retailer._id, {
			deliveryAddress: {
				line1: "12 Jln Mawar 3",
				city: "PJ",
				state: "Selangor",
				postcode: "47301",
				latitude: 3.1,
				longitude: 101.6,
			},
			fulfilmentDate: day,
		});
		const shortId2 = await t.run(async (ctx) => {
			const o = await ctx.db.get(dateOnly);
			return o?.shortId ?? "";
		});
		const context2 = await asUser(t).query(
			internal.lalamove.getDispatchContext,
			{ shortId: shortId2 },
		);
		if (!context2.ok) throw new Error(`expected ok, got ${context2.reason}`);
		expect(context2.requestedMoment).toBeUndefined();
	});

	test("reserveBooking stamps the schedule; the card payload exposes it", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const orderId = await seedOrder(t, retailer._id);
		const at = Date.now() + 3 * 3_600_000;
		await t.mutation(internal.lalamove.reserveBooking, {
			orderId,
			retailerId: retailer._id,
			quotationId: "quot-sched",
			vehicleType: "MOTORCYCLE",
			scheduledAt: at,
		});
		const shortId = await t.run(async (ctx) => {
			const o = await ctx.db.get(orderId);
			return o?.shortId ?? "";
		});
		const dispatch = await asUser(t).query(api.lalamove.getDeliveryJob, {
			shortId,
		});
		expect(dispatch?.job?.scheduledAt).toBe(at);

		// An immediate booking stays unset — every pre-existing job's shape.
		const orderB = await seedOrder(t, retailer._id);
		await t.mutation(internal.lalamove.reserveBooking, {
			orderId: orderB,
			retailerId: retailer._id,
			quotationId: "quot-now",
			vehicleType: "MOTORCYCLE",
		});
		const jobB = await t.run(async (ctx) => {
			const jobs = await ctx.db
				.query("deliveryJobs")
				.withIndex("by_order", (q) => q.eq("orderId", orderB))
				.collect();
			return jobs[0];
		});
		expect(jobB?.scheduledAt).toBeUndefined();
	});
});
