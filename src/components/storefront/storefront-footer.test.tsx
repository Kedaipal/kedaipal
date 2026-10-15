// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
	it("is OFF by default — checkout and claim pages never pull a buyer out", () => {
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

	it("reads in Malay for a Malay store's order page", () => {
		render(<StorefrontFooter slug="sweet-co" discover locale="ms" />);
		expect(
			screen.getByRole("link", { name: /Terokai lebih banyak kedai/ }),
		).toBeTruthy();
	});
});

/**
 * Which pages open the door to other stores is a per-page decision, so it is
 * pinned per page. The order page shows it in every state (Arif, 14 Oct 2026,
 * z8r3fducgw); checkout and a claim page never do — the buyer hasn't placed
 * the order yet. Read from the route source because the routes are too heavy
 * to render here, and a quiet `discover` added to checkout is exactly the
 * regression this guards.
 */
describe("StorefrontFooter — which pages open the door to other stores", () => {
	const route = (file: string) =>
		readFileSync(join(__dirname, "../../routes", file), "utf8");
	const footers = (src: string) =>
		src.match(/<StorefrontFooter\b[^>]*\/>/g) ?? [];

	it.each([
		"$slug_.checkout.tsx",
		"claim.$token.tsx",
	])("%s never passes discover", (file) => {
		const found = footers(route(file));
		expect(found.length).toBeGreaterThan(0);
		for (const footer of found) expect(footer).not.toMatch(/discover/);
	});

	it("the order page passes it, gated on the store's directory listing", () => {
		const found = footers(route("track.$token.tsx")).filter((f) =>
			f.includes("order.retailerSlug"),
		);
		expect(found).toHaveLength(1);
		expect(found[0]).toMatch(/discover=\{/);
		expect(found[0]).toMatch(/order\.marketplaceUnlisted !== true/);
	});
});
