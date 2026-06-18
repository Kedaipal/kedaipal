// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StorefrontProduct } from "./product-card";
import { ProductDetailSheet } from "./product-detail-sheet";

afterEach(cleanup);

// Minimal product: two standard sizes + a custom line. Empty images/description
// keep the render to plain DOM (no ZoomableImage / Markdown).
const product = {
	_id: "p1",
	name: "Cake",
	currency: "MYR",
	imageUrls: [],
	options: [{ name: "Size", values: ["S", "M"] }],
	priceFrom: 1000,
	priceTo: 1500,
	hasQuotePricing: true,
	variants: [
		{
			_id: "vS",
			optionValues: ["S"],
			onHand: 3,
			active: true,
			blockWhenOutOfStock: true,
			requiresProof: false,
			price: 1000,
			imageUrls: [],
		},
		{
			_id: "vM",
			optionValues: ["M"],
			onHand: 2,
			active: true,
			blockWhenOutOfStock: true,
			requiresProof: false,
			price: 1500,
			imageUrls: [],
		},
		{
			_id: "vC",
			optionValues: [],
			onHand: 0,
			active: true,
			blockWhenOutOfStock: false,
			requiresProof: true,
			price: 0,
			isCustom: true,
			customLabel: "Bespoke",
			customPrompt: "Tell us your theme",
			imageUrls: [],
		},
	],
} as unknown as StorefrontProduct;

describe("ProductDetailSheet — custom line is an independent add", () => {
	it("requests the custom line with the buyer's note, without an axis selection", () => {
		const onAdd = vi.fn();
		render(
			<ProductDetailSheet product={product} onClose={vi.fn()} onAdd={onAdd} />,
		);

		// Standard path can't be added until a size is picked…
		expect(
			screen.getByRole("button", { name: /select options/i }),
		).toBeTruthy();
		// The seller's prompt is the textarea placeholder, so the buyer can type
		// their spec — the whole point of a custom line.
		const noteBox = screen.getByPlaceholderText("Tell us your theme");
		fireEvent.change(noteBox, { target: { value: "unicorn theme, size 8" } });
		fireEvent.click(
			screen.getByRole("button", { name: /request custom order/i }),
		);
		expect(onAdd).toHaveBeenCalledTimes(1);
		expect(onAdd).toHaveBeenCalledWith(
			product,
			expect.objectContaining({ isCustom: true }),
			1,
			"unicorn theme, size 8",
		);
	});

	it("keeps the standard variant and custom line independent (not mutually exclusive)", () => {
		const onAdd = vi.fn();
		render(
			<ProductDetailSheet product={product} onClose={vi.fn()} onAdd={onAdd} />,
		);

		// Pick a size → the bottom CTA becomes a real "Add to cart" for that variant.
		fireEvent.click(screen.getByRole("button", { name: "S" }));
		fireEvent.click(screen.getByRole("button", { name: /add to cart/i }));
		expect(onAdd).toHaveBeenLastCalledWith(
			product,
			expect.objectContaining({ optionValues: ["S"] }),
			1,
		);

		// The custom request still works after a size was chosen — both are addable
		// from the same open sheet. No note typed → undefined.
		fireEvent.click(
			screen.getByRole("button", { name: /request custom order/i }),
		);
		expect(onAdd).toHaveBeenLastCalledWith(
			product,
			expect.objectContaining({ isCustom: true }),
			1,
			undefined,
		);
		expect(onAdd).toHaveBeenCalledTimes(2);
	});
});
