// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { jsonLdScript, serializeJsonLd } from "./json-ld";

/**
 * Store names a seller can actually save (≤ 60 chars, no brand word). The
 * last two end the tag WITHOUT a `>` of their own — the parser closes on
 * `</script` + `/` or whitespace — so only escaping `<` defeats all three.
 */
const HOSTILE_NAMES = [
	"</script><script>window.pwned=1</script>",
	"Kedai </script/ x",
	"Kedai </SCRIPT x",
];

/**
 * Parse `children` the way the SSR'd page is parsed — inside a real
 * `<script type="application/ld+json">` — and return what the HTML parser
 * built. The parser is the judge here, not a string assertion: it is what
 * decides where the script element ends.
 */
function parseAsHeadScript(children: string) {
	const doc = new DOMParser().parseFromString(
		`<!doctype html><html><head><script type="application/ld+json">${children}</script></head><body></body></html>`,
		"text/html",
	);
	return Array.from(doc.querySelectorAll("script"));
}

describe("serializeJsonLd", () => {
	it("escapes every HTML-significant character and round-trips to the same data", () => {
		const data = { names: HOSTILE_NAMES, note: "Kuih & <3 > all" };
		const out = serializeJsonLd(data);
		expect(out).not.toMatch(/[<>&]/);
		expect(JSON.parse(out)).toEqual(data);
	});

	it.each(HOSTILE_NAMES)("keeps %j inside ONE script element", (name) => {
		const data = { "@type": "ItemList", name };
		const scripts = parseAsHeadScript(serializeJsonLd(data));
		expect(scripts).toHaveLength(1);
		expect(JSON.parse(scripts[0]?.textContent ?? "")).toEqual(data);
	});

	it("control: a raw JSON.stringify breaks out of the tag", () => {
		// The bug this file exists to prevent — if this ever stops splitting,
		// the cases above have stopped proving anything.
		const scripts = parseAsHeadScript(
			JSON.stringify({ "@type": "ItemList", name: HOSTILE_NAMES[0] }),
		);
		expect(scripts.length).toBeGreaterThan(1);
	});

	it("jsonLdScript returns a head scripts entry", () => {
		expect(jsonLdScript({ a: "<b>" })).toEqual({
			type: "application/ld+json",
			children: '{"a":"\\u003cb\\u003e"}',
		});
	});
});

/**
 * Gate: every JSON-LD script goes through `jsonLdScript`. Any other source
 * file naming the type is pairing it with its own serialisation — exactly how
 * the four routes shipped raw `JSON.stringify` (PR #324 review). House
 * precedent for a scan-the-source gate: `convex-read-pattern.test.ts`.
 */
const SRC = join(__dirname, "..");
const AUTHOR = join(__dirname, "json-ld.ts");
const SKIP_DIRS = new Set(["paraglide", "node_modules"]);

function sourceFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) sourceFiles(path, acc);
		} else if (
			/\.tsx?$/.test(entry.name) &&
			!/\.test\.tsx?$/.test(entry.name)
		) {
			acc.push(path);
		}
	}
	return acc;
}

describe("JSON-LD gate", () => {
	it("no source file outside json-ld.ts names application/ld+json", () => {
		const offenders = sourceFiles(SRC)
			.filter((file) => file !== AUTHOR)
			.filter((file) => readFileSync(file, "utf8").includes("ld+json"))
			.map((file) => relative(SRC, file));
		expect(offenders).toEqual([]);
	});

	it("the gate sees the routes that carry JSON-LD", () => {
		// Guards the walker itself: if it stopped reaching src/routes, the
		// gate above would pass on an empty list.
		const users = sourceFiles(SRC)
			.filter((file) => file !== AUTHOR)
			.filter((file) => readFileSync(file, "utf8").includes("jsonLdScript("))
			.map((file) => relative(SRC, file))
			.sort();
		expect(users).toEqual([
			"routes/$slug.tsx",
			"routes/$slug_.p.$productSlug.tsx",
			"routes/index.tsx",
			"routes/stores.tsx",
		]);
	});
});
