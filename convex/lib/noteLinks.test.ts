import { describe, expect, test } from "vitest";
import { noteToPlainText } from "./noteLinks";

describe("noteToPlainText (z8r3fdn2uj)", () => {
	test("spells a Markdown link out as label: url", () => {
		expect(
			noteToPlainText("Park here: [guide](https://maps.app.goo.gl/abc)."),
		).toBe("Park here: guide: https://maps.app.goo.gl/abc.");
	});

	test("drops a label that only repeats the URL", () => {
		expect(noteToPlainText("[https://x.co](https://x.co)")).toBe(
			"https://x.co",
		);
	});

	test("converts every link and leaves bare URLs alone", () => {
		expect(
			noteToPlainText("[A](https://a.co) and https://b.co and [C](www.c.co)"),
		).toBe("A: https://a.co and https://b.co and C: www.c.co");
	});

	test("leaves a non-web target and plain brackets as written", () => {
		expect(noteToPlainText("[tap](javascript:alert(1)) [twice]")).toBe(
			"[tap](javascript:alert(1)) [twice]",
		);
	});
});
