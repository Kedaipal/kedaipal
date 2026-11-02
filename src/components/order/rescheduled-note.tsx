import { CalendarSync } from "lucide-react";
import { formatFulfilmentDateTime } from "../../../convex/lib/fulfilmentDate";
import { formatRelativeTime } from "../../lib/format";
import { cn } from "../../lib/utils";

/**
 * "This moment MOVED" — the line beside an order's fulfilment date once the
 * seller has rescheduled it (ClickUp `z8r3fdff97` test round).
 *
 * A reschedule sends the buyer nothing: the dialog says so out loud and tells
 * the seller to agree the new time in chat first (no new WhatsApp sends —
 * docs/fulfilment-date.md). So the buyer's only way to learn their 3 PM became
 * 1 PM is `/track`, where "Collect on Mon, 21 Sep · 1:00 PM" reads exactly
 * like the time they picked themselves. This says otherwise, and names what it
 * was, so a buyer who half-remembers 3 PM gets confirmation rather than doubt.
 *
 * One component for both sides: the buyer is told WHO moved it, the seller
 * (who may not be the person who did) is told WHEN. Renders nothing when the
 * order was never moved, so callers don't need a guard.
 */
export function RescheduledNote({
	rescheduledAt,
	fromDate,
	fromTimeMinutes,
	storeName,
	audience,
	className,
}: {
	/** Absent = never rescheduled (every order before this shipped). */
	rescheduledAt: number | undefined;
	/** The moment it moved FROM. Absent when the order had no date at all. */
	fromDate: number | undefined;
	/** Absent when it moved from a date-only day — nothing to show but the day. */
	fromTimeMinutes: number | undefined;
	storeName: string;
	audience: "buyer" | "seller";
	className?: string;
}) {
	if (rescheduledAt === undefined) return null;
	const was =
		fromDate === undefined
			? null
			: formatFulfilmentDateTime(fromDate, fromTimeMinutes);
	return (
		<div
			className={cn(
				// The house amber note (product form's "won't change anything"),
				// one size up: on /track this is news, not a field helper.
				"flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400",
				className,
			)}
		>
			<CalendarSync className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			<p className="min-w-0 flex-1">
				{audience === "buyer" ? (
					<span className="font-semibold">{storeName} changed this</span>
				) : (
					<span className="font-semibold">You moved this</span>
				)}
				{was === null ? (
					// No previous date: the seller SET one on an order that had none,
					// so there is no "was" to contrast with.
					<span> — it had no date before.</span>
				) : (
					<>
						<span> — it was </span>
						<span className="whitespace-nowrap font-medium">{was}</span>
						<span>.</span>
					</>
				)}{" "}
				<span className="opacity-70">{formatRelativeTime(rescheduledAt)}</span>
			</p>
		</div>
	);
}
