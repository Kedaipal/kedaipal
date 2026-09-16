/// <reference types="vite/client" />
// Off-Season Hold (z8r3fday24): a PAID seller pauses between seasons for the
// flat hold price — ordering off, everything else live, one tap back to the
// tier. See docs/manual-subscription.md.
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
import type { Doc, Id } from "./_generated/dataModel";
import {
	canEnterHold,
	canResumeHold,
	holdBillsNow,
	resumeBillsNow,
} from "./lib/seasonalHold";
import { rateLimiter } from "./lib/rateLimiter";
import schema from "./schema";
import { resolveAccess } from "./subscriptions";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const ADMIN = "user_hold_admin";
const DAY = 24 * 60 * 60 * 1000;
let prevAdminEnv: string | undefined;

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

/** Build a subscriptions doc for the pure resolveAccess tests. */
function subDoc(partial: Partial<Doc<"subscriptions">>): Doc<"subscriptions"> {
	return {
		_id: "s1" as Doc<"subscriptions">["_id"],
		_creationTime: 0,
		retailerId: "r1" as Doc<"subscriptions">["retailerId"],
		plan: "pro",
		billingCycle: "monthly",
		status: "active",
		orderCap: 200,
		userCap: 2,
		broadcastQuota: 100,
		createdAt: 0,
		updatedAt: 0,
		...partial,
	};
}

