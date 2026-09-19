/// <reference types="vite/client" />
// Founding-benefit revocation (z8r3fdfyw5): 90 days past paid-through, a
// founding member's BENEFITS end — the 30% price, the Founding-Pro lock and
// white-glove. Their RANK AND BADGE do not, which the agreement (86exq9kz9) and
// the billing ribbon both promise, so most of this file is about what the
// revocation must leave alone. See docs/hitpay-recurring.md.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { revokeBenefits } from "./foundingMembers";
import {
	FOUNDING_MEMBER_LIMIT,
	FOUNDING_PRICE_LAPSE_MS,
} from "./lib/plans";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const ADMIN = "user_founding_admin";
const DAY = 24 * 60 * 60 * 1000;
const WINDOW = FOUNDING_PRICE_LAPSE_MS;
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

/**
 * A claimed Founding Member: the founding onboard reserves the rank AND sets
 * `foundingIntent` in one transaction, so both flags are live — which is
 * exactly the shape the revocation has to handle (intent is never cleared after
 * the claim, and on its own it carries no lapse check).
 */
async function seedFoundingMember(
	t: ReturnType<typeof setup>,
	userId: string,
	subOverrides: Partial<Doc<"subscriptions">> = {},
) {
	const asUser = t.withIdentity({ subject: userId });
	const slug = `fm-${userId.replace(/[^a-z0-9]/g, "")}`;
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: `Store ${slug}`,
		slug,
		intent: "founding",
	});
	return await t.run(async (ctx) => {
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
		const row = await ctx.db
			.query("foundingMembers")
			.withIndex("by_retailer", (q) => q.eq("retailerId", r._id))
			.first();
		if (!row) throw new Error("no founding row");
		const now = Date.now();
		// Default: paid once, then lapsed well past the window.
		await ctx.db.patch(sub._id, {
			status: "past_due",
			currentPeriodStart: now - (WINDOW + 31 * DAY),
			currentPeriodEnd: now - (WINDOW + DAY),
			periodPaidBy: "plan",
			...subOverrides,
		});
		await ctx.db.patch(row._id, { paidAt: now - (WINDOW + 31 * DAY) });
		return { retailerId: r._id, subId: sub._id, rowId: row._id, slug, userId };
	});
}

const getRetailer = (t: ReturnType<typeof setup>, id: Id<"retailers">) =>
	t.run((ctx) => ctx.db.get(id));
const getSub = (t: ReturnType<typeof setup>, id: Id<"subscriptions">) =>
	t.run((ctx) => ctx.db.get(id));
const getRow = (t: ReturnType<typeof setup>, id: Id<"foundingMembers">) =>
	t.run((ctx) => ctx.db.get(id));

const runPass = (t: ReturnType<typeof setup>) =>
	t.mutation(internal.foundingMembers.internalRevokeLapsedBenefits, {});

/**
 * The founding-benefit emails the pass has queued, with their args. Counting
 * `warned`/`revoked` alone would pass vacuously if the notice were never
 * scheduled — the whole point of a T-14 warning is that it reaches the seller,
 * and `_scheduled_functions` is the honest witness.
 */
async function benefitEmails(t: ReturnType<typeof setup>): Promise<
	Array<{ key: string; endsOnAt: number }>
> {
	const jobs = await t.run((ctx) =>
		ctx.db.system.query("_scheduled_functions").collect(),
	);
	return jobs
		.filter((j) => j.name.includes("notifyFoundingBenefitsEmail"))
		.map((j) => {
			const a = (j.args as unknown as Array<Record<string, unknown>>)[0];
			return { key: String(a.key), endsOnAt: Number(a.endsOnAt) };
		});
}

