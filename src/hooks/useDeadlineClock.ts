import { useEffect, useState } from "react";

/**
 * A clock that ticks only while one of `deadlines` is still ahead — the
 * Promotions list's sibling of `usePromoClock` (`z8r3fducfd`). The list shows
 * "1h 42m left" and slides a row from Scheduled to Live to Ended at its own
 * moment, which a Convex query never would (queries don't re-run as time
 * passes). Minute grain by default: a list doesn't need a seconds counter,
 * and a dashboard re-rendering once a second for nothing is waste.
 */
export function useDeadlineClock(
	deadlines: readonly number[],
	stepMs = 30_000,
): number {
	const [now, setNow] = useState(() => Date.now());
	// A stable key, so a fresh array of the same deadlines doesn't restart
	// the interval on every render.
	const next = deadlines.filter((t) => t > now).sort((a, b) => a - b)[0];
	useEffect(() => {
		if (next === undefined) return;
		const timer = setInterval(() => setNow(Date.now()), stepMs);
		// Land exactly on the boundary too, so a phase flips on time.
		const edge = setTimeout(
			() => setNow(Date.now()),
			Math.max(0, next - Date.now()) + 50,
		);
		return () => {
			clearInterval(timer);
			clearTimeout(edge);
		};
	}, [next, stepMs]);
	return now;
}
