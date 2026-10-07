// @vitest-environment jsdom
import { useQuery } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayIssuesCard } from "./gateway-issues-card";

// Reads go via the adapter pair; the resolve write via convex/react.
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));
const mocks = vi.hoisted(() => ({
	resolve: vi.fn(async () => ({ ok: true })),
}));
vi.mock("convex/react", () => ({ useMutation: () => mocks.resolve }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const AT = Date.UTC(2026, 8, 28, 4, 0);

function mockIssues(data: unknown) {
	vi.mocked(useQuery).mockReturnValue({ data } as ReturnType<typeof useQuery>);
}

const lateOnVoid = {
	invoiceId: "inv_old",
	invoiceNumber: "INV-202609-Q5K0",
	invoiceStatus: "void" as const,
	invoiceTotal: 14900,
	currency: "MYR",
	storeName: "Bearcamp",
	slug: "bearcamp",
	kind: "late_payment" as const,
	paymentId: "reconciled:a2bca31a:3",
	amountSen: 14900,
	at: AT,
};

describe("GatewayIssuesCard — the money-to-review queue", () => {
	it("renders nothing while empty, a skeleton while loading", () => {
		mockIssues([]);
		const { container } = render(<GatewayIssuesCard />);
		expect(container.textContent).toBe("");
		cleanup();
		mockIssues(undefined);
		render(<GatewayIssuesCard />);
		expect(screen.queryByText(/Payments to review/)).toBeNull();
	});

	it("a row carries the store, the bill + its status, the money, the ref, and what to do", () => {
		mockIssues([
			lateOnVoid,
			{
				...lateOnVoid,
				invoiceId: "inv_paid",
				invoiceNumber: "INV-202609-4SBW",
				invoiceStatus: "paid" as const,
				storeName: "Sue Chef",
				slug: "sue-chef",
				paymentId: "pay_dup_1",
			},
		]);
		render(<GatewayIssuesCard />);
		expect(screen.getByText("Payments to review (2)")).toBeTruthy();
		expect(screen.getByText("Bearcamp")).toBeTruthy();
		expect(screen.getByText("void")).toBeTruthy();
		expect(screen.getAllByText(/RM.149\.00 received/)).toHaveLength(2);
		// The status decides the advice: voided bill → refund OR apply…
		expect(screen.getByText(/refund it in HitPay, or apply it/)).toBeTruthy();
		// …paid bill → a double payment, refund.
		expect(screen.getByText(/already settled — a double payment/)).toBeTruthy();
		expect(screen.getByText("reconciled:a2bca31a:3").tagName).toBe("CODE");
		expect(
			screen.getAllByRole("button", { name: "Copy the HitPay reference" }),
		).toHaveLength(2);
	});

	it("Mark resolved confirms first, sends the note, and says it moves no money", async () => {
		mockIssues([lateOnVoid]);
		render(<GatewayIssuesCard />);
		fireEvent.click(screen.getByRole("button", { name: "Mark resolved" }));
		expect(screen.getByText(/it does not move any money/)).toBeTruthy();
		fireEvent.change(screen.getByPlaceholderText(/refunded in HitPay/), {
			target: { value: "refunded 30 Sep" },
		});
		const confirmButtons = screen.getAllByRole("button", {
			name: "Mark resolved",
		});
		fireEvent.click(confirmButtons[confirmButtons.length - 1]);
		await waitFor(() =>
			expect(mocks.resolve).toHaveBeenCalledWith({
				invoiceId: "inv_old",
				note: "refunded 30 Sep",
			}),
		);
	});
});
