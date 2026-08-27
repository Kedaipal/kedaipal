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
		// The common case: Meta accepted it. Tests that want a Retry say so.
		lastSendOutcome: "sent" as const,
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
	// The rule Zaki set on 27 Aug: Resend is a RETRY, not a nudge. Every send
	// is billed, so a delivered link must not offer a button whose best case is
	// "the buyer sees the same message twice". Deleting the claimResendVisible
	// call in send-claim.tsx turns this test red.
	test("a delivered link offers no resend at all — Copy link is the free fix", () => {
		mockClaims([
			claim({ lastSentAt: NOW - CLAIM_RESEND_COOLDOWN_MS - 1000 }),
		]);
		render(<ClaimsPanel onResume={vi.fn()} />);
		expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
		expect(screen.getByRole("button", { name: /Copy link/ })).toBeTruthy();
	});

	// A row written before outcomes were recorded can't prove it landed, so the
	// seller keeps the retry rather than losing the only WhatsApp path.
	test("a legacy row with no recorded outcome keeps its retry", () => {
		mockClaims([
			claim({
				lastSendOutcome: undefined,
				lastSentAt: NOW - CLAIM_RESEND_COOLDOWN_MS - 1000,
			}),
		]);
		render(<ClaimsPanel onResume={vi.fn()} />);
		expect(screen.getByRole("button", { name: /^Retry$/ })).toBeTruthy();
	});

	test("during the cooldown the button is disabled and counts down", () => {
		// 1 min into a 5 min cooldown, on a send that failed (the only state
		// that offers a retry at all).
		mockClaims([
			claim({ lastSendOutcome: "failed", lastSentAt: NOW - 60_000 }),
		]);
		render(<ClaimsPanel onResume={vi.fn()} />);
		const btn = screen.getByRole("button", { name: /Retry in/ });
		expect(btn.hasAttribute("disabled")).toBe(true);
		expect(btn.textContent).toContain("4:00");
	});

	test("once the cooldown lapses the button is live", () => {
		mockClaims([
			claim({
				lastSendOutcome: "failed",
				lastSentAt: NOW - CLAIM_RESEND_COOLDOWN_MS - 1000,
			}),
		]);
		render(<ClaimsPanel onResume={vi.fn()} />);
		const btn = screen.getByRole("button", { name: "Retry" });
		expect(btn.hasAttribute("disabled")).toBe(false);
	});

	test("the hard send cap disables it with a different reason, not a countdown", () => {
		mockClaims([
			claim({
				lastSendOutcome: "failed",
				sentCount: CLAIM_MAX_SENDS,
				lastSentAt: NOW - CLAIM_RESEND_COOLDOWN_MS * 3,
			}),
		]);
		render(<ClaimsPanel onResume={vi.fn()} />);
		const btn = screen.getByRole("button", { name: /Sent 3/ });
		expect(btn.hasAttribute("disabled")).toBe(true);
		expect(screen.queryByText(/Retry in/)).toBeNull();
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
		expect(screen.getByRole("button", { name: /^Retry$/ })).toBeTruthy();
	});

	test("an expired-but-unswept claim reads Expired and offers no retry", () => {
		mockClaims([
			claim({
				lastSendOutcome: "failed",
				expiresAt: NOW - 1000,
				lastSentAt: NOW - CLAIM_RESEND_COOLDOWN_MS * 2,
			}),
		]);
		render(<ClaimsPanel onResume={vi.fn()} />);
		expect(screen.getByText("Expired")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
	});

	test("an opted-out buyer gets the remedy by name, and no retry that would fail identically", () => {
		mockClaims([
			claim({
				lastSendOutcome: "opted_out",
				lastSentAt: NOW - CLAIM_RESEND_COOLDOWN_MS - 1000,
			}),
		]);
		render(<ClaimsPanel onResume={vi.fn()} />);
		// The one thing only the BUYER can do — say it, don't bury it.
		expect(screen.getByText(/opted out/i)).toBeTruthy();
		const keyword = screen
			.getAllByText("START")
			.find((el) => el.tagName === "SPAN");
		expect(keyword).toBeTruthy();
		// A retry is guaranteed to be suppressed by our own gateway: don't show
		// a button whose only outcome is the same failure, and a charge.
		expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
		// Copy link is the path that still works.
		expect(screen.getByRole("button", { name: /Copy link/ })).toBeTruthy();
	});

	test("an unconfigured deployment says so — never 'couldn't be delivered'", () => {
		mockClaims([claim({ lastSendOutcome: "unavailable" })]);
		render(<ClaimsPanel onResume={vi.fn()} />);
		expect(screen.getByText(/isn't switched on yet/i)).toBeTruthy();
		expect(screen.queryByText(/couldn't be delivered/i)).toBeNull();
		expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
	});

	test("the open row opens its counter session — a claim has no order yet", () => {
		const onResume = vi.fn();
		mockClaims([claim({ sessionId: "sess-42" })]);
		render(<ClaimsPanel onResume={onResume} />);
		screen.getByRole("button", { name: /Open .* checkout/i }).click();
		expect(onResume).toHaveBeenCalledWith("sess-42");
	});

	test("renders nothing before a seller has ever sent one", () => {
		mockClaims([]);
		const { container } = render(<ClaimsPanel onResume={vi.fn()} />);
		expect(container.firstChild).toBeNull();
	});
});
