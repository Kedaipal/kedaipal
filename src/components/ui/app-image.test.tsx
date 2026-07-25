// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppImage } from "./app-image";

afterEach(cleanup);

function skeletonIn(container: HTMLElement) {
	return container.querySelector('[data-slot="skeleton"]');
}

describe("AppImage — loading, error, and empty states", () => {
	it("shows a skeleton while loading, then fades the image in on load", () => {
		const { container } = render(
			<AppImage src="https://example.com/product.jpg" alt="A cake" />,
		);

		expect(skeletonIn(container)).not.toBeNull();
		const img = container.querySelector("img");
		expect(img).not.toBeNull();
		expect(img?.className).toContain("opacity-0");

		fireEvent.load(img as HTMLImageElement);

		expect(skeletonIn(container)).toBeNull();
		expect(img?.className).toContain("opacity-100");
	});

	it("swaps to the muted fallback on error and stops rendering the <img> (terminal, no retry loop)", () => {
		const { container } = render(
			<AppImage src="https://example.com/dead-url.jpg" alt="Broken photo" />,
		);
		const img = container.querySelector("img") as HTMLImageElement;

		fireEvent.error(img);

		expect(container.querySelector("img")).toBeNull();
		expect(skeletonIn(container)).toBeNull();
		expect(screen.getByText("Broken photo")).toBeTruthy();

		// A second error (or any further re-render with the same src) does not
		// resurrect the <img> — the error is terminal until src itself changes.
		fireEvent.error(img);
		expect(container.querySelector("img")).toBeNull();
	});

	it("renders the fallback immediately for an unset src — no <img>, no skeleton, no request", () => {
		const { container } = render(
			<AppImage src={undefined} alt="No photo yet" />,
		);

		expect(container.querySelector("img")).toBeNull();
		expect(skeletonIn(container)).toBeNull();
		expect(screen.getByText("No photo yet")).toBeTruthy();
	});

	it("renders an icon-only, aria-hidden fallback for a decorative (empty alt) image", () => {
		const { container } = render(<AppImage src={undefined} alt="" />);

		const box = container.querySelector("span[aria-hidden]");
		expect(box).not.toBeNull();
		expect(box?.getAttribute("aria-hidden")).toBe("true");
		// No visible caption text for a decorative image.
		expect(box?.textContent).toBe("");
	});

	it("skips the skeleton flash when the image is already complete on mount (cache / back-nav)", () => {
		// jsdom doesn't actually fetch images, so `.complete`/`.naturalWidth`
		// default to "not loaded" — stub them to simulate a browser-cached image
		// that's already decoded the instant the <img> mounts (e.g. SPA
		// back-navigation into the storefront).
		const completeDescriptor = Object.getOwnPropertyDescriptor(
			HTMLImageElement.prototype,
			"complete",
		);
		const naturalWidthDescriptor = Object.getOwnPropertyDescriptor(
			HTMLImageElement.prototype,
			"naturalWidth",
		);
		Object.defineProperty(HTMLImageElement.prototype, "complete", {
			configurable: true,
			get: () => true,
		});
		Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
			configurable: true,
			get: () => 400,
		});

		try {
			const { container } = render(
				<AppImage src="https://example.com/cached.jpg" alt="Cached product" />,
			);

			expect(skeletonIn(container)).toBeNull();
			const img = container.querySelector("img");
			expect(img?.className).toContain("opacity-100");
		} finally {
			if (completeDescriptor) {
				Object.defineProperty(
					HTMLImageElement.prototype,
					"complete",
					completeDescriptor,
				);
			}
			if (naturalWidthDescriptor) {
				Object.defineProperty(
					HTMLImageElement.prototype,
					"naturalWidth",
					naturalWidthDescriptor,
				);
			}
		}
	});

	it("treats blob: URLs (local upload previews) as instant — no skeleton, eager load", () => {
		const { container } = render(
			<AppImage
				src="blob:http://localhost/9c1e6b1e-preview"
				alt="Upload preview"
			/>,
		);

		expect(skeletonIn(container)).toBeNull();
		const img = container.querySelector("img");
		expect(img?.className).toContain("opacity-100");
		expect(img?.getAttribute("loading")).toBe("eager");
	});

	it("treats data: URLs the same as blob: URLs", () => {
		const { container } = render(
			<AppImage
				src="data:image/png;base64,iVBORw0KGgo="
				alt="Inline preview"
			/>,
		);

		expect(skeletonIn(container)).toBeNull();
		expect(container.querySelector("img")?.className).toContain("opacity-100");
	});

	it("resets state when the src prop changes to a new URL", () => {
		const { container, rerender } = render(
			<AppImage src="https://example.com/first.jpg" alt="First" />,
		);
		const firstImg = container.querySelector("img") as HTMLImageElement;
		fireEvent.error(firstImg);
		expect(container.querySelector("img")).toBeNull();

		rerender(<AppImage src="https://example.com/second.jpg" alt="Second" />);

		// A fresh src gets a fresh chance — back to loading, <img> remounted.
		expect(skeletonIn(container)).not.toBeNull();
		const secondImg = container.querySelector("img");
		expect(secondImg).not.toBeNull();
		expect(secondImg?.getAttribute("src")).toBe(
			"https://example.com/second.jpg",
		);
	});

	it("applies eager loading + high fetch priority when `priority` is set", () => {
		const { container } = render(
			<AppImage src="https://example.com/hero.jpg" alt="Hero" priority />,
		);
		const img = container.querySelector("img");
		expect(img?.getAttribute("loading")).toBe("eager");
		expect(img?.getAttribute("fetchpriority")).toBe("high");
	});

	it("with fill={false}, sizes the image by its own intrinsic-ratio classes instead of stretching to fill the wrapper", () => {
		const { container } = render(
			<AppImage
				src="https://example.com/logo.svg"
				alt="Kedaipal"
				aspect="h-8 w-auto"
				fill={false}
			/>,
		);
		const img = container.querySelector("img");
		expect(img?.className).toContain("h-8");
		expect(img?.className).toContain("w-auto");
		// Fill-mode-only classes must not leak into intrinsic mode.
		expect(img?.className).not.toContain("h-full");
		expect(img?.className).not.toContain("w-full");
		expect(img?.className).not.toContain("object-cover");
		expect(img?.className).not.toContain("object-contain");
	});

	it("uses object-contain when objectFit='contain' and object-cover by default", () => {
		const { container, rerender } = render(
			<AppImage src="https://example.com/a.jpg" alt="A" />,
		);
		expect(container.querySelector("img")?.className).toContain("object-cover");

		rerender(
			<AppImage src="https://example.com/a.jpg" alt="A" objectFit="contain" />,
		);
		expect(container.querySelector("img")?.className).toContain(
			"object-contain",
		);
	});
});

describe("AppImage — reduced motion", () => {
	const originalMatchMedia = window.matchMedia;

	afterEach(() => {
		window.matchMedia = originalMatchMedia;
	});

	it("carries motion-reduce classes so the fade + skeleton pulse are gated by prefers-reduced-motion", () => {
		// jsdom has no real matchMedia — stub it to confirm the reduced-motion
		// media query resolves without throwing in an environment that honours
		// it, then assert the component's static classes actually gate on it
		// (Tailwind's `motion-reduce:` variant, not a JS branch).
		window.matchMedia = vi.fn().mockImplementation((query: string) => ({
			matches: query.includes("prefers-reduced-motion"),
			media: query,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			addListener: vi.fn(),
			removeListener: vi.fn(),
			dispatchEvent: vi.fn(),
		})) as unknown as typeof window.matchMedia;

		expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(
			true,
		);

		const { container } = render(
			<AppImage src="https://example.com/a.jpg" alt="A" />,
		);

		expect(container.querySelector("img")?.className).toContain(
			"motion-reduce:transition-none",
		);
		expect(skeletonIn(container)?.className).toContain(
			"motion-reduce:animate-none",
		);
	});
});
