// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { m } from "../../paraglide/messages";
import { posterQrUrls, StorePoster } from "./store-poster";

const BASE = {
	storeName: "Lekor Mr Ganu",
	slug: "lekor-mr-ganu",
	logoUrl: null,
	// Left QR = the walk-in KPS WhatsApp deep link (86ey5m35w); right = storefront.
	counterUrl: "https://wa.me/60123456789?text=Store%20ref%3A%20KPS-abc",
	onlineUrl: "https://kedaipal.com/lekor-mr-ganu?src=online",
} as const;

afterEach(cleanup);

/** The two react-qr-code SVGs, scoped to the QR boxes so decorative SVGs
 * (gradient band) never leak into the count. */
function qrSvgs(container: HTMLElement) {
	return container.querySelectorAll('[data-testid="poster-qr"] svg');
}

describe("posterQrUrls", () => {
	it("builds the storefront fallback + online src-tagged URLs", () => {
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

	it("renders exactly two QR codes — the counter (walk-in) and online targets", () => {
		const { container } = render(<StorePoster {...BASE} locale="ms" />);
		expect(qrSvgs(container).length).toBe(2);
	});

	it("encodes distinct counter (walk-in) and online targets in the two QRs", () => {
		// react-qr-code encodes the value into the SVG module geometry, so two
		// different targets must yield two different SVGs — a swapped or blank
		// counterUrl (e.g. reusing the online URL) would collapse them to equal.
		const { container } = render(
			<StorePoster
				{...BASE}
				counterUrl="https://wa.me/60111?text=KPS-xyz"
				onlineUrl="https://kedaipal.com/store?src=online"
				locale="ms"
			/>,
		);
		const svgs = qrSvgs(container);
		expect(svgs.length).toBe(2);
		expect(svgs[0]?.innerHTML).not.toBe(svgs[1]?.innerHTML);
	});

	it("shows the human URL pill without the ?src tag", () => {
		render(<StorePoster {...BASE} locale="ms" />);
		const slug = screen.getByText(BASE.slug);
		expect(slug).toBeTruthy();
		// Mint "kedaipal.com/" prefix (pill color), white slug on top of it.
		expect(slug.className).toContain("text-white");
		expect((slug.parentElement as HTMLElement)?.style.color).toBe(
			"rgb(16, 185, 129)",
		);
		expect(screen.queryByText(/src=/)).toBeNull();
	});

	it("falls back to a text lockup when there is no logo", () => {
		const { container } = render(<StorePoster {...BASE} locale="ms" />);
		// No seller-logo circle; the header carries the store name as text. The
		// remaining <img>s are the fixed decorative assets.
		expect(container.querySelector('[data-testid="poster-logo"]')).toBeNull();
		expect(screen.getAllByText(BASE.storeName).length).toBeGreaterThan(0);
		const srcs = [...container.querySelectorAll("img")].map((img) =>
			img.getAttribute("src"),
		);
		expect(srcs).toEqual([
			"/poster/doodles-left.svg",
			"/poster/doodles-right.svg",
			"/poster/kedaipal-lockup.svg",
			"/poster/phone-shell.png",
		]);
	});

	it("renders the seller logo on a white circle panel when provided", () => {
		const { container } = render(
			<StorePoster
				{...BASE}
				logoUrl="https://files.example/logo.png"
				locale="ms"
			/>,
		);
		const panel = container.querySelector('[data-testid="poster-logo"]');
		expect(panel).toBeTruthy();
		expect(panel?.className).toContain("bg-white");
		// The same logo doubles as the chat avatar in the phone mockup.
		const logoImgs = container.querySelectorAll(
			'img[src="https://files.example/logo.png"]',
		);
		expect(logoImgs.length).toBe(2);
	});

	it("defaults to the brand mint header (no cover image)", () => {
		const { container } = render(<StorePoster {...BASE} locale="ms" />);
		const header = container.querySelector('[data-testid="poster-header"]');
		expect((header as HTMLElement)?.style.backgroundColor).toBe(
			"rgb(16, 185, 129)",
		);
		expect(
			container.querySelector('[data-testid="poster-header-scrim"]'),
		).toBeNull();
	});

	it("renders the cover photo under a scrim when headerImageUrl is set", () => {
		const { container } = render(
			<StorePoster
				{...BASE}
				headerImageUrl="https://files.example/cover.jpg"
				locale="ms"
			/>,
		);
		const cover = container.querySelector(
			'img[src="https://files.example/cover.jpg"]',
		);
		expect(cover).toBeTruthy();
		// Scrim keeps white header text legible on any photo — an <img> + overlay
		// (not a CSS background) so it always prints.
		expect(
			container.querySelector('[data-testid="poster-header-scrim"]'),
		).toBeTruthy();
		// Store name still renders on top.
		expect(screen.getAllByText(BASE.storeName).length).toBeGreaterThan(0);
	});

	it("shows the store's own name + localized bubbles in the phone mockup", () => {
		render(<StorePoster {...BASE} locale="ms" />);
		expect(
			screen.getByText(m.poster_chat_bubble1({}, { locale: "ms" })),
		).toBeTruthy();
		expect(
			screen.getByText(m.poster_chat_online({}, { locale: "ms" })),
		).toBeTruthy();
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
		const headerName = screen
			.getAllByText(longName)
			.find((el) => el.className.includes("font-heading"));
		expect(headerName?.className).toContain("text-[24pt]");
		expect(screen.getByText(longSlug).parentElement?.className).toContain(
			"text-[11pt]",
		);
	});
});
