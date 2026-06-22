import type { Country } from "react-phone-number-input";
import { toDisplayE164 } from "../../lib/phone";
import { Field, FieldDescription, FieldError, FieldLabel } from "../ui/field";
import { PhoneInput } from "../ui/phone-input";
import { useFieldContext } from "./form";

/**
 * Phone number field for TanStack Form. Mirrors `TextField`'s structure but
 * renders the shadcn `PhoneInput` (country selector + flags). Form state is
 * kept in E.164 (`+60…`); see `src/lib/phone.ts` for the format bridge.
 */
interface PhoneFieldProps {
	label: string;
	description?: string;
	required?: boolean;
	disabled?: boolean;
	/** Initial country when the value has no country code. Defaults to Malaysia. */
	defaultCountry?: Country;
}

export function PhoneField({
	label,
	description,
	required = false,
	disabled = false,
	defaultCountry = "MY",
}: PhoneFieldProps) {
	const field = useFieldContext<string>();
	const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

	return (
		<Field data-invalid={isInvalid}>
			<FieldLabel htmlFor={field.name}>
				{label}
				{required ? <span className="ml-0.5 text-destructive">*</span> : null}
			</FieldLabel>
			<PhoneInput
				id={field.name}
				name={field.name}
				defaultCountry={defaultCountry}
				disabled={disabled}
				aria-invalid={isInvalid}
				value={toDisplayE164(field.state.value)}
				onChange={(value) => field.handleChange(value ?? "")}
				onBlur={() => field.handleBlur()}
			/>
			{description ? <FieldDescription>{description}</FieldDescription> : null}
			{isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
		</Field>
	);
}
