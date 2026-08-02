// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// VariantEditor calls useMutation for image uploads; stub it so the component
// renders without a ConvexProvider. (Uses a per-file jsdom env since the
// default vitest environment is edge-runtime.)
vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));

import {
	isMadeToOrderOnly,
	reconcileForSubmit,
	VariantEditor,
	type VariantEditorState,
} from "./variant-editor";

afterEach(cleanup);

/** Controlled wrapper so toggles reflect back into state during the test. */
function Harness({ initial }: { initial: VariantEditorState }) {
	const [state, setState] = useState(initial);
	return <VariantEditor value={state} onChange={setState} currency="RM" />;
}

const singleVariant: VariantEditorState = {
	options: [],
	rows: [
		{
			optionValues: [],
			sku: "",
			price: "10.00",
			stock: "5",
			active: true,
			blockWhenOutOfStock: true,
			requiresProof: false,
			imageStorageIds: [],
		},
	],
	customLine: null,
};

const withOptions: VariantEditorState = {
	options: [{ name: "Size", values: ["S", "M"] }],
	rows: ["S", "M"].map((v) => ({
		optionValues: [v],
		sku: "",
		price: "10",
		stock: "3",
		active: true,
		blockWhenOutOfStock: true,
		requiresProof: false,
		imageStorageIds: [],
	})),
	customLine: null,
};

describe("VariantEditor — the promoted questions", () => {
	it("asks 'What kind of product is it?' with Just one item selected for a single product", () => {
		render(<Harness initial={singleVariant} />);
		expect(screen.getByText(/what kind of product is it/i)).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: /just one item/i })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen
				.getByRole("button", { name: /^buyer picks$/i })
				.getAttribute("aria-pressed"),
		).toBe("false");
	});

	it("switching to 'Buyer picks' reveals the axis setup with preset chips", () => {
		render(<Harness initial={singleVariant} />);
		fireEvent.click(screen.getByRole("button", { name: /^buyer picks$/i }));
		expect(screen.getByText(/they choose by/i)).toBeTruthy();
		// The cohort presets are one tap away.
		expect(screen.getByRole("button", { name: "Size" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Flavour" })).toBeTruthy();
	});

	it("offers a positive Made fresh / From stock choice (no double-negative)", () => {
		render(<Harness initial={singleVariant} />);
		expect(screen.getByText(/how do you prepare orders/i)).toBeTruthy();
		// blockWhenOutOfStock=true → From stock is the pressed card.
		expect(
			screen
				.getByRole("button", { name: /from stock/i })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen
				.getByRole("button", { name: /made fresh/i })
				.getAttribute("aria-pressed"),
		).toBe("false");
	});

	it("hides the stock input entirely once the product is made fresh", () => {
		render(<Harness initial={singleVariant} />);
		expect(screen.getByText(/in stock now/i)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /made fresh/i }));
		expect(
			screen
				.getByRole("button", { name: /made fresh/i })
				.getAttribute("aria-pressed"),
		).toBe("true");
		// Made fresh never runs out — no stock question at all.
		expect(screen.queryByText(/in stock now/i)).toBeNull();
	});

	it("applies the prepare answer to every choice at once", () => {
		render(<Harness initial={withOptions} />);
		// Both rows track stock → both show a stock input.
		expect(screen.getAllByLabelText("Stock on hand")).toHaveLength(2);
		fireEvent.click(screen.getByRole("button", { name: /made fresh/i }));
		expect(screen.queryByLabelText("Stock on hand")).toBeNull();
	});
});