describe("pure rules", () => {
	test("resolveAccess: on_hold keeps the tier's features + dashboard, zeroes the EFFECTIVE order cap, never frozen", () => {
		const a = resolveAccess(subDoc({ status: "on_hold", heldAt: 5 }));
		expect(a.held).toBe(true);
		expect(a.heldAt).toBe(5);
		expect(a.frozen).toBe(false);
		expect(a.active).toBe(true);
		expect(a.plan).toBe("pro");
		expect(a.features.crm).toBe(true);
		expect(a.caps).toEqual({ orderCap: 0, userCap: 2, broadcastQuota: 100 });
		// Not held → the stored cap is what you get.
		expect(resolveAccess(subDoc({ status: "active" })).caps.orderCap).toBe(200);
		expect(resolveAccess(subDoc({ status: "active" })).held).toBe(false);
		expect(resolveAccess(null).held).toBe(false);
	});

	test("canEnterHold: active / past_due only, never a trial or a comped row", () => {
		expect(canEnterHold("active", false)).toBe(true);
		expect(canEnterHold("past_due", false)).toBe(true);
		expect(canEnterHold("trialing", false)).toBe(false);
		expect(canEnterHold("cancelled", false)).toBe(false);
		expect(canEnterHold("on_hold", false)).toBe(false);
		expect(canEnterHold("active", true)).toBe(false);
		// A lock from a comp ending (z8r3fdeub2) has no plan behind it to pause.
		expect(canEnterHold("past_due", false, true)).toBe(false);
	});

	test("canResumeHold: from the hold, or from a lock over an unpaid HOLD invoice", () => {
		expect(canResumeHold("on_hold", false)).toBe(true);
		expect(canResumeHold("past_due", true)).toBe(true);
		expect(canResumeHold("past_due", false)).toBe(false);
		expect(canResumeHold("active", false)).toBe(false);
	});

	test("holdBillsNow / resumeBillsNow: a period bought by the plan and still running owes nothing", () => {
		const now = 1_000_000;
		const future = now + 10 * DAY;
		const past = now - DAY;
		expect(holdBillsNow({ currentPeriodEnd: future, periodPaidBy: "plan", hadPendingInvoice: false, now })).toBe(false);
		expect(holdBillsNow({ currentPeriodEnd: future, periodPaidBy: undefined, hadPendingInvoice: false, now })).toBe(false);
		expect(holdBillsNow({ currentPeriodEnd: past, periodPaidBy: "plan", hadPendingInvoice: false, now })).toBe(true);
		expect(holdBillsNow({ currentPeriodEnd: undefined, periodPaidBy: undefined, hadPendingInvoice: false, now })).toBe(true);
		// A voided plan bill is replaced by the hold bill at once.
		expect(holdBillsNow({ currentPeriodEnd: future, periodPaidBy: "plan", hadPendingInvoice: true, now })).toBe(true);
		// Pausing again inside a hold-bought period: the hold keeps billing.
		expect(holdBillsNow({ currentPeriodEnd: future, periodPaidBy: "hold", hadPendingInvoice: false, now })).toBe(true);

		expect(resumeBillsNow({ currentPeriodEnd: future, periodPaidBy: "plan", now })).toBe(false);
		expect(resumeBillsNow({ currentPeriodEnd: future, periodPaidBy: "hold", now })).toBe(true);
		expect(resumeBillsNow({ currentPeriodEnd: past, periodPaidBy: "plan", now })).toBe(true);
		expect(resumeBillsNow({ currentPeriodEnd: undefined, periodPaidBy: undefined, now })).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

const customer = { name: "Aisha", waPhone: "60123456789" };
const validAddress = {
	line1: "12 Jln Mawar 3",
	city: "Petaling Jaya",
	state: "Selangor",
	postcode: "47301",
};

/** A PAID Pro seller: active, period bought by the plan, running for 20 days. */
async function seedPaidSeller(
	t: ReturnType<typeof setup>,
	userId: string,
	overrides: Partial<Doc<"subscriptions">> = {},
) {
	const asUser = t.withIdentity({ subject: userId });
	const slug = `hold-${userId.replace(/[^a-z0-9]/g, "")}`;
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: `Store ${slug}`,
		slug,
	});
	const productId = await asUser.mutation(api.products.create, {
		retailerId: (await asUser.query(api.retailers.getMyRetailer))!._id,
		name: "Kuih Box",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: false,
		requiresProof: false,
		variants: [{ optionValues: [], price: 2500, onHand: 100 }],
	});
	const ids = await t.run(async (ctx) => {
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
		await ctx.db.patch(sub._id, {
			status: "active",
			currentPeriodStart: now - 10 * DAY,
			currentPeriodEnd: now + 20 * DAY,
			periodPaidBy: "plan",
			...overrides,
		});
		return { retailerId: r._id, subId: sub._id, slug };
	});
	return { ...ids, userId, productId };
}

const getSub = (t: ReturnType<typeof setup>, id: Id<"subscriptions">) =>
	t.run((ctx) => ctx.db.get(id));
const getRetailer = (t: ReturnType<typeof setup>, id: Id<"retailers">) =>
	t.run((ctx) => ctx.db.get(id));
const invoicesFor = (t: ReturnType<typeof setup>, retailerId: Id<"retailers">) =>
	t.run((ctx) =>
		ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.collect(),
	);
const pendingFor = async (t: ReturnType<typeof setup>, retailerId: Id<"retailers">) =>
	(await invoicesFor(t, retailerId)).find((i) => i.status === "pending");
const placeOrder = (
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	productId: Id<"products">,
) =>
	t.mutation(api.orders.create, {
		retailerId,
		items: [{ productId, quantity: 1 }],
		currency: "MYR",
		channel: "whatsapp",
		customer,
		deliveryAddress: validAddress,
	});
const cron = (t: ReturnType<typeof setup>) =>
	t.mutation(internal.subscriptions.internalDailyBillingStatus, {});
const issueForced = (t: ReturnType<typeof setup>, subscriptionId: Id<"subscriptions">) =>
	t.mutation(internal.invoices.internalIssueRenewalInvoice, {
		subscriptionId,
		force: true,
	});

describe("pause — a paid seller paused through their paid period", () => {
	test("status on_hold, ordering paused on the STORE, nothing billed until the paid period ends", async () => {
		const t = setup();
		const s = await seedPaidSeller(t, "u_pause");
		const asUser = t.withIdentity({ subject: s.userId });

		const res = await asUser.mutation(api.subscriptions.setSeasonalHold, {
			retailerId: s.retailerId,
			hold: true,
		});
		expect(res).toEqual({ status: "on_hold", invoiceIssued: false });

		const sub = await getSub(t, s.subId);
		expect(sub?.status).toBe("on_hold");
		expect(sub?.heldAt).toBeTypeOf("number");
		expect(sub?.plan).toBe("pro"); // the tier it resumes to
		expect((await getRetailer(t, s.retailerId))?.orderingPausedAt).toBeTypeOf("number");
		expect(await pendingFor(t, s.retailerId)).toBeUndefined();

		// Owner payload: held, effective cap 0, NOT frozen, tier features intact.
		const me = await asUser.query(api.retailers.getMyRetailer, {});
		expect(me?.subscription?.held).toBe(true);
		expect(me?.subscription?.frozen).toBe(false);
		expect(me?.subscription?.caps.orderCap).toBe(0);
		expect(me?.subscription?.features.crm).toBe(true);
		expect(me?.orderingPaused).toBe(true);

		// Buyer payload: the pause is visible, the subscription is not.
		const pub = await t.query(api.retailers.getRetailerBySlug, { slug: s.slug });
		expect(pub.status === "ok" && pub.retailer.orderingPaused).toBe(true);
		expect(pub.status === "ok" && "subscription" in pub.retailer).toBe(false);
	});

	test("every order-create path refuses while paused, with the buyer-facing reason", async () => {
		const t = setup();
		const s = await seedPaidSeller(t, "u_refuse");
		const asUser = t.withIdentity({ subject: s.userId });
		await asUser.mutation(api.subscriptions.setSeasonalHold, {
			retailerId: s.retailerId,
			hold: true,
		});
		await expect(placeOrder(t, s.retailerId, s.productId)).rejects.toThrow(
			/seasonal break/,
		);
		await expect(
			asUser.mutation(api.counterCheckout.startAnonymousSession, {}),
		).rejects.toThrow(/seasonal break/);
		await expect(
			asUser.mutation(api.counterCheckout.bindSessionManualPhone, {
				waPhone: "60123456789",
				name: "Walk-in",
			}),
		).rejects.toThrow(/seasonal break/);
		// Editing the store stays live — the hold is not a soft-lock.
		await expect(
			asUser.mutation(api.retailers.updateSettings, {
				retailerId: s.retailerId,
				storeDescription: "Back in December",
			}),
		).resolves.toBeDefined();
	});

	test("the cron bills the HOLD at period end — flat price, no founding discount — and settling it keeps the store on hold", async () => {
		const t = setup();
		const s = await seedPaidSeller(t, "u_cronhold");
		await t.run((ctx) =>
			ctx.db.patch(s.retailerId, { isFoundingMember: true, foundingMemberRank: 2 }),
		);
		const asUser = t.withIdentity({ subject: s.userId });
		await asUser.mutation(api.subscriptions.setSeasonalHold, {
			retailerId: s.retailerId,
			hold: true,
		});
		// Mid-period: nothing to bill yet.
		expect((await cron(t)).renewalsIssued).toBe(0);

		// Period end arrives → the cron issues the hold renewal.
		await t.run((ctx) => ctx.db.patch(s.subId, { currentPeriodEnd: Date.now() - 1000 }));
		expect((await cron(t)).renewalsIssued).toBe(1);
		const issued = await t.mutation(internal.invoices.internalIssueRenewalInvoice, {
			subscriptionId: s.subId,
		});
		expect(issued.issued).toBe(true);
		const hold = await pendingFor(t, s.retailerId);
		expect(hold).toMatchObject({
			kind: "hold",
			plan: "pro",
			billingCycle: "monthly",
			total: 1900,
			amount: 1900,
			currency: "MYR",
			origin: "auto_renewal",
		});
		expect(hold?.foundingDiscount).toBeUndefined();

		// Settling a hold invoice buys a paused month — still on hold.
		await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.invoices.markPaid, { invoiceId: hold!._id });
		const sub = await getSub(t, s.subId);
		expect(sub?.status).toBe("on_hold");
		expect(sub?.periodPaidBy).toBe("hold");
		expect(sub?.plan).toBe("pro");
		expect(sub?.orderCap).toBe(200); // stored caps stay the tier's
		expect((sub?.currentPeriodEnd ?? 0) - Date.now()).toBeGreaterThan(29 * DAY);
		expect((await getRetailer(t, s.retailerId))?.orderingPausedAt).toBeTypeOf("number");
		// Month rollover while held: the next period end bills the hold again.
		await t.run((ctx) => ctx.db.patch(s.subId, { currentPeriodEnd: Date.now() - 1000 }));
		expect((await cron(t)).renewalsIssued).toBe(1);
	});
});

describe("resume", () => {
	test("inside a hold-bought period: the tier is back at once, the tier invoice issues now (hold days forfeited), orders flow again", async () => {
		const t = setup();
		const s = await seedPaidSeller(t, "u_resume", {
			status: "on_hold",
			heldAt: Date.now() - 5 * DAY,
			periodPaidBy: "hold",
		});
		await t.run((ctx) => ctx.db.patch(s.retailerId, { orderingPausedAt: Date.now() - 5 * DAY }));
		await t.run((ctx) =>
			ctx.db.patch(s.retailerId, { isFoundingMember: true, foundingMemberRank: 4 }),
		);
		const asUser = t.withIdentity({ subject: s.userId });

		const res = await asUser.mutation(api.subscriptions.setSeasonalHold, {
			retailerId: s.retailerId,
			hold: false,
		});
		expect(res).toEqual({ status: "active", invoiceIssued: true });
		const sub = await getSub(t, s.subId);
		expect(sub?.status).toBe("active");
		expect(sub?.heldAt).toBeUndefined();
		expect((await getRetailer(t, s.retailerId))?.orderingPausedAt).toBeUndefined();

		await issueForced(t, s.subId);
		const plan = await pendingFor(t, s.retailerId);
		expect(plan).toMatchObject({ plan: "pro", origin: "self_serve", currency: "MYR" });
		expect(plan?.kind).toBeUndefined();
		// A claimed founding member resumes at their founding price.
		expect(plan?.total).toBe(10400);
		expect(plan?.foundingDiscount).toBe(4500);

		await expect(placeOrder(t, s.retailerId, s.productId)).resolves.toBeDefined();
	});

	test("inside a plan-bought period: the tier is back and nothing is billed", async () => {
		const t = setup();
		const s = await seedPaidSeller(t, "u_resumeplan", {
			status: "on_hold",
			heldAt: Date.now() - DAY,
			periodPaidBy: "plan",
		});
		await t.run((ctx) => ctx.db.patch(s.retailerId, { orderingPausedAt: Date.now() - DAY }));
		const res = await t
			.withIdentity({ subject: s.userId })
			.mutation(api.subscriptions.setSeasonalHold, { retailerId: s.retailerId, hold: false });
		expect(res).toEqual({ status: "active", invoiceIssued: false });
		expect(await pendingFor(t, s.retailerId)).toBeUndefined();
		expect((await getSub(t, s.subId))?.status).toBe("active");
	});

	test("an overdue hold invoice locks; resuming from that lock voids the hold bill and issues the tier bill", async () => {
		const t = setup();
		const s = await seedPaidSeller(t, "u_holdlock", {
			status: "on_hold",
			heldAt: Date.now() - 40 * DAY,
			periodPaidBy: "hold",
			currentPeriodEnd: Date.now() - 20 * DAY,
		});
		await t.run((ctx) => ctx.db.patch(s.retailerId, { orderingPausedAt: Date.now() - 40 * DAY }));
		// The cron issues the hold renewal; make it overdue.
		await t.mutation(internal.invoices.internalIssueRenewalInvoice, { subscriptionId: s.subId });
		const hold = await pendingFor(t, s.retailerId);
		expect(hold?.kind).toBe("hold");
		await t.run((ctx) => ctx.db.patch(hold!._id, { dueDate: Date.now() - 1000 }));
		expect((await cron(t)).overdue).toBe(1);
		expect((await getSub(t, s.subId))?.status).toBe("past_due");
		// Locked, and still paused for buyers.
		expect((await getRetailer(t, s.retailerId))?.orderingPausedAt).toBeTypeOf("number");

		const res = await t
			.withIdentity({ subject: s.userId })
			.mutation(api.subscriptions.setSeasonalHold, { retailerId: s.retailerId, hold: false });
		expect(res).toEqual({ status: "active", invoiceIssued: true });
		const all = await invoicesFor(t, s.retailerId);
		expect(all.find((i) => i._id === hold!._id)?.status).toBe("void");
		await issueForced(t, s.subId);
		const plan = await pendingFor(t, s.retailerId);
		expect(plan).toMatchObject({ plan: "pro", total: 14900 });
		expect(plan?.kind).toBeUndefined();
	});
});

describe("pause with money on the table", () => {
	test("a pending PLAN invoice is voided and the hold invoice issues at once", async () => {
		const t = setup();
		const s = await seedPaidSeller(t, "u_pendplan", {
			currentPeriodEnd: Date.now() - 1000,
		});
		await t.mutation(internal.invoices.internalIssueRenewalInvoice, { subscriptionId: s.subId });
		const planInv = await pendingFor(t, s.retailerId);
		expect(planInv?.total).toBe(14900);

		const res = await t
			.withIdentity({ subject: s.userId })
			.mutation(api.subscriptions.setSeasonalHold, { retailerId: s.retailerId, hold: true });
		expect(res).toEqual({ status: "on_hold", invoiceIssued: true });
		const voided = (await invoicesFor(t, s.retailerId)).find((i) => i._id === planInv!._id);
		expect(voided?.status).toBe("void");
		expect(voided?.voidReason).toMatch(/Paused for the season/);
		await issueForced(t, s.subId);
		const hold = await pendingFor(t, s.retailerId);
		expect(hold).toMatchObject({ kind: "hold", total: 1900, origin: "self_serve" });
	});

	test("a seller locked over an unpaid PLAN invoice can pause instead — the lock lifts, the hold bills now", async () => {
		const t = setup();
		const s = await seedPaidSeller(t, "u_pastdue", {
			status: "past_due",
			currentPeriodEnd: Date.now() - 10 * DAY,
		});
		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert("invoices", {
				retailerId: s.retailerId,
				subscriptionId: s.subId,
				invoiceNumber: "INV-PD-1",
				plan: "pro",
				billingCycle: "monthly",
				amount: 14900,
				total: 14900,
				currency: "MYR",
				periodStart: now - 24 * DAY,
				periodEnd: now + 6 * DAY,
				dueDate: now - 10 * DAY,
				status: "pending",
				origin: "auto_renewal",
				createdAt: now - 24 * DAY,
			});
		});
		const res = await t
			.withIdentity({ subject: s.userId })
			.mutation(api.subscriptions.setSeasonalHold, { retailerId: s.retailerId, hold: true });
		expect(res).toEqual({ status: "on_hold", invoiceIssued: true });
		expect((await getSub(t, s.subId))?.status).toBe("on_hold");
		const me = await t.withIdentity({ subject: s.userId }).query(api.retailers.getMyRetailer, {});
		expect(me?.subscription?.frozen).toBe(false);
	});
});

