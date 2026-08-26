import { describe, expect, it } from "vitest";
import {
	IMAGE_ACCEPT,
	imageRejectMessage,
	isPassthroughType,
	MAX_IMAGE_EDGE,
	PASSTHROUGH_TYPES,
	targetDimensions,
} from "./image-upload";

describe("targetDimensions", () => {
	it("scales a phone photo down to the long edge, keeping the aspect ratio", () => {
		// A real iPhone photo is ~4032x3024.
		const out = targetDimensions(4032, 3024);
		expect(out.width).toBe(MAX_IMAGE_EDGE);
		expect(out.height).toBe(1200);
		expect(out.width / out.height).toBeCloseTo(4032 / 3024, 2);
	});

	it("scales by the LONG edge on a portrait image, not by width", () => {
		const out = targetDimensions(3024, 4032);
		expect(out.height).toBe(MAX_IMAGE_EDGE);
		expect(out.width).toBe(1200);
	});

	it("never upscales — spending bytes to invent pixels is the one thing a resize must not do", () => {
		expect(targetDimensions(320, 240)).toEqual({ width: 320, height: 240 });
		expect(targetDimensions(MAX_IMAGE_EDGE, 900)).toEqual({
			width: MAX_IMAGE_EDGE,
			height: 900,
		});
	});

	it("never collapses an extreme aspect ratio to a zero dimension", () => {
		// 8000x2 scales its short edge to 2 * (1600/8000) = 0.4, which rounds to
		// ZERO without the floor — and a canvas of height 0 encodes to nothing,
		// so the upload would fail with "couldn't be processed" on a real (if
		// odd) panorama. Ratios that round to 1 on their own don't test this.
		const out = targetDimensions(8000, 2);
		expect(out.width).toBe(MAX_IMAGE_EDGE);
		expect(out.height).toBeGreaterThanOrEqual(1);
		expect(Math.round(2 * (MAX_IMAGE_EDGE / 8000))).toBe(0); // pins the premise
	});

	it("keeps dimensions integral — canvas silently truncates fractions", () => {
		const out = targetDimensions(3001, 1777);
		expect(Number.isInteger(out.width)).toBe(true);
		expect(Number.isInteger(out.height)).toBe(true);
	});
});

describe("passthrough formats", () => {
	it("passes SVG through — rasterizing a vector throws away the point of it", () => {
		expect(isPassthroughType("image/svg+xml")).toBe(true);
	});

	it("passes GIF through — a canvas re-encode silently keeps only the first frame", () => {
		expect(isPassthroughType("image/gif")).toBe(true);
	});

	it.each([
		"image/jpeg",
		"image/png",
		"image/webp",
		"image/heic",
	])("re-encodes %s rather than passing it through", (type) => {
		expect(isPassthroughType(type)).toBe(false);
	});

	it("every passthrough type is offered by the accept list", () => {
		for (const t of PASSTHROUGH_TYPES) expect(IMAGE_ACCEPT).toContain(t);
	});
});

describe("IMAGE_ACCEPT", () => {
	it("does NOT offer HEIC — the picker greys it out instead of accepting a file we'd refuse", () => {
		expect(IMAGE_ACCEPT).not.toContain("heic");
		expect(IMAGE_ACCEPT).not.toContain("heif");
	});

	it("is explicit rather than a wildcard, which is what let HEIC through", () => {
		expect(IMAGE_ACCEPT).not.toContain("image/*");
		expect(IMAGE_ACCEPT).toContain("image/jpeg");
		expect(IMAGE_ACCEPT).toContain("image/png");
	});
});

describe("imageRejectMessage", () => {
	it("names the file so a rejected batch says WHICH file to fix", () => {
		expect(imageRejectMessage("undecodable", "IMG_0056.HEIC")).toContain(
			"IMG_0056.HEIC",
		);
	});

	it("tells the seller how to convert, not just that it failed", () => {
		const msg = imageRejectMessage("undecodable", "IMG_0056.HEIC");
		// The whole point: "unsupported format" leaves someone stuck.
		expect(msg).toContain(".HEIC");
		expect(msg.toLowerCase()).toContain("export as jpeg");
	});

	it("degrades to a generic subject when there's no filename", () => {
		expect(imageRejectMessage("not_an_image")).toMatch(/^That file/);
	});

	it.each([
		"not_an_image",
		"undecodable",
		"too_large",
		"encode_failed",
	] as const)("returns a non-empty message for %s", (reason) => {
		expect(imageRejectMessage(reason).length).toBeGreaterThan(10);
	});
});