describe("the daily pass revokes benefits past the window", () => {
	test("revoked exactly once: row stamped, retailer flagged, intent cleared", async () => {
		const t = setup();
		const s = await seedFoundingMember(t, "user_lapsed_1");

		const first = await runPass(t);
		expect(first.revoked).toBe(1);

		const row = await getRow(t, s.rowId);
		expect(row?.benefitsRevokedAt).toBeDefined();
		expect(row?.benefitsRevokedReason).toBe("lapsed");
		expect((await getRetailer(t, s.retailerId))?.foundingBenefitsRevokedAt).toBe(
			row?.benefitsRevokedAt,
		);
		// `foundingIntent` is cleared as well as short-circuited. Both are
		// guards, and each is asserted on its own so neither can quietly rot.
		expect((await getSub(t, s.subId))?.foundingIntent).toBeUndefined();

		// One "benefits ended" notice, quoting the date it actually happened on.
		const sent = await benefitEmails(t);
		expect(sent.map((e) => e.key)).toEqual(["foundingBenefitsEnded"]);

		// Running again is a no-op — no restamp, no second email.
		const stampedAt = row?.benefitsRevokedAt;
		vi.advanceTimersByTime(2 * DAY);
		const second = await runPass(t);
		expect(second.revoked).toBe(0);
		expect((await getRow(t, s.rowId))?.benefitsRevokedAt).toBe(stampedAt);
		expect(await benefitEmails(t)).toHaveLength(1);
	});

	test("the HONOUR survives: rank, badge flags, row and the claimed slot", async () => {
		const t = setup();
		const s = await seedFoundingMember(t, "user_lapsed_2");
		const before = await getRetailer(t, s.retailerId);
		const spotsBefore = await t.query(api.foundingMembers.getSpotsRemaining, {});

		await runPass(t);

		const after = await getRetailer(t, s.retailerId);
		// The two promises in writing: the storefront badge and the "Founding #N"
		// pill both read these, and the ribbon says they're "yours for good".
		expect(after?.isFoundingMember).toBe(true);
		expect(after?.foundingMemberRank).toBe(before?.foundingMemberRank);
		// The row is stamped, never deleted — so the slot stays claimed and a
		// re-grant is Arif's deliberate act, not a race for a freed spot.
		expect(await getRow(t, s.rowId)).not.toBeNull();
		expect(await t.query(api.foundingMembers.getSpotsRemaining, {})).toBe(
			spotsBefore,
		);
	});

	test("white-glove — a BENEFIT — stops being offered, but the rank still reads", async () => {
		const t = setup();
		const s = await seedFoundingMember(t, "user_lapsed_3");
		const asUser = t.withIdentity({ subject: s.userId });

		const live = await asUser.query(api.foundingMembers.myStatus, {});
		expect(live?.benefitsRevoked).toBe(false);

		await runPass(t);

		const gone = await asUser.query(api.foundingMembers.myStatus, {});
		expect(gone?.benefitsRevoked).toBe(true);
		expect(gone?.rank).toBe(live?.rank);
	});

	test("the seller's billing page prices them as an ordinary Pro seller", async () => {
		const t = setup();
		const s = await seedFoundingMember(t, "user_lapsed_4");
		const asUser = t.withIdentity({ subject: s.userId });

		await runPass(t);

		const gateway = await asUser.query(
			api.subscriptionPayments.billingGatewayAvailable,
			{},
		);
		expect(gateway?.foundingPricing).toBe(false);
		expect(gateway?.foundingBenefitsRevoked).toBe(true);
		// Revoked is a terminal state, so there is no "ends on" date left to show.
		expect(gateway?.foundingBenefitsEndAt).toBeUndefined();
		expect(gateway?.nextRenewal?.founding).toBe(false);
	});

	test("PAYING AFTER REVOCATION does not bring the discount back", async () => {
		// The point of the whole ticket: before this, the lapse was a PAUSE —
		// settling advances `currentPeriodEnd`, and the read-time window then
		// re-granted founding pricing to a store that had been gone for months.
		const t = setup();
		const s = await seedFoundingMember(t, "user_lapsed_5");
		await runPass(t);

		await t.run(async (ctx) => {
			await ctx.db.patch(s.subId, {
				status: "active",
				currentPeriodStart: Date.now(),
				currentPeriodEnd: Date.now() + 30 * DAY,
			});
		});

		const gateway = await t
			.withIdentity({ subject: s.userId })
			.query(api.subscriptionPayments.billingGatewayAvailable, {});
		expect(gateway?.foundingPricing).toBe(false);
		expect(gateway?.nextRenewal?.founding).toBe(false);
	});
});

