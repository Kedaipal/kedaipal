// @vitest-environment jsdom

import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mytMidnightFromYmd } from "../../../convex/lib/fulfilmentDate";
import { REVENUE_LEAVES } from "../../../convex/lib/orderBuckets";
import { bucketRange, RevenueTrend, scrubIndex } from "./revenue-trend";

afterEach(cleanup);

const DAY = 24 * 60 * 60 * 1000;
const D1 = mytMidnightFromYmd("2026-06-01");

// jsdom has no layout or pointer capture — give the chart a real width so the
// scrub math has something to divide by.
beforeAll(() => {
	Element.prototype.setPointerCapture = vi.fn();
	vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
		x: 0,
		y: 0,
		left: 0,
		top: 0,
		right: 300,
		bottom: 160,
		width: 300,
		height: 160,
		toJSON: () => ({}),
	} as DOMRect);
});

const TREND = [
	{ start: D1, earned: 10_000, orderCount: 2 },
	{ start: D1 + DAY, earned: 0, orderCount: 0 },
	{ start: D1 + 2 * DAY, earned: 30_000, orderCount: 5 },
];

/** Real router (the readout deep-links into /app/orders) — no mocking. */
function renderTrend(props: Partial<Parameters<typeof RevenueTrend>[0]> = {}) {
	const rootRoute = createRootRoute({
		component: () => (
			<>
				<RevenueTrend trend={TREND} bucketing="day" currency="MYR" {...props} />
				<Outlet />
			</>
		),
	});
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => null,
	});
	const ordersRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/app/orders",
		component: () => null,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute, ordersRoute]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	// biome-ignore lint/suspicious/noExplicitAny: stub tree, not the app's registered one
	render(<RouterProvider router={router as any} />);
	return router;
}

describe("scrubIndex (pure)", () => {
	it("maps an x offset to the bar under it, clamped to bounds", () => {
		expect(scrubIndex(0, 300, 3)).toBe(0);
		expect(scrubIndex(150, 300, 3)).toBe(1);
		expect(scrubIndex(299, 300, 3)).toBe(2);
		expect(scrubIndex(-10, 300, 3)).toBe(0); // clamp low
		expect(scrubIndex(999, 300, 3)).toBe(2); // clamp high
		expect(scrubIndex(150, 0, 3)).toBe(0); // degenerate width
	});
});

describe("bucketRange (pure)", () => {
	it("spans one day / one week inclusively", () => {
		expect(bucketRange(D1, "day")).toEqual({ from: D1, to: D1 + DAY - 1 });
		expect(bucketRange(D1, "week")).toEqual({
			from: D1,
			to: D1 + 7 * DAY - 1,
		});
	});
});

describe("RevenueTrend — scrub interaction", () => {
	it("shows the peak summary until a bar is selected", async () => {
		renderTrend();
		await waitFor(() => expect(screen.getByText(/Peak day/)).toBeTruthy());
		expect(screen.getByText("RM 300.00")).toBeTruthy();
	});

	it("tapping the chart selects the bar under the pointer and shows its details", async () => {
		renderTrend();
		await waitFor(() => expect(screen.getByRole("slider")).toBeTruthy());
		// x=250 of 300 → last third → index 2 (30_000 sen, 5 orders).
		fireEvent.pointerDown(screen.getByRole("slider"), { clientX: 250 });
		expect(screen.getByText(/RM\s?300\.00/)).toBeTruthy();
		expect(screen.getByText(/5 orders/)).toBeTruthy();
		// Deep link into the inbox filtered to that day.
		const link = screen.getByText("View orders").closest("a");
		const href = link?.getAttribute("href") ?? "";
		expect(href).toContain("from=");
		expect(href).toContain("to=");
		// …and to the SAME statuses the bar counted. A date range alone opened
		// a longer list than the readout promised, including cancelled orders.
		// The router JSON-encodes a repeated param, so decode before matching.
		const decoded = decodeURIComponent(href);
		for (const leaf of REVENUE_LEAVES) {
			expect(decoded).toContain(`"${leaf}"`);
		}
		expect(decoded).not.toContain('"cancelled"');
		expect(decoded).not.toContain('"pending"');
		expect(decoded).not.toContain('"booking_requested"');
	});

	it("a zero-order bucket shows details but no View-orders link", async () => {
		renderTrend();
		await waitFor(() => expect(screen.getByRole("slider")).toBeTruthy());
		fireEvent.pointerDown(screen.getByRole("slider"), { clientX: 150 }); // index 1
		expect(screen.getByText(/0 orders/)).toBeTruthy();
		expect(screen.queryByText("View orders")).toBeNull();
	});

	it("arrow keys move the selection; Escape and the X clear it", async () => {
		renderTrend();
		await waitFor(() => expect(screen.getByRole("slider")).toBeTruthy());
		const chart = screen.getByRole("slider");
		fireEvent.keyDown(chart, { key: "ArrowRight" }); // → index 0
		expect(screen.getByText(/2 orders/)).toBeTruthy();
		fireEvent.keyDown(chart, { key: "ArrowRight" }); // → index 1
		expect(screen.getByText(/0 orders/)).toBeTruthy();
		fireEvent.keyDown(chart, { key: "End" }); // → last
		expect(screen.getByText(/5 orders/)).toBeTruthy();
		fireEvent.keyDown(chart, { key: "Escape" });
		expect(screen.getByText(/Peak day/)).toBeTruthy();
		// Select again and clear via the X button.
		fireEvent.keyDown(chart, { key: "Home" });
		fireEvent.click(screen.getByLabelText("Clear selection"));
		expect(screen.getByText(/Peak day/)).toBeTruthy();
	});

	it("dragging scrubs across bars", async () => {
		renderTrend();
		await waitFor(() => expect(screen.getByRole("slider")).toBeTruthy());
		const chart = screen.getByRole("slider");
		fireEvent.pointerDown(chart, { clientX: 10 }); // index 0
		expect(screen.getByText(/2 orders/)).toBeTruthy();
		fireEvent.pointerMove(chart, { clientX: 280 }); // drag to index 2
		expect(screen.getByText(/5 orders/)).toBeTruthy();
		fireEvent.pointerUp(chart);
		// After release, moving without pressing changes nothing.
		fireEvent.pointerMove(chart, { clientX: 10 });
		expect(screen.getByText(/5 orders/)).toBeTruthy();
	});
});
