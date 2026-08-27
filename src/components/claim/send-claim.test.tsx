// @vitest-environment jsdom
import { useQuery } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	CLAIM_MAX_SENDS,
	CLAIM_RESEND_COOLDOWN_MS,
} from "../../../convex/lib/orderClaims";
import { ClaimsPanel } from "./send-claim";

// Reads go via `useQuery(convexQuery(api.x, args)).data` — mock the adapter
// pair, not `convex/react` (docs/frontend-caching.md, billing-tab.test.tsx).
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));
vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("../../hooks/useActAs", () => ({ useActAsRetailerId: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const NOW = 1_756_000_000_000;

/**
 * The seller's "Waiting on buyers" panel (86eyq0epn). The resend guard is the
 * piece worth pinning: Zaki asked for it explicitly so a seller can't spam a
 * buyer's WhatsApp, and the rule lives in `claimResendState` — this asserts the
 * BUTTON actually honours it, since a server refusal the UI never anticipates
 * just surfaces as a mystery error toast.
 */
function claim(overrides: Record<string, unknown> = {}) {
	return {
		claimId: "c1",
		sessionId: "s1",
		status: "open" as const,
		buyerName: "Aina Hamzah",
		waPhone: "60123456789",
		itemCount: 2,
		itemsTotal: 21600,
		currency: "MYR",
		token: "tok_abc",
		expiresAt: NOW + 12 * 60_000,
		windowMinutes: 15,
		sentCount: 1,
		lastSentAt: NOW,
		createdAt: NOW,
		...overrides,
	};
}

function mockClaims(rows: unknown[]) {
	vi.mocked(useQuery).mockReturnValue({ data: rows } as never);
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

describe("ClaimsPanel — resend guard", () => {
	test("during the cooldown the button is disabled and counts down", () => {
		mockClaims([claim({ lastSentAt: NOW - 60_000 })]); // 1 min into a 5 min cooldown
		render(<ClaimsPanel onResume={vi.fn()} />);
		const btn = screen.getByRole("button", { name: /Resend in/ });
		expect(btn.hasAttribute("disabled")).toBe(true);
		expect(btn.textContent).toContain("4:00");
	});

	test("once the cooldown lapses the button is live", () => {
		mockClaims([claim({ lastSentAt: NOW - CLAIM_RESEND_COOLDOWN_MS - 1000 })]);
		render(<ClaimsPanel onResume={vi.fn()} />);
		const btn = screen.getByRole("button", { name: "Resend" });
		expect(btn.hasAttribute("disabled")).toBe(false);
	});

	test("the hard send cap disables it with a different reason, not a countdown", () => {
		mockClaims([
			claim({
				sentCount: CLAIM_MAX_SENDS,
				lastSentAt: NOW - CLAIM_RESEND_COOLDOWN_MS * 3,
			}),
		]);
		render(<ClaimsPanel onResume={vi.fn()} />);
		const btn = screen.getByRole("button", { name: /Sent 3/ });
		expect(btn.hasAttribute("disabled")).toBe(true);
		expect(screen.queryByText(/Resend in/)).toBeNull();
	});

	test("a failed WhatsApp send surfaces the copy-link fallback", () => {
		mockClaims([
			claim({
				lastSendOutcome: "failed",
				lastSentAt: NOW - CLAIM_RESEND_COOLDOWN_MS - 1000,
			}),
		]);
		render(<ClaimsPanel onResume={vi.fn()} />);
		expect(screen.getByText(/couldn't be delivered/i)).toBeTruthy();
		// Copy link is always offered — it is the path that works when Meta won't.
		expect(screen.getByRole("button", { name: /Copy link/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /Retry WhatsApp/ })).toBeTruthy();
	});

	test("an expired-but-unswept claim reads Expired and can't be resent", () => {
		mockClaims([
			claim({ expiresAt: NOW - 1000, lastSentAt: NOW - CLAIM_RESEND_COOLDOWN_MS * 2 }),
		]);
		render(<ClaimsPanel onResume={vi.fn()} />);
		expect(screen.getByText("Expired")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Resend" }).hasAttribute("disabled"),
		).toBe(true);
	});

	test("renders nothing before a seller has ever sent one", () => {
		mockClaims([]);
		const { container } = render(<ClaimsPanel onResume={vi.fn()} />);
		expect(container.firstChild).toBeNull();
	});
});
