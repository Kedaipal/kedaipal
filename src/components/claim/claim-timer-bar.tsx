import { CountdownBand } from "../ui/countdown-strip";

/**
 * The claim link's countdown (86eyq0epn), restyled to the house scissors strip
 * (z8r3fdr60v): a receipt being cut along its dotted line, banded across the
 * top of the buyer's checkout under the store header. It shipped as a 3px
 * progress hairline under a navy bar, which read as a border rather than a
 * timer.
 *
 * Thin on purpose — placement and mechanics both live in `CountdownBand` /
 * `CountdownStrip`, which the storefront checkout and product page mount too,
 * so every countdown in the app sits in the same place and reads the same way.
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
		<CountdownBand
			expiresAt={expiresAt}
			totalMs={windowMinutes * 60 * 1000}
			label="Price locked for"
			onExpired={onExpired}
		/>
	);
}
