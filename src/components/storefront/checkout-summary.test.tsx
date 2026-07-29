// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import type { CartItem, UseCart } from "../../hooks/useCart";
import { CheckoutSummary, CheckoutTotals } from "./checkout-summary";

afterEach(cleanup);

function makeItem(
	over: Omit<Partial<CartItem>, "variantId"> & { variantId: string },
): CartItem {
	return {
		productId: "p1" as unknown as Id<"products">,
		name: "Kek Batik",
		price: 4500,
		currency: "MYR",
		quantity: 1,
		...over,
		variantId: over.variantId as unknown as Id<"productVariants">,
	} as CartItem;
}

function makeCart(items: CartItem[]): UseCart {
	let count = 0;
	let sum = 0;
	for (const i of items) {
		count += i.quantity;
		sum += i.price * i.quantity;
	}
	return {
		items,
		itemCount: count,
		total: sum,
		currency: "MYR",
		addItem: vi.fn(),
		updateQuantity: vi.fn(),
		removeItem: vi.fn(),
		clearCart: vi.fn(),
		quantityForProduct: vi.fn(() => 0),
		subtotalForProduct: vi.fn(() => 0),
	} as unknown as UseCart;
}

describe("CheckoutSummary", () => {
	it("renders each line with unit price and line total", () => {
		const cart = makeCart([
			makeItem({ variantId: "v1", quantity: 2, price: 4500 }),
		]);
		render(<CheckoutSummary cart={cart} />);
		// getAllByText: the AppImage placeholder repeats the name as its alt text.
		expect(screen.getAllByText("Kek Batik").length).toBeGreaterThan(0);
		expect(screen.getByText("RM 45.00 each")).toBeTruthy();
		expect(screen.getByText("RM 90.00")).toBeTruthy();
		expect(screen.getByText("2 items")).toBeTruthy();
	});

	it("steps quantity up and down through cart.updateQuantity", () => {
		const cart = makeCart([makeItem({ variantId: "v1", quantity: 2 })]);
		render(<CheckoutSummary cart={cart} />);
		fireEvent.click(
			screen.getByRole("button", { name: "Increase Kek Batik quantity" }),
		);
		expect(cart.updateQuantity).toHaveBeenCalledWith("v1", 3);
		fireEvent.click(
			screen.getByRole("button", { name: "Decrease Kek Batik quantity" }),
		);
		expect(cart.updateQuantity).toHaveBeenCalledWith("v1", 1);
	});

	it("turns the minus button into remove at quantity 1", () => {
		const cart = makeCart([makeItem({ variantId: "v1", quantity: 1 })]);
		render(<CheckoutSummary cart={cart} />);
		fireEvent.click(screen.getByRole("button", { name: "Remove Kek Batik" }));
		// updateQuantity(…, 0) removes the line in the cart reducer.
		expect(cart.updateQuantity).toHaveBeenCalledWith("v1", 0);
	});

	it("caps the stepper at the stock cap with a visible reason", () => {
		const cart = makeCart([makeItem({ variantId: "v1", quantity: 3 })]);
		render(<CheckoutSummary cart={cart} stockCapFor={() => 3} />);
		const plus = screen.getByRole("button", {
			name: "Increase Kek Batik quantity",
		}) as HTMLButtonElement;
		expect(plus.disabled).toBe(true);
		expect(screen.getByText("Only 3 in stock")).toBeTruthy();
	});

	it("gives custom lines a Remove action instead of a stepper", () => {
		const cart = makeCart([
			makeItem({
				variantId: "vc",
				name: "Bespoke cake",
				isCustom: true,
				quoteOnRequest: true,
				price: 0,
				quantity: 1,
			}),
		]);
		render(<CheckoutSummary cart={cart} />);
		expect(screen.queryByRole("button", { name: /Increase/ })).toBeNull();
		expect(screen.getByText("On quote")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Remove Bespoke cake" }),
		);
		expect(cart.removeItem).toHaveBeenCalledWith("vc");
	});

	it("renders a min-quantity shortfall once, on the product's first line", () => {
		const cart = makeCart([
			makeItem({ variantId: "v1", quantity: 2 }),
			makeItem({ variantId: "v2", quantity: 1, optionLabel: "Large" }),
		]);
		render(
			<CheckoutSummary
				cart={cart}
				shortfalls={[
					{ productId: "p1", name: "Kek Batik", minQuantity: 5, have: 3 },
				]}
			/>,
		);
		expect(
			screen.getAllByText("Minimum 5 per order — add 2 more"),
		).toHaveLength(1);
	});

	it("fires onAddMore", () => {
		const cart = makeCart([makeItem({ variantId: "v1" })]);
		const onAddMore = vi.fn();
		render(<CheckoutSummary cart={cart} onAddMore={onAddMore} />);
		fireEvent.click(screen.getByRole("button", { name: "+ Add more items" }));
		expect(onAddMore).toHaveBeenCalled();
	});
});

describe("CheckoutTotals", () => {
	it("shows just the total when there are no extra charges", () => {
		render(<CheckoutTotals subtotal={9000} currency="MYR" pickupFee={0} />);
		expect(screen.queryByText("Subtotal")).toBeNull();
		expect(screen.getByText("RM 90.00")).toBeTruthy();
	});

	it("breaks down subtotal + fees and sums the total", () => {
		render(
			<CheckoutTotals
				subtotal={9000}
				currency="MYR"
				pickupFee={200}
				pickupFeeLabel="Tent HQ"
				quote={{ kind: "fee", fee: 800 }}
			/>,
		);
		expect(screen.getByText("Subtotal")).toBeTruthy();
		expect(screen.getByText("Pickup fee — Tent HQ")).toBeTruthy();
		expect(screen.getByText("Delivery fee")).toBeTruthy();
		// 90.00 + 2.00 + 8.00
		expect(screen.getByText("RM 100.00")).toBeTruthy();
	});

	it("marks a pending delivery charge on the total", () => {
		render(
			<CheckoutTotals
				subtotal={9000}
				currency="MYR"
				pickupFee={0}
				quote={{ kind: "pending", reason: "out_of_range" }}
			/>,
		);
		expect(screen.getByText("Confirmed by seller after checkout")).toBeTruthy();
		expect(screen.getByText("+ delivery")).toBeTruthy();
	});

	it("celebrates a threshold-free delivery", () => {
		render(
			<CheckoutTotals
				subtotal={9000}
				currency="MYR"
				pickupFee={0}
				quote={{ kind: "free", reason: "threshold" }}
			/>,
		);
		expect(screen.getByText("FREE for this order size")).toBeTruthy();
	});

	it("renders blocked copy as an alert", () => {
		render(
			<CheckoutTotals
				subtotal={9000}
				currency="MYR"
				pickupFee={0}
				quote={{ kind: "blocked", reason: "out_of_range" }}
				blockedCopy="This address is outside the delivery area."
			/>,
		);
		expect(screen.getByRole("alert").textContent).toContain(
			"outside the delivery area",
		);
	});
});
