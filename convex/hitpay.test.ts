/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { decryptSecret, isEncrypted } from "./lib/credentialCrypto";
import { computeHitpayHmac } from "./lib/hitpay";
import { capsForPlan, featuresForPlan, type Plan } from "./lib/plans";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const USER_A = "user_hitpay_a";
const SANDBOX_KEY = "test_abc123def456";
const SALT = "unit-test-salt";
const SITE = "https://unit.convex.site";

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

async function seedRetailer(t: ReturnType<typeof setup>, userId: string) {
	const asUser = t.withIdentity({ subject: userId });
	const safeSuffix = userId.replace(/[^a-z0-9]/g, "");
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Test Store",
		slug: `hitpay-store-${safeSuffix}`,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

async function seedProduct(
	t: ReturnType<typeof setup>,
	userId: string,
	retailerId: Id<"retailers">,
	overrides: Partial<{ price: number; requiresProof: boolean }> = {},
): Promise<Id<"products">> {
	const asUser = t.withIdentity({ subject: userId });
	return asUser.mutation(api.products.create, {
		retailerId,
		name: "Tent 2P",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: true,
		requiresProof: overrides.requiresProof ?? false,
		variants: [
			{
				optionValues: [],
				price: overrides.price ?? 12000,
				onHand: 100,
			},
		],
	});
}

const customer = { name: "Ali", waPhone: "60123456789" };
const validAddress = {
	line1: "12 Jln Mawar 3",
	city: "Petaling Jaya",
	state: "Selangor",
	postcode: "47301",
};

/** Create a storefront order and return {orderId, shortId, token, total}. */
async function seedOrder(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	productId: Id<"products">,
) {
	const { shortId, trackingToken } = await t.mutation(api.orders.create, {
		retailerId,
		items: [{ productId, quantity: 1 }],
		currency: "MYR",
		channel: "whatsapp",
		customer,
		deliveryAddress: validAddress,
	});
	const order = await t.run(async (ctx) => {
		const o = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		if (!o) throw new Error("order missing");
		return o;
	});
	return {
		orderId: order._id,
		shortId,
		token: trackingToken,
		total: order.total,
	};
}

async function connectHitpay(
	t: ReturnType<typeof setup>,
	userId: string,
	config: { enabled?: boolean; apiKey?: string; salt?: string } = {},
) {
	const asUser = t.withIdentity({ subject: userId });
	await asUser.mutation(api.retailers.updateSettings, {
		hitpay: {
			enabled: config.enabled ?? true,
			apiKey: config.apiKey ?? SANDBOX_KEY,
			salt: config.salt ?? SALT,
		},
	});
}

async function setPlan(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	plan: Plan,
) {
	await t.run(async (ctx) => {
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		if (!sub) throw new Error("no subscription row");
		const caps = capsForPlan(plan);
		await ctx.db.patch(sub._id, {
			plan,
			status: "active",
			orderCap: caps.orderCap,
			userCap: caps.userCap,
			broadcastQuota: caps.broadcastQuota,
			updatedAt: Date.now(),
		});
	});
}

/** Sign a v1 completion webhook the way HitPay does. */
async function signedWebhookBody(
	fields: Record<string, string>,
	salt = SALT,
): Promise<string> {
	const hmac = await computeHitpayHmac(fields, salt);
	const params = new URLSearchParams({ ...fields, hmac });
	return params.toString();
}

function webhookFields(requestId: string, overrides: Record<string, string> = {}) {
	return {
		payment_id: "pay_0001",
		payment_request_id: requestId,
		phone: "",
		amount: "120.00",
		currency: "MYR",
		status: "completed",
		reference_number: "ORD-TEST",
		...overrides,
	};
}

/** Stamp a minted checkout request onto an order (as createCheckout would). */
async function stampRequest(
	t: ReturnType<typeof setup>,
	orderId: Id<"orders">,
	overrides: Partial<{
		requestId: string;
		previousRequestId: string;
		amount: number;
		currency: string;
		at: number;
	}> = {},
) {
	await t.run(async (ctx) => {
		await ctx.db.patch(orderId, {
			gatewayRequestId: overrides.requestId ?? "req_0001",
			gatewayPreviousRequestId: overrides.previousRequestId,
			gatewayCheckoutUrl: "https://checkout.sandbox.hit-pay.com/x",
			gatewayRequestedAmount: overrides.amount ?? 12000,
			gatewayRequestedCurrency: overrides.currency ?? "MYR",
			gatewayRequestedAt: overrides.at ?? Date.now(),
		});
	});
}

beforeEach(() => {
	vi.stubEnv("CONVEX_SITE_URL", SITE);
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("retailers.updateSettings — hitpay connection", () => {
	test("connect stores credentials server-side; summaries never leak them", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await connectHitpay(t, USER_A);

		const asA = t.withIdentity({ subject: USER_A });
		const mine = await asA.query(api.retailers.getMyRetailer);
		expect(mine?.hitpay).toMatchObject({
			enabled: true,
			hasCredentials: true,
			mode: "sandbox",
			apiKeyHint: SANDBOX_KEY.slice(-4),
		});
		// The raw secrets exist only on the row, never on any read payload.
		expect(JSON.stringify(mine)).not.toContain(SANDBOX_KEY);
		expect(JSON.stringify(mine)).not.toContain(SALT);

		const publicPayload = await t.query(api.retailers.getRetailerBySlug, {
			slug: retailer.slug,
		});
		expect(
			publicPayload.status === "ok" &&
				"hitpay" in publicPayload.retailer &&
				publicPayload.retailer.hitpay !== undefined,
		).toBe(false);
		expect(JSON.stringify(publicPayload)).not.toContain(SANDBOX_KEY);
		expect(JSON.stringify(publicPayload)).not.toContain(SALT);

		const row = await t.run(async (ctx) => ctx.db.get(retailer._id));
		expect(row?.hitpay?.apiKey).toBe(SANDBOX_KEY);
		expect(row?.hitpay?.salt).toBe(SALT);
		expect(row?.hitpay?.connectedAt).toBeTypeOf("number");
	});

	test("half a credential is refused; enabling without keys is refused", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await expect(
			asA.mutation(api.retailers.updateSettings, {
				hitpay: { enabled: true, apiKey: SANDBOX_KEY, salt: "" },
			}),
		).rejects.toThrow(/both/i);
		await expect(
			asA.mutation(api.retailers.updateSettings, {
				hitpay: { enabled: true },
			}),
		).rejects.toThrow(/Paste your HitPay/i);
	});

	test("undefined keys keep the stored pair (pause/resume never wipes keys)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await connectHitpay(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });

		await asA.mutation(api.retailers.updateSettings, {
			hitpay: { enabled: false },
		});
		let row = await t.run(async (ctx) => ctx.db.get(retailer._id));
		expect(row?.hitpay).toMatchObject({
			enabled: false,
			apiKey: SANDBOX_KEY,
			salt: SALT,
		});

		await asA.mutation(api.retailers.updateSettings, {
			hitpay: { enabled: true },
		});
		row = await t.run(async (ctx) => ctx.db.get(retailer._id));
		expect(row?.hitpay?.enabled).toBe(true);
	});

	test("connecting is Pro-gated; disconnecting is not (downgrade never traps)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await setPlan(t, retailer._id, "starter");
		const asA = t.withIdentity({ subject: USER_A });

		await expect(
			asA.mutation(api.retailers.updateSettings, {
				hitpay: { enabled: true, apiKey: SANDBOX_KEY, salt: SALT },
			}),
		).rejects.toThrow(/Pro plan/);

		// A previously-connected store that downgraded can still pause + clear.
		await setPlan(t, retailer._id, "pro");
		await connectHitpay(t, USER_A);
		await setPlan(t, retailer._id, "starter");
		await asA.mutation(api.retailers.updateSettings, {
			hitpay: { enabled: false },
		});
		await asA.mutation(api.retailers.updateSettings, { hitpay: null });
		const row = await t.run(async (ctx) => ctx.db.get(retailer._id));
		expect(row?.hitpay).toBeUndefined();
	});

	test("plan catalog: onlinePayments is Pro+", () => {
		expect(featuresForPlan("starter").onlinePayments).toBe(false);
		expect(featuresForPlan("pro").onlinePayments).toBe(true);
		expect(featuresForPlan("scale").onlinePayments).toBe(true);
	});
});

