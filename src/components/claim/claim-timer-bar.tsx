import { CountdownStrip } from "../ui/countdown-strip";

/**
 * The claim link's countdown (86eyq0epn), restyled to the house scissors strip
 * (z8r3fdr60v): a receipt being cut along its dotted line, pinned to the top of
 * the buyer's checkout. It shipped as a 3px progress hairline under a navy bar,
 * which read as a border rather than a timer.
 *
 * Thin on purpose — all the mechanics live in `CountdownStrip`, which the
 * storefront's flash countdown mounts too, so the claim's "price locked" clock
 * and a flash sale's clock can never drift apart.
 *
 * Expiry here is the HONEST UI, never the gate: `orderClaims.commit` judges it
 * server-side from the stored `expiresAt`, so a paused tab, a wrong device
 * clock or a mounted-after-expiry render can't buy the buyer a locked price
 * they no longer hold.
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
	return (
		<div className="sticky top-0 z-40 bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:px-8">
			<div className="mx-auto w-full max-w-5xl">
				<CountdownStrip
					expiresAt={expiresAt}
					totalMs={windowMinutes * 60 * 1000}
					label="Price locked for"
					onExpired={onExpired}
					className="shadow-[0_2px_12px_rgba(15,23,42,0.08)]"
				/>
			</div>
		</div>
	);
}
