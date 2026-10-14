// @vitest-environment jsdom
/**
 * The money half of Home, and specifically what it draws when it is NOT
 * ALLOWED to read the week (z8r3fdrgzj).
 *
 * Starter is the case this file exists for. `getInsightsRange` refuses every
 * closed range on that plan, and the first version read the refusal as an
 * empty trend — so the hero drew six flat bars under "Today against the last 6
 * days" and a seller who sold RM 800 yesterday was shown a chart saying they
 * sold nothing all week (PR #358 review). Starter stores pay us, and this is
 * the one chart on the page they can see.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { todayMytMidnight } from "../../../convex/lib/fulfilmentDate";
import { SalesSection } from "./sales-section";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-05T12:00:00+08:00");

const state = {
	range: undefined as unknown,
	todayStats: undefined as unknown,
	todayPulse: undefined as unknown,
};

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: ReactNode; to?: string }) => (
		<a href={to ?? "/"}>{children}</a>
	),
}));
// The adapter pair, never `convex/react` — docs/frontend-caching.md.
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: (opts: {
		__fn: FunctionReference<"query"> | undefined;
		args: unknown;
	}) => {
		if (!opts?.__fn || opts.args === "skip") return { data: undefined };
		const name = getFunctionName(opts.__fn);
		if (name.startsWith("analytics:getInsightsRange"))
			return { data: state.range };
		if (name.startsWith("analytics:getTodayStats"))
			return { data: state.todayStats };
		if (name.startsWith("analytics:getTodayPulse"))
			return { data: state.todayPulse };
		if (name.startsWith("customers:countLapsedRegulars")) return { data: null };
		return { data: undefined };
	},
}));

/**
 * Today's three figures — all a Starter store is ever told.
 *
 * `today` is the SERVER's MYT midnight, not a money figure: the view buckets
 * today's column at that timestamp rather than reading a clock of its own. An
 * earlier fixture put sen here, which landed today's takings in a 1970 bucket
 * outside the grid and quietly added a 31st bar to a 30-day chart.
 */
const PULSE = {
	today: Date.parse("2026-10-05T00:00:00+08:00"),
	earned: 80_000,
	depositsExcluded: 0,
	collected: 40_000,
	orderCount: 2,
};

function renderSection(period: "today" | "7d" | "30d" = "today") {
	render(
		<SalesSection
			retailerId={"r1" as Id<"retailers">}
			currency="MYR"
			period={period}
			onPeriodChange={vi.fn()}
		/>,
	);
}

/** The labels the axis actually prints, in order, blanks dropped. */
function axisTicks(): string[] {
	const row = screen.getByRole("img").nextElementSibling;
	return [...(row?.querySelectorAll("span span") ?? [])]
		.map((n) => n.textContent?.trim() ?? "")
		.filter(Boolean);
}

/**
 * An ungated CLOSED-range payload covering `days` whole days ending at
 * `endingAt` — which for 7d/30d is YESTERDAY, because the view appends today's
 * live column itself. `days` is therefore one less than the bars on screen.
 */
