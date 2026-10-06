// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	flagEmoji,
	resetFlagEmojiSupportForTest,
	supportsFlagEmoji,
} from "./flag-emoji";

afterEach(() => {
	resetFlagEmojiSupportForTest(undefined);
	vi.restoreAllMocks();
});

/** Stand in for a device's text metrics: `ratio` is pair width ÷ single width.
 * ~1 means the pair composed into one flag glyph; ~2 means it fell back to two
 * letterforms (Windows). */
function stubCanvas(ratio: number | null) {
	const measureText = (s: string) => ({
		// A flag pair is TWO code points; a lone regional indicator is one.
		width: ratio === null ? 0 : [...s].length > 1 ? 32 * ratio : 32,
	});
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
		ratio === undefined
			? null
			: ({ font: "", measureText } as unknown as CanvasRenderingContext2D),
	);
}

describe("flagEmoji", () => {
	it("maps an ISO code to its regional indicator pair", () => {
		expect(flagEmoji("JP")).toBe("\u{1F1EF}\u{1F1F5}");
		expect(flagEmoji("MY")).toBe("\u{1F1F2}\u{1F1FE}");
		expect(flagEmoji("SG")).toBe("\u{1F1F8}\u{1F1EC}");
	});

	it("is case-insensitive and ignores surrounding space", () => {
		expect(flagEmoji("jp")).toBe(flagEmoji("JP"));
		expect(flagEmoji(" jp ")).toBe(flagEmoji("JP"));
	});

	it("returns nothing for anything that isn't a 2-letter code", () => {
		// A stray value must render as empty, never as mojibake beside a name.
		for (const bad of ["", "J", "JPN", "1A", "++", "🇯🇵"]) {
			expect(flagEmoji(bad)).toBe("");
		}
	});

	it("covers every country the picker can list", () => {
		// The picker draws one of these per row; a gap would be a blank cell.
		for (const iso of ["AF", "AX", "ZW", "GB", "US", "VN", "BN"]) {
			expect(flagEmoji(iso)).toHaveLength(4); // two astral code points
		}
	});
});

describe("supportsFlagEmoji", () => {
	it("says yes when the pair composes into one glyph", () => {
		stubCanvas(1);
		expect(supportsFlagEmoji()).toBe(true);
	});

	it("says NO when the pair falls back to two letterforms (Windows)", () => {
		// Segoe UI Emoji has no flag glyphs, so the pair measures ~twice as wide.
		// Without this the picker would silently look WORSE than the badge it
		// replaced. Flip the ratio to 1 and this test goes green — the ratio IS
		// the whole guard.
		stubCanvas(2);
		expect(supportsFlagEmoji()).toBe(false);
	});

	it("falls back to the badge when the measurement is unusable", () => {
		// Zero-width metrics mean we learned nothing; the badge always renders.
		stubCanvas(null);
		expect(supportsFlagEmoji()).toBe(false);
	});

	it("falls back to the badge when canvas throws", () => {
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
			() => {
				throw new Error("blocked");
			},
		);
		expect(supportsFlagEmoji()).toBe(false);
	});

	it("measures once and reuses the answer", () => {
		// It runs in a 248-row render; re-measuring per row would be absurd.
		stubCanvas(1);
		const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
		supportsFlagEmoji();
		supportsFlagEmoji();
		supportsFlagEmoji();
		expect(spy).toHaveBeenCalledTimes(1);
	});
});
