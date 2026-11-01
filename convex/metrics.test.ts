/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { FOUNDER_HOURLY_RATE_SEN } from "./lib/metrics";
import { addMonthsMyt, monthStartMyt } from "./lib/usagePeriod";
import schema from "./schema";

// Acquisition attribution + the CAC ledger (86eye3eyp). Proves the admin
// gate, the closed channel set, the upsert-on-(month, channel) ledger, that a
// seller's own answer never overwrites an admin tag, and the month view's
// new-payer + CAC arithmetic.

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const ADMIN = "user_admin";
const DAY = 86_400_000;

let prevAdminEnv: string | undefined;
beforeAll(() => {
	prevAdminEnv = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
});
afterAll(() => {
	process.env.ADMIN_USER_IDS = prevAdminEnv;
});

async function seedStore(
	t: ReturnType<typeof setup>,
	userId: string,
	extra: { acquisitionSource?: string } = {},
): Promise<Id<"retailers">> {
	const asUser = t.withIdentity({ subject: userId });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: `Store ${userId}`,
		slug: `store-${userId.replace(/[^a-z0-9]/g, "")}`,
		...extra,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer._id;
}

async function payInvoice(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	paidAt: number,
): Promise<void> {
	await t.run(async (ctx) => {
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		if (!sub) throw new Error("no subscription");
		await ctx.db.insert("invoices", {
			retailerId,
			subscriptionId: sub._id,
			invoiceNumber: `INV-CAC-${paidAt}-${Math.random()}`,
			plan: "pro",
			billingCycle: "monthly",
			amount: 14900,
			total: 14900,
			currency: "MYR",
			periodStart: paidAt,
			periodEnd: paidAt + 30 * DAY,
			dueDate: paidAt + 14 * DAY,
			status: "paid",
			markedPaidAt: paidAt,
			createdAt: paidAt,
		});
	});
}

const thisMonth = () => monthStartMyt(Date.now());

describe("setAcquisitionSource", () => {
	test("tags the store as an admin, with the note, and audits it", async () => {
		const t = setup();
		const id = await seedStore(t, "user_seller");
		await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.metrics.setAcquisitionSource, {
				retailerId: id,
				source: "talk_event",
				note: "  Great Day Club talk, 8 Jul  ",
			});
		const { row, audit } = await t.run(async (ctx) => ({
			row: await ctx.db.get(id),
			audit: await ctx.db
				.query("adminAuditLog")
				.withIndex("by_retailer", (q) => q.eq("retailerId", id))
				.collect(),
		}));
		expect(row?.acquisitionSource).toBe("talk_event");
		expect(row?.acquisitionNote).toBe("Great Day Club talk, 8 Jul");
		expect(row?.acquisitionSetBy).toBe("admin");
		expect(row?.acquisitionSetAt).toBeTypeOf("number");
		expect(audit.map((a) => a.action)).toContain("metrics.setAcquisitionSource");
	});

	test("rejects a channel outside the closed set", async () => {
		const t = setup();
		const id = await seedStore(t, "user_seller");
		await expect(
			t
				.withIdentity({ subject: ADMIN })
				.mutation(api.metrics.setAcquisitionSource, {
					retailerId: id,
					source: "billboard",
				}),
		).rejects.toThrow(/isn't an acquisition channel/);
	});

	test("refuses anyone who isn't an admin, the store's owner included", async () => {
		const t = setup();
		const id = await seedStore(t, "user_seller");
		await expect(
			t
				.withIdentity({ subject: "user_seller" })
				.mutation(api.metrics.setAcquisitionSource, {
					retailerId: id,
					source: "walk_in",
				}),
		).rejects.toThrow(/Not authorized/);
		await expect(
			t.mutation(api.metrics.setAcquisitionSource, {
				retailerId: id,
				source: "walk_in",
			}),
		).rejects.toThrow(/Not authenticated/);
	});

	test("clears an old note when re-tagged without one", async () => {
		const t = setup();
		const id = await seedStore(t, "user_seller");
		const admin = t.withIdentity({ subject: ADMIN });
		await admin.mutation(api.metrics.setAcquisitionSource, {
			retailerId: id,
			source: "referral",
			note: "From Bearcamp",
		});
		await admin.mutation(api.metrics.setAcquisitionSource, {
			retailerId: id,
			source: "walk_in",
		});
		const row = await t.run((ctx) => ctx.db.get(id));
		expect(row?.acquisitionSource).toBe("walk_in");
		expect(row?.acquisitionNote).toBeUndefined();
	});
});

