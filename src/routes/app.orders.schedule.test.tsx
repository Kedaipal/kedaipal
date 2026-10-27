// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleRow } from "../../convex/lib/scheduleRows";

/**
 * The Schedule page's STATE SWITCH (`z8r3fdjv0d`): which shape a store gets —
 * the Pro wall, loading, "nothing to schedule", "nothing coming up", the rows,
 * the past section, the truncation warning. Row rendering is pinned in
 * `schedule-rows.test.tsx`; this file is about the page around it.
 */

const DAY = 86_400_000;
const TODAY = Date.parse("2026-11-10T00:00:00+08:00");

const state = {
	retailer: null as Record<string, unknown> | null,
	hasDated: undefined as boolean | undefined,
	schedule: undefined as
		| { rows: ScheduleRow[]; truncated: boolean }
		| undefined,
	search: {} as Record<string, unknown>,
	/** The last `byDate` args, so a test can see the window it asked for. */
	byDateArgs: undefined as unknown,
	navigate: vi.fn(),
};

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (opts: Record<string, unknown>) => ({
		...opts,
		useSearch: () => state.search,
		useNavigate: () => state.navigate,
	}),
	Link: ({
		children,
		to,
		search,
		className,
	}: {
		children: ReactNode;
		to?: string;
		search?: unknown;
		className?: string;
	}) => (
		<a
			href={to ?? "/"}
			data-search={JSON.stringify(search ?? null)}
			className={className}
		>
			{children}
		</a>
	),
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: (opts: { __fn: FunctionReference<"query">; args: unknown }) => {
		if (opts.args === "skip") return { data: undefined };
		const name = getFunctionName(opts.__fn);
		if (name === "schedule:byDate") {
			state.byDateArgs = opts.args;
			return { data: state.schedule };
		}
		if (name === "schedule:hasDatedListings") return { data: state.hasDated };
		if (name === "bookingBlocks:hasBookingListings") return { data: false };
		return { data: undefined };
	},
}));
vi.mock("../hooks/useDashboardRetailer", () => ({
	useDashboardRetailer: () => state.retailer,
}));
vi.mock("../hooks/usePermission", () => ({
	usePermission: () => ({ canRead: true, canWrite: true }),
}));
vi.mock("../hooks/useSupportWaNumber", () => ({
	useSupportWaNumber: () => "60123456789",
}));
vi.mock("../../convex/lib/fulfilmentDate", async (orig) => ({
	...(await orig<typeof import("../../convex/lib/fulfilmentDate")>()),
	todayMytMidnight: () => TODAY,
}));

const { Route } = await import("./app.orders.schedule");
const Page = (Route as unknown as { component: () => ReactNode }).component;

const pro = {
	_id: "r1",
	slug: "dr-niki",
	subscription: { features: { orderInbox: true } },
};

function row(over: Partial<ScheduleRow> = {}): ScheduleRow {
	const r: ScheduleRow = {
		key: "",
		productId: "p_lunch",
		name: "Luncheon",
		kind: "event",
		date: TODAY + 3 * DAY,
		seats: 30,
		registered: 14,
		orders: 12,
		paid: 11,
		claimed: 0,
		unpaid: 3,
		awaitingApproval: 0,
		free: 0,
		waitingOnCredits: 0,
		...over,
	};
	return { ...r, key: `${r.date}:${r.productId}` };
}

beforeEach(() => {
	state.retailer = pro;
	state.hasDated = true;
	state.schedule = { rows: [row()], truncated: false };
	state.search = {};
	state.byDateArgs = undefined;
	state.navigate = vi.fn();
});
afterEach(cleanup);

