import { describe, expect, it } from "vitest";
import { linkify } from "./linkify";

describe("linkify", () => {
	it("leaves plain text as one text segment", () => {
		expect(linkify("Side counter, ring the bell.")).toEqual([
			{ kind: "text", text: "Side counter, ring the bell." },
		]);
	});

	it("links a bare https URL in the middle of a note", () => {
		expect(
			linkify("Pin: https://maps.app.goo.gl/abc123 then the gate"),
		).toEqual([
			{ kind: "text", text: "Pin: " },
			{
				kind: "link",
				text: "https://maps.app.goo.gl/abc123",
				href: "https://maps.app.goo.gl/abc123",
			},
			{ kind: "text", text: " then the gate" },
		]);
	});

	it("leaves sentence punctuation and a closing paren outside the link", () => {
		const segs = linkify("Parking (see https://x.co/park).");
		expect(segs[1]).toEqual({
			kind: "link",
			text: "https://x.co/park",
			href: "https://x.co/park",
		});
		expect(segs[2]).toEqual({ kind: "text", text: ")." });
	});

	it("keeps a paren the URL opened itself", () => {
		const segs = linkify("https://en.wikipedia.org/wiki/Kuih_(food)");
		expect(segs).toHaveLength(1);
		expect(segs[0]).toMatchObject({
			text: "https://en.wikipedia.org/wiki/Kuih_(food)",
		});
	});

	it("gives a www. address an https href but shows it as typed", () => {
		expect(linkify("www.kedaipal.com/map")).toEqual([
			{
				kind: "link",
				text: "www.kedaipal.com/map",
				href: "https://www.kedaipal.com/map",
			},
		]);
	});

	it("never links a non-http scheme", () => {
		expect(linkify("javascript:alert(1) and ftp://x.co")).toEqual([
			{ kind: "text", text: "javascript:alert(1) and ftp://x.co" },
		]);
	});

	it("links several URLs in one note", () => {
		const links = linkify("https://a.co and https://b.co").filter(
			(s) => s.kind === "link",
		);
		expect(links.map((l) => l.text)).toEqual(["https://a.co", "https://b.co"]);
	});
});

describe("linkify — Markdown links (z8r3fdn2uj)", () => {
	it("links the label, not the raw syntax", () => {
		expect(
			linkify("Parking: [guide](https://maps.app.goo.gl/abc) then the gate"),
		).toEqual([
			{ kind: "text", text: "Parking: " },
			{
				kind: "link",
				text: "guide",
				href: "https://maps.app.goo.gl/abc",
			},
			{ kind: "text", text: " then the gate" },
		]);
	});

	it("gives a www. target an https href", () => {
		expect(linkify("[Map](www.kedaipal.com/map)")).toEqual([
			{ kind: "link", text: "Map", href: "https://www.kedaipal.com/map" },
		]);
	});

	it("mixes with bare URLs in the same note", () => {
		const links = linkify("[Pin](https://a.co) or https://b.co").filter(
			(s) => s.kind === "link",
		);
		expect(links).toEqual([
			{ kind: "link", text: "Pin", href: "https://a.co/" },
			{ kind: "link", text: "https://b.co", href: "https://b.co/" },
		]);
	});

	it("never links a non-http Markdown target", () => {
		expect(linkify("[tap](javascript:alert(1))")).toEqual([
			{ kind: "text", text: "[tap](javascript:alert(1))" },
		]);
	});

	it("leaves brackets that aren't a link as text", () => {
		expect(linkify("Ring [twice] at the gate")).toEqual([
			{ kind: "text", text: "Ring [twice] at the gate" },
		]);
	});
});