describe("orders.getPaymentMethods — gatewayAvailable", () => {
	test("true only while connected + enabled + unpaid + holds clear", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const { orderId, token } = await seedOrder(t, retailer._id, productId);

		// Not connected → section null (no manual methods configured either).
		expect(
			await t.query(api.orders.getPaymentMethods, { token }),
		).toBeNull();

		await connectHitpay(t, USER_A);
		let info = await t.query(api.orders.getPaymentMethods, { token });
		expect(info?.gatewayAvailable).toBe(true);
		expect(info?.methods).toHaveLength(0);

		// Paused connection → off.
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.retailers.updateSettings, {
			hitpay: { enabled: false },
		});
		info = await t.query(api.orders.getPaymentMethods, { token });
		expect(info).toBeNull();

		// Received → the buyer page skips the query, and the server agrees.
		await asA.mutation(api.retailers.updateSettings, {
			hitpay: { enabled: true },
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(orderId, { paymentStatus: "received" });
		});
		info = await t.query(api.orders.getPaymentMethods, { token });
		expect(info?.gatewayAvailable ?? false).toBe(false);
	});

	test("held totals (mockup gate) keep the gateway off", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id, {
			requiresProof: true,
		});
		await connectHitpay(t, USER_A);
		const { token } = await seedOrder(t, retailer._id, productId);
		const info = await t.query(api.orders.getPaymentMethods, { token });
		expect(info?.gatewayAvailable ?? false).toBe(false);
	});
});

