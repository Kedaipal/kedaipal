/// <reference types="vite/client" />
/**
 * HitPay subscription payments (86eyb6z4r): self-serve invoices, the Pay-now
 * mint, tokenised auto-renewal (attach → charge → dunning → reconcile), the
 * gateway settle's idempotency + founding claim, and both webhook branches.
 * Fetch is always stubbed — no test touches the network; the fake-timer
 * rules follow hitpay.test.ts (timers on BEFORE convexTest when scheduled
 * functions will be flushed).
 */
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
import { computeHitpayHmac } from "./lib/hitpay";
import schema from "./schema";
import { resolveAccess } from "./subscriptions";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const ADMIN = "user_admin";
const BILLING_KEY = "test_billing_key_123";
const BILLING_SALT = "billing_salt_xyz";

let prevAdminEnv: string | undefined;
beforeAll(() => {
	prevAdminEnv = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
});
afterAll(() => {
	process.env.ADMIN_USER_IDS = prevAdminEnv;
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

function stubBillingEnv() {
	vi.stubEnv("HITPAY_BILLING_API_KEY", BILLING_KEY);
	vi.stubEnv("HITPAY_BILLING_SALT", BILLING_SALT);
}

/** A retailer on the default signup trial, with the notify email set (HitPay
 * needs one for saved-method sessions). */
async function seedRetailer(t: ReturnType<typeof setup>, userId: string, slug: string) {
	const asUser = t.withIdentity({ subject: userId, email: `${userId}@x.com` });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: `Store ${slug}`,
		slug,
	});
	return t.run(async (ctx) => {
		const r = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", slug))
			.first();
		if (!r) throw new Error("no retailer");
		await ctx.db.patch(r._id, { notifyEmail: `${userId}@x.com` });
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", r._id))
			.first();
		if (!sub) throw new Error("no sub");
		return { retailerId: r._id, subId: sub._id };
	});
}

/** Flip the sub to a paid, ACTIVE state with a saved method attached. */
async function attachAutoRenew(
	t: ReturnType<typeof setup>,
	subId: Id<"subscriptions">,
	overrides: Record<string, unknown> = {},
) {
	await t.run(async (ctx) => {
		const now = Date.now();
		await ctx.db.patch(subId, {
			status: "active",
			currentPeriodStart: now - 30 * 86400000,
			currentPeriodEnd: now - 1000,
			autoRenewSessionId: "rb_1",
			autoRenew: {
				provider: "hitpay" as const,
				method: "card",
				methodLabel: "Visa ·· 4242",
				attachedAt: now - 30 * 86400000,
				timesCharged: 0,
				...overrides,
			},
		});
	});
}

/** A machine-issued renewal invoice (the shape the cron writes). */
async function seedRenewalInvoice(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	subId: Id<"subscriptions">,
	overrides: Record<string, unknown> = {},
) {
	return t.run(async (ctx) => {
		const now = Date.now();
		return ctx.db.insert("invoices", {
			retailerId,
			subscriptionId: subId,
			invoiceNumber: "INV-REN-1",
			plan: "pro" as const,
			billingCycle: "monthly" as const,
			amount: 14900,
			total: 14900,
			currency: "MYR",
			periodStart: now,
			periodEnd: now + 30 * 86400000,
			dueDate: now + 14 * 86400000,
			status: "pending" as const,
			origin: "auto_renewal" as const,
			createdAt: now,
			...overrides,
		});
	});
}

const getInvoice = (t: ReturnType<typeof setup>, id: Id<"invoices">) =>
	t.run(async (ctx) => ctx.db.get(id));
const getSub = (t: ReturnType<typeof setup>, id: Id<"subscriptions">) =>
	t.run(async (ctx) => ctx.db.get(id));

// ---------------------------------------------------------------------------

describe("billingGatewayAvailable", () => {
	test("off without env credentials, on with them (methods per currency)", async () => {
		const t = setup();
		await seedRetailer(t, "u_cap", "cap-store");
		const asUser = t.withIdentity({ subject: "u_cap" });

		const off = await asUser.query(api.subscriptionPayments.billingGatewayAvailable, {});
		expect(off).toMatchObject({ payNow: false, autoRenew: false });

		stubBillingEnv();
		const on = await asUser.query(api.subscriptionPayments.billingGatewayAvailable, {});
		expect(on).toMatchObject({
			payNow: true,
			autoRenew: true,
			currency: "MYR",
			methods: ["card", "touch_n_go"],
		});
	});
});

/**
 * z8r3fdfty4 — a founding member was quoted list price on the billing page.
 * The trigger Arif hit was admin act-as (every billing read resolved the
 * ADMIN's own store), and underneath it the page priced founding three ways.
 * These pin the server half: one resolved founding flag, one renewal quote
 * that every surface reads, act-as reads of the SELLER's store, and the
 * founding plan lock.
 */
describe("billing page prices — server-resolved, act-as aware (z8r3fdfty4)", () => {
	const DAY = 86400000;

	/** A paying store the v1 way: founding is ADMIN-MARKED (rank + flag on the
	 * retailer, `foundingIntent` never set) — most of the real cohort. */
	async function seedPaying(
		t: ReturnType<typeof setup>,
		userId: string,
		slug: string,
		opts: {
			country?: "MY" | "SG";
			founding?: boolean;
			status?: "active" | "past_due" | "on_hold";
			cycle?: "monthly" | "annual";
			/** Days since the paid period ended (negative = still running). */
			lapsedDays?: number;
			lastPaidCurrency?: "MYR" | "SGD";
			pendingPlanChange?: "starter";
		} = {},
	) {
		const { retailerId, subId } = await seedRetailer(t, userId, slug);
		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.patch(retailerId, {
				country: opts.country ?? "MY",
				...(opts.founding
					? { isFoundingMember: true, foundingMemberRank: 2 }
					: {}),
			});
			await ctx.db.patch(subId, {
				status: opts.status ?? "active",
				plan: "pro",
				billingCycle: opts.cycle ?? "monthly",
				currentPeriodStart: now - 30 * DAY,
				currentPeriodEnd: now - (opts.lapsedDays ?? 0) * DAY - 1000,
				...(opts.pendingPlanChange
					? {
							pendingPlanChange: {
								plan: opts.pendingPlanChange,
								requestedAt: now - DAY,
							},
						}
					: {}),
			});
			await ctx.db.insert("invoices", {
				retailerId,
				subscriptionId: subId,
				invoiceNumber: `INV-PAID-${slug}`,
				plan: "pro",
				billingCycle: opts.cycle ?? "monthly",
				amount: 14900,
				total: 10400,
				currency:
					opts.lastPaidCurrency ?? (opts.country === "SG" ? "SGD" : "MYR"),
				periodStart: now - 30 * DAY,
				periodEnd: now,
				dueDate: now - 20 * DAY,
				status: "paid",
				origin: "admin",
				createdAt: now - 30 * DAY,
			});
		});
		return { retailerId, subId, asUser: t.withIdentity({ subject: userId }) };
	}

	test("an admin-marked founding member is on founding pricing: MY RM104, SG S$41", async () => {
		const t = setup();
		const my = await seedPaying(t, "u_fmy", "fmy-store", { founding: true });
		expect(
			await my.asUser.query(api.subscriptionPayments.billingGatewayAvailable, {}),
		).toMatchObject({
			currency: "MYR",
			renewalCurrency: "MYR",
			foundingPricing: true,
			foundingPricingLapsed: false,
			nextRenewal: { plan: "pro", founding: true, amount: 10400, currency: "MYR" },
		});
		const sg = await seedPaying(t, "u_fsg", "fsg-store", {
			founding: true,
			country: "SG",
		});
		expect(
			await sg.asUser.query(api.subscriptionPayments.billingGatewayAvailable, {}),
		).toMatchObject({
			currency: "SGD",
			foundingPricing: true,
			nextRenewal: { amount: 4100, currency: "SGD" },
		});
		// And a list seller is untouched.
		const list = await seedPaying(t, "u_lsg", "lsg-store", { country: "SG" });
		expect(
			await list.asUser.query(api.subscriptionPayments.billingGatewayAvailable, {}),
		).toMatchObject({
			foundingPricing: false,
			foundingPricingLapsed: false,
			nextRenewal: { founding: false, amount: 5900, currency: "SGD" },
		});
	});

	test("act-as reads the SELLER's store — not the admin's own (the reported repro)", async () => {
		const t = setup();
		// The admin runs their own (MY, list-price) store…
		await seedPaying(t, ADMIN, "admin-own-store");
		// …and opens a Singapore founding member's billing tab.
		const seller = await seedPaying(t, "u_fseller", "fseller-store", {
			founding: true,
			country: "SG",
		});
		const asAdmin = t.withIdentity({ subject: ADMIN });

		// Without the id, the query answers for the caller — what the tab did.
		const own = await asAdmin.query(
			api.subscriptionPayments.billingGatewayAvailable,
			{},
		);
		expect(own).toMatchObject({ currency: "MYR", foundingPricing: false });

		const theirs = await asAdmin.query(
			api.subscriptionPayments.billingGatewayAvailable,
			{ retailerId: seller.retailerId },
		);
		expect(theirs).toMatchObject({
			currency: "SGD",
			foundingPricing: true,
			nextRenewal: { amount: 4100, currency: "SGD" },
		});

		const invoices = await asAdmin.query(api.invoices.myInvoices, {
			retailerId: seller.retailerId,
		});
		expect(invoices.map((i) => i.invoiceNumber)).toEqual([
			"INV-PAID-fseller-store",
		]);
		expect(
			(await asAdmin.query(api.invoices.myInvoices, {})).map(
				(i) => i.invoiceNumber,
			),
		).toEqual(["INV-PAID-admin-own-store"]);
	});

	test("a non-admin can't read another store's billing through the act-as argument", async () => {
		const t = setup();
		const seller = await seedPaying(t, "u_victim", "victim-store", {
			founding: true,
		});
		await seedRetailer(t, "u_nosy", "nosy-store");
		const asNosy = t.withIdentity({ subject: "u_nosy" });
		await expect(
			asNosy.query(api.subscriptionPayments.billingGatewayAvailable, {
				retailerId: seller.retailerId,
			}),
		).rejects.toThrow(/Forbidden/);
		await expect(
			asNosy.query(api.invoices.myInvoices, { retailerId: seller.retailerId }),
		).rejects.toThrow(/Forbidden/);
		// The owner passing their OWN id is fine (same answer as omitting it).
		expect(
			await seller.asUser.query(api.subscriptionPayments.billingGatewayAvailable, {
				retailerId: seller.retailerId,
			}),
		).toMatchObject({ foundingPricing: true });
	});

	test("a lapsed founding member reads list price with the lapse flag; a comped store gets no renewal quote", async () => {
		const t = setup();
		const lapsed = await seedPaying(t, "u_flapsed", "flapsed-store", {
			founding: true,
			status: "past_due",
			lapsedDays: 91,
		});
		expect(
			await lapsed.asUser.query(
				api.subscriptionPayments.billingGatewayAvailable,
				{},
			),
		).toMatchObject({
			foundingPricing: false,
			foundingPricingLapsed: true,
			nextRenewal: { founding: false, amount: 14900 },
		});
		const comped = await seedPaying(t, "u_comp", "comp-store");
		await t.run(async (ctx) => ctx.db.patch(comped.subId, { comped: true }));
		expect(
			await comped.asUser.query(
				api.subscriptionPayments.billingGatewayAvailable,
				{},
			),
		).toMatchObject({ nextRenewal: null });
	});

	// The ticket's money check, as a test: the number on the page, in the
	// heads-up email, on HitPay's authorisation page and on the renewal invoice
	// the cron writes are ONE number for the same seller.
	const QUOTE_CASES = [
		{ name: "MY founding, monthly", slug: "q-myf", opts: { founding: true } },
		{
			name: "SG founding, annual",
			slug: "q-sgfa",
			opts: { founding: true, country: "SG" as const, cycle: "annual" as const },
		},
		{
			name: "MY store billed in SGD (last paid invoice wins)",
			slug: "q-mysgd",
			opts: { founding: true, lastPaidCurrency: "SGD" as const },
		},
		{
			name: "founding member lapsed past 3 months",
			slug: "q-lapsed",
			opts: { founding: true, lapsedDays: 91 },
		},
		{
			name: "list seller with a scheduled downgrade",
			slug: "q-down",
			opts: { pendingPlanChange: "starter" as const },
		},
		{
			name: "founding member with a downgrade scheduled before the lock",
			slug: "q-fdown",
			opts: { founding: true, pendingPlanChange: "starter" as const },
		},
		{
			name: "SG founding member on Off-Season Hold",
			slug: "q-hold",
			opts: {
				founding: true,
				country: "SG" as const,
				status: "on_hold" as const,
			},
		},
	];
	for (const c of QUOTE_CASES) {
		test(`one number everywhere — ${c.name}`, async () => {
			const t = setup();
			stubBillingEnv();
			const userId = `u_${c.slug}`;
			const { retailerId, subId, asUser } = await seedPaying(
				t,
				userId,
				c.slug,
				c.opts,
			);
			const gateway = await asUser.query(
				api.subscriptionPayments.billingGatewayAvailable,
				{},
			);
			const quote = gateway?.nextRenewal;
			if (!quote) throw new Error("expected a renewal quote");

			const email = await t.query(
				internal.billingEmail.getAutoRenewEmailContext,
				{ retailerId },
			);
			expect(email?.amountFormatted).toBe(
				`${quote.currency} ${(quote.amount / 100).toFixed(2)}`,
			);

			const fetchMock = vi.fn(async (_url: unknown, _init?: { body?: unknown }) =>
				Response.json({ id: "rb_q", url: "https://auth.example/rb_q" }),
			);
			vi.stubGlobal("fetch", fetchMock);
			await t
				.withIdentity({ subject: userId, email: `${userId}@x.com` })
				.action(api.subscriptionPayments.startAutoRenewSetup, {});
			const body = new URLSearchParams(
				String(fetchMock.mock.calls[0]?.[1]?.body ?? ""),
			);
			expect(body.get("amount")).toBe((quote.amount / 100).toFixed(2));
			expect(body.get("currency")).toBe(quote.currency);

			await t.mutation(internal.invoices.internalIssueRenewalInvoice, {
				subscriptionId: subId,
			});
			const issued = await t.run(async (ctx) =>
				ctx.db
					.query("invoices")
					.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
					.filter((q) => q.eq(q.field("status"), "pending"))
					.first(),
			);
			expect(issued).toMatchObject({
				total: quote.amount,
				currency: quote.currency,
				plan: quote.plan,
			});
			// A plan invoice carries no `kind` field at all (absent reads "plan").
			expect(issued?.kind ?? "plan").toBe(quote.kind);
		});
	}

	test("Founding Members stay on Founding Pro: no Starter, no tier change — but yearly is fine", async () => {
		const t = setup();
		// Renewing after a short lapse (inside the window).
		const renewing = await seedPaying(t, "u_frenew", "frenew-store", {
			founding: true,
			status: "past_due",
			lapsedDays: 20,
		});
		await expect(
			renewing.asUser.mutation(api.invoices.subscribeSelf, {
				plan: "starter",
				billingCycle: "monthly",
			}),
		).rejects.toThrow(/Founding Members stay on Founding Pro/);
		// Switching CYCLE on the same founding tier is allowed (Zaki, 17 Sep).
		const { invoiceId } = await renewing.asUser.mutation(
			api.invoices.subscribeSelf,
			{ plan: "pro", billingCycle: "annual" },
		);
		expect(await getInvoice(t, invoiceId)).toMatchObject({
			total: 104000,
			billingCycle: "annual",
		});

		// An active member can't schedule a move down, and nothing is written.
		const active = await seedPaying(t, "u_factive", "factive-store", {
			founding: true,
			lapsedDays: -10,
		});
		await expect(
			active.asUser.mutation(api.invoices.changePlan, { plan: "starter" }),
		).rejects.toThrow(/Founding Members stay on Founding Pro/);
		expect((await getSub(t, active.subId))?.pendingPlanChange).toBeUndefined();
	});

	test("a founding member's pre-lock scheduled downgrade is cancelled: the renewal bills Founding Pro and clears it", async () => {
		const t = setup();
		const { retailerId, subId } = await seedPaying(t, "u_fsched", "fsched-store", {
			founding: true,
			pendingPlanChange: "starter",
		});
		await t.mutation(internal.invoices.internalIssueRenewalInvoice, {
			subscriptionId: subId,
		});
		const bill = await t.run(async (ctx) =>
			ctx.db
				.query("invoices")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.filter((q) => q.eq(q.field("status"), "pending"))
				.first(),
		);
		expect(bill).toMatchObject({ plan: "pro", total: 10400, foundingDiscount: 4500 });
		expect((await getSub(t, subId))?.pendingPlanChange).toBeUndefined();
	});

	test("a founding member's first invoice can't be switched to Starter — and the bill survives the refusal", async () => {
		const t = setup();
		const { retailerId, subId } = await seedRetailer(t, "u_ffirst", "ffirst-store");
		await t.run(async (ctx) => ctx.db.patch(subId, { foundingIntent: true }));
		const pendingId = await seedRenewalInvoice(t, retailerId, subId, {
			origin: "free_period_end" as const,
			total: 10400,
			foundingDiscount: 4500,
		});
		await expect(
			t
				.withIdentity({ subject: "u_ffirst" })
				.mutation(api.invoices.switchPendingPlan, { plan: "starter" }),
		).rejects.toThrow(/Founding Members stay on Founding Pro/);
		expect((await getInvoice(t, pendingId))?.status).toBe("pending");
	});

	test("once the founding price is revoked (lapsed past the window) the store picks like anyone", async () => {
		const t = setup();
		const revoked = await seedPaying(t, "u_frevoked", "frevoked-store", {
			founding: true,
			status: "past_due",
			lapsedDays: 120,
		});
		const { invoiceId } = await revoked.asUser.mutation(
			api.invoices.subscribeSelf,
			{ plan: "starter", billingCycle: "monthly" },
		);
		expect((await getInvoice(t, invoiceId))?.total).toBe(7900);
	});
});

