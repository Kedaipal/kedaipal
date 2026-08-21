// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppImage, MAX_LOAD_RETRIES } from "./app-image";

afterEach(cleanup);

function skeletonIn(container: HTMLElement) {
	return container.querySelector('[data-slot="skeleton"]');
}

function imgIn(container: HTMLElement) {
	return container.querySelector("img") as HTMLImageElement | null;
}

/** Fail the image currently mounted, then run out the (jittered) retry delay. */
function failAndFlush(container: HTMLElement) {
	const img = imgIn(container);
	if (img) fireEvent.error(img);
	// Longest possible backoff is base * 1.5; 30s clears every attempt.
	act(() => {
		vi.advanceTimersByTime(30_000);
	});
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

	it("retries a failed load instead of going straight to the fallback, keeping the skeleton up", () => {
		vi.useFakeTimers();
		try {
			const { container } = render(
				<AppImage src="https://example.com/flaky.jpg" alt="Flaky photo" />,
			);
			const first = imgIn(container);

			failAndFlush(container);

			// The <img> is remounted (fresh element = fresh request) against the
			// SAME url, and the buyer still sees a skeleton — never a flash of
			// the broken box on a photo that is simply still arriving.
			const retried = imgIn(container);
			expect(retried).not.toBeNull();
			expect(retried).not.toBe(first);
			expect(retried?.getAttribute("src")).toBe("https://example.com/flaky.jpg");
			expect(skeletonIn(container)).not.toBeNull();
			expect(screen.queryByText("Flaky photo")).toBeNull();

			// A retry that succeeds resolves normally.
			fireEvent.load(retried as HTMLImageElement);
			expect(skeletonIn(container)).toBeNull();
			expect(imgIn(container)?.className).toContain("opacity-100");
		} finally {
			vi.useRealTimers();
		}
	});

	it("gives up after the bounded retry budget and shows the terminal fallback", () => {
		vi.useFakeTimers();
		try {
			const { container } = render(
				<AppImage src="https://example.com/dead-url.jpg" alt="Broken photo" />,
			);

			// Initial attempt + MAX_LOAD_RETRIES retries all fail.
			for (let i = 0; i <= MAX_LOAD_RETRIES; i++) {
				expect(imgIn(container)).not.toBeNull();
				failAndFlush(container);
			}

			expect(imgIn(container)).toBeNull();
			expect(skeletonIn(container)).toBeNull();
			expect(screen.getByText("Broken photo")).toBeTruthy();

			// Terminal: no further timers are pending, so nothing resurrects it.
			act(() => {
				vi.advanceTimersByTime(60_000);
			});
			expect(imgIn(container)).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it("spreads retries with jitter so a grid of failed images can't retry in lockstep", () => {
		vi.useFakeTimers();
		const randomSpy = vi.spyOn(Math, "random");
		try {
			// Two images failing at the same instant must not schedule the same
			// delay — the failures we retry are congestion-driven, so a lockstep
			// retry would rebuild the pile-up that broke them.
			const a = render(<AppImage src="https://example.com/a.jpg" alt="A" />);
			const b = render(<AppImage src="https://example.com/b.jpg" alt="B" />);
			const aBefore = imgIn(a.container);
			const bBefore = imgIn(b.container);

			// Drive the two failures to opposite ends of the jitter window.
			// Delay is base * (0.5 + random) → 350ms for a, 1050ms for b.
			randomSpy.mockReturnValueOnce(0);
			fireEvent.error(aBefore as HTMLImageElement);
			randomSpy.mockReturnValueOnce(1);
			fireEvent.error(bBefore as HTMLImageElement);

			// The <img> stays mounted while a retry is pending — a retry is a
			// REMOUNT (new element, new request), so identity is the signal.
			act(() => {
				vi.advanceTimersByTime(400);
			});
			expect(imgIn(a.container)).not.toBe(aBefore);
			expect(imgIn(b.container)).toBe(bBefore);

			// b lands once its own, longer delay elapses.
			act(() => {
				vi.advanceTimersByTime(1_000);
			});
			expect(imgIn(b.container)).not.toBe(bBefore);
		} finally {
			randomSpy.mockRestore();
			vi.useRealTimers();
		}
	});

	it("does not retry a revoked local preview — a blob: URL never comes back", () => {
		vi.useFakeTimers();
		try {
			const { container } = render(
				<AppImage src="blob:http://localhost/revoked" alt="Upload preview" />,
			);

			failAndFlush(container);

			// Terminal on the first error: retrying a revoked object URL is pure
			// waste, so it goes straight to the fallback.
			expect(imgIn(container)).toBeNull();
			expect(screen.getByText("Upload preview")).toBeTruthy();
		} finally {
			vi.useRealTimers();
		}
	});

	it("gives a new src a fresh retry budget and drops the old src's pending retry", () => {
		vi.useFakeTimers();
		try {
			const { container, rerender } = render(
				<AppImage src="https://example.com/old.jpg" alt="Old" />,
			);

			// Burn the whole budget on the old src.
			for (let i = 0; i <= MAX_LOAD_RETRIES; i++) failAndFlush(container);
			expect(imgIn(container)).toBeNull();

			rerender(<AppImage src="https://example.com/new.jpg" alt="New" />);

			// Fresh budget: the new src can fail and still retry.
			expect(imgIn(container)?.getAttribute("src")).toBe(
				"https://example.com/new.jpg",
			);
			failAndFlush(container);
			expect(imgIn(container)?.getAttribute("src")).toBe(
				"https://example.com/new.jpg",
			);
			expect(skeletonIn(container)).not.toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it("drops a pending retry when the image unmounts", () => {
		vi.useFakeTimers();
		try {
			const { container, unmount } = render(
				<AppImage src="https://example.com/scrolled-away.jpg" alt="Gone" />,
			);
			const before = vi.getTimerCount();
			const img = imgIn(container) as HTMLImageElement;
			fireEvent.error(img);
			// The failure armed a retry…
			expect(vi.getTimerCount()).toBe(before + 1);

			// …and a second error on the same element does not stack another
			// timer on top of the one already armed.
			fireEvent.error(img);
			expect(vi.getTimerCount()).toBe(before + 1);

			unmount();

			// …and unmounting disarms it. Asserted on the pending-timer count
			// rather than on a post-unmount setState warning: React no longer
			// warns about those, so a warning-based assertion would pass even
			// with the cleanup deleted. A storefront grid holds dozens of these
			// and scrolling away mid-retry must not leave work queued.
			expect(vi.getTimerCount()).toBe(before);
		} finally {
			vi.useRealTimers();
		}
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
		vi.useFakeTimers();
		try {
			// Exhaust the retry budget so the first src is genuinely in its
			// terminal error state before the swap.
			for (let i = 0; i <= MAX_LOAD_RETRIES; i++) failAndFlush(container);
		} finally {
			vi.useRealTimers();
		}
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
