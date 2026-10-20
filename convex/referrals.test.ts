/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { settleScheduled } from "./lib/convexTestSettle";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ADMIN = "user_referral_admin";
const REFERRER = "user_referrer";
const REFEREE = "user_referee";
const OTHER = "user_other";

let prevAdminEnv: string | undefined;
beforeAll(() => {
	prevAdminEnv = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
});
afterAll(() => {
	process.env.ADMIN_USER_IDS = prevAdminEnv;
});

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}
type T = ReturnType<typeof setup>;

async function createStore(
	t: T,
	userId: string,
	slug: string,
	extra: { referralSlug?: string; signupSource?: string } = {},
): Promise<Id<"retailers">> {
	await t.withIdentity({ subject: userId }).mutation(api.retailers.createRetailer, {
		storeName: `Store ${slug}`,
		slug,
		...extra,
	});
	return await t.run(async (ctx) => {
		const r = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();
		if (!r) throw new Error("store not created");
		return r._id;
	});
}

/** Put a store's subscription into a state — createRetailer starts a trial. */
async function setSub(
	t: T,
	retailerId: Id<"retailers">,
	patch: Partial<Doc<"subscriptions">>,
): Promise<void> {
	await t.run(async (ctx) => {
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		if (!sub) throw new Error("no sub");
		await ctx.db.patch(sub._id, patch);
	});
}

async function referralOf(
	t: T,
	refereeId: Id<"retailers">,
): Promise<Doc<"referrals"> | null> {
	return await t.run((ctx) =>
		ctx.db
			.query("referrals")
			.withIndex("by_referee", (q) => q.eq("refereeId", refereeId))
			.first(),
	);
}

async function retailer(t: T, id: Id<"retailers">) {
	return await t.run((ctx) => ctx.db.get(id));
}

async function insertPaidInvoice(t: T, retailerId: Id<"retailers">) {
	await t.run(async (ctx) => {
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		if (!sub) throw new Error("no sub");
		const now = Date.now();
		await ctx.db.insert("invoices", {
			retailerId,
			subscriptionId: sub._id,
			invoiceNumber: "INV-REF-1",
			plan: "pro",
			billingCycle: "monthly",
			amount: 14900,
			total: 14900,
			currency: "MYR",
			periodStart: now,
			periodEnd: now + 30 * 86_400_000,
			dueDate: now,
			status: "paid",
			markedPaidAt: now,
			createdAt: now,
		});
	});
}

