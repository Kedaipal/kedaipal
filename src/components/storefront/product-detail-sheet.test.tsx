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

describe("ProductDetailSheet — live total preview", () => {
	it("hides the total until a concrete variant is resolved", () => {
		render(
			<ProductDetailSheet
				product={product}
				retailerId={RID}
				cartQuantity={0}
				onClose={vi.fn()}
				onAdd={vi.fn()}
			/>,
		);
		// Multi-axis product with no size picked yet → no committed price to total.
		expect(screen.queryByText("Total")).toBeNull();
	});

	it("shows the running total and reflects quantity changes", () => {
		render(
			<ProductDetailSheet
				product={product}
				retailerId={RID}
				cartQuantity={0}
				onClose={vi.fn()}
				onAdd={vi.fn()}
			/>,
		);
		// Pick S (RM10.00) → total appears at qty 1 (label alone, no breakdown).
		fireEvent.click(screen.getByRole("button", { name: "S" }));
		expect(screen.getByText("Total")).toBeTruthy();

		// Step up to 2 → total becomes 2 × RM10.00 = RM20.00, distinct from the
		// RM10.00 unit price shown above. (Regex tolerates the NBSP that Intl puts
		// between the currency symbol and the amount.)
		fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));
		expect(screen.getByText(/^RM\s*20\.00$/)).toBeTruthy();
	});

	it("shows no total for a quote-priced (made-to-order) selection", () => {
		// Single implicit variant, made-to-order at RM0 → resolves immediately but
		// has no price yet, so a money total would be misleading.
		const quoteProduct = {
			_id: "pq",
			name: "Custom cake",
			currency: "MYR",
			imageUrls: [],
			options: [],
			priceFrom: 0,
			priceTo: 0,
			hasQuotePricing: true,
			variants: [
				{
					_id: "vq",
					optionValues: [],
					onHand: 0,
					active: true,
					blockWhenOutOfStock: false,
					requiresProof: true,
					price: 0,
					imageUrls: [],
				},
			],
		} as unknown as StorefrontProduct;

		render(
			<ProductDetailSheet
				product={quoteProduct}
				retailerId={RID}
				cartQuantity={0}
				onClose={vi.fn()}
				onAdd={vi.fn()}
			/>,
		);
		expect(screen.getByText("Price on quote")).toBeTruthy();
		expect(screen.queryByText("Total")).toBeNull();
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

	it("goes unavailable-with-reason when stock can't reach the minimum", () => {
		// Hard-block stock 3 < min 5 → no stepper trap: the sheet explains and
		// the add path is disabled outright (checkout could never accept it).
		const shortProduct = {
			...(minProduct as unknown as Record<string, unknown>),
			totalOnHand: 3,
			variants: [
				{
					_id: "vK",
					optionValues: [],
					onHand: 3,
					active: true,
					blockWhenOutOfStock: true,
					requiresProof: false,
					price: 500,
					imageUrls: [],
				},
			],
		} as unknown as StorefrontProduct;

		const onAdd = vi.fn();
		render(
			<ProductDetailSheet
				product={shortProduct}
				retailerId={RID}
				cartQuantity={0}
				onClose={vi.fn()}
				onAdd={onAdd}
			/>,
		);
		expect(screen.getByRole("alert").textContent).toMatch(
			/only 3 left.*minimum of 5/i,
		);
		const addButton = screen.getByRole("button", {
			name: /not enough stock/i,
		});
		expect((addButton as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(addButton);
		expect(onAdd).not.toHaveBeenCalled();
	});
});

describe("ProductDetailSheet — direct-to-checkout CTA (86eybhqye)", () => {
	it("hides the checkout CTA when the cart is empty", () => {
		render(
			<ProductDetailSheet
				product={product}
				retailerId={RID}
				cartQuantity={0}
				cartItemCount={0}
				cartTotal={0}
				onClose={vi.fn()}
				onAdd={vi.fn()}
				onCheckout={vi.fn()}
			/>,
		);
		expect(
			screen.queryByRole("button", { name: /go to checkout/i }),
		).toBeNull();
	});

	it("shows the CTA with count + total once the cart has items and fires onCheckout", () => {
		const onCheckout = vi.fn();
		render(
			<ProductDetailSheet
				product={product}
				retailerId={RID}
				cartQuantity={0}
				cartItemCount={3}
				cartTotal={2500}
				onClose={vi.fn()}
				onAdd={vi.fn()}
				onCheckout={onCheckout}
			/>,
		);
		const cta = screen.getByRole("button", { name: /go to checkout/i });
		// Count badge + money total both live on the CTA (regex tolerates the NBSP
		// Intl inserts after the currency symbol).
		expect(cta.textContent).toMatch(/3/);
		expect(cta.textContent).toMatch(/RM\s*25\.00/);
		fireEvent.click(cta);
		expect(onCheckout).toHaveBeenCalledTimes(1);
	});

	it("omits the money amount for a quote-only cart (total 0) but keeps the CTA", () => {
		render(
			<ProductDetailSheet
				product={product}
				retailerId={RID}
				cartQuantity={0}
				cartItemCount={1}
				cartTotal={0}
				onClose={vi.fn()}
				onAdd={vi.fn()}
				onCheckout={vi.fn()}
			/>,
		);
		const cta = screen.getByRole("button", { name: /go to checkout/i });
		expect(cta).toBeTruthy();
		expect(cta.textContent).not.toMatch(/RM/);
	});

	it("hides the CTA when no onCheckout handler is wired (standalone render)", () => {
		render(
			<ProductDetailSheet
				product={product}
				retailerId={RID}
				cartQuantity={0}
				cartItemCount={3}
				cartTotal={3000}
				onClose={vi.fn()}
				onAdd={vi.fn()}
			/>,
		);
		expect(
			screen.queryByRole("button", { name: /go to checkout/i }),
		).toBeNull();
	});
});
