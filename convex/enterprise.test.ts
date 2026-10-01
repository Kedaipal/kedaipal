/// <reference types="vite/client" />
// Kedaipal Credits T6 (z8r3fdkp8h, docs/pricing.md#enterprise): the Enterprise
// contract — how a store gets on one, what it's billed and granted, the one
// way off it, and what the seller sees.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ensureCreditAccount } from "./credits";
import { isUnlimited, PLAN_CAPS, planChangeCarryoverDays, UNLIMITED } from "./lib/plans";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}
type T = ReturnType<typeof setup>;

const OWNER = "user_ent_owner";
const ADMIN = "user_ent_admin";
const DAY = 24 * 60 * 60 * 1000;
/** Noon MYT on 10 Oct 2026 — mid-month. */
const OCT_10 = Date.parse("2026-10-10T12:00:00+08:00");

let prevAdminEnv: string | undefined;
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(OCT_10);
	prevAdminEnv = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	process.env.ADMIN_USER_IDS = prevAdminEnv;
});

const asAdmin = (t: T) => t.withIdentity({ subject: ADMIN });

/** HSL / Mama's Delights, as agreed (Arif, 30 Sep 2026). */
const HSL = {
	baseFeeMinor: 88800,
	includedCredits: 1500,
	overageRateMinor: 60,
	blockSize: 5000,
	billingCycle: "monthly" as const,
	contactName: "HSL Food GM",
};

/** An active Pro store, mid-period, with its credit account opened fresh. */
async function activeStore(
	t: T,
	opts: {
		userId?: string;
		country?: "MY" | "SG";
		sub?: Partial<Doc<"subscriptions">>;
	} = {},
) {
	const userId = opts.userId ?? OWNER;
	const slug = `ent-${userId.replace(/[^a-z0-9]/g, "")}`;
	await t
		.withIdentity({ subject: userId })
		.mutation(api.retailers.createRetailer, { storeName: `Store ${slug}`, slug });
	return t.run(async (ctx) => {
		const r = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", slug))
			.first();
		const sub = r
			? await ctx.db
					.query("subscriptions")
					.withIndex("by_retailer", (q) => q.eq("retailerId", r._id))
					.first()
			: null;
		if (!r || !sub) throw new Error("seed failed");
		if (opts.country) await ctx.db.patch(r._id, { country: opts.country });
		const now = Date.now();
		await ctx.db.patch(sub._id, {
			plan: "pro",
			status: "active",
			currentPeriodStart: now - 20 * DAY,
			currentPeriodEnd: now + 10 * DAY,
			...opts.sub,
		});
		for (const row of await ctx.db
			.query("creditLedger")
			.withIndex("by_retailer_created", (q) => q.eq("retailerId", r._id))
			.collect())
			await ctx.db.delete(row._id);
		const account = await ctx.db
			.query("creditAccounts")
			.withIndex("by_retailer", (q) => q.eq("retailerId", r._id))
			.first();
		if (account) await ctx.db.delete(account._id);
		await ensureCreditAccount(ctx, r._id, now);
		return { retailerId: r._id, subId: sub._id, userId };
	});
}

const getSub = (t: T, subId: Id<"subscriptions">) =>
	t.run((ctx) => ctx.db.get(subId));

const creditAccount = (t: T, retailerId: Id<"retailers">) =>
	t.run((ctx) =>
		ctx.db
			.query("creditAccounts")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first(),
	);

const invoicesOf = (t: T, retailerId: Id<"retailers">) =>
	t.run((ctx) =>
		ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.collect(),
	);

