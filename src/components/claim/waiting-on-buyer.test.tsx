// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { WaitingOnBuyerScreen } from "./waiting-on-buyer";

const cancelClaim = vi.fn().mockResolvedValue(undefined);
const resendClaim = vi.fn().mockResolvedValue(undefined);

vi.mock("convex/react", () => ({
	useMutation: (fn: { toString: () => string }) =>
		String(fn).includes("cancel") ? cancelClaim : resendClaim,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../../convex/_generated/api", () => ({
	api: {
		orderClaims: {
			cancelClaim: "orderClaims.cancelClaim",
			resendClaim: "orderClaims.resendClaim",
		},
	},
}));

const NOW = 1_756_000_000_000;

/**
 * The read-only screen a seller lands on when they open a checkout whose claim
 * link is still out (86eyq0epn). Zaki, 27 Aug: during a live it gets hectic,
 * and the old behaviour let a seller edit — or ring up — an order the buyer
 * was already filling in. What's pinned here is that the way back to editing
 * is DELIBERATE: a confirmed release, never an incidental edit.
 */
function claim(overrides: Record<string, unknown> = {}) {
	return {
		claimId: "c1" as never,
		token: "tok_abc",
		expiresAt: NOW + 8 * 60_000,
		windowMinutes: 15,
		currency: "MYR",
		itemsTotal: 24600,
		lines: [
			{
				name: "Ribeye MS5",
				variantLabel: "500g",
				price: 10800,
				quantity: 2,
			},
			{ name: "Garlic butter", variantLabel: undefined, price: 3000, quantity: 1 },
		],
		sentCount: 1,
		lastSentAt: NOW,
		lastSendOutcome: "sent" as const,
		...overrides,
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("WaitingOnBuyerScreen", () => {
	test("shows the FROZEN cart and its locked total — what the buyer is looking at", () => {
		render(<WaitingOnBuyerScreen claim={claim()} buyerName="Aina" />);
		expect(screen.getByText(/Waiting on Aina/)).toBeTruthy();
		expect(screen.getByText("Ribeye MS5")).toBeTruthy();
		expect(screen.getByText("2 × RM 108.00")).toBeTruthy();
		expect(screen.getByText(/Locked total/)).toBeTruthy();
		expect(screen.getByText("RM 246.00")).toBeTruthy();
	});

	// A seller who can't find the Add buttons must not be left guessing.
	test("states the lock instead of just enforcing it", () => {
		render(<WaitingOnBuyerScreen claim={claim()} buyerName="Aina" />);
		expect(screen.getByText(/locked while the link is out/i)).toBeTruthy();
	});

	test("releasing the link is confirmed first, then cancels the claim", () => {
		render(<WaitingOnBuyerScreen claim={claim()} buyerName="Aina" />);
		fireEvent.click(
			screen.getByRole("button", { name: /Cancel link & edit/i }),
		);
		// Nothing has happened yet — the confirm is the deliberate step.
		expect(cancelClaim).not.toHaveBeenCalled();
		expect(screen.getByText(/offer was withdrawn/i)).toBeTruthy();

		// `release()` fires the mutation before its first await, so the call has
		// landed by the time the click handler returns.
		fireEvent.click(screen.getByRole("button", { name: "Cancel link" }));
		expect(cancelClaim).toHaveBeenCalledWith({ claimId: "c1" });
	});

	// Same rule as the panel: a delivered send has nothing to retry, and every
	// send is billed.
	test("a delivered send offers no retry; a failed one does", () => {
		const { unmount } = render(
			<WaitingOnBuyerScreen claim={claim()} buyerName="Aina" />,
		);
		expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
		unmount();

		render(
			<WaitingOnBuyerScreen
				claim={claim({
					lastSendOutcome: "failed",
					lastSentAt: NOW - 10 * 60_000,
				})}
				buyerName="Aina"
			/>,
		);
		expect(screen.getByRole("button", { name: /Retry/ })).toBeTruthy();
		expect(screen.getByText(/couldn't be delivered/i)).toBeTruthy();
	});

	test("an expired link says so and points at sending a fresh one", () => {
		render(
			<WaitingOnBuyerScreen
				claim={claim({ expiresAt: NOW - 1000 })}
				buyerName="Aina"
			/>,
		);
		expect(screen.getByText("Expired")).toBeTruthy();
		expect(screen.getByText(/send a fresh one/i)).toBeTruthy();
	});

	// The screen is reached from the claims list, where a nameless buyer is
	// possible — it must not render "Waiting on undefined".
	test("a nameless buyer degrades to a pronoun, never to undefined", () => {
		render(<WaitingOnBuyerScreen claim={claim()} buyerName={undefined} />);
		expect(screen.getByText(/Waiting on this buyer/)).toBeTruthy();
	});
});