describe("referral recorded at signup", () => {
	test("a link from an ACTIVE store records the referral and attributes the signup", async () => {
		const t = setup();
		const referrerId = await createStore(t, REFERRER, "siti-kitchen");
		await setSub(t, referrerId, { status: "active" });

		const refereeId = await createStore(t, REFEREE, "new-kedai", {
			referralSlug: "siti-kitchen",
		});

		const row = await referralOf(t, refereeId);
		expect(row).toMatchObject({
			referrerId,
			via: "link",
			recordedBy: "system",
		});
		const r = await retailer(t, refereeId);
		expect(r?.signupReferrerId).toBe(referrerId);
		// No session tag (a referee who came back days later by typing the
		// address) — the referral lends its own tag.
		expect(r?.signupSource).toBe("referral-siti-kitchen");
	});

	test("a session tag is kept as the last touch; the referral still records", async () => {
		const t = setup();
		const referrerId = await createStore(t, REFERRER, "siti-kitchen");
		await setSub(t, referrerId, { status: "active" });

		const refereeId = await createStore(t, REFEREE, "new-kedai", {
			referralSlug: "siti-kitchen",
			signupSource: "spotlight-thg",
		});

		expect((await retailer(t, refereeId))?.signupSource).toBe("spotlight-thg");
		expect((await referralOf(t, refereeId))?.referrerId).toBe(referrerId);
	});

	test("a comped partner's link counts (their referee is rewarded)", async () => {
		const t = setup();
		const referrerId = await createStore(t, REFERRER, "huff-puff");
		await setSub(t, referrerId, { comped: true });

		const refereeId = await createStore(t, REFEREE, "new-kedai", {
			referralSlug: "huff-puff",
		});
		expect((await referralOf(t, refereeId))?.referrerId).toBe(referrerId);
	});

	test.each([
		["trialing", { status: "trialing" as const }],
		["on hold", { status: "on_hold" as const }],
		["past due", { status: "past_due" as const }],
		["cancelled", { status: "cancelled" as const }],
	])("a link from a store that is %s records nothing — no public coupon", async (_label, patch) => {
		const t = setup();
		const referrerId = await createStore(t, REFERRER, "siti-kitchen");
		await setSub(t, referrerId, patch);

		const refereeId = await createStore(t, REFEREE, "new-kedai", {
			referralSlug: "siti-kitchen",
		});
		expect(await referralOf(t, refereeId)).toBeNull();
		expect((await retailer(t, refereeId))?.signupReferrerId).toBeUndefined();
	});

	test("a link naming no store records nothing", async () => {
		const t = setup();
		const refereeId = await createStore(t, REFEREE, "new-kedai", {
			referralSlug: "no-such-store",
		});
		expect(await referralOf(t, refereeId)).toBeNull();
	});

	test("a link shared before the referrer renamed still resolves while the old slug is parked", async () => {
		const t = setup();
		const referrerId = await createStore(t, REFERRER, "old-name");
		await setSub(t, referrerId, { status: "active" });
		await t.run(async (ctx) => {
			await ctx.db.patch(referrerId, { slug: "new-name" });
			await ctx.db.insert("slugHistory", {
				oldSlug: "old-name",
				retailerId: referrerId,
				expiresAt: Date.now() + 86_400_000,
			});
		});

		const refereeId = await createStore(t, REFEREE, "new-kedai", {
			referralSlug: "old-name",
		});
		expect((await referralOf(t, refereeId))?.referrerId).toBe(referrerId);
	});

	test("the referral link outranks a badge referrer as the attribution", async () => {
		const t = setup();
		const referrerId = await createStore(t, REFERRER, "siti-kitchen");
		await setSub(t, referrerId, { status: "active" });
		await createStore(t, OTHER, "badge-store");

		await t.withIdentity({ subject: REFEREE }).mutation(api.retailers.createRetailer, {
			storeName: "New kedai",
			slug: "new-kedai",
			signupSource: "powered-by",
			signupReferrerSlug: "badge-store",
			referralSlug: "siti-kitchen",
		});
		const refereeId = await t.run(async (ctx) => {
			const r = await ctx.db
				.query("retailers")
				.withIndex("by_slug", (q) => q.eq("slug", "new-kedai"))
				.first();
			if (!r) throw new Error("missing");
			return r._id;
		});
		const r = await retailer(t, refereeId);
		expect(r?.signupReferrerId).toBe(referrerId);
		// The session's own tag is still the last touch.
		expect(r?.signupSource).toBe("powered-by");
	});
});

describe("referrals.invite (public)", () => {
	test("names an active referrer and quotes the referee offer", async () => {
		const t = setup();
		const referrerId = await createStore(t, REFERRER, "siti-kitchen");
		await setSub(t, referrerId, { status: "active" });

		const invite = await t.query(api.referrals.invite, { slug: "Siti-Kitchen" });
		expect(invite).toEqual({
			slug: "siti-kitchen",
			storeName: "Store siti-kitchen",
			offer: { starter: 30, pro: 60 },
		});
	});

	test("is null for a store that can't refer — and never says why", async () => {
		const t = setup();
		await createStore(t, REFERRER, "siti-kitchen"); // still on trial
		expect(await t.query(api.referrals.invite, { slug: "siti-kitchen" })).toBeNull();
	});

	test("is null for an unknown or malformed slug", async () => {
		const t = setup();
		expect(await t.query(api.referrals.invite, { slug: "nobody" })).toBeNull();
		expect(
			await t.query(api.referrals.invite, { slug: "<script>" }),
		).toBeNull();
	});
});

describe("referrals.mine (the referee's own view)", () => {
	test("tells the referee who referred them and what they get", async () => {
		const t = setup();
		const referrerId = await createStore(t, REFERRER, "siti-kitchen");
		await setSub(t, referrerId, { status: "active" });
		await createStore(t, REFEREE, "new-kedai", { referralSlug: "siti-kitchen" });

		const mine = await t
			.withIdentity({ subject: REFEREE })
			.query(api.referrals.mine, {});
		expect(mine).toEqual({
			referrerName: "Store siti-kitchen",
			offer: { starter: 30, pro: 60 },
			firstInvoicePaid: false,
			reward: null,
		});
	});

	test("survives the referrer's deletion with a null name", async () => {
		const t = setup();
		const referrerId = await createStore(t, REFERRER, "siti-kitchen");
		await setSub(t, referrerId, { status: "active" });
		await createStore(t, REFEREE, "new-kedai", { referralSlug: "siti-kitchen" });
		await t.run((ctx) => ctx.db.delete(referrerId));

		const mine = await t
			.withIdentity({ subject: REFEREE })
			.query(api.referrals.mine, {});
		expect(mine?.referrerName).toBeNull();
	});

	test("is null for a store nobody referred, and when signed out", async () => {
		const t = setup();
		await createStore(t, REFEREE, "new-kedai");
		expect(
			await t.withIdentity({ subject: REFEREE }).query(api.referrals.mine, {}),
		).toBeNull();
		expect(await t.query(api.referrals.mine, {})).toBeNull();
	});
});

