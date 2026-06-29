import { cn } from "../../lib/utils";
import { Field, FieldDescription, FieldError, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
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
}: TextFieldProps) {
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
				type={type}
				inputMode={inputMode}
				autoComplete={autoComplete}
				disabled={disabled}
				placeholder={placeholder}
				value={field.state.value ?? ""}
				onChange={(e) => field.handleChange(e.target.value)}
				onBlur={() => field.handleBlur()}
				variant="field"
				isError={isInvalid}
				className={cn(mono && "font-mono")}
			/>
			{description ? <FieldDescription>{description}</FieldDescription> : null}
			{isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
		</Field>
	);
}
