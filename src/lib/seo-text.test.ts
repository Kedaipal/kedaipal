import { describe, expect, test } from "vitest";
import {
	SNIPPET_MAX,
	seoDescription,
	stripMarkdown,
	truncateAtWord,
} from "./seo-text";

describe("stripMarkdown", () => {
	test("removes the markup a seller's product description carries", () => {
		expect(
			stripMarkdown(
				"# Kuih Lapis\n\n**Freshly** made _daily_. Order [here](https://x.y).\n- 9 layers\n- no preservatives\n\n> pre-order 2 days",
			),
		).toBe(
			"Kuih Lapis Freshly made daily. Order here. 9 layers no preservatives pre-order 2 days",
		);
	});

	test("leaves plain prose alone", () => {
		expect(stripMarkdown("Plain text, with punctuation: fine!")).toBe(
			"Plain text, with punctuation: fine!",
		);
	});
});

describe("truncateAtWord", () => {
	test("short text is untouched", () => {
		expect(truncateAtWord("short")).toBe("short");
	});

	test("cuts on a word boundary under the budget with an ellipsis", () => {
		const long = "word ".repeat(60).trim();
		const out = truncateAtWord(long);
		expect(out.length).toBeLessThanOrEqual(SNIPPET_MAX);
		expect(out.endsWith("word…")).toBe(true);
		expect(out).not.toMatch(/wor…$/);
	});

	test("drops trailing punctuation before the ellipsis", () => {
		const text = `${"a".repeat(150)}, ${"b".repeat(20)}`;
		expect(truncateAtWord(text)).toBe(`${"a".repeat(150)}…`);
	});
});

describe("seoDescription", () => {
	test("null and empty give null so the loader falls back", () => {
		expect(seoDescription(undefined)).toBeNull();
		expect(seoDescription("")).toBeNull();
		expect(seoDescription("**")).toBeNull();
	});

	test("strips then trims", () => {
		const out = seoDescription(`**${"long ".repeat(50)}**`);
		expect(out).not.toContain("*");
		expect(out?.length).toBeLessThanOrEqual(SNIPPET_MAX);
	});
});
