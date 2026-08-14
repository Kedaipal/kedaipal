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
import { afterEach, describe, expect, it } from "vitest";
import { BottomNav, type BottomNavProps } from "./bottom-nav";

afterEach(cleanup);

// jsdom has no ResizeObserver (the nav publishes --app-bottomnav-h with one).
class RO {
	observe() {}
	unobserve() {}
	disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;

/**
 * Minimal real router so the nav's Links + useLocation behave exactly as in the
 * app (active states, navigation on row taps) — no mocking. The root renders
 * the nav under test; every destination is a stub route.
 */
function renderNav(props: Partial<BottomNavProps> = {}, initialPath = "/app") {
	const rootRoute = createRootRoute({
		component: () => (
			<>
				<BottomNav newOrdersCount={0} {...props} />
				<Outlet />
			</>
		),
	});
	const stub = (path: string) =>
		createRoute({
			getParentRoute: () => rootRoute,
			path,
			component: () => null,
		});
	const routeTree = rootRoute.addChildren([
		stub("/app"),
		stub("/app/orders"),
		stub("/app/checkout"),
		stub("/app/insights"),
		stub("/app/products"),
		stub("/app/customers"),
		stub("/app/poster"),
		stub("/app/settings"),
		stub("/app/admin/sellers"),
		stub("/app/admin/billing"),
		stub("/app/admin/waba"),
	]);
	const router = createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: [initialPath] }),
	});
	// biome-ignore lint/suspicious/noExplicitAny: stub tree, not the app's registered one
	render(<RouterProvider router={router as any} />);
	return router;
}

describe("BottomNav — 5-tab bar + More sheet", () => {
	it("renders the daily-loop tabs plus More (no Products/Settings tabs)", async () => {
		renderNav({ newOrdersCount: 3 });
		await waitFor(() => expect(screen.getByText("Home")).toBeTruthy());
		for (const label of ["Home", "Orders", "Counter", "Insights", "More"]) {
			expect(screen.getByText(label)).toBeTruthy();
		}
		// Management surfaces live in the sheet, not the bar.
		expect(screen.queryByText("Products")).toBeNull();
		expect(screen.queryByText("Settings")).toBeNull();
		// Orders badge carries through.
		expect(screen.getByText("3")).toBeTruthy();
	});

	it("the Orders badge lands on the New bucket it counted", async () => {
		const router = renderNav({ newOrdersCount: 2 });
		await waitFor(() => expect(screen.getByText("Orders")).toBeTruthy());
		fireEvent.click(screen.getByText("Orders"));
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/app/orders"),
		);
		expect(router.state.location.search).toEqual({ bucket: "new" });
	});

	it("with nothing new, Orders is plain navigation (no bucket filter)", async () => {
		const router = renderNav({ newOrdersCount: 0 });
		await waitFor(() => expect(screen.getByText("Orders")).toBeTruthy());
		// No badge to land on — filtering the inbox to an empty "New" list would
		// hide the orders the seller opened the tab to see.
		expect(screen.queryByText("0")).toBeNull();
		fireEvent.click(screen.getByText("Orders"));
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/app/orders"),
		);
		expect(router.state.location.search).toEqual({});
	});

	it("Orders reads active on /app/orders even while the badge carries a search filter", async () => {
		// includeSearch defaults to true in TanStack Router, so the badge's
		// `search={{bucket:"new"}}` would otherwise switch the tab OFF whenever
		// the URL isn't exactly ?bucket=new — e.g. right after tapping the badge
		// and opening an order, or after switching to the "All" chip. Active
		// state must track WHERE the seller is, not which filter is applied.
		renderNav({ newOrdersCount: 3 }, "/app/orders");
		await waitFor(() => expect(screen.getByText("Orders")).toBeTruthy());
		expect(screen.getByText("Orders").className).toContain("font-bold");
		expect(screen.getByText("Home").className).not.toContain("font-bold");
	});

	it("marks Insights with a Pro chip when the plan locks it", async () => {
		renderNav({ insightsLocked: true });
		await waitFor(() => expect(screen.getByText("Insights")).toBeTruthy());
		expect(screen.getByText("Pro")).toBeTruthy();
	});

	it("More opens the sheet with the four management rows", async () => {
		renderNav({ crmLocked: true });
		await waitFor(() => expect(screen.getByText("More")).toBeTruthy());
		fireEvent.click(screen.getByText("More"));
		await waitFor(() => expect(screen.getByText("Products")).toBeTruthy());
		for (const label of ["Products", "Customers", "Store poster", "Settings"]) {
			expect(screen.getByText(label)).toBeTruthy();
		}
		// Locked CRM is flagged on its row, never a surprise wall.
		expect(screen.getByText("Buyer history & notes")).toBeTruthy();
		expect(screen.getByText("Pro")).toBeTruthy();
	});

	it("tapping a row navigates and closes the sheet", async () => {
		const router = renderNav();
		await waitFor(() => expect(screen.getByText("More")).toBeTruthy());
		fireEvent.click(screen.getByText("More"));
		await waitFor(() => expect(screen.getByText("Products")).toBeTruthy());
		fireEvent.click(screen.getByText("Products"));
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/app/products"),
		);
		await waitFor(() => expect(screen.queryByText("Store poster")).toBeNull());
	});

	it("More reads active while on one of its child routes", async () => {
		renderNav({}, "/app/settings");
		await waitFor(() => expect(screen.getByText("More")).toBeTruthy());
		expect(screen.getByText("More").className).toContain("font-bold");
		// A primary tab is NOT falsely active there.
		expect(screen.getByText("Home").className).not.toContain("font-bold");
	});

	it("admin nav keeps the 3 admin tabs and no More (storeless admin)", async () => {
		renderNav({ adminNav: true }, "/app/admin/sellers");
		await waitFor(() => expect(screen.getByText("Sellers")).toBeTruthy());
		expect(screen.getByText("Billing")).toBeTruthy();
		expect(screen.getByText("WABA")).toBeTruthy();
		expect(screen.queryByText("More")).toBeNull();
		// Storeless admin has no seller app to return to → no "App" tab.
		expect(screen.queryByText("App")).toBeNull();
	});

	it("admin nav with a store leads with an 'App' tab back to the seller app", async () => {
		const router = renderNav(
			{ adminNav: true, hasStore: true },
			"/app/admin/sellers",
		);
		await waitFor(() => expect(screen.getByText("App")).toBeTruthy());
		expect(screen.getByText("Sellers")).toBeTruthy();
		fireEvent.click(screen.getByText("App"));
		await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
	});
});
