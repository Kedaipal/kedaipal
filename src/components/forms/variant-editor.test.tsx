// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// VariantEditor calls useMutation for image uploads; stub it so the component
// renders without a ConvexProvider. (Uses a per-file jsdom env since the
// default vitest environment is edge-runtime.)
vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));

import { VariantEditor, type VariantEditorState } from "./variant-editor";

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

describe("VariantEditor — the two promoted questions", () => {
	it("asks 'Does the buyer pick anything?' with Just one item selected for a single product", () => {
		render(<Harness initial={singleVariant} />);
		expect(screen.getByText(/does the buyer pick anything/i)).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: /just one item/i })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen
				.getByRole("button", { name: /buyer picks a choice/i })
				.getAttribute("aria-pressed"),
		).toBe("false");
	});

	it("switching to 'Buyer picks a choice' reveals the axis setup with preset chips", () => {
		render(<Harness initial={singleVariant} />);
		fireEvent.click(
			screen.getByRole("button", { name: /buyer picks a choice/i }),
		);
		expect(screen.getByText(/they choose by/i)).toBeTruthy();
		// The cohort presets are one tap away.
		expect(screen.getByRole("button", { name: "Size" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Flavour" })).toBeTruthy();
	});

	it("offers a positive Made to order / From stock choice (no double-negative)", () => {
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
				.getByRole("button", { name: /made to order/i })
				.getAttribute("aria-pressed"),
		).toBe("false");
	});

	it("hides the stock input entirely once the product is made to order", () => {
		render(<Harness initial={singleVariant} />);
		expect(screen.getByText(/in stock now/i)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /made to order/i }));
		expect(
			screen
				.getByRole("button", { name: /made to order/i })
				.getAttribute("aria-pressed"),
		).toBe("true");
		// Made to order never runs out — no stock question at all.
		expect(screen.queryByText(/in stock now/i)).toBeNull();
	});

	it("applies the prepare answer to every choice at once", () => {
		render(<Harness initial={withOptions} />);
		// Both rows track stock → both show a stock input.
		expect(screen.getAllByLabelText("Stock on hand")).toHaveLength(2);
		fireEvent.click(screen.getByRole("button", { name: /made to order/i }));
		expect(screen.queryByLabelText("Stock on hand")).toBeNull();
	});
});

describe("VariantEditor — vary per choice", () => {
	it("reveals per-choice fulfilment toggles behind 'Vary per choice'", () => {
		render(<Harness initial={withOptions} />);
		expect(screen.queryByRole("button", { name: /track stock/i })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /vary per choice/i }));
		// One compact Track stock / Made to order pair per row.
		expect(screen.getAllByRole("button", { name: /track stock/i })).toHaveLength(
			2,
		);
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
		expect(screen.getAllByRole("button", { name: /track stock/i })).toHaveLength(
			2,
		);
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
		expect(screen.queryByText(/require mockup approval/i)).toBeNull();
		expect(screen.queryByPlaceholderText("ITEM-001")).toBeNull();
	});

	it("opens on demand and describes mockup approval in seller-recognisable terms", () => {
		render(<Harness initial={singleVariant} />);
		fireEvent.click(screen.getByRole("button", { name: /advanced/i }));
		expect(
			screen.getByText(/require mockup approval before making it/i),
		).toBeTruthy();
		expect(screen.getByText(/cake decorator/i)).toBeTruthy();
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
			name: /also offer a custom \/ made-to-order option/i,
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
				value={{ ...withOptions, options: [{ name: "", values: [] }], rows: [] }}
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