describe("putting a store on a contract", () => {
	test("flips the plan now, unlocks seats, and makes the included credits the grant — the difference lands this month", async () => {
		const t = setup();
		const s = await activeStore(t);
		const res = await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
		});
		expect(res).toEqual({ created: true });
		const sub = await getSub(t, s.subId);
		expect(sub).toMatchObject({
			plan: "enterprise",
			billingCycle: "monthly",
			userCap: UNLIMITED,
			enterprise: {
				baseFeeMinor: 88800,
				currency: "MYR",
				includedCredits: 1500,
				overageRateMinor: 60,
				blockSize: 5000,
				contactName: "HSL Food GM",
				setBy: ADMIN,
			},
		});
		// One included-credits field: the ledger's grant override.
		expect(await creditAccount(t, s.retailerId)).toMatchObject({
			grantOverride: 1500,
			periodGrant: 1500,
			planBalance: 1500,
		});
		const audit = await t.run((ctx) =>
			ctx.db
				.query("adminAuditLog")
				.withIndex("by_retailer", (q) => q.eq("retailerId", s.retailerId))
				.collect(),
		);
		expect(audit.map((a) => a.action)).toContain("enterprise.setContract");
	});

	test("admins only", async () => {
		const t = setup();
		const s = await activeStore(t);
		await expect(
			t.withIdentity({ subject: OWNER }).mutation(api.enterprise.setContract, {
				retailerId: s.retailerId,
				...HSL,
			}),
		).rejects.toThrow();
	});

	test("refused for a comped store, a founding store, a held store and a bill at another tier", async () => {
		const t = setup();
		const comped = await activeStore(t, {
			userId: "u_ent_comp",
			sub: { comped: true },
		});
		await expect(
			asAdmin(t).mutation(api.enterprise.setContract, {
				retailerId: comped.retailerId,
				...HSL,
			}),
		).rejects.toThrow(/comped/);

		const founding = await activeStore(t, {
			userId: "u_ent_fnd",
			sub: { foundingIntent: true },
		});
		await expect(
			asAdmin(t).mutation(api.enterprise.setContract, {
				retailerId: founding.retailerId,
				...HSL,
			}),
		).rejects.toThrow(/Founding Pro/);

		const held = await activeStore(t, {
			userId: "u_ent_hold",
			sub: { status: "on_hold" },
		});
		await expect(
			asAdmin(t).mutation(api.enterprise.setContract, {
				retailerId: held.retailerId,
				...HSL,
			}),
		).rejects.toThrow(/Off-Season Hold/);

		const billed = await activeStore(t, { userId: "u_ent_bill" });
		await asAdmin(t).mutation(api.invoices.issueInvoice, {
			retailerId: billed.retailerId,
			plan: "pro",
			billingCycle: "monthly",
			founding: false,
		});
		await expect(
			asAdmin(t).mutation(api.enterprise.setContract, {
				retailerId: billed.retailerId,
				...HSL,
			}),
		).rejects.toThrow(/Settle or void INV-/);
	});

	test("says why a contract can't be saved as entered", async () => {
		const t = setup();
		const s = await activeStore(t);
		for (const [bad, message] of [
			[{ baseFeeMinor: 0 }, /never free/],
			[{ includedCredits: 0 }, /Included credits/],
			[{ overageRateMinor: -1 }, /overage rate/],
			[{ blockSize: 0 }, /block/],
			[{ contactName: " " }, /Name the person/],
		] as const) {
			await expect(
				asAdmin(t).mutation(api.enterprise.setContract, {
					retailerId: s.retailerId,
					...HSL,
					...bad,
				}),
			).rejects.toThrow(message);
		}
	});

	test("an SG deal is SGD and stays SGD — the currency is frozen with the contract", async () => {
		const t = setup();
		const s = await activeStore(t, { country: "SG" });
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
			baseFeeMinor: 99900,
		});
		expect((await getSub(t, s.subId))?.enterprise?.currency).toBe("SGD");
		// Even if the store's country later reads MY, an edit keeps SGD.
		await t.run((ctx) => ctx.db.patch(s.retailerId, { country: "MY" }));
		const res = await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
			baseFeeMinor: 109900,
		});
		expect(res).toEqual({ created: false });
		expect((await getSub(t, s.subId))?.enterprise).toMatchObject({
			currency: "SGD",
			baseFeeMinor: 109900,
		});
	});

	test("a contract's credits and the grant lever are one field — changing one changes the other; clearing is refused", async () => {
		const t = setup();
		const s = await activeStore(t);
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
		});
		await asAdmin(t).mutation(api.credits.adminSetGrantOverride, {
			retailerId: s.retailerId,
			grant: 2000,
		});
		expect((await getSub(t, s.subId))?.enterprise?.includedCredits).toBe(2000);
		expect((await creditAccount(t, s.retailerId))?.grantOverride).toBe(2000);
		await expect(
			asAdmin(t).mutation(api.credits.adminSetGrantOverride, {
				retailerId: s.retailerId,
				grant: null,
			}),
		).rejects.toThrow(/Enterprise contract/);
	});
});