describe("hitpay.createCheckout", () => {
	test("mints a request, stores it on the order, and reuses it while fresh", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await connectHitpay(t, USER_A);
		const { orderId, token, total } = await seedOrder(
			t,
			retailer._id,
			productId,
		);

		const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
			const body = new URLSearchParams(String(init?.body));
			expect(String(url)).toBe(
				"https://api.sandbox.hit-pay.com/v1/payment-requests",
			);
			expect(
				(init?.headers as Record<string, string>)["X-BUSINESS-API-KEY"],
			).toBe(SANDBOX_KEY);
			expect(body.get("amount")).toBe((total / 100).toFixed(2));
			expect(body.get("currency")).toBe("MYR");
			expect(body.get("send_sms")).toBe("false");
			expect(body.get("webhook")).toBe(`${SITE}/webhook/hitpay`);
			return new Response(
				JSON.stringify({
					id: "req_live_1",
					url: "https://checkout.sandbox.hit-pay.com/req_live_1",
					status: "pending",
					amount: body.get("amount"),
					currency: "myr",
					payment_methods: ["duitnow", "touch_n_go"],
				}),
				{ status: 201 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const first = await t.action(api.hitpay.createCheckout, { token });
		expect(first.url).toBe("https://checkout.sandbox.hit-pay.com/req_live_1");
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const row = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(row?.gatewayRequestId).toBe("req_live_1");
		expect(row?.gatewayRequestedAmount).toBe(total);
		expect(row?.gatewayRequestedCurrency).toBe("MYR");

		// Every real mint refreshes the account's enabled-methods truth for free.
		const retailerRow = await t.run(async (ctx) => ctx.db.get(retailer._id));
		expect(retailerRow?.hitpay?.paymentMethods).toEqual([
			"duitnow",
			"touch_n_go",
		]);
		// …and the buyer query now names exactly those rails.
		const info = await t.query(api.orders.getPaymentMethods, { token });
		expect(info?.gatewayMethods).toEqual(["duitnow", "touch_n_go"]);

		// Second tap while the request is fresh → same URL, no second mint.
		const second = await t.action(api.hitpay.createCheckout, { token });
		expect(second.url).toBe(first.url);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test("guards: disconnected store, settled payment, held totals", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		// Two orders: the per-token rate limit (burst 3) would otherwise trip
		// on the fourth guard probe against a single order.
		const a = await seedOrder(t, retailer._id, productId);
		const b = await seedOrder(t, retailer._id, productId);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("{}", { status: 500 })),
		);

		await expect(
			t.action(api.hitpay.createCheckout, { token: a.token }),
		).rejects.toThrow(/isn't available/);

		await connectHitpay(t, USER_A);
		await t.run(async (ctx) => {
			await ctx.db.patch(a.orderId, { paymentStatus: "claimed" });
		});
		await expect(
			t.action(api.hitpay.createCheckout, { token: a.token }),
		).rejects.toThrow(/already told the store/);

		await t.run(async (ctx) => {
			await ctx.db.patch(a.orderId, {
				paymentStatus: "received" as const,
			});
		});
		await expect(
			t.action(api.hitpay.createCheckout, { token: a.token }),
		).rejects.toThrow(/already confirmed/);

		await t.run(async (ctx) => {
			await ctx.db.patch(b.orderId, { deliveryFeePending: true });
		});
		await expect(
			t.action(api.hitpay.createCheckout, { token: b.token }),
		).rejects.toThrow(/isn't confirmed yet/);
	});

	test("HitPay rejection surfaces a buyer-safe error, stores nothing", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await connectHitpay(t, USER_A);
		const { orderId, token } = await seedOrder(t, retailer._id, productId);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("unauthorized", { status: 401 })),
		);
		await expect(
			t.action(api.hitpay.createCheckout, { token }),
		).rejects.toThrow(/Couldn't reach the payment service/);
		const row = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(row?.gatewayRequestId).toBeUndefined();
	});
});

