// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// VariantEditor calls useMutation for image uploads; stub it so the component
// renders without a ConvexProvider. (First component test in the repo — uses a
// per-file jsdom env since the default vitest environment is edge-runtime.)
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

describe("VariantEditor — fulfilment + approval UX", () => {
	it("offers a positive Track stock / Made to order choice (no double-negative)", () => {
		render(<Harness initial={singleVariant} />);
		// blockWhenOutOfStock=true → Track stock is the pressed segment.
		expect(
			screen
				.getByRole("button", { name: /track stock/i })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen
				.getByRole("button", { name: /made to order/i })
				.getAttribute("aria-pressed"),
		).toBe("false");
	});

	it("flips the fulfilment selection when Made to order is tapped", () => {
		render(<Harness initial={singleVariant} />);
		fireEvent.click(screen.getByRole("button", { name: /made to order/i }));
		expect(
			screen
				.getByRole("button", { name: /made to order/i })
				.getAttribute("aria-pressed"),
		).toBe("true");
		// Helper copy switches to the made-to-order explanation.
		expect(screen.getByText(/never runs out/i)).toBeTruthy();
	});

	it("marks Stock optional once a single variant is made to order", () => {
		render(<Harness initial={singleVariant} />);
		// Only SKU carries "(optional)" while tracking stock; Stock is required.
		expect(screen.getAllByText(/\(optional\)/i)).toHaveLength(1);
		fireEvent.click(screen.getByRole("button", { name: /made to order/i }));
		// Made to order → stock is just a guide, so Stock is now flagged optional too.
		expect(screen.getAllByText(/\(optional\)/i)).toHaveLength(2);
	});

	it("describes mockup approval in seller-recognisable terms", () => {
		render(<Harness initial={singleVariant} />);
		expect(
			screen.getByText(/require mockup approval before making it/i),
		).toBeTruthy();
		expect(screen.getByText(/cake decorator/i)).toBeTruthy();
	});

	it("renders both a mobile card list and a desktop table (mobile-first responsive)", () => {
		render(<Harness initial={withOptions} />);
		// Desktop: a real table for density.
		expect(screen.getByRole("table")).toBeTruthy();
		// Mobile: a stacked <ul> of variant cards, hidden at sm+.
		const list = document.querySelector("ul.sm\\:hidden");
		expect(list).toBeTruthy();
		expect(within(list as HTMLElement).getByText("S")).toBeTruthy();
		expect(within(list as HTMLElement).getByText("M")).toBeTruthy();
	});

	it("explains the compact per-variant flags once via a shared legend", () => {
		render(<Harness initial={withOptions} />);
		// Grid toggles are compact (no inline helper), so the meaning must live in
		// a single legend covering both fulfilment modes + approval.
		expect(screen.getByText(/sells out/i)).toBeTruthy();
		expect(screen.getByText(/make each one on demand/i)).toBeTruthy();
		expect(
			screen.getByText(/blocks the order until they approve/i),
		).toBeTruthy();
	});
});

describe("VariantEditor — custom / made-to-order line", () => {
	it("reveals the custom card only after the seller opts in, outside the grid", () => {
		render(<Harness initial={withOptions} />);
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
		// The variant grid (Size S/M) is untouched by enabling custom.
		expect(screen.getByRole("table")).toBeTruthy();
	});

	it("seeds the custom card from an existing custom line and keeps it out of the grid", () => {
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
		// Custom label must NOT leak into the variant grid rows.
		const list = document.querySelector("ul.sm\\:hidden");
		expect(within(list as HTMLElement).queryByText("Bespoke cake")).toBeNull();
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

	it("marks only the addressed row in a multi-variant grid", () => {
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
		// Mobile card + desktop table both render — the message appears per
		// surface for row 1 only (2 renders), not for row 0.
		expect(
			screen.getAllByText("Enter a price (e.g. 120 or 120.50)."),
		).toHaveLength(2);
	});

	it("marks the option-axis name input for an option issue", () => {
		render(
			<VariantEditor
				value={{ ...withOptions, options: [{ name: "", values: [] }] }}
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

	it("marks the custom-line price input", () => {
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
});