describe("putting a store on a contract — the review round (1 Oct)", () => {
	test("a new contract is frozen in the store's billing currency — the same answer the admin form labels the fee with", async () => {
		const t = setup();
		// An SG store that has only ever paid in ringgit.
		const s = await activeStore(t, { country: "SG" });
		await t.run((ctx) =>
			ctx.db.insert("invoices", {
				retailerId: s.retailerId,
				subscriptionId: s.subId,
				invoiceNumber: "INV-HIST-1",
				plan: "pro",
				billingCycle: "monthly",
				amount: 14900,
				total: 14900,
				currency: "MYR",
				periodStart: Date.now() - 20 * DAY,
				periodEnd: Date.now() + 10 * DAY,
				dueDate: Date.now() - 6 * DAY,
				status: "paid",
				markedPaidAt: Date.now() - 20 * DAY,
				createdAt: Date.now() - 20 * DAY,
			}),
		);
		const rows = await asAdmin(t).query(api.admin.listSellersForAdmin, {});
		const row = rows.find((r) => r._id === s.retailerId);
		expect(row?.billingCurrency).toBe("MYR");
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
		});
		expect((await getSub(t, s.subId))?.enterprise?.currency).toBe(
			row?.billingCurrency,
		);
	});

	test("a store is on the house or on a contract, never both", async () => {
		const t = setup();
		const s = await activeStore(t);
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
		});
		await expect(
			asAdmin(t).mutation(api.subscriptions.setComp, {
				retailerId: s.retailerId,
				kind: "partner",
			}),
		).rejects.toThrow(/move it to Pro before comping it/);
		expect((await getSub(t, s.subId))?.comped).not.toBe(true);
	});

	test("the grant lever holds a contract to the contract's own rule, and says who changed it", async () => {
		const t = setup();
		const s = await activeStore(t);
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
		});
		await expect(
			asAdmin(t).mutation(api.credits.adminSetGrantOverride, {
				retailerId: s.retailerId,
				grant: 0,
			}),
		).rejects.toThrow(/at least 1 credit a month/);
		expect((await getSub(t, s.subId))?.enterprise?.includedCredits).toBe(1500);
		vi.setSystemTime(OCT_10 + DAY);
		await asAdmin(t).mutation(api.credits.adminSetGrantOverride, {
			retailerId: s.retailerId,
			grant: 2000,
		});
		expect((await getSub(t, s.subId))?.enterprise).toMatchObject({
			includedCredits: 2000,
			setBy: ADMIN,
			setAt: OCT_10 + DAY,
		});
	});
});

describe("billing a contract", () => {
	test("the renewal bills the contract fee in its currency — a prepaid year is the fee × 10", async () => {
		const t = setup();
		const s = await activeStore(t);
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
			billingCycle: "annual",
		});
		await t.run((ctx) =>
			ctx.db.patch(s.subId, { currentPeriodEnd: Date.now() - DAY }),
		);
		const res = await t.mutation(internal.invoices.internalIssueRenewalInvoice, {
			subscriptionId: s.subId,
		});
		expect(res.issued).toBe(true);
		const pending = (await invoicesOf(t, s.retailerId)).find(
			(i) => i.status === "pending",
		);
		expect(pending).toMatchObject({
			plan: "enterprise",
			billingCycle: "annual",
			total: 888000,
			currency: "MYR",
			origin: "auto_renewal",
		});
		expect(pending?.foundingDiscount).toBeUndefined();
	});

	test("paying an Enterprise invoice keeps the store on its contract", async () => {
		const t = setup();
		const s = await activeStore(t);
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
		});
		const { invoiceId } = await asAdmin(t).mutation(api.invoices.issueInvoice, {
			retailerId: s.retailerId,
			plan: "enterprise",
			billingCycle: "monthly",
			founding: false,
		});
		await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId });
		const sub = await getSub(t, s.subId);
		expect(sub?.plan).toBe("enterprise");
		expect(sub?.enterprise?.includedCredits).toBe(1500);
		expect((await creditAccount(t, s.retailerId))?.grantOverride).toBe(1500);
	});
});

