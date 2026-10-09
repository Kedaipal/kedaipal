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
		expect(print().getByText("10:00").className).toContain("text-countdown-ok");
		cleanup();

		// 2 min of a 15-min window (≤ 25%): amber.
		renderBar(2 * 60_000);
		expect(screen.getByTestId("countdown-cut").dataset.stage).toBe("low");
		expect(print().getByText("2:00").className).toContain("text-countdown-low");
		cleanup();

		// Final minute: red.
		renderBar(45_000);
		expect(screen.getByTestId("countdown-cut").dataset.stage).toBe("critical");
		expect(print().getByText("0:45").className).toContain(
			"text-countdown-critical",
		);
	});

	test("the stage colour survives the cut — the wake's digits carry it too", () => {
		vi.useFakeTimers();
		// By the final minute the fill is nearly gone, so a colour that lives
		// only in the paper is a colour nobody sees. The clock is what's left
		// on screen, and it has to carry the warning.
		renderBar(45_000);
		const reds = screen
			.getAllByText("0:45")
			.filter((el) => el.className.includes("text-countdown-critical"));
		// The crisp print plus both halves of the ghost.
		expect(reds.length).toBe(3);
	});

	test("the paper is the FIXED dark surface, never the flipping --primary pair", () => {
		vi.useFakeTimers();
		renderBar(5 * 60_000);
		const strip = screen.getByTestId("countdown-cut").parentElement;
		// `bg-primary` + `text-accent` is the obvious spelling and the one the
		// claim bar shipped as. It is wrong: BOTH resolve to mint in .dark, so
		// the figures would sit mint-on-mint. If someone "simplifies" back to
		// the semantic pair, this goes red before a buyer finds it.
		expect(strip?.className).toContain("bg-countdown-paper");
		expect(strip?.className).not.toContain("bg-primary");
		expect(strip?.className).not.toContain("bg-card");
	});

	test("the blades stay inside the strip at both ends of the run", () => {
		vi.useFakeTimers();
		// Centring a 20px icon on the cut puts half of it outside the strip at
		// 0% and at 100%, and overflow-hidden shears the blades off — worst in
		// the final seconds, the one moment it is being watched.
		// They ride an inset track, so the percentage IS the cut position and
		// the 12px inset keeps the icon's own width inside the strip.
		renderBar((WINDOW_MIN / 4) * 60_000); // 25% left
		expect(screen.getByTestId("countdown-blades").style.left).toBe("25%");
		cleanup();

		renderBar(-1000); // fully cut: parked flush, not hanging off the edge
		expect(screen.getByTestId("countdown-blades").style.left).toBe("0%");
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

describe("a long window reads as hours, not hundreds of minutes", () => {
	test("a 10-hour promotion says 10h 0m, never 599:xx", () => {
		vi.useFakeTimers();
		// The strip was written for a 15-minute claim and printed raw m:ss. A
		// promotion can run for a DAY, and the band read "638:31" live on the
		// product page — a number no buyer can decode. The product card already
		// used the human format, so the two surfaces disagreed as well.
		render(
			<ClaimTimerBar
				expiresAt={Date.now() + 10 * 60 * 60_000}
				windowMinutes={24 * 60}
				onExpired={vi.fn()}
			/>,
		);
		expect(print().getByText("10h 0m")).toBeTruthy();
	});

	test("under the hour it still ticks in m:ss — that's the urgency zone", () => {
		vi.useFakeTimers();
		renderBar(9 * 60_000 + 5_000);
		expect(print().getByText("9:05")).toBeTruthy();
	});
});

/**
 * Both raised as non-blocking FYIs on the PR #348 review, and both real. The
 * live consumers happen to be immune — the claim page swaps on `onExpired`,
 * and z8r3fdcw72's two band mounts unmount the moment the deadline passes and
 * pass no `onExpired` at all — but this is a shared exported component with an
 * OPTIONAL `onExpired`, so the next consumer to leave it mounted inherits both.
 */
describe("what an expired strip owes its consumer", () => {
	test("onExpired fires ONCE, not once a second", () => {
		vi.useFakeTimers();
		const onExpired = renderBar(1500);
		act(() => {
			vi.advanceTimersByTime(2000);
		});
		expect(onExpired).toHaveBeenCalledTimes(1);

		// Ten more seconds of sitting on an expired strip must stay at one.
		act(() => {
			vi.advanceTimersByTime(10_000);
		});
		expect(onExpired).toHaveBeenCalledTimes(1);
	});

	test("…and a parent that re-renders with an inline callback can't re-fire it", () => {
		vi.useFakeTimers();
		// The effect depends on `onExpired`, so an inline arrow — the common
		// way to write this — hands it a new identity on every parent render
		// and re-runs it. Stopping the clock does NOT cover this case: the
		// deadline guard is what does, and without it each parent render past
		// zero is another call.
		const spy = vi.fn();
		const expiresAt = Date.now() - 1000;
		const Parent = () => (
			<ClaimTimerBar
				expiresAt={expiresAt}
				windowMinutes={WINDOW_MIN}
				onExpired={() => spy()}
			/>
		);
		const { rerender } = render(<Parent />);
		expect(spy).toHaveBeenCalledTimes(1);

		rerender(<Parent />);
		rerender(<Parent />);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	test("a NEW deadline re-arms it — the guard is per-deadline, not once ever", () => {
		vi.useFakeTimers();
		const onExpired = vi.fn();
		const now = Date.now();
		const { rerender } = render(
			<ClaimTimerBar
				expiresAt={now - 1000}
				windowMinutes={WINDOW_MIN}
				onExpired={onExpired}
			/>,
		);
		expect(onExpired).toHaveBeenCalledTimes(1);

		// Same component, a different claim that is also already past.
		rerender(
			<ClaimTimerBar
				expiresAt={now - 500}
				windowMinutes={WINDOW_MIN}
				onExpired={onExpired}
			/>,
		);
		expect(onExpired).toHaveBeenCalledTimes(2);
	});

	test("the clock stops at the deadline instead of ticking forever", () => {
		vi.useFakeTimers();
		renderBar(2000);
		act(() => {
			vi.advanceTimersByTime(3000);
		});
		// Nothing left to count: no pending interval should remain, so a strip
		// parked on an expired page stops re-rendering every second.
		expect(vi.getTimerCount()).toBe(0);
	});

	test("a fully cut strip still says something to a screen reader", () => {
		vi.useFakeTimers();
		renderBar(-5000);
		// The crisp layer is gone and every other layer is aria-hidden, so
		// without this a screen reader gets an empty band while sighted users
		// read "0:00".
		expect(screen.queryByTestId("countdown-print")).toBeNull();
		expect(screen.getByText(/0:00 — ended/)).toBeTruthy();
	});
});
