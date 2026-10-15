// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { type PickerCatalog, ProductPicker } from "./product-picker";

/**
 * The bulk promotion picker (`z8r3fducfd`). Two promises it must keep: a
 * 20-product sale is a couple of taps (select-all, per group), and a product
 * already on another sale is NEVER swept in by one — joining replaces that
 * sale, so it takes its own explicit "Move here".
 */
afterEach(cleanup);

const variant = (price: number) => [
	{ _id: `v${price}`, label: "", price, promoPrice: undefined, active: true },
];

const catalog = {
	categories: [
		{ _id: "c1", name: "Kuih" },
		{ _id: "c2", name: "Cakes" },
	],
	products: [
		{
			_id: "a",
			name: "Kuih lapis",
			isBooking: false,
			isEvent: false,
			categoryIds: ["c1"],
			variants: variant(1800),
			inThisPromotion: false,
			elsewhere: null,
			ownSale: null,
		},
		{
			_id: "b",
			name: "Seri muka",
			isBooking: false,
			isEvent: false,
			categoryIds: ["c1"],
			variants: variant(1200),
			inThisPromotion: false,
			elsewhere: null,
			ownSale: null,
		},
		{
			_id: "c",
			name: "Cheesecake",
			isBooking: false,
			isEvent: false,
			categoryIds: ["c2"],
			variants: variant(6500),
			inThisPromotion: false,
			elsewhere: null,
			ownSale: null,
		},
		{
			_id: "d",
			name: "Pandan cake",
			isBooking: false,
			isEvent: false,
			categoryIds: ["c2"],
			variants: variant(5500),
			inThisPromotion: false,
			elsewhere: { promotionId: "x", label: "Raya Sale", endsAt: undefined },
			ownSale: null,
		},
	],
} as unknown as PickerCatalog;

let lastSelected = new Set<string>();
let lastMoving = new Set<string>();

function Harness() {
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [moving, setMoving] = useState<Set<string>>(new Set());
	lastSelected = selected;
	lastMoving = moving;
	return (
		<ProductPicker
			catalog={catalog}
			mode="create"
			selected={selected}
			onSelectedChange={setSelected}
			moving={moving}
			onMovingChange={setMoving}
			currency="MYR"
		/>
	);
}

describe("ProductPicker", () => {
	it("select-all takes every pickable product and never one on another sale", () => {
		render(<Harness />);
		fireEvent.click(screen.getByLabelText(/^All products/));
		expect([...lastSelected].sort()).toEqual(["a", "b", "c"]);
		expect(lastSelected.has("d")).toBe(false);
	});

	it("a group's select-all reaches only that group", () => {
		render(<Harness />);
		fireEvent.click(screen.getByLabelText(/^Kuih/));
		expect([...lastSelected].sort()).toEqual(["a", "b"]);
	});

	it("a blocked product says why, can't be ticked, and joins only by an explicit move", () => {
		render(<Harness />);
		expect(screen.getByText("On Raya Sale")).toBeTruthy();
		const row = screen.getByRole("button", { name: /Pandan cake/ });
		expect((row as HTMLButtonElement).disabled).toBe(true);

		fireEvent.click(screen.getByRole("button", { name: "Move here" }));
		expect(lastSelected.has("d")).toBe(true);
		expect(lastMoving.has("d")).toBe(true);
		expect(screen.getByText("Moving here — leaves Raya Sale")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Undo" }));
		expect(lastSelected.has("d")).toBe(false);
		expect(lastMoving.has("d")).toBe(false);
	});

	it("search narrows the list and the master row says it's the matches", () => {
		render(<Harness />);
		fireEvent.change(screen.getByPlaceholderText(/Search by name/), {
			target: { value: "seri" },
		});
		expect(screen.queryByText("Kuih lapis")).toBeNull();
		fireEvent.click(screen.getByLabelText(/^All matching products/));
		expect([...lastSelected]).toEqual(["b"]);
	});

	it("a search with no match says so instead of an empty list", () => {
		render(<Harness />);
		fireEvent.change(screen.getByPlaceholderText(/Search by name/), {
			target: { value: "durian" },
		});
		expect(screen.getByText(/No product matches/)).toBeTruthy();
	});
});