describe("VariantEditor — made-to-order product type (86eyfq04j)", () => {
	// Leaving a priced multi-choice product confirms first (jsdom's stub returns
	// undefined, which would silently abort every switch below).
	beforeEach(() => {
		vi.spyOn(window, "confirm").mockReturnValue(true);
	});

	it("confirms before discarding priced choices", () => {
		render(<Harness initial={withOptions} />);
		fireEvent.click(screen.getByRole("button", { name: /^made to order$/i }));
		expect(window.confirm).toHaveBeenCalled();
	});

	it("switching to Made to order drops choices, stock and the price requirement", () => {
		render(<Harness initial={withOptions} />);
		fireEvent.click(screen.getByRole("button", { name: /^made to order$/i }));
		expect(
			screen
				.getByRole("button", { name: /^made to order$/i })
				.getAttribute("aria-pressed"),
		).toBe("true");
		// Nothing to pick, nothing to count.
		expect(screen.queryByText(/they choose by/i)).toBeNull();
		expect(screen.queryByLabelText("Stock on hand")).toBeNull();
		expect(screen.queryByText(/in stock now/i)).toBeNull();
		// The price is explicitly optional, with the buyer-facing consequence.
		expect(screen.getByText(/starting price/i)).toBeTruthy();
		expect(screen.getByText(/price on quote/i)).toBeTruthy();
	});

	it("does not re-ask the questions the type has already answered", () => {
		render(<Harness initial={withOptions} />);
		fireEvent.click(screen.getByRole("button", { name: /^made to order$/i }));
		// Preparation is constitutive — asking again lets it be silently undone.
		expect(screen.queryByText(/how do you prepare orders/i)).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /advanced/i }));
		// Approval is what the type IS; a bespoke line on a bespoke product is
		// the same offer twice.
		expect(screen.queryByText(/^mockup approval$/i)).toBeNull();
		expect(screen.queryByText(/^custom orders$/i)).toBeNull();
	});

	it("switching back to a plain item restores stock tracking and drops approval", () => {
		render(<Harness initial={singleVariant} />);
		fireEvent.click(screen.getByRole("button", { name: /^made to order$/i }));
		fireEvent.click(screen.getByRole("button", { name: /just one item/i }));
		expect(
			screen
				.getByRole("button", { name: /just one item/i })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(screen.getByText(/in stock now/i)).toBeTruthy();
		expect(screen.getByText(/how do you prepare orders/i)).toBeTruthy();
	});
});

describe("isMadeToOrderOnly / reconcileForSubmit", () => {
	const madeToOrder: VariantEditorState = {
		options: [],
		rows: [
			{
				...singleVariant.rows[0],
				price: "",
				stock: "",
				blockWhenOutOfStock: false,
				requiresProof: true,
			},
		],
		customLine: null,
	};

	it("recognises the one never-out-of-stock, approval-gated row", () => {
		expect(isMadeToOrderOnly(madeToOrder)).toBe(true);
		expect(isMadeToOrderOnly(singleVariant)).toBe(false);
		expect(isMadeToOrderOnly(withOptions)).toBe(false);
	});

	it("stays true once a 'from' price is typed — the mode must not flip mid-edit", () => {
		expect(
			isMadeToOrderOnly({
				...madeToOrder,
				rows: [{ ...madeToOrder.rows[0], price: "120" }],
			}),
		).toBe(true);
	});

	it("resolves a blank made-to-order price to 0 ('Price on quote')", () => {
		expect(
			reconcileForSubmit(madeToOrder.options, madeToOrder.rows).rows[0].price,
		).toBe("0");
		// A typed price is left exactly as the seller wrote it.
		expect(
			reconcileForSubmit(madeToOrder.options, [
				{ ...madeToOrder.rows[0], price: "120" },
			]).rows[0].price,
		).toBe("120");
		// Every other product still has to state a price — blank stays blank so
		// buildSubmitVariants can raise its own "enter a price" issue.
		expect(
			reconcileForSubmit(singleVariant.options, [
				{ ...singleVariant.rows[0], price: "" },
			]).rows[0].price,
		).toBe("");
	});
});

