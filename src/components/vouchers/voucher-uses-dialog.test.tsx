// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { SHARED_USES_LISTED } from "../../../convex/lib/vouchers";
import {
	type UsesDialogVoucher,
	VoucherUsesDialog,
} from "./voucher-uses-dialog";

type Uses = {
	orders: Array<{ shortId: string; total: number; redeemedAt: number }>;
	limited: boolean;
};

// The adapter pair, per docs/frontend-caching.md — never `convex/react`.
const state: { uses: Uses | undefined } = { uses: undefined };
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: state.uses }),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

afterEach(cleanup);
beforeEach(() => {
	state.uses = undefined;
});

const voucher = (redeemedCount: number): UsesDialogVoucher => ({
	id: "v1" as Id<"vouchers">,
	code: "SALE20",
	currency: "MYR",
	maxRedemptions: 10_000,
	redeemedCount,
});

const order = (n: number) => ({
	shortId: `ORD-${String(n).padStart(4, "0")}`,
	total: 4000,
	redeemedAt: Date.now(),
});

/**
 * "Orders that used SALE20" (`z8r3fducfm`). The arithmetic under test is the
 * footer: count minus rows means "waiting on credits" ONLY when the server
 * listed everything; a cut-off list says it is the latest ones instead.
 */
describe("VoucherUsesDialog", () => {
	it("lists every use and says nothing more when the rows match the count", () => {
		state.uses = { orders: [order(1), order(2)], limited: false };
		render(<VoucherUsesDialog voucher={voucher(2)} onClose={vi.fn()} />);
		expect(screen.getByText("ORD-0001")).toBeTruthy();
		expect(screen.getByText("ORD-0002")).toBeTruthy();
		expect(screen.queryByText(/waiting on credits/)).toBeNull();
		expect(screen.queryByText(/Showing the latest/)).toBeNull();
	});

	it("blames credits for the gap when the server listed everything it could see", () => {
		state.uses = { orders: [order(1)], limited: false };
		render(<VoucherUsesDialog voucher={voucher(3)} onClose={vi.fn()} />);
		expect(
			screen.getByText(
				"2 more orders are waiting on credits and not shown yet.",
			),
		).toBeTruthy();
	});

	it("says it is showing the latest ones on a cut-off list, never a credits gap", () => {
		state.uses = {
			orders: Array.from({ length: SHARED_USES_LISTED }, (_, i) => order(i)),
			limited: true,
		};
		render(<VoucherUsesDialog voucher={voucher(9_500)} onClose={vi.fn()} />);
		expect(
			screen.getByText(`Showing the latest ${SHARED_USES_LISTED} orders.`),
		).toBeTruthy();
		expect(screen.queryByText(/waiting on credits/)).toBeNull();
	});

	it("says no order has used it yet on a fresh code", () => {
		state.uses = { orders: [], limited: false };
		render(<VoucherUsesDialog voucher={voucher(0)} onClose={vi.fn()} />);
		expect(screen.getByText("No orders have used this code yet.")).toBeTruthy();
	});
});
