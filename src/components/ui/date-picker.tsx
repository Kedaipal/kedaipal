/**
 * The themed single-date picker (z8r3fdm36y) — a trigger shaped like a form
 * field, opening the house `Calendar` in a popover.
 *
 * Replaces the native `<input type="date">` the checkout date used. The native
 * control was chosen deliberately (the OS wheel is mobile-first and costs
 * nothing), but it has a limit the checkout had already run into and written
 * down — `checkout-form.tsx` said it outright:
 *
 *   "...the native date input can't skip weekdays, so a picked closed day gets
 *    an immediate explanation instead of a submit-time bounce."
 *
 * A native date input takes `min`/`max` and nothing else, so a store's CLOSED
 * dates, a weekday it never opens, and a day the cart's prep time can no longer
 * reach were all **offered**, and the buyer learned they were wrong by being
 * told off after choosing. The storefront already computed exactly which days
 * are pickable (`isFulfilmentDaySelectable`) and used it for the quick-pick
 * chips — the picker just had no way to honour it. `isDayDisabled` is that way.
 *
 * Disabled-with-reason over wrong-but-enabled, and it brings the checkout in
 * line with its own sibling: `storefront/booking-calendar.tsx` has always shown
 * unpickable days for what they are.
 *
 * **Popover, not the inline grid the booking checkout locked.** There the
 * calendar IS the step, so it stands open; here the date is one field among a
 * method, an address, a time, a name and a number, and an always-open month
 * grid buries the rest of the form on a phone. The calendar *inside* is the
 * same component in both, which is the part that had to stay one idea.
 */

import { CalendarDays } from "lucide-react";
import { useState } from "react";
import {
	Calendar,
	TOUCH_CALENDAR_CLASSNAMES,
	TOUCH_CALENDAR_STYLES,
} from "#/components/ui/calendar";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover";
// The chips' own formatter — imported rather than re-implemented so the two
// surfaces cannot drift (see `formatPickedDate`).
import { ymdChipLabel } from "#/lib/checkout-dates";
import { cn } from "#/lib/utils";

/** `"2026-10-03"` → the local `Date` naming that calendar day (never an epoch:
 * DayPicker deals in local dates and only y/m/d matter). */
