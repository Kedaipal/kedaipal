// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionView } from "../../lib/subscription";
import { PlanChangeCard } from "./plan-change-card";

// The card only writes (useMutation) — no reads, so the TanStack adapter pair
// the billing tab mocks isn't needed. Answer by function name: the generated
// `api` proxy hands back a fresh reference per access, so `===` is unreliable.
const mocks = vi.hoisted(() => ({
	changePlan: vi.fn(async () => ({ kind: "scheduled", effectiveAt: 0 })),
	cancelPlanChange: vi.fn(async () => null),
}));
vi.mock("convex/react", async () => {
	const { getFunctionName } = await import("convex/server");
	return {
		useMutation: (ref: FunctionReference<"mutation">) =>
			getFunctionName(ref).includes("cancelPlanChange")
				? mocks.cancelPlanChange
				: mocks.changePlan,
	};
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const DAY = 24 * 60 * 60 * 1000;

/** An active paid seller with 10 days left on the period they bought. */
function sub(overrides: Partial<SubscriptionView> = {}): SubscriptionView {
	return {
		plan: "starter",
		status: "active",
		billingCycle: "monthly",
		comped: false,
		currentPeriodEnd: Date.now() + 10 * DAY,
		caps: { orderCap: 100, userCap: 1, broadcastQuota: 0 },
		...overrides,
	};
}

describe("PlanChangeCard — what the seller is told before confirming", () => {
	it("offers the other tier, framed by direction", () => {
		render(<PlanChangeCard sub={sub()} currency="MYR" />);
		expect(screen.getByRole("button", { name: /Move up to Pro/ })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Move down to/ })).toBeNull();

		cleanup();
		render(<PlanChangeCard sub={sub({ plan: "pro" })} currency="MYR" />);
		expect(
			screen.getByRole("button", { name: /Move down to Starter/ }),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Move up to/ })).toBeNull();
	});

	it("an upgrade names the price AND the days that carry over", () => {
		render(<PlanChangeCard sub={sub()} currency="MYR" />);
		fireEvent.click(screen.getByRole("button", { name: /Move up to Pro/ }));
		// Full RM149 — never a prorated difference. 10 days of Starter left buys
		// 5 days of Pro, and the dialog says so before anything is confirmed.
		const copy = screen.getByText(/You'll be invoiced/);
		expect(copy.textContent).toMatch(/RM\s*149\.00/);
		expect(copy.textContent).toContain("The 5 days you've already paid for");
		expect(copy.textContent).toContain(
			"your next bill moves back by the same amount",
		);
		expect(copy.textContent).toContain(
			"Nothing you've already paid for is lost",
		);
	});

	it("says nothing about carryover when the period has already lapsed", () => {
		render(
			<PlanChangeCard
				sub={sub({ currentPeriodEnd: Date.now() - DAY })}
				currency="MYR"
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: /Move up to Pro/ }));
		const copy = screen.getByText(/You'll be invoiced/);
		expect(copy.textContent).toMatch(/RM\s*149\.00/);
		// A lapsed period carries 0 days — the copy must not promise any.
		expect(copy.textContent).not.toContain("moves back by the same amount");
	});

	it("a downgrade says WHEN it lands and exactly WHAT is lost", () => {
		const periodEnd = Date.UTC(2027, 2, 12);
		render(
			<PlanChangeCard
				sub={sub({ plan: "pro", currentPeriodEnd: periodEnd })}
				currency="MYR"
			/>,
		);
		fireEvent.click(
			screen.getByRole("button", { name: /Move down to Starter/ }),
		);
		const copy = screen.getByText(/You'll stay on Pro/);
		// Everything is kept until the date already paid through (assert the year,
		// not the day/month order — that's the runner's locale, not our copy).
		expect(copy.textContent).toMatch(
			/stay on Pro with everything you have now until .*2027/,
		);
		// The losses are named, not left for the seller to discover later.
		expect(copy.textContent).toContain("your customer database");
		expect(copy.textContent).toContain("Seller Insights");
		expect(copy.textContent).toContain("order inbox search");
		// And the data itself survives — the sentence must say so.
		expect(copy.textContent).toContain("your data stays");
		expect(copy.textContent).toContain(
			"cancel this any time before it takes effect",
		);
	});

	it("a founding member is quoted THEIR price, not list", () => {
		render(
			<PlanChangeCard sub={sub({ foundingIntent: true })} currency="MYR" />,
		);
		fireEvent.click(screen.getByRole("button", { name: /Move up to Pro/ }));
		const copy = screen.getByText(/You'll be invoiced/);
		expect(copy.textContent).toMatch(/RM\s*104\.00/);
		expect(copy.textContent).not.toMatch(/149/);
	});

	it("an SGD seller is quoted in SGD", () => {
		render(<PlanChangeCard sub={sub()} currency="SGD" />);
		fireEvent.click(screen.getByRole("button", { name: /Move up to Pro/ }));
		expect(screen.getByText(/You'll be invoiced/).textContent).toMatch(
			/S\$\s*59\.00/,
		);
	});

	it("a scheduled change replaces the offer with its status and an undo", () => {
		const effectiveAt = Date.UTC(2027, 2, 12);
		render(
			<PlanChangeCard
				sub={sub({
					plan: "pro",
					pendingPlanChange: { plan: "starter", effectiveAt },
				})}
				currency="MYR"
			/>,
		);
		expect(screen.getByText(/Moving to Starter on .*2027/)).toBeTruthy();
		expect(
			screen.getByText(/You keep Pro — every feature and limit — until then/),
		).toBeTruthy();
		// No stacking a second change on top of a scheduled one.
		expect(screen.queryByRole("button", { name: /Move down to/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /Move up to/ })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /Cancel this change/ }));
		expect(mocks.cancelPlanChange).toHaveBeenCalled();
	});

	it("an open invoice disables moving UP, and says which invoice", () => {
		render(
			<PlanChangeCard
				sub={sub()}
				currency="MYR"
				openInvoiceNumber="INV-2609-AB12"
			/>,
		);
		// The server refuses a second bill while one is open — so the control is
		// disabled with the reason, never enabled-then-erroring on confirm.
		const up = screen.getByRole("button", { name: /Move up to Pro/ });
		expect((up as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByText(/Moving up waits until invoice/)).toBeTruthy();
		expect(screen.getByText("INV-2609-AB12")).toBeTruthy();
	});

	it("an open invoice does NOT block moving down — it costs nothing", () => {
		render(
			<PlanChangeCard
				sub={sub({ plan: "pro" })}
				currency="MYR"
				openInvoiceNumber="INV-2609-AB12"
			/>,
		);
		const down = screen.getByRole("button", { name: /Move down to Starter/ });
		expect((down as HTMLButtonElement).disabled).toBe(false);
		// And no upgrade option exists to explain away.
		expect(screen.queryByText(/Moving up waits until invoice/)).toBeNull();
	});

	it("confirming sends the chosen plan to the server", () => {
		render(<PlanChangeCard sub={sub()} currency="MYR" />);
		fireEvent.click(screen.getByRole("button", { name: /Move up to Pro/ }));
		fireEvent.click(screen.getByRole("button", { name: /^Move to Pro$/ }));
		expect(mocks.changePlan).toHaveBeenCalledWith({ plan: "pro" });
	});
});