describe("who is never revoked", () => {
	test("an Off-Season Hold is a PAYING store", async () => {
		const t = setup();
		// Status guard and paid-through guard are both deliberate, so this sets
		// the paid-through stale to prove the STATUS alone protects them.
		const s = await seedFoundingMember(t, "user_held", {
			status: "on_hold",
			currentPeriodEnd: Date.now() - (WINDOW + 10 * DAY),
		});
		expect((await runPass(t)).revoked).toBe(0);
		expect((await getRow(t, s.rowId))?.benefitsRevokedAt).toBeUndefined();
	});

	test("a live paid period, and an active store whose renewal is in grace", async () => {
		const t = setup();
		const mid = await seedFoundingMember(t, "user_active_mid", {
			status: "active",
			currentPeriodEnd: Date.now() + 20 * DAY,
		});
		expect((await runPass(t)).revoked).toBe(0);
		expect((await getRow(t, mid.rowId))?.benefitsRevokedAt).toBeUndefined();
	});

	test("a comped store — Kedaipal is giving it away, nothing has lapsed", async () => {
		const t = setup();
		const s = await seedFoundingMember(t, "user_comped", { comped: true });
		expect((await runPass(t)).revoked).toBe(0);
		expect((await getRow(t, s.rowId))?.benefitsRevokedAt).toBeUndefined();
	});

	test("a founding trial that never paid — fail toward the promise", async () => {
		const t = setup();
		const s = await seedFoundingMember(t, "user_never_paid", {
			status: "trialing",
			currentPeriodStart: undefined,
			currentPeriodEnd: undefined,
		});
		expect((await runPass(t)).revoked).toBe(0);
		expect((await getRow(t, s.rowId))?.benefitsRevokedAt).toBeUndefined();
		// And they keep their founding price, which is the whole point of the
		// `paidThrough === undefined` branch.
		const gateway = await t
			.withIdentity({ subject: s.userId })
			.query(api.subscriptionPayments.billingGatewayAvailable, {});
		expect(gateway?.foundingPricing).toBe(true);
	});

	test("the boundary: at day 90 nothing is taken, at day 91 it is", async () => {
		const t = setup();
		const safe = await seedFoundingMember(t, "user_day90", {
			currentPeriodEnd: Date.now() - WINDOW,
		});
		expect((await runPass(t)).revoked).toBe(0);
		expect((await getRow(t, safe.rowId))?.benefitsRevokedAt).toBeUndefined();

		vi.advanceTimersByTime(DAY);
		expect((await runPass(t)).revoked).toBe(1);
		expect((await getRow(t, safe.rowId))?.benefitsRevokedAt).toBeDefined();
	});
});