describe("rate limiting", () => {
	test("the toggle shares the money-adjacent self-serve limiter — a held button can't mint invoices, gateway requests and emails", async () => {
		const t = setup();
		const s = await seedPaidSeller(t, "u_rl");
		// Drain the same bucket switchPendingPlan uses, keyed by STORE (so admin
		// act-as shares the seller's budget rather than getting a fresh one).
		await t.run(async (ctx) => {
			await rateLimiter.limit(ctx, "billingSelfServe", {
				key: s.retailerId,
				count: 4,
			});
		});
		const refused = await t
			.withIdentity({ subject: s.userId })
			.mutation(api.subscriptions.setSeasonalHold, {
				retailerId: s.retailerId,
				hold: true,
			})
			.then(() => null)
			.catch((e: unknown) => e as { data?: unknown });
		expect(String(refused?.data)).toContain('\\"kind\\":\\"RateLimited\\"');
		expect(String(refused?.data)).toContain('\\"name\\":\\"billingSelfServe\\"');
		// Refused BEFORE any state moved — no half-pause.
		expect((await getSub(t, s.subId))?.status).toBe("active");
		expect((await getRetailer(t, s.retailerId))?.orderingPausedAt).toBeUndefined();
	});
});

/**
 * Where the hold meets the 86eyb6z4r mid-cycle machinery (reconciled 14 Sep).
 * Both of these merged CLEANLY and were silently wrong — that is exactly why
 * they are pinned.
 */
