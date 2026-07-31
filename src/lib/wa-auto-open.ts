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

/**
 * Whether the page is running inside WhatsApp's own in-app browser (the
 * Nov-2025 rollout that opens storefront links from a chat without leaving
 * WhatsApp). Auto-firing wa.me there bounces the buyer into a "Continue to
 * chat" interstitial + open-app prompt while they're ALREADY in WhatsApp —
 * most bail and the order strands as pending. Detection is deliberately a
 * plain UA sniff: WhatsApp stamps its token (e.g. "WhatsApp/2.25.x") into the
 * webview UA on both platforms, and a false negative just means today's
 * auto-fire behaviour, so there's no need for fragile webview heuristics.
 */
export function isWhatsAppWebview(userAgent: string): boolean {
	return /whatsapp/i.test(userAgent);
}

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
				// finally: even if openUrl throws (it shouldn't for a valid https
				// URL), the watchdog must still arm — otherwise the button would
				// stay stuck loading with no recovery path (PR #120 review).
				try {
					openUrl();
				} finally {
					watchdogTimer = setTimeout(settle, timeoutMs);
				}
			}, delayMs);
		},
		settle,
		cancel() {
			done = true;
			clearTimers();
		},
	};
}
