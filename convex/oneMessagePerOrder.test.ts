/// <reference types="vite/client" />
/**
 * THE regression gate for one-message-per-order (86eyd63r8).
 *
 * Every other test in the suite checks that some particular message says the
 * right thing. This file checks the thing that is easy to break by accident and
 * expensive to get wrong: that an order sends the buyer **exactly one** outbound
 * WhatsApp, ever, whatever route it takes through the lifecycle.
 *
 * Counting method: we count SCHEDULED WhatsApp jobs, not fetch calls. The suite
 * runs on fake timers (see the beforeEach in whatsapp.test.ts) precisely so
 * `runAfter` jobs don't auto-fire, which means a fetch-counting test here would
 * always read zero and pass vacuously. `_scheduled_functions` is the honest
 * signal: it records the intent to message regardless of whether the action ran.
 *
 * If you add a buyer-facing WhatsApp send, one of these tests SHOULD go red.
 * That is the point — put the information on the tracking page instead.
 *
 * The one sanctioned exception is the seller's MANUAL payment reminder
 * (day 11–14, once per 24h, human tap only — convex/manualPaymentReminder
 * .test.ts owns it). It never appears here because nothing ever schedules it.
 * See docs/one-message-per-order.md.
 */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const USER = "user_one_msg";
const TEMPLATE = "order_confirmation_utility";
const BUYER = "60123456789";

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

beforeEach(() => {
	vi.useFakeTimers();
	process.env.WHATSAPP_ORDER_CONFIRM_TEMPLATE = TEMPLATE;
	// Credentials must be present or the adapter throws before it ever reaches
	// `fetch` — which would make every "asserted no message was sent" test below
	// pass for the wrong reason.
	process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
	process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-id";
	process.env.RESEND_API_KEY = "test-resend";
	process.env.EMAIL_FROM = "Kedaipal <orders@kedaipal.test>";
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	delete process.env.WHATSAPP_ORDER_CONFIRM_TEMPLATE;
});

/**
 * Sends that are NOT governed by one-message-per-order, each for a stated
 * reason. Everything else in the `whatsapp:` module counts as a buyer message.
 *
 * Keeping this as a subtraction (rather than an allow-list of known buyer
 * sends) is deliberate: a newly added `notifyWhatever` trips the gate without
 * anyone remembering to update this helper. Adding a name here is a conscious
 * act that should be argued for in review.
 */
const NOT_BUYER_SENDS = [
	// The webhook entry point — it *reacts* to the buyer messaging us rather
	// than pushing to them. Its reply is asserted separately below.
	"handleInbound",
	// Seller alerts (86eyhw9zy) go to the RETAILER's own number, not the
	// buyer's. The policy caps what we push at a customer; a seller opting in
	// to be pinged about their own shop is a different budget and a different
	// consent. See docs/order-notifications.md.
	"notifySellerNewOrder",
	"notifySellerPaymentClaim",
	// Not order-scoped at all — a one-time welcome to a founding seller.
	"notifyFoundingWelcome",
	// Seller-DRIVEN, one human tap per send, window-boxed to days 11–14
	// (docs/payment-reminder.md). Nothing schedules it; it only ever appears
	// here if someone automates it, which is exactly what must not happen —
	// so it is asserted absent in its own suite rather than excused here.
] as const;

/** Every scheduled job that would put a message on the BUYER's WhatsApp. */
async function waJobs(t: ReturnType<typeof setup>): Promise<string[]> {
	const jobs = await t.run((ctx) =>
		ctx.db.system.query("_scheduled_functions").collect(),
	);
	return jobs
		.map((j) => j.name)
		.filter(
			(n) =>
				n.startsWith("whatsapp") &&
				!NOT_BUYER_SENDS.some((excluded) => n.includes(excluded)),
		);
}

/** Seller-facing alert jobs — the counterpart to `waJobs`. */
async function sellerAlertJobs(
	t: ReturnType<typeof setup>,
): Promise<string[]> {
	const jobs = await t.run((ctx) =>
		ctx.db.system.query("_scheduled_functions").collect(),
	);
	return jobs.map((j) => j.name).filter((n) => n.includes("notifySeller"));
}

async function seedStore(t: ReturnType<typeof setup>, slug: string) {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Cake Studio",
		slug,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer._id;
}

