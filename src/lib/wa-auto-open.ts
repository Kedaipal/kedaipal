/**
 * Auto-open controller for the tracking page's WhatsApp handoff.
 *
 * When checkout lands the buyer on /track/<token>?send=1, the "Send on
 * WhatsApp" button auto-fires: after a short paint delay we same-tab navigate
 * to the wa.me deep link. Same-tab navigation is never popup-blocked (unlike
 * window.open — see src/lib/wa-order-message.ts), but some in-app webviews
 * refuse to leave the page at all, so a watchdog timeout settles the button
 * back to its manual state if we're still here after the attempt.
 *
 * Framework-free so the timing logic is unit-testable; the React side wires
 * `settle()` to pageshow/visibilitychange (bfcache restore or returning from
 * the WhatsApp app must never leave the button stuck loading).
 */

/** Let the tracking page paint before whisking the buyer away. */
export const WA_AUTO_OPEN_DELAY_MS = 600;
/** If we're still on the page this long after navigating, the open failed. */
export const WA_AUTO_OPEN_TIMEOUT_MS = 4000;

export type WaAutoOpen = {
	/** Begin: delay → openUrl → watchdog. Idempotent. */
	start: () => void;
	/** The attempt is over (page restored/visible again) — stop loading. */
	settle: () => void;
	/** Unmount cleanup: clear timers, never call back. */
	cancel: () => void;
};

export function createWaAutoOpen({
	openUrl,
	onSettled,
	delayMs = WA_AUTO_OPEN_DELAY_MS,
	timeoutMs = WA_AUTO_OPEN_TIMEOUT_MS,
}: {
	/** Performs the same-tab navigation (e.g. window.location.assign). */
	openUrl: () => void;
	/** Loading state should end — attempt failed or the buyer came back. */
	onSettled: () => void;
	delayMs?: number;
	timeoutMs?: number;
}): WaAutoOpen {
	let delayTimer: ReturnType<typeof setTimeout> | undefined;
	let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
	let started = false;
	let done = false;

	function clearTimers() {
		if (delayTimer !== undefined) clearTimeout(delayTimer);
		if (watchdogTimer !== undefined) clearTimeout(watchdogTimer);
		delayTimer = undefined;
		watchdogTimer = undefined;
	}

	function settle() {
		if (done) return;
		done = true;
		clearTimers();
		onSettled();
	}

	return {
		start() {
			if (started || done) return;
			started = true;
			delayTimer = setTimeout(() => {
				delayTimer = undefined;
				openUrl();
				watchdogTimer = setTimeout(settle, timeoutMs);
			}, delayMs);
		},
		settle,
		cancel() {
			done = true;
			clearTimers();
		},
	};
}