describe("subscribeSelf", () => {
	test("creates the pending invoice at list price (origin self_serve)", async () => {
		const t = setup();
		const { retailerId } = await seedRetailer(t, "u_self", "self-store");
		const { invoiceId } = await t
			.withIdentity({ subject: "u_self" })
			.mutation(api.invoices.subscribeSelf, {
				plan: "pro",
				billingCycle: "monthly",
			});
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice).toMatchObject({
			retailerId,
			status: "pending",
			origin: "self_serve",
			plan: "pro",
			total: 14900,
			currency: "MYR",
		});
		expect(invoice?.foundingDiscount).toBeUndefined();
	});

	test("annual bills 10 months' price; founding intent keeps the promised 30%", async () => {
		const t = setup();
		const { subId } = await seedRetailer(t, "u_ann", "ann-store");
		await t.run(async (ctx) => ctx.db.patch(subId, { foundingIntent: true }));
		const { invoiceId } = await t
			.withIdentity({ subject: "u_ann" })
			.mutation(api.invoices.subscribeSelf, {
				plan: "pro",
				billingCycle: "annual",
			});
		const invoice = await getInvoice(t, invoiceId);
		// Founding Pro monthly 10400 × 10 months.
		expect(invoice?.total).toBe(104000);
		expect(invoice?.foundingDiscount).toBe(45000);
	});

	test("a founding member lapsed >3 months bills at LIST price — and is told why (86eyb6z4r follow-up)", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_flap", "flap-store");
		// A claimed founding member (rank stamped, intent never cleared) whose
		// paid period ended 4 months ago.
		await t.run(async (ctx) => {
			await ctx.db.patch(retailerId, {
				isFoundingMember: true,
				foundingMemberRank: 3,
			});
			await ctx.db.patch(subId, {
				status: "past_due" as const,
				foundingIntent: true,
				currentPeriodEnd: Date.now() - 120 * 86400000,
			});
		});
		const asUser = t.withIdentity({ subject: "u_flap" });
		// The picker's server-resolved flags say: no founding price, and here's why.
		const gateway = await asUser.query(
			api.subscriptionPayments.billingGatewayAvailable,
			{},
		);
		expect(gateway).toMatchObject({
			foundingPricing: false,
			foundingPricingLapsed: true,
		});
		const { invoiceId } = await asUser.mutation(api.invoices.subscribeSelf, {
			plan: "pro",
			billingCycle: "monthly",
		});
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.total).toBe(14900); // list, not 10400
		expect(invoice?.foundingDiscount).toBeUndefined();
	});

	test("a founding member inside the 3-month window still renews at the founding price", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_fok", "fok-store");
		await t.run(async (ctx) => {
			await ctx.db.patch(retailerId, {
				isFoundingMember: true,
				foundingMemberRank: 4,
			});
			await ctx.db.patch(subId, {
				status: "past_due" as const,
				foundingIntent: true,
				currentPeriodEnd: Date.now() - 30 * 86400000,
			});
		});
		const asUser = t.withIdentity({ subject: "u_fok" });
		const gateway = await asUser.query(
			api.subscriptionPayments.billingGatewayAvailable,
			{},
		);
		expect(gateway).toMatchObject({
			foundingPricing: true,
			foundingPricingLapsed: false,
		});
		const { invoiceId } = await asUser.mutation(api.invoices.subscribeSelf, {
			plan: "pro",
			billingCycle: "monthly",
		});
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.total).toBe(10400);
		expect(invoice?.foundingDiscount).toBe(4500);
	});

	test("Scale is self-serve: monthly in MYR at RM399, annual in SGD at S$1,490 (z8r3fdfuhq)", async () => {
		const t = setup();
		const { retailerId } = await seedRetailer(t, "u_sc_my", "sc-my-store");
		const { invoiceId } = await t
			.withIdentity({ subject: "u_sc_my" })
			.mutation(api.invoices.subscribeSelf, {
				plan: "scale",
				billingCycle: "monthly",
			});
		expect(await getInvoice(t, invoiceId)).toMatchObject({
			retailerId,
			plan: "scale",
			billingCycle: "monthly",
			total: 39900,
			currency: "MYR",
			origin: "self_serve",
		});

		const sg = await seedRetailer(t, "u_sc_sg", "sc-sg-store");
		await t.run(async (ctx) => ctx.db.patch(sg.retailerId, { country: "SG" }));
		const annual = await t
			.withIdentity({ subject: "u_sc_sg" })
			.mutation(api.invoices.subscribeSelf, {
				plan: "scale",
				billingCycle: "annual",
			});
		expect(await getInvoice(t, annual.invoiceId)).toMatchObject({
			plan: "scale",
			billingCycle: "annual",
			total: 149000, // S$149 × 10 months
			currency: "SGD",
		});
	});

	test("a store on founding pricing is refused Scale — it stays on Founding Pro", async () => {
		const t = setup();
		const { subId } = await seedRetailer(t, "u_sc_f", "sc-f-store");
		await t.run(async (ctx) => ctx.db.patch(subId, { foundingIntent: true }));
		await expect(
			t
				.withIdentity({ subject: "u_sc_f" })
				.mutation(api.invoices.subscribeSelf, {
					plan: "scale",
					billingCycle: "monthly",
				}),
		).rejects.toThrow(/Founding Pro/);
	});

	test("refuses a second pending invoice, comped accounts, and active subs", async () => {
		const t = setup();
		const { subId } = await seedRetailer(t, "u_guard", "guard-store");
		const asUser = t.withIdentity({ subject: "u_guard" });
		await asUser.mutation(api.invoices.subscribeSelf, {
			plan: "starter",
			billingCycle: "monthly",
		});
		await expect(
			asUser.mutation(api.invoices.subscribeSelf, {
				plan: "pro",
				billingCycle: "monthly",
			}),
		).rejects.toThrow(/already have a pending invoice/);

		await t.run(async (ctx) => {
			const pending = await ctx.db
				.query("invoices")
				.withIndex("by_status", (q) => q.eq("status", "pending"))
				.first();
			if (pending) await ctx.db.patch(pending._id, { status: "void" as const });
			await ctx.db.patch(subId, { comped: true });
		});
		await expect(
			asUser.mutation(api.invoices.subscribeSelf, {
				plan: "pro",
				billingCycle: "monthly",
			}),
		).rejects.toThrow(/on the house/);

		await t.run(async (ctx) =>
			ctx.db.patch(subId, { comped: false, status: "active" as const }),
		);
		await expect(
			asUser.mutation(api.invoices.subscribeSelf, {
				plan: "pro",
				billingCycle: "monthly",
			}),
		).rejects.toThrow(/already on an active plan/);
	});
});

describe("mintInvoicePaymentRequest", () => {
	test("stores the request id + url; second run is a no-op; no env → no fetch", async () => {
		const t = setup();
		const { retailerId, subId } = await seedRetailer(t, "u_mint", "mint-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);

		const fetchMock = vi.fn(async () =>
			Response.json({ id: "req_inv_1", url: "https://pay.example/req_inv_1" }),
		);
		vi.stubGlobal("fetch", fetchMock);

		// No credentials → nothing happens, nothing fetched.
		await t.action(internal.subscriptionPayments.mintInvoicePaymentRequest, {
			invoiceId,
		});
		expect(fetchMock).not.toHaveBeenCalled();

		stubBillingEnv();
		await t.action(internal.subscriptionPayments.mintInvoicePaymentRequest, {
			invoiceId,
		});
		const minted = await getInvoice(t, invoiceId);
		expect(minted?.gatewayRequestId).toBe("req_inv_1");
		expect(minted?.gatewayPayment).toEqual({
			provider: "hitpay",
			url: "https://pay.example/req_inv_1",
		});

		// Idempotent — the stored request is kept, no second mint.
		await t.action(internal.subscriptionPayments.mintInvoicePaymentRequest, {
			invoiceId,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test("a methodless mint stores NO link — a dead checkout is worse than no button", async () => {
		// Sandbox-observed 11 Sep: an SGD request on an account with no SGD
		// rails returns 201 with payment_methods: [] and its checkout page
		// renders a dead "Awaiting customer present card" state.
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_dead", "dead-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId, {
			currency: "SGD",
			amount: 5900,
			total: 5900,
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					id: "req_dead_1",
					url: "https://pay.example/req_dead_1",
					payment_methods: [],
				}),
			),
		);
		await t.action(internal.subscriptionPayments.mintInvoicePaymentRequest, {
			invoiceId,
		});
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.gatewayRequestId).toBeUndefined();
		expect(invoice?.gatewayPayment).toBeUndefined();
	});

	test("a failed mint leaves the invoice on the manual rail (never blocks)", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_mfail", "mfail-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("nope", { status: 500 })),
		);
		await t.action(internal.subscriptionPayments.mintInvoicePaymentRequest, {
			invoiceId,
		});
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.status).toBe("pending");
		expect(invoice?.gatewayRequestId).toBeUndefined();
	});
});