describe("POST /webhook/hitpay", () => {
	async function seedPayableOrder(t: ReturnType<typeof setup>) {
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await connectHitpay(t, USER_A);
		const order = await seedOrder(t, retailer._id, productId);
		await stampRequest(t, order.orderId, { amount: order.total });
		return { retailer, ...order };
	}

	function post(t: ReturnType<typeof setup>, body: string) {
		return t.fetch("/webhook/hitpay", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
		});
	}

	test("authentic completed payment → received + auto-confirm + event", async () => {
		const t = setup();
		const { orderId, total, token } = await seedPayableOrder(t);
		// Push-path orders are born confirmed in prod; this seed's order is
		// pending (no template env), which exercises the auto-confirm branch.
		const res = await post(
			t,
			await signedWebhookBody(
				webhookFields("req_0001", {
					amount: (total / 100).toFixed(2),
				}),
			),
		);
		expect(res.status).toBe(200);

		const row = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(row?.paymentStatus).toBe("received");
		expect(row?.status).toBe("confirmed");
		expect(row?.gatewayPaymentId).toBe("pay_0001");
		expect(row?.paymentReference).toBe("pay_0001");
		// v1 webhooks carry no rail — stamped "other" until enrichment runs.
		expect(row?.paymentMethod).toBe("other");
		const events = await t.run(async (ctx) =>
			ctx.db
				.query("orderEvents")
				.withIndex("by_order", (q) => q.eq("orderId", orderId))
				.collect(),
		);
		expect(
			events.some((e) => e.note === "payment_received_auto_confirm"),
		).toBe(true);
		// The buyer's track page shows the same ref the seller sees (86eyjmhby)
		// — pin that the unauthenticated token read exposes it.
		const buyerOrder = await t.query(api.orders.get, { token });
		expect(buyerOrder?.gatewayPaymentId).toBe("pay_0001");
	});

	test("duplicate delivery no-ops; tampered hmac is rejected", async () => {
		const t = setup();
		const { orderId, total } = await seedPayableOrder(t);
		const fields = webhookFields("req_0001", {
			amount: (total / 100).toFixed(2),
		});
		expect((await post(t, await signedWebhookBody(fields))).status).toBe(200);
		const afterFirst = await t.run(async (ctx) => ctx.db.get(orderId));

		// Same payment_id again → 200, nothing changes.
		expect((await post(t, await signedWebhookBody(fields))).status).toBe(200);
		const afterSecond = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(afterSecond?.paymentReceivedAt).toBe(afterFirst?.paymentReceivedAt);

		// Tampered amount (signature no longer matches) → 401.
		const tampered = new URLSearchParams(await signedWebhookBody(fields));
		tampered.set("amount", "1.00");
		expect((await post(t, tampered.toString())).status).toBe(401);

		// Signed with the wrong salt → 401.
		expect(
			(await post(t, await signedWebhookBody(fields, "other-salt"))).status,
		).toBe(401);
	});

	test("authentic but mismatched amount → event + email, never received", async () => {
		const t = setup();
		const { orderId } = await seedPayableOrder(t);
		const res = await post(
			t,
			await signedWebhookBody(
				webhookFields("req_0001", { amount: "1.00" }),
			),
		);
		expect(res.status).toBe(200);
		const row = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(row?.paymentStatus ?? "unpaid").toBe("unpaid");
		expect(row?.gatewayPaymentId).toBeUndefined();
		const events = await t.run(async (ctx) =>
			ctx.db
				.query("orderEvents")
				.withIndex("by_order", (q) => q.eq("orderId", orderId))
				.collect(),
		);
		expect(
			events.some((e) => e.note?.startsWith("gateway_amount_mismatch")),
		).toBe(true);
	});

	test("unknown request id and non-completed statuses ack without change", async () => {
		const t = setup();
		const { orderId, total } = await seedPayableOrder(t);
		expect(
			(
				await post(
					t,
					await signedWebhookBody(webhookFields("req_unknown")),
				)
			).status,
		).toBe(200);
		expect(
			(
				await post(
					t,
					await signedWebhookBody(
						webhookFields("req_0001", {
							amount: (total / 100).toFixed(2),
							status: "failed",
						}),
					),
				)
			).status,
		).toBe(200);
		const row = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(row?.paymentStatus ?? "unpaid").toBe("unpaid");
	});

	test("ours-but-disconnected (no salt) fails closed with 500", async () => {
		const t = setup();
		const { retailer, total } = await seedPayableOrder(t);
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.retailers.updateSettings, { hitpay: null });
		const res = await post(
			t,
			await signedWebhookBody(
				webhookFields("req_0001", { amount: (total / 100).toFixed(2) }),
			),
		);
		expect(res.status).toBe(500);
		void retailer;
	});
});

