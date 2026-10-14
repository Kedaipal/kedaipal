/**
 * "Ready to ship" — in the order inbox, the pointer to where despatch labels
 * print (86eyp63mp; re-homed in 86eye9xd4 6A).
 *
 * Label printing moved to **Deliveries**, beside the "To ship" queue it
 * prints — the page where a seller follows packed orders out the door. The
 * inbox keeps this strip so a seller who learned labels here still finds
 * them: same slot (below the due-today banner, because a deadline outranks a
 * task you can finish whenever), same count, one tap to the new home. The
 * bulk bar's "Print labels" for a ticked SELECTION stays in the inbox — that
 * one is about the orders you're looking at, not the queue.
 *
 * It renders whenever the store offers delivery, INCLUDING at zero: the count
 * teaches that the queue exists. A pickup-only store has no despatch queue,
 * so it never sees this.
 */

import { Link } from "@tanstack/react-router";
import { ChevronRight, PackageCheck } from "lucide-react";

export function ReadyToShipStrip({
	count,
}: {
	/** Packed + paid parcel orders, over the store's whole inbox — not the
	 * current filter, so the number is the real backlog. */
	count: number;
}) {
	const empty = count === 0;
	return (
		<Link
			to="/app/deliveries"
			className="flex min-h-14 items-center gap-3 rounded-2xl border border-input bg-card px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
		>
			<PackageCheck
				className="size-5 shrink-0 text-muted-foreground"
				aria-hidden="true"
			/>
			<span className="min-w-0 flex-1">
				<span className="block text-sm font-semibold text-foreground">
					{empty ? "Ready to ship" : `${count} ready to ship`}
				</span>
				<span className="block text-xs text-muted-foreground">
					{empty
						? "Packed and paid orders print their labels on Deliveries."
						: "Print their labels on Deliveries."}
				</span>
			</span>
			<span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-accent-emphasis">
				Deliveries
				<ChevronRight aria-hidden className="size-4" />
			</span>
		</Link>
	);
}