describe("the date a seller SEES matches the date the pass acts on", () => {
	/**
	 * Found by driving an aged store (19 Sep 2026): the billing tab derived its
	 * countdown from paid-through alone, so a store the pass SKIPS was shown a
	 * red "your founding price ends on 29 Sept" alert for a deadline that could
	 * never arrive. The worst case is a COMPED founding member — Kedaipal is
	 * giving them the product, and the page threatened to take their discount.
	 */
	const STALE = { currentPeriodEnd: Date.now() - (WINDOW - 10 * DAY) };

	test("a lapsing member is shown the date, and the pass agrees by warning", async () => {
		const t = setup();
		const s = await seedFoundingMember(t, "user_shown_date", STALE);
		const gateway = await t
			.withIdentity({ subject: s.userId })
			.query(api.subscriptionPayments.billingGatewayAvailable, {});
		expect(gateway?.foundingBenefitsEndAt).toBe(
			(STALE.currentPeriodEnd as number) + WINDOW,
		);
		// The page says a date; the pass must act on it.
		expect((await runPass(t)).warned).toBe(1);
	});

	test.each([
		["active", { status: "active" as const, ...STALE }],
		["on_hold", { status: "on_hold" as const, ...STALE }],
		["comped", { status: "past_due" as const, comped: true, ...STALE }],
	])(
		"a %s store is shown NO date, because the pass would never act",
		async (_label, overrides) => {
			const t = setup();
			const s = await seedFoundingMember(t, `user_nodate_${_label}`, overrides);
			const gateway = await t
				.withIdentity({ subject: s.userId })
				.query(api.subscriptionPayments.billingGatewayAvailable, {});
			// No countdown…
			expect(gateway?.foundingBenefitsEndAt).toBeUndefined();
			// …and the pass confirms why: it neither warns nor revokes.
			const res = await runPass(t);
			expect(res.warned).toBe(0);
			expect(res.revoked).toBe(0);
			// Their benefits are untouched and still priced as founding.
			expect(gateway?.foundingPricing).toBe(true);
		},
	);

	test("the admin console applies the same gate", async () => {
		const t = setup();
		await seedFoundingMember(t, "user_admin_nodate", {
			status: "active",
			...STALE,
		});
		const lapsing = await seedFoundingMember(t, "user_admin_date", STALE);
		const rows = await t
			.withIdentity({ subject: ADMIN })
			.query(api.foundingMembers.listForAdmin, {});
		const shown = rows.find((r) => r.retailerId === lapsing.retailerId);
		const hidden = rows.find((r) => r.retailerId !== lapsing.retailerId);
		expect(shown?.benefitsEndAt).toBeDefined();
		expect(hidden?.benefitsEndAt).toBeUndefined();
	});
});

