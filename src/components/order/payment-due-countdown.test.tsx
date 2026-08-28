// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PaymentDueCountdown } from "./payment-due-countdown";

/**
 * The order page's payment countdown (86eyq0epn — the claim timer carried
 * until real money). Pins the tick, the honest time's-up switch, and the long
 * format — the states a buyer actually stares at while deciding to pay.
 */
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("PaymentDueCountdown", () => {
	test("counts down live while time remains", () => {
		vi.useFakeTimers();
		render(<PaymentDueCountdown dueAt={Date.now() + 12 * 60_000 + 41_000} />);
		expect(screen.getByText("12:41")).toBeTruthy();
		act(() => {
			vi.advanceTimersByTime(2000);
		});
		expect(screen.getByText("12:39")).toBeTruthy();
	});

	test("a long deadline reads in hours, not a sea of minutes", () => {
		vi.useFakeTimers();
		render(<PaymentDueCountdown dueAt={Date.now() + 23 * 3600_000 + 59 * 60_000} />);
		expect(screen.getByText(/23h 5[89]m/)).toBeTruthy();
	});

	test("past zero it switches to the time's-up notice — never a negative clock", () => {
		vi.useFakeTimers();
		render(<PaymentDueCountdown dueAt={Date.now() - 1000} />);
		expect(screen.getByText(/payment window has ended/i)).toBeTruthy();
		expect(screen.queryByText(/-/)).toBeNull();
	});

	test("crossing zero while mounted flips to the notice on its own", () => {
		vi.useFakeTimers();
		render(<PaymentDueCountdown dueAt={Date.now() + 1500} />);
		expect(screen.queryByText(/payment window has ended/i)).toBeNull();
		act(() => {
			vi.advanceTimersByTime(3000);
		});
		expect(screen.getByText(/payment window has ended/i)).toBeTruthy();
	});
});
