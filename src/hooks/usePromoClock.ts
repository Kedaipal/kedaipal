import { useEffect, useState } from "react";
import type { PromoState } from "../lib/promo";

/**
 * A once-a-second clock, but ONLY while a timed promotion is actually running
 * (z8r3fdcw72).
 *
 * The storefront needs the passing of time for two things: the countdown band,
 * and reverting the price the instant a window shuts under an open page. Both
 * want a tick; neither is worth re-rendering every product page once a second
 * forever, which is what an unconditional interval would do. So the interval
 * exists only when there is a deadline to watch — no promotion, a scheduled
 * teaser with no start, or an open-ended discount all return a frozen `now`.
 *
 * Convex queries don't re-run as time passes (they have no reason to), which
 * is why the clock lives on the client at all; the server stays the authority
 * at the order door.
 */
export function usePromoClock(state: PromoState | undefined): number {
	const deadline =
		state?.phase === "scheduled" ? state.startsAt : state?.endsAt;
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (deadline === undefined) return;
		// Already past: one update so the caller sees the new truth, then stop.
		if (Date.now() >= deadline) {
			setNow(Date.now());
			return;
		}
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [deadline]);
	return deadline === undefined ? now : Math.max(now, 0);
}
