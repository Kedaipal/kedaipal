// "How did you find Kedaipal?" at onboarding (86eye3eyp,
// docs/acquisition-attribution.md). Optional, nothing pre-selected — a
// default would quietly become the most popular channel. The answer is the
// seller's CLAIM: stored as acquisitionSetBy "seller" for an admin to
// confirm, never shown back to them.
//
// "Another Kedaipal seller" opens the referral field in place, so two
// questions about the same thing read as one. The field also stays open
// whenever it holds a store (cookie-seeded or typed): a referral that's
// still being sent must never be hidden.

import type { ReactNode } from "react";
import type { AcquisitionChannel } from "../../../convex/lib/metrics";
import { FilterChip } from "../ui/filter-chip";

/** The seller's own words for each channel, in the order a seller thinks of
 * them — referral first, because it carries a reward. */
export const FOUND_US_OPTIONS: ReadonlyArray<{
	channel: AcquisitionChannel;
	label: string;
}> = [
	{ channel: "referral", label: "Another Kedaipal seller" },
	{ channel: "product_led", label: "Saw it on a store page" },
	{ channel: "inbound_social", label: "TikTok / Instagram / Facebook" },
	{ channel: "inbound_search", label: "Google" },
	{ channel: "talk_event", label: "A talk or event" },
	{ channel: "walk_in", label: "Kedaipal visited my shop" },
	{ channel: "outbound_dm", label: "Kedaipal messaged me" },
	{ channel: "founder_network", label: "I know the team" },
	{ channel: "other", label: "Something else" },
];

export function FoundUsQuestion({
	value,
	onChange,
	referralOpen,
	referralField,
}: {
	value: AcquisitionChannel | null;
	onChange: (next: AcquisitionChannel | null) => void;
	/** Show the referral field even when another answer is picked — it holds
	 * a store already. */
	referralOpen: boolean;
	referralField: ReactNode;
}) {
	const showReferral = value === "referral" || referralOpen;
	return (
		// The divider sits on a wrapper: on the fieldset itself the border
		// runs through the legend.
		<div className="border-t border-border pt-5">
			<fieldset className="flex flex-col gap-2.5">
				<legend className="text-sm font-medium">
					How did you find Kedaipal?{" "}
					<span className="font-normal text-muted-foreground">(optional)</span>
				</legend>
				<p className="text-xs text-muted-foreground">
					Helps us know what's working. Skip it if you're not sure.
				</p>
				<div className="flex flex-wrap gap-2">
					{FOUND_US_OPTIONS.map((option) => (
						<FilterChip
							key={option.channel}
							selected={value === option.channel}
							onClick={() =>
								onChange(value === option.channel ? null : option.channel)
							}
							className="h-11"
						>
							{option.label}
						</FilterChip>
					))}
				</div>
				{showReferral ? (
					<div className="flex flex-col gap-2 rounded-xl bg-muted/60 p-3">
						{referralField}
					</div>
				) : null}
			</fieldset>
		</div>
	);
}
