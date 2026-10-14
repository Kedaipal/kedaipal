// @vitest-environment jsdom
// The dashboard shell's three answers to "can I render /app yet?": the page,
// the skeleton (still loading), or the failed-read screen. The production bug
// (ClickUp z8r3fdkqn6) was the missing third: a store read that FAILED looked
// exactly like a slow one, so every /app page sat on its skeleton forever.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { navigateSpy, setActAsSpy, signedIn, actAs, read } = vi.hoisted(() => ({
	navigateSpy: vi.fn(),
	setActAsSpy: vi.fn(),
	signedIn: { current: true },
	actAs: { current: undefined as string | undefined },
	read: {
		current: { retailer: undefined, error: null } as {
			retailer: unknown;
			error: Error | null;
		},
	},
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (opts: unknown) => opts,
	useNavigate: () => navigateSpy,
	useLocation: () => ({ pathname: "/app" }),
	Outlet: () => null,
}));
// The sign-in gate: the shell when signed in, the redirect when not.
vi.mock("@clerk/tanstack-react-start", () => ({
	Show: ({
		children,
		fallback,
	}: {
		children: ReactNode;
		fallback: ReactNode;
	}) => (signedIn.current ? children : fallback),
	RedirectToSignIn: () => <p>Redirecting to sign-in</p>,
	useClerk: () => ({ signOut: vi.fn() }),
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: undefined }),
}));
vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("../hooks/useActAs", () => ({
	ActAsProvider: ({ children }: { children: ReactNode }) => (
		<div data-testid="act-as-session">{children}</div>
	),
	useActAs: () => ({
		actAsRetailerId: actAs.current,
		pending: false,
		setActAs: setActAsSpy,
	}),
}));
vi.mock("../hooks/useDashboardRetailer", () => ({
	useDashboardRetailerRead: () => read.current,
}));
vi.mock("../hooks/useOrderToastNotifications", () => ({
	useOrderToastNotifications: () => {},
}));

import { Route } from "./app";

const AppLayout = (Route as unknown as { component: ComponentType }).component;

const skeletonShown = () => document.querySelector(".animate-pulse") !== null;

beforeEach(() => {
	signedIn.current = true;
	actAs.current = undefined;
	read.current = { retailer: undefined, error: null };
});

afterEach(() => {
	cleanup();
	navigateSpy.mockReset();
	setActAsSpy.mockReset();
});

describe("/app shell", () => {
	it("a failed store read says so and offers a way out — it is never the skeleton", () => {
		read.current = { retailer: undefined, error: new Error("Server Error") };
		render(<AppLayout />);
		expect(
			screen.getByRole("heading", { name: "Your dashboard didn't load" }),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
		expect(skeletonShown()).toBe(false);
	});

	it("a read still in flight is the skeleton", () => {
		render(<AppLayout />);
		expect(skeletonShown()).toBe(true);
		expect(screen.queryByRole("heading")).toBeNull();
	});

	it("keeps the act-as session mounted OUTSIDE the sign-in gate, so it sees a sign-out", () => {
		// Inside the gate it would unmount the instant Clerk reports the
		// sign-out, and the admin's session would outlive them in the tab.
		signedIn.current = false;
		render(<AppLayout />);
		expect(screen.getByText("Redirecting to sign-in")).toBeTruthy();
		expect(screen.getByTestId("act-as-session")).toBeTruthy();
	});

	it("an admin whose acted-as store failed exits act-as back to the directory", () => {
		actAs.current = "rt_acted_store";
		read.current = { retailer: undefined, error: new Error("Not authorized") };
		render(<AppLayout />);
		fireEvent.click(screen.getByRole("button", { name: "Exit act-as" }));
		expect(setActAsSpy).toHaveBeenCalledWith(undefined);
		expect(navigateSpy).toHaveBeenCalledWith({ to: "/app/admin/sellers" });
	});
});
