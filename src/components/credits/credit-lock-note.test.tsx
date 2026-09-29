// @vitest-environment jsdom
import { useQuery } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreditLockNote } from "./credit-lock-note";

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
// The only read on this path is the cached "am I a Kedaipal admin?" check.
vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(() => ({ data: false })),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		search,
		children,
		...props
	}: Record<string, unknown> & { children?: React.ReactNode }) => (
		<a
			href={`${String(to)}?${new URLSearchParams(search as Record<string, string>)}`}
			{...props}
		>
			{children}
		</a>
	),
}));
const state = {
	role: "owner" as "owner" | "member",
	retailer: null as unknown,
};
vi.mock("../../hooks/usePermission", () => ({
	useStoreRole: () => state.role,
	usePermission: () => ({ canRead: true, canWrite: true, role: state.role }),
}));
vi.mock("../../hooks/useDashboardRetailer", () => ({
	useDashboardRetailer: () => state.retailer,
}));

afterEach(() => {
	state.role = "owner";
	state.retailer = null;
	vi.mocked(useQuery).mockImplementation((() => ({
		data: false,
	})) as unknown as typeof useQuery);
	cleanup();
});

function store({
	locked,
	route = "topup",
	waiting = 0,
	status = "active",
}: {
	locked: boolean;
	route?: string;
	waiting?: number;
	status?: string;
}) {
	return {
		_id: "r_1",
		subscription: { plan: "pro", status, comped: false },
		creditLock: {
			locked,
			unlockRoute: route,
			since: locked ? Date.now() : null,
			ordersWaiting: waiting,
		},
	};
}

describe("CreditLockNote", () => {
	it("renders nothing while the store has credits", () => {
		state.retailer = store({ locked: false });
		const { container } = render(<CreditLockNote scope="orders" />);
		expect(container.textContent).toBe("");
	});

	it("out of credits: how many orders are waiting, what's paused, what still works, the one way back", () => {
		state.retailer = store({ locked: true, waiting: 3 });
		render(<CreditLockNote scope="orders" />);
		expect(
			screen.getByText("Out of credits · 3 new orders since you ran out"),
		).toBeTruthy();
		expect(
			screen.getByText(
				/Accepting and updating orders is paused until you add credits\. Cancelling and refunding still work\./,
			),
		).toBeTruthy();
		const cta = screen.getByRole("link", { name: "Top up" });
		expect(cta.getAttribute("href")).toContain("topup=1");
	});

	it("the product surfaces say what they pause", () => {
		state.retailer = store({ locked: true });
		render(<CreditLockNote scope="products" />);
		expect(
			screen.getByText(
				/Adding and editing products is paused until you add credits\./,
			),
		).toBeTruthy();
	});

	it("a trial that used its orders is sent to pick a plan, not a top-up", () => {
		state.retailer = store({
			locked: true,
			route: "pick_plan",
			status: "trialing",
		});
		render(<CreditLockNote scope="orders" />);
		expect(screen.getByRole("link", { name: "Pick a plan" })).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Top up" })).toBeNull();
	});

	it("a teammate is told who to ask, with no button that isn't theirs", () => {
		state.role = "member";
		state.retailer = store({ locked: true });
		render(<CreditLockNote scope="orders" />);
		expect(
			screen.getByText(/Ask the store owner to add credits\./),
		).toBeTruthy();
		expect(screen.queryByRole("link")).toBeNull();
	});

	it("stands down while the whole store is view-only — that note says more", () => {
		state.retailer = store({ locked: true, status: "past_due" });
		const { container } = render(<CreditLockNote scope="orders" />);
		expect(container.textContent).toBe("");
	});

	it("never shows for a Kedaipal admin", () => {
		vi.mocked(useQuery).mockImplementation((() => ({
			data: true,
		})) as unknown as typeof useQuery);
		state.retailer = store({ locked: true });
		const { container } = render(<CreditLockNote scope="orders" />);
		expect(container.textContent).toBe("");
	});
});