describe("billing a contract — the review round (1 Oct)", () => {
	/**
	 * `setContract` flips the plan before any payment, so a store that came
	 * onto a contract mid-period still has PRO days running. The first contract
	 * bill must value them at Pro's price: carried 1:1 they became contract
	 * days — 25 Pro days worth RM124 turned into 25 days worth RM740.
	 */
	test.each([
		["monthly", 10],
		["annual", 300],
	] as const)(
		"entering mid-period from Pro (%s) values its unused days at Pro's price, and the stamp goes with the first contract bill",
		async (proCycle, daysLeft) => {
			const t = setup();
			const s = await activeStore(t, {
				sub: {
					billingCycle: proCycle,
					currentPeriodEnd: Date.now() + daysLeft * DAY,
				},
			});
			await asAdmin(t).mutation(api.enterprise.setContract, {
				retailerId: s.retailerId,
				...HSL,
			});
			expect((await getSub(t, s.subId))?.enterprise?.enteredFrom).toEqual({
				plan: "pro",
				billingCycle: proCycle,
			});
			const { invoiceId } = await asAdmin(t).mutation(
				api.invoices.issueInvoice,
				{
					retailerId: s.retailerId,
					plan: "enterprise",
					billingCycle: "monthly",
					founding: false,
				},
			);
			const now = Date.now();
			const expected = planChangeCarryoverDays({
				fromPlan: "pro",
				fromCycle: proCycle,
				toPlan: "enterprise",
				toCycle: "monthly",
				founding: false,
				currency: "MYR",
				enterprise: { baseFeeMinor: HSL.baseFeeMinor, currency: "MYR" },
				periodEnd: now + daysLeft * DAY,
				now,
			});
			// 10 monthly Pro days (RM49.67) buy 2 contract days, not 10; 300
			// yearly Pro days (RM1,224.66) buy 41, not 300.
			expect(expected).toBe(proCycle === "monthly" ? 2 : 41);
			await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId });
			const sub = await getSub(t, s.subId);
			expect(sub?.currentPeriodEnd).toBe(now + (30 + expected) * DAY);
			expect(sub?.enterprise?.enteredFrom).toBeUndefined();
			expect(sub?.enterprise?.includedCredits).toBe(1500);
		},
	);

	test("a trialing store on a yearly contract gets a yearly first bill — the contract's, with the plain issued email", async () => {
		const t = setup();
		const s = await activeStore(t, { sub: { status: "trialing" } });
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
			billingCycle: "annual",
		});
		await t.run((ctx) =>
			ctx.db.patch(s.subId, {
				freePeriodEndedAt: Date.now(),
				freePeriodEndReason: "first_order",
			}),
		);
		const res = await t.mutation(internal.invoices.internalIssueFirstInvoice, {
			subscriptionId: s.subId,
		});
		expect(res.issued).toBe(true);
		const [bill] = await invoicesOf(t, s.retailerId);
		expect(bill).toMatchObject({
			plan: "enterprise",
			billingCycle: "annual",
			total: 888000,
			currency: "MYR",
		});
		// Never the "your first invoice is for Pro — switch before you pay"
		// variant: its terms were agreed with us.
		const scheduled = await t.run((ctx) =>
			ctx.db.system.query("_scheduled_functions").collect(),
		);
		const issued = scheduled.find((f) => f.name.includes("notifyInvoiceIssued"));
		expect(issued?.args[0]).not.toHaveProperty("firstInvoice");
	});

	test("the free-period reminder never pitches plans to a contract store", async () => {
		const t = setup();
		const s = await activeStore(t, {
			sub: { status: "trialing", trialEndsAt: Date.now() + 2 * DAY },
		});
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
		});
		const res = await t.mutation(
			internal.subscriptions.internalDailyBillingStatus,
			{},
		);
		expect(res.trialReminders).toBe(0);
		expect((await getSub(t, s.subId))?.trialReminderSentAt).toBeUndefined();
	});

	test("the term can't change while a bill at the other term is open — paying it would put the term back; a fee change can", async () => {
		const t = setup();
		const s = await activeStore(t);
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
		});
		const { invoiceId } = await asAdmin(t).mutation(api.invoices.issueInvoice, {
			retailerId: s.retailerId,
			plan: "enterprise",
			billingCycle: "monthly",
			founding: false,
		});
		const bill = await t.run((ctx) => ctx.db.get(invoiceId));
		await expect(
			asAdmin(t).mutation(api.enterprise.setContract, {
				retailerId: s.retailerId,
				...HSL,
				billingCycle: "annual",
			}),
		).rejects.toThrow(
			`Settle or void ${bill?.invoiceNumber} first — it bills the contract's monthly term`,
		);
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
			baseFeeMinor: 99900,
		});
		expect((await getSub(t, s.subId))?.enterprise?.baseFeeMinor).toBe(99900);
	});
});