async function seedProduct(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	opts: { requiresProof?: boolean } = {},
) {
	return await t.withIdentity({ subject: USER }).mutation(api.products.create, {
		retailerId,
		name: opts.requiresProof ? "Custom Cake" : "Tent 2P",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		requiresProof: opts.requiresProof ?? false,
		variants: [{ optionValues: [], price: opts.requiresProof ? 0 : 12000, onHand: 100 }],
	});
}

async function placeOrder(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	productId: Id<"products">,
) {
	const { shortId } = await t.mutation(api.orders.create, {
		retailerId,
		items: [{ productId, quantity: 1 }],
		currency: "MYR",
		channel: "whatsapp",
		customer: { name: "Ali", waPhone: BUYER },
		deliveryAddress: {
			line1: "12 Jln Mawar 3",
			city: "Petaling Jaya",
			state: "Selangor",
			postcode: "47301",
		},
	});
	const orderId = await t.run(async (ctx) => {
		const o = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		if (!o) throw new Error("order missing");
		return o._id;
	});
	return { shortId, orderId };
}

async function tokenOf(t: ReturnType<typeof setup>, orderId: Id<"orders">) {
	return await t.run(async (ctx) => {
		const o = await ctx.db.get(orderId);
		if (o?.trackingToken) return o.trackingToken;
		await ctx.db.patch(orderId, { trackingToken: "tok_one_message_test" });
		return "tok_one_message_test";
	});
}

describe("one message per order — the whole lifecycle", () => {
	test("a plain order sends once at checkout and never again", async () => {
		const t = setup();
		const asUser = t.withIdentity({ subject: USER });
		const retailerId = await seedStore(t, "plain");
		const productId = await seedProduct(t, retailerId);
		const { orderId } = await placeOrder(t, retailerId, productId);

		// The one message is scheduled at create, with a final total.
		expect(await waJobs(t)).toEqual([
			"whatsapp:notifyStorefrontOrderCreated",
		]);

		// Now walk the ENTIRE rest of the lifecycle. None of it may message.
		for (const status of ["packed", "shipped", "delivered"] as const) {
			await asUser.mutation(api.orders.updateStatus, { orderId, status });
		}
		await asUser.mutation(api.orders.markPaymentReceived, { orderId });

		expect(await waJobs(t)).toEqual([
			"whatsapp:notifyStorefrontOrderCreated",
		]);
	});

	test("cancelling is silent — the buyer is never told over WhatsApp", async () => {
		const t = setup();
		const asUser = t.withIdentity({ subject: USER });
		const retailerId = await seedStore(t, "cancels");
		const productId = await seedProduct(t, retailerId);
		const { orderId } = await placeOrder(t, retailerId, productId);
		const before = await waJobs(t);

		await asUser.mutation(api.orders.updateStatus, {
			orderId,
			status: "cancelled",
		});

		expect(await waJobs(t)).toEqual(before);
	});

	test("the seller's own alerts still fire — they are not the buyer's budget", async () => {
		// Guards the exclusion in NOT_BUYER_SENDS from becoming a blind spot: if
		// someone deletes the seller alerts, waJobs would stay green while the
		// feature silently vanished. Assert them positively instead.
		const t = setup();
		const asUser = t.withIdentity({ subject: USER });
		const retailerId = await seedStore(t, "seller-alerts");
		const productId = await seedProduct(t, retailerId);
		const { orderId } = await placeOrder(t, retailerId, productId);

		expect(await sellerAlertJobs(t)).toEqual([
			"whatsapp:notifySellerNewOrder",
		]);
		// …and the buyer's single message is unaffected by it.
		expect(await waJobs(t)).toEqual(["whatsapp:notifyStorefrontOrderCreated"]);

		// The buyer says they've paid → the seller's second alert.
		await t.mutation(api.orders.claimPayment, {
			token: await tokenOf(t, orderId),
		});

		expect(await sellerAlertJobs(t)).toEqual([
			"whatsapp:notifySellerNewOrder",
			"whatsapp:notifySellerPaymentClaim",
		]);
		expect(await waJobs(t)).toEqual(["whatsapp:notifyStorefrontOrderCreated"]);
		// Nothing about the seller being pinged reaches the buyer.
		await asUser.mutation(api.orders.markPaymentReceived, { orderId });
		expect(await waJobs(t)).toEqual(["whatsapp:notifyStorefrontOrderCreated"]);
	});

	test("advancing through custom stages messages nobody", async () => {
		const t = setup();
		const asUser = t.withIdentity({ subject: USER });
		const retailerId = await seedStore(t, "stages");
		// Two stages inside the packed band — the shape that used to fire a
		// per-stage ping for every move.
		await asUser.mutation(api.retailers.updateSettings, {
			orderStages: [
				{ anchor: "confirmed", label: { en: "Accepted" } },
				{ anchor: "packed", label: { en: "Baking" } },
				{ anchor: "packed", label: { en: "Decorating" } },
				{ anchor: "delivered", label: { en: "Collected" } },
			],
		});
		const stages = (await asUser.query(api.retailers.getMyRetailer))
			?.orderStages;
		if (!stages) throw new Error("stages missing");
		const productId = await seedProduct(t, retailerId);
		const { orderId } = await placeOrder(t, retailerId, productId);
		const before = await waJobs(t);

		for (const stage of stages) {
			await asUser.mutation(api.orders.advanceToStage, {
				orderId,
				stageId: stage.id,
			});
		}

		expect(await waJobs(t)).toEqual(before);
	});
});

