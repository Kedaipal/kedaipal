/**
 * Driving the buyer's country-code picker from a test (z8r3fdm36y).
 *
 * The picker used to be an invisible `<select>`, so four test files each kept
 * their own `screen.getByRole("combobox")` helper and read `picker().value`.
 * When it became a searchable sheet all four broke the same way — which is the
 * argument for this file: the plate's control has ONE shape, so the way tests
 * reach it belongs in one place too. A future change to the control updates
 * these three functions, not every caller's private copy.
 */

import { fireEvent, screen, within } from "@testing-library/react";
import type { DialIso } from "../../../convex/lib/buyerPhone";

export const DEFAULT_PICKER_LABEL = "Country of your WhatsApp number";

/** The plate's trigger button. */
export function phonePicker(
	label: string = DEFAULT_PICKER_LABEL,
): HTMLButtonElement {
	return screen.getByRole("button", { name: label }) as HTMLButtonElement;
}

/**
 * The dial code the plate is showing — this control's "value".
 *
 * Read it with the sheet CLOSED: open, every row prints a code too.
 */
export function phonePlateCode(label: string = DEFAULT_PICKER_LABEL): string {
	return (
		within(phonePicker(label).parentElement as HTMLElement).getByText(/^\+\d+$/)
			.textContent ?? ""
	);
}

/**
 * Open the sheet, search, and pick a country by name.
 *
 * `query` defaults to the name — pass it explicitly only to exercise searching
 * by something else (a dial code, an ISO).
 */
export async function pickPhoneCountry(
	name: string,
	options: { label?: string; query?: string } = {},
): Promise<void> {
	const { label = DEFAULT_PICKER_LABEL, query = name } = options;
	fireEvent.click(phonePicker(label));
	const search = await screen.findByRole("combobox");
	fireEvent.change(search, { target: { value: query } });
	fireEvent.click(
		await screen.findByRole("option", { name: new RegExp(name, "i") }),
	);
}

/** `"+81"` for `"JP"` — for asserting the plate after a pick. */
export function expectedPlateCode(dial: string): string {
	return `+${dial}`;
}

export type { DialIso };
