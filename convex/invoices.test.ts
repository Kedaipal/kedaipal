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

// A founding member awaiting their first payment: still on the 14-day TRIAL (the
// real founding-onboard state — the paid Pro plan only starts at mark-paid) with a
// pending founding invoice. Built directly so it doesn't depend on the admin
// issue-invoice path, letting markPaid prove the trialing → active transition.
async function seedFounding(
	t: ReturnType<typeof setup>,
	userId: string,
	slug: string,
) {
	const asUser = t.withIdentity({ subject: userId });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: `Store ${slug}`,
		slug,
	});
	const { retailerId, invoiceId } = await t.run(async (ctx) => {
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
		const now = Date.now();
		const month = 30 * 24 * 60 * 60 * 1000;
		// Leave the sub on its signup trial (status "trialing", foundingIntent flagged) —
		// markPaid is what flips it to active.
		await ctx.db.patch(sub._id, { foundingIntent: true });
		const invoiceId = await ctx.db.insert("invoices", {
			retailerId: r._id,
			subscriptionId: sub._id,
			invoiceNumber: `INV-FND-${slug}`,
			amount: 14900,
			foundingDiscount: 4500,
			total: 10400,
			currency: "MYR",
			periodStart: now,
			periodEnd: now + month,
			dueDate: now + 14 * 24 * 60 * 60 * 1000,
			status: "pending",
			createdAt: now,
		});
		return { retailerId: r._id, invoiceId };
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

		// Precondition: the founding member is on the trial, NOT yet a paid Pro.
		expect((await getSubFor(t, retailerId))?.status).toBe("trialing");

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

describe("invoices.issueInvoice", () => {
	async function seedPublic(
		t: ReturnType<typeof setup>,
		userId: string,
		slug: string,
	) {
		const asUser = t.withIdentity({ subject: userId });
		await asUser.mutation(api.retailers.createRetailer, {
			storeName: `Store ${slug}`,
			slug,
		});
		const retailerId = await t.run(async (ctx) => {
			const r = await ctx.db
				.query("retailers")
				.withIndex("by_slug", (q) => q.eq("slug", slug))
				.first();
			return r!._id;
		});
		return { asUser, retailerId };
	}

	const due = () => Date.now() + 14 * 24 * 60 * 60 * 1000;

	test("auto-sets the due date (~14 days) when the admin doesn't pass one", async () => {
		const t = setup();
		const { retailerId } = await seedPublic(t, "u_autodue", "autodue-store");
		const before = Date.now();
		const { invoiceId } = await asAdmin(t).mutation(api.invoices.issueInvoice, {
			retailerId,
			plan: "pro",
			billingCycle: "monthly",
			founding: false,
			// no dueDate — system should set it
		});
		const inv = await getInvoice(t, invoiceId);
		expect(inv?.dueDate).toBeGreaterThan(before + 13 * 24 * 60 * 60 * 1000);
		expect(inv?.dueDate).toBeLessThan(before + 15 * 24 * 60 * 60 * 1000);
	});

	test("a STANDARD Pro invoice claims NO founding rank — founding must be explicit", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedPublic(t, "u1", "store-1");
		const { invoiceId } = await asAdmin(t).mutation(api.invoices.issueInvoice, {
			retailerId,
			plan: "pro",
			billingCycle: "monthly",
			founding: false,
			dueDate: due(),
		});
		const inv = await getInvoice(t, invoiceId);
		expect(inv?.status).toBe("pending");
		expect(inv?.total).toBe(14900); // standard Pro, no discount
		expect(inv?.foundingDiscount).toBeUndefined();
		expect(inv?.plan).toBe("pro"); // billed plan lives on the invoice now

		const mine = await asUser.query(api.invoices.myInvoices, {});
		expect(mine.some((i) => i._id === invoiceId)).toBe(true);

		// Founding is now reserved at onboard or via a FOUNDING invoice — a plain
		// Pro upgrade never consumes a slot.
		const res = await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId });
		expect(res.rank).toBeNull();
		expect((await getRetailer(t, retailerId))?.isFoundingMember).toBeUndefined();
	});

	test("a FOUNDING invoice (founding toggle on) claims the rank when marked paid", async () => {
		const t = setup();
		const { retailerId } = await seedPublic(t, "u_fnd", "fnd-store");
		const { invoiceId } = await asAdmin(t).mutation(api.invoices.issueInvoice, {
			retailerId,
			plan: "pro",
			billingCycle: "monthly",
			founding: true,
			dueDate: due(),
		});
		expect((await getInvoice(t, invoiceId))?.foundingDiscount).toBe(4500);
		const res = await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId });
		expect(res.rank).toBe(1);
		expect((await getRetailer(t, retailerId))?.isFoundingMember).toBe(true);
	});

	test("Starter invoice never claims a rank", async () => {
		const t = setup();
		const { retailerId } = await seedPublic(t, "u1b", "store-1b");
		const { invoiceId } = await asAdmin(t).mutation(api.invoices.issueInvoice, {
			retailerId,
			plan: "starter",
			billingCycle: "monthly",
			founding: false,
			dueDate: due(),
		});
		expect((await getInvoice(t, invoiceId))?.total).toBe(7900);
		const res = await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId });
		expect(res.rank).toBeNull();
	});

	test("a founding invoice claims the rank on mark-paid", async () => {
		const t = setup();
		const { retailerId } = await seedPublic(t, "u2", "store-2");
		const { invoiceId } = await asAdmin(t).mutation(api.invoices.issueInvoice, {
			retailerId,
			plan: "pro",
			billingCycle: "monthly",
			founding: true,
			dueDate: due(),
		});
		const inv = await getInvoice(t, invoiceId);
		expect(inv?.total).toBe(10400); // founding Pro
		expect(inv?.foundingDiscount).toBe(4500);

		const res = await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId });
		expect(res.rank).toBe(1);
		expect((await getRetailer(t, retailerId))?.isFoundingMember).toBe(true);
	});

	test("defaults to MYR when no currency is passed (legacy call shape)", async () => {
		const t = setup();
		const { retailerId } = await seedPublic(t, "u_myr", "myr-store");
		const { invoiceId } = await asAdmin(t).mutation(api.invoices.issueInvoice, {
			retailerId,
			plan: "pro",
			billingCycle: "monthly",
			founding: false,
			dueDate: due(),
		});
		const inv = await getInvoice(t, invoiceId);
		expect(inv?.currency).toBe("MYR");
		expect(inv?.total).toBe(14900);
	});

	test("an SGD invoice bills from the SGD price table", async () => {
		const t = setup();
		const { retailerId } = await seedPublic(t, "u_sgd", "sgd-store");
		const { invoiceId } = await asAdmin(t).mutation(api.invoices.issueInvoice, {
			retailerId,
			plan: "pro",
			billingCycle: "monthly",
			founding: false,
			currency: "SGD",
			dueDate: due(),
		});
		const inv = await getInvoice(t, invoiceId);
		expect(inv?.currency).toBe("SGD");
		expect(inv?.amount).toBe(5900); // S$59 Pro monthly
		expect(inv?.total).toBe(5900);
		expect(inv?.foundingDiscount).toBeUndefined();
	});

	test("an SGD ANNUAL invoice charges 10 months, like MYR", async () => {
		const t = setup();
		const { retailerId } = await seedPublic(t, "u_sgd_a", "sgd-annual-store");
		const { invoiceId } = await asAdmin(t).mutation(api.invoices.issueInvoice, {
			retailerId,
			plan: "starter",
			billingCycle: "annual",
			founding: false,
			currency: "SGD",
			dueDate: due(),
		});
		const inv = await getInvoice(t, invoiceId);
		expect(inv?.currency).toBe("SGD");
		expect(inv?.total).toBe(2900 * 10); // S$29 × 10 months
	});

	test("an SGD FOUNDING invoice bills S$41 and claims the rank when paid", async () => {
		const t = setup();
		const { retailerId } = await seedPublic(t, "u_sgd_f", "sgd-founding-store");
		const { invoiceId } = await asAdmin(t).mutation(api.invoices.issueInvoice, {
			retailerId,
			plan: "pro",
			billingCycle: "monthly",
			founding: true,
			currency: "SGD",
			dueDate: due(),
		});
		const inv = await getInvoice(t, invoiceId);
		expect(inv?.currency).toBe("SGD");
		expect(inv?.total).toBe(4100); // S$41 founding Pro
		expect(inv?.foundingDiscount).toBe(1800); // S$59 − S$41
		const res = await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId });
		expect(res.rank).toBe(1);
		expect((await getRetailer(t, retailerId))?.isFoundingMember).toBe(true);
	});

	test("rejects Scale + founding-non-Pro + duplicate pending + non-admin", async () => {
		const t = setup();
		const { retailerId } = await seedPublic(t, "u3", "store-3");
		await expect(
			asAdmin(t).mutation(api.invoices.issueInvoice, {
				retailerId,
				plan: "scale",
				billingCycle: "monthly",
				founding: false,
				dueDate: due(),
			}),
		).rejects.toThrow(/scale is unavailable/i);
		await expect(
			asAdmin(t).mutation(api.invoices.issueInvoice, {
				retailerId,
				plan: "starter",
				billingCycle: "monthly",
				founding: true,
				dueDate: due(),
			}),
		).rejects.toThrow(/only pro/i);
		await expect(
			t.withIdentity({ subject: "nope" }).mutation(api.invoices.issueInvoice, {
				retailerId,
				plan: "pro",
				billingCycle: "monthly",
				founding: false,
				dueDate: due(),
			}),
		).rejects.toThrow(/not authorized/i);

		// One pending, then a second issue is blocked.
		await asAdmin(t).mutation(api.invoices.issueInvoice, {
			retailerId,
			plan: "pro",
			billingCycle: "monthly",
			founding: false,
			dueDate: due(),
		});
		await expect(
			asAdmin(t).mutation(api.invoices.issueInvoice, {
				retailerId,
				plan: "pro",
				billingCycle: "monthly",
				founding: false,
				dueDate: due(),
			}),
		).rejects.toThrow(/already has a pending/i);
	});
});

