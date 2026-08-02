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
	/**
	 * Fixed text welded to the front of the value — "+60" on a phone field,
	 * "RM" on money. Renders inside the control's border (the house composite
	 * pattern: bordered wrapper owns the focus ring, the input goes `bare`), so
	 * it reads as part of the number rather than a separate label.
	 *
	 * It is a PROMISE about what the field already contains: whatever the
	 * caller's schema normalizes to must accept a value typed without it, or
	 * the badge tells the buyer to do something the validator then rejects.
	 */
	prefix?: string;
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
			className={cn(mono && "font-mono", prefix && "min-h-11 pl-1.5 text-base")}
		/>
	);

	return (
		<Field data-invalid={isInvalid}>
			<FieldLabel htmlFor={field.name}>
				{label}
				{required ? <span className="ml-0.5 text-destructive">*</span> : null}
			</FieldLabel>
			{prefix ? (
				// Mirrors the `field` input variant's chrome on the WRAPPER so the
				// prefix sits inside one control. Focus + invalid styling has to be
				// lifted here too — a `bare` input paints neither.
				<div
					className={cn(
						"flex min-h-11 items-center rounded-xl border border-input bg-transparent pl-4 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
						disabled && "cursor-not-allowed bg-input/50 opacity-50",
						isInvalid &&
							"border-destructive ring-3 ring-destructive/20 dark:border-destructive/50 dark:ring-destructive/40",
					)}
				>
					{/* aria-hidden: the prefix is decoration on top of the label, and
					    screen readers would otherwise read it as part of the value. */}
					<span
						aria-hidden
						className="select-none text-base text-muted-foreground"
					>
						{prefix}
					</span>
					{input}
				</div>
			) : (
				input
			)}
			{description ? <FieldDescription>{description}</FieldDescription> : null}
			{isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
		</Field>
	);
}
