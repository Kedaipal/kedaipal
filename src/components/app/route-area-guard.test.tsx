// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const viewer = {
	role: "member" as "owner" | "member" | "admin",
	canRead: true,
	canWrite: false,
};
const location = { pathname: "/app/orders" };
vi.mock("../../hooks/usePermission", () => ({
	useStoreRole: () => viewer.role,
	useIsStoreOwner: () => viewer.role !== "member",
	usePermission: () => ({
		canRead: viewer.canRead,
		canWrite: viewer.canWrite,
		role: viewer.role,
	}),
}));
vi.mock("@tanstack/react-router", () => ({
	useLocation: () => location,
	Link: ({ children }: { children: React.ReactNode }) => (
		<a href="/app">{children}</a>
	),
}));

import { RouteAreaGuard } from "./route-area-guard";

afterEach(() => {
	viewer.role = "member";
	viewer.canRead = true;
	viewer.canWrite = false;
	location.pathname = "/app/orders";
	cleanup();
});

const PAGE = "the page";

function mount() {
	render(
		<RouteAreaGuard>
			<p>{PAGE}</p>
		</RouteAreaGuard>,
	);
}

describe("RouteAreaGuard", () => {
	it("lets a view-only member read the order list", () => {
		mount();
		expect(screen.getByText(PAGE)).toBeTruthy();
	});

	it("walls a member with no orders grant at all", () => {
		viewer.canRead = false;
		mount();
		expect(screen.queryByText(PAGE)).toBeNull();
		expect(screen.getByText(/don't have access to orders/i)).toBeTruthy();
	});

	// The counter TAKES an order — every control on it is a write. Guarding it
	// at READ let a typed URL walk a view-only teammate into a checkout that
	// the server would refuse at the end, and the nav already hides it at read.
	it("the counter needs EDIT, not just view", () => {
		location.pathname = "/app/checkout";
		mount();
		expect(screen.queryByText(PAGE)).toBeNull();
		expect(screen.getByText(/not add to them/i)).toBeTruthy();
		// …and it says why THIS page is different, rather than claiming they
		// can't see orders when the list right next to it opens fine.
		expect(screen.getByText(/takes new orders/i)).toBeTruthy();
	});

	it("the counter opens for a member holding edit", () => {
		location.pathname = "/app/checkout";
		viewer.canWrite = true;
		mount();
		expect(screen.getByText(PAGE)).toBeTruthy();
	});

	it("owners pass through every prefix", () => {
		viewer.role = "owner";
		viewer.canRead = false;
		viewer.canWrite = false;
		location.pathname = "/app/checkout";
		mount();
		expect(screen.getByText(PAGE)).toBeTruthy();
	});
});
