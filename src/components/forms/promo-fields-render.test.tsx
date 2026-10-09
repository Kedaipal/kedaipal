// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, test } from "vitest";
import {
	EMPTY_PROMO_DRAFT,
	type PromoDraft,
	PromoFields,
	type PromoRow,
} from "./promo-fields";

/**
 * Quick fill writes EVERY row (z8r3fdcw72, found by hand-testing: "30% off"
 * discounted only the last choice and said nothing, so a three-variant flash
 * went live with two variants at full price).
 *
 * The bug was never in the arithmetic — it was the shape of the callback. A
 * per-row `onRowPromoPrice(key, value)` called in a loop had each parent
 * update read state from the SAME render's closure, so N writes collapsed to
 * the last one. Hence the harness below merges non-functionally
 * (`{...state, ...}`), exactly as `product-form` and `product-wizard` do: a
 * functional `setState(prev => …)` wrapper would paper over the regression
 * and pass even with the loop restored.
 */
afterEach(cleanup);

const ROWS: PromoRow[] = [
	{ key: "0", label: "Small", price: "20.00", promoPrice: "" },
	{ key: "1", label: "Medium", price: "20.00", promoPrice: "" },
	{ key: "2", label: "Large", price: "10.00", promoPrice: "" },
];

function Harness() {
	const [draft, setDraft] = useState<PromoDraft>({
		...EMPTY_PROMO_DRAFT,
		on: true,
	});
	const [rows, setRows] = useState<PromoRow[]>(ROWS);
	return (
		<PromoFields
			draft={draft}
			onChange={setDraft}
			rows={rows}
			// The real parents' merge, deliberately non-functional.
			onPromoPrices={(next) =>
				setRows(
					rows.map((r) =>
						next[r.key] === undefined ? r : { ...r, promoPrice: next[r.key] },
					),
				)
			}
			currency="SGD"
			now={Date.now()}
		/>
	);
}

/** The sale-price inputs, in row order. */
function saleInputs() {
	return screen
		.getAllByRole("textbox")
		.filter((el) => el.getAttribute("inputmode") === "decimal");
}

describe("promo quick fill", () => {
	test("30% off discounts EVERY row, not just the last", () => {
		render(<Harness />);
		fireEvent.click(screen.getByRole("button", { name: "30% off" }));

		const values = saleInputs().map((el) => (el as HTMLInputElement).value);
		// 20.00 → 14.00 twice, 10.00 → 7.00. The regression left the first two
		// blank and filled only "7.00".
		expect(values).toEqual(["14.00", "14.00", "7.00"]);
	});

	test("a single field still edits only its own row", () => {
		render(<Harness />);
		const [first] = saleInputs();
		fireEvent.change(first, { target: { value: "3.50" } });

		const values = saleInputs().map((el) => (el as HTMLInputElement).value);
		expect(values).toEqual(["3.50", "", ""]);
	});
});

/**
 * A refused sale price has to SAY so. The rule was enforced in
 * `buildSubmitVariants` and its message rendered by nobody, so Save and
 * Continue were silent no-ops — the seller pressed a green button forever
 * with the reason nowhere on screen.
 */
describe("a refused sale price states its reason", () => {
	test("over the normal price — named, beneath the field, and announced", () => {
		render(<Harness />);
		const [first] = saleInputs();
		fireEvent.change(first, { target: { value: "25.00" } }); // list is 20.00

		const message = screen.getByText("Must be below the normal price.");
		expect(message).toBeTruthy();
		// Pointed at, so a screen reader gets the reason and not a bare
		// "invalid"; `focusFirstInvalidField` lands here on submit.
		expect(first.getAttribute("aria-invalid")).toBe("true");
		expect(first.getAttribute("aria-describedby")).toBe(message.id);
	});

	test("not a number — a different reason, not the same one", () => {
		render(<Harness />);
		fireEvent.change(saleInputs()[0], { target: { value: "abc" } });
		expect(screen.getByText("Numbers only — e.g. 31.50.")).toBeTruthy();
	});

	test("a blank line is not an error — it just stays at full price", () => {
		render(<Harness />);
		fireEvent.change(saleInputs()[0], { target: { value: "25.00" } });
		fireEvent.change(saleInputs()[0], { target: { value: "" } });

		expect(screen.queryByText(/Must be below/)).toBeNull();
		expect(saleInputs()[0].getAttribute("aria-invalid")).not.toBe("true");
	});
});
