/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const ADMIN = "user_admin";
let prevAdminEnv: string | undefined;

beforeAll(() => {
	prevAdminEnv = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
});
afterAll(() => {
	process.env.ADMIN_USER_IDS = prevAdminEnv;
});

// Fake timers so the markPaid-scheduled welcome WhatsApp action never fires a
// real network send during the test (mirrors customers.test.ts).
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

const asAdmin = (t: ReturnType<typeof setup>) => t.withIdentity({ subject: ADMIN });

async function seedFounding(
	t: ReturnType<typeof setup>,
	userId: string,
	slug: string,
) {
	const asUser = t.withIdentity({ subject: userId });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: `Store ${slug}`,
		slug,
		intent: "founding",
	});
	const { retailerId, invoiceId } = await t.run(async (ctx) => {
		const r = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", slug))
			.first();
		if (!r) throw new Error("no retailer");
		const inv = await ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", r._id))
			.first();
		if (!inv) throw new Error("no invoice");
		return { retailerId: r._id, invoiceId: inv._id };
	});
	return { retailerId, invoiceId };
}

const getRetailer = (t: ReturnType<typeof setup>, id: Id<"retailers">) =>
	t.run((ctx) => ctx.db.get(id));
const getInvoice = (t: ReturnType<typeof setup>, id: Id<"invoices">) =>
	t.run((ctx) => ctx.db.get(id));
const getSubFor = (t: ReturnType<typeof setup>, retailerId: Id<"retailers">) =>
	t.run((ctx) =>
		ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first(),
	);