describe("Orders → Schedule page", () => {
	it("asks for today through +90 days, and 30 days back when past is on", () => {
		render(<Page />);
		expect(state.byDateArgs).toEqual({
			retailerId: "r1",
			fromMyt: TODAY,
			toMyt: TODAY + 90 * DAY,
		});
		cleanup();
		state.search = { past: true };
		render(<Page />);
		expect(state.byDateArgs).toMatchObject({ fromMyt: TODAY - 30 * DAY });
	});

	it("says what the screen covers, horizon included", () => {
		render(<Page />);
		expect(
			screen.getByText(/Every event and booking date in the next 90 days/),
		).toBeTruthy();
	});

	it("explains Claimed only when a row has one", () => {
		render(<Page />);
		expect(screen.queryByText(/buyer says they paid/)).toBeNull();
		cleanup();
		state.schedule = {
			rows: [row({ claimed: 1, unpaid: 2 })],
			truncated: false,
		};
		render(<Page />);
		expect(screen.getByText(/buyer says they paid/)).toBeTruthy();
	});

	it("a non-Pro store gets the wall, and the schedule is never queried", () => {
		state.retailer = {
			...pro,
			subscription: { features: { orderInbox: false } },
		};
		render(<Page />);
		expect(
			screen.getByText(/Every event and booking date on one screen/),
		).toBeTruthy();
		expect(screen.getAllByText(/Upgrade to Pro/).length).toBeGreaterThan(0);
		expect(state.byDateArgs).toBeUndefined();
	});

	it("an admin acting as a Starter store sees through the wall", () => {
		state.retailer = {
			...pro,
			actingAsAdmin: true,
			subscription: { features: { orderInbox: false } },
		};
		render(<Page />);
		expect(screen.getAllByText("Luncheon").length).toBeGreaterThan(0);
	});

	it("loading shows skeletons, not an empty state", () => {
		state.schedule = undefined;
		render(<Page />);
		expect(screen.queryByText(/No dated programmes/)).toBeNull();
		expect(screen.queryByText(/Nothing scheduled/)).toBeNull();
	});

	it("a store with nothing dated is shown the doors to create one", () => {
		state.hasDated = false;
		state.schedule = { rows: [], truncated: false };
		render(<Page />);
		expect(screen.getByText("No dated programmes coming up")).toBeTruthy();
		const event = screen.getByText("Add an event").closest("a");
		expect(event?.getAttribute("data-search")).toBe(
			JSON.stringify({ card: "event" }),
		);
		expect(screen.getByText("Add a plan or package")).toBeTruthy();
		expect(screen.getByText("Add a stay or rental")).toBeTruthy();
		// Nothing dated means no past to show either.
		expect(screen.queryByRole("button", { name: /Show past/ })).toBeNull();
	});

	it("a store with listings but nothing ahead says so, and offers the past", () => {
		state.schedule = {
			rows: [row({ date: TODAY - 2 * DAY })],
			truncated: false,
		};
		render(<Page />);
		expect(
			screen.getByText("Nothing scheduled in the next 90 days"),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /Show past 30 days/ }));
		expect(state.navigate).toHaveBeenCalledWith({
			search: { past: true },
			replace: true,
		});
	});

	it("past rows sit in their own section, most recent first", () => {
		state.search = { past: true };
		state.schedule = {
			rows: [
				row({ productId: "old", name: "Older talk", date: TODAY - 9 * DAY }),
				row({
					productId: "recent",
					name: "Last week's lunch",
					date: TODAY - 2 * DAY,
				}),
				row(),
			],
			truncated: false,
		};
		render(<Page />);
		const past = screen
			.getByRole("heading", { name: "Past 30 days" })
			.closest("section");
		if (!past) throw new Error("no past section");
		const text = past.textContent ?? "";
		expect(text.indexOf("Last week's lunch")).toBeLessThan(
			text.indexOf("Older talk"),
		);
		expect(
			screen.getByRole("button", { name: /Hide past dates/ }),
		).toBeTruthy();
	});

	it("a truncated window is announced, never silently short", () => {
		state.schedule = { rows: [row()], truncated: true };
		render(<Page />);
		expect(screen.getByText(/some numbers are short/)).toBeTruthy();
	});
});
