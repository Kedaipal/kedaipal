// The buyer's availability calendar (S2, design 86eym0pjg — Variant A,
// locked 16 Aug: inline in the checkout step, never a sheet). Controlled +
// presentational: the parent owns the availability query and the selection;
// this renders one month, wires the two-tap picks through the pure reducer in
// src/lib/booking-dates.ts, and never talks to the network.
//
// Rendering rules (locked): unavailable nights are greyed + struck and full
// vs seller-blocked are NEVER distinguished; weeks start Monday (Sat + Sun
// adjacent — it's a weekend business); once a check-in is picked, days past
// the reachable window disable and the first full night renders dashed —
// selectable as the LEAVING morning only (its night isn't slept).

import { useMemo } from "react";
import {
	calendarDateFromMytEpoch,
	canCheckIn,
	latestCheckOutFor,
	mytEpochFromCalendarDate,
	type BookingSelection,
	type SelectionContext,
} from "../../lib/booking-dates";
import { Calendar } from "../ui/calendar";

export function BookingCalendar({
	selection,
	onSelect,
	ctx,
	month,
	onMonthChange,
	minMonth,
	maxMonth,
}: {
	selection: BookingSelection;
	onSelect: (day: number) => void;
	ctx: SelectionContext;
	/** MYT month-start epoch of the visible month (parent-owned so the
	 * availability window follows navigation). */
	month: number;
	onMonthChange: (monthStart: number) => void;
	minMonth: number;
	maxMonth: number;
}) {
	const pickingCheckOut =
		selection.checkIn !== undefined && selection.checkOut === undefined;
	const checkoutCeiling =
		pickingCheckOut && selection.checkIn !== undefined
			? latestCheckOutFor(selection.checkIn, ctx)
			: undefined;

	const modifiers = useMemo(() => {
		const unavailable = [...ctx.unavailable].map(calendarDateFromMytEpoch);
		return {
			unavailable,
			// The stay band. checkOut is the leaving MORNING — still shown as the
			// range end (that's the day the guest taps), the nights logic already
			// treats it as unslept.
			stay_start:
				selection.checkIn !== undefined
					? calendarDateFromMytEpoch(selection.checkIn)
					: [],
			stay_end:
				selection.checkOut !== undefined
					? calendarDateFromMytEpoch(selection.checkOut)
					: [],
			stay_middle:
				selection.checkIn !== undefined && selection.checkOut !== undefined
					? {
							after: calendarDateFromMytEpoch(selection.checkIn),
							before: calendarDateFromMytEpoch(selection.checkOut),
						}
					: [],
			// While picking the check-out, the first full night is the one day
			// that's tappable DESPITE being unavailable — dashed, per the design.
			checkout_only:
				checkoutCeiling !== undefined && ctx.unavailable.has(checkoutCeiling)
					? calendarDateFromMytEpoch(checkoutCeiling)
					: [],
		};
	}, [ctx.unavailable, selection.checkIn, selection.checkOut, checkoutCeiling]);

	return (
		<Calendar
			// Monday start: Sat+Sun sit adjacent for weekend-led booking.
			weekStartsOn={1}
			month={calendarDateFromMytEpoch(month)}
			onMonthChange={(m) => onMonthChange(mytEpochFromCalendarDate(m))}
			startMonth={calendarDateFromMytEpoch(minMonth)}
			endMonth={calendarDateFromMytEpoch(maxMonth)}
			className="w-full"
			classNames={{
				month_grid: "w-full border-collapse",
				weekdays: "grid grid-cols-7",
				weekday: "w-auto text-[11px] font-medium text-muted-foreground",
				week: "mt-1 grid w-full grid-cols-7 gap-0",
				day: "relative p-0 text-center text-sm",
			}}
			modifiers={modifiers}
			modifiersClassNames={{
				unavailable:
					"[&>button]:text-muted-foreground/60 [&>button]:line-through [&>button]:decoration-muted-foreground/50 [&>button]:bg-muted [&>button]:rounded-lg [&>button]:hover:bg-muted",
				stay_start:
					"[&>button]:!bg-primary [&>button]:!text-primary-foreground [&>button]:font-semibold [&>button]:!rounded-lg",
				stay_end:
					"[&>button]:!bg-primary [&>button]:!text-primary-foreground [&>button]:font-semibold [&>button]:!rounded-lg [&>button]:!no-underline",
				stay_middle:
					"[&>button]:bg-accent/15 [&>button]:text-accent-emphasis [&>button]:font-semibold [&>button]:rounded-lg",
				checkout_only:
					"[&>button]:border [&>button]:border-dashed [&>button]:border-ring [&>button]:!bg-transparent [&>button]:!text-muted-foreground [&>button]:!line-through",
			}}
			disabled={(date) => {
				const day = mytEpochFromCalendarDate(date);
				if (pickingCheckOut && selection.checkIn !== undefined) {
					// Phase 2: earlier days stay enabled ONLY where they could start a
					// fresh stay (a tap restarts there); later days cap at the ceiling.
					if (day > selection.checkIn) {
						return checkoutCeiling !== undefined && day > checkoutCeiling;
					}
					return !canCheckIn(day, ctx);
				}
				return !canCheckIn(day, ctx);
			}}
			onDayClick={(date, dayModifiers) => {
				if (dayModifiers.disabled) return;
				onSelect(mytEpochFromCalendarDate(date));
			}}
			// Day cells stretch to the grid columns (the wrapper's size-9 is for
			// the compact insights picker; checkout wants the full card width with
			// ≥44px touch targets).
			styles={{ day_button: { width: "100%", minHeight: "2.75rem" } }}
		/>
	);
}

/** The legend under the calendar — states only, never the blocked/full split. */
export function BookingCalendarLegend() {
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
			<span className="flex items-center gap-1.5">
				<i className="size-3.5 rounded border border-border bg-card" aria-hidden />
				Available
			</span>
			<span className="flex items-center gap-1.5">
				<i className="size-3.5 rounded bg-muted" aria-hidden />
				Unavailable
			</span>
			<span className="flex items-center gap-1.5">
				<i className="size-3.5 rounded bg-primary" aria-hidden />
				Your stay
			</span>
		</div>
	);
}
