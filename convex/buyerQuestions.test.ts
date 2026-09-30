/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { BuyerQuestionInput } from "./lib/buyerQuestions";
import { DAY_MS, todayMytMidnight } from "./lib/fulfilmentDate";
import { ordersToCsv } from "./lib/orderCsv";
import schema from "./schema";

/**
 * Buyer questions (`z8r3fdkjek`) across every door that creates an order:
 * the storefront (`orders.create`, RSVP + cart), the counter, and claim links.
 * One file for the same reason as eventRsvp.test.ts — the feature is one story
 * told across products, orders, counterCheckout and orderClaims.
 */

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER = "user_hcm";
const customer = { name: "Wilson Tan", waPhone: "60123456789" };
const EVENT_DATE = todayMytMidnight() + 9 * DAY_MS;

// Helinox Community Malaysia's Into The Falls registration — the pair the
// feature was built for. Ids are the form's minted keys.
const HCM: BuyerQuestionInput[] = [
	{
		id: "bring001",
		label: "What are you bringing?",
		type: "choice",
		options: ["2 Helinox furniture", "Helinox tent"],
		required: true,
	},
	{
		id: "tent0001",
		label: "Tent model",
		type: "text",
		required: true,
		showWhen: { questionId: "bring001", option: "Helinox tent" },
	},
];

async function seedStore(t: ReturnType<typeof setup>) {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Helinox Community",
		slug: "hcm",
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	await asUser.mutation(api.retailers.updateSettings, { offerSelfCollect: true });
	const { pickupLocationId } = await asUser.mutation(api.pickupLocations.create, {
		retailerId: retailer._id,
		label: "Sungai Chiling",
		address: "Kuala Kubu Bharu, Selangor",
	});
	return { asUser, retailer, pickupLocationId };
}

async function seedProduct(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	opts: { event?: boolean; questions?: BuyerQuestionInput[]; name?: string } = {},
) {
	const productId = await t.withIdentity({ subject: USER }).mutation(
		api.products.create,
		{
			retailerId,
			name: opts.name ?? "Into The Falls 2026 Registration",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			event: opts.event === false ? undefined : { date: EVENT_DATE },
			buyerQuestions: opts.questions ?? HCM,
			variants: [{ optionValues: [], price: 15000, onHand: 0 }],
		},
	);
	const variantId = await t.run(async (ctx) => {
		const row = await ctx.db
			.query("productVariants")
			.withIndex("by_product", (q) => q.eq("productId", productId))
			.first();
		if (!row) throw new Error("variant missing");
		return row._id;
	});
	return { productId, variantId };
}

function register(
	t: ReturnType<typeof setup>,
	args: {
		retailerId: Id<"retailers">;
		variantId: Id<"productVariants">;
		pickupLocationId: Id<"pickupLocations">;
		quantity?: number;
		answers?: { questionId: string; answer: string }[];
	},
) {
	return t.mutation(api.orders.create, {
		retailerId: args.retailerId,
		items: [
			{
				variantId: args.variantId,
				quantity: args.quantity ?? 1,
				answers: args.answers,
			},
		],
		currency: "MYR",
		channel: "whatsapp",
		customer,
		deliveryMethod: "self_collect",
		pickupLocationId: args.pickupLocationId,
	});
}

async function orderByShortId(t: ReturnType<typeof setup>, shortId: string) {
	const order = await t.run((ctx) =>
		ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first(),
	);
	if (!order) throw new Error("order missing");
	return order;
}

