// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import type { CartItem, UseCart } from "../../hooks/useCart";
import {
	CheckoutSummary,
	type CheckoutQuoteView,
	CheckoutTotals,
} from "./checkout-summary";

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

function renderSummary(
	cart: UseCart,
	extra: Partial<Parameters<typeof CheckoutSummary>[0]> = {},
) {
	return render(
		<CheckoutSummary cart={cart} storeName="Sue Chef Kitchen" {...extra} />,
	);
}

/** Expand a line's inline controls by tapping its receipt row. */
function tapLine(pattern: RegExp) {
	fireEvent.click(screen.getByRole("button", { name: pattern }));
}

describe("CheckoutSummary (order ticket)", () => {
	it("prints the masthead and mono receipt lines with bare amounts", () => {
		const cart = makeCart([
			makeItem({
				variantId: "v1",
				quantity: 2,
				price: 4500,
				optionLabel: "1kg",
			}),
		]);
		renderSummary(cart);
		expect(screen.getByText("Sue Chef Kitchen")).toBeTruthy();
		expect(screen.getByText("Order ticket · Draft")).toBeTruthy();
		// "2× Kek Batik · 1kg …… 90.00" — RM only appears on the TOTAL row.
		expect(
			screen.getByRole("button", { name: /2× Kek Batik · 1kg/ }),
		).toBeTruthy();
		expect(screen.getByText("90.00")).toBeTruthy();
	});

	it("reveals the stepper on tap and steps through cart.updateQuantity", () => {
		const cart = makeCart([makeItem({ variantId: "v1", quantity: 2 })]);
		renderSummary(cart);
		// Collapsed by default — the receipt stays clean until the buyer acts.
		expect(screen.queryByRole("button", { name: /Increase/ })).toBeNull();

		tapLine(/2× Kek Batik/);
		fireEvent.click(
			screen.getByRole("button", { name: "Increase Kek Batik quantity" }),
		);
		expect(cart.updateQuantity).toHaveBeenCalledWith("v1", 3);
		fireEvent.click(
			screen.getByRole("button", { name: "Decrease Kek Batik quantity" }),
		);
		expect(cart.updateQuantity).toHaveBeenCalledWith("v1", 1);
		// Unit price surfaces with the controls.
		expect(screen.getByText("RM 45.00 each")).toBeTruthy();
	});

	it("turns the minus button into remove at quantity 1", () => {
		const cart = makeCart([makeItem({ variantId: "v1", quantity: 1 })]);
		renderSummary(cart);
		tapLine(/1× Kek Batik/);
		fireEvent.click(screen.getByRole("button", { name: "Remove Kek Batik" }));
		// updateQuantity(…, 0) removes the line in the cart reducer.
		expect(cart.updateQuantity).toHaveBeenCalledWith("v1", 0);
	});

	it("caps the stepper at the stock cap with a visible reason", () => {
		const cart = makeCart([makeItem({ variantId: "v1", quantity: 3 })]);
		renderSummary(cart, { stockCapFor: () => 3 });
		tapLine(/3× Kek Batik/);
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
		renderSummary(cart);
		expect(screen.getByText("On quote")).toBeTruthy();
		tapLine(/1× Bespoke cake/);
		expect(screen.queryByRole("button", { name: /Increase/ })).toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: "Remove Bespoke cake" }),
		);
		expect(cart.removeItem).toHaveBeenCalledWith("vc");
	});

	it("pre-expands a shortfall line so the fixing stepper is already showing", () => {
		const cart = makeCart([
			makeItem({ variantId: "v1", quantity: 2 }),
			makeItem({ variantId: "v2", quantity: 1, optionLabel: "Large" }),
		]);
		renderSummary(cart, {
			shortfalls: [
				{ productId: "p1", name: "Kek Batik", minQuantity: 5, have: 3 },
			],
		});
		// Hint renders once, on the product's first line…
		expect(
			screen.getAllByText("Minimum 5 per order — add 2 more"),
		).toHaveLength(1);
		// …and that line's stepper is out without a tap (v1 is the first line).
		expect(
			screen.getByRole("button", { name: "Increase Kek Batik quantity" }),
		).toBeTruthy();
	});

	it("pre-expands + names a line that now exceeds live stock", () => {
		// Persisted cart says 5; the seller has since dropped stock to 2.
		const cart = makeCart([makeItem({ variantId: "v1", quantity: 5 })]);
		renderSummary(cart, { stockCapFor: () => 2 });
		// No tap needed — the buyer must lower it, so the stepper is out…
		expect(
			screen.getByRole("button", { name: "Decrease Kek Batik quantity" }),
		).toBeTruthy();
		// …and the reason is named on the line itself.
		expect(
			screen.getByText("Only 2 left — lower this to 2 to continue"),
		).toBeTruthy();
	});

	it("fires onAddMore", () => {
		const cart = makeCart([makeItem({ variantId: "v1" })]);
		const onAddMore = vi.fn();
		renderSummary(cart, { onAddMore });
		fireEvent.click(screen.getByRole("button", { name: "+ Add more items" }));
		expect(onAddMore).toHaveBeenCalled();
	});
});