describe("startAutoRenewSetup", () => {
	test("mints a save-payment-method session and stores it on the sub", async () => {
		const t = setup();
		stubBillingEnv();
		const { subId } = await seedRetailer(t, "u_setup", "setup-store");
		const fetchMock = vi.fn(async (_url: unknown, _init?: { body?: unknown }) =>
			Response.json({ id: "rb_new", url: "https://auth.example/rb_new" }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const { url } = await t
			.withIdentity({ subject: "u_setup", email: "u_setup@x.com" })
			.action(api.subscriptionPayments.startAutoRenewSetup, {});
		expect(url).toBe("https://auth.example/rb_new");
		const sub = await getSub(t, subId);
		expect(sub?.autoRenewSessionId).toBe("rb_new");
		expect(sub?.autoRenewSetup?.url).toBe("https://auth.example/rb_new");

		const body = String(fetchMock.mock.calls[0]?.[1]?.body ?? "");
		expect(body).toContain("save_payment_method=true");
		// save_payment_method sessions REJECT times_to_be_charged (sandbox 11 Sep).
		expect(body).not.toContain("times_to_be_charged");

		// A fresh unfinished session is RESUMED, not re-minted.
		const again = await t
			.withIdentity({ subject: "u_setup", email: "u_setup@x.com" })
			.action(api.subscriptionPayments.startAutoRenewSetup, {});
		expect(again.url).toBe("https://auth.example/rb_new");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test("a method-list 422 retries with the param OMITTED — the account's own set decides", async () => {
		// The sandbox found this for real: a TnG-only account rejected our
		// [card, touch_n_go] list, and a card-only fallback would have been the
		// one method it doesn't have. The only assumption-free fallback is no
		// payment_methods param at all.
		const t = setup();
		stubBillingEnv();
		await seedRetailer(t, "u_422", "s422-store");
		const fetchMock = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
			const body = String(init?.body ?? "");
			if (body.includes("payment_methods")) {
				return new Response(
					JSON.stringify({
						error_code: "validation_error",
						message:
							"The selected payment methods is invalid. It must be one of: touch_n_go",
						errors: { payment_methods: ["must be one of: touch_n_go"] },
					}),
					{ status: 422 },
				);
			}
			return Response.json({ id: "rb_own", url: "https://auth.example/rb_own" });
		});
		vi.stubGlobal("fetch", fetchMock);
		const { url } = await t
			.withIdentity({ subject: "u_422", email: "u_422@x.com" })
			.action(api.subscriptionPayments.startAutoRenewSetup, {});
		expect(url).toBe("https://auth.example/rb_own");
		expect(fetchMock).toHaveBeenCalledTimes(2);
		// The retry must carry NO payment_methods at all — not a different guess.
		const retryBody = String(fetchMock.mock.calls[1]?.[1]?.body ?? "");
		expect(retryBody).not.toContain("payment_methods");
		expect(retryBody).toContain("save_payment_method=true");
	});

	test("a non-method 422 (or 5xx) does NOT retry — one clean failure to the seller", async () => {
		const t = setup();
		stubBillingEnv();
		await seedRetailer(t, "u_5xx", "s5xx-store");
		const fetchMock = vi.fn(
			async () => new Response("upstream down", { status: 502 }),
		);
		vi.stubGlobal("fetch", fetchMock);
		await expect(
			t
				.withIdentity({ subject: "u_5xx", email: "u_5xx@x.com" })
				.action(api.subscriptionPayments.startAutoRenewSetup, {}),
		).rejects.toThrow(/Couldn't reach the payment service/);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test("with an open bill the session displays THAT amount and names the store (subscribe flow)", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_sess", "sess-store");
		await seedRenewalInvoice(t, retailerId, subId, {
			origin: "self_serve" as const,
			billingCycle: "annual" as const,
			amount: 149000,
			total: 149000,
		});
		const fetchMock = vi.fn(async (_url: unknown, _init?: { body?: unknown }) =>
			Response.json({ id: "rb_sess", url: "https://auth.example/rb_sess" }),
		);
		vi.stubGlobal("fetch", fetchMock);
		await t
			.withIdentity({ subject: "u_sess", email: "u_sess@x.com" })
			.action(api.subscriptionPayments.startAutoRenewSetup, {});
		const body = String(fetchMock.mock.calls[0]?.[1]?.body ?? "");
		// The page shows what attach will charge — the annual bill, not RM149.
		expect(body).toContain("amount=1490.00");
		// The store name is the customer identity on HitPay's dashboard
		// (without it the Subscriptions list reads "N/A" — sandbox, 11 Sep).
		expect(body).toContain("customer_name=Store+sess-store");
	});

	test("attach charges the open self-serve bill immediately — subscribe IS auto-renewal (Zaki, 11 Sep)", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_nflx", "nflx-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId, {
			origin: "self_serve" as const,
		});
		await t.run(async (ctx) =>
			ctx.db.patch(subId, {
				autoRenewSessionId: "rb_nflx",
				// The consent record startAutoRenewSetup writes: this invoice, at
				// this amount, is what the authorisation page showed.
				autoRenewSetup: {
					url: "https://auth.example/rb_nflx",
					createdAt: Date.now(),
					invoiceId,
					amountSen: 14900,
				},
			}),
		);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({ payment_id: "pay_nflx_1", status: "succeeded" }),
			),
		);
		await t.mutation(internal.subscriptionPayments.recordMethodAttached, {
			billingId: "rb_nflx",
			methodCode: "touch_n_go",
		});
		// Run the charge the attach scheduled (plus its follow-ups).
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.status).toBe("paid");
		expect(invoice?.paymentMethod).toBe("hitpay_touch_n_go");
		const sub = await getSub(t, subId);
		expect(sub?.status).toBe("active");
		expect(sub?.autoRenew?.method).toBe("touch_n_go");
	});

	test("attach does NOT charge a bill the authorisation page never showed", async () => {
		// The page's amount IS the consent. A renewal issued while the seller sat
		// on HitPay's page — or an admin bill voided and reissued at a different
		// total — was never consented to, so it stays for the cron/Pay-now rail.
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_drift", "drift-store");
		const shownInvoiceId = await seedRenewalInvoice(t, retailerId, subId, {
			invoiceNumber: "INV-SHOWN",
			status: "void" as const,
		});
		// The bill that actually exists at attach time is a DIFFERENT, pricier one.
		await seedRenewalInvoice(t, retailerId, subId, {
			invoiceNumber: "INV-REISSUED",
			amount: 149000,
			total: 149000,
		});
		await t.run(async (ctx) =>
			ctx.db.patch(subId, {
				autoRenewSessionId: "rb_drift",
				autoRenewSetup: {
					url: "https://auth.example/rb_drift",
					createdAt: Date.now(),
					invoiceId: shownInvoiceId,
					amountSen: 14900,
				},
			}),
		);
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await t.mutation(internal.subscriptionPayments.recordMethodAttached, {
			billingId: "rb_drift",
			methodCode: "card",
		});
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		// The method IS attached (that part of the authorisation was real)…
		expect((await getSub(t, subId))?.autoRenew?.method).toBe("card");
		// …but no charge was ever fired for the bill nobody agreed to.
		const chargeCalls = fetchMock.mock.calls.filter((c) =>
			String(c[0]).includes("/charge/"),
		);
		expect(chargeCalls).toHaveLength(0);
	});

	test("a duplicate attach signal never charges twice", async () => {
		// applyMethodAttached runs for the webhook, its retries AND the redirect
		// reconcile. Charging on each one races two charges onto one bill.
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_dup2", "dup2-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		await t.run(async (ctx) =>
			ctx.db.patch(subId, {
				autoRenewSessionId: "rb_dup2",
				autoRenewSetup: {
					url: "https://auth.example/rb_dup2",
					createdAt: Date.now(),
					invoiceId,
					amountSen: 14900,
				},
			}),
		);
		const fetchMock = vi.fn(async (url: unknown) =>
			String(url).includes("/charge/")
				? Response.json({ payment_id: "pay_dup2", status: "succeeded" })
				: Response.json({ status: "active", times_charged: 1 }),
		);
		vi.stubGlobal("fetch", fetchMock);
		// Webhook, then the redirect reconcile a beat later — both attach signals.
		await t.mutation(internal.subscriptionPayments.recordMethodAttached, {
			billingId: "rb_dup2",
			methodCode: "touch_n_go",
		});
		await t.mutation(internal.subscriptionPayments.recordMethodAttached, {
			billingId: "rb_dup2",
			methodCode: "touch_n_go",
		});
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		const charges = fetchMock.mock.calls.filter((c) =>
			String(c[0]).includes("/charge/"),
		);
		expect(charges).toHaveLength(1);
		expect((await getInvoice(t, invoiceId))?.status).toBe("paid");
	});

	test("a second charge action stands down while one is in flight (mutex)", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_mutex", "mutex-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		await attachAutoRenew(t, subId);
		// Someone already claimed the attempt moments ago.
		const claimA: { claimed: boolean } = await t.mutation(
			internal.subscriptionPayments.recordChargeAttempt,
			{ subscriptionId: subId, invoiceId },
		);
		expect(claimA.claimed).toBe(true);
		const claimB: { claimed: boolean } = await t.mutation(
			internal.subscriptionPayments.recordChargeAttempt,
			{ subscriptionId: subId, invoiceId },
		);
		expect(claimB.claimed).toBe(false);
	});

	test("without gateway credentials the action refuses with seller-facing copy", async () => {
		const t = setup();
		await seedRetailer(t, "u_nocreds", "nocreds-store");
		await expect(
			t
				.withIdentity({ subject: "u_nocreds", email: "u_nocreds@x.com" })
				.action(api.subscriptionPayments.startAutoRenewSetup, {}),
		).rejects.toThrow(/isn't available right now/);
	});
});

describe("finishAutoRenewSetup (redirect-return reconcile)", () => {
	test.each([
		["an active session attaches the method it reports", 200, true],
		["a session HitPay no longer has attaches nothing", 404, false],
		["an unreadable session attaches nothing", 503, false],
	])("%s", async (_case, status, attached) => {
		const t = setup();
		stubBillingEnv();
		const { subId } = await seedRetailer(t, "u_fin", "fin-store");
		await t.run((ctx) => ctx.db.patch(subId, { autoRenewSessionId: "rb_fin" }));
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				status === 200
					? Response.json({
							status: "active",
							times_charged: 0,
							payment_provider_charge_method: "touch_n_go",
						})
					: new Response("nope", { status }),
			),
		);

		const result = await t
			.withIdentity({ subject: "u_fin", email: "u_fin@x.com" })
			.action(api.subscriptionPayments.finishAutoRenewSetup, {});

		expect(result.attached).toBe(attached);
		expect((await getSub(t, subId))?.autoRenew?.method).toBe(
			attached ? "touch_n_go" : undefined,
		);
	});
});

describe("chargeDueRenewal", () => {
	test("success: settles through the markPaid path + advances the counters", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_chg", "chg-store");
		await attachAutoRenew(t, subId);
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					payment_id: "pay_ok_1",
					recurring_billing_id: "rb_1",
					amount: 149,
					currency: "myr",
					status: "succeeded",
				}),
			),
		);

		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });

		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.status).toBe("paid");
		expect(invoice?.paymentMethod).toBe("hitpay_card");
		expect(invoice?.markedPaidBy).toBe("pay_ok_1");

		const sub = await getSub(t, subId);
		expect(sub?.status).toBe("active");
		expect(sub?.currentPeriodEnd).toBeGreaterThan(Date.now());
		expect(sub?.autoRenew?.timesCharged).toBe(1);
		expect(sub?.autoRenew?.lastChargeAt).toBeTypeOf("number");
		expect(sub?.autoRenew?.failedAttempts).toBeUndefined();
		expect(sub?.autoRenew?.pendingChargeInvoiceId).toBeUndefined();
	});

	test("decline: invoice stays pending, dunning state set, retry scheduled", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_dec", "dec-store");
		await attachAutoRenew(t, subId);
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({ payment_id: "pay_x", status: "failed" }),
			),
		);

		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });

		expect((await getInvoice(t, invoiceId))?.status).toBe("pending");
		const sub = await getSub(t, subId);
		expect(sub?.autoRenew?.failedAttempts).toBe(1);
		expect(sub?.autoRenew?.nextRetryAt).toBe(Date.now() + 2 * 86400000);
		expect(sub?.autoRenew?.lastChargeError).toContain("failed");
		// The sub is NOT locked by a decline — grace runs on the invoice dueDate.
		expect(sub?.status).toBe("active");
	});

	test("third decline exhausts dunning: no further retry is scheduled", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_exh", "exh-store");
		await attachAutoRenew(t, subId, { failedAttempts: 2 });
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("card declined", { status: 402 })),
		);
		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });
		const sub = await getSub(t, subId);
		expect(sub?.autoRenew?.failedAttempts).toBe(3);
		expect(sub?.autoRenew?.nextRetryAt).toBeUndefined();
	});

	test("network failure = outcome unknown: attempt NOT counted, reconcile-retry queued", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_net", "net-store");
		await attachAutoRenew(t, subId);
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("socket hang up");
			}),
		);
		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });
		const sub = await getSub(t, subId);
		expect(sub?.autoRenew?.failedAttempts).toBeUndefined();
		expect(sub?.autoRenew?.nextRetryAt).toBe(Date.now() + 86400000);
		// The attempt stamp survives so the next run reconciles first.
		expect(sub?.autoRenew?.lastChargeAttemptAt).toBeTypeOf("number");
		expect(sub?.autoRenew?.pendingChargeInvoiceId).toBe(invoiceId);
	});

	test("a 2xx we can't read is an unknown outcome too — never a decline, never a thrown action", async () => {
		// HitPay may have taken the money; a throw here would record NO outcome
		// and a decline would clear the stamp — either way the reconcile loses it.
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_garb", "garb-store");
		await attachAutoRenew(t, subId);
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("<html>502 upstream</html>", { status: 200 })),
		);
		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });
		const sub = await getSub(t, subId);
		expect(sub?.autoRenew?.failedAttempts).toBeUndefined();
		expect(sub?.autoRenew?.lastChargeError).toContain("unreadable");
		expect(sub?.autoRenew?.lastChargeAttemptAt).toBeTypeOf("number");
		expect(sub?.autoRenew?.nextRetryAt).toBe(Date.now() + 86400000);
		expect((await getInvoice(t, invoiceId))?.status).toBe("pending");
	});

	test("outcome-unknown reconcile: HitPay already took the money → settle, never re-charge", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_rec", "rec-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		await attachAutoRenew(t, subId, {
			lastChargeAttemptAt: Date.now() - 60_000,
			pendingChargeInvoiceId: invoiceId,
			timesCharged: 0,
		});
		const fetchMock = vi.fn(async (url: unknown) => {
			// Only the session GET is allowed; a POST /charge here would be the bug.
			expect(String(url)).not.toContain("/charge/");
			// The save-card shape HitPay really returns: the count in
			// `total_charge`, `times_charged` null (sandbox, 30 Sep 2026).
			return Response.json({
				status: "active",
				cycle: "save_card",
				times_charged: null,
				total_charge: 1,
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.status).toBe("paid");
		expect(invoice?.markedPaidBy).toBe("reconciled:rb_1:1");
	});

	test("no-ops when the invoice settled meanwhile or auto-renew was turned off", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_noop", "noop-store");
		await attachAutoRenew(t, subId);
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId, {
			status: "paid" as const,
		});
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

// Shared by the charge-story suites below: a scripted HitPay and the cron.
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** HitPay for a whole story: the charge POST and the session GET answer
 * per call (1-based); a responder that throws is a request that never
 * came back. Everything else (link deletes, mints) is acked. Counts every
 * way money is ASKED FOR or a session is destroyed — those counts are the
 * assertions. */
function stubHitpay(respond: {
	charge: (n: number) => Response;
	session?: (n: number) => Response;
	/** POST /payment-requests (the Pay-now mint). Default: an empty object,
	 * which the mint treats as "no link stored". */
	mint?: (n: number) => Response;
}) {
	const calls = {
		charges: 0,
		sessionReads: 0,
		sessionDeletes: 0,
		linkDeletes: 0,
		mints: 0,
		emails: [] as Array<{ to: string[]; subject: string; text: string }>,
	};
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: unknown, init?: { method?: string; body?: unknown }) => {
			const u = String(url);
			if (u.includes("/charge/recurring-billing/")) {
				return respond.charge(++calls.charges);
			}
			if (u.includes("/recurring-billing/") && init?.method === "DELETE") {
				calls.sessionDeletes++;
				return Response.json({});
			}
			if (
				u.includes("/recurring-billing/") &&
				(init?.method ?? "GET") === "GET"
			) {
				calls.sessionReads++;
				if (!respond.session) throw new Error("unexpected session read");
				return respond.session(calls.sessionReads);
			}
			if (u.includes("/payment-requests/") && init?.method === "DELETE") {
				calls.linkDeletes++;
			}
			if (u.endsWith("/payment-requests") && init?.method === "POST") {
				calls.mints++;
				if (respond.mint) return respond.mint(calls.mints);
			}
			if (u.includes("api.resend.com")) {
				calls.emails.push(JSON.parse(String(init?.body)));
			}
			return Response.json({});
		}),
	);
	return calls;
}

const lostRequest = () => {
	throw new Error("socket hang up");
};
const succeeded = (paymentId: string) =>
	Response.json({ payment_id: paymentId, status: "succeeded" });
/** A save-card session in the shape HitPay's GET really returns (sandbox,
 * 30 Sep 2026): the count in `total_charge`, the documented `times_charged`
 * null. A fixture carrying `times_charged: n` is how the reconcile shipped
 * reading a field that is never set. */
const sessionCharged = (count: number) => () =>
	Response.json({
		status: "active",
		cycle: "save_card",
		times_charged: null,
		total_charge: count,
	});

