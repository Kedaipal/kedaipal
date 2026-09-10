/// <reference types="vite/client" />
// Start-when-you-sell (z8r3fday24): a store is free until its FIRST LIVE ORDER
// or the day-14 backstop, whichever comes first; that moment issues the first
// invoice, and only that invoice going overdue locks. See
// docs/manual-subscription.md.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { recordOrderCreated } from "./subscriptionUsage";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const ADMIN = "user_sws_admin";
const DAY = 24 * 60 * 60 * 1000;
let prevAdminEnv: string | undefined;

// Fake timers so scheduled follow-ups (Pay-now mint, emails, PDFs) never fire a
// real network call — the mutations under test are invoked directly.
beforeEach(() => {
	vi.useFakeTimers();
	prevAdminEnv = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	process.env.ADMIN_USER_IDS = prevAdminEnv;
});

const customer = { name: "Aisha", waPhone: "60123456789" };
const validAddress = {
	line1: "12 Jln Mawar 3",
	city: "Petaling Jaya",
	state: "Selangor",
	postcode: "47301",
};

async function seedRetailer(
	t: ReturnType<typeof setup>,
	userId: string,
	opts: { country?: "MY" | "SG" } = {},
) {
	const asUser = t.withIdentity({ subject: userId });
	const slug = `sws-${userId.replace(/[^a-z0-9]/g, "")}`;
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: `Store ${slug}`,
		slug,
		...(opts.country ? { country: opts.country } : {}),
	});
	return t.run(async (ctx) => {
		const r = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", slug))
			.first();
		if (!r) throw new Error("no retailer");
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", r._id))
			.first();
		if (!sub) throw new Error("no sub");
		return { retailerId: r._id, subId: sub._id, userId };
	});
}

async function seedProduct(
	t: ReturnType<typeof setup>,
	userId: string,
	retailerId: Id<"retailers">,
	currency: "MYR" | "SGD" = "MYR",
): Promise<Id<"products">> {
	return t.withIdentity({ subject: userId }).mutation(api.products.create, {
		retailerId,
		name: "Kuih Box",
		currency,
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: false,
		requiresProof: false,
		variants: [{ optionValues: [], price: 2500, onHand: 100 }],
	});
}

/** A buyer places a storefront order — the public, unauthenticated path. */
async function placeOrder(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	productId: Id<"products">,
	currency: "MYR" | "SGD" = "MYR",
) {
	return t.mutation(api.orders.create, {
		retailerId,
		items: [{ productId, quantity: 1 }],
		currency,
		channel: "whatsapp",
		// The store's country judges the buyer's number (SG-lite).
		customer:
			currency === "SGD" ? { name: "Wei", waPhone: "6591234567" } : customer,
		deliveryAddress:
			currency === "SGD"
				? { line1: "1 Marina Blvd", city: "Singapore", state: "Singapore", postcode: "018989" }
				: validAddress,
	});
}

const getSub = (t: ReturnType<typeof setup>, id: Id<"subscriptions">) =>
	t.run((ctx) => ctx.db.get(id));
const invoicesFor = (t: ReturnType<typeof setup>, retailerId: Id<"retailers">) =>
	t.run((ctx) =>
		ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.collect(),
	);