describe("one message per order — made-to-order fires at SUBMIT", () => {
	async function seedCustomOrder(t: ReturnType<typeof setup>, slug: string) {
		const retailerId = await seedStore(t, slug);
		const productId = await seedProduct(t, retailerId, { requiresProof: true });
		return await placeOrder(t, retailerId, productId);
	}

	test("nothing is sent at checkout — the price isn't known yet", async () => {
		const t = setup();
		const { orderId } = await seedCustomOrder(t, "custom-defer");

		expect(await waJobs(t)).toEqual([]);
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.confirmationPushStatus).toBe("deferred");
		expect(order?.mockupStatus).toBe("pending");
	});

	test("submitting the mockup with a quote sends the one message", async () => {
		const t = setup();
		const asUser = t.withIdentity({ subject: USER });
		const { orderId } = await seedCustomOrder(t, "custom-submit");

		await asUser.mutation(api.orders.submitMockup, {
			orderId,
			storageIds: ["mock1"],
			quotedAmount: 18000,
		});

		expect(await waJobs(t)).toEqual([
			"whatsapp:notifyStorefrontOrderCreated",
		]);
		const order = await t.run((ctx) => ctx.db.get(orderId));
		// Claimed → the total the template will quote is the real one.
		expect(order?.confirmationPushStatus).toBe("sending");
		expect(order?.total).toBe(18000);
	});

	test("approval after submit does NOT send a second message", async () => {
		const t = setup();
		const asUser = t.withIdentity({ subject: USER });
		const { orderId } = await seedCustomOrder(t, "custom-approve");
		await asUser.mutation(api.orders.submitMockup, {
			orderId,
			storageIds: ["mock1"],
			quotedAmount: 18000,
		});
		const afterSubmit = await waJobs(t);

		await t.mutation(api.orders.approveMockup, {
			token: await tokenOf(t, orderId),
		});

		expect(await waJobs(t)).toEqual(afterSubmit);
		expect(afterSubmit).toHaveLength(1);
	});

	test("a change-request round trip still only ever sends once", async () => {
		const t = setup();
		const asUser = t.withIdentity({ subject: USER });
		const { orderId } = await seedCustomOrder(t, "custom-changes");
		const token = await tokenOf(t, orderId);

		await asUser.mutation(api.orders.submitMockup, {
			orderId,
			storageIds: ["v1"],
			quotedAmount: 18000,
		});
		await t.mutation(api.orders.requestMockupChanges, {
			token,
			note: "More pink please",
		});
		// Second round, re-priced — the buyer sees the new total on the page, and
		// gets no new message (the claim can only be won once).
		await asUser.mutation(api.orders.submitMockup, {
			orderId,
			storageIds: ["v2"],
			quotedAmount: 21000,
		});
		await t.mutation(api.orders.approveMockup, { token });

		expect(await waJobs(t)).toEqual([
			"whatsapp:notifyStorefrontOrderCreated",
		]);
	});

	test("a waiver settles the price too — a never-approved order still sends once", async () => {
		const t = setup();
		const asUser = t.withIdentity({ subject: USER });
		const { orderId } = await seedCustomOrder(t, "custom-waive");
		await asUser.mutation(api.orders.submitMockup, {
			orderId,
			storageIds: ["v1"],
			quotedAmount: 18000,
		});
		// 48h later the buyer still hasn't replied and the seller proceeds.
		await t.run(async (ctx) => {
			await ctx.db.patch(orderId, {
				mockupSubmittedAt: Date.now() - 49 * 60 * 60 * 1000,
			});
		});

		await asUser.mutation(api.orders.waiveMockup, { orderId });

		expect(await waJobs(t)).toEqual([
			"whatsapp:notifyStorefrontOrderCreated",
		]);
	});
});

