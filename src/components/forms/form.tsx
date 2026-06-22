import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import { PhoneField } from "./phone-field";
import { SelectField } from "./select-field";
import { TextField } from "./text-field";
import { TextareaField } from "./textarea-field";

/**
 * TanStack Form composition factory.
 *
 * Pattern mirrors Tessera/Casamarra: a single `useAppForm` hook surfaces all
 * registered field components as `form.AppField` children, with type-safe
 * `useFieldContext<T>()` access inside each component.
 *
 * Add new field components here as the project grows (SelectField, NumberField,
 * etc.) so every form gets them for free.
 */

export const { fieldContext, formContext, useFieldContext } =
	createFormHookContexts();

export const { useAppForm, withFieldGroup } = createFormHook({
	fieldContext,
	formContext,
	fieldComponents: {
		TextField,
		TextareaField,
		SelectField,
		PhoneField,
	},
	formComponents: {},
});
