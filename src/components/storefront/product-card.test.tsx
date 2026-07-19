// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductCard, type StorefrontProduct } from "./product-card";

afterEach(cleanup);

// Minimal in-stock, single-variant product → renders the quick-add "Add" button.
const product = {
	_id: "p1",
	name: "Ceramic mug",
	currency: "MYR",
	imageUrls: [],
	options: [],
	priceFrom: 5000,
	priceTo: 5000,
	hasQuotePricing: false,
	inStock: true,
	totalOnHand: 60,
	variants: [
		{
			_id: "v1",
			optionValues: [],
			onHand: 60,
			active: true,
			blockWhenOutOfStock: false,
			requiresProof: false,
			price: 5000,
			imageUrls: [],
		},
	],
} as unknown as StorefrontProduct;

function renderCard(cartQuantity: number, cartSubtotal: number) {
	return render(
		<ProductCard
			product={product}
			onOpen={vi.fn()}
			onQuickAdd={vi.fn()}
			cartQuantity={cartQuantity}
			cartSubtotal={cartSubtotal}
		/>,
	);
}

describe("ProductCard — in-cart line", () => {
	it("shows nothing when the product is not in the cart", () => {
		renderCard(0, 0);
		expect(screen.queryByText(/in cart/i)).toBeNull();
	});

	it("shows count and running total once in the cart", () => {
		renderCard(3, 15000);
		// Regex tolerates the NBSP Intl inserts between "RM" and the amount.
		expect(screen.getByText(/^3 in cart · RM\s*150\.00$/)).toBeTruthy();
	});

	it("shows the count alone when everything in cart is quote-priced (subtotal 0)", () => {
		renderCard(1, 0);
		expect(screen.getByText("1 in cart")).toBeTruthy();
		// No stray "· RM" money fragment when there's no total to show.
		expect(screen.queryByText(/·/)).toBeNull();
	});
});