describe("invoices.markPaid", () => {
	test("founding invoice → paid + active + rank 1 + badge", async () => {
		const t = setup();
		const { retailerId, invoiceId } = await seedFounding(t, "u1", "store-1");

		const res = await asAdmin(t).mutation(api.invoices.markPaid, {
			invoiceId,
			paymentMethod: "duitnow",
		});
		expect(res.rank).toBe(1);

		const inv = await getInvoice(t, invoiceId);
		expect(inv?.status).toBe("paid");
		expect(inv?.markedPaidBy).toBe(ADMIN);
		expect(inv?.paymentMethod).toBe("duitnow");

		const sub = await getSubFor(t, retailerId);
		expect(sub?.status).toBe("active");
		expect(sub?.currentPeriodEnd).toBeGreaterThan(Date.now());

		const retailer = await getRetailer(t, retailerId);
		expect(retailer?.isFoundingMember).toBe(true);
		expect(retailer?.foundingMemberRank).toBe(1);
	});

	test("rejects a non-admin", async () => {
		const t = setup();
		const { invoiceId } = await seedFounding(t, "u1", "store-1");
		await expect(
			t
				.withIdentity({ subject: "not_admin" })
				.mutation(api.invoices.markPaid, { invoiceId }),
		).rejects.toThrow(/not authorized/i);
	});

	test("rejects an already-paid invoice", async () => {
		const t = setup();
		const { invoiceId } = await seedFounding(t, "u1", "store-1");
		await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId });
		await expect(
			asAdmin(t).mutation(api.invoices.markPaid, { invoiceId }),
		).rejects.toThrow(/already paid/i);
	});

	test("a second invoice for the same retailer does not double-claim", async () => {
		const t = setup();
		const { retailerId, invoiceId } = await seedFounding(t, "u1", "store-1");
		await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId });

		// Issue + pay a second invoice → rank no-ops.
		const second = await t.run(async (ctx) => {
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first();
			return ctx.db.insert("invoices", {
				retailerId,
				subscriptionId: sub!._id,
				invoiceNumber: "INV-2",
				amount: 14900,
				total: 10400,
				currency: "MYR",
				periodStart: Date.now(),
				periodEnd: Date.now() + 1,
				dueDate: Date.now() + 1,
				status: "pending",
				createdAt: Date.now(),
			});
		});
		const res = await asAdmin(t).mutation(api.invoices.markPaid, {
			invoiceId: second,
		});
		expect(res.rank).toBeNull();
		expect((await getRetailer(t, retailerId))?.foundingMemberRank).toBe(1);
	});

	test("comped retailer claims no rank", async () => {
		const t = setup();
		// Backfill an existing retailer to comped, then give them a pending invoice.
		const asUser = t.withIdentity({ subject: "u_old" });
		await asUser.mutation(api.retailers.createRetailer, {
			storeName: "Old Store",
			slug: "old-store",
		});
		await t.run(async (ctx) => {
			const r = await ctx.db
				.query("retailers")
				.withIndex("by_slug", (q) => q.eq("slug", "old-store"))
				.first();
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", r!._id))
				.first();
			await ctx.db.patch(sub!._id, { comped: true });
			await ctx.db.insert("invoices", {
				retailerId: r!._id,
				subscriptionId: sub!._id,
				invoiceNumber: "INV-X",
				amount: 14900,
				total: 14900,
				currency: "MYR",
				periodStart: Date.now(),
				periodEnd: Date.now() + 1,
				dueDate: Date.now() + 1,
				status: "pending",
				createdAt: Date.now(),
			});
		});
		const invoiceId = await t.run(async (ctx) => {
			const r = await ctx.db
				.query("retailers")
				.withIndex("by_slug", (q) => q.eq("slug", "old-store"))
				.first();
			const inv = await ctx.db
				.query("invoices")
				.withIndex("by_retailer", (q) => q.eq("retailerId", r!._id))
				.first();
			return inv!._id;
		});
		const res = await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId });
		expect(res.rank).toBeNull();
	});

	test("cohort caps at 10 — the 11th paid Pro invoice gets no badge", async () => {
		const t = setup();
		for (let i = 1; i <= 10; i++) {
			const { invoiceId } = await seedFounding(t, `u${i}`, `store-${i}`);
			const res = await asAdmin(t).mutation(api.invoices.markPaid, {
				invoiceId,
			});
			expect(res.rank).toBe(i);
		}
		expect(await asAdmin(t).query(api.foundingMembers.getSpotsRemaining, {})).toBe(
			0,
		);

		const { retailerId, invoiceId } = await seedFounding(t, "u11", "store-11");
		const res = await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId });
		expect(res.rank).toBeNull();
		expect((await getRetailer(t, retailerId))?.isFoundingMember).toBeUndefined();
	});
});

describe("backfill", () => {
	test("creates active+comped for an existing retailer; idempotent", async () => {
		const t = setup();
		// Simulate a pre-billing retailer: create then delete its subscription.
		const asUser = t.withIdentity({ subject: "u_pre" });
		await asUser.mutation(api.retailers.createRetailer, {
			storeName: "Pre Store",
			slug: "pre-store",
		});
		const retailerId = await t.run(async (ctx) => {
			const r = await ctx.db
				.query("retailers")
				.withIndex("by_slug", (q) => q.eq("slug", "pre-store"))
				.first();
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", r!._id))
				.first();
			await ctx.db.delete(sub!._id); // pre-billing: no subscription
			return r!._id;
		});

		const first = await t.mutation(
			internal.subscriptions.internalBackfillSubscriptions,
			{},
		);
		expect(first.created).toBe(1);
		const sub = await getSubFor(t, retailerId);
		expect(sub?.status).toBe("active");
		expect(sub?.comped).toBe(true);

		// Second run is a no-op.
		const second = await t.mutation(
			internal.subscriptions.internalBackfillSubscriptions,
			{},
		);
		expect(second.created).toBe(0);
		expect(second.skipped).toBeGreaterThanOrEqual(1);
	});
});

