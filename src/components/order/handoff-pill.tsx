/**
 * "Courier picks up" / "You drop off" — the one pill for how a parcel leaves
 * the seller (z8r3fe11x3), on every courier row in a picker and on the
 * booked card, so the kind the seller bought reads the same before and after
 * the tap. Navy for pickup (the house default: nothing to do but wait),
 * amber for drop-off (a job the seller still has to do).
 *
 * The drop-off pill carries its full claim ("at a branch") only where the
 * CARD is wide enough (`@md`, a container query on the dispatch card — the
 * order page is one phone-width column until `lg`, so a viewport breakpoint
 * would be the wrong ruler); a narrow card shows the short form so the name
 * beside it keeps its two lines.
 */

import {
	type CourierHandoff,
	HANDOFF_PILL_COPY,
} from "../../lib/parcel-courier-copy";
import { TONE_CHIP } from "../../lib/tone";
import { cn } from "../../lib/utils";

export function HandoffPill({
	handoff,
	className,
}: {
	handoff: CourierHandoff;
	className?: string;
}) {
	const copy = HANDOFF_PILL_COPY[handoff];
	return (
		<span
			data-handoff={handoff}
			className={cn(
				"inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 whitespace-nowrap",
				handoff === "dropoff"
					? TONE_CHIP.warn
					: "bg-segment text-segment-foreground",
				className,
			)}
		>
			{copy.short === copy.full ? (
				copy.short
			) : (
				<>
					<span className="@md:hidden">{copy.short}</span>
					<span className="hidden @md:inline">{copy.full}</span>
				</>
			)}
		</span>
	);
}
