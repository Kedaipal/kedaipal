// @vitest-environment jsdom
// Admin → Billing's credit tiles (Kedaipal Credits T5): counts of CREDITS —
// never money — for what sellers bought and haven't used (service still
// owed) and the orders taken past zero, with each state designed: loading,
// an empty book, an owing book, and a book too big to count exactly. Beside
// them the one money tile: this month's top-up revenue (Credits T3 × T2).
import { cleanup, render, screen } from "@testing-library/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	totals: undefined as unknown,
	revenue: undefined as unknown,
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (opts: Record<string, unknown>) => opts,
	Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	// Answer by function name: the tiles read two queries.
	useQuery: (opts: { __fn: FunctionReference<"query"> }) => ({
		data: getFunctionName(opts.__fn).startsWith("creditPurchases:")
			? state.revenue
			: state.totals,
	}),
}));
vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));

const { CreditTotals } = await import("./app.admin.billing");

afterEach(() => {
	cleanup();
	state.totals = undefined;
	state.revenue = undefined;
});

const revenue = (
	byCurrency: Partial<
		Record<
			"MYR" | "SGD",
			{ amountMinor: number; purchases: number; credits: number }
		>
	> = {},
) => ({
	periodKey: "2026-10",
	byCurrency: {
		MYR: { amountMinor: 0, purchases: 0, credits: 0 },
		SGD: { amountMinor: 0, purchases: 0, credits: 0 },
		...byCurrency,
	},
});

/** One tile's text, found by its label. */
const tileText = (label: RegExp) =>
	screen.getByText(label).closest("div.rounded-2xl")?.textContent ?? "";

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
		expect(screen.getAllByText("...")).toHaveLength(3);
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
			screen.getByText("Across 4 stores — service still owed"),
		).toBeTruthy();
		expect(screen.getByText("37")).toBeTruthy();
		expect(
			screen.getByText(
				"3 stores below zero — the next grant or pack settles it",
			),
		).toBeTruthy();
		// Credits, never money: no currency on either credit tile.
		for (const label of [/Unused bought credits/, /Orders owed/])
			expect(tileText(label)).not.toMatch(/RM|S\$|MYR|SGD/);
	});

	it("top-up revenue: this month's paid packs, summed per currency — never flattened", () => {
		state.totals = totals();
		state.revenue = revenue({
			MYR: { amountMinor: 20500, purchases: 3, credits: 300 },
			SGD: { amountMinor: 2200, purchases: 1, credits: 50 },
		});
		render(<CreditTotals />);
		expect(screen.getByText("Top-ups · October")).toBeTruthy();
		const text = tileText(/Top-ups · October/);
		expect(text).toMatch(/RM\s?205\.00 \+ S\$\s?22\.00/);
		expect(text).toContain("4 packs · 350 credits");
	});

	it("a month with no packs paid says so", () => {
		state.totals = totals();
		state.revenue = revenue();
		render(<CreditTotals />);
		expect(tileText(/Top-ups · October/)).toContain(
			"No packs paid yet this month",
		);
	});

	it("an empty book reads zero in words, and a single store reads singular", () => {
		state.totals = totals({ purchasedUnused: 50, storesWithPurchased: 1 });
		render(<CreditTotals />);
		expect(
			screen.getByText("Across 1 store — service still owed"),
		).toBeTruthy();
		expect(screen.getByText("0")).toBeTruthy();
		// Never "across 0 stores".
		expect(screen.getByText("No store is below zero")).toBeTruthy();
		cleanup();
		state.totals = totals();
		render(<CreditTotals />);
		expect(screen.getByText("No store holds any yet")).toBeTruthy();
	});

	it("says so when the book is past what it can count exactly", () => {
		state.totals = totals({ accounts: 5000, truncated: true });
		render(<CreditTotals />);
		expect(screen.getByText(/first 5,000 credit accounts only/)).toBeTruthy();
	});
});