describe("replaced links + pay-after-cancel (PR #172 review)", () => {
	async function seedPayableOrder(t: ReturnType<typeof setup>) {
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await connectHitpay(t, USER_A);
		const order = await seedOrder(t, retailer._id, productId);
		return { retailer, ...order };
	}

	function post(t: ReturnType<typeof setup>, body: string) {
		return t.fetch("/webhook/hitpay", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
		});
	}

	test("payment on a re-priced REPLACED link records the mismatch instead of silence", async () => {
		const t = setup();
		const { orderId, total } = await seedPayableOrder(t);
		// Current request prices the new total; the replaced one carried the old
		// price and its link is still payable at HitPay.
		await stampRequest(t, orderId, {
			requestId: "req_new",
			previousRequestId: "req_old",
			amount: total,
		});
		const oldPrice = ((total - 1000) / 100).toFixed(2);
		const res = await post(
			t,
			await signedWebhookBody(webhookFields("req_old", { amount: oldPrice })),
		);
		expect(res.status).toBe(200);
		const row = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(row?.paymentStatus ?? "unpaid").toBe("unpaid");
		const events = await t.run(async (ctx) =>
			ctx.db
				.query("orderEvents")
				.withIndex("by_order", (q) => q.eq("orderId", orderId))
				.collect(),
		);
		expect(
			events.some((e) => e.note?.startsWith("gateway_amount_mismatch")),
		).toBe(true);
	});

	test("double-mint race: replacement keeps the old id, DELETEs the stale link, and a same-amount payment on it applies", async () => {
		const t = setup();
		const { orderId, token, total } = await seedPayableOrder(t);
		let mintCount = 0;
		const deleted: string[] = [];
		const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
			if (init?.method === "DELETE") {
				deleted.push(String(url));
				return new Response("{}", { status: 200 });
			}
			mintCount++;
			return new Response(
				JSON.stringify({
					id: `req_mint_${mintCount}`,
					url: `https://checkout.sandbox.hit-pay.com/m${mintCount}`,
					status: "pending",
					amount: (total / 100).toFixed(2),
					currency: "myr",
				}),
				{ status: 201 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await t.action(api.hitpay.createCheckout, { token });
		// Age the first request past the reuse window so the next tap re-mints
		// at the SAME amount (the two-open-tabs shape).
		await t.run(async (ctx) => {
			await ctx.db.patch(orderId, {
				gatewayRequestedAt: Date.now() - 56 * 60 * 1000,
			});
		});
		await t.action(api.hitpay.createCheckout, { token });

		const row = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(row?.gatewayRequestId).toBe("req_mint_2");
		expect(row?.gatewayPreviousRequestId).toBe("req_mint_1");
		// Best-effort void of the stale link at HitPay.
		expect(deleted.some((u) => u.includes("req_mint_1"))).toBe(true);

		// The buyer pays the old (same-amount) link anyway → applies normally.
		const res = await post(
			t,
			await signedWebhookBody(
				webhookFields("req_mint_1", { amount: (total / 100).toFixed(2) }),
			),
		);
		expect(res.status).toBe(200);
		const paid = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(paid?.paymentStatus).toBe("received");
		expect(paid?.gatewayPaymentId).toBe("pay_0001");
	});

	test("pay-after-cancel: event + seller email path, no state flip, no buyer message", async () => {
		const t = setup();
		const { orderId, total } = await seedPayableOrder(t);
		await stampRequest(t, orderId, { amount: total });
		await t.run(async (ctx) => {
			await ctx.db.patch(orderId, { status: "cancelled" });
		});
		const res = await post(
			t,
			await signedWebhookBody(
				webhookFields("req_0001", { amount: (total / 100).toFixed(2) }),
			),
		);
		expect(res.status).toBe(200);
		const row = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(row?.status).toBe("cancelled");
		expect(row?.paymentStatus ?? "unpaid").toBe("unpaid");
		expect(row?.gatewayPaymentId).toBeUndefined();
		const events = await t.run(async (ctx) =>
			ctx.db
				.query("orderEvents")
				.withIndex("by_order", (q) => q.eq("orderId", orderId))
				.collect(),
		);
		expect(
			events.some((e) => e.note?.startsWith("gateway_paid_after_cancel")),
		).toBe(true);
	});

	test("verifyCheckout falls back to the replaced request when the current one is unpaid", async () => {
		const t = setup();
		const { orderId, token, total } = await seedPayableOrder(t);
		await stampRequest(t, orderId, {
			requestId: "req_new",
			previousRequestId: "req_old",
			amount: total,
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: unknown) => {
				const isOld = String(url).includes("req_old");
				return new Response(
					JSON.stringify({
						id: isOld ? "req_old" : "req_new",
						url: "https://checkout/x",
						status: isOld ? "completed" : "pending",
						amount: (total / 100).toFixed(2),
						currency: "myr",
						payments: isOld
							? [
									{
										id: "pay_prev",
										status: "succeeded",
										payment_type: "duitnow",
										amount: (total / 100).toFixed(2),
										currency: "myr",
									},
								]
							: [],
					}),
					{ status: 200 },
				);
			}),
		);
		const result = await t.action(api.hitpay.verifyCheckout, { token });
		expect(result.paymentStatus).toBe("received");
		const row = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(row?.paymentStatus).toBe("received");
		expect(row?.gatewayPaymentId).toBe("pay_prev");
		expect(row?.paymentMethod).toBe("duitnow");
	});
});

describe("account-methods probe (connect-time key validation)", () => {
	test("probe stores the account's enabled rails on success", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await connectHitpay(t, USER_A);
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url: unknown, init?: RequestInit) => {
				const body = new URLSearchParams(String(init?.body));
				expect(body.get("expires_after")).toBe("5 mins");
				expect(body.get("send_sms")).toBe("false");
				return new Response(
					JSON.stringify({
						id: "req_probe",
						url: "https://checkout/x",
						status: "pending",
						amount: "1.00",
						currency: "myr",
						payment_methods: ["touch_n_go", "duitnow"],
					}),
					{ status: 201 },
				);
			}),
		);
		await t.action(internal.hitpay.refreshAccountMethods, {
			retailerId: retailer._id,
		});
		const row = await t.run(async (ctx) => ctx.db.get(retailer._id));
		expect(row?.hitpay?.paymentMethods).toEqual(["touch_n_go", "duitnow"]);
		expect(row?.hitpay?.methodsCheckedAt).toBeTypeOf("number");
	});

	test("401 marks the key rejected (checkedAt, no list); 500 leaves prior truth", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await connectHitpay(t, USER_A);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("unauthorized", { status: 401 })),
		);
		await t.action(internal.hitpay.refreshAccountMethods, {
			retailerId: retailer._id,
		});
		let row = await t.run(async (ctx) => ctx.db.get(retailer._id));
		expect(row?.hitpay?.paymentMethods).toBeUndefined();
		expect(row?.hitpay?.methodsCheckedAt).toBeTypeOf("number");

		// Seed a prior truth, then a transient failure must NOT clobber it.
		await t.run(async (ctx) => {
			const r = await ctx.db.get(retailer._id);
			if (!r?.hitpay) throw new Error("no hitpay");
			await ctx.db.patch(retailer._id, {
				hitpay: { ...r.hitpay, paymentMethods: ["duitnow"] },
			});
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("oops", { status: 500 })),
		);
		await t.action(internal.hitpay.refreshAccountMethods, {
			retailerId: retailer._id,
		});
		row = await t.run(async (ctx) => ctx.db.get(retailer._id));
		expect(row?.hitpay?.paymentMethods).toEqual(["duitnow"]);
	});

	test("replacing the key clears the previous account's method truth", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await connectHitpay(t, USER_A);
		await t.run(async (ctx) => {
			const r = await ctx.db.get(retailer._id);
			if (!r?.hitpay) throw new Error("no hitpay");
			await ctx.db.patch(retailer._id, {
				hitpay: {
					...r.hitpay,
					paymentMethods: ["duitnow"],
					methodsCheckedAt: 123,
				},
			});
		});
		const asA = t.withIdentity({ subject: USER_A });
		// Pause/resume (keys untouched) keeps the truth…
		await asA.mutation(api.retailers.updateSettings, {
			hitpay: { enabled: false },
		});
		let row = await t.run(async (ctx) => ctx.db.get(retailer._id));
		expect(row?.hitpay?.paymentMethods).toEqual(["duitnow"]);
		// …a NEW key drops it (different account, different truth).
		await asA.mutation(api.retailers.updateSettings, {
			hitpay: { enabled: true, apiKey: "test_other_key", salt: "s2" },
		});
		row = await t.run(async (ctx) => ctx.db.get(retailer._id));
		expect(row?.hitpay?.paymentMethods).toBeUndefined();
		expect(row?.hitpay?.methodsCheckedAt).toBeUndefined();
	});
});

