// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	GALLERY_DESKTOP_SIZES,
	GALLERY_MOBILE_SIZES,
	GALLERY_PRELOAD_SIZES,
	PageGallery,
} from "./product-page";

afterEach(cleanup);

const storage = (uuid: string) =>
	`https://qualified-chihuahua-441.convex.cloud/api/storage/${uuid}`;
const FIRST = storage("3346125e-42d4-4560-a3e1-abf7438de45f");
const SECOND = storage("9a1f7c22-0b3d-4e51-8f60-1c2d3e4f5a6b");

/** The two CSS-switched branches PageGallery renders (both are in the DOM). */
const branches = (container: HTMLElement) => ({
	mobile: container.querySelector(".lg\\:hidden") as HTMLElement,
	desktop: container.querySelector(".hidden.lg\\:block") as HTMLElement,
});

/**
 * The product route's `head()` preloads this gallery's first image, so the
 * hint and the `<img>` that paints have to name the SAME candidate. They
 * drifted once (PR #308 review): the preload carried the desktop `sizes`
 * alone, so a 390px phone at DPR 2 resolved `100vw` → 780px → preloaded
 * `w=960` while the carousel tile it actually paints asked for `w=640` —
 * wasted bytes on mobile data, the real LCP element unpreloaded, and an extra
 * Cloudflare transformation per product (IMAGE_WIDTHS is the billing cap).
 */
describe("PageGallery — LCP preload contract (z8r3fdegb5)", () => {
	it("the preload hint covers the mobile branch, not just the desktop one", () => {
		// Below lg the carousel tile paints, so the hint's fallback must be the
		// tile's own width — never the hero's `100vw`.
		expect(GALLERY_PRELOAD_SIZES.endsWith(GALLERY_MOBILE_SIZES)).toBe(true);
		expect(GALLERY_PRELOAD_SIZES).not.toContain("100vw");
		// At lg and up the hero paints, and both agree on 45vw.
		expect(GALLERY_PRELOAD_SIZES).toContain("(min-width: 1024px) 45vw");
		expect(GALLERY_DESKTOP_SIZES).toContain("(min-width: 1024px) 45vw");
	});

	it("each branch requests the sizes the hint is built from", () => {
		const { container } = render(<PageGallery images={[FIRST]} name="Kek" />);
		const { mobile, desktop } = branches(container);
		expect(mobile.querySelector("img")?.getAttribute("sizes")).toBe(
			GALLERY_MOBILE_SIZES,
		);
		expect(desktop.querySelector("img")?.getAttribute("sizes")).toBe(
			GALLERY_DESKTOP_SIZES,
		);
	});

	it("only the first MOBILE tile is eager — the hidden hero must stay lazy", () => {
		const { container } = render(
			<PageGallery images={[FIRST, SECOND]} name="Kek" />,
		);
		const { mobile, desktop } = branches(container);
		const tiles = mobile.querySelectorAll("img");

		// The phone's LCP element: eager + high, so it consumes the preload.
		expect(tiles[0].getAttribute("loading")).toBe("eager");
		expect(tiles[0].getAttribute("fetchpriority")).toBe("high");
		// Later tiles are off-screen in the scroller.
		expect(tiles[1].getAttribute("loading")).toBe("lazy");

		// The desktop hero is `display:none` on a phone, and `eager` downloads
		// regardless of visibility — marking it priority would make every phone
		// fetch a 45vw hero it never shows, which is the waste this contract
		// exists to remove. It still paints from the same preload on desktop.
		expect(desktop.querySelector("img")?.getAttribute("loading")).toBe("lazy");
	});
});
