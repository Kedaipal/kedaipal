// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The profile menu (z8r3fdx34j): who you are, the Kedaipal-credits stub (2A),
 * Refer a kedai, Manage account, Sign out. Courier wallets are never here.
 */

const q = vi.hoisted(() => ({
	data: {} as Record<string, unknown>,
	canReadCredits: true,
	role: "owner" as "owner" | "member",
	signOut: vi.fn(),
	openUserProfile: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		search,
		...props
	}: Record<string, unknown> & { to?: string; search?: unknown }) => (
		<a
			href={`${to}${search ? `?${new URLSearchParams(search as Record<string, string>)}` : ""}`}
			{...props}
		/>
	),
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: (o: { fn: unknown; args: unknown }) => ({
		data:
			o.args === "skip" ? undefined : q.data[getFunctionName(o.fn as never)],
	}),
}));
vi.mock("@clerk/tanstack-react-start", () => ({
	useUser: () => ({
		user: {
			firstName: "Zaki",
			lastName: "Sapuan",
			fullName: "Zaki Sapuan",
			primaryEmailAddress: { emailAddress: "zaki@example.com" },
			imageUrl: "",
		},
	}),
	useClerk: () => ({ signOut: q.signOut, openUserProfile: q.openUserProfile }),
}));
vi.mock("../../hooks/usePermission", () => ({
	usePermission: (area: string) => ({
		canRead: area === "credits" ? q.canReadCredits : true,
		canWrite: true,
		role: q.role,
	}),
	useStoreRole: () => q.role,
}));
vi.mock("../../hooks/useCreditGate", () => ({
	useCreditGateFor: () => ({ ordersWaiting: 0, route: "topup", canAct: true }),
}));

import { ProfileMenu } from "./profile-menu";

const RETAILER = {
	_id: "r1",
	subscription: { plan: "pro", status: "active" },
	country: "MY",
} as never;

function balance(o: Record<string, unknown> = {}) {
	return {
		plan: 54,
		purchased: 0,
		total: 54,
		periodKey: "2026-10",
		periodGrant: 200,
		regime: "monthly",
		nextGrant: 200,
		refreshesAt: Date.UTC(2026, 9, 31, 16),
		nextExpiry: null,
		exhaustedAt: null,
		sellerRefundsLeft: 3,
		customGrant: false,
		ordersThisPeriod: 146,
		lockExempt: null,
		ordersWaiting: 0,
		...o,
	};
}

function openMenu() {
	render(
		<ProfileMenu
			retailer={RETAILER}
			side="right"
			align="end"
			open
			onOpenChange={() => {}}
			trigger={<button type="button">me</button>}
		/>,
	);
}

afterEach(() => {
	cleanup();
	q.data = {};
	q.canReadCredits = true;
	q.role = "owner";
	vi.clearAllMocks();
});

describe("ProfileMenu", () => {
	it("leads with the person — name, email, their role in this store", () => {
		q.data["credits:getBalance"] = balance();
		openMenu();
		expect(screen.getByText("Zaki Sapuan")).toBeTruthy();
		expect(screen.getByText("zaki@example.com")).toBeTruthy();
		expect(screen.getByText("Owner")).toBeTruthy();
	});

	it("the stub opens Billing; its one button opens the pack picker", () => {
		q.data["credits:getBalance"] = balance();
		q.data["creditPurchases:topUpOptions"] = {
			available: true,
			refusalMessage: null,
			viewOnly: null,
		};
		openMenu();
		expect(screen.getByTestId("credit-stub-headline").textContent).toBe(
			"54 orders left",
		);
		const stubLink = screen.getByRole("menuitem", {
			name: /Kedaipal credits: 54 orders left/,
		});
		expect(stubLink.getAttribute("href")).toMatch(/tab=billing$/);
		const topUp = screen.getByRole("menuitem", { name: "Top up" });
		expect(topUp.getAttribute("href")).toMatch(/topup=1/);
	});

	it("a teammate without the credits grant sees no stub — the balance is the owner's to share", () => {
		q.canReadCredits = false;
		q.role = "member";
		q.data["credits:getBalance"] = balance();
		openMenu();
		expect(screen.queryByTestId("credit-stub")).toBeNull();
		expect(screen.getByText("Team")).toBeTruthy();
	});

	it("an unmetered store still sees the stub — on us", () => {
		q.data["credits:getBalance"] = null;
		q.data["creditPurchases:topUpOptions"] = { available: true };
		openMenu();
		expect(screen.getByTestId("credit-stub").getAttribute("data-tone")).toBe(
			"onus",
		);
		expect(screen.getByText("∞ orders")).toBeTruthy();
	});

	it("Refer a kedai is offered with the reward, or greyed with why", () => {
		q.data["credits:getBalance"] = balance();
		q.data["referrals:myCard"] = {
			standing: { canRefer: true },
			offer: { pro: 60, starter: 30 },
			earns: true,
		};
		openMenu();
		const row = screen.getByTestId("refer-row");
		expect(row.textContent).toMatch(/You both get 60 credits/);
		expect(row.getAttribute("href")).toMatch(/spot=refer/);
		cleanup();

		q.data["referrals:myCard"] = {
			standing: { canRefer: false, reason: "trial" },
			offer: { pro: 60, starter: 30 },
			earns: false,
		};
		openMenu();
		const greyed = screen.getByTestId("refer-row");
		expect(greyed.getAttribute("aria-disabled")).toBe("true");
		expect(greyed.textContent).toMatch(/Once your plan is active/);
	});

	it("Manage account opens Clerk's profile; Sign out signs out", () => {
		q.data["credits:getBalance"] = balance();
		openMenu();
		fireEvent.click(screen.getByRole("menuitem", { name: "Manage account" }));
		expect(q.openUserProfile).toHaveBeenCalled();
		cleanup();
		openMenu();
		fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
		expect(q.signOut).toHaveBeenCalledWith({ redirectUrl: "/" });
	});

	it("never mentions a courier wallet", () => {
		q.data["credits:getBalance"] = balance();
		openMenu();
		expect(document.body.textContent).not.toMatch(/wallet|Lalamove|Delyva/i);
	});
});