describe("first live order ends the free period", () => {
	test("storefront order → free period ended (first_order), status stays trialing, backstop untouched; first invoice bills the trialed tier", async () => {
		const t = setup();
		const { retailerId, subId, userId } = await seedRetailer(t, "u_first");
		const before = await getSub(t, subId);
		const productId = await seedProduct(t, userId, retailerId);

		await placeOrder(t, retailerId, productId);

		const sub = await getSub(t, subId);
		expect(sub?.status).toBe("trialing");
		expect(sub?.freePeriodEndReason).toBe("first_order");
		expect(sub?.freePeriodEndedAt).toBeTypeOf("number");
		// The backstop deadline is a fact, not pulled forward; and no status
		// flipped, so updatedAt (the flip moment) is untouched.
		expect(sub?.trialEndsAt).toBe(before?.trialEndsAt);
		expect(sub?.updatedAt).toBe(before?.updatedAt);

		// The trigger schedules the issuance; run it directly (fake timers hold
		// scheduled functions) and inspect the bill.
		const issued = await t.mutation(internal.invoices.internalIssueFirstInvoice, {
			subscriptionId: subId,
		});
		expect(issued.issued).toBe(true);
		const invoices = await invoicesFor(t, retailerId);
		expect(invoices).toHaveLength(1);
		expect(invoices[0]).toMatchObject({
			status: "pending",
			origin: "free_period_end",
			plan: "pro", // every trial showcases Pro; switchable before paying
			billingCycle: "monthly",
			total: 14900,
			currency: "MYR",
		});
		expect(invoices[0]?.foundingDiscount).toBeUndefined();
		// 14-day grace, like every invoice.
		expect(invoices[0]!.dueDate - Date.now()).toBeGreaterThan(13.9 * DAY);
	});

	test("a second order changes nothing, and a second issue call is a no-op", async () => {
		const t = setup();
		const { retailerId, subId, userId } = await seedRetailer(t, "u_twice");
		const productId = await seedProduct(t, userId, retailerId);
		await placeOrder(t, retailerId, productId);
		const first = await getSub(t, subId);
		await t.mutation(internal.invoices.internalIssueFirstInvoice, {
			subscriptionId: subId,
		});

		await placeOrder(t, retailerId, productId);
		expect((await getSub(t, subId))?.freePeriodEndedAt).toBe(
			first?.freePeriodEndedAt,
		);
		const again = await t.mutation(internal.invoices.internalIssueFirstInvoice, {
			subscriptionId: subId,
		});
		expect(again.issued).toBe(false);
		expect(await invoicesFor(t, retailerId)).toHaveLength(1);
	});

	test("the trigger lives on the shared usage seam — every order-create channel reaches it", async () => {
		const t = setup();
		const { retailerId, subId } = await seedRetailer(t, "u_seam");
		// Counter checkout, claim links and bookings all call recordOrderCreated
		// (see convex/subscriptionUsage.ts); exercising the seam directly proves
		// the channel is irrelevant.
		await t.run(async (ctx) => {
			await recordOrderCreated(ctx, retailerId, Date.now());
		});
		const sub = await getSub(t, subId);
		expect(sub?.freePeriodEndReason).toBe("first_order");
		// Still metered as an order, too.
		const usage = await t.run((ctx) =>
			ctx.db
				.query("subscriptionUsage")
				.withIndex("by_retailer_month", (q) => q.eq("retailerId", retailerId))
				.collect(),
		);
		expect(usage.reduce((n, r) => n + r.orders, 0)).toBe(1);
	});

	test("a founding-intent store's first invoice carries the promised 30%", async () => {
		const t = setup();
		const { retailerId, subId, userId } = await seedRetailer(t, "u_fint");
		await t.run((ctx) => ctx.db.patch(subId, { foundingIntent: true }));
		const productId = await seedProduct(t, userId, retailerId);
		await placeOrder(t, retailerId, productId);
		await t.mutation(internal.invoices.internalIssueFirstInvoice, {
			subscriptionId: subId,
		});
		const [inv] = await invoicesFor(t, retailerId);
		expect(inv?.total).toBe(10400);
		expect(inv?.foundingDiscount).toBe(4500);
	});

	test("a Singapore store is billed in SGD", async () => {
		const t = setup();
		const { retailerId, subId, userId } = await seedRetailer(t, "u_sg", {
			country: "SG",
		});
		const productId = await seedProduct(t, userId, retailerId, "SGD");
		await placeOrder(t, retailerId, productId, "SGD");
		await t.mutation(internal.invoices.internalIssueFirstInvoice, {
			subscriptionId: subId,
		});
		const [inv] = await invoicesFor(t, retailerId);
		expect(inv).toMatchObject({ currency: "SGD", total: 5900 });
	});

	test("a Kedaipal admin's own store never bills itself; comped stores are skipped", async () => {
		const t = setup();
		const admin = await seedRetailer(t, ADMIN);
		const adminProduct = await seedProduct(t, ADMIN, admin.retailerId);
		await placeOrder(t, admin.retailerId, adminProduct);
		expect((await getSub(t, admin.subId))?.freePeriodEndedAt).toBeUndefined();

		const comped = await seedRetailer(t, "u_comped");
		await t.run((ctx) => ctx.db.patch(comped.subId, { comped: true }));
		const compedProduct = await seedProduct(t, "u_comped", comped.retailerId);
		await placeOrder(t, comped.retailerId, compedProduct);
		expect((await getSub(t, comped.subId))?.freePeriodEndedAt).toBeUndefined();
	});

	test("an already-paying store (active) is untouched by its orders", async () => {
		const t = setup();
		const { retailerId, subId, userId } = await seedRetailer(t, "u_active");
		await t.run((ctx) =>
			ctx.db.patch(subId, { status: "active", currentPeriodEnd: Date.now() + 20 * DAY }),
		);
		const productId = await seedProduct(t, userId, retailerId);
		await placeOrder(t, retailerId, productId);
		expect((await getSub(t, subId))?.freePeriodEndedAt).toBeUndefined();
		expect(await invoicesFor(t, retailerId)).toHaveLength(0);
	});
});

