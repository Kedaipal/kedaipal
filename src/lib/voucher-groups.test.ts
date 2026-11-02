import { describe, expect, it } from "vitest";
import type { VoucherStatus } from "../../convex/lib/vouchers";
import {
	batchFallbackName,
	batchSummary,
	batchVoidableCount,
	type GroupableVoucher,
	groupVouchers,
} from "./voucher-groups";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-10-12T04:00:00Z");

const v = (
	id: string,
	over: Partial<GroupableVoucher> = {},
): GroupableVoucher => ({
	id,
	status: "active",
	createdAt: T0,
	...over,
});

describe("grouping", () => {
	it("leaves a singly-issued voucher on its own", () => {
		const rows = [v("a")];
		const groups = groupVouchers(rows, rows);
		expect(groups).toHaveLength(1);
		expect(groups[0].kind).toBe("single");
	});

	it("collapses a run into ONE parent carrying its children", () => {
		const rows = [
			v("a", { batchId: "b1", note: "Raya" }),
			v("b", { batchId: "b1", note: "Raya" }),
			v("c", { batchId: "b1", note: "Raya" }),
		];
		const groups = groupVouchers(rows, rows);
		expect(groups).toHaveLength(1);
		const g = groups[0];
		if (g.kind !== "batch") throw new Error("expected a batch");
		expect(g.vouchers).toHaveLength(3);
		expect(g.totalCount).toBe(3);
		expect(g.note).toBe("Raya");
	});

	it("keeps singles and batches in one newest-first list", () => {
		const rows = [
			v("new", { createdAt: T0 + 2 * DAY }),
			v("b1", { batchId: "B", createdAt: T0 + DAY }),
			v("b2", { batchId: "B", createdAt: T0 + DAY }),
			v("old", { createdAt: T0 }),
		];
		expect(groupVouchers(rows, rows).map((g) => g.key)).toEqual([
			"new",
			"B",
			"old",
		]);
	});

	it("a run holds ONE place in the list, by its oldest code", () => {
		// Children are spent and voided over days; the run must not drift up the
		// list every time one of them is touched.
		const rows = [
			v("b2", { batchId: "B", createdAt: T0 + 5 * DAY }),
			v("b1", { batchId: "B", createdAt: T0 }),
			v("mid", { createdAt: T0 + DAY }),
		];
		expect(groupVouchers(rows, rows).map((g) => g.key)).toEqual(["mid", "B"]);
	});
});

describe("the parent tells the truth under a filter", () => {
	const all = [
		v("a", { batchId: "B", status: "active" }),
		v("b", { batchId: "B", status: "redeemed" }),
		v("c", { batchId: "B", status: "voided" }),
	];

	it("counts the WHOLE run even when one child is shown", () => {
		// On the Used tab the seller sees one code. A parent that counted only
		// what passed the filter would claim the run is one code long.
		const shown = all.filter((x) => x.status === "redeemed");
		const g = groupVouchers(shown, all)[0];
		if (g.kind !== "batch") throw new Error("expected a batch");
		expect(g.vouchers).toHaveLength(1);
		expect(g.totalCount).toBe(3);
		expect(g.counts).toEqual({
			active: 1,
			redeemed: 1,
			voided: 1,
			expired: 0,
			scheduled: 0,
		});
	});

	it("drops a group whose children all failed the filter", () => {
		const shown = all.filter((x) => x.status === "expired");
		expect(groupVouchers(shown, all)).toEqual([]);
	});
});

describe("the summary line", () => {
	const counts = (over: Partial<Record<VoucherStatus, number>> = {}) => ({
		active: 0,
		redeemed: 0,
		voided: 0,
		expired: 0,
		scheduled: 0,
		...over,
	});

	it("says 'all active' instead of listing zeros", () => {
		expect(batchSummary(counts({ active: 3 }), 3)).toBe("3 codes · all active");
	});

	it("names only what has happened, active first", () => {
		expect(batchSummary(counts({ active: 1, redeemed: 1, voided: 1 }), 3)).toBe(
			"3 codes · 1 active · 1 used · 1 voided",
		);
	});

	it("handles a fully spent run", () => {
		expect(batchSummary(counts({ redeemed: 2 }), 2)).toBe("2 codes · 2 used");
	});

	it("singularises one code", () => {
		expect(batchSummary(counts({ active: 1 }), 1)).toBe("1 code · all active");
	});
});

describe("what is still voidable", () => {
	it("counts active AND expired, never redeemed", () => {
		// Mirrors the server's voidBatch, which skips only spent rows.
		expect(
			batchVoidableCount({
				active: 2,
				expired: 1,
				redeemed: 5,
				voided: 3,
				scheduled: 0,
			}),
		).toBe(3);
	});

	it("is 0 for a run with nothing left to call off", () => {
		expect(
			batchVoidableCount({
				active: 0,
				expired: 0,
				redeemed: 4,
				voided: 1,
				scheduled: 0,
			}),
		).toBe(0);
	});
});

describe("a run the seller never named", () => {
	it("is still pointable-at by size and day", () => {
		expect(batchFallbackName(20, T0)).toBe("20 vouchers · 12 Oct");
	});
});
