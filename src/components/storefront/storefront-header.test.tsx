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

describe("StorefrontHeader — opening hours line (86eyp5rav)", () => {
	// An all-day week keeps the assertion clock-independent: whatever minute
	// the test runs at, the status is "Open 24 hours today".
	const allDayWeek = Array.from({ length: 7 }, () => ({
		open: 0,
		close: 1439,
	}));

	it("renders the live status line when the store configured hours", () => {
		render(
			<StorefrontHeader retailer={{ ...retailer, openingHours: allDayWeek }} />,
		);
		expect(screen.getByText("Open 24 hours today")).toBeTruthy();
	});

	it("renders nothing for the 24/7 default (no configured hours)", () => {
		render(<StorefrontHeader retailer={retailer} />);
		expect(screen.queryByText(/Open 24 hours|Closed ·|Open now/)).toBeNull();
	});
});
