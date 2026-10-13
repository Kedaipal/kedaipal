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

/** Today's three figures — all a Starter store is ever told. */
const PULSE = {
	today: 80_000,
	earned: 80_000,
	depositsExcluded: 0,
	collected: 40_000,
	orderCount: 2,
};

function renderSection() {
	render(
		<SalesSection
			retailerId={"r1" as Id<"retailers">}
			currency="MYR"
			period="today"
			onPeriodChange={vi.fn()}
		/>,
	);
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
