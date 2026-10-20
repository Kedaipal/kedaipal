import { useEffect } from "react";

/**
 * Run `reset` when the page is restored from the back/forward cache.
 *
 * Any flow that hands the browser to an external site with
 * `window.location.assign` (HitPay's checkout and authorisation pages) leaves
 * its "we're navigating away" state latched true, because nothing runs after
 * the assign. On desktop the page reloads on Back and the state is gone; on
 * mobile — where this product lives, and where Back IS the abandon gesture —
 * bfcache restores the JS heap intact and that latched flag becomes a spinner
 * or a disabled button with no way out but a hard refresh.
 *
 * `event.persisted` is true only for that restore, so a normal load never
 * fires the reset.
 */
export function useResetOnBfcache(reset: () => void): void {
	useEffect(() => {
		const onPageShow = (event: PageTransitionEvent) => {
			if (event.persisted) reset();
		};
		window.addEventListener("pageshow", onPageShow);
		return () => window.removeEventListener("pageshow", onPageShow);
	}, [reset]);
}
