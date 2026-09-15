/// <reference types="vite/client" />
// Comp accounts (z8r3fdeub2): admin-granted free access for partners /
// sponsors / pilots / internal stores. setComp stamps `comped` + the `comp`
// object and the whole billing machine treats the store as never-charged;
// clearComp (and the daily cron, past `comp.expiresAt`) drops it into the
// same fresh 14-day Pro trial a new signup gets. See docs/manual-subscription.md.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { resolveAccess } from "./subscriptions";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const ADMIN = "user_comp_admin";
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

/** A seller with the subscription row `createRetailer` minted (trialing Pro). */
async function seedSeller(
	t: ReturnType<typeof setup>,
	userId: string,
	overrides: Partial<Doc<"subscriptions">> = {},
) {
	const asUser = t.withIdentity({ subject: userId });
	const slug = `comp-${userId.replace(/[^a-z0-9]/g, "")}`;
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: `Store ${slug}`,
		slug,
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
		if (Object.keys(overrides).length > 0) {
			await ctx.db.patch(sub._id, overrides);
		}
		return { retailerId: r._id, subId: sub._id, slug };
	});
	return { ...ids, userId };
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
const auditFor = (t: ReturnType<typeof setup>, retailerId: Id<"retailers">) =>
	t.run((ctx) =>
		ctx.db
			.query("adminAuditLog")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.collect(),
	);
const cron = (t: ReturnType<typeof setup>) =>
	t.mutation(internal.subscriptions.internalDailyBillingStatus, {});
const asAdmin = (t: ReturnType<typeof setup>) =>
	t.withIdentity({ subject: ADMIN });

