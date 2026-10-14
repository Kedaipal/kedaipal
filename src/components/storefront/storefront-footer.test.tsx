// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StorefrontFooter } from "./storefront-footer";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));

afterEach(cleanup);

describe("StorefrontFooter", () => {
	it("renders the poster-style 'Powered by' lockup", () => {
		render(<StorefrontFooter slug="sweet-co" />);
		// The mint "POWERED BY" pill (uppercased via CSS) + the Kedaipal wordmark
		// image — same lockup as the Store QR Poster.
		expect(screen.getByText(/Powered by/i)).toBeTruthy();
		const wordmark = screen.getByAltText("Kedaipal");
		expect(wordmark.getAttribute("src")).toBe("/poster/kedaipal-lockup.svg");
	});

	it("links to the marketing site tagged with the surface AND the store, in a new tab", () => {
		const { container } = render(<StorefrontFooter slug="sweet-co" />);
		const link = container.querySelector("a");
		// `powered-by` is the seller-acquisition naming convention (z8r3fdd1v0,
		// src/lib/marketing-attribution.ts); `store=` is the referrer the
		// signup is attributed to (z8r3fdcwd0). Storefront is the default surface.
		expect(link?.getAttribute("href")).toBe(
			"https://kedaipal.com/?src=powered-by&store=sweet-co",
		);
		expect(link?.getAttribute("target")).toBe("_blank");
		// Never leak the opener when leaving the retailer's store.
		expect(link?.getAttribute("rel")).toContain("noopener");
		// The image alt + pill text combine, but an explicit label keeps it robust.
		expect(link?.getAttribute("aria-label")).toBe("Powered by Kedaipal");
	});

	it("names the surface in the tag — the order page and claim page are not the storefront", () => {
		const track = render(<StorefrontFooter slug="sweet-co" surface="track" />);
		expect(track.container.querySelector("a")?.getAttribute("href")).toBe(
			"https://kedaipal.com/?src=powered-by-track&store=sweet-co",
		);
		cleanup();
		const claim = render(<StorefrontFooter slug="sweet-co" surface="claim" />);
		expect(claim.container.querySelector("a")?.getAttribute("href")).toBe(
			"https://kedaipal.com/?src=powered-by-claim&store=sweet-co",
		);
	});

	it("stays tagged but store-less where no store is in scope (skeleton, unknown slug)", () => {
		const { container } = render(<StorefrontFooter surface="track" />);
		expect(container.querySelector("a")?.getAttribute("href")).toBe(
			"https://kedaipal.com/?src=powered-by-track",
		);
	});
});

describe("StorefrontFooter — Discover more stores (z8r3fdkmyp)", () => {
	it("is OFF by default — checkout, claim and order pages never pull a buyer out", () => {
		render(<StorefrontFooter slug="sweet-co" />);
		expect(screen.queryByText(/Discover more stores/)).toBeNull();
	});

	it("when on, links to the directory in the same tab, above the badge", () => {
		const { container } = render(<StorefrontFooter slug="sweet-co" discover />);
		const link = screen.getByRole("link", { name: /Discover more stores/ });
		expect(link.getAttribute("href")).toBe("/stores");
		expect(link.getAttribute("target")).toBeNull();
		// The badge stays the last link — the seller's brand mark closes the page.
		const links = container.querySelectorAll("a");
		expect(links[links.length - 1].getAttribute("aria-label")).toBe(
			"Powered by Kedaipal",
		);
	});
});
