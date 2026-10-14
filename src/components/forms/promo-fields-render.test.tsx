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

function Harness({
	initialDraft = { ...EMPTY_PROMO_DRAFT, on: true },
	initialRows = ROWS,
	locked,
}: {
	initialDraft?: PromoDraft;
	initialRows?: PromoRow[];
	locked?: boolean;
} = {}) {
	const [draft, setDraft] = useState<PromoDraft>(initialDraft);
	const [rows, setRows] = useState<PromoRow[]>(initialRows);
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
			locked={locked}
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

/**
 * Clear (z8r3fdudm3). Switching the promotion off only HID its fields — the
 * label, window, caps and every sale price came back on the next switch-on —
 * so starting over meant emptying each line by hand. One control resets the
 * whole card; Undo puts it back while nothing has been typed since.
 */
describe("clear sale prices & settings", () => {
	const clearButton = () =>
		screen.getByRole("button", { name: "Clear sale prices & settings" });
	const values = () => saleInputs().map((el) => (el as HTMLInputElement).value);
	const label = () => screen.getByLabelText(/^Label/) as HTMLInputElement;
	const cap = () =>
		screen.getByLabelText(/units at this price/) as HTMLInputElement;

	function fillEverything() {
		fireEvent.click(screen.getByRole("button", { name: "30% off" }));
		fireEvent.change(label(), { target: { value: "Raya" } });
		fireEvent.change(cap(), { target: { value: "20" } });
		fireEvent.click(screen.getByRole("button", { name: "No end date" }));
	}

	test("nothing to clear on a fresh card — disabled, and says why", () => {
		render(<Harness />);
		expect((clearButton() as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByText("Nothing to clear yet.")).toBeTruthy();
	});

	test("one tap empties every sale price and setting, and leaves it switched on", () => {
		render(<Harness />);
		fillEverything();
		expect(values()).toEqual(["14.00", "14.00", "7.00"]);

		fireEvent.click(clearButton());

		expect(values()).toEqual(["", "", ""]);
		expect(label().value).toBe("");
		expect(cap().value).toBe("");
		// Back to the default window, not left on "No end date".
		expect(
			screen
				.getByRole("button", { name: "For 1 hour" })
				.className.includes("border-accent"),
		).toBe(true);
		// Clear starts over; it is not the off switch.
		expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
			"true",
		);
		expect(
			screen.getByText(
				"Cleared. Nothing changes on your store until you save.",
			),
		).toBeTruthy();
	});

	test("Undo puts back exactly what was cleared", () => {
		render(<Harness />);
		fillEverything();
		fireEvent.click(clearButton());
		fireEvent.click(screen.getByRole("button", { name: "Undo" }));

		expect(values()).toEqual(["14.00", "14.00", "7.00"]);
		expect(label().value).toBe("Raya");
		expect(cap().value).toBe("20");
		expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
	});

	test("any edit after clearing drops Undo, so it can't overwrite new input", () => {
		render(<Harness />);
		fillEverything();
		fireEvent.click(clearButton());
		fireEvent.change(saleInputs()[0], { target: { value: "5.00" } });

		expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
		expect((clearButton() as HTMLButtonElement).disabled).toBe(false);
	});

	test("…a setting edit drops it too, not only a price", () => {
		render(<Harness />);
		fillEverything();
		fireEvent.click(clearButton());
		fireEvent.change(label(), { target: { value: "Merdeka" } });

		expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
	});

	test("switched on with nothing on sale names the way out, as the focus target", () => {
		render(<Harness />);
		const issue = screen.getByText(
			"Set a sale price on at least one line, or switch the promotion off.",
		);
		// What "take me to the error" scrolls to when Save is refused here.
		expect(issue.hasAttribute("data-form-error")).toBe(true);

		fireEvent.change(saleInputs()[0], { target: { value: "5.00" } });
		expect(
			screen.queryByText(/Set a sale price on at least one line/),
		).toBeNull();
	});
});

/**
 * Setting a promotion is Pro; switching one OFF never is (the server's rule).
 * The toggle used to be disabled outright on a locked store, so a seller who
 * dropped to Starter could neither remove a paused promotion nor — because
 * every save re-sent it and hit the Pro gate — save any other edit.
 */
describe("a locked (Starter) store", () => {
	test("with a paused promotion can switch it off, and is told it's paused", () => {
		render(
			<Harness
				locked
				initialRows={ROWS.map((r) => ({ ...r, promoPrice: "5.00" }))}
			/>,
		);
		const toggle = screen.getByRole("switch") as HTMLButtonElement;
		expect(toggle.disabled).toBe(false);
		expect(screen.getByText(/This promotion is paused/)).toBeTruthy();

		fireEvent.click(toggle);
		expect(toggle.getAttribute("aria-checked")).toBe("false");
		// …and can't switch it back on.
		expect(toggle.disabled).toBe(true);
	});

	test("shows the paused promotion READ-ONLY — every edit would be refused on save (PR #365 review)", () => {
		render(
			<Harness
				locked
				initialRows={ROWS.map((r) => ({ ...r, promoPrice: "5.00" }))}
			/>,
		);
		for (const input of saleInputs())
			expect(input.matches(":disabled")).toBe(true);
		expect(
			screen.getByRole("button", { name: "30% off" }).matches(":disabled"),
		).toBe(true);
		expect(screen.getByLabelText(/Label/).matches(":disabled")).toBe(true);
		// The one live control is the switch — off is never Pro-gated.
		expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(
			false,
		);
	});

	test("an unlocked store's fields stay editable", () => {
		render(<Harness />);
		for (const input of saleInputs())
			expect(input.matches(":disabled")).toBe(false);
	});

	test("is not offered Clear — the move there is switching it off", () => {
		render(
			<Harness
				locked
				initialRows={ROWS.map((r) => ({ ...r, promoPrice: "5.00" }))}
			/>,
		);
		expect(
			screen.queryByRole("button", { name: "Clear sale prices & settings" }),
		).toBeNull();
	});
});
