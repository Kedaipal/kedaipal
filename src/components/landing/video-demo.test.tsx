// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_VIDEO, PORTRAIT_MEDIA_QUERY } from "../../lib/demo-video";
import { VideoDemo } from "./video-demo";

/**
 * The behaviours a sighted reviewer on a desktop would never notice: phones
 * get the portrait cut, the soundtrack starts muted with a named control to
 * turn it on, and a rotation across the cut boundary leaves the player in a
 * truthful state. Everything else in the player (autoplay-on-entry, sticky
 * pause) predates this and is exercised by hand in the preview.
 */

let portraitViewport = false;
/** Listeners the component registered on the media query, so a test can
 *  "rotate the phone" by flipping `portraitViewport` and firing them. */
let viewportListeners: Array<() => void> = [];

function installMatchMedia() {
	viewportListeners = [];
	window.matchMedia = vi.fn().mockImplementation((query: string) => ({
		matches: query === PORTRAIT_MEDIA_QUERY ? portraitViewport : false,
		media: query,
		onchange: null,
		addEventListener: vi.fn((_: string, cb: () => void) => {
			viewportListeners.push(cb);
		}),
		removeEventListener: vi.fn(),
		addListener: vi.fn(),
		removeListener: vi.fn(),
		dispatchEvent: vi.fn(),
	}));
}

function rotateToPortrait() {
	act(() => {
		portraitViewport = true;
		for (const cb of viewportListeners) cb();
	});
}