describe("products — saving questions", () => {
	test("questions are sanitised and stored; [] on update clears them", async () => {
		const t = setup();
		const { asUser, retailer } = await seedStore(t);
		const { productId } = await seedProduct(t, retailer._id);
		const stored = await t.run((ctx) => ctx.db.get(productId));
		expect(stored?.buyerQuestions?.map((q) => q.label)).toEqual([
			"What are you bringing?",
			"Tent model",
		]);
		expect(stored?.buyerQuestions?.[1].showWhen).toEqual({
			questionId: "bring001",
			option: "Helinox tent",
		});

		await asUser.mutation(api.products.update, {
			productId,
			buyerQuestions: [],
		});
		expect((await t.run((ctx) => ctx.db.get(productId)))?.buyerQuestions).toBe(
			undefined,
		);
	});

	test("a seller-facing refusal comes back verbatim", async () => {
		const t = setup();
		const { asUser, retailer } = await seedStore(t);
		await expect(
			asUser.mutation(api.products.create, {
				retailerId: retailer._id,
				name: "Cake",
				currency: "MYR",
				imageStorageIds: [],
				sortOrder: 0,
				buyerQuestions: [
					{ label: "Spice", type: "choice", options: ["Only one"] },
				],
				variants: [{ optionValues: [], price: 100, onHand: 0 }],
			}),
		).rejects.toThrow(/2 to 6 options/);
	});

	test("a booking listing can't carry questions — it has no line to answer on", async () => {
		const t = setup();
		const { asUser, retailer } = await seedStore(t);
		await expect(
			asUser.mutation(api.products.create, {
				retailerId: retailer._id,
				name: "Riverside Plot",
				currency: "MYR",
				imageStorageIds: [],
				sortOrder: 0,
				kind: "booking" as const,
				booking: { capacityPerNight: 1 },
				buyerQuestions: HCM,
				variants: [{ optionValues: [], price: 8000, onHand: 0 }],
			}),
		).rejects.toThrow(/booking listing/);
	});

	test("the public storefront read carries the questions", async () => {
		const t = setup();
		const { retailer } = await seedStore(t);
		await seedProduct(t, retailer._id);
		const list = await t.query(api.products.list, { retailerId: retailer._id });
		expect(list[0].buyerQuestions?.map((q) => q.id)).toEqual([
			"bring001",
			"tent0001",
		]);
	});
});

describe("orders.create — the storefront door", () => {
	test("answers freeze onto the line with their labels", async () => {
		const t = setup();
		const { retailer, pickupLocationId } = await seedStore(t);
		const { variantId } = await seedProduct(t, retailer._id);
		const { shortId } = await register(t, {
			retailerId: retailer._id,
			variantId,
			pickupLocationId,
			answers: [
				{ questionId: "bring001", answer: "Helinox tent" },
				{ questionId: "tent0001", answer: "  Tactical One  " },
			],
		});
		const order = await orderByShortId(t, shortId);
		expect(order.items[0].answers).toEqual([
			{
				questionId: "bring001",
				label: "What are you bringing?",
				answer: "Helinox tent",
			},
			{ questionId: "tent0001", label: "Tent model", answer: "Tactical One" },
		]);
	});

	test("a missing required answer is refused, naming the question", async () => {
		const t = setup();
		const { retailer, pickupLocationId } = await seedStore(t);
		const { variantId } = await seedProduct(t, retailer._id);
		await expect(
			register(t, { retailerId: retailer._id, variantId, pickupLocationId }),
		).rejects.toThrow(/Please answer “What are you bringing\?”/);
		await expect(
			register(t, {
				retailerId: retailer._id,
				variantId,
				pickupLocationId,
				answers: [{ questionId: "bring001", answer: "Helinox tent" }],
			}),
		).rejects.toThrow(/“Tent model”/);
	});

	test("a hidden conditional answer and an unknown questionId are dropped, not stored", async () => {
		const t = setup();
		const { retailer, pickupLocationId } = await seedStore(t);
		const { variantId } = await seedProduct(t, retailer._id);
		const { shortId } = await register(t, {
			retailerId: retailer._id,
			variantId,
			pickupLocationId,
			answers: [
				{ questionId: "bring001", answer: "2 Helinox furniture" },
				{ questionId: "tent0001", answer: "Tactical One" },
				{ questionId: "gone0001", answer: "stale tab" },
			],
		});
		const order = await orderByShortId(t, shortId);
		expect(order.items[0].answers?.map((a) => a.questionId)).toEqual([
			"bring001",
		]);
	});

	test("a product with no questions stores no answers field at all", async () => {
		const t = setup();
		const { retailer, pickupLocationId } = await seedStore(t);
		const { variantId } = await seedProduct(t, retailer._id, {
			questions: [],
		});
		const { shortId } = await register(t, {
			retailerId: retailer._id,
			variantId,
			pickupLocationId,
			answers: [{ questionId: "bring001", answer: "Helinox tent" }],
		});
		const order = await orderByShortId(t, shortId);
		expect("answers" in order.items[0]).toBe(false);
	});

	test("rewording a question after an order never rewrites what the buyer answered", async () => {
		const t = setup();
		const { asUser, retailer, pickupLocationId } = await seedStore(t);
		const { productId, variantId } = await seedProduct(t, retailer._id);
		const { shortId } = await register(t, {
			retailerId: retailer._id,
			variantId,
			pickupLocationId,
			answers: [{ questionId: "bring001", answer: "2 Helinox furniture" }],
		});
		await asUser.mutation(api.products.update, {
			productId,
			buyerQuestions: [
				{ ...HCM[0], label: "Your gear", options: ["Chairs", "Helinox tent"] },
			],
		});
		const order = await orderByShortId(t, shortId);
		expect(order.items[0].answers).toEqual([
			{
				questionId: "bring001",
				label: "What are you bringing?",
				answer: "2 Helinox furniture",
			},
		]);
	});

	test("the CSV carries an Answers column", async () => {
		const t = setup();
		const { retailer, pickupLocationId } = await seedStore(t);
		const { variantId } = await seedProduct(t, retailer._id);
		const { shortId } = await register(t, {
			retailerId: retailer._id,
			variantId,
			pickupLocationId,
			answers: [
				{ questionId: "bring001", answer: "Helinox tent" },
				{ questionId: "tent0001", answer: "Tactical One" },
			],
		});
		const order = await orderByShortId(t, shortId);
		const csv = ordersToCsv([
			{ ...order, customer: order.customer ?? {}, items: order.items },
		] as never);
		expect(csv).toContain("Answers");
		expect(csv).toContain(
			"What are you bringing?: Helinox tent; Tent model: Tactical One",
		);
	});
});