describe("hold × mid-cycle tier changes", () => {
	test("resuming from a hold-bought period grants NO carryover — RM19 must not buy Pro days", async () => {
		const t = setup();
		// A hold-bought month with most of it still to run: the naive merge
		// valued those days at the PRO rate (`fromPlan` reads the tier), handing
		// back ~29 free Pro days for RM19.
		const s = await seedPaidSeller(t, "u_carry", {
			status: "on_hold",
			heldAt: Date.now() - DAY,
			periodPaidBy: "hold",
			currentPeriodEnd: Date.now() + 29 * DAY,
		});
		await t.run((ctx) =>
			ctx.db.patch(s.retailerId, { orderingPausedAt: Date.now() - DAY }),
		);
		await t
			.withIdentity({ subject: s.userId })
			.mutation(api.subscriptions.setSeasonalHold, {
				retailerId: s.retailerId,
				hold: false,
			});
		await issueForced(t, s.subId);
		const inv = await pendingFor(t, s.retailerId);
		await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.invoices.markPaid, { invoiceId: inv!._id });

		const sub = await getSub(t, s.subId);
		expect(sub?.status).toBe("active");
		expect(sub?.periodPaidBy).toBe("plan");
		// A flat month, not a month + 29 carried days.
		const granted = ((sub?.currentPeriodEnd ?? 0) - Date.now()) / DAY;
		expect(granted).toBeGreaterThan(29.9);
		expect(granted).toBeLessThan(30.1);
	});

	test("settling a HOLD invoice never carries a running plan period into hold days", async () => {
		const t = setup();
		// Paid Pro well into the future, then paused with a bill already pending
		// (the one path that bills the hold immediately).
		const s = await seedPaidSeller(t, "u_carry2");
		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert("invoices", {
				retailerId: s.retailerId,
				subscriptionId: s.subId,
				invoiceNumber: "INV-PLAN-CARRY",
				plan: "pro" as const,
				billingCycle: "monthly" as const,
				amount: 14900,
				total: 14900,
				currency: "MYR",
				periodStart: now,
				periodEnd: now + 30 * DAY,
				dueDate: now + 10 * DAY,
				status: "pending" as const,
				origin: "auto_renewal" as const,
				createdAt: now,
			});
		});
		await t
			.withIdentity({ subject: s.userId })
			.mutation(api.subscriptions.setSeasonalHold, {
				retailerId: s.retailerId,
				hold: true,
			});
		await issueForced(t, s.subId);
		const hold = await pendingFor(t, s.retailerId);
		expect(hold?.kind).toBe("hold");
		await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.invoices.markPaid, { invoiceId: hold!._id });

		const sub = await getSub(t, s.subId);
		expect(sub?.status).toBe("on_hold");
		expect(sub?.periodPaidBy).toBe("hold");
		// One flat hold month — the 20 unused Pro days are not converted.
		const granted = ((sub?.currentPeriodEnd ?? 0) - Date.now()) / DAY;
		expect(granted).toBeGreaterThan(29.9);
		expect(granted).toBeLessThan(30.1);
	});

	test("a hold renewal leaves a SCHEDULED downgrade scheduled — it lands on the first tier bill after resume", async () => {
		const t = setup();
		const s = await seedPaidSeller(t, "u_sched", {
			status: "on_hold",
			heldAt: Date.now() - 40 * DAY,
			periodPaidBy: "hold",
			currentPeriodEnd: Date.now() - 1000,
		});
		await t.run((ctx) =>
			ctx.db.patch(s.subId, {
				pendingPlanChange: { plan: "starter" as const, requestedAt: Date.now() },
			}),
		);
		// The hold renews as a HOLD — it charges the flat price and settle leaves
		// the tier alone, so consuming the flag here would delete a downgrade the
		// seller never actually received.
		await t.mutation(internal.invoices.internalIssueRenewalInvoice, {
			subscriptionId: s.subId,
		});
		const hold = await pendingFor(t, s.retailerId);
		expect(hold?.kind).toBe("hold");
		expect(hold?.plan).toBe("pro"); // the tier they resume to, not the target
		expect((await getSub(t, s.subId))?.pendingPlanChange?.plan).toBe("starter");

		// Settling the hold still doesn't apply or clear it.
		await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.invoices.markPaid, { invoiceId: hold!._id });
		const afterHold = await getSub(t, s.subId);
		expect(afterHold?.plan).toBe("pro");
		expect(afterHold?.pendingPlanChange?.plan).toBe("starter");

		// The next TIER bill is the one that carries it.
		await t.run((ctx) => ctx.db.patch(s.subId, { currentPeriodEnd: Date.now() - 1000 }));
		await t
			.withIdentity({ subject: s.userId })
			.mutation(api.subscriptions.setSeasonalHold, {
				retailerId: s.retailerId,
				hold: false,
			});
		await issueForced(t, s.subId);
		const tierBill = await pendingFor(t, s.retailerId);
		expect(tierBill?.kind).toBeUndefined();
		expect(tierBill?.plan).toBe("starter");
		expect((await getSub(t, s.subId))?.pendingPlanChange).toBeUndefined();
	});
});

