import { describe, expect, test } from "vitest";
import {
	CUSTOM_SHADES,
	customShowcasePalette,
	hexToOklch,
	normalizeHex,
} from "./showcase-color";

/** "oklch(24.0% 0.080 145.2)" → its three numbers. */
function parse(value: string) {
	const m = /^oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)$/.exec(value);
	if (!m) throw new Error(`not an oklch(): ${value}`);
	return { l: Number(m[1]) / 100, c: Number(m[2]), h: Number(m[3]) };
}

describe("hexToOklch", () => {
	test("known anchors", () => {
		expect(hexToOklch("#ffffff").l).toBeCloseTo(1, 3);
		expect(hexToOklch("#000000").l).toBeCloseTo(0, 3);
		// sRGB red ≈ oklch(62.8% 0.258 29.2)
		const red = hexToOklch("#ff0000");
		expect(red.l).toBeCloseTo(0.628, 2);
		expect(red.c).toBeCloseTo(0.258, 2);
		expect(red.h).toBeCloseTo(29.2, 0);
	});
});

describe("customShowcasePalette — the admin picks the hue, we pick the shade", () => {
	test.each([
		"#fff200", // the pale yellow that would put white text on a light ground
		"#ffffff",
		"#00ff66",
		"#0a0a40",
		"#ff00aa",
	])("%s: the ground is always as dark as a curated theme's", (hex) => {
		const p = customShowcasePalette(hex);
		expect(parse(p["--sc-a"]).l).toBeCloseTo(CUSTOM_SHADES.groundA.l, 3);
		expect(parse(p["--sc-b"]).l).toBeCloseTo(CUSTOM_SHADES.groundB.l, 3);
		expect(parse(p["--sc-accent"]).l).toBeCloseTo(CUSTOM_SHADES.accent.l, 3);
		expect(parse(p["--sc-a"]).c).toBeLessThanOrEqual(
			CUSTOM_SHADES.groundA.cMax,
		);
	});
	test("the hue is the admin's", () => {
		const pink = customShowcasePalette("#ff00aa");
		expect(parse(pink["--sc-b"]).h).toBeCloseTo(hexToOklch("#ff00aa").h, 0);
	});
	test("a grey pick comes out neutral", () => {
		expect(parse(customShowcasePalette("#808080")["--sc-b"]).c).toBeLessThan(
			0.001,
		);
	});
});

describe("normalizeHex", () => {
	test("short and upper-case forms are expanded; junk is refused", () => {
		expect(normalizeHex("#ABC")).toBe("#aabbcc");
		expect(normalizeHex("1f7a55")).toBe("#1f7a55");
		expect(normalizeHex("#1F7A55")).toBe("#1f7a55");
		expect(normalizeHex("#12345")).toBeUndefined();
		expect(normalizeHex("red")).toBeUndefined();
	});
});
