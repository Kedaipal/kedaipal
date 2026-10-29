import { describe, expect, it } from "vitest";
import { monthStartMyt } from "../../convex/lib/usagePeriod";
import {
	changedEntries,
	draftFrom,
	formatCac,
	formatRinggit,
	monthParam,
	monthTitle,
	parseHours,
	parseMonthParam,
	parseRinggit,
	resolveMonth,
	ringgitInput,
} from "./acquisition-ledger";

// 28 Oct 2026, 10:00 MYT.
const NOW = Date.UTC(2026, 9, 28, 2);

describe("the ?month= param", () => {
	it("round-trips a MYT month start", () => {
		const sep = parseMonthParam("2026-09");
		expect(sep).toBe(monthStartMyt(Date.UTC(2026, 8, 15)));
		expect(monthParam(sep as number)).toBe("2026-09");
		expect(monthTitle(sep as number)).toBe("September 2026");
	});

	it("rejects anything that isn't YYYY-MM", () => {
		for (const bad of ["2026-13", "2026-00", "2026-9", "sept", "", undefined])
			expect(parseMonthParam(bad)).toBeUndefined();
	});

	it("falls back to the current month for a missing, malformed or future month", () => {
		const current = monthStartMyt(NOW);
		expect(resolveMonth(undefined, NOW)).toBe(current);
		expect(resolveMonth("nonsense", NOW)).toBe(current);
		expect(resolveMonth("2026-12", NOW)).toBe(current);
		expect(resolveMonth("2026-07", NOW)).toBe(parseMonthParam("2026-07"));
	});
});

describe("amount fields", () => {
	it("reads ringgit into sen; blank is zero; anything else is refused", () => {
		expect(parseRinggit("120")).toBe(12_000);
		expect(parseRinggit(" 1,200.50 ")).toBe(120_050);
		expect(parseRinggit("0.05")).toBe(5);
		expect(parseRinggit("")).toBe(0);
		for (const bad of ["-5", "12.345", "RM12", "abc"])
			expect(parseRinggit(bad)).toBeNull();
	});

	it("reads hours; blank is none; anything else is refused", () => {
		expect(parseHours("1.5")).toBe(1.5);
		expect(parseHours("  ")).toBeUndefined();
		expect(parseHours("-1")).toBeNull();
		expect(parseHours("two")).toBeNull();
	});

	it("writes sen back as an editable amount, zero as blank", () => {
		expect(ringgitInput(12_000)).toBe("120");
		expect(ringgitInput(120_050)).toBe("1200.50");
		expect(ringgitInput(0)).toBe("");
		expect(draftFrom({ cashSpend: 0, founderHours: 3, note: "DMs" })).toEqual({
			cash: "",
			hours: "3",
			note: "DMs",
		});
	});

	it("formats totals in ringgit", () => {
		expect(formatRinggit(120_000)).toBe("RM 1,200");
		expect(formatRinggit(120_050)).toBe("RM 1,200.50");
		expect(formatRinggit(0)).toBe("RM 0");
		expect(formatCac(53_667)).toBe("RM 537");
	});
});

describe("changedEntries — what a save sends", () => {
	const saved = [
		{
			channel: "walk_in" as const,
			draft: { cash: "120", hours: "", note: "" },
		},
		{
			channel: "talk_event" as const,
			draft: { cash: "", hours: "", note: "" },
		},
		{
			channel: "referral" as const,
			draft: { cash: "", hours: "2", note: "Intros" },
		},
	];

	it("sends nothing when nothing changed, even with stray whitespace", () => {
		expect(
			changedEntries(
				{ walk_in: { cash: " 120 ", hours: "", note: "" } },
				saved,
			),
		).toEqual({ entries: [], invalid: [] });
	});

	it("sends only the changed channels, parsed", () => {
		const { entries, invalid } = changedEntries(
			{
				talk_event: { cash: "300", hours: "10", note: " Booth " },
				referral: { cash: "", hours: "", note: "" },
			},
			saved,
		);
		expect(invalid).toEqual([]);
		expect(entries).toEqual([
			{
				channel: "talk_event",
				cashSpend: 30_000,
				founderHours: 10,
				note: "Booth",
			},
			// Cleared → a blank entry, which the server reads as "delete".
			{ channel: "referral", cashSpend: 0 },
		]);
	});

	it("holds back a channel whose amount isn't a number", () => {
		const { entries, invalid } = changedEntries(
			{ walk_in: { cash: "12.345", hours: "", note: "" } },
			saved,
		);
		expect(entries).toEqual([]);
		expect(invalid).toEqual(["walk_in"]);
	});
});