/**
 * The count HitPay reports on each successive GET (1-based; the last value
 * repeats). Every charge now reads a BASELINE before it POSTs, and the
 * reconcile asks whether the count moved since — so "the lost charge landed"
 * has to be modelled as the number going UP after that baseline read. A
 * constant count says the opposite: nothing moved, nothing landed.
 */
const sessionCountSeq =
	(...counts: number[]) =>
	(n: number) =>
		Response.json({
			status: "active",
			cycle: "save_card",
			times_charged: null,
			total_charge: counts[Math.min(n, counts.length) - 1],
		});

/** The daily cron at `at`, plus every charge it schedules. */
async function cronAt(t: ReturnType<typeof setup>, at: number) {
	vi.setSystemTime(at);
	const run = await t.mutation(
		internal.subscriptions.internalDailyBillingStatus,
		{},
	);
	await t.finishAllScheduledFunctions(vi.runAllTimers);
	return run;
}

// The reconcile used to run only while the attempt stamp was under 24h old —
// but the retry that follows an unknown outcome is scheduled 24h out and
// fired by a DAILY cron, so it always arrived with the stamp at 24h or older.
// The guard never ran on the one path it exists for, the lock read the stamp
// as stale, and a charge HitPay had already taken was POSTed again. These
// stories drive the real retry path (unknown outcome → cron → retry) at the
// boundary and past it, rather than seeding a convenient fresh stamp.
describe("an unresolved charge is reconciled at ANY age — the cron retry path", () => {
	/** Seed a store mid-renewal and run the FIRST charge, whose request dies. */
	async function unknownOutcome(
		t: ReturnType<typeof setup>,
		userId: string,
		slug: string,
	) {
		const { retailerId, subId } = await seedRetailer(t, userId, slug);
		await attachAutoRenew(t, subId);
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		const attemptAt = Date.now();
		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });
		const sub = await getSub(t, subId);
		expect(sub?.autoRenew?.lastChargeAttemptAt).toBe(attemptAt);
		expect(sub?.autoRenew?.nextRetryAt).toBe(attemptAt + DAY);
		return { subId, invoiceId, attemptAt };
	}

	test.each([
		["+24h, the earliest the retry can fire", DAY],
		["+48h, the next daily cron after that", 2 * DAY],
	])(
		"HitPay took the lost charge; the retry at %s settles it as reconciled and never charges again",
		async (_when, gap) => {
			const t = setup();
			stubBillingEnv();
			// Our request died AFTER HitPay processed it: the session says 1.
			const calls = stubHitpay({
				charge: (n) => (n === 1 ? lostRequest() : succeeded(`pay_again_${n}`)),
				// 0 when the charge fires, 1 when the retry asks: it landed.
				session: sessionCountSeq(0, 1),
			});
			const { subId, invoiceId, attemptAt } = await unknownOutcome(
				t,
				"u_took",
				"took-store",
			);

			const run = await cronAt(t, attemptAt + gap);

			expect(run.autoChargeRetries).toBe(1);
			expect(calls.charges).toBe(1); // the lost one — never a second
			const invoice = await getInvoice(t, invoiceId);
			expect(invoice?.status).toBe("paid");
			expect(invoice?.markedPaidBy).toBe("reconciled:rb_1:1");
			// 2 reads: the baseline this charge captured before it POSTed,
			// then the reconcile's own read on the retry.
			expect(calls.sessionReads).toBe(2);
			const sub = await getSub(t, subId);
			expect(sub?.autoRenew?.timesCharged).toBe(1);
			expect(sub?.autoRenew?.lastChargeAttemptAt).toBeUndefined();
			expect(sub?.autoRenew?.nextRetryAt).toBeUndefined();
		},
	);

	test.each([
		["+24h, the earliest the retry can fire", DAY],
		["+48h, the next daily cron after that", 2 * DAY],
	])(
		"HitPay never took the lost charge; the retry at %s asks first, then charges exactly once",
		async (_when, gap) => {
			const t = setup();
			stubBillingEnv();
			const calls = stubHitpay({
				charge: (n) => (n === 1 ? lostRequest() : succeeded(`pay_retry_${n}`)),
				session: sessionCharged(0),
			});
			const { subId, invoiceId, attemptAt } = await unknownOutcome(
				t,
				"u_never",
				"never-store",
			);

			await cronAt(t, attemptAt + gap);

			// 2 reads: the baseline this charge captured before it POSTed,
			// then the reconcile's own read on the retry.
			expect(calls.sessionReads).toBe(2);
			expect(calls.charges).toBe(2); // the lost one + exactly one retry
			const invoice = await getInvoice(t, invoiceId);
			expect(invoice?.status).toBe("paid");
			expect(invoice?.markedPaidBy).toBe("pay_retry_2");
			expect((await getSub(t, subId))?.autoRenew?.timesCharged).toBe(1);
		},
	);

	test("a stale stamp HitPay says never charged is RE-CLAIMED — the retry stamps its own attempt before it charges", async () => {
		const t = setup();
		stubBillingEnv();
		// The retry's request dies too, so its stamp survives to be read.
		const calls = stubHitpay({
			charge: () => lostRequest(),
			session: sessionCharged(0),
		});
		const { subId, invoiceId, attemptAt } = await unknownOutcome(
			t,
			"u_restamp",
			"restamp-store",
		);

		await cronAt(t, attemptAt + DAY);

		expect(calls.charges).toBe(2);
		const sub = await getSub(t, subId);
		// Not the original stamp: the lock re-claimed at the retry's own moment,
		// so the NEXT run reconciles this attempt, not the one before it.
		expect(sub?.autoRenew?.lastChargeAttemptAt).toBeGreaterThanOrEqual(
			attemptAt + DAY,
		);
		expect(sub?.autoRenew?.pendingChargeInvoiceId).toBe(invoiceId);
		expect((await getInvoice(t, invoiceId))?.status).toBe("pending");
	});

	test("mid-dunning: an unknown outcome keeps the already-due retry, and the next day's cron reconciles it", async () => {
		// recordChargeFailure keeps an existing nextRetryAt on an unknown
		// outcome — mid-dunning that one is already in the past, so tomorrow's
		// cron retries ~24h after the stamp, right on the old window's edge.
		const t = setup();
		stubBillingEnv();
		const calls = stubHitpay({
			charge: (n) =>
				n === 1
					? Response.json({ payment_id: "pay_dec", status: "failed" }) // decline
					: n === 2
						? lostRequest() // the dunning retry: HitPay took it, we never heard
						: succeeded(`pay_again_${n}`),
			// Baselines for charge 1 and charge 2 read 0; the reconcile's read
			// is 1, so the SECOND charge is the one that landed.
			session: sessionCountSeq(0, 0, 1),
		});
		const { retailerId, subId } = await seedRetailer(t, "u_dun", "dun-store");
		await attachAutoRenew(t, subId);
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		const declinedAt = Date.now();
		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });
		expect((await getSub(t, subId))?.autoRenew?.failedAttempts).toBe(1);

		await cronAt(t, declinedAt + 2 * DAY); // retry #1: request lost
		expect(calls.charges).toBe(2);
		const stamped = await getSub(t, subId);
		expect(stamped?.autoRenew?.nextRetryAt).toBe(declinedAt + 2 * DAY);

		await cronAt(t, declinedAt + 3 * DAY); // next day: must ask, not charge

		expect(calls.charges).toBe(2);
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.status).toBe("paid");
		expect(invoice?.markedPaidBy).toBe("reconciled:rb_1:1");
		// 3 reads: a baseline before each of the two charges, then the reconcile.
		expect(calls.sessionReads).toBe(3);
	});

	/** A store whose last attempt, 30h ago, never came back. */
	async function staleStamp(
		t: ReturnType<typeof setup>,
		userId: string,
		slug: string,
		stampAge = 30 * HOUR,
	) {
		const { retailerId, subId } = await seedRetailer(t, userId, slug);
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		const now = Date.now();
		await attachAutoRenew(t, subId, {
			lastChargeAttemptAt: now - stampAge,
			pendingChargeInvoiceId: invoiceId,
			nextRetryAt: now - 6 * HOUR,
			lastChargeError: "network failure — outcome unknown",
		});
		return { subId, invoiceId, stampedAt: now - stampAge };
	}

	test.each([
		["the read never comes back", lostRequest],
		["HitPay 500s", () => new Response("oops", { status: 500 })],
		["HitPay 503s", () => new Response("maintenance", { status: 503 })],
		["HitPay rate-limits us (429)", () => new Response("slow", { status: 429 })],
		["HitPay rejects our key (401)", () => new Response("no", { status: 401 })],
	])(
		"when HitPay can't answer for a stale attempt (%s), nothing is charged — the retry sweep asks again",
		async (_why, session) => {
			const t = setup();
			stubBillingEnv();
			const calls = stubHitpay({
				charge: () => succeeded("pay_blind"),
				session,
			});
			const { subId, invoiceId, stampedAt } = await staleStamp(
				t,
				"u_blind",
				"blind-store",
			);
			const before = await getSub(t, subId);

			await t.action(internal.subscriptionPayments.chargeDueRenewal, {
				invoiceId,
			});

			expect(calls.charges).toBe(0);
			expect((await getInvoice(t, invoiceId))?.status).toBe("pending");
			expect(calls.sessionReads).toBe(1);
			const sub = await getSub(t, subId);
			// Untouched: still unresolved, still due — tomorrow's cron asks again.
			expect(sub?.autoRenew?.lastChargeAttemptAt).toBe(stampedAt);
			expect(sub?.autoRenew?.nextRetryAt).toBe(before?.autoRenew?.nextRetryAt);
			expect(sub?.autoRenew?.failedAttempts).toBeUndefined();
		},
	);

	test.each([404, 410])(
		"a session HitPay no longer has (%i) can't be charged either — fall through, and the charge's refusal becomes a visible decline",
		async (status) => {
			const t = setup();
			stubBillingEnv();
			const calls = stubHitpay({
				charge: () => new Response("recurring billing not found", { status }),
				session: () => new Response("not found", { status }),
			});
			const { subId, invoiceId } = await staleStamp(t, "u_gone", "gone-store");

			await t.action(internal.subscriptionPayments.chargeDueRenewal, {
				invoiceId,
			});

			expect(calls.sessionReads).toBe(1);
			expect(calls.charges).toBe(1);
			const sub = await getSub(t, subId);
			// A decline is a RECORDED outcome: counted, dunned, stamp resolved.
			expect(sub?.autoRenew?.failedAttempts).toBe(1);
			expect(sub?.autoRenew?.lastChargeError).toContain(`HTTP ${status}`);
			expect(sub?.autoRenew?.lastChargeAttemptAt).toBeUndefined();
			expect((await getInvoice(t, invoiceId))?.status).toBe("pending");
		},
	);

	test("a session that answers without ANY charge count is never charged over", async () => {
		const t = setup();
		stubBillingEnv();
		const calls = stubHitpay({
			charge: () => succeeded("pay_blind"),
			session: () =>
				Response.json({ status: "active", cycle: "save_card", times_charged: null }),
		});
		const { subId, invoiceId, stampedAt } = await staleStamp(
			t,
			"u_nocount",
			"nocount-store",
		);

		await t.action(internal.subscriptionPayments.chargeDueRenewal, {
			invoiceId,
		});

		expect(calls.charges).toBe(0);
		expect(calls.sessionReads).toBe(1);
		expect((await getSub(t, subId))?.autoRenew?.lastChargeAttemptAt).toBe(
			stampedAt,
		);
	});

	test("an attempt whose action DIED without recording anything is picked up by the cron once its lock is stale", async () => {
		// No outcome was ever recorded, so no retry was ever scheduled: the
		// stamp is the only trace, and the cron is the only thing that looks.
		const t = setup();
		stubBillingEnv();
		const calls = stubHitpay({
			charge: () => succeeded("pay_again"),
			session: sessionCharged(1), // HitPay took it before the action died
		});
		const { retailerId, subId } = await seedRetailer(t, "u_died", "died-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		const diedAt = Date.now();
		await attachAutoRenew(t, subId, {
			lastChargeAttemptAt: diedAt,
			pendingChargeInvoiceId: invoiceId,
		});

		// Inside the lock the attempt may still be running — leave it alone.
		const early = await cronAt(t, diedAt + 23 * HOUR);
		expect(early.autoChargeRetries).toBe(0);
		expect(calls.sessionReads).toBe(0);

		const run = await cronAt(t, diedAt + DAY);
		expect(run.autoChargeRetries).toBe(1);
		expect(calls.charges).toBe(0);
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.status).toBe("paid");
		expect(invoice?.markedPaidBy).toBe("reconciled:rb_1:1");
	});

	test("a gone session with an attempt still inside the lock stands down — the lock, not the reconcile, owns in-flight", async () => {
		const t = setup();
		stubBillingEnv();
		const calls = stubHitpay({
			charge: () => succeeded("pay_racing"),
			session: () => new Response("not found", { status: 404 }),
		});
		const { invoiceId } = await staleStamp(t, "u_race", "race-store", 60_000);

		await t.action(internal.subscriptionPayments.chargeDueRenewal, {
			invoiceId,
		});

		expect(calls.sessionReads).toBe(1);
		expect(calls.charges).toBe(0);
	});
});

