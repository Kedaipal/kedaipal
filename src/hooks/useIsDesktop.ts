import { useEffect, useState } from "react";

/**
 * True at Tailwind's `lg` breakpoint and up (1024px).
 *
 * Exists because the orders table (86eyrtz74) is a **desktop-only** surface and
 * its gate has to hold in JS, not just in CSS. `hidden lg:flex` hides the view
 * TOGGLE, but `?view=table` lives in the URL — so a link shared from a laptop,
 * opened on a phone, would otherwise render a 36-column table into a 390px
 * viewport with the toggle hidden and no way back. Rendering cards is the fix,
 * and that decision is a JS one.
 *
 * Starts `false` and resolves after mount, so the first paint matches the
 * server's (mobile-first) and never flashes a table it then has to tear down.
 */
const DESKTOP_QUERY = "(min-width: 1024px)";

export function useIsDesktop(): boolean {
	const [isDesktop, setIsDesktop] = useState(false);

	useEffect(() => {
		if (typeof window === "undefined" || !window.matchMedia) return;
		const mq = window.matchMedia(DESKTOP_QUERY);
		const sync = () => setIsDesktop(mq.matches);
		sync();
		mq.addEventListener("change", sync);
		return () => mq.removeEventListener("change", sync);
	}, []);

	return isDesktop;
}
