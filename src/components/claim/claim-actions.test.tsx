// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { useCounterClosedReason } from "../../hooks/useCounterClosed";
import { ClaimRetryButton } from "./claim-actions";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../hooks/useCounterClosed", () => ({
	useCounterClosedReason: vi.fn(() => null),
}));

const NOW = 1_756_000_000_000;
// A failed send, long enough ago that the cooldown has passed — Retry is live.
const FAILED = {
	claimId: "c1" as Id<"orderClaims">,
	sentCount: 1,
	lastSentAt: NOW - 10 * 60_000,
	lastSendOutcome: "failed" as const,
};

afterEach(cleanup);

describe("ClaimRetryButton — a re-send is refused while the counter is closed", () => {
	test("open counter: Retry is live", () => {
		render(<ClaimRetryButton claim={FAILED} now={NOW} stillOpen />);
		expect(
			(screen.getByRole("button", { name: /Retry/ }) as HTMLButtonElement)
				.disabled,
		).toBe(false);
	});

	test("closed for credits: disabled, with the reason on the control", () => {
		const reason =
			"You're out of credits, so the counter can't ring up a sale.";
		vi.mocked(useCounterClosedReason).mockReturnValue(reason);
		render(<ClaimRetryButton claim={FAILED} now={NOW} stillOpen />);
		const button = screen.getByRole("button", {
			name: /Retry/,
		}) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		expect(button.title).toBe(reason);
	});
});
