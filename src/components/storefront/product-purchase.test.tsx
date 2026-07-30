// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoToCheckoutBar } from "./product-purchase";

afterEach(cleanup);

/**
 * The direct-to-checkout CTA (86eybhqye) — tested on the shared piece rather
 * than through a shell, since it's now rendered by the product PAGE (buyers)
 * and no longer by the seller-preview sheet.
 */
describe("GoToCheckoutBar", () => {
	it("hides when the cart is empty", () => {
		render(
			<GoToCheckoutBar
				cartItemCount={0}
				cartTotal={0}
				currency="MYR"
				onCheckout={vi.fn()}
			/>,
		);
		expect(
			screen.queryByRole("button", { name: /go to checkout/i }),
		).toBeNull();
	});

	it("shows count + total once the cart has items, and fires onCheckout", () => {
		const onCheckout = vi.fn();
		render(
			<GoToCheckoutBar
				cartItemCount={3}
				cartTotal={2500}
				currency="MYR"
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
			<GoToCheckoutBar
				cartItemCount={1}
				cartTotal={0}
				currency="MYR"
				onCheckout={vi.fn()}
			/>,
		);
		const cta = screen.getByRole("button", { name: /go to checkout/i });
		expect(cta).toBeTruthy();
		expect(cta.textContent).not.toMatch(/RM/);
	});

	it("hides when no onCheckout handler is wired", () => {
		render(
			<GoToCheckoutBar cartItemCount={3} cartTotal={3000} currency="MYR" />,
		);
		expect(
			screen.queryByRole("button", { name: /go to checkout/i }),
		).toBeNull();
	});
});
