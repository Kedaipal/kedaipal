// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	type ClosedDateRange,
	MAX_CLOSED_RANGES,
} from "../../../convex/lib/closedDates";
import { DAY_MS, todayMytMidnight } from "../../../convex/lib/fulfilmentDate";
import { AddClosedDatesSheet, ClosedDatesCard } from "./closed-dates-card";

const state = vi.hoisted(() => ({
	add: vi.fn(),
	remove: vi.fn(),
	impact: undefined as unknown,
	toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("convex/react", () => ({
	useMutation: (fn: Parameters<typeof getFunctionName>[0]) =>
		getFunctionName(fn) === "closedDates:add" ? state.add : state.remove,
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: ({ args }: { args: unknown }) => ({
		data: args === "skip" ? undefined : state.impact,
	}),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: React.ReactNode }) => (
		<a href="#x">{children}</a>
	),
}));
vi.mock("sonner", () => ({ toast: state.toast }));

const RETAILER = "ret_1" as Id<"retailers">;
const today = todayMytMidnight(Date.now());
const raya: ClosedDateRange = {
	startDate: today + 7 * DAY_MS,
	endDate: today + 9 * DAY_MS,
	label: "Hari Raya",
};

beforeEach(() => {
	state.add.mockResolvedValue(raya);
	state.remove.mockResolvedValue(null);
	state.impact = { orders: 0, ordersCapped: false, bookings: 0, samples: [] };
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("ClosedDatesCard", () => {
	it("empty: says what the card is for, and offers the add", () => {
		render(<ClosedDatesCard retailerId={RETAILER} closedDates={undefined} />);
		expect(screen.getByText("No closed dates")).toBeTruthy();
		expect(screen.getByText(/Closing for Raya or a break\?/)).toBeTruthy();
		expect(
			(
				screen.getByRole("button", {
					name: /Add closed dates/,
				}) as HTMLButtonElement
			).disabled,
		).toBe(false);
	});

	it("lists upcoming closures with the reason and length, never the ended ones", () => {
		render(
			<ClosedDatesCard
				retailerId={RETAILER}
				closedDates={[
					raya,
					{ startDate: today - 5 * DAY_MS, endDate: today - DAY_MS },
					{ startDate: today, endDate: today },
				]}
			/>,
		);
		expect(screen.getByText("Hari Raya · 3 days")).toBeTruthy();
		// The running one is marked, and its missing reason is stated plainly.
		expect(screen.getByText("Closed now")).toBeTruthy();
		expect(screen.getByText("No reason shown to buyers · 1 day")).toBeTruthy();
		expect(screen.getAllByRole("button", { name: "Reopen" })).toHaveLength(2);
	});

	it("Reopen removes that exact range and offers an Undo that puts it back", async () => {
		render(<ClosedDatesCard retailerId={RETAILER} closedDates={[raya]} />);
		fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
		await waitFor(() =>
			expect(state.remove).toHaveBeenCalledWith({
				retailerId: RETAILER,
				startDate: raya.startDate,
				endDate: raya.endDate,
			}),
		);
		const [message, opts] = state.toast.success.mock.calls[0];
		expect(message).toMatch(/^Reopened /);
		opts.action.onClick();
		expect(state.add).toHaveBeenCalledWith({ retailerId: RETAILER, ...raya });
	});

	it("an Undo of a closure already running reopens it from today, the add rule", async () => {
		const running = {
			startDate: today - 2 * DAY_MS,
			endDate: today + DAY_MS,
			label: "Renovation",
		};
		render(<ClosedDatesCard retailerId={RETAILER} closedDates={[running]} />);
		fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
		await waitFor(() => expect(state.toast.success).toHaveBeenCalled());
		state.toast.success.mock.calls[0][1].action.onClick();
		expect(state.add).toHaveBeenCalledWith({
			retailerId: RETAILER,
			startDate: today,
			endDate: running.endDate,
			label: "Renovation",
		});
	});

	it("at the cap, Add is disabled with the reason beside it", () => {
		const full = Array.from({ length: MAX_CLOSED_RANGES }, (_, i) => ({
			startDate: today + (i + 1) * DAY_MS,
			endDate: today + (i + 1) * DAY_MS,
		}));
		render(<ClosedDatesCard retailerId={RETAILER} closedDates={full} />);
		expect(
			(
				screen.getByRole("button", {
					name: /Add closed dates/,
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		expect(screen.getByText(/reopen one you no longer need/)).toBeTruthy();
	});
});

describe("AddClosedDatesSheet", () => {
	function renderSheet(initialRange?: { startDate: number; endDate: number }) {
		render(
			<AddClosedDatesSheet
				retailerId={RETAILER}
				open
				onOpenChange={() => {}}
				existing={[raya]}
				initialRange={initialRange}
			/>,
		);
	}

	it("the CTA is disabled with the reason until days are picked", () => {
		renderSheet();
		const cta = screen.getByRole("button", { name: "Pick the dates to close" });
		expect((cta as HTMLButtonElement).disabled).toBe(true);
	});

	it("the CTA carries its consequence, and the save sends the range + trimmed reason", async () => {
		renderSheet({ startDate: raya.startDate, endDate: raya.endDate });
		fireEvent.change(screen.getByPlaceholderText("e.g. Hari Raya"), {
			target: { value: "  Hari Raya  " },
		});
		fireEvent.click(screen.getByRole("button", { name: "Close 3 days" }));
		await waitFor(() =>
			expect(state.add).toHaveBeenCalledWith({
				retailerId: RETAILER,
				startDate: raya.startDate,
				endDate: raya.endDate,
				label: "Hari Raya",
			}),
		);
	});

	it("states what's already on the dates before saving — nothing is moved", () => {
		state.impact = {
			orders: 2,
			ordersCapped: false,
			bookings: 1,
			samples: [
				{ shortId: "ORD-AB12", customerName: "Ali", kind: "order" },
				{ shortId: "ORD-CD34", kind: "booking" },
			],
		};
		renderSheet({ startDate: raya.startDate, endDate: raya.endDate });
		expect(
			screen.getByText(
				"2 orders are due, and 1 booking runs through them on these dates.",
			),
		).toBeTruthy();
		expect(screen.getByText(/They stay exactly as they are/)).toBeTruthy();
		expect(screen.getByText("ORD-AB12 · Ali")).toBeTruthy();
		// It overlaps the existing Raya closure — said, and allowed.
		expect(
			screen.getByText(/Overlaps a closure you already have/),
		).toBeTruthy();
	});

	it("an empty impact reassures instead of staying silent", () => {
		renderSheet({
			startDate: raya.startDate + 10 * DAY_MS,
			endDate: raya.startDate + 10 * DAY_MS,
		});
		expect(
			screen.getByText(/Nothing is due or booked on these dates/),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: /^Close .*20\d\d$/ }),
		).toBeTruthy();
	});
});
