import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import {
	type CountdownStage,
	countdownStage,
	formatCountdown,
} from "../../lib/countdown";

/**
 * The claim link's countdown bar (86eyq0epn variant A, legibility pass
 * z8r3fdr60v) — sticky, navy, mint clock over an 8px progress line whose
 * right edge visibly recedes, turning amber then red as time runs out
 * (`countdownStage` owns the thresholds — shared with the flash-sale
 * countdown, z8r3fdcw72).
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
const STAGE_TEXT: Record<CountdownStage, string> = {
	ok: "text-accent",
	low: "text-amber-400",
	critical: "text-destructive",
};

const STAGE_FILL: Record<CountdownStage, string> = {
	ok: "bg-accent",
	low: "bg-amber-400",
	critical: "bg-destructive",
};

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
	const stage = countdownStage(remaining, total);
	return (
		<div className="sticky top-0 z-40 bg-primary text-primary-foreground">
			<div className="relative mx-auto flex max-w-5xl items-center justify-center gap-2 px-4 pb-4 pt-[9px]">
				<Clock
					className={`size-3.5 shrink-0 ${STAGE_TEXT[stage]}`}
					aria-hidden
				/>
				<p className="text-[13px] font-medium">Price locked for</p>
				<p
					className={`font-mono text-sm font-bold tabular-nums ${STAGE_TEXT[stage]}`}
					aria-live="off"
				>
					{formatCountdown(remaining)}
				</p>
			</div>
			<div className="absolute inset-x-0 bottom-0 h-2 bg-primary-foreground/15">
				<div
					data-testid="claim-timer-progress"
					className={`h-full rounded-r-full transition-[width] duration-1000 ease-linear motion-reduce:transition-none ${STAGE_FILL[stage]}`}
					style={{ width: `${fraction * 100}%` }}
				/>
			</div>
		</div>
	);
}