describe("VariantEditor — vary per choice", () => {
	it("reveals per-choice fulfilment toggles behind 'Vary per choice'", () => {
		render(<Harness initial={withOptions} />);
		expect(screen.queryByRole("button", { name: /track stock/i })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /vary per choice/i }));
		// One compact Track stock / Made fresh pair per row.
		expect(
			screen.getAllByRole("button", { name: /track stock/i }),
		).toHaveLength(2);
	});

	it("auto-opens the per-choice override for a legacy mixed product", () => {
		const mixed: VariantEditorState = {
			...withOptions,
			rows: withOptions.rows.map((r, i) => ({
				...r,
				blockWhenOutOfStock: i === 0,
			})),
		};
		render(<Harness initial={mixed} />);
		// Mixed state must never look uniform — the override list is pre-open…
		expect(
			screen.getAllByRole("button", { name: /track stock/i }),
		).toHaveLength(2);
		// …and the product-level cards say why nothing is selected.
		expect(screen.getByText(/varies per choice/i)).toBeTruthy();
	});

	it("'Use one setting for all choices' collapses to the majority setting", () => {
		const mixed: VariantEditorState = {
			options: [{ name: "Size", values: ["S", "M", "L"] }],
			rows: ["S", "M", "L"].map((v, i) => ({
				optionValues: [v],
				sku: "",
				price: "10",
				stock: "3",
				active: true,
				blockWhenOutOfStock: i < 2, // 2 track, 1 made-to-order
				requiresProof: false,
				imageStorageIds: [],
			})),
			customLine: null,
		};
		render(<Harness initial={mixed} />);
		fireEvent.click(
			screen.getByRole("button", { name: /use one setting for all choices/i }),
		);
		// Majority (track stock) wins → From stock selected, override closed.
		expect(
			screen
				.getByRole("button", { name: /from stock/i })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(screen.queryByRole("button", { name: /track stock/i })).toBeNull();
	});
});

