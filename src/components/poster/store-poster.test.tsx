// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { m } from "../../paraglide/messages";
import { posterQrUrls, StorePoster } from "./store-poster";

const BASE = {
	storeName: "Lekor Mr Ganu",
	slug: "lekor-mr-ganu",
	logoUrl: null,
	origin: "https://kedaipal.com",
} as const;

afterEach(cleanup);

describe("posterQrUrls", () => {
	it("tags each QR target with its src channel", () => {
		expect(posterQrUrls("https://kedaipal.com", "kek-lapis")).toEqual({
			counter: "https://kedaipal.com/kek-lapis?src=counter",
			online: "https://kedaipal.com/kek-lapis?src=online",
		});
	});
});

describe("StorePoster", () => {
	it("renders BM copy when locale is ms (the default poster locale)", () => {
		render(<StorePoster {...BASE} locale="ms" />);
		expect(
			screen.getByText(m.poster_headline({}, { locale: "ms" })),
		).toBeTruthy();
		expect(
			screen.getByText(m.poster_counter_badge({}, { locale: "ms" })),
		).toBeTruthy();
		expect(
			screen.getByText(m.poster_online_step3({}, { locale: "ms" })),
		).toBeTruthy();
	});

	it("renders EN copy when locale is en", () => {
		render(<StorePoster {...BASE} locale="en" />);
		expect(
			screen.getByText(m.poster_headline({}, { locale: "en" })),
		).toBeTruthy();
		expect(
			screen.getByText(m.poster_counter_title({}, { locale: "en" })),
		).toBeTruthy();
	});

	it("renders exactly two QR codes pointing at the tagged storefront URLs", () => {
		const { container } = render(<StorePoster {...BASE} locale="ms" />);
		const svgs = container.querySelectorAll("svg");
		// react-qr-code renders one <svg> per QR; the poster has no other SVGs.
		expect(svgs.length).toBe(2);
	});

	it("shows the human URL pill without the ?src tag", () => {
		render(<StorePoster {...BASE} locale="ms" />);
		expect(screen.getByText(BASE.slug)).toBeTruthy();
		expect(screen.queryByText(/src=/)).toBeNull();
	});

	it("falls back to a text lockup when there is no logo", () => {
		const { container } = render(<StorePoster {...BASE} locale="ms" />);
		// Kedaipal footer logo is the only <img>; no seller logo panel.
		const imgs = container.querySelectorAll("img");
		expect(imgs.length).toBe(1);
		expect(imgs[0]?.getAttribute("src")).toBe("/logo-2.svg");
		expect(screen.getByText(BASE.storeName)).toBeTruthy();
	});

	it("renders the seller logo on a white panel when provided", () => {
		const { container } = render(
			<StorePoster
				{...BASE}
				logoUrl="https://files.example/logo.png"
				locale="ms"
			/>,
		);
		const sellerLogo = container.querySelector(
			'img[src="https://files.example/logo.png"]',
		);
		expect(sellerLogo).toBeTruthy();
		expect(sellerLogo?.parentElement?.className).toContain("bg-white");
	});

	it("steps the store name and slug down for long values", () => {
		const longName = "Kek Lapis Sarawak Warisan Mak Long Enterprise"; // 45 chars
		const longSlug = "kek-lapis-sarawak-warisan-mak-long-enterprise";
		render(
			<StorePoster
				{...BASE}
				storeName={longName}
				slug={longSlug}
				locale="ms"
			/>,
		);
		expect(screen.getByText(longName).className).toContain("text-[26pt]");
		expect(screen.getByText(longSlug).parentElement?.className).toContain(
			"text-[11pt]",
		);
	});
});
