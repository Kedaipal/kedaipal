import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import {
	type ClosedDateRange,
	closureHeadsUp,
	formatClosedRange,
	formatClosedRangeShort,
	upcomingClosures,
} from "../../../convex/lib/closedDates";
import {
	DAY_MS,
	formatFulfilmentDate,
	formatFulfilmentTime,
	todayMytMidnight,
	weekdayIndexMyt,
} from "../../../convex/lib/fulfilmentDate";
import {
	isAllDay,
	type OpeningHours,
	openNowStatus,
	WEEKDAY_NAMES,
	WEEKDAY_NAMES_SHORT,
} from "../../../convex/lib/openingHours";
import { DayWindowsStacked } from "../hours/hours-text";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "../ui/dialog";

/**
 * Does the storefront header have anything to say about hours? Configured
 * weekly hours always do; a 24/7 store only when a closed date is running
 * today or starts within the heads-up window (z8r3fdhpm7). Everything else
 * stays clutter-free.
 */
export function hasHoursLine(
	hours: OpeningHours | undefined,
	closedDates: ReadonlyArray<ClosedDateRange> | undefined,
	now: number = Date.now(),
): boolean {
	if (hours) return true;
	const today = todayMytMidnight(now);
	return (
		upcomingClosures(closedDates, now).some(
			(range) => range.startDate <= today,
		) || closureHeadsUp(closedDates, now) !== null
	);
}

/** "today" / "tomorrow" / "Mon" within a week, then a date — a weekday name
 * alone is ambiguous once a closure pushes the reopening past next week. */
function whenAhead(today: number, daysAhead: number): string {
	if (daysAhead === 0) return "today";
	if (daysAhead === 1) return "tomorrow";
	const date = today + daysAhead * DAY_MS;
	return daysAhead < 7
		? WEEKDAY_NAMES_SHORT[weekdayIndexMyt(date)]
		: formatFulfilmentDate(date, { year: false }).replace(",", "");
}

/**
 * The storefront header's opening-hours line (86eyp5rav) — a live
 * "Open now · closes 9:00 PM" / "Closed · opens 9:00 AM tomorrow" status that
 * taps open the full weekly schedule. Closed dates (z8r3fdhpm7) speak here
 * too: "Closed today · Hari Raya · opens 9:00 AM Mon" on the day, and a
 * heads-up line ("Closed 1–3 Oct · Hari Raya") for one starting within two
 * weeks — the buyer learns before they pick a date, not at checkout.
 * Rendered only when `hasHoursLine` says there's something to say.
 *
 * The status text depends on the wall clock, so the SSR'd text and the
 * hydration render can disagree across a minute/midnight boundary —
 * `suppressHydrationWarning` covers exactly that (the React-sanctioned use:
 * timestamps), and a minute tick keeps it fresh while the page sits open.
 */
