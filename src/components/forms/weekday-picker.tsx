// The one weekday chip row — a seller picking a SET of days (the booking
// weekend nights, S13). Mon→Sun on screen (the calendar's Monday start, so
// Sat + Sun sit together), stored as `weekdayIndexMyt` indexes (0 = Sunday).
// Built on `FilterChip` in the accent tone: inside a settings card a chip
// reads as "this constraint is on" (the same control Settings → Fulfilment
// uses for "Open on"), so two pickers of days can't drift apart.

import {
	WEEKDAY_NAMES,
	WEEKDAY_NAMES_SHORT,
} from "../../../convex/lib/openingHours";
import { FilterChip } from "../ui/filter-chip";

/** Mon→Sun render order over 0 = Sunday indexes. */
export const WEEKDAY_RENDER_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

export function WeekdayPicker({
	value,
	onChange,
	disabled = false,
	/** Names the set for assistive tech — "Weekend nights". */
	label,
}: {
	value: readonly number[];
	onChange: (next: number[]) => void;
	disabled?: boolean;
	label: string;
}) {
	const selected = new Set(value);
	return (
		<fieldset className="flex flex-wrap gap-1.5">
			<legend className="sr-only">{label}</legend>
			{WEEKDAY_RENDER_ORDER.map((i) => (
				<FilterChip
					key={WEEKDAY_NAMES[i]}
					tone="accent"
					selected={selected.has(i)}
					disabled={disabled}
					aria-label={WEEKDAY_NAMES[i]}
					onClick={() => {
						const next = new Set(selected);
						if (next.has(i)) next.delete(i);
						else next.add(i);
						// Stored sorted so equal picks are equal arrays.
						onChange([...next].sort((a, b) => a - b));
					}}
					className="h-11 px-3"
				>
					{WEEKDAY_NAMES_SHORT[i]}
				</FilterChip>
			))}
		</fieldset>
	);
}
