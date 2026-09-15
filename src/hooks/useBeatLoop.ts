import { useEffect, useState } from "react";

/**
 * A looping "beat" counter for the landing's acted-out mocks (payment
 * handshake, courier dispatch, the hero's before/after stage). Each entry in
 * `beats` is how long that beat holds, in ms; the index wraps.
 *
 * Two guards, both learned the hard way on the handshake (29 Aug):
 * - `active` false (off-screen, reduced motion) stops the clock entirely — a
 *   story playing three screens above the reader is wasted battery.
 * - A hidden tab FREEZES the story rather than advancing it unseen, but must
 *   WAKE when the tab returns: the hidden branch re-arms a short retry instead
 *   of setting identical state (which would never re-run the effect and would
 *   kill the loop permanently).
 */
export function useBeatLoop(active: boolean, beats: readonly number[]): number {
	const [beat, setBeat] = useState(0);

	useEffect(() => {
		if (!active) return;
		let cancelled = false;
		let id: ReturnType<typeof setTimeout>;
		const arm = (delay: number) => {
			id = setTimeout(() => {
				if (cancelled) return;
				if (document.visibilityState === "visible") {
					setBeat((b) => (b + 1) % beats.length);
				} else {
					arm(1000);
				}
			}, delay);
		};
		arm(beats[beat] ?? 1000);
		return () => {
			cancelled = true;
			clearTimeout(id);
		};
	}, [active, beat, beats]);

	return beat;
}
