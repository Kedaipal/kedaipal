/**
 * "How are the N days counted?" (ClickUp `z8r3fdhpm7`) — the one choice that
 * decides what a store closure does to a DAY package: run through it (access
 * time — a pass, a rental) or skip it (days of service — a course, a camp, a
 * class pass). One component for the product form AND the wizard, so the two
 * doors ask the same question in the same words.
 *
 * The consequence line is built from the store's OWN schedule — a real start
 * date, the day it would end, and the days it would skip — because "closed
 * days are skipped" in the abstract doesn't tell a seller whether their
 * 5-day course now ends on the Tuesday or the Friday. A store with nothing to
 * skip is told so, with the way to set its days off, rather than having the
 * option hidden (it may add a closure tomorrow).
 */

import { Link } from "@tanstack/react-router";
import { resolveOpenDaysTerm } from "../../../convex/lib/bookingAvailability";
import {
	type ClosedDateRange,
	upcomingClosures,
} from "../../../convex/lib/closedDates";
import { DAY_MS, todayMytMidnight } from "../../../convex/lib/fulfilmentDate";
import {
	closedWeekdays,
	type OpeningHours,
	storeClosedOn,
} from "../../../convex/lib/openingHours";
import {
	bookingSpanCounted,
	describeNights,
	formatNight,
} from "../../lib/booking-dates";
import { ModeButton } from "../ui/mode-button";

/** How far ahead the example looks for a start whose term skips something —
 * a weekly day off always shows up inside a fortnight. */
const EXAMPLE_SCAN_DAYS = 21;

/**
 * A worked example from the store's own schedule: the first start (from
 * tomorrow) whose term actually steps over a shut day, so the line shows the
 * rule doing something. `null` when nothing in reach is ever skipped.
 */
export function openDaysExample(
	packageLength: number,
	hours: OpeningHours | undefined,
	closedDates: ReadonlyArray<ClosedDateRange> | undefined,
	now: number = Date.now(),
): { start: number; lastDay: number; skipped: number[] } | null {
	const isClosed = storeClosedOn(closedWeekdays(hours), closedDates);
	const tomorrow = todayMytMidnight(now) + DAY_MS;
	for (let i = 0; i < EXAMPLE_SCAN_DAYS; i++) {
		const start = tomorrow + i * DAY_MS;
		if (isClosed(start)) continue;
		try {
			const term = resolveOpenDaysTerm(start, packageLength, isClosed);
			if (term.skipped.length > 0) {
				return {
					start,
					lastDay: term.checkOut - DAY_MS,
					skipped: term.skipped,
				};
			}
		} catch {
			return null;
		}
	}
	return null;
}

/** The store facts the field reads — handed down by the route, the way it
 * already hands down `weightMode` / `offerSelfCollect`. */
export type StoreSchedule = {
	openingHours?: OpeningHours;
	closedDates?: ClosedDateRange[];
};

export function PackageDayCounting({
	packageLength,
	skipsClosedDays,
	onChange,
	schedule,
}: {
	/** The package's length in days, already validated (> 0). */
	packageLength: number;
	skipsClosedDays: boolean;
	onChange: (next: boolean) => void;
	/** The store's schedule. Absent = unknown: the line stays generic rather
	 * than claiming the store is open every day. */
	schedule: StoreSchedule | undefined;
}) {
	const hours = schedule?.openingHours;
	const closures = upcomingClosures(schedule?.closedDates);
	const nothingToSkip =
		schedule !== undefined &&
		closedWeekdays(hours).length === 0 &&
		closures.length === 0;
	const example =
		schedule && !nothingToSkip
			? openDaysExample(packageLength, hours, closures)
			: null;
	const span = bookingSpanCounted(packageLength, "day");

	return (
		<div className="flex flex-col gap-2 border-t border-border pt-4">
			<span className="text-sm font-medium">How are the {span} counted?</span>
			<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
				<ModeButton
					active={!skipsClosedDays}
					onClick={() => onChange(false)}
					title="Every day in a row"
					subtitle="The clock runs on days you're closed too — a pass, a rental."
				/>
				<ModeButton
					active={skipsClosedDays}
					onClick={() => onChange(true)}
					title="Only days you're open"
					subtitle="Closed days are skipped, so it ends later — a course, a class pass."
				/>
			</div>
			<p className="text-xs leading-relaxed text-muted-foreground">
				{nothingToSkip ? (
					<>
						Your store is open every day with no closed dates, so both read the
						same today.{" "}
						{skipsClosedDays
							? "Days you close later will be skipped automatically. "
							: ""}
						Set your days off in{" "}
						<Link
							to="/app/settings"
							search={{ tab: "fulfilment", spot: "opening_hours" }}
							className="font-medium text-accent hover:underline"
						>
							Settings → Fulfilment
						</Link>
						.
					</>
				) : skipsClosedDays ? (
					example ? (
						<>
							Starting {formatNight(example.start)}, it runs to{" "}
							{formatNight(example.lastDay)} — skips{" "}
							{describeNights(example.skipped, formatNight, "day")}. Buyers see
							the skipped days before they book, and can&apos;t start on a day
							you&apos;re closed.
						</>
					) : (
						"Your closed days are skipped, so the package ends later. Buyers see the skipped days before they book, and can't start on a day you're closed."
					)
				) : (
					`Runs ${span} in a row from the start date. Days you're closed after it still count, and buyers are told about any closed dates inside their package — it just can't start on a day you're closed.`
				)}
			</p>
		</div>
	);
}
