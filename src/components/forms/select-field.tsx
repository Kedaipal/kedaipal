import { Field, FieldDescription, FieldError, FieldLabel } from "../ui/field";
import { Select } from "../ui/select";
import { useFieldContext } from "./form";

interface SelectFieldOption {
	value: string;
	label: string;
}

interface SelectFieldProps {
	label: string;
	options: readonly SelectFieldOption[];
	required?: boolean;
	description?: string;
	disabled?: boolean;
}

export function SelectField({
	label,
	options,
	required = false,
	description,
	disabled = false,
}: SelectFieldProps) {
	const field = useFieldContext<string>();
	const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

	return (
		<Field data-invalid={isInvalid}>
			<FieldLabel htmlFor={field.name}>
				{label}
				{required ? <span className="ml-0.5 text-destructive">*</span> : null}
			</FieldLabel>
			{/* Chrome lives in the `Select` primitive, not here — a form-bound
			    picker and a plain-state one must not look like two controls. */}
			<Select
				variant="field"
				className="w-full"
				id={field.name}
				name={field.name}
				disabled={disabled}
				value={field.state.value ?? ""}
				onChange={(e) => field.handleChange(e.target.value)}
				onBlur={() => field.handleBlur()}
				isError={isInvalid}
			>
				{options.map((opt) => (
					<option key={opt.value} value={opt.value}>
						{opt.label}
					</option>
				))}
			</Select>
			{description ? <FieldDescription>{description}</FieldDescription> : null}
			{isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
		</Field>
	);
}
