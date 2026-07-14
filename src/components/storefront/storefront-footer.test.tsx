// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StorefrontFooter } from "./storefront-footer";

afterEach(cleanup);

describe("StorefrontFooter", () => {
	it("shows the 'Powered by Kedaipal' wordmark", () => {
		render(<StorefrontFooter />);
		expect(screen.getByText("Kedaipal")).toBeTruthy();
		expect(screen.getByText(/Powered by/)).toBeTruthy();
	});

	it("links to the marketing site with the attribution tag, in a new tab", () => {
		const { container } = render(<StorefrontFooter />);
		const link = container.querySelector("a");
		expect(link?.getAttribute("href")).toBe(
			"https://kedaipal.com?src=storefront_badge",
		);
		expect(link?.getAttribute("target")).toBe("_blank");
		// Never leak the opener when leaving the retailer's store.
		expect(link?.getAttribute("rel")).toContain("noopener");
	});

	it("marks the logomark decorative so the visible text carries meaning", () => {
		const { container } = render(<StorefrontFooter />);
		const img = container.querySelector("img");
		expect(img?.getAttribute("src")).toBe("/logo.svg");
		expect(img?.getAttribute("alt")).toBe("");
		expect(img?.getAttribute("aria-hidden")).toBe("true");
	});
});
