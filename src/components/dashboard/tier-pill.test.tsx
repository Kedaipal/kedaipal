// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionView } from "../../lib/subscription";
import { TierPill } from "./tier-pill";

// TanStack Router's <Link> needs a router context; stub it as a plain anchor so
// we can assert the label content + destination in isolation.
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		search,
		className,
	}: {
		children: ReactNode;
		to?: string;
		search?: { tab?: string };
		className?: string;
	}) => (
		<a
			href={search?.tab ? `${to}?tab=${search.tab}` : to}
			className={className}
			data-testid="tier-link"
		>
			{children}
		</a>
	),
}));

afterEach(cleanup);

function sub(overrides: Partial<SubscriptionView> = {}): SubscriptionView {
	return { plan: "pro", status: "active", ...overrides };
}

describe("TierPill", () => {
	it("shows a single tier pill for a normal seller, linked to billing", () => {
		render(<TierPill subscription={sub({ plan: "pro" })} />);
		expect(screen.getByText("Pro")).toBeTruthy();
		expect(screen.queryByText(/Founding/)).toBeNull();
		expect(screen.getByTestId("tier-link").getAttribute("href")).toBe(
			"/app/settings?tab=billing",
		);
	});

	it("shows BOTH the founding badge and the tier pill for a founding member", () => {
		render(<TierPill subscription={sub({ plan: "pro" })} foundingRank={3} />);
		// Founding status chip + neutral tier chip, side by side.
		expect(screen.getByText("Founding #3")).toBeTruthy();
		expect(screen.getByText("Pro")).toBeTruthy();
		// One link wrapping both chips → billing.
		expect(screen.getByTestId("tier-link").getAttribute("href")).toBe(
			"/app/settings?tab=billing",
		);
	});

	it("keeps the tier visible for a founding member mid-trial", () => {
		const trialEndsAt = Date.now() + 5 * 24 * 60 * 60 * 1000;
		render(
			<TierPill
				subscription={sub({ status: "trialing", trialEndsAt })}
				foundingRank={7}
				compact
			/>,
		);
		expect(screen.getByText(/Founding #7/)).toBeTruthy();
		expect(screen.getByText("Pro")).toBeTruthy();
	});

	it("shows only the Admin pill (→ console) for an admin's own store", () => {
		render(<TierPill subscription={sub()} admin foundingRank={2} />);
		expect(screen.getByText("Admin")).toBeTruthy();
		// Admin outranks founding — no founding/tier chips.
		expect(screen.queryByText(/Founding/)).toBeNull();
		expect(screen.getByTestId("tier-link").getAttribute("href")).toBe(
			"/app/admin/sellers",
		);
	});
});