// The reconcile's money belongs to the bill its attempt was FIRED FOR. If that
// bill was voided while the outcome was unknown (an admin reissue, or the
// seller switching plan), the charge is STRANDED: audited on the voided bill
// and auto-charging stops until a human settles a bill. It must never be
// booked against the replacement (wrong bill, wrong amount) and never be
// charged again on top (the double debit). Decided: audit + hold.
describe("a lost charge that lands on a VOIDED bill is stranded — never re-applied, never re-charged", () => {
	/** INV-OLD's charge was lost, then INV-OLD was voided and replaced by
	 * INV-NEW (a different total), which carries its own live Pay-now link. */
	async function voidedMidUnknown(
		t: ReturnType<typeof setup>,
		userId: string,
		slug: string,
	) {
		const { retailerId, subId } = await seedRetailer(t, userId, slug);
		const voided = await seedRenewalInvoice(t, retailerId, subId, {
			invoiceNumber: "INV-OLD",
			status: "void" as const,
		});
		const replacement = await seedRenewalInvoice(t, retailerId, subId, {
			invoiceNumber: "INV-NEW",
			amount: 7900,
			total: 7900,
			gatewayRequestId: "req_new",
			gatewayPayment: {
				provider: "hitpay" as const,
				url: "https://pay.example/req_new",
			},
		});
		const now = Date.now();
		await attachAutoRenew(t, subId, {
			lastChargeAttemptAt: now - 30 * HOUR,
			pendingChargeInvoiceId: voided,
			nextRetryAt: now - 6 * HOUR,
			lastChargeError: "network failure — outcome unknown",
		});
		return { subId, voided, replacement };
	}

	test("the reconcile audits the money on the VOIDED bill, stops auto-charging, and leaves the replacement alone", async () => {
		const t = setup();
		stubBillingEnv();
		vi.stubEnv("RESEND_API_KEY", "re_test");
		vi.stubEnv("EMAIL_FROM", "billing@kedaipal.test");
		vi.stubEnv("ADMIN_ALERT_EMAIL", "ops@kedaipal.test");
		const calls = stubHitpay({
			charge: (n) => succeeded(`pay_on_top_${n}`),
			session: sessionCharged(1), // HitPay took INV-OLD's charge
		});
		const { subId, voided, replacement } = await voidedMidUnknown(
			t,
			"u_strand",
			"strand-store",
		);

		const run = await cronAt(t, Date.now() + HOUR);

		expect(run.autoChargeRetries).toBe(1);
		expect(calls.sessionReads).toBe(1);
		expect(calls.charges).toBe(0); // never charged on top
		expect(calls.linkDeletes).toBe(0); // the replacement's link stays live
		const oldBill = await getInvoice(t, voided);
		expect(oldBill?.status).toBe("void");
		expect(oldBill?.gatewayIssue).toMatchObject({
			kind: "late_payment",
			paymentId: "reconciled:rb_1:1",
			amountSen: 14900, // what INV-OLD's charge took, not INV-NEW's total
		});
		const newBill = await getInvoice(t, replacement);
		expect(newBill?.status).toBe("pending"); // never settled with old money
		expect(newBill?.gatewayRequestId).toBe("req_new");
		const sub = await getSub(t, subId);
		expect(sub?.autoRenew?.strandedCharge).toMatchObject({
			invoiceId: voided,
			invoiceNumber: "INV-OLD",
			amountSen: 14900,
			currency: "MYR",
			paymentId: "reconciled:rb_1:1",
		});
		// The outcome is known now: the stamp resolves, and our counter catches
		// up with HitPay — a counter left behind would make the NEXT unknown
		// outcome read "HitPay took it" and settle a bill for free.
		expect(sub?.autoRenew?.timesCharged).toBe(1);
		expect(sub?.autoRenew?.lastChargeAttemptAt).toBeUndefined();
		expect(sub?.autoRenew?.pendingChargeInvoiceId).toBeUndefined();
		expect(sub?.autoRenew?.nextRetryAt).toBeUndefined();
		// The seller is told "we'll be in touch" — so ops is told, once.
		expect(calls.emails).toHaveLength(1);
		expect(calls.emails[0].to).toEqual(["ops@kedaipal.test"]);
		expect(calls.emails[0].subject).toBe(
			"[Kedaipal] Stranded auto-charge — Store strand-store",
		);
		expect(calls.emails[0].text).toContain("MYR 149.00");
		expect(calls.emails[0].text).toContain("INV-OLD");
		expect(calls.emails[0].text).toContain("reconciled:rb_1:1");
		expect(calls.emails[0].text).toContain("STOPPED");
	});

	test("while stranded NOTHING charges: not the cron, not a queued charge, not a new renewal", async () => {
		const t = setup();
		stubBillingEnv();
		const calls = stubHitpay({
			charge: (n) => succeeded(`pay_on_top_${n}`),
			session: sessionCharged(1),
		});
		const { subId, replacement } = await voidedMidUnknown(
			t,
			"u_stopped",
			"stopped-store",
		);
		await cronAt(t, Date.now() + HOUR); // strands it

		const nextDay = await cronAt(t, Date.now() + DAY);
		expect(nextDay.autoChargeRetries).toBe(0);
		// A charge queued before the stop still re-asks the rule when it runs.
		await t.action(internal.subscriptionPayments.chargeDueRenewal, {
			invoiceId: replacement,
		});
		// A renewal written while stopped is billed, not charged.
		await t.run(async (ctx) =>
			ctx.db.patch(replacement, { status: "void" as const }),
		);
		const issued = await t.mutation(
			internal.invoices.internalIssueRenewalInvoice,
			{ subscriptionId: subId },
		);
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(issued).toEqual({ issued: true, autoCharge: false });

		expect(calls.charges).toBe(0);
		expect(calls.sessionReads).toBe(1); // only the read that stranded it
	});

	test("the cron asks the same rule — a due retry on a stopped store is not scheduled", async () => {
		// Stranding clears the retry state, so no story reaches this door; the
		// rule still has to hold at every door, not just the ones in use today.
		const t = setup();
		stubBillingEnv();
		const calls = stubHitpay({ charge: (n) => succeeded(`pay_${n}`) });
		const { retailerId, subId } = await seedRetailer(t, "u_door", "door-store");
		const voided = await seedRenewalInvoice(t, retailerId, subId, {
			invoiceNumber: "INV-OLD",
			status: "void" as const,
		});
		await seedRenewalInvoice(t, retailerId, subId, {
			invoiceNumber: "INV-NEW",
		});
		await attachAutoRenew(t, subId, {
			nextRetryAt: Date.now() - HOUR,
			strandedCharge: {
				invoiceId: voided,
				invoiceNumber: "INV-OLD",
				amountSen: 14900,
				currency: "MYR",
				paymentId: "reconciled:rb_1:1",
				at: Date.now() - DAY,
			},
		});

		const run = await cronAt(t, Date.now() + HOUR);

		expect(run.autoChargeRetries).toBe(0);
		expect(calls.charges).toBe(0);
	});

	test("settling ANY bill lifts it — the admin applied or refunded the money, or the seller paid by hand", async () => {
		const t = setup();
		stubBillingEnv();
		stubHitpay({
			charge: (n) => succeeded(`pay_${n}`),
			session: sessionCharged(1),
		});
		const { subId, replacement } = await voidedMidUnknown(
			t,
			"u_lift",
			"lift-store",
		);
		await cronAt(t, Date.now() + HOUR);
		expect((await getSub(t, subId))?.autoRenew?.strandedCharge).toBeDefined();

		await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.invoices.markPaid, { invoiceId: replacement });

		const sub = await getSub(t, subId);
		expect(sub?.autoRenew?.strandedCharge).toBeUndefined();
		expect(sub?.autoRenew?.method).toBe("card"); // still on auto-renewal
	});

	test("a double payment on a bill already PAID another way is audited — but doesn't stop auto-charging", async () => {
		// The boundary: only a charge whose ATTEMPT STAMP still names the bill
		// is a lost auto-charge. A payment that lands on a bill settled some
		// other way (no stamp — the settle cleared it) is a plain double
		// payment: refund conversation, auto-renewal carries on.
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_dbl", "dbl-store");
		await attachAutoRenew(t, subId);
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId, {
			status: "paid" as const,
			markedPaidBy: ADMIN,
		});

		// The SESSION rail this time, so the only thing standing between this
		// payment and a strand is the missing attempt stamp — the boundary
		// under test. (The rail boundary has its own suite below.)
		const result = await t.mutation(internal.invoices.internalSettleFromGateway, {
			viaSessionCharge: true,
			invoiceId,
			paymentId: "pay_late_1",
			amountSen: 14900,
			currency: "MYR",
		});

		expect(result).toEqual({ applied: false, reason: "late_payment" });
		expect((await getInvoice(t, invoiceId))?.gatewayIssue?.kind).toBe(
			"late_payment",
		);
		expect((await getSub(t, subId))?.autoRenew?.strandedCharge).toBeUndefined();
	});

	test("both admin lists carry it, stopped stores sort first, and the seller's view says stopped", async () => {
		const t = setup();
		stubBillingEnv();
		stubHitpay({ charge: (n) => succeeded(`pay_${n}`), session: sessionCharged(1) });
		// A healthy auto-renew store attached MORE recently — it would sort
		// first on attach date alone.
		const healthy = await seedRetailer(t, "u_fine", "fine-store");
		await attachAutoRenew(t, healthy.subId, { attachedAt: Date.now() });
		const { subId, replacement } = await voidedMidUnknown(
			t,
			"u_listed",
			"listed-store",
		);
		await cronAt(t, Date.now() + HOUR);
		const asAdmin = t.withIdentity({ subject: ADMIN });

		const pending = await asAdmin.query(api.invoices.listPending, {});
		const row = pending.find((r) => r._id === replacement);
		expect(row?.autoRenew?.stranded).toMatchObject({
			invoiceNumber: "INV-OLD",
			amountSen: 14900,
			paymentId: "reconciled:rb_1:1",
		});

		const overview = await asAdmin.query(
			api.subscriptionPayments.listAutoRenewForAdmin,
			{},
		);
		expect(overview.map((r) => r.slug)).toEqual(["listed-store", "fine-store"]);
		expect(overview[0].charge.stranded?.invoiceNumber).toBe("INV-OLD");
		expect(overview[1].charge.stranded).toBeUndefined();

		const sub = await getSub(t, subId);
		const view = resolveAccess(sub);
		expect(view.autoRenew?.stopped).toBe(true);
		expect(resolveAccess(await getSub(t, healthy.subId)).autoRenew?.stopped).toBe(
			false,
		);
	});
});

// Only the SESSION rail may answer the money question. A Pay-now/manual
// settle of the same bill is DIFFERENT money: bumping our counter for it
// pushes us ahead of HitPay (the seed of "remote not ahead" → a double
// charge), and clearing the stamp closes a question that payment never
// answered — the lost session charge may still have landed.
// The reconcile used to ask "is HitPay ahead of my success tally?". The tally
// counts only OUR successes, so ANY other thing that moves HitPay's number
// reads as "your lost charge landed" and settles a bill nobody paid — a free
// month. The suspected mover is a declined charge, which cannot be observed
// in the sandbox (it approves everything it validates), so the fix removes
// the dependency instead of betting on the answer: capture HitPay's count at
// the moment the charge fires and measure the DELTA.
describe("the reconcile measures a delta from the attempt's own baseline", () => {
	test("a counter that drifted BEHIND HitPay no longer settles a bill nobody paid", async () => {
		// The exact decline scenario: something moved HitPay's count without
		// being one of our successes, so remote (7) sits above the tally (5).
		// A later charge is then lost. Old logic: "remote ahead ⇒ it landed" ⇒
		// free month. With a baseline of 7 captured at fire time, an unmoved 7
		// is correctly read as "it never landed".
		const t = setup();
		stubBillingEnv();
		const calls = stubHitpay({
			charge: (n) => (n === 1 ? lostRequest() : succeeded(`pay_retry_${n}`)),
			session: sessionCharged(7),
		});
		const { retailerId, subId } = await seedRetailer(t, "u_drift", "drift-store");
		await attachAutoRenew(t, subId, { timesCharged: 5 }); // tally is BEHIND
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);

		// The charge fires: it reads 7 as the baseline, then its response is lost.
		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });
		const stamped = await getSub(t, subId);
		expect(stamped?.autoRenew?.chargeCountAtAttempt).toBe(7);
		expect(calls.charges).toBe(1);

		// The retry a day later: HitPay still says 7 — unmoved since we fired,
		// so the charge never landed and the bill must be charged, not settled.
		await cronAt(t, Date.now() + DAY + HOUR);

		expect((await getInvoice(t, invoiceId))?.markedPaidBy).toBe("pay_retry_2");
		expect(calls.charges).toBe(2); // charged, never settled for free
	});

	test("…and the same drift still settles when the charge REALLY landed", async () => {
		// Same drifted tally, but this time the count moved past the baseline.
		const t = setup();
		stubBillingEnv();
		const calls = stubHitpay({
			charge: () => lostRequest(),
			session: (n) => (n === 1 ? sessionCharged(7)() : sessionCharged(8)()),
		});
		const { retailerId, subId } = await seedRetailer(t, "u_drift2", "drift2-store");
		await attachAutoRenew(t, subId, { timesCharged: 5 });
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);

		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });
		expect((await getSub(t, subId))?.autoRenew?.chargeCountAtAttempt).toBe(7);

		await cronAt(t, Date.now() + DAY + HOUR);

		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.status).toBe("paid");
		expect(invoice?.markedPaidBy).toBe("reconciled:rb_1:8");
		expect(calls.charges).toBe(1); // never a second charge
	});

	test("a stamp with NO baseline falls back to the tally — the old behaviour, never worse", async () => {
		// Stamps written before this field existed, or when the pre-charge read
		// failed. The fallback must still catch a landed charge.
		const t = setup();
		stubBillingEnv();
		const calls = stubHitpay({
			charge: () => succeeded("pay_never"),
			session: sessionCharged(6),
		});
		const { retailerId, subId } = await seedRetailer(t, "u_fb", "fb-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		await attachAutoRenew(t, subId, {
			timesCharged: 5,
			lastChargeAttemptAt: Date.now() - 30 * HOUR,
			pendingChargeInvoiceId: invoiceId,
			// chargeCountAtAttempt deliberately absent
		});

		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });

		expect((await getInvoice(t, invoiceId))?.markedPaidBy).toBe(
			"reconciled:rb_1:6",
		);
		expect(calls.charges).toBe(0);
	});

	test("an unreadable count before charging still charges — and records no baseline", async () => {
		// A GET blip must not block a renewal; it just degrades to the fallback.
		const t = setup();
		stubBillingEnv();
		const calls = stubHitpay({
			charge: () => succeeded("pay_ok"),
			session: () => new Response("down", { status: 503 }),
		});
		const { retailerId, subId } = await seedRetailer(t, "u_blip", "blip-store");
		await attachAutoRenew(t, subId, { timesCharged: 2 });
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);

		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });

		expect(calls.charges).toBe(1);
		expect((await getInvoice(t, invoiceId))?.status).toBe("paid");
	});

	test("the baseline is cleared with the stamp, never left to mislead the next attempt", async () => {
		const t = setup();
		stubBillingEnv();
		stubHitpay({
			charge: () => Response.json({ payment_id: "p", status: "failed" }),
			session: sessionCharged(3),
		});
		const { retailerId, subId } = await seedRetailer(t, "u_clr", "clr-store");
		await attachAutoRenew(t, subId, { timesCharged: 3 });
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);

		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });

		const sub = await getSub(t, subId);
		expect(sub?.autoRenew?.failedAttempts).toBe(1); // a recorded decline
		expect(sub?.autoRenew?.lastChargeAttemptAt).toBeUndefined();
		expect(sub?.autoRenew?.chargeCountAtAttempt).toBeUndefined();
	});
});