describe("verifyCheckout + method enrichment", () => {
	test("redirect reconcile settles a paid order with the real rail", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await connectHitpay(t, USER_A);
		const { orderId, token, total } = await seedOrder(
			t,
			retailer._id,
			productId,
		);
		await stampRequest(t, orderId, { amount: total });

		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response(
					JSON.stringify({
						id: "req_0001",
						url: "https://checkout/x",
						status: "completed",
						amount: (total / 100).toFixed(2),
						currency: "MYR",
						payments: [
							{
								id: "pay_777",
								status: "succeeded",
								payment_type: "touch_n_go",
								amount: (total / 100).toFixed(2),
								currency: "myr",
							},
						],
					}),
					{ status: 200 },
				),
			),
		);

		const result = await t.action(api.hitpay.verifyCheckout, { token });
		expect(result.paymentStatus).toBe("received");
		const row = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(row?.paymentStatus).toBe("received");
		expect(row?.paymentMethod).toBe("tng");
		expect(row?.gatewayPaymentId).toBe("pay_777");
	});

	test("unpaid request stays unpaid; verify never invents a payment", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await connectHitpay(t, USER_A);
		const { orderId, token, total } = await seedOrder(
			t,
			retailer._id,
			productId,
		);
		await stampRequest(t, orderId, { amount: total });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response(
					JSON.stringify({
						id: "req_0001",
						url: "https://checkout/x",
						status: "pending",
						amount: (total / 100).toFixed(2),
						currency: "MYR",
						payments: [],
					}),
					{ status: 200 },
				),
			),
		);
		const result = await t.action(api.hitpay.verifyCheckout, { token });
		expect(result.paymentStatus).toBe("unpaid");
		const row = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(row?.paymentStatus ?? "unpaid").toBe("unpaid");
	});

	test("recordGatewayMethod upgrades 'other', never a seller-picked rail", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const { orderId } = await seedOrder(t, retailer._id, productId);
		await t.run(async (ctx) => {
			await ctx.db.patch(orderId, {
				paymentStatus: "received",
				paymentMethod: "other",
				gatewayPaymentId: "pay_1",
			});
		});
		await t.mutation(internal.orders.recordGatewayMethod, {
			orderId,
			paymentId: "pay_1",
			paymentType: "fpx",
		});
		let row = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(row?.paymentMethod).toBe("fpx");

		// A different payment id (not the settled one) never rewrites.
		await t.mutation(internal.orders.recordGatewayMethod, {
			orderId,
			paymentId: "pay_other",
			paymentType: "card",
		});
		row = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(row?.paymentMethod).toBe("fpx");

		// A seller-picked method is never overwritten.
		await t.run(async (ctx) => {
			await ctx.db.patch(orderId, { paymentMethod: "bank_transfer" });
		});
		await t.mutation(internal.orders.recordGatewayMethod, {
			orderId,
			paymentId: "pay_1",
			paymentType: "card",
		});
		row = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(row?.paymentMethod).toBe("bank_transfer");
	});
});

/**
 * PR #178 review, finding 1 — an authentic payment the order can't apply used
 * to be a SILENT state: an orderEvents note + a seller email, while the buyer
 * kept a plain "unpaid" page with Pay-now armed. These pin the durable stamp,
 * both exits out of it, and the re-price guard that stops it arising.
 */