describe("invoices.voidInvoice", () => {
	test("voids a pending invoice (kept, not deleted) and frees the pending slot", async () => {
		const t = setup();
		const { retailerId, invoiceId } = await seedFounding(
			t,
			"u_void",
			"void-store",
		);

		const res = await asAdmin(t).mutation(api.invoices.voidInvoice, {
			invoiceId,
			reason: "wrong amount",
		});
		expect(res.ok).toBe(true);

		const inv = await getInvoice(t, invoiceId);
		expect(inv?.status).toBe("void"); // kept for audit, not deleted
		expect(inv?.voidedBy).toBe(ADMIN);
		expect(inv?.voidReason).toBe("wrong amount");

		// Slot freed → a corrected invoice can now be issued (no dup-pending throw).
		await asAdmin(t).mutation(api.invoices.issueInvoice, {
			retailerId,
			plan: "pro",
			billingCycle: "monthly",
			founding: false,
			dueDate: Date.now() + 14 * 24 * 60 * 60 * 1000,
		});
	});

	test("rejects voiding a paid invoice (that's a refund, not a void)", async () => {
		const t = setup();
		const { invoiceId } = await seedFounding(t, "u_void2", "void-store-2");
		await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId });
		await expect(
			asAdmin(t).mutation(api.invoices.voidInvoice, { invoiceId }),
		).rejects.toThrow(/only a pending/i);
	});

	test("rejects a non-admin", async () => {
		const t = setup();
		const { invoiceId } = await seedFounding(t, "u_void3", "void-store-3");
		await expect(
			t
				.withIdentity({ subject: "nope" })
				.mutation(api.invoices.voidInvoice, { invoiceId }),
		).rejects.toThrow(/not authorized/i);
	});
});

