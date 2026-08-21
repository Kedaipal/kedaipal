import { describe, expect, test } from "vitest";
import { losesCharacters, printable, toLatin1 } from "./latin1";

describe("toLatin1", () => {
	test("passes Latin-1 through untouched", () => {
		expect(toLatin1("Blk 123 Ang Mo Kio Ave 4, #05-678")).toBe(
			"Blk 123 Ang Mo Kio Ave 4, #05-678",
		);
		// Accented characters live inside WinAnsi and must survive.
		expect(toLatin1("Café Señor")).toBe("Café Señor");
	});

	test("folds typographic glyphs to their ASCII spelling", () => {
		expect(toLatin1("Jalan O’Brien")).toBe("Jalan O'Brien");
		expect(toLatin1("2 × Ribeye — 500g…")).toBe("2 x Ribeye - 500g...");
	});

	test("drops what the standard fonts cannot draw", () => {
		expect(toLatin1("陈大文")).toBe("");
		// Only the code points go — tidying the gap they leave is `printable`'s
		// job, so callers that care about emptiness use that instead.
		expect(toLatin1("Ribeye 🥩")).toBe("Ribeye ");
	});
});

describe("losesCharacters", () => {
	test("folding a curly quote loses nothing", () => {
		expect(losesCharacters("Jalan O’Brien")).toBe(false);
		expect(losesCharacters("2 × Ribeye — 500g…")).toBe(false);
		expect(losesCharacters("Blk 123, #05-678")).toBe(false);
	});

	test("true the moment a character cannot be drawn", () => {
		expect(losesCharacters("陈大文")).toBe(true);
		// The dangerous case: mostly fine, quietly missing a word.
		expect(losesCharacters("238 乌节路")).toBe(true);
		expect(losesCharacters("Ribeye 🥩")).toBe(true);
	});
});

describe("printable", () => {
	test("undefined in, undefined out", () => {
		expect(printable(undefined)).toBeUndefined();
	});

	test("collapses to undefined when nothing survives — the fallback signal", () => {
		expect(printable("   ")).toBeUndefined();
		expect(printable("陈大文")).toBeUndefined();
		// Emoji-only store name: the caller's `?? "Store"` has to fire.
		expect(printable("🎂")).toBeUndefined();
	});

	test("trims what does survive", () => {
		expect(printable("  Wagyu Walid  ")).toBe("Wagyu Walid");
		expect(printable("陈 Tan")).toBe("Tan");
	});
});