describe("the one way off a contract: a move to Pro at renewal", () => {
	test("the renewal bills Pro, and settling it ends the contract and its grant — seats back to Pro's", async () => {
		const t = setup();
		const s = await activeStore(t);
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
		});
		const { effectiveAt } = await asAdmin(t).mutation(
			api.enterprise.scheduleMoveToPro,
			{ retailerId: s.retailerId },
		);
		expect(effectiveAt).toBe((await getSub(t, s.subId))?.currentPeriodEnd);
		// Still on the contract until the period ends.
		expect((await getSub(t, s.subId))?.plan).toBe("enterprise");

		await t.run((ctx) =>
			ctx.db.patch(s.subId, { currentPeriodEnd: Date.now() - DAY }),
		);
		await t.mutation(internal.invoices.internalIssueRenewalInvoice, {
			subscriptionId: s.subId,
		});
		const pending = (await invoicesOf(t, s.retailerId)).find(
			(i) => i.status === "pending",
		);
		expect(pending).toMatchObject({ plan: "pro", total: 14900 });
		if (!pending) throw new Error("no renewal");
		await asAdmin(t).mutation(api.invoices.markPaid, { invoiceId: pending._id });

		const sub = await getSub(t, s.subId);
		expect(sub?.plan).toBe("pro");
		expect(sub?.enterprise).toBeUndefined();
		expect(sub?.pendingPlanChange).toBeUndefined();
		expect(sub?.userCap).toBe(3);
		expect((await creditAccount(t, s.retailerId))?.grantOverride).toBeUndefined();
	});

	test("calling the move off leaves the contract carrying on", async () => {
		const t = setup();
		const s = await activeStore(t);
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
		});
		await asAdmin(t).mutation(api.enterprise.scheduleMoveToPro, {
			retailerId: s.retailerId,
		});
		await asAdmin(t).mutation(api.enterprise.cancelMoveToPro, {
			retailerId: s.retailerId,
		});
		expect((await getSub(t, s.subId))?.pendingPlanChange).toBeUndefined();
	});

	/** The period ends and the renewal cron bills the move. */
	async function billTheMove(t: T, s: { retailerId: Id<"retailers">; subId: Id<"subscriptions"> }) {
		await asAdmin(t).mutation(api.enterprise.scheduleMoveToPro, {
			retailerId: s.retailerId,
		});
		await t.run((ctx) =>
			ctx.db.patch(s.subId, { currentPeriodEnd: Date.now() - DAY }),
		);
		await t.mutation(internal.invoices.internalIssueRenewalInvoice, {
			subscriptionId: s.subId,
		});
		const bill = (await invoicesOf(t, s.retailerId)).find(
			(i) => i.status === "pending",
		);
		if (!bill) throw new Error("no move bill");
		return bill;
	}

	test("the move's Pro bill promises Pro's credits — never the contract's", async () => {
		const t = setup();
		const s = await activeStore(t);
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
		});
		const bill = await billTheMove(t, s);
		// The override still holds the contract's 1,500 until this settles.
		expect((await creditAccount(t, s.retailerId))?.grantOverride).toBe(1500);
		const meta = await t.query(internal.billingEmail.getInvoiceForEmail, {
			invoiceId: bill._id,
		});
		expect(meta?.includedCredits).toBe(200);
	});

	test("voiding the move's bill keeps the move scheduled — calling it off is its own act, and voids the bill", async () => {
		const t = setup();
		const s = await activeStore(t);
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
		});
		const first = await billTheMove(t, s);
		expect((await getSub(t, s.subId))?.pendingPlanChange).toBeUndefined();
		await asAdmin(t).mutation(api.invoices.voidInvoice, { invoiceId: first._id });
		// Re-armed: the next renewal bills Pro again, never the contract.
		expect((await getSub(t, s.subId))?.pendingPlanChange?.plan).toBe("pro");
		await t.mutation(internal.invoices.internalIssueRenewalInvoice, {
			subscriptionId: s.subId,
		});
		const second = (await invoicesOf(t, s.retailerId)).find(
			(i) => i.status === "pending",
		);
		expect(second).toMatchObject({ plan: "pro", total: 14900 });
		if (!second) throw new Error("no second move bill");

		const res = await asAdmin(t).mutation(api.enterprise.cancelMoveToPro, {
			retailerId: s.retailerId,
		});
		expect(res.voidedInvoiceNumber).toBe(second.invoiceNumber);
		expect((await t.run((ctx) => ctx.db.get(second._id)))?.status).toBe("void");
		expect((await getSub(t, s.subId))?.pendingPlanChange).toBeUndefined();
		// The next renewal bills the contract.
		await t.mutation(internal.invoices.internalIssueRenewalInvoice, {
			subscriptionId: s.subId,
		});
		expect(
			(await invoicesOf(t, s.retailerId)).find((i) => i.status === "pending"),
		).toMatchObject({ plan: "enterprise", total: 88800 });
	});

	test("a move can't be scheduled over an open bill, and there's nothing to call off without one", async () => {
		const t = setup();
		const s = await activeStore(t);
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
		});
		await expect(
			asAdmin(t).mutation(api.enterprise.cancelMoveToPro, {
				retailerId: s.retailerId,
			}),
		).rejects.toThrow(/no move to Pro to call off/);
		const { invoiceId } = await asAdmin(t).mutation(api.invoices.issueInvoice, {
			retailerId: s.retailerId,
			plan: "enterprise",
			billingCycle: "monthly",
			founding: false,
		});
		const bill = await t.run((ctx) => ctx.db.get(invoiceId));
		await expect(
			asAdmin(t).mutation(api.enterprise.scheduleMoveToPro, {
				retailerId: s.retailerId,
			}),
		).rejects.toThrow(`Settle or void ${bill?.invoiceNumber} first`);
		expect((await getSub(t, s.subId))?.pendingPlanChange).toBeUndefined();
	});

	test("a move to Pro is only for a store on a contract", async () => {
		const t = setup();
		const s = await activeStore(t);
		await expect(
			asAdmin(t).mutation(api.enterprise.scheduleMoveToPro, {
				retailerId: s.retailerId,
			}),
		).rejects.toThrow(/isn't on an Enterprise contract/);
	});
});

