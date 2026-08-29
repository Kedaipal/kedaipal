// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ClaimTimerBar } from "./claim-timer-bar";

/**
 * The claim link's countdown (86eyq0epn). Two behaviours are load-bearing and
 * neither is covered by the backend suite: the clock has to keep ticking down
 * on its own, and hitting zero has to hand the page over to its expired state.
 * If the second one regresses the buyer sits on a live-looking checkout whose
 * submit the server will refuse — the worst version of this feature.
 */
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

const WINDOW_MIN = 15;

function renderBar(remainingMs: number, onExpired = vi.fn()) {
	const now = Date.now();
	render(
		<ClaimTimerBar
			expiresAt={now + remainingMs}
			windowMinutes={WINDOW_MIN}
			onExpired={onExpired}
		/>,
	);
	return onExpired;
}

describe("ClaimTimerBar", () => {
	test("renders the remaining time as m:ss and counts down", () => {
		vi.useFakeTimers();
		renderBar(14 * 60_000 + 32_000); // 14:32
		expect(screen.getByText("14:32")).toBeTruthy();

		act(() => {
			vi.advanceTimersByTime(3000);
		});
		expect(screen.getByText("14:29")).toBeTruthy();
	});

	test("calls onExpired once the deadline passes", () => {
		vi.useFakeTimers();
		const onExpired = renderBar(3000);
		expect(onExpired).not.toHaveBeenCalled();

		act(() => {
			vi.advanceTimersByTime(3500);
		});
		expect(onExpired).toHaveBeenCalled();
	});

	test("an already-expired claim hands over immediately, and never shows a negative clock", () => {
		vi.useFakeTimers();
		const onExpired = renderBar(-5000);
		expect(onExpired).toHaveBeenCalled();
		// formatCountdown floors at zero — "-1:-5" would be the giveaway bug.
		expect(screen.getByText("0:00")).toBeTruthy();
	});

	test("the progress bar tracks the fraction remaining, not the elapsed time", () => {
		vi.useFakeTimers();
		// Half of a 15-minute window left.
		renderBar((WINDOW_MIN / 2) * 60_000);
		const bar = screen.getByTestId("claim-timer-progress");
		expect(bar.style.width).toBe("50%");
	});

	test("a malformed zero window renders an empty bar, never a NaN width", () => {
		vi.useFakeTimers();
		render(
			<ClaimTimerBar
				expiresAt={Date.now() + 60_000}
				windowMinutes={0}
				onExpired={vi.fn()}
			/>,
		);
		expect(screen.getByTestId("claim-timer-progress").style.width).toBe("0%");
	});
});