/** Fires "in view" for every observed element, so autoplay is attempted. */
class ImmediateIntersectionObserver {
	private readonly cb: IntersectionObserverCallback;
	constructor(cb: IntersectionObserverCallback) {
		this.cb = cb;
	}
	observe(target: Element) {
		this.cb(
			[{ isIntersecting: true, target } as IntersectionObserverEntry],
			this as unknown as IntersectionObserver,
		);
	}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

/** The one <video> in the section — its aria-label shares words with the
 *  control labels, so query the element, not the label text. */
function videoIn(container: HTMLElement): HTMLVideoElement {
	const video = container.querySelector("video");
	if (!video) throw new Error("no <video> rendered");
	return video;
}

function sourcesOf(video: HTMLVideoElement): string[] {
	return Array.from(video.querySelectorAll("source")).map(
		(s) => s.getAttribute("src") ?? "",
	);
}

describe("VideoDemo", () => {
	beforeEach(() => {
		portraitViewport = false;
		installMatchMedia();
		vi.stubGlobal("IntersectionObserver", ImmediateIntersectionObserver);
		Object.defineProperty(HTMLMediaElement.prototype, "play", {
			configurable: true,
			value: vi.fn().mockResolvedValue(undefined),
		});
		Object.defineProperty(HTMLMediaElement.prototype, "pause", {
			configurable: true,
			value: vi.fn(),
		});
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("serves the landscape cut and poster at md and above", () => {
		const { container } = render(<VideoDemo />);
		const video = videoIn(container);
		expect(sourcesOf(video)).toEqual([
			DEMO_VIDEO.landscape.webm,
			DEMO_VIDEO.landscape.mp4,
		]);
		expect(video.getAttribute("poster")).toBe(DEMO_VIDEO.landscape.poster);
	});

	it("serves the portrait cut and poster on a phone-width viewport", () => {
		portraitViewport = true;
		const { container } = render(<VideoDemo />);
		const video = videoIn(container);
		expect(sourcesOf(video)).toEqual([
			DEMO_VIDEO.portrait.webm,
			DEMO_VIDEO.portrait.mp4,
		]);
		expect(video.getAttribute("poster")).toBe(DEMO_VIDEO.portrait.poster);
	});

	it("starts muted and exposes a named unmute control once playing", async () => {
		const { container } = render(<VideoDemo />);
		const video = videoIn(container);
		expect(video.muted).toBe(true);

		// Autoplay resolved (IntersectionObserver fired, play() succeeded), so
		// the corner controls are on screen. The name carries the state — the
		// action it offers flips — so there is no `aria-pressed` saying it twice.
		const unmute = await screen.findByRole("button", { name: /unmute/i });
		expect(unmute.hasAttribute("aria-pressed")).toBe(false);

		fireEvent.click(unmute);
		expect(video.muted).toBe(false);
		const mute = screen.getByRole("button", { name: /^mute/i });
		expect(mute).toBe(unmute);

		fireEvent.click(mute);
		expect(video.muted).toBe(true);
		expect(screen.getByRole("button", { name: /unmute/i })).toBe(unmute);
	});

	it("re-attempts autoplay when a hidden tab becomes visible", async () => {
		const { container } = render(<VideoDemo />);
		const video = videoIn(container);
		// The observer already fired once (in view, hidden or not).
		await screen.findByRole("button", { name: /unmute/i });
		const play = HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>;
		const callsAfterMount = play.mock.calls.length;

		// jsdom's <video> never leaves `paused`, which is exactly the state a
		// background-tab load leaves a real one in.
		expect(video.paused).toBe(true);
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: () => "visible",
		});
		document.dispatchEvent(new Event("visibilitychange"));
		expect(play.mock.calls.length).toBe(callsAfterMount + 1);
	});

	it("does not resurrect playback the visitor paused", async () => {
		const { container } = render(<VideoDemo />);
		const video = videoIn(container);
		// jsdom's <video> is inert: play() never flips `paused` and never emits
		// `play`. Give this one element a real paused flag so the control's
		// toggle takes the pause branch, the way it does in a browser.
		let paused = true;
		Object.defineProperty(video, "paused", {
			configurable: true,
			get: () => paused,
		});
		video.play = vi.fn(async () => {
			paused = false;
		});
		video.pause = vi.fn(() => {
			paused = true;
		});
		fireEvent.play(video);
		paused = false;
		const pause = await screen.findByRole("button", { name: /pause/i });
		fireEvent.click(pause);
		expect(video.pause).toHaveBeenCalledTimes(1);
		expect(paused).toBe(true);

		document.dispatchEvent(new Event("visibilitychange"));
		expect(video.play).not.toHaveBeenCalled();
		expect(paused).toBe(true);
	});

	it("forgets the old element's playback state when the cut changes", async () => {
		const { container } = render(<VideoDemo />);
		const landscape = videoIn(container);
		fireEvent.play(landscape);
		await screen.findByRole("button", { name: /pause/i });

		// The keyed <video> remounts paused and fires no `pause` on the way out.
		// Stale `playing` would keep a "Pause" control over a stopped clip and
		// hide the centred play button that a refused autoplay relies on.
		rotateToPortrait();
		const portrait = videoIn(container);
		expect(portrait).not.toBe(landscape);
		expect(sourcesOf(portrait)).toEqual([
			DEMO_VIDEO.portrait.webm,
			DEMO_VIDEO.portrait.mp4,
		]);
		expect(screen.queryByRole("button", { name: /pause/i })).toBeNull();
		expect(
			screen.getAllByRole("button", { name: /play/i }).length,
		).toBeGreaterThan(0);
	});

	it("retries a refused unmuted autoplay muted, and says so", async () => {
		// A remount inherits `muted=false` from the visitor's earlier unmute,
		// and iOS refuses unmuted autoplay without a gesture. The player falls
		// back to muted playback rather than a stopped frame, and the mute
		// control flips to "Unmute" so the visitor can see sound is off.
		Object.defineProperty(HTMLMediaElement.prototype, "play", {
			configurable: true,
			value: vi.fn(function (this: HTMLMediaElement) {
				return this.muted
					? Promise.resolve()
					: Promise.reject(
							new DOMException("gesture required", "NotAllowedError"),
						);
			}),
		});
		const { container } = render(<VideoDemo />);
		const unmute = await screen.findByRole("button", { name: /unmute/i });
		fireEvent.click(unmute);
		expect(videoIn(container).muted).toBe(false);

		rotateToPortrait();
		const portrait = videoIn(container);
		await screen.findByRole("button", { name: /unmute/i });
		expect(portrait.muted).toBe(true);
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(3);
		// Muted playback resolved, so the centred "needs a tap" button is gone.
		expect(screen.queryByRole("button", { name: /^play/i })).not.toBeNull();
		expect(container.querySelector("button.absolute.inset-0")).toBeNull();
	});

	it("never fetches ahead of playback", () => {
		const { container } = render(<VideoDemo />);
		const video = videoIn(container);
		expect(video.getAttribute("preload")).toBe("none");
	});
});
