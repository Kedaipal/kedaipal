/**
 * "Ready to ship" — every order that's packed, paid for and going out by
 * courier, one tap away from labels (86eyp63mp).
 *
 * WHERE IT LIVES, and why: in the order inbox, in the same slot as the
 * due-today banner — the inbox's established home for "there is work waiting,
 * here is the one tap that does it" — and directly BELOW it, because a deadline
 * outranks a task you can finish whenever you like. Not in the bulk bar: that
 * bar only exists inside select mode, and the whole point of this control is
 * that it needs no selection.
 *
 * The tap opens the PRINT-QUEUE MODAL (PrintLabelsDialog's queue mode), not a
 * straight print: the moment new orders join an already-printed queue, a
 * blind one-tap would re-print everything, and the seller had no way to
 * choose. The modal lists the queue with never-printed rows ticked by default
 * and printed rows chip-marked for deliberate re-prints.
 *
 * It renders whenever the store offers delivery, INCLUDING at zero, where the
 * button is disabled with the reason. The count is the discoverability
 * affordance: it teaches the feature exists and says how much work is waiting,
 * and a seller can never tap into an empty queue. A pickup-only store has no
 * despatch queue by definition, so it never sees this at all.
 *
 * Printing deliberately does NOT advance anything to "sent" — a label in the
 * printer tray is not a parcel in a courier's hands. The seller still marks
 * them sent from the bulk bar when they actually hand them over, and the
 * modal says so.
 */

import { PackageCheck, Printer } from "lucide-react";
import { useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "../ui/button";
import { PrintLabelsDialog } from "./print-labels-dialog";

export function ReadyToShipStrip({
	retailerId,
	count,
	paperLabel,
}: {
	retailerId: Id<"retailers">;
	/** Packed + paid parcel orders, over the store's whole inbox — not the
	 * current filter, so the number is the real backlog. */
	count: number;
	/** Human name of the store's saved label size (see `describeAwbPaper`). */
	paperLabel: string;
}) {
	const [open, setOpen] = useState(false);
	const empty = count === 0;

	return (
		<section className="flex items-center gap-3 rounded-2xl border border-input bg-card px-4 py-3">
			<PackageCheck
				className="size-5 shrink-0 text-muted-foreground"
				aria-hidden="true"
			/>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-semibold text-foreground">
					{empty ? "Ready to ship" : `${count} ready to ship`}
				</p>
				<p className="text-xs text-muted-foreground">
					{empty
						? "Packed and paid orders show up here for one-tap label printing."
						: "Packed, paid and going out by courier."}
				</p>
			</div>
			<Button
				type="button"
				size="sm"
				variant={empty ? "outline" : "default"}
				className="tap-target shrink-0"
				onClick={() => setOpen(true)}
				disabled={empty}
				title={
					empty
						? "Nothing is packed and paid for yet"
						: `Choose and print ${count} label${count === 1 ? "" : "s"}`
				}
			>
				<Printer className="size-4" />
				<span className="hidden sm:inline">Print labels</span>
				{!empty ? (
					<span className="font-bold tabular-nums">{count}</span>
				) : null}
			</Button>
			<PrintLabelsDialog
				mode="queue"
				open={open}
				onOpenChange={setOpen}
				retailerId={retailerId}
				paperLabel={paperLabel}
			/>
		</section>
	);
}
