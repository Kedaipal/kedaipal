import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Field, FieldDescription, FieldError, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { InputPrefixFrame } from "../ui/input-prefix-frame";
import { useFieldContext } from "./form";

interface TextFieldProps {
	label: string;
	placeholder?: string;
	required?: boolean;
	type?: "text" | "tel" | "email" | "url";
	inputMode?: "text" | "tel" | "email" | "url" | "numeric";
	description?: string;
	mono?: boolean;
	autoComplete?: string;
	disabled?: boolean;
	/**
	 * Fixed content welded to the front of the value — a country flag + dial
	 * code, an "RM" on money. Renders inside the control's border on a tinted
	 * plate with a **vertical rule** separating it from the input, the shape
	 * every phone field in this market uses (Grab, Shopee, Stripe): the fixed
	 * part is visibly not editable, so nobody wonders whether to retype it.
	 *
	 * It is a PROMISE about what the field already contains: whatever the
	 * caller's schema normalizes to must accept a value typed without it, or
	 * the prefix tells the user to do something the validator then rejects.
	 */
	prefix?: ReactNode;
}

export function TextField({
	label,
	placeholder,
	required = false,
	type = "text",
	inputMode,
	description,
	mono = false,
	autoComplete,
	disabled = false,
	prefix,
}: TextFieldProps) {
	const field = useFieldContext<string>();
	const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

	const input = (
		<Input
			id={field.name}
			name={field.name}
			type={type}
			inputMode={inputMode}
			autoComplete={autoComplete}
			disabled={disabled}
			placeholder={placeholder}
			value={field.state.value ?? ""}
			onChange={(e) => field.handleChange(e.target.value)}
			onBlur={() => field.handleBlur()}
			variant={prefix ? "bare" : "field"}
			isError={isInvalid}
			className={cn(mono && "font-mono", prefix && "min-h-11 px-3 text-base")}
		/>
	);

	return (
		<Field data-invalid={isInvalid}>
			<FieldLabel htmlFor={field.name}>
				{label}
				{required ? <span className="ml-0.5 text-destructive">*</span> : null}
			</FieldLabel>
			{prefix ? (
				<InputPrefixFrame
					prefix={prefix}
					invalid={isInvalid}
					disabled={disabled}
				>
					{input}
				</InputPrefixFrame>
			) : (
				input
			)}
			{description ? <FieldDescription>{description}</FieldDescription> : null}
			{isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
		</Field>
	);
}