describe("overage blocks", () => {
	test("an admin lands a block as bought credits under its own ledger reason — contract stores only", async () => {
		const t = setup();
		const pro = await activeStore(t, { userId: "u_ent_blk_pro" });
		await expect(
			asAdmin(t).mutation(api.credits.adminAdjust, {
				retailerId: pro.retailerId,
				bucket: "purchased",
				amount: 5000,
				note: "Block 1",
				enterpriseBlock: true,
			}),
		).rejects.toThrow(/Only a store on an Enterprise contract/);

		const s = await activeStore(t);
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
		});
		await expect(
			asAdmin(t).mutation(api.credits.adminAdjust, {
				retailerId: s.retailerId,
				bucket: "purchased",
				amount: -100,
				note: "Oops",
				enterpriseBlock: true,
			}),
		).rejects.toThrow(/positive number/);
		await asAdmin(t).mutation(api.credits.adminAdjust, {
			retailerId: s.retailerId,
			bucket: "purchased",
			amount: 5000,
			note: "Block 1 — INV-HSL-OCT paid",
			enterpriseBlock: true,
		});
		const rows = await t.run((ctx) =>
			ctx.db
				.query("creditLedger")
				.withIndex("by_retailer_created", (q) => q.eq("retailerId", s.retailerId))
				.collect(),
		);
		expect(rows.at(-1)).toMatchObject({
			type: "adjust",
			bucket: "purchased",
			amount: 5000,
			reason: "enterprise_block",
		});
		expect((await creditAccount(t, s.retailerId))?.purchasedBalance).toBe(5000);
	});
});