describe("CheckoutTotals", () => {
	it("shows just the total when there are no extra charges", () => {
		render(<CheckoutTotals subtotal={9000} currency="MYR" pickupFee={0} />);
		expect(screen.getByText("RM 90.00")).toBeTruthy();
		expect(screen.queryByText("Delivery")).toBeNull();
	});

	it("prints fee lines as receipt rows and sums the total", () => {
		render(
			<CheckoutTotals
				subtotal={9000}
				currency="MYR"
				pickupFee={200}
				pickupFeeLabel="Tent HQ"
				quote={{ kind: "fee", fee: 800 }}
			/>,
		);
		// Bare amounts on charge lines; RM only on the total.
		expect(screen.getByText("Pickup · Tent HQ")).toBeTruthy();
		expect(screen.getByText("2.00")).toBeTruthy();
		expect(screen.getByText("Delivery")).toBeTruthy();
		expect(screen.getByText("8.00")).toBeTruthy();
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
		expect(screen.getByText("Seller confirms")).toBeTruthy();
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
		expect(screen.getByText("FREE")).toBeTruthy();
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

describe("checkout summary — 31 Jul bug fixes (86eyfq04j)", () => {
	it("gives every product row a caret that flips when expanded", () => {
		const cart = makeCart([makeItem({ variantId: "v1" })]);
		const { container } = render(
			<CheckoutSummary cart={cart} storeName="K Frozen Food" />,
		);
		// The rows have been tappable since the ticket redesign; the only cue was
		// a caption under the whole list, so nobody found them.
		const caret = () => container.querySelector("li svg.lucide-chevron-down");
		expect(caret()).toBeTruthy();
		expect(caret()?.getAttribute("class")).not.toContain("rotate-180");
		fireEvent.click(screen.getByRole("button", { expanded: false }));
		expect(caret()?.getAttribute("class")).toContain("rotate-180");
	});

	it("marks the delivery charge with a truck in every quote state", () => {
		const quotes: CheckoutQuoteView[] = [
			{ kind: "fee", fee: 800 },
			{ kind: "free", reason: "threshold" },
			{ kind: "pending", reason: "unquotable" },
			{ kind: "calculating" },
		];
		for (const quote of quotes) {
			const { container, unmount } = render(
				<CheckoutTotals
					subtotal={9000}
					currency="MYR"
					pickupFee={0}
					quote={quote}
				/>,
			);
			expect(
				container.querySelector("svg.lucide-truck"),
				`expected a truck for quote kind ${quote?.kind}`,
			).toBeTruthy();
			unmount();
		}
	});

	it("marks a pickup charge with its own glyph, so one fee row isn't the odd one out", () => {
		const { container } = render(
			<CheckoutTotals subtotal={9000} currency="MYR" pickupFee={200} />,
		);
		expect(container.querySelector("svg.lucide-package")).toBeTruthy();
	});
});
