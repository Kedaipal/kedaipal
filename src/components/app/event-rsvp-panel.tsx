import { Link } from "@tanstack/react-router";
import { CalendarClock, Inbox, Users } from "lucide-react";
import { formatFulfilmentDateTime } from "../../../convex/lib/fulfilmentDate";

export type EventHeadcount = {
	date: number;
	timeMinutes?: number;
	seats?: number;
	taken: number;
	left?: number;
	passed: boolean;
	options: Array<{ label: string; seats: number }>;
};

/**
 * The seller's live headcount for one event — the whole reason this feature
 * exists. Without it she opens 18 orders and counts Set A vs Set B by hand,
 * which is exactly what she does in WhatsApp today.
 *
 * Sits ABOVE the edit form on an event product's page: when she taps into "BNI
 * Breakfast" the morning of the event, "18 RSVPs · 11 Set A · 7 Set B" is what
 * she came for, not the name field.
 *
 * Every state is designed, because an event spends time in all of them: no
 * RSVPs yet (the common first day), uncapped, nearly full, full, and finished.
 */
export function EventRsvpPanel({
	headcount,
	productName,
}: {
	headcount: EventHeadcount;
	productName: string;
}) {
	const { taken, seats, left, passed, options } = headcount;
	const moment = formatFulfilmentDateTime(
		headcount.date,
		headcount.timeMinutes,
	);
	const full = left !== undefined && left <= 0;
	// One option with no label = a single-variant event (no food choice to make).
	// Its tally is just the total, so the breakdown would repeat itself.
	const showBreakdown =
		options.length > 0 && !(options.length === 1 && options[0].label === "");

	return (
		<section
			aria-labelledby="event-rsvps-heading"
			className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h3
						id="event-rsvps-heading"
						className="flex items-center gap-2 font-heading text-base font-extrabold leading-tight"
					>
						<Users className="size-4 text-accent" aria-hidden />
						RSVPs
					</h3>
					<p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
						<CalendarClock className="size-3.5 shrink-0" aria-hidden />
						<span>
							{moment}
							{passed ? " · finished" : null}
						</span>
					</p>
				</div>
				{/* The seat state as one glanceable claim. "Uncapped" is said out
				    loud rather than left blank — a missing number reads as a bug. */}
				<div className="shrink-0 text-right">
					<p className="font-heading text-2xl font-extrabold leading-none tabular-nums">
						{taken}
						{seats !== undefined ? (
							<span className="text-base font-bold text-muted-foreground">
								{" / "}
								{seats}
							</span>
						) : null}
					</p>
					<p
						className={`mt-1 text-xs font-medium ${
							full ? "text-destructive" : "text-muted-foreground"
						}`}
					>
						{seats === undefined
							? taken === 1
								? "seat taken · no limit"
								: "seats taken · no limit"
							: full
								? "full"
								: `${left} left`}
					</p>
				</div>
			</div>

			{taken === 0 ? (
				<p className="rounded-xl bg-muted/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
					{passed
						? "This event finished with no RSVPs. It's off your storefront now — archive it when you're done with the record."
						: `No RSVPs yet. Share your storefront link and guests can sign up for ${moment}.`}
				</p>
			) : (
				<>
					{showBreakdown ? (
						<ul className="flex flex-col gap-1.5">
							{options.map((opt) => (
								<li
									key={opt.label}
									className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5 text-sm last:border-0 last:pb-0"
								>
									<span className="min-w-0 truncate">
										{opt.label === "" ? productName : opt.label}
									</span>
									<span className="shrink-0 font-semibold tabular-nums">
										{opt.seats}
									</span>
								</li>
							))}
						</ul>
					) : null}
					{/* The orders themselves are one tap away, pre-filtered to the
					    event's day — never "go to the inbox and find them". */}
					<Link
						to="/app/orders"
						// ITEM search, not the date-range filter: the inbox's from/to
						// bind to createdAt (when the order was PLACED), so pointing
						// them at the event day found nothing — caught live, the link
						// landed on "No orders match your filters". There is no
						// arbitrary fulfilment-day filter to use (fwin is only
						// today/tomorrow/this week), and every RSVP's frozen item name
						// is this product's name, so the search IS the tally's list.
						// A rename only affects future orders' frozen names — same
						// staleness the CSV's live category lookup already accepts.
						search={{ q: productName }}
						className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm font-medium transition-colors hover:bg-muted"
					>
						<Inbox className="size-4" aria-hidden />
						Open these {taken === 1 ? "RSVP" : "RSVPs"} in the inbox
					</Link>
				</>
			)}
		</section>
	);
}
