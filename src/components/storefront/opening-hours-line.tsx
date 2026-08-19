import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import {
	formatFulfilmentTime,
	todayMytMidnight,
} from "../../../convex/lib/fulfilmentDate";
import {
	formatDayWindow,
	isAllDay,
	type OpeningHours,
	openNowStatus,
	WEEKDAY_NAMES,
	WEEKDAY_NAMES_SHORT,
	weekdayIndexMyt,
} from "../../../convex/lib/openingHours";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "../ui/dialog";

/**
 * The storefront header's opening-hours line (86eyp5rav) — a live
 * "Open now · closes 9:00 PM" / "Closed · opens 9:00 AM tomorrow" status that
 * taps open the full weekly schedule. Rendered only when the store has
 * configured hours (the 24/7 default shows nothing — no clutter for the
 * stores the rule doesn't bind).
 *
 * The status text depends on the wall clock, so the SSR'd text and the
 * hydration render can disagree across a minute/midnight boundary —
 * `suppressHydrationWarning` covers exactly that (the React-sanctioned use:
 * timestamps), and a minute tick keeps it fresh while the page sits open.
 */
export function OpeningHoursLine({
	hours,
	onCover,
}: {
	hours: OpeningHours;
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
	const status = openNowStatus(hours, now);
	const todayIndex = weekdayIndexMyt(todayMytMidnight(now));

	let text: string;
	if (status.open) {
		text = isAllDay(status.day)
			? "Open 24 hours today"
			: `Open now · closes ${formatFulfilmentTime(status.day.close)}`;
	} else if (status.nextOpen) {
		const { daysAhead, openMinutes } = status.nextOpen;
		const when =
			daysAhead === 0
				? "today"
				: daysAhead === 1
					? "tomorrow"
					: WEEKDAY_NAMES_SHORT[(todayIndex + daysAhead) % 7];
		text = `Closed · opens ${formatFulfilmentTime(openMinutes)} ${when}`;
	} else {
		// Defensive only — the settings sanitizer rejects an all-closed week.
		text = "Closed";
	}

	return (
		<Dialog>
			<DialogTrigger asChild>
				<button
					type="button"
					className={`mt-0.5 flex items-center gap-1.5 self-start text-sm underline-offset-2 hover:underline ${
						onCover ? "text-white/90 drop-shadow" : "text-muted-foreground"
					}`}
				>
					<Clock className="size-3.5 shrink-0" aria-hidden="true" />
					<span suppressHydrationWarning>{text}</span>
				</button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Opening hours</DialogTitle>
					<DialogDescription>
						Delivery and pickup dates at checkout can only be booked within
						these hours.
					</DialogDescription>
				</DialogHeader>
				<ul className="flex flex-col gap-1.5 text-sm tabular-nums">
					{/* Monday-first for reading; the array itself is Sunday-indexed. */}
					{[1, 2, 3, 4, 5, 6, 0].map((i) => {
						const day = hours[i];
						const isToday = i === todayIndex;
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
								<span
									className={
										day?.closed ? "text-muted-foreground" : undefined
									}
								>
									{!day || day.closed ? "Closed" : formatDayWindow(day)}
								</span>
							</li>
						);
					})}
				</ul>
			</DialogContent>
		</Dialog>
	);
}
