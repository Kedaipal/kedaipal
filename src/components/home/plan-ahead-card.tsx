import { Link } from "@tanstack/react-router";
import { CalendarDays, ChevronRight } from "lucide-react";
import { ymdFromEpoch } from "../../../convex/lib/fulfilmentDate";
import { planAheadHeadline } from "../../lib/home-copy";
import { cn } from "../../lib/utils";

/** Short weekday for a MYT-midnight bucket, in the dashboard's EN chrome. */
function weekdayShort(start: number): string {
	return new Date(start).toLocaleDateString("en-GB", {
		weekday: "short",
		timeZone: "Asia/Kuala_Lumpur",
	});
}

function weekdayLong(start: number): string {
	return new Date(start).toLocaleDateString("en-GB", {
		weekday: "long",
		timeZone: "Asia/Kuala_Lumpur",
	});
}

/**
 * The week ahead (z8r3fdrgzj).
 *
 * PERIOD-INDEPENDENT on purpose: the chips above change what the seller has
 * ALREADY earned, while this answers what is coming. Tying it to a "30 days"
 * chip would be a forecast of the past.
 *
 * Every day renders, including the empty ones — a quiet Wednesday is
 * information, and a strip that skipped it would make the week look denser
 * than it is.
 */
export function PlanAheadCard({
	days,
	todayStart,
}: {
	days: ReadonlyArray<{ start: number; count: number }>;
	todayStart: number;
}) {
	const headline = planAheadHeadline({
		days,
		weekdayName: weekdayLong,
		todayStart,
	});
	const busiest = days.reduce((m, d) => Math.max(m, d.count), 0);

	return (
		<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
			<p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
				<CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
				Orders due · next {days.length} days
			</p>
			<h3 className="font-heading text-[17px] font-extrabold leading-snug tracking-tight">
				{headline ?? "Nothing due in the next week"}
			</h3>
			<ul className="flex gap-1.5">
				{days.map((d) => {
					const isToday = d.start === todayStart;
					const peak = busiest > 0 && d.count === busiest;
					return (
						<li key={d.start} className="min-w-0 flex-1">
							<Link
								to="/app/orders"
								search={{ from: d.start, to: d.start + 86_399_999 }}
								aria-label={`${isToday ? "Today" : weekdayLong(d.start)}, ${d.count} ${d.count === 1 ? "order" : "orders"} due`}
								className="flex min-h-11 flex-col items-center gap-1 rounded-xl py-1 transition-opacity hover:opacity-80"
							>
								<span
									className={cn(
										"text-[10px] font-semibold",
										isToday ? "text-foreground" : "text-muted-foreground",
									)}
								>
									{isToday ? "Today" : weekdayShort(d.start)}
								</span>
								<span
									className={cn(
										"flex size-9 items-center justify-center rounded-xl text-sm font-bold tabular-nums",
										peak
											? "bg-foreground text-background"
											: d.count > 0
												? "bg-accent/25 text-foreground"
												: "bg-muted text-muted-foreground",
									)}
									title={ymdFromEpoch(d.start)}
								>
									{d.count}
								</span>
							</Link>
						</li>
					);
				})}
			</ul>
			<Link
				to="/app/orders/calendar"
				className="-mx-1 -mb-1 flex min-h-11 items-center justify-between gap-2 rounded-xl px-1 text-sm font-semibold text-accent-emphasis hover:underline"
			>
				Open the calendar
				<ChevronRight className="size-4 shrink-0" aria-hidden="true" />
			</Link>
		</section>
	);
}
