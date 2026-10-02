// @vitest-environment jsdom
// Admin → Billing's credit tiles (Kedaipal Credits T5): counts of CREDITS —
// never money — for what sellers bought and haven't used (service still
// owed) and the orders taken past zero, with each state designed: loading,
// an empty book, an owing book, and a book too big to count exactly.
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ totals: undefined as unknown }));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (opts: Record<string, unknown>) => opts,
	Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: state.totals }),
}));
vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));

const { CreditTotals } = await import("./app.admin.billing");

afterEach(() => {
	cleanup();
	state.totals = undefined;
});

const totals = (overrides: Record<string, unknown> = {}) => ({
	purchasedUnused: 0,
	storesWithPurchased: 0,
	ordersOwed: 0,
	storesOwing: 0,
	accounts: 12,
	truncated: false,
	...overrides,
});

describe("CreditTotals", () => {
	it("holds its place while loading", () => {
		render(<CreditTotals />);
		expect(screen.getAllByText("...")).toHaveLength(2);
	});

	it("counts unused bought credits and orders owed, across how many stores", () => {
		state.totals = totals({
			purchasedUnused: 1250,
			storesWithPurchased: 4,
			ordersOwed: 37,
			storesOwing: 3,
		});
		render(<CreditTotals />);
		expect(screen.getByText("1,250")).toBeTruthy();
		expect(
			screen.getByText(/across 4 stores · service still owed/),
		).toBeTruthy();
		expect(screen.getByText("37")).toBeTruthy();
		expect(
			screen.getByText(/across 3 stores · settled by the next grant or pack/),
		).toBeTruthy();
		// Credits, never money: no currency on either tile.
		expect(document.body.textContent).not.toMatch(/RM|S\$|MYR|SGD/);
	});

	it("an empty book reads zero, and a single store reads singular", () => {
		state.totals = totals({ purchasedUnused: 50, storesWithPurchased: 1 });
		render(<CreditTotals />);
		expect(screen.getByText(/across 1 store ·/)).toBeTruthy();
		expect(screen.getByText("0")).toBeTruthy();
	});

	it("says so when the book is past what it can count exactly", () => {
		state.totals = totals({ accounts: 5000, truncated: true });
		render(<CreditTotals />);
		expect(screen.getByText(/first 5,000 credit accounts only/)).toBeTruthy();
	});
});
