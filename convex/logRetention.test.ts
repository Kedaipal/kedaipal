/// <reference types="vite/client" />
/**
 * Log-table retention purges (ClickUp 86eyetzt7, docs/data-retention.md):
 * outboundMessageLog → messageLogRollups rollup-then-delete, wabaHealth's
 * keep-the-newest rule, and the adminAuditLog 24-month window. Windows come
 * from convex/lib/retention.ts.
 *
 * Fake timers are installed BEFORE each convexTest instance is created (the
 * whatsapp.test.ts gotcha) so runAfter(0) self-chaining doesn't auto-fire —
 * multi-page tests drive it explicitly via t.finishAllScheduledFunctions.
 */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { DAY_MS } from "./lib/wabaLimits";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const USER = "user_retention_test";
const BUYER = "60111222333";

/** Frozen "now" — far enough into 2026 that all seeded months are stable. */
const NOW = Date.UTC(2026, 7, 17, 4, 0, 0); // 2026-08-17 12:00 MYT

// Older than the 90-day window (cutoff = 2026-05-19). Two distinct MYT months.
const APRIL = Date.UTC(2026, 3, 10); // → rollup month "2026-04"
const MAY = Date.UTC(2026, 4, 5); // → rollup month "2026-05"

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

beforeEach(() => {
	// BEFORE convexTest is created (see whatsapp.test.ts) — scheduled functions
	// must not auto-fire mid-test.
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

async function seedRetailer(
	t: ReturnType<typeof setup>,
): Promise<Id<"retailers">> {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Retention Store",
		slug: "retention-store",
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer._id;
}

type LogSeed = {
	retailerId?: Id<"retailers">;
	category: Doc<"outboundMessageLog">["category"];
	status: Doc<"outboundMessageLog">["status"];
	sentAt: number;
};

async function insertLogRows(t: ReturnType<typeof setup>, rows: LogSeed[]) {
	await t.run(async (ctx) => {
		for (const row of rows) {
			await ctx.db.insert("outboundMessageLog", {
				retailerId: row.retailerId,
				toWaPhone: BUYER,
				category: row.category,
				status: row.status,
				sentAt: row.sentAt,
			});
		}
	});
}

async function allLogRows(t: ReturnType<typeof setup>) {
	return t.run(async (ctx) =>
		ctx.db.query("outboundMessageLog").collect(),
	);
}

async function allRollups(t: ReturnType<typeof setup>) {
	return t.run(async (ctx) => ctx.db.query("messageLogRollups").collect());
}

describe("outboundMessageLog purge → messageLogRollups", () => {
	test("deletes only expired rows; rollup counts by retailer × MYT month × category × status; re-run is idempotent", async () => {
		const t = setup();
		const retailerId = await seedRetailer(t);

		await insertLogRows(t, [
			// April: 2× transactional/sent + 1× session_message/blocked_optout.
			{ retailerId, category: "transactional", status: "sent", sentAt: APRIL },
			{
				retailerId,
				category: "transactional",
				status: "sent",
				sentAt: APRIL + 60_000,
			},
			{
				retailerId,
				category: "session_message",
				status: "blocked_optout",
				sentAt: APRIL,
			},
			// May: 1× transactional/sent + 2× session_message/failed — the same
			// category/status pairs must land in a DIFFERENT month bucket.
			{ retailerId, category: "transactional", status: "sent", sentAt: MAY },
			{
				retailerId,
				category: "session_message",
				status: "failed",
				sentAt: MAY,
			},
			{
				retailerId,
				category: "session_message",
				status: "failed",
				sentAt: MAY + 60_000,
			},
			// A system reply (no retailerId) gets its own bucket.
			{ category: "session_message", status: "sent", sentAt: APRIL },
			// Fresh row — inside the window, must survive untouched.
			{ retailerId, category: "transactional", status: "sent", sentAt: NOW },
		]);

		await t.mutation(internal.wabaProtection.purgeExpiredOutboundLog, {});

		const remaining = await allLogRows(t);
		expect(remaining).toHaveLength(1);
		expect(remaining[0].sentAt).toBe(NOW);

		const rollups = await allRollups(t);
		const key = (r: (typeof rollups)[number]) =>
			`${r.retailerId ?? "system"}|${r.month}|${r.category}|${r.status}`;
		const counts = new Map(rollups.map((r) => [key(r), r.count]));
		expect(counts).toEqual(
			new Map([
				[`${retailerId}|2026-04|transactional|sent`, 2],
				[`${retailerId}|2026-04|session_message|blocked_optout`, 1],
				[`${retailerId}|2026-05|transactional|sent`, 1],
				[`${retailerId}|2026-05|session_message|failed`, 2],
				["system|2026-04|session_message|sent", 1],
			]),
		);

		// Re-running the purge is a no-op: the counted rows are already gone
		// (rollup + delete share one transaction), so nothing double-counts.
		await t.mutation(internal.wabaProtection.purgeExpiredOutboundLog, {});
		expect(await allRollups(t)).toEqual(rollups);
		expect(await allLogRows(t)).toHaveLength(1);
	});

	test("a later purge INCREMENTS an existing rollup bucket (upsert, not overwrite)", async () => {
		const t = setup();
		const retailerId = await seedRetailer(t);

		await insertLogRows(t, [
			{ retailerId, category: "transactional", status: "sent", sentAt: APRIL },
			{
				retailerId,
				category: "transactional",
				status: "sent",
				sentAt: APRIL + 1,
			},
		]);
		await t.mutation(internal.wabaProtection.purgeExpiredOutboundLog, {});

		// The same bucket expires more rows later (e.g. the next daily run).
		await insertLogRows(t, [
			{
				retailerId,
				category: "transactional",
				status: "sent",
				sentAt: APRIL + 2,
			},
		]);
		await t.mutation(internal.wabaProtection.purgeExpiredOutboundLog, {});

		const rollups = await allRollups(t);
		expect(rollups).toHaveLength(1);
		expect(rollups[0]).toMatchObject({
			retailerId,
			month: "2026-04",
			category: "transactional",
			status: "sent",
			count: 3,
		});
	});

	test("a backlog beyond one page completes via self-chaining and loses no rows", async () => {
		const t = setup();
		const retailerId = await seedRetailer(t);

		// 150 expired rows > LOG_PURGE_PAGE_SIZE (100) → the first run must
		// schedule a continuation for the remaining 50.
		await t.run(async (ctx) => {
			for (let i = 0; i < 150; i++) {
				await ctx.db.insert("outboundMessageLog", {
					retailerId,
					toWaPhone: BUYER,
					category: "transactional",
					status: "sent",
					sentAt: MAY + i,
				});
			}
		});

		await t.mutation(internal.wabaProtection.purgeExpiredOutboundLog, {});
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(await allLogRows(t)).toHaveLength(0);
		const rollups = await allRollups(t);
		expect(rollups).toHaveLength(1);
		expect(rollups[0].count).toBe(150);
	});
});

describe("wabaHealth purge — the newest row is never deleted", () => {
	async function insertHealth(
		t: ReturnType<typeof setup>,
		rows: Array<{ qualityRating: "HIGH" | "MEDIUM" | "LOW"; observedAt: number }>,
	) {
		await t.run(async (ctx) => {
			for (const row of rows) {
				await ctx.db.insert("wabaHealth", {
					qualityRating: row.qualityRating,
					messagingTier: 1000,
					observedAt: row.observedAt,
				});
			}
		});
	}

	test("keeps the newest row even when it is older than the 90-day cutoff", async () => {
		const t = setup();
		await insertHealth(t, [
			{ qualityRating: "HIGH", observedAt: NOW - 200 * DAY_MS },
			{ qualityRating: "MEDIUM", observedAt: NOW - 150 * DAY_MS },
			// Newest — 120 days old, past the window, but it IS the live state.
			{ qualityRating: "LOW", observedAt: NOW - 120 * DAY_MS },
		]);

		await t.mutation(internal.wabaProtection.purgeExpiredWabaHealth, {});

		const rows = await t.run(async (ctx) =>
			ctx.db.query("wabaHealth").collect(),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].qualityRating).toBe("LOW");

		// The retained row still governs canSend — the purge can never fail the
		// gateway open to HIGH.
		const decision = await t.mutation(internal.wabaProtection.canSend, {
			toPhone: BUYER,
			category: "session_message",
		});
		expect(decision).toEqual({ allowed: false, status: "blocked_quality" });
	});

	test("with a fresh row present, ALL expired history is purged", async () => {
		const t = setup();
		await insertHealth(t, [
			{ qualityRating: "LOW", observedAt: NOW - 200 * DAY_MS },
			{ qualityRating: "MEDIUM", observedAt: NOW - 120 * DAY_MS },
			{ qualityRating: "HIGH", observedAt: NOW - DAY_MS },
		]);

		await t.mutation(internal.wabaProtection.purgeExpiredWabaHealth, {});

		const rows = await t.run(async (ctx) =>
			ctx.db.query("wabaHealth").collect(),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].qualityRating).toBe("HIGH");
	});
});

describe("adminAuditLog purge — 24-month compliance window", () => {
	test("deletes rows past 24 months, keeps everything younger", async () => {
		const t = setup();
		const retailerId = await seedRetailer(t);

		await t.run(async (ctx) => {
			await ctx.db.insert("adminAuditLog", {
				adminUserId: "admin_1",
				retailerId,
				action: "products.create",
				ts: NOW - 760 * DAY_MS, // ~25 months — expired
			});
			await ctx.db.insert("adminAuditLog", {
				adminUserId: "admin_1",
				retailerId,
				action: "retailers.updateSettings",
				ts: NOW - 700 * DAY_MS, // ~23 months — kept
			});
			await ctx.db.insert("adminAuditLog", {
				adminUserId: "admin_2",
				retailerId,
				action: "orders.deleteOrder",
				ts: NOW - DAY_MS, // fresh — kept
			});
		});

		await t.mutation(internal.admin.purgeExpiredAdminAudit, {});

		const rows = await t.run(async (ctx) =>
			ctx.db.query("adminAuditLog").collect(),
		);
		expect(rows.map((r) => r.action).sort()).toEqual([
			"orders.deleteOrder",
			"retailers.updateSettings",
		]);
	});
});