describe("admin fix-up", () => {
	test("sets a referral the link didn't capture, audited", async () => {
		const t = setup();
		const referrerId = await createStore(t, REFERRER, "siti-kitchen");
		await setSub(t, referrerId, { status: "active" });
		const refereeId = await createStore(t, REFEREE, "new-kedai");

		await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.referrals.adminSetReferrer, {
				refereeId,
				referrerSlug: "siti-kitchen",
			});

		expect(await referralOf(t, refereeId)).toMatchObject({
			referrerId,
			via: "admin",
			recordedBy: ADMIN,
		});
		const audit = await t.run((ctx) =>
			ctx.db
				.query("adminAuditLog")
				.withIndex("by_retailer", (q) => q.eq("retailerId", refereeId))
				.collect(),
		);
		expect(audit.map((a) => a.action)).toContain(
			"referrals.adminSetReferrer",
		);
	});

	test("changes an existing referral to another referrer", async () => {
		const t = setup();
		const first = await createStore(t, REFERRER, "siti-kitchen");
		await setSub(t, first, { status: "active" });
		const second = await createStore(t, OTHER, "kak-yah");
		await setSub(t, second, { status: "active" });
		const refereeId = await createStore(t, REFEREE, "new-kedai", {
			referralSlug: "siti-kitchen",
		});

		await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.referrals.adminSetReferrer, {
				refereeId,
				referrerSlug: "kak-yah",
			});
		const rows = await t.run((ctx) =>
			ctx.db
				.query("referrals")
				.withIndex("by_referee", (q) => q.eq("refereeId", refereeId))
				.collect(),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ referrerId: second, via: "admin" });
	});

	test("refuses a referrer that can't refer, naming why", async () => {
		const t = setup();
		await createStore(t, REFERRER, "siti-kitchen"); // trial
		const refereeId = await createStore(t, REFEREE, "new-kedai");

		await expect(
			t
				.withIdentity({ subject: ADMIN })
				.mutation(api.referrals.adminSetReferrer, {
					refereeId,
					referrerSlug: "siti-kitchen",
				}),
		).rejects.toThrow(/free trial/);
		expect(await referralOf(t, refereeId)).toBeNull();
	});

	test("refuses a store referring itself", async () => {
		const t = setup();
		const refereeId = await createStore(t, REFEREE, "new-kedai");
		await setSub(t, refereeId, { status: "active" });
		await expect(
			t
				.withIdentity({ subject: ADMIN })
				.mutation(api.referrals.adminSetReferrer, {
					refereeId,
					referrerSlug: "new-kedai",
				}),
		).rejects.toThrow(/can't refer itself/);
	});

	test("refuses once the referee has paid its first plan invoice", async () => {
		const t = setup();
		const referrerId = await createStore(t, REFERRER, "siti-kitchen");
		await setSub(t, referrerId, { status: "active" });
		const refereeId = await createStore(t, REFEREE, "new-kedai", {
			referralSlug: "siti-kitchen",
		});
		await insertPaidInvoice(t, refereeId);

		const asAdmin = t.withIdentity({ subject: ADMIN });
		await expect(
			asAdmin.mutation(api.referrals.adminClearReferral, { refereeId }),
		).rejects.toThrow(/already paid its first invoice/);
		await expect(
			asAdmin.mutation(api.referrals.adminSetReferrer, {
				refereeId,
				referrerSlug: "siti-kitchen",
			}),
		).rejects.toThrow(/already paid its first invoice/);
		expect(await referralOf(t, refereeId)).not.toBeNull();
	});

	test("clears a referral, and clearing twice is a no-op", async () => {
		const t = setup();
		const referrerId = await createStore(t, REFERRER, "siti-kitchen");
		await setSub(t, referrerId, { status: "active" });
		const refereeId = await createStore(t, REFEREE, "new-kedai", {
			referralSlug: "siti-kitchen",
		});
		const asAdmin = t.withIdentity({ subject: ADMIN });
		await asAdmin.mutation(api.referrals.adminClearReferral, { refereeId });
		await asAdmin.mutation(api.referrals.adminClearReferral, { refereeId });
		expect(await referralOf(t, refereeId)).toBeNull();
		const audit = await t.run((ctx) =>
			ctx.db
				.query("adminAuditLog")
				.withIndex("by_retailer", (q) => q.eq("retailerId", refereeId))
				.collect(),
		);
		expect(
			audit.filter((a) => a.action === "referrals.adminClearReferral"),
		).toHaveLength(1);
	});

	test("is admin-only", async () => {
		const t = setup();
		const referrerId = await createStore(t, REFERRER, "siti-kitchen");
		await setSub(t, referrerId, { status: "active" });
		const refereeId = await createStore(t, REFEREE, "new-kedai");
		await expect(
			t
				.withIdentity({ subject: REFEREE })
				.mutation(api.referrals.adminSetReferrer, {
					refereeId,
					referrerSlug: "siti-kitchen",
				}),
		).rejects.toThrow();
	});
});