describe("the RSVPs panel tally", () => {
	test("choice answers are counted per seat, cancelled RSVPs excluded, text questions left out", async () => {
		const t = setup();
		const { asUser, retailer, pickupLocationId } = await seedStore(t);
		const { productId, variantId } = await seedProduct(t, retailer._id);
		const tent = [
			{ questionId: "bring001", answer: "Helinox tent" },
			{ questionId: "tent0001", answer: "Tactical One" },
		];
		await register(t, {
			retailerId: retailer._id,
			variantId,
			pickupLocationId,
			quantity: 2,
			answers: tent,
		});
		await register(t, {
			retailerId: retailer._id,
			variantId,
			pickupLocationId,
			answers: [{ questionId: "bring001", answer: "2 Helinox furniture" }],
		});
		const { shortId } = await register(t, {
			retailerId: retailer._id,
			variantId,
			pickupLocationId,
			answers: tent,
		});
		const cancelled = await orderByShortId(t, shortId);
		await asUser.mutation(api.orders.updateStatus, {
			orderId: cancelled._id,
			status: "cancelled",
		});

		const head = await asUser.query(api.products.eventHeadcount, { productId });
		expect(head?.questions).toEqual([
			{
				questionId: "bring001",
				label: "What are you bringing?",
				options: [
					{ label: "2 Helinox furniture", seats: 1 },
					{ label: "Helinox tent", seats: 2 },
				],
			},
		]);
	});

	test("an option renamed after guests picked it still counts under the name they picked", async () => {
		const t = setup();
		const { asUser, retailer, pickupLocationId } = await seedStore(t);
		const { productId, variantId } = await seedProduct(t, retailer._id);
		await register(t, {
			retailerId: retailer._id,
			variantId,
			pickupLocationId,
			answers: [{ questionId: "bring001", answer: "2 Helinox furniture" }],
		});
		await asUser.mutation(api.products.update, {
			productId,
			buyerQuestions: [{ ...HCM[0], options: ["Chairs", "Helinox tent"] }],
		});
		const head = await asUser.query(api.products.eventHeadcount, { productId });
		expect(head?.questions[0].options).toEqual([
			{ label: "Chairs", seats: 0 },
			{ label: "Helinox tent", seats: 0 },
			{ label: "2 Helinox furniture", seats: 1 },
		]);
	});
});