export function OpeningHoursLine({
	hours,
	closedDates,
	onCover,
}: {
	hours: OpeningHours | undefined;
	closedDates?: ReadonlyArray<ClosedDateRange>;
	onCover: boolean;
}) {
	// Re-render every minute so "Open now" flips without a reload. The state
	// value is the clock itself; reading Date.now() at render keeps SSR and
	// client on the same code path.
	const [, setTick] = useState(0);
	useEffect(() => {
		const timer = setInterval(() => setTick((t) => t + 1), 60_000);
		return () => clearInterval(timer);
	}, []);

	const now = Date.now();
	const today = todayMytMidnight(now);
	const status = openNowStatus(hours, now, closedDates);
	const todayIndex = weekdayIndexMyt(today);
	const headsUp = closureHeadsUp(closedDates, now);
	const closures = upcomingClosures(closedDates, now);

	// The live status. A 24/7 store only has one when a closed date is running
	// — otherwise "Open 24 hours today" every day is noise, and its line is
	// just the heads-up.
	let text: string | null = null;
	if (status.open) {
		// `until` is the close of the window the store is in RIGHT NOW, not the
		// day's last close — on a split day (z8r3fdff8r) the breakfast window is
		// about to shut, and "closes 6:00 PM" would be a lie.
		if (hours) {
			text = isAllDay(status.day)
				? "Open 24 hours today"
				: `Open now · closes ${formatFulfilmentTime(status.until)}`;
		}
	} else if (status.nextOpen) {
		// daysAhead 0 is "before we open" — which on a split day also covers the
		// lunch break, so "opens 12:00 PM today" is the line a buyer sees at
		// 11:00 rather than being told the store is shut until tomorrow. A
		// 24-hour reopening "reopens" — "opens 12:00 AM" is true but useless.
		const { daysAhead, openMinutes, allDay } = status.nextOpen;
		const when = whenAhead(today, daysAhead);
		const reopens = allDay
			? `reopens ${when}`
			: `opens ${formatFulfilmentTime(openMinutes)} ${when}`;
		text = status.closure
			? ["Closed today", status.closure.label, reopens]
					.filter(Boolean)
					.join(" · ")
			: `Closed · ${reopens}`;
	} else {
		// Defensive only — the settings sanitizer rejects an all-closed week.
		text = "Closed";
	}
	const headsUpText = headsUp
		? ["Closed", formatClosedRangeShort(headsUp)].join(" ") +
			(headsUp.label ? ` · ${headsUp.label}` : "")
		: null;

	return (
		<Dialog>
			<DialogTrigger asChild>
				<button
					type="button"
					// `text-left` + `items-start`: a closure's status can wrap to two
					// lines on a phone, and a <button> centres its text by default —
					// the icon then floated beside the middle of a centred block.
					className={`mt-0.5 flex items-start gap-1.5 self-start text-left text-sm underline-offset-2 hover:underline ${
						onCover ? "text-white/90 drop-shadow" : "text-muted-foreground"
					}`}
				>
					<Clock className="mt-[3px] size-3.5 shrink-0" aria-hidden="true" />
					<span suppressHydrationWarning className="flex flex-col">
						{text ? <span>{text}</span> : null}
						{/* A closure ahead is the one thing a buyer choosing a
						    pre-order date needs before checkout tells them. */}
						{headsUpText ? (
							<span className={text ? "text-xs" : undefined}>
								{headsUpText}
							</span>
						) : null}
					</span>
				</button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Opening hours</DialogTitle>
					<DialogDescription>
						{closures.length > 0
							? "Delivery and pickup dates at checkout can only be booked within these hours, and never on a closed date."
							: "Delivery and pickup dates at checkout can only be booked within these hours."}
					</DialogDescription>
				</DialogHeader>
				{hours ? (
					<ul className="flex flex-col gap-1.5 text-sm tabular-nums">
						{/* Monday-first for reading; the array itself is Sunday-indexed. */}
						{[1, 2, 3, 4, 5, 6, 0].map((i) => {
							const day = hours[i];
							const isToday = i === todayIndex;
							// Today's weekly hours don't apply when a closed date
							// covers today — the row must not read "open" above a
							// list that says the store is shut (z8r3fdhpm7).
							const closedToday =
								isToday && !status.open && status.closure !== undefined;
							return (
								<li
									key={WEEKDAY_NAMES[i]}
									className={`flex items-center justify-between rounded-lg px-2 py-1 ${
										isToday ? "bg-accent/10 font-semibold" : ""
									}`}
								>
									{/* Only rendered on open (post-hydration), so no
								    suppressHydrationWarning needed in here. */}
									<span>
										{WEEKDAY_NAMES[i]}
										{isToday ? " · Today" : ""}
									</span>
									{/* A split day stacks its windows. The same component as the
								    settings summary, so both sides read the week alike
								    (z8r3fdff8r). */}
									<span
										className={`text-right ${day?.closed || closedToday ? "text-muted-foreground" : ""}`}
									>
										{closedToday ? (
											"Closed today"
										) : !day || day.closed ? (
											"Closed"
										) : (
											<DayWindowsStacked day={day} />
										)}
									</span>
								</li>
							);
						})}
					</ul>
				) : (
					<p className="rounded-lg px-2 py-1 text-sm">
						Open every day, 24 hours
					</p>
				)}
				{closures.length > 0 ? (
					<section className="flex flex-col gap-1.5 border-t border-border pt-3">
						<h3 className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Closed dates
						</h3>
						<ul className="flex flex-col gap-1.5 text-sm">
							{closures.map((range) => (
								<li
									key={`${range.startDate}-${range.endDate}`}
									className={`flex items-start justify-between gap-3 rounded-lg px-2 py-1 ${
										range.startDate <= today ? "bg-accent/10 font-semibold" : ""
									}`}
								>
									<span>{formatClosedRange(range)}</span>
									{range.label ? (
										<span className="text-right text-muted-foreground">
											{range.label}
										</span>
									) : null}
								</li>
							))}
						</ul>
					</section>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
