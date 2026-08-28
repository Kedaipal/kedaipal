import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { formatCountdown } from "../../lib/countdown";

/**
 * The claim link's countdown bar (86eyq0epn, variant A of the three treatments
 * reviewed on the design canvas) — sticky, navy, mint clock over a thin
 * progress line.
 *
 * Lives in its own module rather than inside `claim-checkout-page` because it
 * is purely presentational: the checkout module pulls in the Convex api, the
 * form stack and the storefront address fieldset, none of which a clock needs.
 *
 * Ticks once a second and calls `onExpired` when the deadline passes, which
 * flips the whole page to its expired state. That is the HONEST UI, never the
 * gate: `orderClaims.commit` judges expiry server-side from the stored
 * `expiresAt`, so a paused tab, a wrong device clock or a mounted-after-expiry
 * render can't buy the buyer a locked price they no longer hold.
 */
export function ClaimTimerBar({
	expiresAt,
	windowMinutes,
	onExpired,
}: {
	expiresAt: number;
	windowMinutes: number;
	onExpired: () => void;
}) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	const remaining = expiresAt - now;
	useEffect(() => {
		if (remaining <= 0) onExpired();
	}, [remaining, onExpired]);
	// Guarded against a zero/absent window so a malformed claim can't divide by
	// zero into a NaN width (React would drop the style and the bar would read
	// full — the opposite of the truth).
	const total = windowMinutes > 0 ? windowMinutes * 60 * 1000 : 0;
	const fraction = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
	return (
		<div className="sticky top-0 z-40 bg-primary text-primary-foreground">
			<div className="relative mx-auto flex max-w-5xl items-center justify-center gap-2 px-4 pb-[11px] pt-[9px]">
				<Clock className="size-3.5 shrink-0 text-accent" aria-hidden />
				<p className="text-[13px] font-medium">Price locked for</p>
				<p
					className="font-mono text-sm font-bold tabular-nums text-accent"
					aria-live="off"
				>
					{formatCountdown(remaining)}
				</p>
			</div>
			<div className="absolute inset-x-0 bottom-0 h-[3px] bg-primary-foreground/15">
				<div
					data-testid="claim-timer-progress"
					className="h-full bg-accent transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
					style={{ width: `${fraction * 100}%` }}
				/>
			</div>
		</div>
	);
}