describe("only the session rail answers the stamp (viaSessionCharge)", () => {
	/** A store whose renewal charge was SENT and lost (stamp standing). */
	async function lostCharge(
		t: ReturnType<typeof setup>,
		userId: string,
		slug: string,
		calls: ReturnType<typeof stubHitpay>,
	) {
		const { retailerId, subId } = await seedRetailer(t, userId, slug);
		await attachAutoRenew(t, subId);
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });
		expect(calls.charges).toBe(1);
		expect((await getSub(t, subId))?.autoRenew?.lastChargeAttemptAt).toBeTypeOf(
			"number",
		);
		return { retailerId, subId, invoiceId };
	}

	test("a Pay-now settle of the stamped bill keeps the stamp and the counter — the reconcile later finds the landed charge and strands it", async () => {
		const t = setup();
		stubBillingEnv();
		vi.stubEnv("RESEND_API_KEY", "re_test");
		vi.stubEnv("EMAIL_FROM", "billing@kedaipal.test");
		const calls = stubHitpay({
			charge: () => lostRequest(),
			// 0 when the charge fires, 1 when the reconcile asks: it DID land.
			session: sessionCountSeq(0, 1),
		});
		const { subId, invoiceId } = await lostCharge(t, "u_rail", "rail-store", calls);

		// The seller pays the bill themselves (slipped-through checkout → v1
		// completion). The settle applies — but answers NOTHING about the
		// session charge.
		const settled = await t.mutation(
			internal.invoices.internalSettleFromGateway,
			{
				invoiceId,
				paymentId: "paynow_rail_1",
				amountSen: 14900,
				currency: "MYR",
				viaSessionCharge: false,
			},
		);
		expect(settled).toEqual({ applied: true });
		const mid = await getSub(t, subId);
		expect(mid?.autoRenew?.timesCharged ?? 0).toBe(0); // NO phantom bump
		expect(mid?.autoRenew?.lastChargeAttemptAt).toBeTypeOf("number"); // question still open

		// Next daily sweep: no pending bill, but the unresolved stamp routes the
		// reconcile at the bill the attempt was FIRED FOR. The landed charge is
		// found: double payment audited on that (paid) bill, auto-charging
		// stopped, counter caught up — and never a second POST.
		const run = await cronAt(t, Date.now() + DAY + HOUR);
		expect(run.autoChargeRetries).toBe(1);
		expect(calls.charges).toBe(1);
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.status).toBe("paid");
		expect(invoice?.gatewayIssue).toMatchObject({
			kind: "late_payment",
			paymentId: "reconciled:rb_1:1",
		});
		expect(invoice?.gatewayIssueOpen).toBe(true);
		const sub = await getSub(t, subId);
		expect(sub?.autoRenew?.strandedCharge).toMatchObject({
			invoiceId,
			paymentId: "reconciled:rb_1:1",
		});
		expect(sub?.autoRenew?.timesCharged).toBe(1);
		expect(sub?.autoRenew?.lastChargeAttemptAt).toBeUndefined();
	});

	test("…and when the lost charge never landed, the answered stamp CLOSES instead of looping daily", async () => {
		const t = setup();
		stubBillingEnv();
		const calls = stubHitpay({
			charge: () => lostRequest(),
			session: sessionCharged(0), // never landed
		});
		const { subId, invoiceId } = await lostCharge(t, "u_close", "close-store", calls);
		await t.mutation(internal.invoices.internalSettleFromGateway, {
			invoiceId,
			paymentId: "paynow_close_1",
			amountSen: 14900,
			currency: "MYR",
			viaSessionCharge: false,
		});

		const day1 = await cronAt(t, Date.now() + DAY + HOUR);
		expect(day1.autoChargeRetries).toBe(1);
		// 2: the baseline the lost charge captured, then the reconcile's read.
		expect(calls.sessionReads).toBe(2);
		expect(calls.charges).toBe(1); // nothing new was POSTed
		const sub = await getSub(t, subId);
		expect(sub?.autoRenew?.lastChargeAttemptAt).toBeUndefined(); // answered
		expect(sub?.autoRenew?.strandedCharge).toBeUndefined();
		expect(sub?.autoRenew?.timesCharged ?? 0).toBe(0);

		// The day after: nothing left to reconcile — the loop ended.
		const day2 = await cronAt(t, Date.now() + DAY);
		expect(day2.autoChargeRetries).toBe(0);
		expect(calls.sessionReads).toBe(2); // unchanged — nothing left to ask
	});

	test("a late Pay-now payment on the VOIDED stamped bill audits — but never strands, bumps, or answers the stamp", async () => {
		// The seller pays a dead link late. That is THEIR money on a void bill
		// (refund conversation) — it says nothing about the session charge,
		// which may still be out there.
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_v1void", "v1void-store");
		const voided = await seedRenewalInvoice(t, retailerId, subId, {
			status: "void" as const,
		});
		const stampedAt = Date.now() - 30 * HOUR;
		await attachAutoRenew(t, subId, {
			lastChargeAttemptAt: stampedAt,
			pendingChargeInvoiceId: voided,
		});

		const result = await t.mutation(
			internal.invoices.internalSettleFromGateway,
			{
				invoiceId: voided,
				paymentId: "paynow_dead_link",
				amountSen: 14900,
				currency: "MYR",
				viaSessionCharge: false,
			},
		);

		expect(result).toEqual({ applied: false, reason: "late_payment" });
		expect((await getInvoice(t, voided))?.gatewayIssue?.kind).toBe(
			"late_payment",
		);
		const sub = await getSub(t, subId);
		expect(sub?.autoRenew?.strandedCharge).toBeUndefined();
		expect(sub?.autoRenew?.timesCharged ?? 0).toBe(0);
		expect(sub?.autoRenew?.lastChargeAttemptAt).toBe(stampedAt);
	});

	test("subscribeSelf never promises (or schedules) a charge while a stamp is unresolved", async () => {
		const t = setup();
		stubBillingEnv();
		const calls = stubHitpay({ charge: () => succeeded("pay_never") });
		const { retailerId, subId } = await seedRetailer(t, "u_subw", "subw-store");
		const voided = await seedRenewalInvoice(t, retailerId, subId, {
			status: "void" as const,
		});
		await attachAutoRenew(t, subId, {
			lastChargeAttemptAt: Date.now() - 2 * HOUR,
			pendingChargeInvoiceId: voided,
		});
		await t.run((ctx) => ctx.db.patch(subId, { status: "trialing" as const }));

		const result = await t
			.withIdentity({ subject: "u_subw", email: "u_subw@x.com" })
			.mutation(api.invoices.subscribeSelf, {
				plan: "pro",
				billingCycle: "monthly",
			});
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(result.chargingSavedMethod).toBe(false);
		expect(calls.charges).toBe(0);
	});

	test("a FRESH stamp is never resolved by a not-ahead reading — the in-flight mutex survives", async () => {
		// Count-not-ahead can simply mean HitPay hasn't processed the in-flight
		// charge yet. Resolving a fresh stamp would hand the lock to a second
		// charge — the double debit.
		const t = setup();
		stubBillingEnv();
		const calls = stubHitpay({
			charge: () => succeeded("pay_never"),
			session: sessionCharged(0),
		});
		const { retailerId, subId } = await seedRetailer(t, "u_fresh", "fresh-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId, {
			status: "paid" as const,
			markedPaidBy: ADMIN,
		});
		const stampedAt = Date.now() - 60_000; // in flight
		await attachAutoRenew(t, subId, {
			lastChargeAttemptAt: stampedAt,
			pendingChargeInvoiceId: invoiceId,
		});

		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });

		expect(calls.sessionReads).toBe(1);
		expect(calls.charges).toBe(0);
		expect((await getSub(t, subId))?.autoRenew?.lastChargeAttemptAt).toBe(
			stampedAt,
		);
	});

	test("a GONE session with a stale stamp on a settled bill closes loudly instead of looping", async () => {
		const t = setup();
		stubBillingEnv();
		const calls = stubHitpay({
			charge: () => succeeded("pay_never"),
			session: () => new Response("not found", { status: 404 }),
		});
		const { retailerId, subId } = await seedRetailer(t, "u_gone2", "gone2-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId, {
			status: "paid" as const,
			markedPaidBy: ADMIN,
		});
		await attachAutoRenew(t, subId, {
			lastChargeAttemptAt: Date.now() - 30 * HOUR,
			pendingChargeInvoiceId: invoiceId,
		});

		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });

		expect(calls.charges).toBe(0);
		expect((await getSub(t, subId))?.autoRenew?.lastChargeAttemptAt).toBeUndefined();
	});
});

describe("the claim (recordChargeAttempt) — the transaction where charging becomes safe", () => {
	test("claiming retires the local Pay-now button in the same transaction as the stamp", async () => {
		const t = setup();
		const { retailerId, subId } = await seedRetailer(t, "u_clm", "clm-store");
		await attachAutoRenew(t, subId);
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId, {
			gatewayRequestId: "req_live",
			gatewayPayment: {
				provider: "hitpay" as const,
				url: "https://pay.example/req_live",
			},
		});

		const claim = await t.mutation(
			internal.subscriptionPayments.recordChargeAttempt,
			{ subscriptionId: subId, invoiceId },
		);

		expect(claim.claimed).toBe(true);
		const invoice = await getInvoice(t, invoiceId);
		// Without this, the billing tab and every email kept offering "Pay
		// online now" against a link the claim's remote DELETE had killed —
		// for as long as a lost outcome stayed unresolved.
		expect(invoice?.gatewayPayment).toBeUndefined();
		expect(invoice?.gatewayRequestId).toBeUndefined();
	});

	test("a bill that settled between the action's read and the claim is refused — the charge never fires", async () => {
		// The context read (query) and the claim (mutation) are separate
		// transactions; a Pay-now webhook can settle the bill in between. The
		// claim re-verifying `pending` is what closes that window.
		const t = setup();
		const { retailerId, subId } = await seedRetailer(t, "u_race2", "race2-store");
		await attachAutoRenew(t, subId);
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId, {
			status: "paid" as const,
			markedPaidBy: ADMIN,
		});
		const claim = await t.mutation(
			internal.subscriptionPayments.recordChargeAttempt,
			{ subscriptionId: subId, invoiceId },
		);
		expect(claim.claimed).toBe(false);
		expect((await getSub(t, subId))?.autoRenew?.lastChargeAttemptAt).toBeUndefined();
	});
});

// Clearing `autoRenew` (seller cancel, remote detach) used to destroy every
// hook the reconcile hangs off — with an outcome unknown, a landed charge
// became permanently invisible. The captured-facts action answers it anyway.
describe("cancel / detach with a charge outcome unknown (reconcileLostAttempt)", () => {
	/** Sub with a lost charge: stamp standing, session rb_1, bill pending. */
	async function lostThen(
		t: ReturnType<typeof setup>,
		userId: string,
		slug: string,
	) {
		const { retailerId, subId } = await seedRetailer(t, userId, slug);
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		await attachAutoRenew(t, subId, {
			lastChargeAttemptAt: Date.now() - 2 * HOUR,
			pendingChargeInvoiceId: invoiceId,
		});
		return { subId, invoiceId, asOwner: t.withIdentity({ subject: userId, email: `${userId}@x.com` }) };
	}

	test("cancel carries the attempt's BASELINE, not the tally — a drifted counter can't fake a landed charge", async () => {
		// The tally (5) sits below HitPay (7) for some reason that was never one
		// of our successes. The lost charge's baseline is 7 and HitPay still
		// says 7, so it never landed: the bill must get its Pay-now link back,
		// not be settled for free on the strength of the drift.
		const t = setup();
		stubBillingEnv();
		const calls = stubHitpay({
			charge: () => succeeded("pay_never"),
			session: sessionCharged(7),
			mint: () =>
				Response.json({ id: "req_back", url: "https://pay.example/req_back" }),
		});
		const { retailerId, subId } = await seedRetailer(t, "u_cxlb", "cxlb-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		await attachAutoRenew(t, subId, {
			timesCharged: 5,
			chargeCountAtAttempt: 7,
			lastChargeAttemptAt: Date.now() - 2 * HOUR,
			pendingChargeInvoiceId: invoiceId,
		});

		await t
			.withIdentity({ subject: "u_cxlb", email: "u_cxlb@x.com" })
			.mutation(api.subscriptionPayments.cancelAutoRenew, {});
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.status).toBe("pending"); // NOT settled for free
		expect(invoice?.gatewayPayment?.url).toBe("https://pay.example/req_back");
		expect(calls.charges).toBe(0);
	});

	test("cancel: the landed charge is still found and settled, THEN the session is deleted", async () => {
		const t = setup();
		stubBillingEnv();
		const calls = stubHitpay({
			charge: () => succeeded("pay_never"),
			session: sessionCharged(1),
		});
		const { subId, invoiceId, asOwner } = await lostThen(t, "u_cxl", "cxl-store");

		await asOwner.mutation(api.subscriptionPayments.cancelAutoRenew, {});
		expect((await getSub(t, subId))?.autoRenew).toBeUndefined(); // off NOW
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(calls.sessionReads).toBe(1);
		expect(calls.charges).toBe(0);
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.status).toBe("paid");
		expect(invoice?.markedPaidBy).toBe("reconciled:rb_1:1");
		// Deleted only AFTER the count was read — deleting first would 404 the
		// very answer this needed.
		expect(calls.sessionDeletes).toBe(1);
	});

	test("cancel: a charge that never landed re-mints the Pay-now link the claim killed", async () => {
		const t = setup();
		stubBillingEnv();
		const calls = stubHitpay({
			charge: () => succeeded("pay_never"),
			session: sessionCharged(0),
			mint: () =>
				Response.json({ id: "req_back", url: "https://pay.example/req_back" }),
		});
		const { invoiceId, asOwner } = await lostThen(t, "u_cxl2", "cxl2-store");

		await asOwner.mutation(api.subscriptionPayments.cancelAutoRenew, {});
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(calls.charges).toBe(0);
		expect(calls.mints).toBe(1);
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.status).toBe("pending");
		expect(invoice?.gatewayPayment?.url).toBe("https://pay.example/req_back");
		expect(calls.sessionDeletes).toBe(1);
	});

	test("cancel: no answer from HitPay → retries, then stops WITHOUT re-minting or deleting — never guesses about money", async () => {
		const t = setup();
		stubBillingEnv();
		const calls = stubHitpay({
			charge: () => succeeded("pay_never"),
			session: () => new Response("down", { status: 503 }),
		});
		const { invoiceId, asOwner } = await lostThen(t, "u_cxl3", "cxl3-store");

		await asOwner.mutation(api.subscriptionPayments.cancelAutoRenew, {});
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(calls.sessionReads).toBe(5); // 1 + the 4 scheduled retries
		expect(calls.mints).toBe(0); // a manual payment invite could be the 2nd payment
		expect(calls.sessionDeletes).toBe(0); // left inspectable for the human
		expect((await getInvoice(t, invoiceId))?.gatewayPayment).toBeUndefined();
	});

	test("detach (HitPay-side): same reconcile, but never a session delete", async () => {
		const t = setup();
		stubBillingEnv();
		const calls = stubHitpay({
			charge: () => succeeded("pay_never"),
			session: sessionCharged(1),
		});
		const { subId, invoiceId } = await lostThen(t, "u_det", "det-store");

		await t.mutation(internal.subscriptionPayments.recordMethodDetached, {
			billingId: "rb_1",
		});
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect((await getSub(t, subId))?.autoRenew).toBeUndefined();
		expect((await getInvoice(t, invoiceId))?.status).toBe("paid");
		expect(calls.sessionDeletes).toBe(0);
	});

	test("cancel with NOTHING unresolved deletes the session straight away (unchanged behaviour)", async () => {
		const t = setup();
		stubBillingEnv();
		const calls = stubHitpay({ charge: () => succeeded("pay_never") });
		const { retailerId, subId } = await seedRetailer(t, "u_cxl4", "cxl4-store");
		await seedRenewalInvoice(t, retailerId, subId);
		await attachAutoRenew(t, subId);

		await t
			.withIdentity({ subject: "u_cxl4", email: "u_cxl4@x.com" })
			.mutation(api.subscriptionPayments.cancelAutoRenew, {});
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(calls.sessionDeletes).toBe(1);
		expect(calls.sessionReads).toBe(0);
	});
});

