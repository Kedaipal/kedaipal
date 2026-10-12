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
	// BOTH boundaries, not just the next one. A teaser has to keep ticking
	// THROUGH its own start: the flip to the live price happens on this clock
	// (`promoLive`), and the countdown then runs on to `endsAt`. Watching only
	// `startsAt` made that work by accident — the interval was never cleared —
	// and watching only the nearer boundary would have frozen the page at the
	// drop, which is the moment the whole feature exists for.
	const startsAt = state?.phase === "scheduled" ? state.startsAt : undefined;
	const endsAt = state?.endsAt;
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		// The last moment this clock changes anything for the caller.
		const last = Math.max(startsAt ?? 0, endsAt ?? 0);
		if (last === 0) return;
		setNow(Date.now());
		if (Date.now() >= last) return;
		const timer = setInterval(() => {
			const t = Date.now();
			setNow(t);
			// Nothing left to watch — stop rather than re-render every product
			// page once a second for as long as the tab stays open.
			if (t >= last) clearInterval(timer);
		}, 1000);
		return () => clearInterval(timer);
	}, [startsAt, endsAt]);
	return now;
}