describe("no self-serve door on a contract", () => {
	// Subscribe, switch and cancel-a-change are pinned beside the other
	// self-serve refusals in subscriptionPayments.test.ts.
	test("a plan change or an Off-Season Hold answers with the one sentence", async () => {
		const t = setup();
		const s = await activeStore(t);
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
		});
		const owner = t.withIdentity({ subject: OWNER });
		const refusal = /Enterprise contract, so plan changes go through Kedaipal/;
		await expect(
			owner.mutation(api.invoices.changePlan, { plan: "pro" }),
		).rejects.toThrow(refusal);
		await expect(
			owner.mutation(api.invoices.changePlan, { plan: "starter" }),
		).rejects.toThrow(refusal);
		// Off-Season Hold bills Kedaipal's LIST hold price, which a contract
		// never agreed to — a contract pauses by agreement.
		await expect(
			owner.mutation(api.subscriptions.setSeasonalHold, {
				retailerId: s.retailerId,
				hold: true,
			}),
		).rejects.toThrow(refusal);
		const sub = await getSub(t, s.subId);
		expect(sub?.plan).toBe("enterprise");
		expect(sub?.status).toBe("active");
		expect(sub?.pendingPlanChange).toBeUndefined();
		expect(await invoicesOf(t, s.retailerId)).toHaveLength(0);
	});

	test("never nudged to move up — there is no plan above a contract — but told its block rate", async () => {
		const t = setup();
		const s = await activeStore(t);
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
		});
		const options = await t
			.withIdentity({ subject: OWNER })
			.query(api.creditPurchases.topUpOptions, {});
		expect(options?.upgradeHint ?? null).toBeNull();
		// The cheaper route it DOES have: its own block, at the contract rate,
		// named where credits are bought.
		expect(options?.contractBlock).toEqual({
			credits: 5000,
			ratePerCreditMinor: 60,
			priceMinor: 300000,
			currency: "MYR",
		});
	});

	test("a store off its contract is quoted no block", async () => {
		const t = setup();
		await activeStore(t);
		const options = await t
			.withIdentity({ subject: OWNER })
			.query(api.creditPurchases.topUpOptions, {});
		expect(options?.contractBlock).toBeNull();
	});
});

