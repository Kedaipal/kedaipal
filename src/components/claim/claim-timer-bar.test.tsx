// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ClaimTimerBar } from "./claim-timer-bar";

/**
 * The claim link's countdown (86eyq0epn), now the house scissors strip
 * (z8r3fdr60v). Three behaviours are load-bearing and none is covered by the
 * backend suite: the clock has to keep ticking down on its own, hitting zero
 * has to hand the page over to its expired state, and the CUT has to track
 * time elapsed — if the second one regresses the buyer sits on a live-looking
 * checkout whose submit the server will refuse, the worst version of this
 * feature.
 *
 * The strip prints the countdown three times — once crisp on the sealed paper
 * (`countdown-print`, the layer screen readers get) and twice as the split
 * ghost in the cut's wake — so assertions scope to the crisp layer rather than
 * matching text globally.
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

/** The crisp print on the still-sealed half of the paper. */
function print() {
	return within(screen.getByTestId("countdown-print"));
}

describe("ClaimTimerBar", () => {
	test("renders the remaining time as m:ss and counts down", () => {
		vi.useFakeTimers();
		renderBar(14 * 60_000 + 32_000); // 14:32
		expect(print().getByText("14:32")).toBeTruthy();

		act(() => {
			vi.advanceTimersByTime(3000);
		});
		expect(print().getByText("14:29")).toBeTruthy();
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
		// Cut clean through: no sealed paper left to print on, only the ghost.
		expect(screen.queryByTestId("countdown-print")).toBeNull();
		// formatCountdown floors at zero — "-1:-5" would be the giveaway bug.
		expect(screen.getAllByText("0:00").length).toBeGreaterThan(0);
	});

	test("the cut tracks time ELAPSED, so the sealed paper is the time remaining", () => {
		vi.useFakeTimers();
		// Half of a 15-minute window left → half the strip cut away.
		renderBar((WINDOW_MIN / 2) * 60_000);
		// jsdom normalises "50.0%" → "50%".
		expect(screen.getByTestId("countdown-cut").style.width).toBe("50%");
	});

	test("a malformed zero window reads as fully cut, never a NaN width", () => {
		vi.useFakeTimers();
		render(
			<ClaimTimerBar
				expiresAt={Date.now() + 60_000}
				windowMinutes={0}
				onExpired={vi.fn()}
			/>,
		);
		// A deadline we can't compute must not render as SEALED (the opposite of
		// the truth); React would drop a NaN width and leave it looking untouched.
		expect(screen.getByTestId("countdown-cut").style.width).toBe("100%");
	});

	test("the strip stages amber in the low zone and red in the final minute", () => {
		vi.useFakeTimers();
		renderBar(10 * 60_000);
		expect(screen.getByTestId("countdown-cut").dataset.stage).toBe("ok");
		expect(print().getByText("10:00").className).toContain(
			"text-accent-emphasis",
		);
		cleanup();

		// 2 min of a 15-min window (≤ 25%): amber.
		renderBar(2 * 60_000);
		expect(screen.getByTestId("countdown-cut").dataset.stage).toBe("low");
		expect(print().getByText("2:00").className).toContain("text-amber-700");
		cleanup();

		// Final minute: red.
		renderBar(45_000);
		expect(screen.getByTestId("countdown-cut").dataset.stage).toBe("critical");
		expect(print().getByText("0:45").className).toContain("text-red-700");
	});

	test("the stage colour survives the cut — the wake's digits carry it too", () => {
		vi.useFakeTimers();
		// By the final minute the fill is nearly gone, so a colour that lives
		// only in the paper is a colour nobody sees. The clock is what's left
		// on screen, and it has to carry the warning.
		renderBar(45_000);
		const reds = screen
			.getAllByText("0:45")
			.filter((el) => el.className.includes("text-red-700"));
		// The crisp print plus both halves of the ghost.
		expect(reds.length).toBe(3);
	});

	test("a 24h window is NOT amber at 20 minutes — urgency keys on time left, not fraction", () => {
		vi.useFakeTimers();
		render(
			<ClaimTimerBar
				expiresAt={Date.now() + 20 * 60_000}
				windowMinutes={24 * 60}
				onExpired={vi.fn()}
			/>,
		);
		expect(screen.getByTestId("countdown-cut").dataset.stage).toBe("ok");
	});
});
