// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StorefrontFooter } from "./storefront-footer";

afterEach(cleanup);

describe("StorefrontFooter", () => {
	it("renders the poster-style 'Powered by' lockup", () => {
		render(<StorefrontFooter />);
		// The mint "POWERED BY" pill (uppercased via CSS) + the Kedaipal wordmark
		// image — same lockup as the Store QR Poster.
		expect(screen.getByText(/Powered by/i)).toBeTruthy();
		const wordmark = screen.getByAltText("Kedaipal");
		expect(wordmark.getAttribute("src")).toBe("/poster/kedaipal-lockup.svg");
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
		// The image alt + pill text combine, but an explicit label keeps it robust.
		expect(link?.getAttribute("aria-label")).toBe("Powered by Kedaipal");
	});
});
