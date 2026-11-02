// The store drawer's "Channel" row (86eye3eyp, docs/acquisition-attribution.md):
// the conclusion of "How they arrived", above the raw signals it was drawn
// from. Three states, each saying what it means for CAC:
//  - tagged by an admin: the channel, the note, when;
//  - the seller's own onboarding answer: not counted until confirmed;
//  - untagged: a warning, plus a one-tap tag when a suggestion exists.

import { useState } from "react";
import type { AdminSellerRow } from "../../../convex/admin";
import { CHANNEL_COPY, channelLabel } from "../../../convex/lib/metrics";
import { describeDays } from "../../lib/admin-seller-view";
import { TONE_PANEL } from "../../lib/tone";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { AcquisitionDialog } from "./acquisition-dialog";

/** The channel as a pill — navy when it's an admin tag, dashed when it's
 * the seller's unconfirmed claim. */
export function ChannelPill({
	channel,
	claimed = false,
	className,
}: {
	channel: string;
	claimed?: boolean;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex h-6 max-w-full items-center truncate rounded-full px-2.5 text-xs font-semibold",
				claimed
					? "border border-dashed border-muted-foreground/60 bg-secondary text-secondary-foreground"
					: "bg-segment text-segment-foreground",
				className,
			)}
		>
			{channelLabel(channel)}
		</span>
	);
}

export function AcquisitionCell({
	seller,
	now,
}: {
	seller: AdminSellerRow;
	now: number;
}) {
	const [open, setOpen] = useState(false);
	const { channel, setBy, note, at, suggested } = seller.acquisition;
	const dialog = open ? (
		<AcquisitionDialog seller={seller} onClose={() => setOpen(false)} />
	) : null;

	if (channel !== undefined && setBy === "admin") {
		return (
			<div className="flex min-w-0 flex-col gap-1 py-0.5">
				<div className="flex items-center justify-between gap-2">
					<ChannelPill channel={channel} />
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="tap-target shrink-0"
						onClick={() => setOpen(true)}
					>
						Change
					</Button>
				</div>
				{note ? <span className="text-[13px] font-medium">{note}</span> : null}
				<span className="text-xs text-muted-foreground">
					Tagged by Kedaipal
					{at !== undefined ? ` · ${describeDays(at, now)}` : ""}
				</span>
				{dialog}
			</div>
		);
	}

	if (channel !== undefined && setBy === "seller") {
		return (
			<div className="flex min-w-0 flex-col gap-1.5 py-0.5">
				<div className="flex flex-wrap items-center gap-2">
					<ChannelPill channel={channel} claimed />
					<span className="text-xs text-muted-foreground">
						the seller's own answer at signup
					</span>
				</div>
				<span className="text-xs text-muted-foreground">
					Not counted towards CAC until you confirm or change it.
				</span>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="tap-target self-start"
					onClick={() => setOpen(true)}
				>
					Confirm or change…
				</Button>
				{dialog}
			</div>
		);
	}

	return (
		<div
			className={cn(
				"my-1 flex min-w-0 flex-col gap-1.5 rounded-xl border px-3 py-2.5",
				// Amber only where it costs something: a payer missing from CAC.
				// A store that hasn't paid isn't in any CAC yet.
				seller.hasPaidInvoice ? TONE_PANEL.warn : TONE_PANEL.neutral,
			)}
		>
			<span className="text-[13px] font-semibold">
				{seller.hasPaidInvoice
					? "Not tagged — this store is missing from CAC"
					: "Not tagged yet"}
			</span>
			{suggested ? (
				<span className="text-xs">
					Suggested:{" "}
					<span className="font-semibold">{CHANNEL_COPY[suggested].label}</span>
				</span>
			) : (
				<span className="text-xs">
					No link tag or referral to go on — pick from what you remember.
				</span>
			)}
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="tap-target self-start bg-background"
				onClick={() => setOpen(true)}
			>
				Tag channel…
			</Button>
			{dialog}
		</div>
	);
}