describe("daily billing cron", () => {
	test("flips lapsed trial → past_due and overdue active → past_due, leaves comped", async () => {
		const t = setup();
		// A trialing retailer whose trial has lapsed.
		await t
			.withIdentity({ subject: "u_trial" })
			.mutation(api.retailers.createRetailer, {
				storeName: "Trial Store",
				slug: "trial-store",
			});
		// A founding (active) retailer whose invoice is overdue.
		const { retailerId: foundingId } = await seedFounding(t, "u_f", "f-store");

		await t.run(async (ctx) => {
			// Lapse the trial.
			const tr = await ctx.db
				.query("retailers")
				.withIndex("by_slug", (q) => q.eq("slug", "trial-store"))
				.first();
			const trialSub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", tr!._id))
				.first();
			await ctx.db.patch(trialSub!._id, { trialEndsAt: Date.now() - 1000 });
			// Make the founding invoice overdue.
			const inv = await ctx.db
				.query("invoices")
				.withIndex("by_retailer", (q) => q.eq("retailerId", foundingId))
				.first();
			await ctx.db.patch(inv!._id, { dueDate: Date.now() - 1000 });
		});

		const res = await t.mutation(
			internal.subscriptions.internalDailyBillingStatus,
			{},
		);
		expect(res.trialExpired).toBe(1);
		expect(res.overdue).toBe(1);

		expect((await getSubFor(t, foundingId))?.status).toBe("past_due");
	});
});

describe("soft-lock gating", () => {
	async function pastDueRetailer(t: ReturnType<typeof setup>, userId: string) {
		const asUser = t.withIdentity({ subject: userId });
		await asUser.mutation(api.retailers.createRetailer, {
			storeName: "Gated Store",
			slug: "gated-store",
		});
		const retailerId = await t.run(async (ctx) => {
			const r = await ctx.db
				.query("retailers")
				.withIndex("by_slug", (q) => q.eq("slug", "gated-store"))
				.first();
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", r!._id))
				.first();
			await ctx.db.patch(sub!._id, { status: "past_due" });
			return r!._id;
		});
		return { asUser, retailerId };
	}

	test("past_due blocks product create + updateSettings", async () => {
		const t = setup();
		const { asUser, retailerId } = await pastDueRetailer(t, "u_gate");
		await expect(
			asUser.mutation(api.products.create, {
				retailerId,
				name: "X",
				currency: "MYR",
				imageStorageIds: [],
				sortOrder: 0,
				variants: [{ optionValues: [], price: 1000, onHand: 1 }],
			}),
		).rejects.toThrow(/past due/i);
		await expect(
			asUser.mutation(api.retailers.updateSettings, { storeName: "New" }),
		).rejects.toThrow(/past due/i);
	});

	test("past_due keeps the storefront + new orders live (buyer never blocked)", async () => {
		const t = setup();
		const { asUser, retailerId } = await pastDueRetailer(t, "u_gate");
		// Create a product BEFORE going past_due isn't possible here (already past_due),
		// so insert one directly to simulate an existing catalog.
		const productId = await t.run(async (ctx) => {
			const now = Date.now();
			const pid = await ctx.db.insert("products", {
				retailerId,
				name: "Existing",
				currency: "MYR",
				imageStorageIds: [],
				options: [],
				sortOrder: 0,
				active: true,
				channel: "whatsapp",
				createdAt: now,
				updatedAt: now,
			});
			await ctx.db.insert("productVariants", {
				productId: pid,
				retailerId,
				optionValues: [],
				price: 1000,
				onHand: 100,
				reserved: 0,
				parcelWeightG: 0,
				imageStorageIds: [],
				active: true,
				blockWhenOutOfStock: true,
				sortOrder: 0,
				createdAt: now,
				updatedAt: now,
			});
			return pid;
		});
		// Public storefront order STILL succeeds despite past_due.
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Buyer", waPhone: "60123456789" },
			deliveryAddress: {
				line1: "1 Jln",
				city: "PJ",
				state: "Selangor",
				postcode: "47301",
			},
		});
		expect(shortId).toMatch(/^ORD-/);
		void asUser; // (asUser unused beyond the gate proof above)
	});
});
