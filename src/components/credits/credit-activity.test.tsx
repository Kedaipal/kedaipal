// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { usePaginatedQuery } from "convex/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatShortDate } from "../../lib/format";
import { CreditActivity } from "./credit-activity";

// Paginated reads stay on convex/react (no adapter wrapper exists).
vi.mock("convex/react", () => ({ usePaginatedQuery: vi.fn() }));

afterEach(() => {
	cleanup();
	vi.mocked(usePaginatedQuery).mockReset();
});

const RETAILER = { _id: "r_1" } as never;
const OCT_3 = Date.parse("2026-10-03T10:00:00+08:00");

function page(
	results: unknown[],
	status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted",
	loadMore = vi.fn(),
) {
	vi.mocked(usePaginatedQuery).mockReturnValue({
		results,
		status,
		loadMore,
		isLoading: status === "LoadingFirstPage" || status === "LoadingMore",
	} as unknown as ReturnType<typeof usePaginatedQuery>);
	return loadMore;
}

describe("CreditActivity", () => {
	it("loading shows placeholders, not an empty history", () => {
		page([], "LoadingFirstPage");
		render(<CreditActivity retailer={RETAILER} />);
		expect(screen.queryByText(/Nothing yet/)).toBeNull();
	});

	it("an empty history says what will appear", () => {
		page([], "Exhausted");
		render(<CreditActivity retailer={RETAILER} />);
		expect(
			screen.getByText("Nothing yet — your first order will show here."),
		).toBeTruthy();
	});

	it("each movement reads as a sentence with the balance after it", () => {
		page(
			[
				{
					_id: "l2",
					type: "debit",
					reason: "order",
					amount: -1,
					refLabel: "ORD-7K2Q",
					periodKey: "2026-10",
					planAfter: 199,
					purchasedAfter: 0,
					createdAt: OCT_3,
				},
				{
					_id: "l1",
					type: "grant",
					reason: "plan",
					amount: 200,
					periodKey: "2026-10",
					planAfter: 200,
					purchasedAfter: 0,
					createdAt: OCT_3,
				},
			],
			"Exhausted",
		);
		render(<CreditActivity retailer={RETAILER} />);
		expect(screen.getByText("Order ORD-7K2Q")).toBeTruthy();
		expect(screen.getByText("-1")).toBeTruthy();
		expect(screen.getByText("October credits from your plan")).toBeTruthy();
		expect(screen.getByText("+200")).toBeTruthy();
		expect(
			screen.getByText(`${formatShortDate(OCT_3)} · 199 orders left`),
		).toBeTruthy();
	});

	it("older rows page in on demand", () => {
		const loadMore = page(
			[
				{
					_id: "l1",
					type: "grant",
					reason: "plan",
					amount: 200,
					periodKey: "2026-10",
					planAfter: 200,
					purchasedAfter: 0,
					createdAt: OCT_3,
				},
			],
			"CanLoadMore",
		);
		render(<CreditActivity retailer={RETAILER} />);
		fireEvent.click(screen.getByRole("button", { name: "Show older" }));
		expect(loadMore).toHaveBeenCalledWith(20);
	});

	it("admin act-as reads the seller's store, not the admin's", () => {
		page([], "Exhausted");
		render(
			<CreditActivity
				retailer={{ _id: "r_seller", actingAsAdmin: true } as never}
			/>,
		);
		expect(vi.mocked(usePaginatedQuery).mock.calls[0]?.[1]).toEqual({
			retailerId: "r_seller",
		});
	});
});
