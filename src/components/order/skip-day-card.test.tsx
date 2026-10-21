// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { todayMytMidnight } from "../../../convex/lib/fulfilmentDate";
import { SkipDayCard } from "./skip-day-card";

// Stub the adapter pair (bookings.skipPlan via useQuery(convexQuery(...)))
// and convex/react's useMutation — the billing-tab harness.
const state = vi.hoisted(() => ({
	context: null as unknown,
	mutation: undefined as unknown,
}));
vi.mock("convex/react", () => ({
	useMutation: () => state.mutation ?? vi.fn(),
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: state.context }),
}));

afterEach(() => {
	cleanup();
	state.context = null;
	state.mutation = undefined;
});

const DAY_MS = 86_400_000;
const today = todayMytMidnight();
const MONDAY_TO_FRIDAY = { closedWeekdays: [0, 6], closedDates: [] };

/** A plan that started yesterday and runs another 10 days. */
function plan(extra: Record<string, unknown> = {}) {
	return {
		_id: "order1" as Id<"orders">,
		status: "confirmed",
		customer: { name: "Aisyah" },
		bookingCheckIn: today - DAY_MS,
		bookingCheckOut: today + 10 * DAY_MS,
		...extra,
	};
}

describe("SkipDayCard", () => {
	it("renders nothing when the order isn't a skippable plan", () => {
		state.context = null;
		const { container } = render(<SkipDayCard order={plan()} />);
		expect(container.innerHTML).toBe("");
	});

	it("an unskipped plan explains the feature where it's used", () => {
		state.context = MONDAY_TO_FRIDAY;
		render(<SkipDayCard order={plan()} />);
		expect(screen.getByText("Customer skips")).toBeTruthy();
		expect(
			screen.getByText(/the plan's last day moves to the next day you're open/),
		).toBeTruthy();
		const button = screen.getByRole("button", { name: /Skip a day/ });
		expect((button as HTMLButtonElement).disabled).toBe(false);
	});

	it("shows the cap, and only the LATEST skip offers Undo", () => {
		state.context = { ...MONDAY_TO_FRIDAY, maxSkips: 3 };
		render(
			<SkipDayCard
				order={plan({
					bookingSkippedDays: [today - DAY_MS, today],
					bookingCustomerSkips: [today - DAY_MS, today],
				})}
			/>,
		);
		expect(screen.getByText(/2 of 3 used/)).toBeTruthy();
		expect(screen.getAllByRole("button", { name: /Undo/ })).toHaveLength(1);
		expect(screen.getByText("Final")).toBeTruthy();
	});

	it("disables Skip a day WITH the reason at the cap", () => {
		state.context = { ...MONDAY_TO_FRIDAY, maxSkips: 1 };
		render(
			<SkipDayCard
				order={plan({
					bookingSkippedDays: [today],
					bookingCustomerSkips: [today],
				})}
			/>,
		);
		const button = screen.getByRole("button", { name: /Skip a day/ });
		expect((button as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByText(/All 1 skip on this plan are used/)).toBeTruthy();
		// Undo frees one, so it stays available at the cap.
		const undo = screen.getByRole("button", { name: /Undo/ });
		expect((undo as HTMLButtonElement).disabled).toBe(false);
	});

	it("the store-wide lock outranks the plan's own reasons", () => {
		state.context = MONDAY_TO_FRIDAY;
		render(<SkipDayCard order={plan()} lockedReason="Top up to work orders" />);
		expect(screen.getByText("Top up to work orders")).toBeTruthy();
	});

	it("the dialog previews the new last day before anything is written", () => {
		state.context = { closedWeekdays: [], closedDates: [] };
		const skip = vi.fn();
		state.mutation = skip;
		render(<SkipDayCard order={plan()} />);
		fireEvent.click(screen.getByRole("button", { name: /Skip a day/ }));
		// No closed days: the last day moves out by exactly one.
		expect(screen.getByText(/The last day moves from/)).toBeTruthy();
		expect(
			screen.getByText(/Only your latest skip can be undone/),
		).toBeTruthy();
		expect(skip).not.toHaveBeenCalled();
	});
});
