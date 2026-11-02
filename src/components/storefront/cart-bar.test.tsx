// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UseCart } from "../../hooks/useCart";
import { CartBar } from "./cart-bar";
import { OrderingPausedProvider } from "./seasonal-break";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigate,
}));

afterEach(() => {
	cleanup();
	navigate.mockClear();
});

function cartStub(overrides: Partial<UseCart> = {}): UseCart {
	return {
		hydrated: true,
		items: [],
		cartEvent: undefined,
		cartEventName: undefined,
		itemCount: 2,
		total: 5000,
		currency: "MYR",
		addItem: vi.fn(),
		updateQuantity: vi.fn(),
		quickRemoveProduct: vi.fn(),
		removeItem: vi.fn(),
		removeEventLines: vi.fn(),
		clearCart: vi.fn(),
		setAnswer: vi.fn(),
		quantityForProduct: () => 0,
		...overrides,
	} as UseCart;
}

function renderBar(cart: UseCart, paused = false) {
	return render(
		<OrderingPausedProvider paused={paused}>
			<CartBar cart={cart} storeSlug="herb" />
		</OrderingPausedProvider>,
	);
}

describe("CartBar — floating pill (z8r3fdegb5)", () => {
	it("renders nothing while the cart is empty — no chrome announcing 'Empty'", () => {
		const { container } = renderBar(cartStub({ itemCount: 0, total: 0 }));
		expect(container.innerHTML).toBe("");
	});

	it("shows count, items line and total once something is in the cart", () => {
		renderBar(cartStub());
		expect(screen.getByText("2")).toBeTruthy();
		expect(screen.getByText("2 items")).toBeTruthy();
		expect(screen.getByText(/RM\s*50\.00/)).toBeTruthy();
	});

	it("singularises one item", () => {
		renderBar(cartStub({ itemCount: 1, total: 2500 }));
		expect(screen.getByText("1 item")).toBeTruthy();
	});

	it("caps the count badge at 99+ (the RM 9,999.99 × 100 case)", () => {
		renderBar(cartStub({ itemCount: 100, total: 99999900 }));
		expect(screen.getByText("99+")).toBeTruthy();
		// The exact figure still reads beside it.
		expect(screen.getByText("100 items")).toBeTruthy();
		expect(screen.getByText(/RM\s*999,999\.00/)).toBeTruthy();
	});

	it("checkout navigates to the checkout route", () => {
		renderBar(cartStub());
		fireEvent.click(screen.getByRole("button", { name: /checkout/i }));
		expect(navigate).toHaveBeenCalledWith({
			to: "/$slug/checkout",
			params: { slug: "herb" },
		});
	});

	it("keeps the pill during a seasonal break but disables checkout with the reason", () => {
		renderBar(cartStub(), true);
		const cta = screen.getByRole("button", {
			name: "Ordering paused",
		}) as HTMLButtonElement;
		expect(cta.disabled).toBe(true);
		// The cart's contents stay visible — nothing is lost when the store reopens.
		expect(screen.getByText("2 items")).toBeTruthy();
	});
});