describe("daily cron — the first invoice is the only clock", () => {
	const cron = (t: ReturnType<typeof setup>) =>
		t.mutation(internal.subscriptions.internalDailyBillingStatus, {});

	test("backstop: ends the free period and schedules the bill — never locks", async () => {
		const t = setup();
		const { retailerId, subId } = await seedRetailer(t, "u_back");
		const before = await getSub(t, subId);
		await t.run((ctx) => ctx.db.patch(subId, { trialEndsAt: Date.now() - 1000 }));

		const res = await cron(t);
		expect(res.firstInvoicesIssued).toBe(1);
		expect(res.trialExpired).toBe(0);
		const sub = await getSub(t, subId);
		expect(sub?.status).toBe("trialing");
		expect(sub?.freePeriodEndReason).toBe("backstop");
		expect(sub?.updatedAt).toBe(before?.updatedAt);

		await t.mutation(internal.invoices.internalIssueFirstInvoice, {
			subscriptionId: subId,
		});
		expect(await invoicesFor(t, retailerId)).toHaveLength(1);

		// A pending, not-yet-due first invoice = grace: the next run does nothing
		// to this store (no second bill, no lock).
		const again = await cron(t);
		expect(again.firstInvoicesIssued).toBe(0);
		expect(again.trialExpired).toBe(0);
		expect((await getSub(t, subId))?.status).toBe("trialing");
	});

	test("an overdue first invoice locks (past_due) and settling it activates the plan", async () => {
		const t = setup();
		const { retailerId, subId, userId } = await seedRetailer(t, "u_over");
		const productId = await seedProduct(t, userId, retailerId);
		await placeOrder(t, retailerId, productId);
		await t.mutation(internal.invoices.internalIssueFirstInvoice, {
			subscriptionId: subId,
		});
		const [inv] = await invoicesFor(t, retailerId);
		await t.run((ctx) => ctx.db.patch(inv!._id, { dueDate: Date.now() - 1000 }));

		const res = await cron(t);
		expect(res.trialExpired).toBe(1);
		expect((await getSub(t, subId))?.status).toBe("past_due");

		// Paying the (now overdue) first invoice is the way out — the ordinary
		// settle path activates the billed tier.
		await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.invoices.markPaid, { invoiceId: inv!._id });
		const sub = await getSub(t, subId);
		expect(sub?.status).toBe("active");
		expect(sub?.plan).toBe("pro");
		expect(sub?.orderCap).toBe(200);
	});

	test("free period ended but no bill on file (voided) → the machine writes it again rather than locking", async () => {
		const t = setup();
		const { retailerId, subId, userId } = await seedRetailer(t, "u_void");
		const productId = await seedProduct(t, userId, retailerId);
		await placeOrder(t, retailerId, productId);
		await t.mutation(internal.invoices.internalIssueFirstInvoice, {
			subscriptionId: subId,
		});
		const [inv] = await invoicesFor(t, retailerId);
		await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.invoices.voidInvoice, { invoiceId: inv!._id });

		const res = await cron(t);
		expect(res.firstInvoicesIssued).toBe(1);
		expect(res.trialExpired).toBe(0);
		expect((await getSub(t, subId))?.status).toBe("trialing");
		await t.mutation(internal.invoices.internalIssueFirstInvoice, {
			subscriptionId: subId,
		});
		const all = await invoicesFor(t, retailerId);
		expect(all.filter((i) => i.status === "pending")).toHaveLength(1);
		expect(all.filter((i) => i.status === "void")).toHaveLength(1);
	});

	test("a comped trial that lapses keeps the legacy flip (never billed, never frozen)", async () => {
		const t = setup();
		const { subId } = await seedRetailer(t, "u_cmp");
		await t.run((ctx) =>
			ctx.db.patch(subId, { comped: true, trialEndsAt: Date.now() - 1000 }),
		);
		const res = await cron(t);
		expect(res.trialExpired).toBe(1);
		expect(res.firstInvoicesIssued).toBe(0);
		const sub = await getSub(t, subId);
		expect(sub?.status).toBe("past_due");
		expect(sub?.freePeriodEndedAt).toBeUndefined();
	});

	test("the ends-in-3-days nudge still fires once while the store is free, and not after the period ended", async () => {
		const t = setup();
		const { subId } = await seedRetailer(t, "u_nudge");
		await t.run((ctx) => ctx.db.patch(subId, { trialEndsAt: Date.now() + 2 * DAY }));
		expect((await cron(t)).trialReminders).toBe(1);
		expect((await cron(t)).trialReminders).toBe(0);

		const ended = await seedRetailer(t, "u_nudge2");
		await t.run((ctx) =>
			ctx.db.patch(ended.subId, {
				trialEndsAt: Date.now() + 2 * DAY,
				freePeriodEndedAt: Date.now(),
				freePeriodEndReason: "first_order",
			}),
		);
		expect((await cron(t)).trialReminders).toBe(0);
	});
});

