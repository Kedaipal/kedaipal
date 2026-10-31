import { useEffect, useState } from "react";

/**
 * "Now", re-read once a minute — for labels like "updated 3m ago" that a
 * Convex query never refreshes on its own (queries re-run on data, not on
 * time). Minute grain: nothing that uses it shows seconds.
 */
export function useMinuteClock(): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 60_000);
		return () => clearInterval(timer);
	}, []);
	return now;
}
