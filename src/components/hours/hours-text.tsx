import { Fragment } from "react";
import { formatFulfilmentTime } from "../../../convex/lib/fulfilmentDate";
import {
	type DayHours,
	type DayWindow,
	dayWindows,
	isAllDay,
} from "../../../convex/lib/openingHours";
import { type CopyPart, formatRange } from "../../lib/fulfilment-time-issue";

/**
 * Opening-hours text, shared by every surface that shows hours: the settings
 * summary and editor, the storefront schedule dialog, the checkout hints and
 * notices. One rendering means one reading.
 *
 * The rule that earns a module: a time range never breaks across lines. In a
 * half-width field hint on a phone, "open 4:30 PM – 5:30 PM, 7:00 PM – 9:00 PM"
 * wrapped to "4:30 PM –⏎5:30 PM, 7:00 PM – 9:00⏎PM", which reads as scattered
 * numbers. The line may break BETWEEN ranges, never inside one. That lives here
 * rather than as non-breaking spaces in the shared formatter, whose strings
 * also go into server errors, WhatsApp and PDFs.
 */

/** "4:30 PM – 5:30 PM", as one unbreakable unit. */
export function TimeRange({ range }: { range: DayWindow }) {
	return <span className="whitespace-nowrap">{formatRange(range)}</span>;
}

/** One time ("7:00 PM") that never splits from its AM/PM. */
export function TimeText({ minutes }: { minutes: number }) {
	return (
		<span className="whitespace-nowrap">{formatFulfilmentTime(minutes)}</span>
	);
}

/** A sentence from `CopyPart`s, keeping each time and range whole. */
export function CopyText({ parts }: { parts: CopyPart[] }) {
	return (
		<>
			{parts.map((part, i) =>
				typeof part === "string" ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: parts are a fixed-order sentence, never reordered.
					<Fragment key={i}>{part}</Fragment>
				) : "time" in part ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: parts are a fixed-order sentence, never reordered.
					<TimeText key={i} minutes={part.time} />
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: parts are a fixed-order sentence, never reordered.
					<TimeRange key={i} range={part.range} />
				),
			)}
		</>
	);
}

/** A day's windows inside a sentence: "4:30 PM – 5:30 PM, 7:00 PM – 9:00 PM". */
export function DayWindowsInline({ day }: { day: DayHours }) {
	if (isAllDay(day)) return <>open 24 hours</>;
	return (
		<>
			{dayWindows(day).map((window, i) => (
				<Fragment key={window.open}>
					{i > 0 ? ", " : null}
					<TimeRange range={window} />
				</Fragment>
			))}
		</>
	);
}

/**
 * A day's windows as a right-aligned stack, one window per line: the weekly
 * schedule lists. A split day on one line is two ranges fighting for a row;
 * stacked, the break reads at a glance.
 */
export function DayWindowsStacked({ day }: { day: DayHours }) {
	if (isAllDay(day)) return <>Open 24 hours</>;
	return (
		<span className="flex flex-col items-end">
			{dayWindows(day).map((window) => (
				<TimeRange key={window.open} range={window} />
			))}
		</span>
	);
}