describe("unapplied gateway payments are surfaced, not silent", () => {
	async function seedPayable(t: ReturnType<typeof setup>) {
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await connectHitpay(t, USER_A);
		const order = await seedOrder(t, retailer._id, productId);
		await stampRequest(t, order.orderId, { amount: order.total });
		return { retailer, ...order };
	}

	function post(t: ReturnType<typeof setup>, body: string) {
		return t.fetch("/webhook/hitpay", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
		});
	}

	test("a mismatched amount freezes the issue onto the order and reaches the buyer", async () => {
		const t = setup();
		const { orderId, token } = await seedPayable(t);
		await post(
			t,
			await signedWebhookBody(webhookFields("req_0001", { amount: "1.00" })),
		);

		const row = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(row?.gatewayPaymentIssue).toMatchObject({
			kind: "amount_mismatch",
			paidAmountSen: 100,
			paidCurrency: "MYR",
			paymentId: "pay_0001",
		});
		// The unauthenticated buyer read must carry it — that read is the ONLY
		// thing the tracking page renders from, and the webhook discovers this
		// with no client watching.
		const buyerOrder = await t.query(api.orders.get, { token });
		expect(buyerOrder?.gatewayPaymentIssue?.kind).toBe("amount_mismatch");
	});

	test("Pay-now is refused server-side while an issue is unresolved", async () => {
		const t = setup();
		const { token } = await seedPayable(t);
		await post(
			t,
			await signedWebhookBody(webhookFields("req_0001", { amount: "1.00" })),
		);
		// Not merely hidden in the UI: a direct call must not mint a second
		// payable link on top of money that already moved.
		await expect(
			t.action(api.hitpay.createCheckout, { token }),
		).rejects.toThrow(/don't pay again/i);
	});

	test("accepting the payment by hand retires the notice", async () => {
		const t = setup();
		const { orderId } = await seedPayable(t);
		await post(
			t,
			await signedWebhookBody(webhookFields("req_0001", { amount: "1.00" })),
		);
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.orders.markPaymentReceived, { orderId });
		const row = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(row?.paymentStatus).toBe("received");
		expect(row?.gatewayPaymentIssue).toBeUndefined();
	});

	test("refunding instead: the seller clears it, which re-arms Pay-now", async () => {
		const t = setup();
		const { orderId, token } = await seedPayable(t);
		await post(
			t,
			await signedWebhookBody(webhookFields("req_0001", { amount: "1.00" })),
		);
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.orders.clearGatewayPaymentIssue, { orderId });

		const row = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(row?.gatewayPaymentIssue).toBeUndefined();
		// Still unpaid — clearing the notice must never imply the money landed.
		expect(row?.paymentStatus ?? "unpaid").toBe("unpaid");
		const events = await t.run(async (ctx) =>
			ctx.db
				.query("orderEvents")
				.withIndex("by_order", (q) => q.eq("orderId", orderId))
				.collect(),
		);
		expect(
			events.some((e) =>
				e.note?.startsWith("gateway_issue_resolved_by_seller"),
			),
		).toBe(true);

		// The request the odd payment landed on is retired too — HitPay may
		// consider it settled, so reusing its URL could refuse the buyer.
		expect(row?.gatewayRequestId).toBeUndefined();
		expect(row?.gatewayPreviousRequestId).toBe("req_0001");

		// The whole point of the exit: the buyer can pay again afterwards, on a
		// FRESH link rather than the retired one.
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							id: "req_after_refund",
							url: "https://checkout.sandbox.hit-pay.com/fresh",
							status: "pending",
						}),
						{ status: 200 },
					),
			),
		);
		const { url } = await t.action(api.hitpay.createCheckout, { token });
		expect(url).toBe("https://checkout.sandbox.hit-pay.com/fresh");
	});

	test("clearing is owner-or-admin only", async () => {
		const t = setup();
		const { orderId } = await seedPayable(t);
		await post(
			t,
			await signedWebhookBody(webhookFields("req_0001", { amount: "1.00" })),
		);
		await expect(
			t
				.withIdentity({ subject: "user_stranger" })
				.mutation(api.orders.clearGatewayPaymentIssue, { orderId }),
		).rejects.toThrow();
	});

	test("a payment after cancellation stamps its own kind", async () => {
		const t = setup();
		const { orderId, total } = await seedPayable(t);
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.orders.updateStatus, {
			orderId,
			status: "cancelled",
		});
		await post(
			t,
			await signedWebhookBody(
				webhookFields("req_0001", { amount: (total / 100).toFixed(2) }),
			),
		);
		const row = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(row?.gatewayPaymentIssue?.kind).toBe("paid_after_cancel");
		expect(row?.status).toBe("cancelled");
	});

	test("a re-price voids the live link but KEEPS it correlatable", async () => {
		const t = setup();
		const { orderId, total } = await seedPayable(t);
		const asA = t.withIdentity({ subject: USER_A });
		// The review's exact scenario: the buyer holds a link minted at `total`
		// while the seller corrects the delivery charge.
		await asA.mutation(api.orders.setDeliveryFee, { orderId, fee: 1000 });

		const row = await t.run(async (ctx) => ctx.db.get(orderId));
		// The live link is gone, so the 55-min reuse window can't hand the stale
		// price to another tap...
		expect(row?.gatewayRequestId).toBeUndefined();
		expect(row?.gatewayCheckoutUrl).toBeUndefined();
		// ...but the id survives, or a payment that beat our DELETE would arrive
		// as an unknown webhook and be silently dropped.
		expect(row?.gatewayPreviousRequestId).toBe("req_0001");
		expect(row?.total).toBe(total + 1000);

		// Prove the correlation still works end to end.
		expect(
			(
				await post(
					t,
					await signedWebhookBody(
						webhookFields("req_0001", { amount: (total / 100).toFixed(2) }),
					),
				)
			).status,
		).toBe(200);
		const after = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(after?.gatewayPaymentIssue?.kind).toBe("amount_mismatch");
	});

	test("a re-price that lands on the same total leaves the link alone", async () => {
		const t = setup();
		const { orderId } = await seedPayable(t);
		const asA = t.withIdentity({ subject: USER_A });
		// fee 0 on an order that already has none — nothing moved, so the buyer
		// must not lose the checkout they have open.
		await asA.mutation(api.orders.setDeliveryFee, { orderId, fee: 0 });
		const row = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(row?.gatewayRequestId).toBe("req_0001");
		expect(row?.gatewayPreviousRequestId).toBeUndefined();
	});

	test("a vanished order reports `gone`, never `duplicate`", async () => {
		const t = setup();
		const { orderId } = await seedPayable(t);
		await t.run(async (ctx) => {
			await ctx.db.delete(orderId);
		});
		// `duplicate` means "already settled" and verifyCheckout maps it to
		// "received" — reporting that for an order that no longer exists would
		// tell the buyer their payment landed on nothing.
		const result = await t.mutation(internal.orders.receiveGatewayPayment, {
			orderId,
			paymentId: "pay_9999",
			amountSen: 100,
			currency: "MYR",
		});
		expect(result).toEqual({ applied: false, reason: "gone" });
	});
});

