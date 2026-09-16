import { describe, expect, test } from "vitest";
import { DAY_MS, todayMytMidnight } from "./fulfilmentDate";
import {
	isMcpPeriod,
	isMcpToolName,
	MCP_GATE_COPY,
	MCP_PERIODS,
	MCP_SUPPORTED_VERSIONS,
	MCP_TOOLS,
	minutesToHhMm,
	rateLimitCopy,
	resolvePeriod,
	senToMajor,
	toolResult,
} from "./mcp";
import { monthStartMyt } from "./usagePeriod";

// A fixed "now": mid-afternoon MYT so date-boundary math is unambiguous.
const NOW = Date.UTC(2026, 8, 16, 7, 30) /* 2026-09-16 15:30 MYT */;

describe("resolvePeriod (MYT windows)", () => {
	const today = todayMytMidnight(NOW);

	test("today is the single current MYT day", () => {
		expect(resolvePeriod("today", NOW)).toEqual({
			from: today,
			toExclusive: today + DAY_MS,
		});
	});

	test("yesterday is the single previous day", () => {
		expect(resolvePeriod("yesterday", NOW)).toEqual({
			from: today - DAY_MS,
			toExclusive: today,
		});
	});

	test("rolling windows INCLUDE today (unlike Insights' closed ranges)", () => {
		const week = resolvePeriod("last_7_days", NOW);
		expect(week.toExclusive).toBe(today + DAY_MS);
		expect((week.toExclusive - week.from) / DAY_MS).toBe(7);
		const month = resolvePeriod("last_30_days", NOW);
		expect(month.toExclusive).toBe(today + DAY_MS);
		expect((month.toExclusive - month.from) / DAY_MS).toBe(30);
	});

	test("this_month runs from the MYT month start through today", () => {
		expect(resolvePeriod("this_month", NOW)).toEqual({
			from: monthStartMyt(NOW),
			toExclusive: today + DAY_MS,
		});
	});

	test("last_month is the previous whole calendar month", () => {
		const { from, toExclusive } = resolvePeriod("last_month", NOW);
		expect(toExclusive).toBe(monthStartMyt(NOW));
		// `from` is itself a month start, strictly before this month's.
		expect(monthStartMyt(from)).toBe(from);
		expect(from).toBeLessThan(toExclusive);
		// August 2026 has 31 days.
		expect((toExclusive - from) / DAY_MS).toBe(31);
	});

	test("every catalog period resolves without throwing", () => {
		for (const period of MCP_PERIODS) {
			const { from, toExclusive } = resolvePeriod(period, NOW);
			expect(from).toBeLessThan(toExclusive);
		}
	});

	test("isMcpPeriod accepts the catalog and nothing else", () => {
		expect(isMcpPeriod("last_7_days")).toBe(true);
		expect(isMcpPeriod("last_week")).toBe(false);
		expect(isMcpPeriod(7)).toBe(false);
		expect(isMcpPeriod(undefined)).toBe(false);
	});
});

describe("output formatting", () => {
	test("senToMajor converts to major units", () => {
		expect(senToMajor(12345)).toBe(123.45);
		expect(senToMajor(0)).toBe(0);
		expect(senToMajor(100)).toBe(1);
	});

	test("minutesToHhMm pads and passes undefined through as null", () => {
		expect(minutesToHhMm(0)).toBe("00:00");
		expect(minutesToHhMm(605)).toBe("10:05");
		expect(minutesToHhMm(1439)).toBe("23:59");
		expect(minutesToHhMm(undefined)).toBeNull();
	});

	test("toolResult wraps strings verbatim and objects as pretty JSON", () => {
		const plain = toolResult("hello");
		expect(plain.content[0]).toEqual({ type: "text", text: "hello" });
		expect("isError" in plain).toBe(false);
		const err = toolResult("nope", true);
		expect(err.isError).toBe(true);
		const obj = toolResult({ a: 1 });
		expect(obj.content[0]?.text).toContain('"a": 1');
	});

	test("rateLimitCopy rounds up to whole seconds and never says 0", () => {
		expect(rateLimitCopy(1500)).toContain("2 seconds");
		expect(rateLimitCopy(900)).toContain("1 second");
		expect(rateLimitCopy(0)).toContain("1 second");
	});
});

describe("tool catalog", () => {
	test("eight read-only tools with unique names", () => {
		expect(MCP_TOOLS).toHaveLength(8);
		const names = MCP_TOOLS.map((t) => t.name);
		expect(new Set(names).size).toBe(names.length);
	});

	test("every tool's input schema is a closed object", () => {
		for (const tool of MCP_TOOLS) {
			expect(tool.inputSchema.type).toBe("object");
			expect(tool.inputSchema.additionalProperties).toBe(false);
			expect(tool.description.length).toBeGreaterThan(20);
		}
	});

	test("isMcpToolName tracks the catalog", () => {
		expect(isMcpToolName("sales_summary")).toBe(true);
		expect(isMcpToolName("delete_everything")).toBe(false);
		expect(isMcpToolName(undefined)).toBe(false);
	});

	test("gate copy exists for every refusal reason and reads as a sentence", () => {
		for (const copy of Object.values(MCP_GATE_COPY)) {
			expect(copy.length).toBeGreaterThan(30);
		}
		expect(MCP_GATE_COPY.plan).toContain("Pro");
		expect(MCP_GATE_COPY.frozen).toContain("past due");
	});

	test("supported protocol versions include the advertised default", () => {
		expect(MCP_SUPPORTED_VERSIONS).toContain("2025-06-18");
	});
});