// Real gateway money that settled nothing used to be invisible exactly when
// it mattered: a late_payment sits on a PAID or VOID bill by definition, and
// the console only rendered pending rows.
describe("payments to review (gatewayIssueOpen)", () => {
	test("a late payment is queued with its store, and resolving records who/when/what", async () => {
		const t = setup();
		const { retailerId, subId } = await seedRetailer(t, "u_q", "q-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId, {
			status: "paid" as const,
			markedPaidBy: ADMIN,
		});
		await t.mutation(internal.invoices.internalSettleFromGateway, {
			invoiceId,
			paymentId: "pay_late_q",
			amountSen: 14900,
			currency: "MYR",
			viaSessionCharge: false,
		});

		const queue = await t
			.withIdentity({ subject: ADMIN })
			.query(api.invoices.listGatewayIssues, {});
		expect(queue).toHaveLength(1);
		expect(queue[0]).toMatchObject({
			invoiceId,
			invoiceStatus: "paid",
			storeName: "Store q-store",
			slug: "q-store",
			kind: "late_payment",
			paymentId: "pay_late_q",
			amountSen: 14900,
		});
		// Only admins may read or close money-review state.
		await expect(
			t.withIdentity({ subject: "u_q" }).query(api.invoices.listGatewayIssues, {}),
		).rejects.toThrow();
		await expect(
			t
				.withIdentity({ subject: "u_q" })
				.mutation(api.invoices.resolveGatewayIssue, { invoiceId }),
		).rejects.toThrow();

		await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.invoices.resolveGatewayIssue, {
				invoiceId,
				note: "refunded in HitPay",
			});
		expect(
			await t.withIdentity({ subject: ADMIN }).query(api.invoices.listGatewayIssues, {}),
		).toHaveLength(0);
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.gatewayIssueOpen).toBeUndefined();
		// Resolution is recorded, never deleted — the audit survives.
		expect(invoice?.gatewayIssue).toMatchObject({
			kind: "late_payment",
			resolvedBy: ADMIN,
			resolvedNote: "refunded in HitPay",
		});
		expect(invoice?.gatewayIssue?.resolvedAt).toBeTypeOf("number");
		await expect(
			t
				.withIdentity({ subject: ADMIN })
				.mutation(api.invoices.resolveGatewayIssue, { invoiceId }),
		).rejects.toThrow(/Already resolved/);
	});

	test("an amount mismatch on a PENDING bill is queued too", async () => {
		const t = setup();
		const { retailerId, subId } = await seedRetailer(t, "u_q2", "q2-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		await t.mutation(internal.invoices.internalSettleFromGateway, {
			invoiceId,
			paymentId: "pay_mismatch_q",
			amountSen: 999,
			currency: "MYR",
			viaSessionCharge: false,
		});
		const queue = await t
			.withIdentity({ subject: ADMIN })
			.query(api.invoices.listGatewayIssues, {});
		expect(queue).toHaveLength(1);
		expect(queue[0]).toMatchObject({
			kind: "amount_mismatch",
			invoiceStatus: "pending",
			amountSen: 999,
			invoiceTotal: 14900,
		});
	});

	test("the backfill flags stamps from before the queue existed — and skips resolved ones", async () => {
		const t = setup();
		const { retailerId, subId } = await seedRetailer(t, "u_q3", "q3-store");
		const legacy = await seedRenewalInvoice(t, retailerId, subId, {
			invoiceNumber: "INV-LEGACY",
			status: "void" as const,
			gatewayIssue: {
				kind: "late_payment" as const,
				paymentId: "pay_old",
				amountSen: 14900,
				at: Date.now() - 5 * DAY,
			},
		});
		await seedRenewalInvoice(t, retailerId, subId, {
			invoiceNumber: "INV-RESOLVED",
			status: "void" as const,
			gatewayIssue: {
				kind: "late_payment" as const,
				paymentId: "pay_done",
				amountSen: 14900,
				at: Date.now() - 9 * DAY,
				resolvedAt: Date.now() - 8 * DAY,
				resolvedBy: ADMIN,
			},
		});

		const result = await t.mutation(
			internal.migrations.backfillGatewayIssueOpen,
			{},
		);
		expect(result.flagged).toBe(1);
		const queue = await t
			.withIdentity({ subject: ADMIN })
			.query(api.invoices.listGatewayIssues, {});
		expect(queue.map((r) => r.invoiceId)).toEqual([legacy]);
	});
});

// The reconcile's no-double-charge verdict is exactly as good as counter
// parity with HitPay: local behind ⇒ a free settle; local ahead ⇒ a double
// charge. This one-shot aligns them at release, skipping any session whose
// drift IS evidence of an open question.
describe("syncChargeCounters (operator one-shot)", () => {
	test("patches drift, keeps sync, and reports every session", async () => {
		const t = setup();
		stubBillingEnv();
		const counts: Record<string, number> = { rb_a: 3, rb_b: 1 };
		stubHitpay({
			charge: () => {
				throw new Error("the sync must never charge");
			},
			session: sessionCharged(0), // overridden per-URL below
		});
		// Per-session counts: re-stub with a URL-aware session responder.
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: unknown) => {
				const u = String(url);
				const id = u.split("/recurring-billing/")[1];
				if (u.includes("/charge/")) throw new Error("must never charge");
				return Response.json({
					status: "active",
					cycle: "save_card",
					times_charged: null,
					total_charge: counts[id ?? ""] ?? 0,
				});
			}),
		);

		const a = await seedRetailer(t, "u_sync_a", "sync-a");
		await attachAutoRenew(t, a.subId, { timesCharged: 1 }); // behind (3 real)
		await t.run((ctx) => ctx.db.patch(a.subId, { autoRenewSessionId: "rb_a" }));
		const b = await seedRetailer(t, "u_sync_b", "sync-b");
		await attachAutoRenew(t, b.subId, { timesCharged: 1 }); // in sync
		await t.run((ctx) => ctx.db.patch(b.subId, { autoRenewSessionId: "rb_b" }));

		const report = await t.action(
			internal.subscriptionPayments.syncChargeCounters,
			{},
		);

		expect(report).toHaveLength(2);
		expect(
			report.find((r) => r.sessionId === "rb_a"),
		).toMatchObject({ outcome: "patched", local: 1, remote: 3 });
		expect(
			report.find((r) => r.sessionId === "rb_b"),
		).toMatchObject({ outcome: "in_sync" });
		expect((await getSub(t, a.subId))?.autoRenew?.timesCharged).toBe(3);
		expect((await getSub(t, b.subId))?.autoRenew?.timesCharged).toBe(1);
	});

	test("NEVER syncs over an open question — unresolved and stranded sessions are skipped and reported", async () => {
		// Aligning the counter while a charge outcome is unknown erases the
		// exact drift the reconcile reads as "the money landed" — the sync
		// would convert a pending double-payment discovery into a free month or a
		// re-charge.
		const t = setup();
		stubBillingEnv();
		const calls = stubHitpay({
			charge: () => {
				throw new Error("must never charge");
			},
			session: sessionCharged(5),
		});
		const u = await seedRetailer(t, "u_sync_u", "sync-u");
		const invoiceId = await seedRenewalInvoice(t, u.retailerId, u.subId);
		await attachAutoRenew(t, u.subId, {
			timesCharged: 4,
			lastChargeAttemptAt: Date.now() - HOUR,
			pendingChargeInvoiceId: invoiceId,
		});
		const st = await seedRetailer(t, "u_sync_s", "sync-s");
		await attachAutoRenew(t, st.subId, {
			timesCharged: 4,
			strandedCharge: {
				invoiceId,
				invoiceNumber: "INV-OLD",
				amountSen: 14900,
				currency: "MYR",
				paymentId: "reconciled:rb_1:5",
				at: Date.now(),
			},
		});

		const report = await t.action(
			internal.subscriptionPayments.syncChargeCounters,
			{},
		);

		expect(report.map((r) => r.outcome).sort()).toEqual([
			"skipped_stranded",
			"skipped_unresolved",
		]);
		expect(calls.sessionReads).toBe(0); // not even read — nothing to align
		expect((await getSub(t, u.subId))?.autoRenew?.timesCharged).toBe(4);
		expect((await getSub(t, st.subId))?.autoRenew?.timesCharged).toBe(4);
	});
});

describe("internalSettleFromGateway", () => {
	test("duplicate payment id no-ops; a different late payment stamps the audit", async () => {
		const t = setup();
		const { retailerId, subId } = await seedRetailer(t, "u_dup", "dup-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);

		const first = await t.mutation(internal.invoices.internalSettleFromGateway, {
			viaSessionCharge: false,
			invoiceId,
			paymentId: "pay_1",
			amountSen: 14900,
			currency: "MYR",
			methodCode: "card",
		});
		expect(first.applied).toBe(true);

		const dupe = await t.mutation(internal.invoices.internalSettleFromGateway, {
			viaSessionCharge: false,
			invoiceId,
			paymentId: "pay_1",
			amountSen: 14900,
			currency: "MYR",
		});
		expect(dupe).toEqual({ applied: false, reason: "duplicate" });
		expect((await getInvoice(t, invoiceId))?.gatewayIssue).toBeUndefined();

		const late = await t.mutation(internal.invoices.internalSettleFromGateway, {
			viaSessionCharge: false,
			invoiceId,
			paymentId: "pay_2_other",
			amountSen: 14900,
			currency: "MYR",
		});
		expect(late).toEqual({ applied: false, reason: "late_payment" });
		expect((await getInvoice(t, invoiceId))?.gatewayIssue?.kind).toBe(
			"late_payment",
		);
	});

	test("amount/currency mismatch stamps the issue and settles NOTHING", async () => {
		const t = setup();
		const { retailerId, subId } = await seedRetailer(t, "u_mis", "mis-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		const result = await t.mutation(internal.invoices.internalSettleFromGateway, {
			viaSessionCharge: false,
			invoiceId,
			paymentId: "pay_wrong",
			amountSen: 9900,
			currency: "MYR",
		});
		expect(result).toEqual({ applied: false, reason: "amount_mismatch" });
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.status).toBe("pending");
		expect(invoice?.gatewayIssue).toMatchObject({
			kind: "amount_mismatch",
			paymentId: "pay_wrong",
			amountSen: 9900,
		});
	});

	test("a founding invoice settled via the gateway claims the rank — no fork", async () => {
		const t = setup();
		const { retailerId, subId } = await seedRetailer(t, "u_rank", "rank-store");
		await t.run(async (ctx) => ctx.db.patch(subId, { foundingIntent: true }));
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId, {
			origin: "self_serve" as const,
			foundingDiscount: 4500,
			total: 10400,
		});
		const result = await t.mutation(internal.invoices.internalSettleFromGateway, {
			viaSessionCharge: false,
			invoiceId,
			paymentId: "pay_f1",
			amountSen: 10400,
			currency: "MYR",
			methodCode: "touch_n_go",
		});
		expect(result.applied).toBe(true);
		const founding = await t.run(async (ctx) =>
			ctx.db
				.query("foundingMembers")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first(),
		);
		expect(founding?.rank).toBe(1);
		expect(founding?.paidAt).toBeTypeOf("number");
		const retailer = await t.run(async (ctx) => ctx.db.get(retailerId));
		expect(retailer?.isFoundingMember).toBe(true);
		expect((await getInvoice(t, invoiceId))?.paymentMethod).toBe(
			"hitpay_touch_n_go",
		);
	});
});

describe("POST /webhook/hitpay — V2 event branch (Kedaipal's account)", () => {
	async function signEvent(body: string): Promise<string> {
		const encoder = new TextEncoder();
		const key = await crypto.subtle.importKey(
			"raw",
			encoder.encode(BILLING_SALT),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
		const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
		return [...new Uint8Array(sig)]
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	}

	test("charge.created settles the pending renewal (webhook-only path)", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_ev", "ev-store");
		await attachAutoRenew(t, subId);
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);

		const body = JSON.stringify({
			id: "pay_ev_1",
			channel: "recurrent",
			status: "succeeded",
			amount: 149,
			currency: "myr",
			recurring_billing_id: "rb_1",
			payment_provider: { charge: { method: "card" } },
		});
		const res = await t.fetch("/webhook/hitpay", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Hitpay-Signature": await signEvent(body),
				"Hitpay-Event-Object": "charge",
				"Hitpay-Event-Type": "created",
			},
			body,
		});
		expect(res.status).toBe(200);
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.status).toBe("paid");
		expect(invoice?.markedPaidBy).toBe("pay_ev_1");
	});

	test("a late charge.created for a bill voided mid-unknown STRANDS it — the replacement is neither settled nor charged", async () => {
		// The other door to the same fact: the webhook resolves the charge to
		// the bill the attempt stamp names, which was voided while we waited.
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_evs", "evs-store");
		const voided = await seedRenewalInvoice(t, retailerId, subId, {
			invoiceNumber: "INV-OLD",
			status: "void" as const,
		});
		const replacement = await seedRenewalInvoice(t, retailerId, subId, {
			invoiceNumber: "INV-NEW",
		});
		await attachAutoRenew(t, subId, {
			lastChargeAttemptAt: Date.now() - HOUR,
			pendingChargeInvoiceId: voided,
		});

		const body = JSON.stringify({
			id: "pay_ev_late",
			channel: "recurrent",
			status: "succeeded",
			amount: 149,
			currency: "myr",
			recurring_billing_id: "rb_1",
			payment_provider: { charge: { method: "card" } },
		});
		const res = await t.fetch("/webhook/hitpay", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Hitpay-Signature": await signEvent(body),
				"Hitpay-Event-Object": "charge",
				"Hitpay-Event-Type": "created",
			},
			body,
		});

		expect(res.status).toBe(200);
		expect((await getInvoice(t, voided))?.gatewayIssue).toMatchObject({
			kind: "late_payment",
			paymentId: "pay_ev_late",
		});
		expect((await getInvoice(t, replacement))?.status).toBe("pending");
		const sub = await getSub(t, subId);
		expect(sub?.autoRenew?.strandedCharge).toMatchObject({
			invoiceNumber: "INV-OLD",
			paymentId: "pay_ev_late",
		});
		expect(sub?.autoRenew?.lastChargeAttemptAt).toBeUndefined();
		expect(sub?.autoRenew?.timesCharged).toBe(1);
	});

	test("method_attached arms the sub; forged signatures 401; missing salt 500", async () => {
		const t = setup();
		stubBillingEnv();
		const { subId } = await seedRetailer(t, "u_att", "att-store");
		await t.run(async (ctx) =>
			ctx.db.patch(subId, {
				autoRenewSessionId: "rb_att",
				autoRenewSetup: { url: "https://auth.example/rb_att", createdAt: Date.now() },
			}),
		);
		const body = JSON.stringify({
			id: "rb_att",
			cycle: "save_card",
			status: "active",
			payment_method: "touch_n_go",
		});
		const ok = await t.fetch("/webhook/hitpay", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Hitpay-Signature": await signEvent(body),
				"Hitpay-Event-Object": "recurring_billing",
				"Hitpay-Event-Type": "method_attached",
			},
			body,
		});
		expect(ok.status).toBe(200);
		const sub = await getSub(t, subId);
		expect(sub?.autoRenew?.method).toBe("touch_n_go");
		expect(sub?.autoRenewSetup).toBeUndefined();

		const forged = await t.fetch("/webhook/hitpay", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Hitpay-Signature": "deadbeef",
			},
			body,
		});
		expect(forged.status).toBe(401);

		vi.unstubAllEnvs();
		const noSalt = await t.fetch("/webhook/hitpay", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Hitpay-Signature": await signEvent(body),
			},
			body,
		});
		expect(noSalt.status).toBe(500);
	});
});