describe("the T-14 warning goes out before anything is taken", () => {
	test("warned once per paid period, and nothing is revoked yet", async () => {
		const t = setup();
		const s = await seedFoundingMember(t, "user_warn", {
			currentPeriodEnd: Date.now() - (WINDOW - 10 * DAY),
		});

		const first = await runPass(t);
		expect(first.warned).toBe(1);
		expect(first.revoked).toBe(0);
		const row = await getRow(t, s.rowId);
		expect(row?.benefitsWarningSentForPeriodEnd).toBeDefined();
		expect(row?.benefitsRevokedAt).toBeUndefined();

		// The notice actually went out, and quotes the SAME date the pass will
		// revoke on — a warning naming a different day would be worse than none.
		const sent = await benefitEmails(t);
		expect(sent).toHaveLength(1);
		expect(sent[0].key).toBe("foundingBenefitsEndingSoon");
		expect(sent[0].endsOnAt).toBe(
			(row?.benefitsWarningSentForPeriodEnd as number) + WINDOW,
		);

		// The next daily run must not warn again for the same period — and must
		// not queue a second email either.
		vi.advanceTimersByTime(DAY);
		expect((await runPass(t)).warned).toBe(0);
		expect(await benefitEmails(t)).toHaveLength(1);
	});

	test("paying resets the clock, so a LATER lapse warns again", async () => {
		const t = setup();
		const s = await seedFoundingMember(t, "user_warn_twice", {
			currentPeriodEnd: Date.now() - (WINDOW - 10 * DAY),
		});
		expect((await runPass(t)).warned).toBe(1);

		// They pay: the period advances past the danger zone (what settle does).
		await t.run(async (ctx) => {
			await ctx.db.patch(s.subId, {
				status: "active",
				currentPeriodEnd: Date.now() + 30 * DAY,
			});
		});
		expect((await runPass(t)).warned).toBe(0);

		// Months later they lapse again into the window — the stamp is from the
		// OLD period, so it must not suppress the new warning.
		await t.run(async (ctx) => {
			await ctx.db.patch(s.subId, {
				status: "past_due",
				currentPeriodEnd: Date.now() - (WINDOW - 5 * DAY),
			});
		});
		expect((await runPass(t)).warned).toBe(1);
	});

	test("THE WHOLE LIFECYCLE: warned at T-14, still paying-price, then revoked at T-0", async () => {
		// warn and revoke are covered apart; this is the sequence a real member
		// actually walks, on one row, across daily runs.
		const t = setup();
		const paidThrough = Date.now() - (WINDOW - 10 * DAY);
		const s = await seedFoundingMember(t, "user_lifecycle", {
			currentPeriodEnd: paidThrough,
		});
		const asUser = t.withIdentity({ subject: s.userId });

		// Day 80 — warned, and NOTHING taken: still on founding pricing.
		expect((await runPass(t)).warned).toBe(1);
		let gateway = await asUser.query(
			api.subscriptionPayments.billingGatewayAvailable,
			{},
		);
		expect(gateway?.foundingPricing).toBe(true);
		expect(gateway?.foundingBenefitsRevoked).toBe(false);
		expect(gateway?.foundingBenefitsEndAt).toBe(paidThrough + WINDOW);
		expect((await benefitEmails(t)).map((e) => e.key)).toEqual([
			"foundingBenefitsEndingSoon",
		]);

		// The daily runs in between change nothing — no re-warn, no early take.
		for (let d = 0; d < 10; d++) {
			vi.advanceTimersByTime(DAY);
			const res = await runPass(t);
			expect(res.warned).toBe(0);
			expect(res.revoked).toBe(0);
		}
		expect((await getRow(t, s.rowId))?.benefitsRevokedAt).toBeUndefined();

		// Past the window — revoked, once, with the second notice.
		vi.advanceTimersByTime(DAY);
		expect((await runPass(t)).revoked).toBe(1);
		expect((await getRow(t, s.rowId))?.benefitsRevokedReason).toBe("lapsed");
		expect((await benefitEmails(t)).map((e) => e.key)).toEqual([
			"foundingBenefitsEndingSoon",
			"foundingBenefitsEnded",
		]);

		// And the seller's page now prices them as an ordinary Pro store, with
		// no countdown left to show.
		gateway = await asUser.query(
			api.subscriptionPayments.billingGatewayAvailable,
			{},
		);
		expect(gateway?.foundingPricing).toBe(false);
		expect(gateway?.foundingBenefitsRevoked).toBe(true);
		expect(gateway?.foundingBenefitsEndAt).toBeUndefined();
		// The honour is untouched, all the way through.
		expect((await getRetailer(t, s.retailerId))?.isFoundingMember).toBe(true);
	});

	test("the warning names the same end date the pass revokes on", async () => {
		const t = setup();
		const paidThrough = Date.now() - (WINDOW - 7 * DAY);
		const s = await seedFoundingMember(t, "user_warn_date", {
			currentPeriodEnd: paidThrough,
		});
		await runPass(t);

		const gateway = await t
			.withIdentity({ subject: s.userId })
			.query(api.subscriptionPayments.billingGatewayAvailable, {});
		// What the seller's banner shows...
		expect(gateway?.foundingBenefitsEndAt).toBe(paidThrough + WINDOW);
		// ...is the day they are actually revoked, not a day either side of it.
		vi.setSystemTime(paidThrough + WINDOW);
		expect((await runPass(t)).revoked).toBe(0);
		vi.setSystemTime(paidThrough + WINDOW + 1000);
		expect((await runPass(t)).revoked).toBe(1);
	});
});