describe("VariantEditor — Advanced disclosure", () => {
	it("keeps SKU, approval and the custom option collapsed by default", () => {
		render(<Harness initial={singleVariant} />);
		expect(screen.getByRole("button", { name: /advanced/i })).toBeTruthy();
		expect(screen.queryByText(/^mockup approval$/i)).toBeNull();
		expect(screen.queryByPlaceholderText("ITEM-001")).toBeNull();
	});

	it("opens on demand and names the two easily-confused options distinctly", () => {
		render(<Harness initial={singleVariant} />);
		fireEvent.click(screen.getByRole("button", { name: /advanced/i }));
		// 86eyfq04j: these two were both titled after mockups, so a seller had to
		// read three lines of prose to tell an approval STEP from an extra thing
		// to SELL. Distinct titles, and neither title contains the other.
		expect(screen.getByText(/^mockup approval$/i)).toBeTruthy();
		expect(screen.getByText(/^custom orders$/i)).toBeTruthy();
		// The approval body describes the gate; the custom body describes the line.
		expect(
			screen.getByText(/can't be packed until they approve/i),
		).toBeTruthy();
		expect(screen.getByText(/when nothing above fits/i)).toBeTruthy();
		expect(screen.getByPlaceholderText("ITEM-001")).toBeTruthy();
	});

	it("auto-opens when the product already uses an advanced feature (custom line)", () => {
		const withCustom: VariantEditorState = {
			...withOptions,
			customLine: {
				label: "Bespoke cake",
				price: "",
				prompt: "Tell us your theme",
				imageStorageIds: [],
			},
		};
		render(<Harness initial={withCustom} />);
		expect(
			(screen.getByDisplayValue("Bespoke cake") as HTMLInputElement).value,
		).toBe("Bespoke cake");
	});

	it("auto-opens when a submit issue points inside it", () => {
		render(
			<VariantEditor
				value={{
					...singleVariant,
					customLine: {
						label: "Bespoke",
						price: "abc",
						prompt: "",
						imageStorageIds: [],
					},
				}}
				onChange={() => {}}
				currency="RM"
				issues={[
					{
						where: "custom",
						index: 0,
						field: "price",
						message:
							"Not a valid price — enter a number, or leave blank for price on quote.",
					},
				]}
			/>,
		);
		expect(
			screen.getByText(
				"Not a valid price — enter a number, or leave blank for price on quote.",
			),
		).toBeTruthy();
	});

	it("hosts the second choice axis (Size × Flavour) behind Advanced", () => {
		render(<Harness initial={withOptions} />);
		fireEvent.click(screen.getByRole("button", { name: /advanced/i }));
		expect(
			screen.getByRole("button", { name: /add a second choice/i }),
		).toBeTruthy();
	});
});

describe("VariantEditor — custom / made-to-order line", () => {
	it("reveals the custom card only after the seller opts in, outside the choices", () => {
		render(<Harness initial={withOptions} />);
		fireEvent.click(screen.getByRole("button", { name: /advanced/i }));
		const toggle = screen.getByRole("checkbox", {
			name: /custom orders/i,
		}) as HTMLInputElement;
		// Hidden until enabled — no name/price/prompt fields yet.
		expect(screen.queryByPlaceholderText("Custom")).toBeNull();
		expect(toggle.checked).toBe(false);

		fireEvent.click(toggle);

		// The custom card appears with its own (grid-independent) fields.
		expect(toggle.checked).toBe(true);
		expect(screen.getByPlaceholderText("Custom")).toBeTruthy();
		expect(
			screen.getByPlaceholderText(/tell us your design, flavour, size & date/i),
		).toBeTruthy();
	});

	it("keeps the custom label out of the choices list", () => {
		const withCustom: VariantEditorState = {
			...withOptions,
			customLine: {
				label: "Bespoke cake",
				price: "",
				prompt: "Tell us your theme",
				imageStorageIds: [],
			},
		};
		render(<Harness initial={withCustom} />);
		// The label appears exactly once (the custom card's input) — never as a
		// choices row.
		expect(screen.getAllByDisplayValue("Bespoke cake")).toHaveLength(1);
		expect(screen.queryByText("Bespoke cake")).toBeNull();
	});
});

describe("VariantEditor — inline submit issues", () => {
	it("marks the exact row inputs aria-invalid with the message beneath (single-variant)", () => {
		render(
			<VariantEditor
				value={{
					...singleVariant,
					rows: [{ ...singleVariant.rows[0], price: "", stock: "" }],
				}}
				onChange={() => {}}
				currency="RM"
				issues={[
					{
						where: "row",
						index: 0,
						field: "price",
						message: "Enter a price (e.g. 120 or 120.50).",
					},
					{
						where: "row",
						index: 0,
						field: "stock",
						message: "Enter a whole-number stock (0 is fine).",
					},
				]}
			/>,
		);
		expect(
			screen.getAllByText("Enter a price (e.g. 120 or 120.50).").length,
		).toBeGreaterThan(0);
		expect(
			screen.getAllByText("Enter a whole-number stock (0 is fine).").length,
		).toBeGreaterThan(0);
		// The inputs themselves are marked, so focusFirstInvalidField finds them.
		const invalid = document.querySelectorAll('[aria-invalid="true"]');
		expect(invalid.length).toBeGreaterThanOrEqual(2);
	});

	it("marks only the addressed row in a multi-choice product", () => {
		render(
			<VariantEditor
				value={withOptions}
				onChange={() => {}}
				currency="RM"
				issues={[
					{
						where: "row",
						index: 1,
						field: "price",
						message: "Enter a price (e.g. 120 or 120.50).",
					},
				]}
			/>,
		);
		// One choices list (no duplicated desktop table) → the message renders
		// exactly once, on row 1.
		expect(
			screen.getAllByText("Enter a price (e.g. 120 or 120.50)."),
		).toHaveLength(1);
	});

	it("marks the option-axis name input for an option issue", () => {
		render(
			<VariantEditor
				value={{
					...withOptions,
					options: [{ name: "", values: [] }],
					rows: [],
				}}
				onChange={() => {}}
				currency="RM"
				issues={[
					{
						where: "option",
						index: 0,
						field: "name",
						message: "Give this option a name (e.g. Size).",
					},
					{
						where: "option",
						index: 0,
						field: "values",
						message: "Add at least one value (e.g. Small).",
					},
				]}
			/>,
		);
		expect(
			screen.getByText("Give this option a name (e.g. Size)."),
		).toBeTruthy();
		expect(
			screen.getByText("Add at least one value (e.g. Small)."),
		).toBeTruthy();
		const nameInput = screen.getByPlaceholderText("Option name (e.g. Size)");
		expect(nameInput.getAttribute("aria-invalid")).toBe("true");
	});
});
