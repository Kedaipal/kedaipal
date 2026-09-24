// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { SellerBookingCalendar } from "./seller-booking-calendar";

/**
 * The seller's booking calendar and store closed dates (z8r3fdhpm7): a closed
 * day reads differently from a blocked one, the day sheet says why and where
 * to change it, and — the trap — blocking a day on a package listing says it
 * stops sign-ups and offers a closed date instead.
 */

const SEP = (d: number) => Date.UTC(2026, 8, d) - 8 * 3_600_000;

const state = vi.hoisted(() => ({
	calendar: undefined as unknown,
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	keepPreviousData: (previous: unknown) => previous,
	useQuery: ({
		fn,
		args,
	}: {
		fn: Parameters<typeof getFunctionName>[0];
		args: unknown;
	}) => {
		if (args === "skip") return { data: undefined };
		switch (getFunctionName(fn)) {
			case "bookingBlocks:sellerCalendar":
				return { data: state.calendar, isPlaceholderData: false };
			case "bookingBlocks:dayBookings":
				return { data: [] };
			case "bookingBlocks:blockImpact":
				return { data: { count: 0, samples: [] } };
			case "closedDates:impact":
				return {
					data: { orders: 0, ordersCapped: false, bookings: 0, samples: [] },
				};
			default:
				return { data: undefined };
		}
	},
}));
vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: React.ReactNode }) => (
		<a href="#x">{children}</a>
	),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const raya = { startDate: SEP(20), endDate: SEP(20), label: "Hari Raya" };

function calendarWith(listing: {
	packageLength?: number;
	packageUnit?: "day" | "night" | "month";
}) {
	return {
		days: Array.from({ length: 30 }, (_, i) => ({
			date: SEP(i + 1),
			booked: 0,
			blocked: false,
			closed: i + 1 === 20,
			guests: [],
		})),
		currency: "MYR",
		blocks: [],
		closures: [raya],
		listings: [
			{
				_id: "prod_1" as Id<"products">,
				name: "Monthly membership",
				imageUrl: null,
				price: 15000,
				...listing,
			},
		],
	};
}

beforeAll(() => {
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as never;
});
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-10T04:00:00Z")); // Thu 10 Sep, MYT
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.clearAllMocks();
});

function renderCalendar() {
	render(<SellerBookingCalendar retailerId={"ret_1" as Id<"retailers">} />);
}

const cellFor = (day: number) =>
	screen.getByRole("button", { name: new RegExp(`^${day} — `) });

describe("SellerBookingCalendar — store closed dates", () => {
	it("a closed day says so, with the buyer-facing reason, and the legend names it", () => {
		state.calendar = calendarWith({ packageLength: 1, packageUnit: "month" });
		renderCalendar();
		expect(cellFor(20).getAttribute("aria-label")).toBe(
			"20 — store closed (Hari Raya), no bookings",
		);
		expect(within(cellFor(20)).getByText("Closed")).toBeTruthy();
		expect(screen.getByText("Store closed")).toBeTruthy();
	});

	it("the day sheet leads with the closure and where to change it", () => {
		state.calendar = calendarWith({ packageLength: 1, packageUnit: "month" });
		renderCalendar();
		fireEvent.click(cellFor(20));
		expect(screen.getByText("Store closed — Hari Raya")).toBeTruthy();
		expect(screen.getByText("Manage")).toBeTruthy();
	});

	it("blocking a day on a month package names the sign-ups it stops and offers a closure instead", () => {
		state.calendar = calendarWith({ packageLength: 1, packageUnit: "month" });
		renderCalendar();
		fireEvent.click(screen.getAllByRole("button", { name: /Block dates/ })[0]);
		fireEvent.click(cellFor(25));
		fireEvent.click(cellFor(25));
		expect(screen.getByText("This also stops package sign-ups.")).toBeTruthy();
		// Starts from today (10 Sep) up to the blocked day itself.
		expect(
			screen.getByText(/any start from Thu, 10 Sep 2026 to Fri, 25 Sep 2026/),
		).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: /Mark the store closed instead/ }),
		);
		// The closed-dates sheet opens with the same days, ready to save.
		expect(
			screen.getByRole("button", { name: /^Close Fri, 25 Sep 2026$/ }),
		).toBeTruthy();
	});

	it("a stay listing gets no steer — a block is the right tool there", () => {
		state.calendar = calendarWith({});
		renderCalendar();
		fireEvent.click(screen.getAllByRole("button", { name: /Block dates/ })[0]);
		fireEvent.click(cellFor(25));
		fireEvent.click(cellFor(25));
		expect(screen.queryByText("This also stops package sign-ups.")).toBeNull();
	});
});