describe("onboarding capture", () => {
	test("stores the seller's own answer, marked as theirs", async () => {
		const t = setup();
		const id = await seedStore(t, "user_seller", {
			acquisitionSource: "inbound_social",
		});
		const row = await t.run((ctx) => ctx.db.get(id));
		expect(row?.acquisitionSource).toBe("inbound_social");
		expect(row?.acquisitionSetBy).toBe("seller");
	});

	test("drops an unknown answer instead of failing the signup", async () => {
		const t = setup();
		const id = await seedStore(t, "user_seller", { acquisitionSource: "billboard" });
		const row = await t.run((ctx) => ctx.db.get(id));
		expect(row?.acquisitionSource).toBeUndefined();
		expect(row?.acquisitionSetBy).toBeUndefined();
	});

	test("no answer leaves the store untagged", async () => {
		const t = setup();
		const id = await seedStore(t, "user_seller");
		const row = await t.run((ctx) => ctx.db.get(id));
		expect(row?.acquisitionSource).toBeUndefined();
	});
});

describe("recordSpend", () => {
	test("upserts one row per (month, channel)", async () => {
		const t = setup();
		const admin = t.withIdentity({ subject: ADMIN });
		const periodStart = thisMonth();
		await admin.mutation(api.metrics.recordSpend, {
			periodStart,
			entries: [{ channel: "talk_event", cashSpend: 30_000, founderHours: 10 }],
		});
		await admin.mutation(api.metrics.recordSpend, {
			periodStart,
			entries: [
				{ channel: "talk_event", cashSpend: 45_000, note: "Booth + printing" },
			],
		});
		const rows = await t.run((ctx) =>
			ctx.db
				.query("acquisitionCosts")
				.withIndex("by_period", (q) => q.eq("periodStart", periodStart))
				.collect(),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			channel: "talk_event",
			cashSpend: 45_000,
			note: "Booth + printing",
			updatedBy: ADMIN,
		});
		expect(rows[0]?.founderHours).toBeUndefined();
	});

	test("a blank entry deletes the channel's row", async () => {
		const t = setup();
		const admin = t.withIdentity({ subject: ADMIN });
		const periodStart = thisMonth();
		await admin.mutation(api.metrics.recordSpend, {
			periodStart,
			entries: [{ channel: "walk_in", cashSpend: 12_000 }],
		});
		await admin.mutation(api.metrics.recordSpend, {
			periodStart,
			entries: [{ channel: "walk_in", cashSpend: 0, founderHours: 0, note: " " }],
		});
		const rows = await t.run((ctx) => ctx.db.query("acquisitionCosts").collect());
		expect(rows).toHaveLength(0);
	});

	test("rejects an unknown channel, a duplicate, a bad amount and a future month", async () => {
		const t = setup();
		const admin = t.withIdentity({ subject: ADMIN });
		const periodStart = thisMonth();
		await expect(
			admin.mutation(api.metrics.recordSpend, {
				periodStart,
				entries: [{ channel: "billboard", cashSpend: 100 }],
			}),
		).rejects.toThrow(/isn't an acquisition channel/);
		await expect(
			admin.mutation(api.metrics.recordSpend, {
				periodStart,
				entries: [
					{ channel: "walk_in", cashSpend: 100 },
					{ channel: "walk_in", cashSpend: 200 },
				],
			}),
		).rejects.toThrow(/listed twice/);
		await expect(
			admin.mutation(api.metrics.recordSpend, {
				periodStart,
				entries: [{ channel: "walk_in", cashSpend: -5 }],
			}),
		).rejects.toThrow(/Walk-in/);
		await expect(
			admin.mutation(api.metrics.recordSpend, {
				periodStart: addMonthsMyt(periodStart, 1),
				entries: [{ channel: "walk_in", cashSpend: 100 }],
			}),
		).rejects.toThrow(/hasn't started/);
		await expect(
			admin.mutation(api.metrics.recordSpend, {
				periodStart: periodStart + 1,
				entries: [{ channel: "walk_in", cashSpend: 100 }],
			}),
		).rejects.toThrow(/start of a month/);
		const rows = await t.run((ctx) => ctx.db.query("acquisitionCosts").collect());
		expect(rows).toHaveLength(0);
	});

	test("is admin-only", async () => {
		const t = setup();
		await expect(
			t.withIdentity({ subject: "user_seller" }).mutation(api.metrics.recordSpend, {
				periodStart: thisMonth(),
				entries: [{ channel: "walk_in", cashSpend: 100 }],
			}),
		).rejects.toThrow(/Not authorized/);
	});
});

describe("getMonth", () => {
	test("lists every channel, counts first-time payers per tagged channel, and prices CAC", async () => {
		const t = setup();
		const admin = t.withIdentity({ subject: ADMIN });
		const periodStart = thisMonth();
		const inMonth = periodStart + DAY;

		const talkA = await seedStore(t, "user_a");
		const talkB = await seedStore(t, "user_b");
		const sellerClaimed = await seedStore(t, "user_c", {
			acquisitionSource: "inbound_social",
		});
		const returning = await seedStore(t, "user_d");
		for (const id of [talkA, talkB, returning])
			await admin.mutation(api.metrics.setAcquisitionSource, {
				retailerId: id,
				source: "talk_event",
			});
		await payInvoice(t, talkA, inMonth);
		await payInvoice(t, talkB, inMonth);
		await payInvoice(t, sellerClaimed, inMonth);
		// Paid before this month too — a renewal, not a NEW payer.
		await payInvoice(t, returning, addMonthsMyt(periodStart, -2));
		await payInvoice(t, returning, inMonth);

		await admin.mutation(api.metrics.recordSpend, {
			periodStart,
			entries: [{ channel: "talk_event", cashSpend: 30_000, founderHours: 10 }],
		});

		const month = await admin.query(api.metrics.getMonth, { periodStart });
		expect(month.rows.map((r) => r.channel)).toHaveLength(9);
		const talk = month.rows.find((r) => r.channel === "talk_event");
		const cost = 30_000 + 10 * FOUNDER_HOURLY_RATE_SEN;
		expect(talk).toMatchObject({ newPayers: 2, costSen: cost, cacSen: cost / 2 });
		const social = month.rows.find((r) => r.channel === "inbound_social");
		// The seller's own claim isn't counted until an admin confirms it.
		expect(social?.newPayers).toBe(0);
		expect(social?.cacSen).toBeNull();
		expect(month.untaggedNewPayers).toBe(1);
		expect(month.totals).toMatchObject({ newPayers: 2, costSen: cost });
		expect(month.recorded).toBe(true);
		expect(month.isCurrentMonth).toBe(true);
	});

	test("an empty month offers the month before's figures to start from", async () => {
		const t = setup();
		const admin = t.withIdentity({ subject: ADMIN });
		const periodStart = thisMonth();
		const previousStart = addMonthsMyt(periodStart, -1);
		await admin.mutation(api.metrics.recordSpend, {
			periodStart: previousStart,
			entries: [{ channel: "inbound_social", cashSpend: 45_000, note: "Boosts" }],
		});
		const month = await admin.query(api.metrics.getMonth, { periodStart });
		expect(month.recorded).toBe(false);
		expect(month.totals.cacSen).toBeNull();
		expect(month.previous).toEqual([
			{ channel: "inbound_social", cashSpend: 45_000, note: "Boosts" },
		]);
	});

	test("is admin-only", async () => {
		const t = setup();
		await expect(
			t
				.withIdentity({ subject: "user_seller" })
				.query(api.metrics.getMonth, { periodStart: thisMonth() }),
		).rejects.toThrow(/Not authorized/);
	});
});
