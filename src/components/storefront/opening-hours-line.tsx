import { CalendarDays, ChevronDown } from "lucide-react";
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
	variant = "hero",
}: {
	hours: OpeningHours | undefined;
	closedDates?: ReadonlyArray<ClosedDateRange>;
	onCover: boolean;
	/**
	 * "hero" — status pill(s) on the store-home header (z8r3fdegb5): a
	 * rounded chip with a live open/closed dot, glassy on a cover image.
	 * "bar" — the compact subpage app bar's one-liner: 11px muted text with
	 * the same dot, truncating to a single line.
	 * "island" — the store home's island card facts block (z8r3fdvwcy): a
	 * plain 13px row (dot · status · chevron) rather than a pill, because the
	 * card is already the lozenge; a closure ahead is its own amber line
	 * under it. All three open the same weekly schedule dialog.
	 */
	variant?: "hero" | "bar" | "island";
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
	// "7:30 AM" as ONE unit — on a phone the line broke as "opens 7:30 / AM
	// tomorrow", a time split from its half of the day.
	const time = (minutes: number) =>
		formatFulfilmentTime(minutes).replace(" ", "\u00A0");
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
				: `Open now · closes ${time(status.until)}`;
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
			: `opens ${time(openMinutes)} ${when}`;
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

	// The live open/closed signal — mint when open, dimmed when shut. It
	// replaced the Clock glyph in the polish pass (z8r3fdegb5): a state dot
	// says more than a static icon in the same 6px.
	const statusDot = (
		<span
			aria-hidden
			className={`size-1.5 shrink-0 rounded-full ${
				status.open
					? "bg-accent"
					: onCover
						? "bg-white/60"
						: "bg-muted-foreground/60"
			}`}
		/>
	);
	const pillClass = onCover
		? "flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-2.5 py-1 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-white/25"
		: "flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted";

	// The island's lead word carries the state colour ("Open now" mint,
	// "Closed" muted); the rest of the line reads in the foreground. Split on
	// the first separator so "Closed today · Hari Raya · reopens…" keeps its
	// tail readable.
	const islandLine = (line: string) => {
		const [lead, ...rest] = line.split(" · ");
		return (
			<>
				<span
					className={`font-semibold ${status.open ? "text-accent-emphasis" : "text-muted-foreground"}`}
				>
					{lead}
				</span>
				{/* The separator is a bare text node, not the span's first
				    child: the accessible-name algorithm trims each element's
				    text, and " · " inside the span lost its leading space
				    ("Closed today· Hari Raya"). */}
				{rest.length > 0 ? (
					<>
						{" · "}
						<span className="font-medium text-foreground">
							{rest.join(" · ")}
						</span>
					</>
				) : null}
			</>
		);
	};

	return (
		<>
			<Dialog>
				<DialogTrigger asChild>
					{variant === "island" ? (
						// `min-h-11` with negative vertical margins: a 44px hit area
						// that occupies the row's 24px in the flow, so the card's
						// rhythm holds and the only way into the weekly schedule is
						// still a full tap target.
						<button
							type="button"
							className="-my-2.5 flex min-h-11 w-full items-center gap-2 rounded-md py-2.5 text-left text-[13px] leading-snug focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none lg:text-sm"
						>
							{text ? (
								<span
									aria-hidden
									className={`size-2 shrink-0 rounded-full ring-[3px] ${
										status.open
											? "bg-accent ring-accent/20"
											: "bg-muted-foreground/60 ring-muted-foreground/15"
									}`}
								/>
							) : (
								// A 24/7 store with only a closure ahead: the heads-up IS
								// the row, in its own amber — never the live-status
								// colouring, which would paint "Closed 1–3 Oct" mint on
								// an open store.
								<CalendarDays
									className="size-4 shrink-0 text-amber-700 dark:text-amber-300"
									aria-hidden
								/>
							)}
							<span suppressHydrationWarning className="min-w-0 flex-1">
								{text ? (
									islandLine(text)
								) : (
									<span className="font-semibold text-amber-700 dark:text-amber-300">
										{headsUpText}
									</span>
								)}
							</span>
							<ChevronDown
								className="size-4 shrink-0 text-muted-foreground"
								aria-hidden
							/>
						</button>
					) : variant === "bar" ? (
						// One line only — the status wins; a heads-up-only 24/7 store
						// shows its closure instead. The dialog carries the full list.
						<button
							type="button"
							className="flex min-w-0 items-center gap-1.5 self-start text-left text-[11px] leading-tight text-muted-foreground underline-offset-2 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
						>
							{statusDot}
							<span suppressHydrationWarning className="truncate">
								{text ?? headsUpText}
							</span>
						</button>
					) : (
						// `text-left` + wrap: a closure's status can run long on a phone;
						// each line is its own pill so the lozenge shape survives a wrap.
						<button
							type="button"
							className="mt-1 flex flex-wrap items-center gap-1.5 self-start rounded-full text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
						>
							{text ? (
								<span className={pillClass}>
									{statusDot}
									<span suppressHydrationWarning>{text}</span>
								</span>
							) : null}
							{/* A closure ahead is the one thing a buyer choosing a
						    pre-order date needs before checkout tells them. */}
							{headsUpText ? (
								<span
									suppressHydrationWarning
									className={`${pillClass} ${text ? "text-[11px]" : ""}`}
								>
									{text ? null : statusDot}
									{headsUpText}
								</span>
							) : null}
						</button>
					)}
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
											range.startDate <= today
												? "bg-accent/10 font-semibold"
												: ""
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
			{/* A closure ahead is the one thing a buyer choosing a pre-order date
		    needs before checkout tells them — on the island it is its own
		    line, amber, when the status row is already taken. */}
			{variant === "island" && text && headsUpText ? (
				<p
					suppressHydrationWarning
					className="flex min-h-6 items-center gap-2 text-[13px] leading-snug lg:text-sm"
				>
					<CalendarDays
						className="size-4 shrink-0 text-amber-700 dark:text-amber-300"
						aria-hidden
					/>
					<span className="min-w-0 font-semibold text-amber-700 dark:text-amber-300">
						{headsUpText}
					</span>
				</p>
			) : null}
		</>
	);
}