describe("credentials encrypted at rest (86eyn25gk)", () => {
	test("connect → scheduled action encrypts; summary + signed webhook still work end-to-end", async () => {
		// Fake timers must be on BEFORE the convexTest instance exists, or
		// scheduled internalActions that call ctx.runQuery crash with
		// "Transaction not started" (the whatsapp.test.ts gotcha).
		vi.useFakeTimers();
		vi.stubEnv(
			"CREDENTIALS_ENCRYPTION_KEY",
			btoa("0123456789abcdef0123456789abcdef"),
		);
		// The flush below also runs the connect probe — feed it a happy echo.
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					id: "req_probe",
					url: "https://checkout.sandbox.hit-pay.com/probe",
					payment_methods: ["duitnow"],
				}),
			),
		);
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await connectHitpay(t, USER_A);

		// Run the scheduled encrypt action (+ probe).
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		// At rest: ciphertext only, hint + mode stamped from the plaintext.
		const row = await t.run(async (ctx) => ctx.db.get(retailer._id));
		expect(row?.hitpay?.apiKey && isEncrypted(row.hitpay.apiKey)).toBe(true);
		expect(row?.hitpay?.salt && isEncrypted(row.hitpay.salt)).toBe(true);
		expect(row?.hitpay?.apiKey).not.toContain(SANDBOX_KEY);
		expect(await decryptSecret(row?.hitpay?.salt ?? "")).toBe(SALT);
		expect(row?.hitpay?.apiKeyHint).toBe(SANDBOX_KEY.slice(-4));
		expect(row?.hitpay?.mode).toBe("sandbox");

		// The owner summary still reads true — from the STORED hint/mode, since
		// a query can't derive either from ciphertext.
		const mine = await t
			.withIdentity({ subject: USER_A })
			.query(api.retailers.getMyRetailer);
		expect(mine?.hitpay).toMatchObject({
			hasCredentials: true,
			mode: "sandbox",
			apiKeyHint: SANDBOX_KEY.slice(-4),
		});
		expect(JSON.stringify(mine)).not.toContain(SANDBOX_KEY);
		expect(JSON.stringify(mine)).not.toContain(SALT);

		// The money E2E: HitPay signs webhooks with the PLAINTEXT salt — the
		// route must decrypt the stored ciphertext before verifying.
		const order = await seedOrder(t, retailer._id, productId);
		await stampRequest(t, order.orderId, { amount: order.total });
		const res = await t.fetch("/webhook/hitpay", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: await signedWebhookBody(
				webhookFields("req_0001", {
					amount: (order.total / 100).toFixed(2),
				}),
			),
		});
		expect(res.status).toBe(200);
		const paid = await t.run(async (ctx) => ctx.db.get(order.orderId));
		expect(paid?.paymentStatus).toBe("received");
		vi.useRealTimers();
	});

	test("without the env key, saves keep plaintext and everything behaves as before", async () => {
		vi.useFakeTimers();
		// The flush runs the connect probe — keep it off the real network.
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					id: "req_probe",
					url: "https://checkout.sandbox.hit-pay.com/probe",
					payment_methods: ["duitnow"],
				}),
			),
		);
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await connectHitpay(t, USER_A);
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		const row = await t.run(async (ctx) => ctx.db.get(retailer._id));
		// encryptSecret passthrough — the plaintext era, byte-identical.
		expect(row?.hitpay?.apiKey).toBe(SANDBOX_KEY);
		expect(row?.hitpay?.salt).toBe(SALT);
		expect(row?.hitpay?.apiKeyHint).toBe(SANDBOX_KEY.slice(-4));
		expect(row?.hitpay?.mode).toBe("sandbox");
		vi.useRealTimers();
	});
});