describe("one message per order — the inbound reply can't double up", () => {
	test("an ORD- message on an order whose push already went out is silent", async () => {
		const t = setup();
		const fetchCalls: string[] = [];
		const original = globalThis.fetch;
		globalThis.fetch = vi.fn(async (url: unknown) => {
			fetchCalls.push(String(url));
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;

		try {
			const retailerId = await seedStore(t, "inbound-sent");
			const productId = await seedProduct(t, retailerId);
			const { shortId, orderId } = await placeOrder(t, retailerId, productId);
			// The push landed.
			await t.run((ctx) =>
				ctx.db.patch(orderId, { confirmationPushStatus: "sent" }),
			);

			// Buyer taps an old `?send=1` link / forwards the order message.
			await t.action(internal.whatsapp.handleInbound, {
				fromPhone: BUYER,
				text: shortId,
			});

			expect(fetchCalls.filter((u) => u.includes("graph.facebook.com"))).toEqual(
				[],
			);
		} finally {
			globalThis.fetch = original;
		}
	});

	test("a FAILED push still replies — that reply is the buyer's one message", async () => {
		const t = setup();
		const fetchCalls: string[] = [];
		const original = globalThis.fetch;
		globalThis.fetch = vi.fn(async (url: unknown) => {
			fetchCalls.push(String(url));
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;

		try {
			const retailerId = await seedStore(t, "inbound-failed");
			const productId = await seedProduct(t, retailerId);
			const { shortId, orderId } = await placeOrder(t, retailerId, productId);
			await t.run((ctx) =>
				ctx.db.patch(orderId, {
					confirmationPushStatus: "failed",
					confirmationPushFailureKind: "unreachable",
				}),
			);

			await t.action(internal.whatsapp.handleInbound, {
				fromPhone: BUYER,
				text: shortId,
			});

			expect(
				fetchCalls.filter((u) => u.includes("graph.facebook.com")),
			).toHaveLength(1);
			// ...and the recovery stamp landed, so a second inbound stays quiet.
			const order = await t.run((ctx) => ctx.db.get(orderId));
			expect(order?.confirmationPushStatus).toBe("recovered");
		} finally {
			globalThis.fetch = original;
		}
	});

	test("with no template configured the inbound reply IS the one message", async () => {
		delete process.env.WHATSAPP_ORDER_CONFIRM_TEMPLATE;
		const t = setup();
		const fetchCalls: string[] = [];
		const original = globalThis.fetch;
		globalThis.fetch = vi.fn(async (url: unknown) => {
			fetchCalls.push(String(url));
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;

		try {
			const retailerId = await seedStore(t, "legacy");
			const productId = await seedProduct(t, retailerId);
			const { shortId, orderId } = await placeOrder(t, retailerId, productId);
			// Legacy path: no push was ever stamped, so nothing is scheduled...
			const order = await t.run((ctx) => ctx.db.get(orderId));
			expect(order?.confirmationPushStatus).toBeUndefined();
			expect(await waJobs(t)).toEqual([]);

			// ...and the buyer's own ORD- send earns them their single reply.
			await t.action(internal.whatsapp.handleInbound, {
				fromPhone: BUYER,
				text: shortId,
			});

			expect(
				fetchCalls.filter((u) => u.includes("graph.facebook.com")),
			).toHaveLength(1);
		} finally {
			globalThis.fetch = original;
		}
	});
});