describe("what the seller sees", () => {
	test("the terms that concern them — never the contact, the notes or who set it", async () => {
		const t = setup();
		const s = await activeStore(t);
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
			notes: "Signed 6 Oct, GM only",
		});
		const me = await t
			.withIdentity({ subject: OWNER })
			.query(api.retailers.getMyRetailer, {});
		expect(me?.subscription?.plan).toBe("enterprise");
		expect(me?.subscription?.enterprise).toEqual({
			baseFeeMinor: 88800,
			currency: "MYR",
			includedCredits: 1500,
			overageRateMinor: 60,
			blockSize: 5000,
		});
		const json = JSON.stringify(me?.subscription);
		expect(json).not.toMatch(/HSL Food GM|Signed 6 Oct|user_ent_admin/);
	});
});

describe("the contract's own allowances (seats + broadcasts)", () => {
	it("omitted = the tier's defaults, and the row carries them", async () => {
		const t = setup();
		const s = await activeStore(t);
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
		});
		const sub = await getSub(t, s.subId);
		// Unlimited seats is what Enterprise has always meant; a contract that
		// says nothing doesn't quietly take it away.
		expect(isUnlimited(sub?.userCap ?? 0)).toBe(true);
		expect(sub?.broadcastQuota).toBe(PLAN_CAPS.enterprise.broadcastQuota);
		expect(sub?.enterprise?.teammates).toBeUndefined();
		expect(sub?.enterprise?.broadcastQuota).toBeUndefined();
	});

	it("a negotiated number overrides the tier, owner included in the cap", async () => {
		const t = setup();
		const s = await activeStore(t);
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
			teammates: 12,
			broadcastQuota: 500,
		});
		const sub = await getSub(t, s.subId);
		// `userCap` is TOTAL people; the contract names teammates, so the owner
		// is added back exactly once.
		expect(sub?.userCap).toBe(13);
		expect(sub?.broadcastQuota).toBe(500);
		expect(sub?.enterprise?.teammates).toBe(12);
	});

	it("EDITING a live contract moves the caps too — not just entering it", async () => {
		// The bug this pins: caps used to be written only on the way in, so an
		// admin raising a contract's seat count changed a number the form
		// showed and nothing enforced.
		const t = setup();
		const s = await activeStore(t);
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
			teammates: 2,
		});
		expect((await getSub(t, s.subId))?.userCap).toBe(3);
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
			teammates: 20,
		});
		expect((await getSub(t, s.subId))?.userCap).toBe(21);
		// And clearing the number hands the tier default back.
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
		});
		expect(isUnlimited((await getSub(t, s.subId))?.userCap ?? 0)).toBe(true);
	});

	it("refuses a seat count below the people already in the store", async () => {
		const t = setup();
		const s = await activeStore(t);
		// Two people working today: one accepted, one invited (an invite holds
		// a seat — promising a seat and then taking it back is the same harm).
		await t.run(async (ctx) => {
			for (const [email, status] of [
				["a@example.com", "active"],
				["b@example.com", "invited"],
			] as const)
				await ctx.db.insert("retailerMembers", {
					retailerId: s.retailerId,
					email,
					status,
					permissions: {},
					invitedAt: Date.now(),
					invitedBy: OWNER,
				});
		});
		await expect(
			asAdmin(t).mutation(api.enterprise.setContract, {
				retailerId: s.retailerId,
				...HSL,
				teammates: 1,
			}),
		).rejects.toThrow(/already has 2 teammates/);
		// At the count in use it saves — the refusal is a floor, not a ban.
		await asAdmin(t).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			...HSL,
			teammates: 2,
		});
		expect((await getSub(t, s.subId))?.userCap).toBe(3);
	});

	it("refuses a slipped zero", async () => {
		const t = setup();
		const s = await activeStore(t);
		await expect(
			asAdmin(t).mutation(api.enterprise.setContract, {
				retailerId: s.retailerId,
				...HSL,
				teammates: 5000,
			}),
		).rejects.toThrow(/whole number from 0 to 500/);
		await expect(
			asAdmin(t).mutation(api.enterprise.setContract, {
				retailerId: s.retailerId,
				...HSL,
				broadcastQuota: 2_000_000,
			}),
		).rejects.toThrow(/whole number from 0 to/);
	});
});
