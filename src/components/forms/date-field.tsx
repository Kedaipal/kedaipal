import { cn } from "../../lib/utils";
import { Field, FieldDescription, FieldError, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { useFieldContext } from "./form";

interface DateFieldProps {
	label: string;
	/** Earliest selectable day, "YYYY-MM-DD". */
	min?: string;
	/** Latest selectable day, "YYYY-MM-DD". */
	max?: string;
	required?: boolean;
	description?: string;
	disabled?: boolean;
}

/**
 * Native `<input type="date">` bound to a TanStack Form string field. We use the
 * browser's built-in date control deliberately — it's the mobile-first choice
 * (the OS date wheel/calendar, zero JS, no dependency) and matches the lean
 * scope of the checkout date picker. `min`/`max` clamp the picker; the value is
 * a "YYYY-MM-DD" string the submit handler converts to an epoch via
 * convex/lib/fulfilmentDate.
 */
export function DateField({
	label,
	min,
	max,
	required = false,
	description,
	disabled = false,
}: DateFieldProps) {
	const field = useFieldContext<string>();
	const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

	return (
		<Field data-invalid={isInvalid}>
			<FieldLabel htmlFor={field.name}>
				{label}
				{required ? <span className="ml-0.5 text-destructive">*</span> : null}
			</FieldLabel>
			<Input
				id={field.name}
				name={field.name}
				type="date"
				min={min}
				max={max}
				disabled={disabled}
				value={field.state.value ?? ""}
				onChange={(e) => field.handleChange(e.target.value)}
				onBlur={() => field.handleBlur()}
				variant="field"
				isError={isInvalid}
				// Native date inputs render the placeholder/value text via the OS; nudge
				// the control to fill the row and keep the calendar icon tappable.
				className={cn("appearance-none")}
			/>
			{description ? <FieldDescription>{description}</FieldDescription> : null}
			{isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
		</Field>
	);
}