describe("refusals + admin act-as", () => {
	test("trials, comped rows, double-pause and resume-when-not-held are refused", async () => {
		const t = setup();
		const trial = await seedPaidSeller(t, "u_trialref", { status: "trialing" });
		const asTrial = t.withIdentity({ subject: trial.userId });
		await expect(
			asTrial.mutation(api.subscriptions.setSeasonalHold, { retailerId: trial.retailerId, hold: true }),
		).rejects.toThrow(/paid plans/);
		await expect(
			asTrial.mutation(api.subscriptions.setSeasonalHold, { retailerId: trial.retailerId, hold: false }),
		).rejects.toThrow(/isn't on hold/);

		const comped = await seedPaidSeller(t, "u_compref", { comped: true });
		await expect(
			t.withIdentity({ subject: comped.userId }).mutation(api.subscriptions.setSeasonalHold, {
				retailerId: comped.retailerId,
				hold: true,
			}),
		).rejects.toThrow(/on the house/);

		const held = await seedPaidSeller(t, "u_dbl", { status: "on_hold", heldAt: Date.now() });
		await expect(
			t.withIdentity({ subject: held.userId }).mutation(api.subscriptions.setSeasonalHold, {
				retailerId: held.retailerId,
				hold: true,
			}),
		).rejects.toThrow(/already on hold/);

		// A lock over an unpaid PLAN invoice is not a hold to resume from.
		const locked = await seedPaidSeller(t, "u_lockplan", { status: "past_due" });
		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert("invoices", {
				retailerId: locked.retailerId,
				subscriptionId: locked.subId,
				invoiceNumber: "INV-LP-1",
				plan: "pro",
				amount: 14900,
				total: 14900,
				currency: "MYR",
				periodStart: now,
				periodEnd: now + 30 * DAY,
				dueDate: now - DAY,
				status: "pending",
				createdAt: now,
			});
		});
		await expect(
			t.withIdentity({ subject: locked.userId }).mutation(api.subscriptions.setSeasonalHold, {
				retailerId: locked.retailerId,
				hold: false,
			}),
		).rejects.toThrow(/unpaid plan invoice/);
	});

	test("a Kedaipal admin can pause and resume a seller's store (white-glove); a stranger cannot", async () => {
		const t = setup();
		const s = await seedPaidSeller(t, "u_actas");
		const asAdmin = t.withIdentity({ subject: ADMIN });
		await asAdmin.mutation(api.subscriptions.setSeasonalHold, { retailerId: s.retailerId, hold: true });
		expect((await getSub(t, s.subId))?.status).toBe("on_hold");
		await asAdmin.mutation(api.subscriptions.setSeasonalHold, { retailerId: s.retailerId, hold: false });
		expect((await getSub(t, s.subId))?.status).toBe("active");
		await expect(
			t.withIdentity({ subject: "user_stranger" }).mutation(api.subscriptions.setSeasonalHold, {
				retailerId: s.retailerId,
				hold: true,
			}),
		).rejects.toThrow(/Forbidden/);
	});
});
