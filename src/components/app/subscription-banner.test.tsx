// @vitest-environment jsdom
// Credits T3 (z8r3fdf8hy), Zaki's test round (1 Oct 2026): the running-low
// banner shows at the last 20% of the month's credits and hands THIS reader
// the way to stay ahead of zero — a pack straight into the picker, the plans
// on a trial, or the meter for a teammate who can't buy. Never for a store
// that can't be locked.
import { useQuery } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import type { SubscriptionView } from "../../lib/subscription";
import { SubscriptionBanner } from "./subscription-banner";

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		search,
		hash,
		children,
		...props
	}: Record<string, unknown> & { children?: React.ReactNode }) => (
		<a
			href={`${String(to)}?${new URLSearchParams(search as Record<string, string>)}${hash ? `#${String(hash)}` : ""}`}
			{...props}
		>
			{children}
		</a>
	),
}));

const state = {
	role: "owner" as "owner" | "member",
	/** Credits write — a teammate holding it may buy packs (T2). */
	canBuy: true,
	retailer: null as unknown,
};
vi.mock("../../hooks/usePermission", () => ({
	useStoreRole: () => state.role,
	usePermission: () => ({
		canRead: true,
		canWrite: state.role === "owner" || state.canBuy,
		role: state.role,
	}),
}));
vi.mock("../../hooks/useDashboardRetailer", () => ({
	useDashboardRetailer: () => state.retailer,
}));
vi.mock("../../hooks/useSupportWaNumber", () => ({
	useSupportWaNumber: () => "60123456789",
}));

afterEach(() => {
	state.role = "owner";
	state.canBuy = true;
	state.retailer = null;
	window.sessionStorage.clear();
	cleanup();
});

const DAY = 24 * 60 * 60 * 1000;

function sub(over: Partial<SubscriptionView> = {}): SubscriptionView {
	return {
		plan: "pro",
		status: "active",
		comped: false,
		...over,
	} as SubscriptionView;
}

function storeWith({
	route = "topup",
	actingAsAdmin = false,
}: {
	route?: string;
	actingAsAdmin?: boolean;
} = {}) {
	state.retailer = {
		_id: "r_1",
		actingAsAdmin,
		creditLock: {
			locked: false,
			unlockRoute: route,
			since: null,
			ordersWaiting: 0,
		},
	};
}

/** `credits.getBalance` answers `balance`; nothing is due; not an admin. */
function reads(balance: Record<string, unknown> | null) {
	vi.mocked(useQuery).mockImplementation(((opts: {
		__fn: FunctionReference<"query">;
		args: unknown;
	}) => {
		if (opts.args === "skip") return { data: undefined };
		const name = getFunctionName(opts.__fn);
		if (name === getFunctionName(api.credits.getBalance))
			return { data: balance };
		if (name === getFunctionName(api.billing.amIAdmin)) return { data: false };
		return { data: null };
	}) as unknown as typeof useQuery);
}

function low(over: Record<string, unknown> = {}) {
	return {
		total: 40,
		plan: 40,
		purchased: 0,
		periodGrant: 200,
		periodKey: "2026-10",
		customGrant: false,
		lockExempt: null,
		...over,
	};
}

describe("SubscriptionBanner — running low (the last 20% of the month)", () => {
	it("the owner gets 'Top up credits', straight into the pack picker", () => {
		storeWith();
		reads(low());
		render(<SubscriptionBanner subscription={sub()} slug="kedai" />);
		expect(screen.getByText("Running low: 40 orders left.")).toBeTruthy();
		expect(
			screen.getByText(/bought credits carry over for 12 months/),
		).toBeTruthy();
		const cta = screen.getByRole("link", { name: "Top up credits" });
		expect(cta.getAttribute("href")).toContain("topup=1");
		expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
	});

	it("just above the line: no banner", () => {
		storeWith();
		reads(low({ total: 41, plan: 41 }));
		const { container } = render(
			<SubscriptionBanner subscription={sub()} slug="kedai" />,
		);
		expect(container.textContent).toBe("");
	});

	it("a teammate holding Credits write buys it themselves", () => {
		state.role = "member";
		state.canBuy = true;
		storeWith();
		reads(low());
		render(<SubscriptionBanner subscription={sub()} slug="kedai" />);
		expect(screen.getByRole("link", { name: "Top up credits" })).toBeTruthy();
	});

	it("a teammate who can't buy is told who adds credits — and pointed at the meter", () => {
		state.role = "member";
		state.canBuy = false;
		storeWith();
		reads(low());
		render(<SubscriptionBanner subscription={sub()} slug="kedai" />);
		expect(
			screen.getByText(/new orders wait until the owner adds credits/),
		).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Top up credits" })).toBeNull();
		expect(
			screen.getByRole("link", { name: "See credits" }).getAttribute("href"),
		).toContain("#credits");
	});

	it("an admin acting as the store never gets a buy button (billing is view-only there)", () => {
		storeWith({ actingAsAdmin: true });
		reads(low());
		render(<SubscriptionBanner subscription={sub()} slug="kedai" />);
		expect(screen.queryByRole("link", { name: "Top up credits" })).toBeNull();
		expect(screen.getByRole("link", { name: "See credits" })).toBeTruthy();
	});

	it("on the trial, the way ahead is a plan — packs top up a paid plan", () => {
		storeWith({ route: "pick_plan" });
		reads(low());
		render(
			<SubscriptionBanner
				subscription={sub({
					status: "trialing",
					trialEndsAt: Date.now() + 20 * DAY,
				})}
				slug="kedai"
			/>,
		);
		expect(
			screen.getByText(/new orders wait until you pick a plan/),
		).toBeTruthy();
		expect(screen.getByRole("link", { name: "See plans" })).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Top up credits" })).toBeNull();
	});

	it("never for a store that can't be locked, or on a custom allowance", () => {
		storeWith();
		reads(low({ lockExempt: "admin_store" }));
		const admin = render(
			<SubscriptionBanner subscription={sub()} slug="kedai" />,
		);
		expect(admin.container.textContent).toBe("");
		cleanup();
		reads(low({ customGrant: true }));
		const custom = render(
			<SubscriptionBanner subscription={sub()} slug="kedai" />,
		);
		expect(custom.container.textContent).toBe("");
	});
});
