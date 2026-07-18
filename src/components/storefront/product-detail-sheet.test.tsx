// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import type { StorefrontProduct } from "./product-card";
import { ProductDetailSheet } from "./product-detail-sheet";

// The sheet uses useMutation for the buyer image upload; stub it so it renders
// without a ConvexProvider.
vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));

afterEach(cleanup);

const RID = "r1" as unknown as Id<"retailers">;

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
			<ProductDetailSheet
				product={product}
				retailerId={RID}
				cartQuantity={0}
				onClose={vi.fn()}
				onAdd={onAdd}
			/>,
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
		// Note travels in the custom payload object; no image attached.
		expect(onAdd).toHaveBeenCalledWith(
			product,
			expect.objectContaining({ isCustom: true }),
			1,
			{ note: "unicorn theme, size 8", imageStorageId: undefined },
		);
	});

	it("keeps the standard variant and custom line independent (not mutually exclusive)", () => {
		const onAdd = vi.fn();
		render(
			<ProductDetailSheet
				product={product}
				retailerId={RID}
				cartQuantity={0}
				onClose={vi.fn()}
				onAdd={onAdd}
			/>,
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
		// from the same open sheet. No note/image → empty payload.
		fireEvent.click(
			screen.getByRole("button", { name: /request custom order/i }),
		);
		expect(onAdd).toHaveBeenLastCalledWith(
			product,
			expect.objectContaining({ isCustom: true }),
			1,
			{ note: undefined, imageStorageId: undefined },
		);
		expect(onAdd).toHaveBeenCalledTimes(2);
	});
});

describe("ProductDetailSheet — minimum order quantity (86ey9unyx)", () => {
	// Single-variant product with a minimum of 5, plenty of stock.
	const minProduct = {
		_id: "p2",
		name: "Kuih Tray",
		currency: "MYR",
		imageUrls: [],
		options: [],
		priceFrom: 500,
		priceTo: 500,
		hasQuotePricing: false,
		minQuantity: 5,
		variants: [
			{
				_id: "vK",
				optionValues: [],
				onHand: 100,
				active: true,
				blockWhenOutOfStock: true,
				requiresProof: false,
				price: 500,
				imageUrls: [],
			},
		],
	} as unknown as StorefrontProduct;

	it("opens at the minimum, floors the stepper there and adds that many", () => {
		const onAdd = vi.fn();
		render(
			<ProductDetailSheet
				product={minProduct}
				retailerId={RID}
				cartQuantity={0}
				onClose={vi.fn()}
				onAdd={onAdd}
			/>,
		);
		// The rule is announced up front, and the stepper starts AT the minimum.
		expect(screen.getByText(/minimum 5 per order/i)).toBeTruthy();
		const minus = screen.getByRole("button", { name: /decrease quantity/i });
		// No-options product → can't step below the minimum (disabled-with-reason
		// beats a checkout surprise).
		expect((minus as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: /add to cart/i }));
		expect(onAdd).toHaveBeenCalledWith(
			minProduct,
			expect.objectContaining({ optionValues: [] }),
			5,
		);
	});

	it("starts at the REMAINING amount when the cart already holds some", () => {
		const onAdd = vi.fn();
		render(
			<ProductDetailSheet
				product={minProduct}
				retailerId={RID}
				cartQuantity={3}
				onClose={vi.fn()}
				onAdd={onAdd}
			/>,
		);
		// 3 of 5 in the cart → the stepper opens at the missing 2.
		expect(screen.getByText(/you have 3 in your cart/i)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /add to cart/i }));
		expect(onAdd).toHaveBeenCalledWith(
			minProduct,
			expect.objectContaining({ optionValues: [] }),
			2,
		);
	});
});
