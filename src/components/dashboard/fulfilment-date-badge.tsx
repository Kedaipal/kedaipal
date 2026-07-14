import { CalendarDays } from "lucide-react";
import {
	formatFulfilmentDate,
	relativeFulfilmentLabel,
} from "../../../convex/lib/fulfilmentDate";
import { cn } from "../../lib/utils";

/**
 * Pill showing when an order is due (its fulfilmentDate). Leads with urgency —
 * "Overdue"/"Today"/"Tomorrow" get colour; further-out dates show the plain
 * date in neutral chrome. Shared by the inbox card and the order detail header.
 *
 * `muted` strips the urgency entirely — no relative prefix, always neutral
 * chrome — for orders where the date carries no "act now" signal (a terminal
 * `delivered`/`cancelled` order: the seller's job is done, so a red "Overdue"
 * would contradict the status). See ClickUp 86ey8r734.
 */
export function FulfilmentDateBadge({
	epoch,
	now = Date.now(),
	size = "sm",
	muted = false,
}: {
	epoch: number;
	now?: number;
	size?: "sm" | "md";
	muted?: boolean;
}) {
	const rel = muted ? null : relativeFulfilmentLabel(epoch, now);
	// Compact text for the inbox card; full weekday date on detail.
	const dateText =
		size === "md"
			? formatFulfilmentDate(epoch)
			: formatFulfilmentDate(epoch, { weekday: false });
	const label = rel ? `${rel} · ${dateText}` : dateText;

	const tone =
		rel === "Overdue"
			? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
			: rel === "Today"
				? "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
				: rel === "Tomorrow"
					? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
					: "bg-muted text-muted-foreground";

	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-full font-medium",
				size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]",
				tone,
			)}
		>
			<CalendarDays
				className={size === "md" ? "size-3.5" : "size-3"}
				aria-hidden="true"
			/>
			{label}
		</span>
	);
}
