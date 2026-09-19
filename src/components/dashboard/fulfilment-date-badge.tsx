import { CalendarDays } from "lucide-react";
import {
	formatFulfilmentDate,
	formatFulfilmentDateTime,
	formatFulfilmentTime,
	relativeFulfilmentLabel,
} from "../../../convex/lib/fulfilmentDate";
import { cn } from "../../lib/utils";

/**
 * The pill's words, pure so the rules can be tested without rendering.
 *
 * The inbox card (size "sm") carries the TIME when the order has one
 * (z8r3fdff97): a seller running a same-day pickup counter needs "Today ·
 * 3:30 PM", not "Today" — two puffs due at 11:00 and 17:00 are different jobs.
 * Two deliberate exceptions keep it date-only:
 *  - OVERDUE: once it's late, the date is what the seller needs, not the hour;
 *  - MUTED (terminal / collected): the moment is history, not a cue to act.
 * The detail page (size "md") ignores the time — it renders its own time span
 * beside the badge, and saying it twice would be noise.
 */
export function fulfilmentBadgeLabel({
	epoch,
	now,
	size,
	muted,
	timeMinutes,
}: {
	epoch: number;
	now: number;
	size: "sm" | "md";
	muted: boolean;
	timeMinutes?: number;
}): { rel: string | null; label: string } {
	const rel = muted ? null : relativeFulfilmentLabel(epoch, now);
	// Compact text for the inbox card; full weekday date on detail.
	const dateText =
		size === "md"
			? formatFulfilmentDate(epoch)
			: formatFulfilmentDate(epoch, { weekday: false });
	const showTime =
		size === "sm" && !muted && timeMinutes !== undefined && rel !== "Overdue";
	if (showTime) {
		const time = formatFulfilmentTime(timeMinutes);
		return {
			rel,
			// "Today · 3:30 PM" reads better than "Today · 17 Sep · 3:30 PM" —
			// Today/Tomorrow already name the day.
			label: rel ? `${rel} · ${time}` : `${dateText} · ${time}`,
		};
	}
	return { rel, label: rel ? `${rel} · ${dateText}` : dateText };
}

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
	timeMinutes,
}: {
	epoch: number;
	now?: number;
	size?: "sm" | "md";
	muted?: boolean;
	/** The order's pickup/delivery time, when it has one — see fulfilmentBadgeLabel. */
	timeMinutes?: number;
}) {
	const { rel, label } = fulfilmentBadgeLabel({
		epoch,
		now,
		size,
		muted,
		timeMinutes,
	});

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
			// The full moment on hover, even where the pill shortens it.
			title={formatFulfilmentDateTime(epoch, timeMinutes)}
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