function rangeOver(days: number, endingAt: number) {
	return {
		gated: false,
		earned: 0,
		depositsExcluded: 0,
		collected: 0,
		orderCount: 0,
		aov: 0,
		products: [],
		payments: [],
		sources: [],
		customers: [],
		customersCapped: false,
		trend: Array.from({ length: days }, (_, i) => ({
			start: endingAt - (days - 1 - i) * DAY,
			earned: 10_000,
			orderCount: 1,
		})),
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	state.range = undefined;
	state.todayStats = undefined;
	state.todayPulse = undefined;
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("a gated (Starter) store", () => {
	beforeEach(() => {
		state.range = { gated: true };
		state.todayStats = { gated: true };
		state.todayPulse = PULSE;
	});

	it("draws NO chart rather than a week of invented zeroes", () => {
		renderSection();
		// Today's money still paints — that is the part Starter pays for.
		expect(screen.getByText("RM 800")).toBeTruthy();
		// But nothing claims to know the six days before it.
		expect(screen.queryByText("Today against the last 6 days")).toBeNull();
		expect(screen.queryByRole("img")).toBeNull();
	});

	it("says nothing about what last week's same weekday earned", () => {
		renderSection();
		// The figure would have to come from the range we are refused, and
		// "you closed at RM 0.00" is a number we do not have.
		expect(screen.queryByText(/last Monday/i)).toBeNull();
		expect(screen.queryByText(/closed at/i)).toBeNull();
	});

	it("explains the gap with the Pro teaser instead of empty cards", () => {
		renderSection();
		expect(screen.getByText(/Insights/i)).toBeTruthy();
	});
});

describe("an ungated store", () => {
	it("draws the six days of context beside today", () => {
		const todayStart = todayMytMidnight();
		state.range = {
			gated: false,
			earned: 0,
			depositsExcluded: 0,
			collected: 0,
			orderCount: 0,
			aov: 0,
			products: [],
			payments: [],
			sources: [],
			customers: [],
			customersCapped: false,
			// Eight days back to yesterday, as `homeQueryPlan` asks for.
			trend: Array.from({ length: 8 }, (_, i) => ({
				start: todayStart - (8 - i) * DAY,
				earned: 10_000,
				orderCount: 1,
			})),
		};
		state.todayStats = {
			...PULSE,
			gated: false,
			products: [],
			payments: [],
			sources: [],
			customers: [],
			customersCapped: false,
		};
		state.todayPulse = PULSE;
		renderSection();
		expect(screen.getByText("Today against the last 6 days")).toBeTruthy();
		expect(screen.getByRole("img")).toBeTruthy();
	});
});

/**
 * The axis (Zaki, 14 Oct 2026).
 *
 * One label per bar works at seven and collapses at thirty: the weekday names
 * ran together as "TueWedThuFriSatSun". The weekday is also the wrong UNIT over
 * a month — "Tue" names four different days, so "Best: Thu" could not be looked
 * up — so the 30-day view prints dates on a weekly cadence instead.
 */
describe("the chart's axis", () => {
	it("labels every bar with its weekday over 7 days", () => {
		const todayStart = todayMytMidnight();
		state.range = rangeOver(6, todayStart - DAY);
		state.todayStats = {
			...PULSE,
			gated: false,
			products: [],
			payments: [],
			sources: [],
			customers: [],
			customersCapped: false,
		};
		state.todayPulse = PULSE;
		renderSection("7d");
		const ticks = axisTicks();
		expect(ticks).toHaveLength(7);
		// Weekdays, not dates — at seven bars each name fits its own column.
		expect(ticks.every((t) => /^[A-Z][a-z]{2}$/.test(t))).toBe(true);
	});

	it("thins 30 days to WEEKLY date ticks, anchored to the most recent day", () => {
		const todayStart = todayMytMidnight();
		state.range = rangeOver(29, todayStart - DAY);
		state.todayStats = {
			...PULSE,
			gated: false,
			products: [],
			payments: [],
			sources: [],
			customers: [],
			customersCapped: false,
		};
		state.todayPulse = PULSE;
		renderSection("30d");
		const ticks = axisTicks();
		// 30 bars, every 7th counted back from the last = 5 labels, not 30.
		expect(ticks).toHaveLength(5);
		// Dates, never weekdays: "Tue" appears four times in a month and names
		// no particular day.
		for (const t of ticks) expect(t).toMatch(/^\d{1,2} [A-Z][a-z]+$/);
		// The right-hand end is always labelled — the thinning eats into the old
		// end, so the most recent day is never the unlabelled one.
		const last = new Date(todayStart).toLocaleDateString("en-GB", {
			day: "numeric",
			month: "short",
			timeZone: "Asia/Kuala_Lumpur",
		});
		expect(ticks[ticks.length - 1]).toBe(last);
	});

	it("every bar carries its day and takings, so thinning loses nothing", () => {
		const todayStart = todayMytMidnight();
		state.range = rangeOver(29, todayStart - DAY);
		state.todayStats = {
			...PULSE,
			gated: false,
			products: [],
			payments: [],
			sources: [],
			customers: [],
			customersCapped: false,
		};
		state.todayPulse = PULSE;
		renderSection("30d");
		const bars = [...screen.getByRole("img").children];
		expect(bars).toHaveLength(30);
		// Including the 25 the axis does not name.
		for (const b of bars)
			expect(b.getAttribute("title")).toMatch(
				/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]+ · RM/,
			);
	});
});

/**
 * The bar row's height (Zaki, 14 Oct 2026 — found while fixing the axis).
 *
 * It shipped as `h-[84px] flex-1`. `flex-1` is `flex: 1 1 0%`, and in this
 * COLUMN that zero is a height basis — below `lg` the parent has no height to
 * grow into, so the row resolved to 1px and Home's chart rendered as a bare
 * axis with no bars at all on every phone. It only ever worked on desktop,
 * where `lg:flex-row` stretches this column against the figures beside it.
 *
 * jsdom has no layout engine, so this pins the class contract rather than the
 * measurement; the 1px → 84px difference was measured in a real browser.
 */
describe("the bar row has a height on a phone", () => {
	function renderOngated() {
		const todayStart = todayMytMidnight();
		state.range = rangeOver(6, todayStart - DAY);
		state.todayStats = {
			...PULSE,
			gated: false,
			products: [],
			payments: [],
			sources: [],
			customers: [],
			customersCapped: false,
		};
		state.todayPulse = PULSE;
		renderSection("7d");
		return screen.getByRole("img").className;
	}

	it("grows into the column only from lg, never at the base width", () => {
		const cls = renderOngated();
		expect(cls).toContain("h-[84px]");
		// The base width must not carry a zero flex-basis in a column.
		expect(cls).not.toMatch(/(^|\s)flex-1(\s|$)/);
		expect(cls).toContain("lg:flex-1");
	});

	/**
	 * The hero is never shorter than the rail beside it (Zaki, 14 Oct 2026).
	 * The rail's height depends on what it carries (unpaid only, + out of
	 * stock, + Plan ahead), and a row aligned `items-start` left the hero
	 * stopped 328px above a full rail. Measured in a real browser: with
	 * `items-stretch` + the hero `lg:flex-1` the two bottoms meet exactly, the
	 * extra height goes into the bars, and a taller hero leaves the rail's
	 * cards at their own height. Pinned as the class contract, as above.
	 */
	it("stretches the hero to the rail's height on desktop only", () => {
		renderOngated();
		const hero = screen.getByRole("img").closest("section");
		const row = hero?.parentElement?.parentElement;
		expect(hero?.className).toContain("lg:flex-1");
		// Phone stacks the hero; a base-width flex-1 would zero its height.
		expect(hero?.className).not.toMatch(/(^|\s)flex-1(\s|$)/);
		expect(row?.className).toContain("lg:items-stretch");
		expect(row?.className).not.toContain("items-start");
	});
});
