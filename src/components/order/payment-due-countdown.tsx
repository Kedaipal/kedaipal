import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { formatClaimCountdown } from "../../lib/countdown";

/**
 * The payment deadline on the buyer's order page (86eyq0epn) — the claim
 * link's timer CONTINUING after commit, because stock decremented at commit
 * and the hold only truly ends at money (the Agoda model; Zaki, 27 Aug).
 *
 * The caller renders this ONLY while the clock is genuinely live: `paymentDueAt`
 * set, payment `unpaid` (a `claimed` order shows the "being confirmed" card
 * instead — an "I've paid" pauses the countdown pending the seller's verdict,
 * it must never race one), order not cancelled, and no fee-pending /
 * gateway-issue hold (those states make payment impossible, so a ticking
 * clock would be a lie — the sweep skips them too).
 *
 * Purely presentational, like ClaimTimerBar: the sweep judges the deadline
 * server-side, so a paused tab or wrong device clock changes nothing real.
 * Past zero it switches to "time's up" honesty — the reactive order query
 * flips the whole page to cancelled when the sweep lands (≤1 min behind).
 */
export function PaymentDueCountdown({ dueAt }: { dueAt: number }) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	const remaining = dueAt - now;

	if (remaining <= 0) {
		return (
			<div
				data-testid="payment-due-countdown"
				className="mt-4 flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
			>
				<Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
				<p>
					<span className="font-semibold">The payment window has ended.</span>{" "}
					This order will be cancelled and the items released — unless your
					payment already went through, in which case it applies as normal.
				</p>
			</div>
		);
	}
	return (
		<div
			data-testid="payment-due-countdown"
			className="mt-4 flex items-start gap-2 rounded-xl bg-amber-100 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
		>
			<Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
			<p>
				<span className="font-semibold">
					Complete payment within{" "}
					<span className="font-mono tabular-nums">
						{formatClaimCountdown(remaining)}
					</span>
				</span>{" "}
				— after that this order is cancelled and the items are released.
				Starting an online payment gives you extra time to finish it.
			</p>
		</div>
	);
}