describe("setComp", () => {
	test("grants: comped + stamp, active Pro, trial stamps cleared, audit row written", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_grant", {
			trialReminderSentAt: 123,
		});
		const expiresAt = Date.now() + 30 * DAY;
		await asAdmin(t).mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "sponsor",
			label: "Sponsored by Maybank SME",
			note: "Q4 SME programme",
			expiresAt,
		});
		const sub = await getSub(t, s.subId);
		expect(sub?.comped).toBe(true);
		expect(sub?.comp).toMatchObject({
			kind: "sponsor",
			label: "Sponsored by Maybank SME",
			note: "Q4 SME programme",
			grantedBy: ADMIN,
			expiresAt,
		});
		expect(sub?.status).toBe("active");
		expect(sub?.plan).toBe("pro");
		expect(sub?.orderCap).toBe(200);
		expect(sub?.trialEndsAt).toBeUndefined();
		expect(sub?.trialReminderSentAt).toBeUndefined();
		expect(sub?.freePeriodEndedAt).toBeUndefined();
		expect(sub?.freePeriodEndReason).toBeUndefined();
		const audit = await auditFor(t, s.retailerId);
		expect(audit).toHaveLength(1);
		expect(audit[0]).toMatchObject({
			adminUserId: ADMIN,
			action: "subscriptions.setComp",
			targetId: s.retailerId,
		});
	});

	test("non-admins (owner included) are refused; validation: past expiry + oversized label/note", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_refuse");
		await expect(
			t
				.withIdentity({ subject: s.userId })
				.mutation(api.subscriptions.setComp, {
					retailerId: s.retailerId,
					kind: "pilot",
				}),
		).rejects.toThrow(/not authorized/i);
		await expect(
			asAdmin(t).mutation(api.subscriptions.setComp, {
				retailerId: s.retailerId,
				kind: "pilot",
				expiresAt: Date.now() - 1,
			}),
		).rejects.toThrow(/end date must be in the future/i);
		await expect(
			asAdmin(t).mutation(api.subscriptions.setComp, {
				retailerId: s.retailerId,
				kind: "pilot",
				label: "x".repeat(61),
			}),
		).rejects.toThrow(/label under 60/i);
		await expect(
			asAdmin(t).mutation(api.subscriptions.setComp, {
				retailerId: s.retailerId,
				kind: "pilot",
				note: "x".repeat(501),
			}),
		).rejects.toThrow(/note under 500/i);
		expect((await getSub(t, s.subId))?.comped).not.toBe(true);
	});

	test("an admin's own store is refused — it already runs free via the allowlist", async () => {
		const t = setup();
		const s = await seedSeller(t, ADMIN);
		await expect(
			asAdmin(t).mutation(api.subscriptions.setComp, {
				retailerId: s.retailerId,
				kind: "internal",
			}),
		).rejects.toThrow(/admin store/i);
	});

	test("past_due with an overdue pending invoice: the invoice is voided and the lock lifts in the same beat", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_pastdue", { status: "past_due" });
		await t.run(async (ctx) => {
			await ctx.db.insert("invoices", {
				retailerId: s.retailerId,
				subscriptionId: s.subId,
				invoiceNumber: "INV-TEST-0001",
				plan: "pro",
				billingCycle: "monthly",
				amount: 14900,
				total: 14900,
				currency: "MYR",
				periodStart: Date.now() - 15 * DAY,
				periodEnd: Date.now() + 15 * DAY,
				status: "pending",
				dueDate: Date.now() - DAY,
				createdAt: Date.now() - 15 * DAY,
			});
		});
		await asAdmin(t).mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "partner",
		});
		const sub = await getSub(t, s.subId);
		expect(sub?.status).toBe("active");
		expect(sub?.comped).toBe(true);
		const invoices = await invoicesFor(t, s.retailerId);
		expect(invoices).toHaveLength(1);
		expect(invoices[0].status).toBe("void");
		expect(invoices[0].voidReason).toMatch(/on the house/i);
		// The seller-facing descriptor agrees: not frozen, full access.
		const access = resolveAccess((await getSub(t, s.subId)) ?? null);
		expect(access.frozen).toBe(false);
		expect(access.active).toBe(true);
	});

	test("on_hold: the hold is released — ordering reopens, heldAt cleared", async () => {
		const t = setup();
		const heldAt = Date.now() - 5 * DAY;
		const s = await seedSeller(t, "u_hold", { status: "on_hold", heldAt });
		await t.run((ctx) =>
			ctx.db.patch(s.retailerId, { orderingPausedAt: heldAt }),
		);
		await asAdmin(t).mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "partner",
		});
		expect((await getSub(t, s.subId))?.status).toBe("active");
		expect((await getSub(t, s.subId))?.heldAt).toBeUndefined();
		expect((await getRetailer(t, s.retailerId))?.orderingPausedAt).toBeUndefined();
	});

	test("a previously PAID store loses its period fields — the billing tab must never say 'expires' under a sponsor line", async () => {
		const t = setup();
		const now = Date.now();
		const s = await seedSeller(t, "u_paid", {
			status: "active",
			currentPeriodStart: now - 10 * DAY,
			currentPeriodEnd: now + 20 * DAY,
			periodPaidBy: "plan",
			pendingPlanChange: { plan: "starter", requestedAt: now - DAY },
		});
		await asAdmin(t).mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "sponsor",
		});
		const sub = await getSub(t, s.subId);
		expect(sub?.currentPeriodStart).toBeUndefined();
		expect(sub?.currentPeriodEnd).toBeUndefined();
		expect(sub?.periodPaidBy).toBeUndefined();
		expect(sub?.pendingPlanChange).toBeUndefined();
	});

	test("re-granting EDITS the comp in place (extend expiry) — no trial in between", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_edit");
		const admin = asAdmin(t);
		await admin.mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "pilot",
			expiresAt: Date.now() + 10 * DAY,
		});
		const extended = Date.now() + 60 * DAY;
		await admin.mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "sponsor",
			label: "Sponsored by Bearcamp",
			expiresAt: extended,
		});
		const sub = await getSub(t, s.subId);
		expect(sub?.comped).toBe(true);
		expect(sub?.status).toBe("active");
		expect(sub?.comp).toMatchObject({
			kind: "sponsor",
			label: "Sponsored by Bearcamp",
			expiresAt: extended,
		});
		expect(await auditFor(t, s.retailerId)).toHaveLength(2);
	});

	test("a store with NO subscription row gets a comped row minted", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_norow");
		await t.run((ctx) => ctx.db.delete(s.subId));
		await asAdmin(t).mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "internal",
		});
		const sub = await t.run((ctx) =>
			ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", s.retailerId))
				.first(),
		);
		expect(sub?.comped).toBe(true);
		expect(sub?.status).toBe("active");
		expect(sub?.plan).toBe("pro");
		expect(sub?.comp?.kind).toBe("internal");
	});
});

