// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StorefrontHeader } from "./storefront-header";

afterEach(cleanup);

const retailer = {
	storeName: "Dapur Nadia",
	storeDescription: "Kuih & pastry pre-order",
};

describe("StorefrontHeader", () => {
	// Every storefront page renders this block, but only the store home is
	// *about* the store — so only there is the store name the page's <h1>.
	// Without the distinction, checkout and the product page would each carry
	// two <h1>s, and every page in the store would share one duplicated
	// heading. See docs/storefront-checkout-page.md ("Heading rule").
	it("makes the store name the page <h1> on the store home", () => {
		render(<StorefrontHeader retailer={retailer} />);
		const heading = screen.getByRole("heading", { level: 1 });
		expect(heading.textContent).toBe("Dapur Nadia");
	});

	it("renders the store name as plain text on subpages", () => {
		render(<StorefrontHeader retailer={retailer} asPageHeading={false} />);
		// Present and readable — just not claiming to be the page's heading,
		// which the subpage itself owns (category / product name, "Checkout").
		expect(screen.getByText("Dapur Nadia").tagName).toBe("P");
		expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
	});

	it("styles the store name identically either way — the prop is semantic only", () => {
		const { container: home } = render(
			<StorefrontHeader retailer={retailer} />,
		);
		const { container: sub } = render(
			<StorefrontHeader retailer={retailer} asPageHeading={false} />,
		);
		expect(sub.querySelector("p")?.className).toBe(
			home.querySelector("h1")?.className,
		);
	});

	it("falls back to the generic tagline when the seller has no blurb", () => {
		render(<StorefrontHeader retailer={{ storeName: "Lekor Mr Ganu" }} />);
		expect(screen.getByText("Browse & order on WhatsApp")).toBeTruthy();
	});
});