describe("the admin lever", () => {
	test("revoke by hand, then restore — the honour untouched either way", async () => {
		const t = setup();
		const s = await seedFoundingMember(t, "user_admin_lever", {
			status: "active",
			currentPeriodEnd: Date.now() + 20 * DAY,
		});
		const asAdmin = t.withIdentity({ subject: ADMIN });

		expect(
			await asAdmin.mutation(api.foundingMembers.adminSetBenefits, {
				retailerId: s.retailerId,
				revoked: true,
				note: "closed the business",
			}),
		).toBe(true);
		let row = await getRow(t, s.rowId);
		expect(row?.benefitsRevokedReason).toBe("admin");
		expect(row?.benefitsRevokedNote).toBe("closed the business");
		expect((await getRetailer(t, s.retailerId))?.isFoundingMember).toBe(true);

		// Restore: the flags clear, and the warning stamp clears with them so a
		// future lapse warns again before taking anything a second time.
		expect(
			await asAdmin.mutation(api.foundingMembers.adminSetBenefits, {
				retailerId: s.retailerId,
				revoked: false,
			}),
		).toBe(true);
		row = await getRow(t, s.rowId);
		expect(row?.benefitsRevokedAt).toBeUndefined();
		expect(row?.benefitsRevokedReason).toBeUndefined();
		expect(row?.benefitsWarningSentForPeriodEnd).toBeUndefined();
		expect(
			(await getRetailer(t, s.retailerId))?.foundingBenefitsRevokedAt,
		).toBeUndefined();
	});

	test("RE-GRANTING A STILL-LAPSED MEMBER actually restores the price, and sticks", async () => {
		/**
		 * The lever's PRIMARY use: one of the unpaid members comes back and Arif
		 * re-grants. Before the clock floor, this was doubly broken — the restore
		 * was a no-op (the read-time window measured from a paid-through already
		 * months past, so the seller stayed on LIST price the instant Arif told
		 * them otherwise), and the next daily pass re-revoked them and sent a
		 * SECOND "your founding price has ended" email. Reported in review of
		 * PR #288.
		 */
		const t = setup();
		// Well past the window, past_due — the exact shape of the three unpaid.
		const s2 = await seedFoundingMember(t, "user_regrant", {
			status: "past_due",
			currentPeriodEnd: Date.now() - (WINDOW + 20 * DAY),
		});
		const asUser = t.withIdentity({ subject: s2.userId });
		const asAdmin = t.withIdentity({ subject: ADMIN });

		expect((await runPass(t)).revoked).toBe(1);
		expect(await benefitEmails(t)).toHaveLength(1);

		await asAdmin.mutation(api.foundingMembers.adminSetBenefits, {
			retailerId: s2.retailerId,
			revoked: false,
			note: "coming back",
		});

		// IMMEDIATELY: the price is actually back — the dialog's promise is true.
		const after = await asUser.query(
			api.subscriptionPayments.billingGatewayAvailable,
			{},
		);
		expect(after?.foundingPricing).toBe(true);
		expect(after?.foundingBenefitsRevoked).toBe(false);
		expect(after?.nextRenewal?.founding).toBe(true);

		// AND IT STICKS: the very next daily run must not undo Arif's decision.
		vi.advanceTimersByTime(DAY);
		const res = await runPass(t);
		expect(res.revoked).toBe(0);
		expect(res.warned).toBe(0);
		expect((await getRow(t, s2.rowId))?.benefitsRevokedAt).toBeUndefined();
		// No second "ended" email contradicting what the seller was just told.
		expect(await benefitEmails(t)).toHaveLength(1);
	});

	test("a re-grant restarts the clock — it does not grant immunity", async () => {
		// The floor is a fresh window, not a free pass: an unpaid restored member
		// lapses again on identical terms, warned at T-14 first.
		const t = setup();
		const s2 = await seedFoundingMember(t, "user_regrant_relapse", {
			status: "past_due",
			currentPeriodEnd: Date.now() - (WINDOW + 20 * DAY),
		});
		await runPass(t);
		await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.foundingMembers.adminSetBenefits, {
				retailerId: s2.retailerId,
				revoked: false,
			});
		const restoredAt = Date.now();

		// Still inside the fresh window at day 75 — nothing taken.
		vi.advanceTimersByTime(75 * DAY);
		expect((await runPass(t)).revoked).toBe(0);

		// Warned again at T-14, from the RE-GRANT, not the old paid-through.
		vi.advanceTimersByTime(2 * DAY);
		expect((await runPass(t)).warned).toBe(1);
		const gateway = await t
			.withIdentity({ subject: s2.userId })
			.query(api.subscriptionPayments.billingGatewayAvailable, {});
		expect(gateway?.foundingBenefitsEndAt).toBe(restoredAt + WINDOW);

		// And it does lapse a second time, on the same terms.
		vi.advanceTimersByTime(15 * DAY);
		expect((await runPass(t)).revoked).toBe(1);
	});

	test("a restored member is on founding pricing and locked to Founding Pro again", async () => {
		const t = setup();
		const s = await seedFoundingMember(t, "user_restored", {
			status: "active",
			currentPeriodEnd: Date.now() + 20 * DAY,
		});
		const asAdmin = t.withIdentity({ subject: ADMIN });
		const asUser = t.withIdentity({ subject: s.userId });

		await asAdmin.mutation(api.foundingMembers.adminSetBenefits, {
			retailerId: s.retailerId,
			revoked: true,
		});
		expect(
			(
				await asUser.query(api.subscriptionPayments.billingGatewayAvailable, {})
			)?.foundingPricing,
		).toBe(false);

		await asAdmin.mutation(api.foundingMembers.adminSetBenefits, {
			retailerId: s.retailerId,
			revoked: false,
		});
		expect(
			(
				await asUser.query(api.subscriptionPayments.billingGatewayAvailable, {})
			)?.foundingPricing,
		).toBe(true);
	});

	test("non-admins can't touch it, and a non-member is refused", async () => {
		const t = setup();
		const s = await seedFoundingMember(t, "user_guarded");
		await expect(
			t
				.withIdentity({ subject: s.userId })
				.mutation(api.foundingMembers.adminSetBenefits, {
					retailerId: s.retailerId,
					revoked: true,
				}),
		).rejects.toThrow();

		// A store that was never in the cohort has no row to stamp.
		const plain = t.withIdentity({ subject: "user_plain" });
		await plain.mutation(api.retailers.createRetailer, {
			storeName: "Plain Store",
			slug: "plain-store",
		});
		const plainId = (await plain.query(api.retailers.getMyRetailer))!._id;
		await expect(
			t
				.withIdentity({ subject: ADMIN })
				.mutation(api.foundingMembers.adminSetBenefits, {
					retailerId: plainId,
					revoked: true,
				}),
		).rejects.toThrow(/Not a founding member/);
	});

	test("the admin cohort list carries the benefit state and the end date", async () => {
		const t = setup();
		const lapsing = await seedFoundingMember(t, "user_list_lapsing", {
			currentPeriodEnd: Date.now() - (WINDOW - 10 * DAY),
		});
		await runPass(t); // warns, doesn't revoke
		const revoked = await seedFoundingMember(t, "user_list_revoked");
		await runPass(t); // revokes the second one

		const rows = await t
			.withIdentity({ subject: ADMIN })
			.query(api.foundingMembers.listForAdmin, {});

		const a = rows.find((r) => r.retailerId === lapsing.retailerId);
		expect(a?.benefitsRevokedAt).toBeUndefined();
		expect(a?.benefitsEndAt).toBeDefined();
		expect(a?.warned).toBe(true);

		const b = rows.find((r) => r.retailerId === revoked.retailerId);
		expect(b?.benefitsRevokedAt).toBeDefined();
		expect(b?.benefitsRevokedReason).toBe("lapsed");
		// Nothing left to count down to once it's gone.
		expect(b?.benefitsEndAt).toBeUndefined();
		// Rank is still reported — the console shows membership and benefits as
		// the two separate facts they are.
		expect(b?.rank).toBeGreaterThan(0);
	});
});

