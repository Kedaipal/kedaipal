import { describe, expect, it } from "vitest";
import {
	allDialCountries,
	dialCountryOption,
	searchDialCountries,
} from "./dial-country-search";

/** First result's ISO — the row the picker lands on when you hit Enter. */
const top = (q: string) => searchDialCountries(q)[0]?.iso;
const isos = (q: string) => searchDialCountries(q).map((o) => o.iso);

describe("searchDialCountries", () => {
	it("matches the dial code — the thing the native <select> could not", () => {
		// The whole reason the select was replaced: its OS type-ahead read the
		// option TEXT, so the string printed on the plate found nothing.
		expect(top("+81")).toBe("JP");
		expect(top("81")).toBe("JP");
		expect(top("+65")).toBe("SG");
		expect(top("60")).toBe("MY");
	});

	it("takes a code the way a buyer might actually type it", () => {
		// Pasted from a contact card, dialled with the IDD prefix, or spaced out.
		for (const q of ["+81", "81", "0081", "+8 1", "+81-"]) {
			expect(top(q)).toBe("JP");
		}
	});

	it("a partial code lists that whole region", () => {
		// "+6" is nobody's code, but it is how you browse the neighbours.
		const hits = isos("+6");
		expect(hits).toContain("MY");
		expect(hits).toContain("SG");
		expect(hits).toContain("ID");
		expect(hits).toContain("TH");
		// …and nothing from another region.
		expect(hits).not.toContain("JP");
		expect(hits).not.toContain("GB");
	});

	it("never reads digits as a name", () => {
		// Letting "1" fall through to a name substring would bury every +1
		// country under any name containing a "1".
		expect(isos("1").every((iso) => dialCountryOption(iso).dial === "1")).toBe(
			true,
		);
	});

	it("matches the name, case-insensitively", () => {
		expect(top("japan")).toBe("JP");
		expect(top("JAPAN")).toBe("JP");
		expect(top("Viet")).toBe("VN");
	});

	it("finds a word inside a name, not just its start", () => {
		// A buyer looking for South Korea types "korea".
		expect(isos("korea")).toContain("KR");
	});

	it("an exact ISO wins outright", () => {
		// "my" is also a substring of several country names; the buyer typing the
		// code on their own plate means Malaysia.
		expect(top("my")).toBe("MY");
		expect(top("sg")).toBe("SG");
		expect(top("ph")).toBe("PH");
	});

	it("ranks a name's start above a match buried mid-string", () => {
		const hits = isos("ind");
		// "India"/"Indonesia" start with it; something merely containing "ind"
		// must not outrank them.
		expect(hits[0] === "IN" || hits[0] === "ID").toBe(true);
	});

	it("returns nothing for a query that matches nothing", () => {
		// Drives the empty state — the picker must say so, not show a blank box.
		expect(searchDialCountries("zzzzzz")).toHaveLength(0);
		expect(searchDialCountries("+99999")).toHaveLength(0);
	});

	it("an empty query is every country", () => {
		expect(searchDialCountries("")).toHaveLength(allDialCountries().length);
		expect(searchDialCountries("   ")).toHaveLength(allDialCountries().length);
	});
});

describe("allDialCountries", () => {
	it("is the full table, A–Z by name", () => {
		const all = allDialCountries();
		// The picker is the only place these are listed, so a dropped row is a
		// country a buyer can no longer choose.
		expect(all.length).toBeGreaterThan(200);
		const names = all.map((o) => o.name);
		expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
	});

	it("every row carries a name and a bare dial code", () => {
		for (const option of allDialCountries()) {
			expect(option.name).not.toBe("");
			// Bare: the `+` is added by the UI, so a stored "+60" would print "++60".
			expect(option.dial).toMatch(/^\d+$/);
		}
	});
});

describe("dialCountryOption", () => {
	it("resolves an ISO to its name and code", () => {
		expect(dialCountryOption("MY")).toMatchObject({
			name: "Malaysia",
			dial: "60",
		});
		expect(dialCountryOption("SG")).toMatchObject({
			name: "Singapore",
			dial: "65",
		});
	});
});
