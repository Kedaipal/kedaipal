import type { ReactNode } from "react";
import { DatePicker } from "../ui/date-picker";
import { Field, FieldDescription, FieldError, FieldLabel } from "../ui/field";
import { useFieldContext } from "./form";

interface DateFieldProps {
	label: string;
	/** Earliest selectable day, "YYYY-MM-DD". */
	min?: string;
	/** Latest selectable day, "YYYY-MM-DD". */
	max?: string;
	required?: boolean;
	/** Hint under the field. A node, not just a string, so a checkout hint can
	 * keep a time range on one line (`TimeRange`, z8r3fdff8r). */
	description?: ReactNode;
	disabled?: boolean;
	/**
	 * Days inside `min`..`max` the buyer still can't have — a store closed date,
	 * a weekday it never opens, a today the cart's prep has already used up.
	 * Greys the day out in the grid instead of taking the pick and refusing it
	 * afterwards (z8r3fdm36y).
	 */
	isDayDisabled?: (ymd: string) => boolean;
	/** One line under the grid naming why days are greyed — required reading
	 * whenever `isDayDisabled` can actually refuse something, so the constraint
	 * is surfaced rather than silently enforced. */
	unavailableNote?: string;
}

/**
 * Date field bound to a TanStack Form string field, rendering the house
 * `DatePicker` (themed `Calendar` in a popover).
 *
 * It used to be a native `<input type="date">`, chosen for the OS wheel and
 * zero JS. What retired that choice is `isDayDisabled`: a native date input
 * accepts `min`/`max` and nothing else, so every store-closed day inside the
 * window was offered and then refused on submit — the checkout had already
 * written the limitation down and worked around it with an after-the-fact
 * explanation. See `ui/date-picker.tsx` for the full rationale.
 *
 * The value is still a "YYYY-MM-DD" string the submit handler converts to an
 * epoch via convex/lib/fulfilmentDate — nothing downstream changed.
 */
export function DateField({
	label,
	min,
	max,
	required = false,
	description,
	disabled = false,
	isDayDisabled,
	unavailableNote,
}: DateFieldProps) {
	const field = useFieldContext<string>();
	const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

	return (
		<Field data-invalid={isInvalid}>
			<FieldLabel htmlFor={field.name}>
				{label}
				{required ? <span className="ml-0.5 text-destructive">*</span> : null}
			</FieldLabel>
			<DatePicker
				id={field.name}
				name={field.name}
				disabled={disabled}
				value={field.state.value ?? ""}
				onChange={(ymd) => field.handleChange(ymd)}
				onBlur={() => field.handleBlur()}
				min={min}
				max={max}
				isDayDisabled={isDayDisabled}
				unavailableNote={unavailableNote}
				isError={isInvalid}
			/>
			{description ? <FieldDescription>{description}</FieldDescription> : null}
			{isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
		</Field>
	);
}