describe("an orphaned founding row can't take the whole pass down", () => {
	/** A founding row whose retailer was deleted but whose subscription survived —
	 * a partially completed account purge. Dev has a live example, which is how
	 * this was found (18 Sep 2026). */
	async function seedOrphan(t: ReturnType<typeof setup>, userId: string) {
		const s = await seedFoundingMember(t, userId);
		await t.run(async (ctx) => {
			await ctx.db.delete(s.retailerId);
		});
		return s;
	}

	test("the pass skips it instead of throwing, and still revokes everyone else", async () => {
		const t = setup();
		// The orphan is past the window, so it reaches the revoke branch — which is
		// where the patch on a deleted document used to blow up. Because the pass
		// is ONE transaction, that throw aborted the run and nobody was revoked.
		const orphan = await seedOrphan(t, "user_orphan_row");
		const healthy = await seedFoundingMember(t, "user_beside_orphan");

		const res = await runPass(t);

		expect(res.orphaned).toBe(1);
		expect(res.revoked).toBe(1);
		expect((await getRow(t, orphan.rowId))?.benefitsRevokedAt).toBeUndefined();
		// The whole point: the row beside it still got processed.
		expect((await getRow(t, healthy.rowId))?.benefitsRevokedAt).toBeDefined();
	});

	test("the slot stays claimed, and the admin list SHOWS it so the count adds up", async () => {
		const t = setup();
		const orphan = await seedOrphan(t, "user_orphan_listed");
		await seedFoundingMember(t, "user_orphan_peer");

		const spots = await t.query(api.foundingMembers.getSpotsRemaining, {});
		const rows = await t
			.withIdentity({ subject: ADMIN })
			.query(api.foundingMembers.listForAdmin, {});

		// The header counts ROWS; the list must not silently drop one, or it reads
		// "2/10 claimed" above a single store with nothing to explain the gap.
		expect(FOUNDING_MEMBER_LIMIT - spots).toBe(rows.length);
		const ghost = rows.find((r) => r.retailerMissing);
		expect(ghost?.retailerId).toBe(orphan.retailerId);
		expect(ghost?.storeName).toBe("Store deleted");
	});

	test("the admin levers refuse an orphan rather than throwing", async () => {
		const t = setup();
		const orphan = await seedOrphan(t, "user_orphan_lever");
		await expect(
			t.run(async (ctx) => {
				const row = await ctx.db.get(orphan.rowId);
				if (!row) throw new Error("no row");
				return await revokeBenefits(ctx, row, "admin");
			}),
		).resolves.toBe(false);
	});
});