describe("the counter and claim-link doors", () => {
	async function walkIn(t: ReturnType<typeof setup>) {
		const { sessionId } = await t
			.withIdentity({ subject: USER })
			.mutation(api.counterCheckout.bindSessionManualPhone, {
				waPhone: "60129998888",
				name: "Aina Hamzah",
			});
		return sessionId;
	}

	test("the seller answers for the walk-in; required is still enforced", async () => {
		const t = setup();
		const { retailer } = await seedStore(t);
		const { variantId } = await seedProduct(t, retailer._id, {
			event: false,
			name: "Birthday cake",
			questions: [
				{
					id: "msg00001",
					label: "Message on the cake",
					type: "text",
					required: true,
				},
			],
		});
		const asUser = t.withIdentity({ subject: USER });
		const sessionId = await walkIn(t);
		await expect(
			asUser.mutation(api.counterCheckout.createOrderFromSession, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				paidInPerson: true,
				paymentMethod: "cash",
			}),
		).rejects.toThrow(/“Message on the cake”/);

		const { orderId } = await asUser.mutation(
			api.counterCheckout.createOrderFromSession,
			{
				sessionId,
				items: [
					{
						variantId,
						quantity: 1,
						answers: [{ questionId: "msg00001", answer: "Happy 40th Kak Long" }],
					},
				],
				paidInPerson: true,
				paymentMethod: "cash",
			},
		);
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.items[0].answers).toEqual([
			{
				questionId: "msg00001",
				label: "Message on the cake",
				answer: "Happy 40th Kak Long",
			},
		]);
	});

	test("the counter draft round-trips answers", async () => {
		const t = setup();
		const { retailer } = await seedStore(t);
		const { variantId } = await seedProduct(t, retailer._id, { event: false });
		const sessionId = await walkIn(t);
		await t
			.withIdentity({ subject: USER })
			.mutation(api.counterCheckout.saveSessionDraft, {
				sessionId,
				draft: {
					items: [
						{
							variantId,
							quantity: 1,
							answers: [{ questionId: "bring001", answer: "Helinox tent" }],
						},
					],
				},
			});
		const session = await t.run((ctx) => ctx.db.get(sessionId));
		expect(session?.draft?.items[0].answers).toEqual([
			{ questionId: "bring001", answer: "Helinox tent" },
		]);
	});

	test("a claim link freezes the seller's answers and the order inherits them", async () => {
		const t = setup();
		const { retailer, pickupLocationId } = await seedStore(t);
		const { variantId } = await seedProduct(t, retailer._id, {
			event: false,
			name: "Birthday cake",
			questions: [
				{ id: "msg00001", label: "Message on the cake", type: "text" },
			],
		});
		const sessionId = await walkIn(t);
		const { claimId, token } = await t
			.withIdentity({ subject: USER })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [
					{
						variantId,
						quantity: 1,
						answers: [{ questionId: "msg00001", answer: "Selamat Hari Raya" }],
					},
				],
				windowMinutes: 15,
			});
		const claim = await t.run((ctx) => ctx.db.get(claimId));
		expect(claim?.lines[0].answers?.[0].answer).toBe("Selamat Hari Raya");

		await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "self_collect",
			pickupLocationId,
		});
		const order = await t.run(async (ctx) => {
			const c = await ctx.db.get(claimId);
			return c?.orderId ? ctx.db.get(c.orderId) : null;
		});
		expect(order?.items[0].answers).toEqual([
			{
				questionId: "msg00001",
				label: "Message on the cake",
				answer: "Selamat Hari Raya",
			},
		]);
	});
});