describe("clearComp", () => {
	test("drops the store into a fresh 14-day Pro trial, exactly like a new signup", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_clear");
		const admin = asAdmin(t);
		await admin.mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "sponsor",
			label: "Sponsored by X",
		});
		const now = Date.now();
		await admin.mutation(api.subscriptions.clearComp, {
			retailerId: s.retailerId,
		});
		const sub = await getSub(t, s.subId);
		expect(sub?.comped).toBe(false);
		expect(sub?.comp).toBeUndefined();
		expect(sub?.status).toBe("trialing");
		expect(sub?.plan).toBe("pro");
		expect(sub?.trialEndsAt).toBeGreaterThanOrEqual(now + 14 * DAY - 1000);
		expect(sub?.freePeriodEndedAt).toBeUndefined();
		expect(sub?.trialReminderSentAt).toBeUndefined();
		const audit = await auditFor(t, s.retailerId);
		expect(audit.map((a) => a.action)).toContain("subscriptions.clearComp");
	});

	test("refuses a store that isn't comped; non-admin refused", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_notcomped");
		await expect(
			asAdmin(t).mutation(api.subscriptions.clearComp, {
				retailerId: s.retailerId,
			}),
		).rejects.toThrow(/isn't comped/i);
		await expect(
			t
				.withIdentity({ subject: s.userId })
				.mutation(api.subscriptions.clearComp, { retailerId: s.retailerId }),
		).rejects.toThrow(/not authorized/i);
	});
});

describe("daily cron", () => {
	test("expiry: a dated comp past its end converts to a fresh trial; life comps and future dates don't", async () => {
		const t = setup();
		const admin = asAdmin(t);
		const expired = await seedSeller(t, "u_expired");
		const life = await seedSeller(t, "u_life");
		const future = await seedSeller(t, "u_future");
		await admin.mutation(api.subscriptions.setComp, {
			retailerId: expired.retailerId,
			kind: "sponsor",
			label: "Sponsored by Y",
			expiresAt: Date.now() + DAY,
		});
		await admin.mutation(api.subscriptions.setComp, {
			retailerId: life.retailerId,
			kind: "partner",
		});
		await admin.mutation(api.subscriptions.setComp, {
			retailerId: future.retailerId,
			kind: "pilot",
			expiresAt: Date.now() + 30 * DAY,
		});
		vi.setSystemTime(Date.now() + 2 * DAY);
		const res = await cron(t);
		expect(res.compsExpired).toBe(1);
		const expiredSub = await getSub(t, expired.subId);
		expect(expiredSub?.comped).toBe(false);
		expect(expiredSub?.comp).toBeUndefined();
		expect(expiredSub?.status).toBe("trialing");
		expect(expiredSub?.trialEndsAt).toBeGreaterThan(Date.now());
		expect((await getSub(t, life.subId))?.comped).toBe(true);
		expect((await getSub(t, future.subId))?.comped).toBe(true);
		// Idempotent: the converted row is a plain trial now, nothing to expire.
		expect((await cron(t)).compsExpired).toBe(0);
	});

	test("a comped active row is never billed or locked — stale period end and stale overdue invoice included", async () => {
		const t = setup();
		const now = Date.now();
		// Simulate pre-comp leftovers a migration or manual edit could produce:
		// a lapsed period AND an overdue pending invoice on a comped row.
		const s = await seedSeller(t, "u_neverbilled", {
			status: "active",
			comped: true,
			currentPeriodEnd: now - DAY,
		});
		await t.run(async (ctx) => {
			await ctx.db.insert("invoices", {
				retailerId: s.retailerId,
				subscriptionId: s.subId,
				invoiceNumber: "INV-TEST-0002",
				plan: "pro",
				billingCycle: "monthly",
				amount: 14900,
				total: 14900,
				currency: "MYR",
				periodStart: now - 15 * DAY,
				periodEnd: now + 15 * DAY,
				status: "pending",
				dueDate: now - DAY,
				createdAt: now - 15 * DAY,
			});
		});
		const res = await cron(t);
		expect(res.renewalsIssued).toBe(0);
		expect(res.overdue).toBe(0);
		expect((await getSub(t, s.subId))?.status).toBe("active");
	});

	test("expiry keeps a saved auto-renew method attached but schedules NO charge", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_autorenew");
		await asAdmin(t).mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "sponsor",
			expiresAt: Date.now() + DAY,
		});
		await t.run((ctx) =>
			ctx.db.patch(s.subId, {
				autoRenew: {
					provider: "hitpay" as const,
					method: "card",
					attachedAt: Date.now(),
				},
			}),
		);
		vi.setSystemTime(Date.now() + 2 * DAY);
		const res = await cron(t);
		expect(res.compsExpired).toBe(1);
		expect(res.autoChargeRetries).toBe(0);
		expect(res.renewalsIssued).toBe(0);
		const sub = await getSub(t, s.subId);
		expect(sub?.status).toBe("trialing");
		// The method stays for the day a real invoice exists again.
		expect(sub?.autoRenew?.method).toBe("card");
		expect(await invoicesFor(t, s.retailerId)).toHaveLength(0);
	});
});