describe("the admin issue form can't hand the discount straight back", () => {
	test("a revoked member is reported as revoked, so the form won't auto-discount", async () => {
		// The gap this closes: `listRetailersForAdmin` only said "isFoundingMember",
		// which stays true for ever — so the issue form pre-ticked AND DISABLED the
		// founding checkbox, billing a revoked member RM104 with no way for Arif to
		// untick it. The machine would have undone its own rule.
		const t = setup();
		const s = await seedFoundingMember(t, "user_admin_form");
		const asAdmin = t.withIdentity({ subject: ADMIN });

		let row = (
			await asAdmin.query(api.invoices.listRetailersForAdmin, {})
		).find((r) => r._id === s.retailerId);
		expect(row?.isFoundingMember).toBe(true);
		expect(row?.foundingBenefitsRevoked).toBe(false);

		await runPass(t);

		row = (await asAdmin.query(api.invoices.listRetailersForAdmin, {})).find(
			(r) => r._id === s.retailerId,
		);
		// Membership is still reported — the console shows both facts.
		expect(row?.isFoundingMember).toBe(true);
		expect(row?.foundingBenefitsRevoked).toBe(true);
		// And the flag the form actually keys off is gone, so nothing re-applies
		// the discount behind Arif's back.
		expect(row?.foundingIntent).toBe(false);
	});
});

describe("the daily billing cron drives it", () => {
	test("internalDailyBillingStatus schedules the pass", async () => {
		const t = setup();
		const s = await seedFoundingMember(t, "user_via_cron");

		await t.mutation(internal.subscriptions.internalDailyBillingStatus, {});
		// The pass is scheduled, not inlined, so drain the scheduler. Fake timers
		// are on, so convex-test needs `vi.runAllTimers` to advance them.
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect((await getRow(t, s.rowId))?.benefitsRevokedAt).toBeDefined();
	});
});