describe("invoices.switchPendingPlan — switch before paying", () => {
	async function seedFirstInvoice(t: ReturnType<typeof setup>, userId: string) {
		const seeded = await seedRetailer(t, userId);
		const productId = await seedProduct(t, userId, seeded.retailerId);
		await placeOrder(t, seeded.retailerId, productId);
		await t.mutation(internal.invoices.internalIssueFirstInvoice, {
			subscriptionId: seeded.subId,
		});
		const [inv] = await invoicesFor(t, seeded.retailerId);
		return { ...seeded, invoice: inv! };
	}

	test("Pro → Starter voids the machine-issued bill and reissues at Starter with the SAME due date", async () => {
		const t = setup();
		const { retailerId, subId, userId, invoice } = await seedFirstInvoice(t, "u_sw");
		const { invoiceId } = await t
			.withIdentity({ subject: userId })
			.mutation(api.invoices.switchPendingPlan, { plan: "starter" });

		const all = await invoicesFor(t, retailerId);
		const voided = all.find((i) => i._id === invoice._id);
		expect(voided?.status).toBe("void");
		expect(voided?.voidedBy).toBe(userId);
		expect(voided?.voidReason).toMatch(/Switched to starter/);
		const replacement = all.find((i) => i._id === invoiceId);
		expect(replacement).toMatchObject({
			status: "pending",
			plan: "starter",
			total: 7900,
			currency: "MYR",
			origin: "self_serve",
			billingCycle: "monthly",
		});
		// Switching never extends the grace.
		expect(replacement?.dueDate).toBe(invoice.dueDate);
		// The tier on the row only moves at settle, never at issue.
		expect((await getSub(t, subId))?.plan).toBe("pro");

		// …and back again is allowed (a seller changing their mind twice).
		await t
			.withIdentity({ subject: userId })
			.mutation(api.invoices.switchPendingPlan, { plan: "pro" });
		const pending = (await invoicesFor(t, retailerId)).filter(
			(i) => i.status === "pending",
		);
		expect(pending).toHaveLength(1);
		expect(pending[0]?.plan).toBe("pro");
	});

	test("refuses: same plan, no pending invoice, an admin-issued invoice, a hold invoice", async () => {
		const t = setup();
		const { retailerId, subId, userId, invoice } = await seedFirstInvoice(t, "u_swx");
		const asUser = t.withIdentity({ subject: userId });
		await expect(
			asUser.mutation(api.invoices.switchPendingPlan, { plan: "pro" }),
		).rejects.toThrow(/already for Pro/);

		// Admin-issued: Arif may have priced it by hand.
		await t.run((ctx) => ctx.db.patch(invoice._id, { origin: "admin" }));
		await expect(
			asUser.mutation(api.invoices.switchPendingPlan, { plan: "starter" }),
		).rejects.toThrow(/issued by our team/);

		// A hold invoice has no tier to switch.
		await t.run((ctx) => ctx.db.patch(invoice._id, { origin: "self_serve", kind: "hold" }));
		await expect(
			asUser.mutation(api.invoices.switchPendingPlan, { plan: "starter" }),
		).rejects.toThrow(/Off-Season Hold/);

		// Nothing pending at all.
		await t.run((ctx) => ctx.db.patch(invoice._id, { status: "void" }));
		await expect(
			asUser.mutation(api.invoices.switchPendingPlan, { plan: "starter" }),
		).rejects.toThrow(/no unpaid invoice/);
		expect((await getSub(t, subId))?.plan).toBe("pro");
		expect(retailerId).toBeDefined();
	});

	test("a founding-intent store keeps its promised price when switching back to Pro", async () => {
		const t = setup();
		const seeded = await seedRetailer(t, "u_swf");
		await t.run((ctx) => ctx.db.patch(seeded.subId, { foundingIntent: true }));
		const productId = await seedProduct(t, seeded.userId, seeded.retailerId);
		await placeOrder(t, seeded.retailerId, productId);
		await t.mutation(internal.invoices.internalIssueFirstInvoice, {
			subscriptionId: seeded.subId,
		});
		const asUser = t.withIdentity({ subject: seeded.userId });
		await asUser.mutation(api.invoices.switchPendingPlan, { plan: "starter" });
		const { invoiceId } = await asUser.mutation(api.invoices.switchPendingPlan, {
			plan: "pro",
		});
		const inv = await t.run((ctx) => ctx.db.get(invoiceId));
		expect(inv?.total).toBe(10400);
		expect(inv?.foundingDiscount).toBe(4500);
	});
});