describe("admin seller row", () => {
	test("carries the referral and whether it can still change", async () => {
		const t = setup();
		const referrerId = await createStore(t, REFERRER, "siti-kitchen");
		await setSub(t, referrerId, { status: "active" });
		const refereeId = await createStore(t, REFEREE, "new-kedai", {
			referralSlug: "siti-kitchen",
		});

		const rows = await t
			.withIdentity({ subject: ADMIN })
			.query(api.admin.listSellersForAdmin, {}).then((r) => r.sellers);
		const row = rows.find((r) => r._id === refereeId);
		expect(row?.referral).toMatchObject({
			referrer: { slug: "siti-kitchen", storeName: "Store siti-kitchen" },
			via: "link",
		});
		expect(row?.referralEditable).toBe(true);
		const referrerRow = rows.find((r) => r._id === referrerId);
		expect(referrerRow?.referral).toBeUndefined();

		await insertPaidInvoice(t, refereeId);
		const after = await t
			.withIdentity({ subject: ADMIN })
			.query(api.admin.listSellersForAdmin, {}).then((r) => r.sellers);
		expect(after.find((r) => r._id === refereeId)?.referralEditable).toBe(
			false,
		);
	});
});

describe("store deletion", () => {
	test("erases the tenant's own referral row, keeps rows naming it as referrer", async () => {
		const t = setup();
		const referrerId = await createStore(t, REFERRER, "siti-kitchen");
		await setSub(t, referrerId, { status: "active" });
		const refereeId = await createStore(t, REFEREE, "new-kedai", {
			referralSlug: "siti-kitchen",
		});

		const { runDeletionPhase } = await import("./lib/accountDeletion");
		// Delete the REFERRER's referral rows: it has none as a referee.
		await t.run(async (ctx) => {
			const r = await ctx.db.get(referrerId);
			if (!r) throw new Error("missing");
			await runDeletionPhase(ctx, r, "referrals", 50, null);
		});
		expect(await referralOf(t, refereeId)).not.toBeNull();

		// Delete the REFEREE's: its own row goes.
		await t.run(async (ctx) => {
			const r = await ctx.db.get(refereeId);
			if (!r) throw new Error("missing");
			await runDeletionPhase(ctx, r, "referrals", 50, null);
		});
		expect(await referralOf(t, refereeId)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// T2 (86ey82hke): the reward at the referee's first paid plan invoice — driven
// through the real settle path (admin issue → mark paid), the same one every
// payment rail funnels into.
// ---------------------------------------------------------------------------

async function payInvoice(
	t: T,
	retailerId: Id<"retailers">,
	plan: "starter" | "pro" = "pro",
): Promise<void> {
	const asAdmin = t.withIdentity({ subject: ADMIN });
	const { invoiceId } = await asAdmin.mutation(api.invoices.issueInvoice, {
		retailerId,
		plan,
		billingCycle: "monthly",
		founding: false,
	});
	await asAdmin.mutation(api.invoices.markPaid, {
		invoiceId,
		paymentMethod: "duitnow",
	});
	// The grant is a scheduled mutation of its own (atomic, never blocks the
	// settle) — let it run before the test reads the ledger.
	await settleScheduled(t);
}

async function referralRows(t: T, retailerId: Id<"retailers">) {
	return await t.run(async (ctx) => {
		const rows = await ctx.db
			.query("creditLedger")
			.withIndex("by_retailer_created", (q) => q.eq("retailerId", retailerId))
			.collect();
		return rows.filter(
			(r) =>
				r.reason === "referral_referee" || r.reason === "referral_referrer",
		);
	});
}

async function referredPair(
	t: T,
	referrerPatch: Partial<Doc<"subscriptions">> = { status: "active" },
) {
	const referrerId = await createStore(t, REFERRER, "siti-kitchen");
	await setSub(t, referrerId, { status: "active" });
	const refereeId = await createStore(t, REFEREE, "new-kedai", {
		referralSlug: "siti-kitchen",
	});
	await setSub(t, referrerId, referrerPatch);
	return { referrerId, refereeId };
}

describe("referral reward at the first paid invoice (T2)", () => {
	test("a Pro referee: 60 to the referee AND 60 to the referrer, whatever the referrer's tier", async () => {
		const t = setup();
		const { referrerId, refereeId } = await referredPair(t, {
			status: "active",
			plan: "starter",
		});
		await payInvoice(t, refereeId, "pro");

		const refereeRows = await referralRows(t, refereeId);
		expect(refereeRows).toHaveLength(1);
		expect(refereeRows[0]).toMatchObject({
			type: "grant",
			bucket: "purchased",
			amount: 60,
			reason: "referral_referee",
			refLabel: "Store siti-kitchen",
		});
		const referrerRows = await referralRows(t, referrerId);
		expect(referrerRows).toHaveLength(1);
		expect(referrerRows[0]).toMatchObject({
			amount: 60,
			reason: "referral_referrer",
			refLabel: "Store new-kedai",
		});
		const row = await referralOf(t, refereeId);
		expect(row).toMatchObject({
			refereeCredits: 60,
			referrerCredits: 60,
			referrerOutcome: "granted",
		});
		expect(row?.rewardedAt).toBeTypeOf("number");
		// Bought-credit lots, so they last 12 months.
		const lots = await t.run((ctx) =>
			ctx.db
				.query("creditLots")
				.withIndex("by_retailer_open_expiry", (q) =>
					q.eq("retailerId", refereeId).eq("open", true),
				)
				.collect(),
		);
		expect(lots.map((l) => [l.source, l.credits])).toContainEqual([
			"referral",
			60,
		]);
	});

	test("a Starter referee: 30 each, even for a Pro referrer", async () => {
		const t = setup();
		const { referrerId, refereeId } = await referredPair(t);
		await payInvoice(t, refereeId, "starter");
		expect((await referralRows(t, refereeId))[0]?.amount).toBe(30);
		expect((await referralRows(t, referrerId))[0]?.amount).toBe(30);
	});

	test("self-referral (same email or number): the referee is paid, the referrer half is withheld", async () => {
		const t = setup();
		const { referrerId, refereeId } = await referredPair(t);
		await t.run(async (ctx) => {
			await ctx.db.patch(referrerId, { notifyEmail: "owner@example.com" });
			await ctx.db.patch(refereeId, { notifyEmail: "Owner@Example.com" });
		});
		await payInvoice(t, refereeId, "pro");
		expect((await referralRows(t, refereeId))[0]?.amount).toBe(60);
		expect(await referralRows(t, referrerId)).toHaveLength(0);
		expect(await referralOf(t, refereeId)).toMatchObject({
			referrerOutcome: "self",
		});
	});

	test("lands once — a second paid invoice grants nothing more", async () => {
		const t = setup();
		const { referrerId, refereeId } = await referredPair(t);
		await payInvoice(t, refereeId, "pro");
		await payInvoice(t, refereeId, "pro");
		expect(await referralRows(t, refereeId)).toHaveLength(1);
		expect(await referralRows(t, referrerId)).toHaveLength(1);
	});

	test("the reward stamp is the guard — a repeated grant call is a no-op", async () => {
		const t = setup();
		const { referrerId, refereeId } = await referredPair(t);
		const { grantReferralRewards } = await import("./referrals");
		await t.run(async (ctx) => {
			const first = await grantReferralRewards(ctx, {
				refereeId,
				paidPlan: "pro",
				now: Date.now(),
			});
			const second = await grantReferralRewards(ctx, {
				refereeId,
				paidPlan: "pro",
				now: Date.now(),
			});
			expect(first).not.toBeNull();
			expect(second).toBeNull();
		});
		expect(await referralRows(t, refereeId)).toHaveLength(1);
		expect(await referralRows(t, referrerId)).toHaveLength(1);
	});

	test("a comped referrer earns nothing; their referee still does", async () => {
		const t = setup();
		const { referrerId, refereeId } = await referredPair(t, { comped: true });
		await payInvoice(t, refereeId, "pro");
		expect(await referralRows(t, refereeId)).toHaveLength(1);
		expect(await referralRows(t, referrerId)).toHaveLength(0);
		expect(await referralOf(t, refereeId)).toMatchObject({
			referrerOutcome: "unmetered",
		});
	});

	test("a referrer that lapsed since still earns for the referral it made", async () => {
		const t = setup();
		const { referrerId, refereeId } = await referredPair(t, {
			status: "past_due",
		});
		await payInvoice(t, refereeId, "pro");
		expect((await referralRows(t, referrerId))[0]?.amount).toBe(60);
	});

	test("a deleted referrer: the referee's bonus stands, labelled generically", async () => {
		const t = setup();
		const { referrerId, refereeId } = await referredPair(t);
		await t.run((ctx) => ctx.db.delete(referrerId));
		await payInvoice(t, refereeId, "pro");
		const rows = await referralRows(t, refereeId);
		expect(rows[0]).toMatchObject({ amount: 60 });
		expect(rows[0]?.refLabel).toBeUndefined();
		expect(await referralOf(t, refereeId)).toMatchObject({
			referrerOutcome: "deleted",
		});
	});

	test("an Enterprise referrer earns the referee's tier (60), never 30% of its contract", async () => {
		const t = setup();
		const { referrerId, refereeId } = await referredPair(t, {
			plan: "enterprise",
		});
		await payInvoice(t, refereeId, "pro");
		expect((await referralRows(t, referrerId))[0]?.amount).toBe(60);
	});

	test("a store nobody referred gets no referral credits", async () => {
		const t = setup();
		const plainId = await createStore(t, REFEREE, "plain-kedai");
		await payInvoice(t, plainId, "pro");
		expect(await referralRows(t, plainId)).toHaveLength(0);
	});

	test("the referee's own view reports the reward once it lands", async () => {
		const t = setup();
		const { refereeId } = await referredPair(t);
		await payInvoice(t, refereeId, "pro");
		const mine = await t
			.withIdentity({ subject: REFEREE })
			.query(api.referrals.mine, {});
		expect(mine).toMatchObject({
			firstInvoicePaid: true,
			reward: { credits: 60 },
		});
	});
});

describe("referrals.myCard (T3)", () => {
	test("an active store: its link, the offers, and the counts", async () => {
		const t = setup();
		const { referrerId, refereeId } = await referredPair(t, {
			status: "active",
			plan: "starter",
		});
		await createStore(t, OTHER, "second-kedai", { referralSlug: "siti-kitchen" });
		await payInvoice(t, refereeId, "pro");
		const card = await t
			.withIdentity({ subject: REFERRER })
			.query(api.referrals.myCard, {});
		expect(card).toMatchObject({
			slug: "siti-kitchen",
			link: "https://kedaipal.com/referral/siti-kitchen",
			standing: { canRefer: true, earnsReward: true },
			offer: { starter: 30, pro: 60 },
			earns: true,
			signedUp: 2,
			started: 1,
			creditsEarned: 60,
			capped: false,
		});
		expect(referrerId).toBeDefined();
	});

	test("a trial store is told its link doesn't count yet", async () => {
		const t = setup();
		await createStore(t, REFERRER, "siti-kitchen");
		const card = await t
			.withIdentity({ subject: REFERRER })
			.query(api.referrals.myCard, {});
		expect(card?.standing).toEqual({ canRefer: false, reason: "trial" });
		expect(card?.earns).toBe(false);
	});

	test("a comped partner can refer but earns nothing", async () => {
		const t = setup();
		const id = await createStore(t, REFERRER, "huff-puff");
		await setSub(t, id, { comped: true });
		const card = await t
			.withIdentity({ subject: REFERRER })
			.query(api.referrals.myCard, {});
		expect(card).toMatchObject({
			standing: { canRefer: true, earnsReward: false },
			earns: false,
		});
	});

	test("null when signed out", async () => {
		const t = setup();
		expect(await t.query(api.referrals.myCard, {})).toBeNull();
	});
});