export function dateFromYmd(ymd: string): Date | undefined {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
	if (!m) return undefined;
	const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Inverse of `dateFromYmd`. */
export function ymdFromDate(date: Date): string {
	const mm = `${date.getMonth() + 1}`.padStart(2, "0");
	const dd = `${date.getDate()}`.padStart(2, "0");
	return `${date.getFullYear()}-${mm}-${dd}`;
}

/**
 * "Thu, 8 Oct" — and "Thu, 8 Jan 2027" only when the year is not the current
 * one (z8r3fdm36y test run).
 *
 * Two things fixed at once. It **reuses `ymdChipLabel`**, which is what the
 * quick-pick chips directly above this field already print, so the chip and the
 * field can no longer say the same date in two different ways — they are one
 * idea and now one formatter. And dropping the redundant year is what makes it
 * FIT: Date and Time share a two-column row, which leaves the date ~145px on a
 * 375px phone, and "Thu, 8 Oct 2026" truncated to "Thu, 8 Oct…" there.
 *
 * Day-first throughout, never `03/10`: in this market `03/10` and `10/03` are
 * opposite dates, so the month is always a word.
 */
export function formatPickedDate(ymd: string, now: Date = new Date()): string {
	const date = dateFromYmd(ymd);
	if (!date) return "";
	const label = ymdChipLabel(ymd);
	return date.getFullYear() === now.getFullYear()
		? label
		: `${label} ${date.getFullYear()}`;
}

export interface DatePickerProps {
	/** "YYYY-MM-DD", or "" for nothing picked. */
	value: string;
	onChange: (ymd: string) => void;
	/** Earliest selectable day, "YYYY-MM-DD". */
	min?: string;
	/** Latest selectable day, "YYYY-MM-DD". */
	max?: string;
	/**
	 * Days inside `min`..`max` that still can't be picked — a store closed date,
	 * a weekday it never opens, a today the cart's prep has used up. Returning
	 * `true` greys the day out and refuses the tap, instead of taking the pick
	 * and rejecting it afterwards.
	 */
	isDayDisabled?: (ymd: string) => boolean;
	/**
	 * One line under the grid naming WHY days are greyed, e.g. "Days the store
	 * is closed can't be picked." A constraint the buyer can see enforced must
	 * be a constraint the buyer can see explained.
	 */
	unavailableNote?: string;
	disabled?: boolean;
	isError?: boolean;
	id?: string;
	name?: string;
	placeholder?: string;
	/**
	 * The field's visible label ("Date"). Needed because `<button>` is a
	 * *labelable* element, so the `<label for>` beside it WINS over the button's
	 * own text and the control announces "Date" with no date in it — strictly
	 * worse than the native `<input type="date">` this replaced, which exposed
	 * its value. Given a label, the trigger names itself "Date: Thu, 8 Oct".
	 */
	label?: string;
	onBlur?: () => void;
	/** Wired by the field wrapper so the label and error read out with it. */
	"aria-describedby"?: string;
}

export function DatePicker({
	value,
	onChange,
	min,
	max,
	isDayDisabled,
	unavailableNote,
	disabled = false,
	isError = false,
	id,
	name,
	placeholder = "Pick a date",
	label,
	onBlur,
	"aria-describedby": describedBy,
}: DatePickerProps) {
	const [open, setOpen] = useState(false);
	const selected = value ? dateFromYmd(value) : undefined;
	// The visible month is DERIVED, never synced: state holds only the month the
	// buyer navigated to, and everything else falls out of the value. An effect
	// mirroring `value` into month state is the classic duplicate-source-of-truth
	// bug — it renders one frame on the stale month before correcting itself.
	const [browsedMonth, setBrowsedMonth] = useState<Date | undefined>(undefined);
	const month =
		browsedMonth ?? selected ?? (min ? dateFromYmd(min) : undefined);

	const minDate = min ? dateFromYmd(min) : undefined;
	const maxDate = max ? dateFromYmd(max) : undefined;

	// What the control reads out. `aria-label` beats the `<label for>`, which is
	// the whole point: without it a screen reader says "Date, button" and the
	// chosen date is invisible. Falls back to the placeholder so an empty field
	// announces what it wants rather than going silent.
	const valueText = value ? formatPickedDate(value) : placeholder;
	const triggerLabel = label ? `${label}: ${valueText}` : valueText;

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				// Reopening lands on the picked date's month, not wherever the buyer
				// had browsed to last time and abandoned.
				if (next) setBrowsedMonth(undefined);
				// Closing is when the buyer is "done with" the field, so this is where
				// a touched-state validator should fire — same moment a native input's
				// blur fired.
				else onBlur?.();
			}}
		>
			<PopoverTrigger asChild>
				<button
					type="button"
					id={id}
					name={name}
					disabled={disabled}
					aria-invalid={isError || undefined}
					aria-describedby={describedBy}
					aria-label={triggerLabel}
					className={cn(
						// Deliberately the `field` input variant's chrome, class for
						// class: this sits in a column with real inputs and any drift
						// between them reads as a bug.
						"flex min-h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-input bg-transparent px-4 text-left text-base transition-colors outline-none",
						"focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
						"disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50",
						"aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
						"dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
					)}
				>
					<CalendarDays
						aria-hidden
						className="size-4 shrink-0 text-muted-foreground"
					/>
					<span
						className={cn(
							"flex-1 truncate",
							value ? undefined : "text-muted-foreground",
						)}
					>
						{valueText}
					</span>
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				// Wider than the popover default (`w-72`) so a 7-column grid with 44px
				// targets isn't cramped, and capped to the viewport on a small phone.
				className="w-[min(20rem,calc(100vw-2rem))] gap-2"
			>
				<Calendar
					mode="single"
					selected={selected}
					month={month}
					onMonthChange={setBrowsedMonth}
					startMonth={minDate}
					endMonth={maxDate}
					className="w-full"
					classNames={TOUCH_CALENDAR_CLASSNAMES}
					styles={TOUCH_CALENDAR_STYLES}
					disabled={(date) => {
						const ymd = ymdFromDate(date);
						if (min && ymd < min) return true;
						if (max && ymd > max) return true;
						return isDayDisabled?.(ymd) ?? false;
					}}
					onSelect={(date) => {
						// `undefined` is DayPicker re-reporting a tap on the day already
						// chosen. Clearing a REQUIRED fulfilment date there would be a
						// trap, so a second tap just closes.
						if (date) onChange(ymdFromDate(date));
						setOpen(false);
					}}
					modifiersClassNames={{
						selected:
							"!bg-primary !text-primary-foreground hover:!bg-primary font-semibold !rounded-lg",
					}}
				/>
				{unavailableNote ? (
					<p className="border-t border-border pt-2 text-[11px] leading-snug text-muted-foreground">
						{unavailableNote}
					</p>
				) : null}
			</PopoverContent>
		</Popover>
	);
}