describe("backfill", () => {
	test("drops a pre-billing retailer onto a 14-day trial (not comped); idempotent", async () => {
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

		const before = Date.now();
		const first = await t.mutation(
			internal.subscriptions.internalBackfillSubscriptions,
			{},
		);
		expect(first.created).toBe(1);
		const sub = await getSubFor(t, retailerId);
		// Treated like a fresh signup: trialing, non-comped, ~14 days runway.
		expect(sub?.status).toBe("trialing");
		expect(sub?.comped).not.toBe(true);
		expect(sub?.trialEndsAt).toBeGreaterThan(before + 13 * 24 * 60 * 60 * 1000);

		// Second run leaves the real trialing sub alone.
		const second = await t.mutation(
			internal.subscriptions.internalBackfillSubscriptions,
			{},
		);
		expect(second.created).toBe(0);
		expect(second.converted).toBe(0);
		expect(second.skipped).toBeGreaterThanOrEqual(1);
	});

	test("heals a leftover comped row from an earlier backfill into the trial", async () => {
		const t = setup();
		const asUser = t.withIdentity({ subject: "u_comped" });
		await asUser.mutation(api.retailers.createRetailer, {
			storeName: "Comped Store",
			slug: "comped-store",
		});
		// Simulate the OLD backfill output: an active + comped subscription.
		const retailerId = await t.run(async (ctx) => {
			const r = await ctx.db
				.query("retailers")
				.withIndex("by_slug", (q) => q.eq("slug", "comped-store"))
				.first();
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", r!._id))
				.first();
			await ctx.db.patch(sub!._id, { status: "active", comped: true });
			return r!._id;
		});

		const res = await t.mutation(
			internal.subscriptions.internalBackfillSubscriptions,
			{},
		);
		expect(res.converted).toBeGreaterThanOrEqual(1);
		const sub = await getSubFor(t, retailerId);
		expect(sub?.status).toBe("trialing");
		expect(sub?.comped).toBe(false);
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
		// A founding retailer who already converted (active) whose renewal invoice is overdue.
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
			// The founding store has converted (active); make its invoice overdue.
			const fSub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", foundingId))
				.first();
			await ctx.db.patch(fSub!._id, { status: "active" });
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

	test("emails a pre-due-date reminder once, only inside the 3-day window", async () => {
		const t = setup();
		const { retailerId, invoiceId } = await seedFounding(t, "u_rem", "rem-store");
		// Due in 2 days → inside the reminder window.
		await t.run(async (ctx) => {
			await ctx.db.patch(invoiceId, {
				dueDate: Date.now() + 2 * 24 * 60 * 60 * 1000,
			});
		});

		const first = await t.mutation(
			internal.subscriptions.internalDailyBillingStatus,
			{},
		);
		expect(first.remindersSent).toBe(1);
		expect((await getInvoice(t, invoiceId))?.reminderSentAt).toBeTypeOf("number");

		// Second daily run does not re-send (reminderSentAt is stamped).
		const second = await t.mutation(
			internal.subscriptions.internalDailyBillingStatus,
			{},
		);
		expect(second.remindersSent).toBe(0);
		// Keep the unused retailerId referenced for clarity of intent.
		expect(retailerId).toBeDefined();
	});

	test("does not remind an invoice still far from its due date", async () => {
		const t = setup();
		const { invoiceId } = await seedFounding(t, "u_far", "far-store");
		await t.run(async (ctx) => {
			await ctx.db.patch(invoiceId, {
				dueDate: Date.now() + 10 * 24 * 60 * 60 * 1000, // 10 days out
			});
		});
		const res = await t.mutation(
			internal.subscriptions.internalDailyBillingStatus,
			{},
		);
		expect(res.remindersSent).toBe(0);
		expect((await getInvoice(t, invoiceId))?.reminderSentAt).toBeUndefined();
	});

	test("trial ending in ≤3 days → one trialEndingSoon reminder, then deduped", async () => {
		const t = setup();
		await t
			.withIdentity({ subject: "u_trem" })
			.mutation(api.retailers.createRetailer, {
				storeName: "Trial Rem",
				slug: "trial-rem",
			});
		const retailerId = await t.run(async (ctx) => {
			const r = await ctx.db
				.query("retailers")
				.withIndex("by_slug", (q) => q.eq("slug", "trial-rem"))
				.first();
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", r!._id))
				.first();
			await ctx.db.patch(sub!._id, {
				trialEndsAt: Date.now() + 2 * 24 * 60 * 60 * 1000,
			});
			return r!._id;
		});

		const first = await t.mutation(
			internal.subscriptions.internalDailyBillingStatus,
			{},
		);
		expect(first.trialReminders).toBe(1);
		expect((await getSubFor(t, retailerId))?.trialReminderSentAt).toBeTypeOf(
			"number",
		);

		const second = await t.mutation(
			internal.subscriptions.internalDailyBillingStatus,
			{},
		);
		expect(second.trialReminders).toBe(0);
	});

	test("period lapsed with NO pending invoice → auto-issues the renewal, never locks (86eyb6z4r)", async () => {
		const t = setup();
		const { retailerId, invoiceId } = await seedFounding(t, "u_laps", "laps-store");
		// Settle the invoice (no pending left), then expire the paid period.
		await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId });
		await t.run(async (ctx) => {
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first();
			await ctx.db.patch(sub!._id, { currentPeriodEnd: Date.now() - 1000 });
		});

		const res = await t.mutation(
			internal.subscriptions.internalDailyBillingStatus,
			{},
		);
		// The old behavior locked here (`lapsed`); the machine now writes the
		// renewal bill instead and the seller keeps access through its grace.
		expect(res.renewalsIssued).toBe(1);
		expect((await getSubFor(t, retailerId))?.status).toBe("active");

		// Run the issuance the cron scheduled (invoked directly — fake timers
		// hold scheduled functions, and the mutation is the thing under test)
		// and check the bill it wrote: renewal origin, founding discount
		// preserved (lifetime), same plan/cycle.
		const subscriptionId = (await getSubFor(t, retailerId))?._id;
		if (!subscriptionId) throw new Error("no subscription");
		const issued = await t.mutation(
			internal.invoices.internalIssueRenewalInvoice,
			{ subscriptionId },
		);
		expect(issued.issued).toBe(true);
		expect(issued.autoCharge).toBe(false); // no saved method on this store
		const renewal = await t.run(async (ctx) => {
			const rows = await ctx.db
				.query("invoices")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.collect();
			return rows.find((inv) => inv.status === "pending");
		});
		expect(renewal).toBeDefined();
		expect(renewal?.origin).toBe("auto_renewal");
		expect(renewal?.plan).toBe("pro");
		// seedFounding claims the rank at markPaid → the renewal keeps the 30%.
		expect(renewal?.foundingDiscount).toBeGreaterThan(0);
		expect(renewal?.currency).toBe("MYR"); // follows the last PAID invoice

		// Idempotent both ways: a second direct call no-ops on the pending
		// invoice, and a second cron run schedules nothing new.
		const reissued = await t.mutation(
			internal.invoices.internalIssueRenewalInvoice,
			{ subscriptionId },
		);
		expect(reissued.issued).toBe(false);
		const again = await t.mutation(
			internal.subscriptions.internalDailyBillingStatus,
			{},
		);
		expect(again.renewalsIssued).toBe(0);
	});

	test("does NOT re-issue while a pending invoice still gives grace", async () => {
		const t = setup();
		const { retailerId } = await seedFounding(t, "u_grace", "grace-store");
		// A converted (active) vendor: period ended, but the invoice is still pending +
		// due in the future, so grace holds and no new bill is written.
		await t.run(async (ctx) => {
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first();
			await ctx.db.patch(sub!._id, {
				status: "active",
				currentPeriodEnd: Date.now() - 1000,
			});
		});

		const res = await t.mutation(
			internal.subscriptions.internalDailyBillingStatus,
			{},
		);
		expect(res.renewalsIssued).toBe(0);
		expect((await getSubFor(t, retailerId))?.status).toBe("active");
	});

	test("picks up a due auto-charge retry while a renewal invoice pends (86eyb6z4r)", async () => {
		const t = setup();
		const { retailerId, invoiceId } = await seedFounding(t, "u_rty", "rty-store");
		await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId });
		await t.run(async (ctx) => {
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first();
			const now = Date.now();
			await ctx.db.patch(sub!._id, {
				autoRenewSessionId: "rb_rty",
				autoRenew: {
					provider: "hitpay" as const,
					method: "card",
					attachedAt: now,
					failedAttempts: 1,
					nextRetryAt: now - 60_000, // retry window arrived
				},
			});
			await ctx.db.insert("invoices", {
				retailerId,
				subscriptionId: sub!._id,
				invoiceNumber: "INV-RTY-2",
				plan: "pro" as const,
				billingCycle: "monthly" as const,
				amount: 10400,
				total: 10400,
				currency: "MYR",
				periodStart: now,
				periodEnd: now + 30 * 86400000,
				dueDate: now + 10 * 86400000,
				status: "pending" as const,
				origin: "auto_renewal" as const,
				createdAt: now,
			});
		});
		const res = await t.mutation(
			internal.subscriptions.internalDailyBillingStatus,
			{},
		);
		expect(res.autoChargeRetries).toBe(1);
	});

	test("auto-renew sellers get ONE pre-charge notice per cycle; updatedAt untouched", async () => {
		const t = setup();
		const { retailerId, invoiceId } = await seedFounding(t, "u_ntc", "ntc-store");
		await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId });
		const before = await t.run(async (ctx) => {
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first();
			const now = Date.now();
			await ctx.db.patch(sub!._id, {
				currentPeriodEnd: now + 2 * 24 * 60 * 60 * 1000, // inside the window
				autoRenewSessionId: "rb_ntc",
				autoRenew: {
					provider: "hitpay" as const,
					method: "touch_n_go",
					attachedAt: now,
				},
			});
			return (await ctx.db.get(sub!._id))?.updatedAt;
		});

		const first = await t.mutation(
			internal.subscriptions.internalDailyBillingStatus,
			{},
		);
		expect(first.renewalNotices).toBe(1);
		const sub = await getSubFor(t, retailerId);
		expect(sub?.renewalNoticeSentForPeriodEnd).toBe(sub?.currentPeriodEnd);
		// The stamp must NOT touch updatedAt — for past_due rows that field is
		// the lock-flip moment the founder report reads (docs/shipped-log.md).
		expect(sub?.updatedAt).toBe(before);

		const second = await t.mutation(
			internal.subscriptions.internalDailyBillingStatus,
			{},
		);
		expect(second.renewalNotices).toBe(0);
	});

	test("reminders fire again next cycle — dedup is per-invoice, not per-vendor", async () => {
		const t = setup();
		const DAY = 24 * 60 * 60 * 1000;
		const { retailerId, invoiceId: cycle1 } = await seedFounding(
			t,
			"u_cyc",
			"cyc-store",
		);

		// Cycle 1: due soon → reminded, then settled.
		await t.run((ctx) => ctx.db.patch(cycle1, { dueDate: Date.now() + 2 * DAY }));
		const r1 = await t.mutation(
			internal.subscriptions.internalDailyBillingStatus,
			{},
		);
		expect(r1.remindersSent).toBe(1);
		await t.run((ctx) => ctx.db.patch(cycle1, { status: "paid" }));

		// Cycle 2: a brand-new pending invoice, also due soon.
		await t.run(async (ctx) => {
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first();
			await ctx.db.insert("invoices", {
				retailerId,
				subscriptionId: sub!._id,
				invoiceNumber: "INV-CYCLE-2",
				amount: 14900,
				total: 10400,
				currency: "MYR",
				periodStart: Date.now(),
				periodEnd: Date.now() + 30 * DAY,
				dueDate: Date.now() + 2 * DAY,
				status: "pending",
				createdAt: Date.now(),
			});
		});

		// The settled cycle-1 invoice's stamped reminder must NOT suppress cycle 2.
		const r2 = await t.mutation(
			internal.subscriptions.internalDailyBillingStatus,
			{},
		);
		expect(r2.remindersSent).toBe(1);
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

/**
 * Server-side `subscribe_paid` key event (z8r3fdd1v1): every markPaid
 * schedules the GA4 Measurement Protocol send fire-and-forget, carrying the
 * retailer's stored acquisition tag so subscription revenue segments by
 * channel. Fake timers hold the scheduled job so we can inspect its args.
 */
async function subscribePaidJobs(
	t: ReturnType<typeof setup>,
): Promise<Array<Record<string, unknown>>> {
	const jobs = await t.run((ctx) =>
		ctx.db.system.query("_scheduled_functions").collect(),
	);
	return jobs
		.filter((j) => j.name.includes("sendKeyEvent"))
		.map((j) => j.args[0] as Record<string, unknown>);
}

describe("invoices.markPaid — subscribe_paid key event (z8r3fdd1v1)", () => {
	test("markPaid schedules subscribe_paid with src, revenue, and first_time", async () => {
		const t = setup();
		const { retailerId, invoiceId } = await seedFounding(t, "ga1", "ga-store-1");
		await t.run(async (ctx) => {
			await ctx.db.patch(retailerId, {
				signupSource: "referral-ganu",
				gaClientId: "111.222",
			});
		});
		const billedPlan = (await getSubFor(t, retailerId))?.plan;

		await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId });

		const jobs = await subscribePaidJobs(t);
		expect(jobs).toHaveLength(1);
		expect(jobs[0]).toMatchObject({
			event: "subscribe_paid",
			retailerId,
			src: "referral-ganu",
			gaClientId: "111.222",
			params: {
				plan: billedPlan,
				cycle: "monthly",
				first_time: true,
				// Invoice total is minor units (10400 sen) — GA4 value is major.
				value: 104,
				currency: "MYR",
			},
		});
	});

	test("a renewal fires subscribe_paid with first_time false", async () => {
		const t = setup();
		const { retailerId, invoiceId } = await seedFounding(t, "ga2", "ga-store-2");
		await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId });

		// Second cycle: a fresh pending invoice for the now-active subscription.
		const renewalId = await t.run(async (ctx) => {
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first();
			if (!sub) throw new Error("no sub");
			const now = Date.now();
			const month = 30 * 24 * 60 * 60 * 1000;
			return ctx.db.insert("invoices", {
				retailerId,
				subscriptionId: sub._id,
				invoiceNumber: "INV-RENEW-ga2",
				amount: 14900,
				total: 14900,
				currency: "MYR",
				periodStart: now,
				periodEnd: now + month,
				dueDate: now + 14 * 24 * 60 * 60 * 1000,
				status: "pending",
				createdAt: now,
			});
		});
		await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId: renewalId });

		const jobs = await subscribePaidJobs(t);
		expect(jobs).toHaveLength(2);
		const renewal = jobs[1] as { params?: Record<string, unknown> };
		expect(renewal.params?.first_time).toBe(false);
		expect(renewal.params?.value).toBe(149);
	});
});

