import { Link } from "@tanstack/react-router";
import { CalendarDays, ChevronRight } from "lucide-react";
import { ymdFromEpoch } from "../../../convex/lib/fulfilmentDate";
import { planAheadHeadline, tileTintPct } from "../../lib/home-copy";
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
 * Tiles are full-width rounded squares — the board's shape, and 44px tall,
 * which is also the house tap-target floor. They tint with the accent in
 * proportion to the day's load (`tileTintPct`), and the BUSIEST day inverts to
 * the navy surface instead: the one day the seller should plan around is a
 * different thing, not merely a darker green. Every day renders, including the
 * empty ones — a quiet Wednesday is information, and a strip that skipped it
 * would make the week look denser than it is.
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
		<section className="flex flex-col gap-3" aria-label="Plan ahead">
			{/* The mobile board gives this its own section heading; in the desktop
			    rail the card sits under the hero with no heading of its own, so the
			    heading is phone-only rather than repeated chrome. */}
			<h2 className="flex items-center gap-2 font-heading text-lg font-extrabold tracking-tight lg:hidden">
				<span className="flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-emphasis">
					<CalendarDays className="size-3.5" aria-hidden="true" />
				</span>
				Plan ahead
			</h2>
			<article className="flex flex-col gap-3.5 rounded-[20px] border border-border bg-card p-4 shadow-[0_1px_2px_rgb(15_23_41/0.04)]">
				<div className="flex flex-col gap-2">
					<span className="flex items-center gap-2">
						<span className="flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-emphasis">
							<CalendarDays className="size-3.5" aria-hidden="true" />
						</span>
						<span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
							Orders due · next {days.length} days
						</span>
					</span>
					<h3 className="text-pretty font-heading text-[17px] font-extrabold leading-snug tracking-tight">
						{headline ?? "Nothing due in the next week"}
					</h3>
				</div>

				<ul className="grid grid-cols-7 gap-[3px]">
					{days.map((d) => {
						const isToday = d.start === todayStart;
						const peak = busiest > 0 && d.count === busiest;
						const tint = tileTintPct(d.count);
						return (
							<li key={d.start} className="min-w-0">
								<Link
									to="/app/orders"
									// The SAME question the tile counted: orders DUE that day
									// (`ffrom`/`fto` bound `fulfilmentDate`), still open, and
									// never counter sales. `from`/`to` would bound when the
									// order was PLACED instead — which is why a tile reading
									// "2" opened a list of 6.
									search={{
										ffrom: d.start,
										fto: d.start,
										bucket: ["new", "in_progress"] as const,
										// Everything that is not a walk-in. An order with no
										// source recorded reads as "storefront", the same
										// default the count applies.
										sources: ["storefront", "claim"] as const,
									}}
									aria-label={`${isToday ? "Today" : weekdayLong(d.start)}, ${d.count} ${d.count === 1 ? "order" : "orders"} due`}
									className="flex flex-col items-center gap-1 rounded-xl text-inherit"
								>
									<span
										className={cn(
											"text-[11px]",
											isToday
												? "font-bold text-foreground"
												: "text-muted-foreground",
										)}
									>
										{isToday ? "Today" : weekdayShort(d.start)}
									</span>
									<span
										title={ymdFromEpoch(d.start)}
										style={
											peak || tint === null
												? undefined
												: {
														background: `color-mix(in srgb, var(--accent) ${tint}%, var(--card))`,
													}
										}
										className={cn(
											// 12px is the board's own radius — NOT `rounded-xl`, which is 16.8px
											// in this theme and turns a ~41px rail tile into an oval. The
											// squircle is the shape; the radius is what makes it one.
											"flex h-11 w-full items-center justify-center rounded-[12px] font-heading text-base font-extrabold tabular-nums transition-opacity hover:opacity-85",
											peak
												? "bg-foreground text-background"
												: tint === null
													? "bg-muted text-muted-foreground"
													: "text-foreground",
										)}
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
			</article>
		</section>
	);
}