describe("backfill", () => {
	test("heals a LEGACY comped row (no stamp) into a trial; a stamped comp survives a re-run", async () => {
		const t = setup();
		const legacy = await seedSeller(t, "u_legacy", {
			status: "active",
			comped: true,
		});
		const stamped = await seedSeller(t, "u_stamped");
		await asAdmin(t).mutation(api.subscriptions.setComp, {
			retailerId: stamped.retailerId,
			kind: "sponsor",
			label: "Sponsored by Z",
		});
		const res = await t.mutation(
			internal.subscriptions.internalBackfillSubscriptions,
			{},
		);
		expect(res.converted).toBe(1);
		const legacySub = await getSub(t, legacy.subId);
		expect(legacySub?.comped).toBe(false);
		expect(legacySub?.status).toBe("trialing");
		const stampedSub = await getSub(t, stamped.subId);
		expect(stampedSub?.comped).toBe(true);
		expect(stampedSub?.status).toBe("active");
		expect(stampedSub?.comp?.label).toBe("Sponsored by Z");
	});
});

describe("the rest of the billing machine", () => {
	test("issueInvoice refuses a comped store — 'never charged' covers the manual path too", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_manualbill");
		const admin = asAdmin(t);
		await admin.mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "partner",
		});
		await expect(
			admin.mutation(api.invoices.issueInvoice, {
				retailerId: s.retailerId,
				plan: "pro",
				billingCycle: "monthly",
				founding: false,
			}),
		).rejects.toThrow(/on the house/i);
	});

	test("resolveAccess ships the seller-facing comp slice ONLY — note and grantedBy never leave the server", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_slice");
		await asAdmin(t).mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "sponsor",
			label: "Sponsored by Maybank SME",
			note: "internal deal terms",
			expiresAt: Date.now() + 30 * DAY,
		});
		const sub = await getSub(t, s.subId);
		const access = resolveAccess(sub ?? null);
		expect(access.comped).toBe(true);
		expect(access.comp).toEqual({
			kind: "sponsor",
			label: "Sponsored by Maybank SME",
			expiresAt: sub?.comp?.expiresAt,
		});
		// The owner payload the billing tab renders carries the same slice.
		const me = await t
			.withIdentity({ subject: s.userId })
			.query(api.retailers.getMyRetailer, {});
		expect(me?.subscription?.comp?.label).toBe("Sponsored by Maybank SME");
		expect(
			me?.subscription?.comp && "note" in me.subscription.comp
				? me.subscription.comp.note
				: undefined,
		).toBeUndefined();
	});
});