describe("POST /webhook/hitpay — v1 invoice completion branch", () => {
	async function signedForm(fields: Record<string, string>): Promise<string> {
		const hmac = await computeHitpayHmac(fields, BILLING_SALT);
		return new URLSearchParams({ ...fields, hmac }).toString();
	}

	test("a completed Pay-now callback settles the invoice with the ENV salt", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_v1", "v1-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId, {
			gatewayRequestId: "req_v1_1",
			gatewayPayment: { provider: "hitpay" as const, url: "https://pay.example/x" },
		});
		const res = await t.fetch("/webhook/hitpay", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: await signedForm({
				payment_id: "pay_v1_1",
				payment_request_id: "req_v1_1",
				amount: "149.00",
				currency: "MYR",
				status: "completed",
				reference_number: "INV-REN-1",
			}),
		});
		expect(res.status).toBe(200);
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.status).toBe("paid");
		expect(invoice?.gatewayPayment?.paymentId).toBe("pay_v1_1");
	});

	test("a bad hmac on an invoice callback is rejected 401", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_v1b", "v1b-store");
		await seedRenewalInvoice(t, retailerId, subId, {
			gatewayRequestId: "req_v1_2",
		});
		const fields = {
			payment_id: "pay_v1_2",
			payment_request_id: "req_v1_2",
			amount: "149.00",
			currency: "MYR",
			status: "completed",
			hmac: "0000",
		};
		const res = await t.fetch("/webhook/hitpay", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams(fields).toString(),
		});
		expect(res.status).toBe(401);
	});
});

describe("cancelAutoRenew", () => {
	test("always clears local state — no autoRenew ⇒ structurally nothing can charge", async () => {
		const t = setup();
		const { subId } = await seedRetailer(t, "u_off", "off-store");
		await attachAutoRenew(t, subId);
		const res = await t
			.withIdentity({ subject: "u_off" })
			.mutation(api.subscriptionPayments.cancelAutoRenew, {});
		expect(res).toEqual({ ok: true });
		const sub = await getSub(t, subId);
		expect(sub?.autoRenew).toBeUndefined();
		expect(sub?.autoRenewSessionId).toBeUndefined();
		expect(sub?.autoRenewSetup).toBeUndefined();
	});
});

describe("verifyInvoicePayment (redirect-return reconcile)", () => {
	test("finds the succeeded payment on the request and settles idempotently", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_ver", "ver-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId, {
			gatewayRequestId: "req_ver_1",
			gatewayPayment: { provider: "hitpay" as const, url: "https://pay.example/v" },
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					id: "req_ver_1",
					status: "completed",
					payments: [
						{
							id: "pay_ver_1",
							status: "succeeded",
							amount: "149.00",
							currency: "MYR",
							payment_type: "touch_n_go",
						},
					],
				}),
			),
		);
		const result = await t
			.withIdentity({ subject: "u_ver" })
			.action(api.subscriptionPayments.verifyInvoicePayment, {});
		expect(result.settled).toBe(true);
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.status).toBe("paid");
		expect(invoice?.paymentMethod).toBe("hitpay_touch_n_go");
	});
});

describe("changePlan — tier changes mid-subscription (86eyb6z4r)", () => {
	/** An ACTIVE paid seller, mid-period. */
	async function seedActive(
		t: ReturnType<typeof setup>,
		userId: string,
		slug: string,
		plan: "starter" | "pro" | "scale" = "starter",
	) {
		const { retailerId, subId } = await seedRetailer(t, userId, slug);
		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.patch(subId, {
				plan,
				status: "active" as const,
				currentPeriodStart: now - 20 * 86400000,
				currentPeriodEnd: now + 10 * 86400000,
			});
			// A paid invoice fixes the billing currency.
			await ctx.db.insert("invoices", {
				retailerId,
				subscriptionId: subId,
				invoiceNumber: "INV-PAID-1",
				plan,
				billingCycle: "monthly" as const,
				amount: 7900,
				total: 7900,
				currency: "MYR",
				periodStart: now - 20 * 86400000,
				periodEnd: now + 10 * 86400000,
				dueDate: now - 20 * 86400000,
				status: "paid" as const,
				createdAt: now - 20 * 86400000,
			});
		});
		return { retailerId, subId };
	}

	test("UP is immediate and billed at the ordinary full price", async () => {
		const t = setup();
		const { retailerId, subId } = await seedActive(t, "u_up", "up-store");
		const res = await t
			.withIdentity({ subject: "u_up" })
			.mutation(api.invoices.changePlan, { plan: "pro" });
		expect(res.kind).toBe("invoiced");
		const invoice = await t.run(async (ctx) => {
			const rows = await ctx.db
				.query("invoices")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.collect();
			return rows.find((i) => i.status === "pending");
		});
		// Full sticker price — NOT a prorated difference. That is what keeps the
		// gateway amount check, the PDF totals and MRR all working untouched.
		expect(invoice?.total).toBe(14900);
		expect(invoice?.plan).toBe("pro");
		// The tier does not move until they actually pay.
		expect((await getSub(t, subId))?.plan).toBe("starter");
	});

	test("paying an upgrade CARRIES the unused days onto the new period", async () => {
		const t = setup();
		const { retailerId, subId } = await seedActive(t, "u_carry", "carry-store");
		await t
			.withIdentity({ subject: "u_carry" })
			.mutation(api.invoices.changePlan, { plan: "pro" });
		const invoiceId = await t.run(async (ctx) => {
			const rows = await ctx.db
				.query("invoices")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.collect();
			return rows.find((i) => i.status === "pending")?._id;
		});
		if (!invoiceId) throw new Error("no invoice");
		await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.invoices.markPaid, { invoiceId });
		const after = await getSub(t, subId);
		expect(after?.plan).toBe("pro");
		// 10 days of Starter left → 5 days of Pro, on top of the fresh 30. The
		// old behaviour granted a bare 30 and burned the remainder.
		const grantedDays = Math.round(
			((after?.currentPeriodEnd ?? 0) - Date.now()) / 86400000,
		);
		expect(grantedDays).toBe(35);
		expect(grantedDays).toBeGreaterThan(30);
	});

	test("DOWN is scheduled, charges nothing, and changes nothing today", async () => {
		const t = setup();
		const { retailerId, subId } = await seedActive(t, "u_dn", "dn-store", "pro");
		const res = await t
			.withIdentity({ subject: "u_dn" })
			.mutation(api.invoices.changePlan, { plan: "starter" });
		expect(res.kind).toBe("scheduled");
		const sub = await getSub(t, subId);
		expect(sub?.pendingPlanChange?.plan).toBe("starter");
		// Still Pro, still the Pro caps — they paid for them.
		expect(sub?.plan).toBe("pro");
		expect(sub?.orderCap).toBe(200);
		// And no bill was raised.
		const invoices = await t.run(async (ctx) =>
			ctx.db
				.query("invoices")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.collect(),
		);
		expect(invoices.filter((i) => i.status === "pending")).toHaveLength(0);
	});

	test("the scheduled downgrade lands with the renewal, then clears itself", async () => {
		const t = setup();
		const { retailerId, subId } = await seedActive(t, "u_sch", "sch-store", "pro");
		await t
			.withIdentity({ subject: "u_sch" })
			.mutation(api.invoices.changePlan, { plan: "starter" });
		// The period runs out.
		await t.run(async (ctx) =>
			ctx.db.patch(subId, { currentPeriodEnd: Date.now() - 1000 }),
		);
		const issued = await t.mutation(
			internal.invoices.internalIssueRenewalInvoice,
			{ subscriptionId: subId },
		);
		expect(issued.issued).toBe(true);
		const renewal = await t.run(async (ctx) => {
			const rows = await ctx.db
				.query("invoices")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.collect();
			return rows.find((i) => i.status === "pending");
		});
		expect(renewal?.plan).toBe("starter");
		expect(renewal?.total).toBe(7900);
		// Consumed — it must not re-apply to every future renewal.
		expect((await getSub(t, subId))?.pendingPlanChange).toBeUndefined();
	});

	test("a scheduled downgrade can be cancelled, and an upgrade supersedes it", async () => {
		const t = setup();
		const { subId } = await seedActive(t, "u_undo", "undo-store", "pro");
		const asUser = t.withIdentity({ subject: "u_undo" });
		await asUser.mutation(api.invoices.changePlan, { plan: "starter" });
		await asUser.mutation(api.invoices.cancelPlanChange, {});
		expect((await getSub(t, subId))?.pendingPlanChange).toBeUndefined();
		// Schedule again, then move UP — the pending downgrade must not survive.
		await asUser.mutation(api.invoices.changePlan, { plan: "starter" });
		await t.run(async (ctx) => ctx.db.patch(subId, { plan: "starter" }));
		await asUser.mutation(api.invoices.changePlan, { plan: "pro" });
		expect((await getSub(t, subId))?.pendingPlanChange).toBeUndefined();
	});

	test("refuses the no-op, the non-active seller and an open invoice", async () => {
		const t = setup();
		const { retailerId, subId } = await seedActive(t, "u_g", "g-store");
		const asUser = t.withIdentity({ subject: "u_g" });
		await expect(
			asUser.mutation(api.invoices.changePlan, { plan: "starter" }),
		).rejects.toThrow(/already on starter/);
		// An open bill must be settled before moving up (single-pending invariant).
		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert("invoices", {
				retailerId,
				subscriptionId: subId,
				invoiceNumber: "INV-OPEN",
				plan: "starter" as const,
				billingCycle: "monthly" as const,
				amount: 7900,
				total: 7900,
				currency: "MYR",
				periodStart: now,
				periodEnd: now + 30 * 86400000,
				dueDate: now + 14 * 86400000,
				status: "pending" as const,
				createdAt: now,
			});
		});
		await expect(
			asUser.mutation(api.invoices.changePlan, { plan: "pro" }),
		).rejects.toThrow(/Settle your open invoice/);
		// Not active → the picker's job, not this one.
		await t.run(async (ctx) =>
			ctx.db.patch(subId, { status: "past_due" as const }),
		);
		await expect(
			asUser.mutation(api.invoices.changePlan, { plan: "pro" }),
		).rejects.toThrow(/Choose a plan/);
	});

	/**
	 * Scale opened for purchase with the credits release (z8r3fdfuhq). Pro →
	 * Scale is an upgrade by RANK — billed now at Scale's ordinary price — and
	 * paying it lands Scale's credits for THIS month (T1's upgrade rule);
	 * Scale → Pro waits for the end of the paid period like any downgrade.
	 */
	test("Pro → Scale is billed now at Scale's price, and paying lands Scale's credits this month", async () => {
		const t = setup();
		const { retailerId, subId } = await seedActive(
			t,
			"u_up_sc",
			"up-sc-store",
			"pro",
		);
		const res = await t
			.withIdentity({ subject: "u_up_sc" })
			.mutation(api.invoices.changePlan, { plan: "scale" });
		expect(res.kind).toBe("invoiced");
		const invoice = await t.run(async (ctx) => {
			const rows = await ctx.db
				.query("invoices")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.collect();
			return rows.find((i) => i.status === "pending");
		});
		expect(invoice).toMatchObject({ plan: "scale", total: 39900 });
		if (!invoice) throw new Error("no invoice");
		await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.invoices.markPaid, { invoiceId: invoice._id });
		expect((await getSub(t, subId))?.plan).toBe("scale");
		const account = await t.run(async (ctx) =>
			ctx.db
				.query("creditAccounts")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first(),
		);
		expect(account?.periodGrant).toBe(500);
		expect(account?.planBalance).toBe(500);
	});

	test("Scale → Pro is scheduled for the period's end — nothing billed, nothing taken today", async () => {
		const t = setup();
		const { retailerId, subId } = await seedActive(
			t,
			"u_dn_sc",
			"dn-sc-store",
			"scale",
		);
		const res = await t
			.withIdentity({ subject: "u_dn_sc" })
			.mutation(api.invoices.changePlan, { plan: "pro" });
		expect(res.kind).toBe("scheduled");
		const sub = await getSub(t, subId);
		expect(sub?.plan).toBe("scale");
		expect(sub?.pendingPlanChange?.plan).toBe("pro");
		const pending = await t.run(async (ctx) =>
			(
				await ctx.db
					.query("invoices")
					.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
					.collect()
			).filter((i) => i.status === "pending"),
		);
		expect(pending).toHaveLength(0);
	});

	test("a Founding Member still can't move to Scale — the founding price never carries to it", async () => {
		const t = setup();
		const { retailerId } = await seedActive(t, "u_fnd_sc", "fnd-sc-store", "pro");
		await t.run(async (ctx) =>
			ctx.db.patch(retailerId, { isFoundingMember: true, foundingMemberRank: 2 }),
		);
		await expect(
			t
				.withIdentity({ subject: "u_fnd_sc" })
				.mutation(api.invoices.changePlan, { plan: "scale" }),
		).rejects.toThrow(/Founding Pro/);
	});

	test("an upgrade charges an already-attached saved method", async () => {
		const t = setup();
		stubBillingEnv();
		const { subId } = await seedActive(t, "u_sm", "sm-store");
		await t.run(async (ctx) =>
			ctx.db.patch(subId, {
				autoRenewSessionId: "rb_sm",
				autoRenew: {
					provider: "hitpay" as const,
					method: "card",
					attachedAt: Date.now(),
				},
			}),
		);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({ payment_id: "pay_sm", status: "succeeded" }),
			),
		);
		const res = await t
			.withIdentity({ subject: "u_sm" })
			.mutation(api.invoices.changePlan, { plan: "pro" });
		expect(res).toMatchObject({ kind: "invoiced", chargingSavedMethod: true });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect((await getSub(t, subId))?.plan).toBe("pro");
	});
});