/**
 * Mid-cycle tier changes (86eyb6z4r) — the four scenarios a seller can walk,
 * end to end through the real mutations. The pure arithmetic is pinned in
 * plans.test.ts; this block pins what the MONEY and the ACCESS do: an upgrade
 * bills full price and hands back the unused days, a downgrade charges nothing
 * and takes nothing away until the period already paid for runs out, and the
 * guards refuse the states where either would be wrong.
 */
describe("invoices.changePlan — mid-cycle tier moves", () => {
	const DAY = 24 * 60 * 60 * 1000;

	/** An ACTIVE, paying seller mid-period — the only state a plan CHANGE applies
	 * to (everyone else is choosing a plan, which is the picker's job). */
	async function seedActive(
		t: ReturnType<typeof setup>,
		userId: string,
		slug: string,
		opts: { plan: "starter" | "pro"; daysLeft: number; country?: "MY" | "SG" },
	) {
		const asUser = t.withIdentity({ subject: userId });
		await asUser.mutation(api.retailers.createRetailer, {
			storeName: `Store ${slug}`,
			slug,
		});
		const retailerId = await t.run(async (ctx) => {
			const r = await ctx.db
				.query("retailers")
				.withIndex("by_slug", (q) => q.eq("slug", slug))
				.first();
			if (!r) throw new Error("no retailer");
			if (opts.country) await ctx.db.patch(r._id, { country: opts.country });
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", r._id))
				.first();
			if (!sub) throw new Error("no sub");
			const now = Date.now();
			await ctx.db.patch(sub._id, {
				plan: opts.plan,
				billingCycle: "monthly",
				status: "active",
				currentPeriodStart: now - (30 - opts.daysLeft) * DAY,
				currentPeriodEnd: now + opts.daysLeft * DAY,
			});
			return r._id;
		});
		return { asUser, retailerId };
	}

	const pendingFor = (
		t: ReturnType<typeof setup>,
		retailerId: Id<"retailers">,
	) =>
		t.run(async (ctx) => {
			const rows = await ctx.db
				.query("invoices")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.collect();
			return rows.filter((inv) => inv.status === "pending");
		});

	test("A — upgrade bills FULL price now and the unused days come back as days", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedActive(t, "u_up", "up-store", {
			plan: "starter",
			daysLeft: 10,
		});
		const at = Date.now();

		const res = await asUser.mutation(api.invoices.changePlan, { plan: "pro" });
		expect(res.kind).toBe("invoiced");
		// No saved method on this store → the seller pays the invoice by hand.
		if (res.kind !== "invoiced") throw new Error("expected an invoice");
		expect(res.chargingSavedMethod).toBe(false);

		const invoice = await getInvoice(t, res.invoiceId);
		// Full Pro, never a prorated difference — a part-price invoice is what
		// the design review killed (a small unpaid top-up inherits the service
		// bill's lifecycle and soft-locks a fully paid store).
		expect(invoice?.total).toBe(14900);
		expect(invoice?.plan).toBe("pro");
		expect(invoice?.billingCycle).toBe("monthly");
		expect(invoice?.origin).toBe("self_serve");

		// Nothing moves until the money lands — still Starter, still their caps.
		const before = await getSubFor(t, retailerId);
		expect(before?.plan).toBe("starter");

		await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId: res.invoiceId });
		const after = await getSubFor(t, retailerId);
		expect(after?.plan).toBe("pro");
		expect(after?.orderCap).toBe(500);
		// 10 unused Starter days (RM79/30 a day) buy 5 Pro days (RM149/30 a day),
		// added on top of the fresh 30 — so 35, not 30 and not 40.
		expect(after?.currentPeriodEnd).toBe(at + 30 * DAY + 5 * DAY);
	});

	test("A2 — an upgrade paid LATE credits only the days still unused", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedActive(t, "u_late", "late-store", {
			plan: "starter",
			daysLeft: 10,
		});
		const res = await asUser.mutation(api.invoices.changePlan, { plan: "pro" });
		if (res.kind !== "invoiced") throw new Error("expected an invoice");

		// The manual rail is 14 days wide. Settle 8 days after the invoice was
		// written: only 2 Starter days are left to credit, and the arithmetic
		// must be done at SETTLE, not at issue.
		vi.setSystemTime(Date.now() + 8 * DAY);
		const at = Date.now();
		await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId: res.invoiceId });
		const after = await getSubFor(t, retailerId);
		expect(after?.plan).toBe("pro");
		// 2 Starter days ≈ 1 Pro day.
		expect(after?.currentPeriodEnd).toBe(at + 30 * DAY + 1 * DAY);
	});

	test("A3 — an upgrade settled AFTER the period lapsed credits nothing", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedActive(t, "u_lapse", "lapse-store", {
			plan: "starter",
			daysLeft: 3,
		});
		const res = await asUser.mutation(api.invoices.changePlan, { plan: "pro" });
		if (res.kind !== "invoiced") throw new Error("expected an invoice");
		vi.setSystemTime(Date.now() + 5 * DAY);
		const at = Date.now();
		await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId: res.invoiceId });
		// Nothing was left to carry — a plain 30-day period, no negative credit.
		expect((await getSubFor(t, retailerId))?.currentPeriodEnd).toBe(at + 30 * DAY);
	});

	test("B — downgrade is SCHEDULED: no invoice, no loss of access today", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedActive(t, "u_dn", "dn-store", {
			plan: "pro",
			daysLeft: 12,
		});
		const periodEnd = (await getSubFor(t, retailerId))?.currentPeriodEnd;

		const res = await asUser.mutation(api.invoices.changePlan, {
			plan: "starter",
		});
		expect(res.kind).toBe("scheduled");
		if (res.kind !== "scheduled") throw new Error("expected a schedule");
		// It lands exactly when the period they paid for runs out — the date the
		// dialog and the banner both quote.
		expect(res.effectiveAt).toBe(periodEnd);

		// Charges nothing, and takes nothing away yet.
		expect(await pendingFor(t, retailerId)).toHaveLength(0);
		const sub = await getSubFor(t, retailerId);
		expect(sub?.plan).toBe("pro");
		expect(sub?.orderCap).toBe(500);
		expect(sub?.pendingPlanChange?.plan).toBe("starter");

		// And it's reversible right up to the moment it lands.
		await asUser.mutation(api.invoices.cancelPlanChange, {});
		expect((await getSubFor(t, retailerId))?.pendingPlanChange).toBeUndefined();
	});

	test("B2 — a scheduled downgrade never moves updatedAt (the past_due lock stamp)", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedActive(t, "u_stamp", "stamp-store", {
			plan: "pro",
			daysLeft: 12,
		});
		const before = (await getSubFor(t, retailerId))?.updatedAt;
		await asUser.mutation(api.invoices.changePlan, { plan: "starter" });
		expect((await getSubFor(t, retailerId))?.updatedAt).toBe(before);
	});

	test("C — the scheduled plan is what the renewal invoice bills, once", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedActive(t, "u_land", "land-store", {
			plan: "pro",
			daysLeft: 1,
		});
		await asUser.mutation(api.invoices.changePlan, { plan: "starter" });

		// The period runs out — the cron notices and writes the renewal bill.
		await t.run(async (ctx) => {
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first();
			await ctx.db.patch(sub!._id, { currentPeriodEnd: Date.now() - 1000 });
		});
		const cron = await t.mutation(
			internal.subscriptions.internalDailyBillingStatus,
			{},
		);
		expect(cron.renewalsIssued).toBe(1);

		const subscriptionId = (await getSubFor(t, retailerId))?._id;
		if (!subscriptionId) throw new Error("no subscription");
		await t.mutation(internal.invoices.internalIssueRenewalInvoice, {
			subscriptionId,
		});
		const [renewal] = await pendingFor(t, retailerId);
		// Billed at STARTER, not the Pro they were on — the whole point.
		expect(renewal?.plan).toBe("starter");
		expect(renewal?.total).toBe(7900);
		expect(renewal?.origin).toBe("auto_renewal");
		// The intent is consumed by the bill that honoured it, so a second cycle
		// can't re-downgrade a seller who has since moved back up.
		expect((await getSubFor(t, retailerId))?.pendingPlanChange).toBeUndefined();

		// Access only actually drops when that bill is paid.
		if (!renewal) throw new Error("no renewal invoice");
		expect((await getSubFor(t, retailerId))?.plan).toBe("pro");
		await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId: renewal._id });
		const after = await getSubFor(t, retailerId);
		expect(after?.plan).toBe("starter");
		expect(after?.orderCap).toBe(100);
	});

	test("C2 — moving back up supersedes a scheduled downgrade", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedActive(t, "u_undo", "undo-store", {
			plan: "pro",
			daysLeft: 9,
		});
		await asUser.mutation(api.invoices.changePlan, { plan: "starter" });
		expect((await getSubFor(t, retailerId))?.pendingPlanChange).toBeDefined();

		// They're on Pro, so "up" means dropping to Starter first isn't needed —
		// cancelling is the seller-facing route, but a *later* upgrade invoice
		// must clear the intent too or the renewal would undo what they paid for.
		await t.run(async (ctx) => {
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first();
			await ctx.db.patch(sub!._id, { plan: "starter" });
		});
		await asUser.mutation(api.invoices.changePlan, { plan: "pro" });
		expect((await getSubFor(t, retailerId))?.pendingPlanChange).toBeUndefined();
	});

	test("D — the guards: open invoice, wrong status, same plan, on the house", async () => {
		const t = setup();

		// An unpaid bill already on the table — a second one is how a seller ends
		// up past_due on a plan they never got.
		const open = await seedActive(t, "u_g1", "g1-store", {
			plan: "starter",
			daysLeft: 10,
		});
		await open.asUser.mutation(api.invoices.changePlan, { plan: "pro" });
		await expect(
			open.asUser.mutation(api.invoices.changePlan, { plan: "pro" }),
		).rejects.toThrow(/Settle your open invoice/);

		// Not active → the plan PICKER is the right door (it starts a period).
		const locked = await seedActive(t, "u_g2", "g2-store", {
			plan: "starter",
			daysLeft: 2,
		});
		await t.run(async (ctx) => {
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", locked.retailerId))
				.first();
			await ctx.db.patch(sub!._id, { status: "past_due" });
		});
		await expect(
			locked.asUser.mutation(api.invoices.changePlan, { plan: "pro" }),
		).rejects.toThrow(/active subscription/);

		// Already there.
		const same = await seedActive(t, "u_g3", "g3-store", {
			plan: "pro",
			daysLeft: 5,
		});
		await expect(
			same.asUser.mutation(api.invoices.changePlan, { plan: "pro" }),
		).rejects.toThrow(/already on pro/);

		// Comped pilots never pay, so there is no tier to move between.
		const comped = await seedActive(t, "u_g4", "g4-store", {
			plan: "pro",
			daysLeft: 5,
		});
		await t.run(async (ctx) => {
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", comped.retailerId))
				.first();
			await ctx.db.patch(sub!._id, { comped: true });
		});
		await expect(
			comped.asUser.mutation(api.invoices.changePlan, { plan: "starter" }),
		).rejects.toThrow(/on the house/);
	});

	test("D2 — an SG seller's upgrade is invoiced in SGD", async () => {
		const t = setup();
		const { asUser } = await seedActive(t, "u_sg", "sg-store", {
			plan: "starter",
			daysLeft: 10,
			country: "SG",
		});
		const res = await asUser.mutation(api.invoices.changePlan, { plan: "pro" });
		if (res.kind !== "invoiced") throw new Error("expected an invoice");
		const invoice = await getInvoice(t, res.invoiceId);
		expect(invoice?.currency).toBe("SGD");
		expect(invoice?.total).toBe(5900);
	});

	test("D3 — a founding member upgrading is billed THEIR price, not list", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedActive(t, "u_fnd2", "fnd2-store", {
			plan: "starter",
			daysLeft: 10,
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(retailerId, { isFoundingMember: true });
		});
		const res = await asUser.mutation(api.invoices.changePlan, { plan: "pro" });
		if (res.kind !== "invoiced") throw new Error("expected an invoice");
		const invoice = await getInvoice(t, res.invoiceId);
		expect(invoice?.total).toBe(10400);
		expect(invoice?.foundingDiscount).toBe(4500);
	});
});
