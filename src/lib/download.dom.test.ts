// @vitest-environment jsdom
// Device classification for "save a file" (see download.ts). Split from
// download.test.ts because these need a DOM; the pure filename helpers there
// stay on the default edge-runtime environment (which also proves the
// SSR-safety branch).
import { afterEach, describe, expect, test } from "vitest";
import { prefersShareSheet } from "./download";

/** Stub the two signals `prefersShareSheet` reads. jsdom ships neither
 * `maxTouchPoints` (beyond 0) nor `matchMedia`. */
function stubDevice(opts: { touchPoints: number; coarsePointer?: boolean }) {
	Object.defineProperty(navigator, "maxTouchPoints", {
		value: opts.touchPoints,
		configurable: true,
	});
	if (opts.coarsePointer === undefined) return;
	Object.defineProperty(window, "matchMedia", {
		value: (query: string) => ({
			matches: query.includes("coarse") ? opts.coarsePointer : false,
		}),
		configurable: true,
	});
}

afterEach(() => {
	Object.defineProperty(navigator, "maxTouchPoints", {
		value: 0,
		configurable: true,
	});
	// Restore jsdom's default: matchMedia simply isn't implemented there.
	Object.defineProperty(window, "matchMedia", {
		value: undefined,
		configurable: true,
	});
});

describe("prefersShareSheet", () => {
	test("phone / tablet (touch + coarse pointer) → share sheet", () => {
		stubDevice({ touchPoints: 5, coarsePointer: true });
		expect(prefersShareSheet()).toBe(true);
	});

	test("macOS desktop (no touch) → plain download, even though Safari CAN share files", () => {
		// The bug this guards: capability alone put a share-sheet popup in front
		// of a Mac user who tapped "Save QR".
		stubDevice({ touchPoints: 0, coarsePointer: false });
		expect(prefersShareSheet()).toBe(false);
	});

	test("touchscreen laptop (touch points, but mouse-driven) → plain download", () => {
		stubDevice({ touchPoints: 10, coarsePointer: false });
		expect(prefersShareSheet()).toBe(false);
	});

	test("no matchMedia support → plain download (never a surprise sheet)", () => {
		stubDevice({ touchPoints: 5 });
		expect(prefersShareSheet()).toBe(false);
	});
});
