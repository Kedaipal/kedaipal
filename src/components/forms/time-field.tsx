import { cn } from "../../lib/utils";
import { Field, FieldDescription, FieldError, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { useFieldContext } from "./form";

interface TimeFieldProps {
	label: string;
	/** Earliest selectable time, "HH:MM" — set when the chosen day is today so
	 * a past slot can't be picked. */
	min?: string;
	/** Latest selectable time, "HH:MM" — set when the store's opening hours
	 * (86eyp5rav) close the chosen day before midnight. */
	max?: string;
	required?: boolean;
	description?: string;
	disabled?: boolean;
}

/**
 * Native `<input type="time">` bound to a TanStack Form string field — the
 * DateField's sibling (86eyg0n8e follow-up), same deliberate lean choice: the
 * OS time wheel, zero JS, no dependency. Value is an "HH:MM" string the
 * submit handler converts to minutes via convex/lib/fulfilmentDate. 5-minute
 * steps: rider pickups don't need minute precision, and coarser steps make
 * the OS wheel faster to use.
 */
export function TimeField({
	label,
	min,
	max,
	required = false,
	description,
	disabled = false,
}: TimeFieldProps) {
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
				type="time"
				min={min}
				max={max}
				step={300}
				disabled={disabled}
				value={field.state.value ?? ""}
				onChange={(e) => field.handleChange(e.target.value)}
				onBlur={() => field.handleBlur()}
				variant="field"
				isError={isInvalid}
				className={cn("appearance-none")}
			/>
			{description ? <FieldDescription>{description}</FieldDescription> : null}
			{isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
		</Field>
	);
}
