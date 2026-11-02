// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { storeUnavailableHead } from "./store-unavailable";

/**
 * An offline store's buyer pages (`z8r3fdudf7`) leave search from the
 * SERVER-RENDERED head. The first cut rendered `<meta name="robots">` inside
 * the component, which React hoists only in the browser: the SSR HTML a
 * crawler reads carried the root's "index, follow" and a generic title, and
 * the hydrated page carried both robots tags (found hands-on).
 */

describe("storeUnavailableHead", () => {
	test("noindex, and a title that names the store", () => {
		const { meta } = storeUnavailableHead("Corks Out");
		expect(meta).toContainEqual({
			name: "robots",
			content: "noindex, nofollow",
		});
		expect(meta).toContainEqual({
			title: "Corks Out isn't available right now | Kedaipal",
		});
		// ONE robots tag — it replaces the root's, it doesn't sit beside it.
		expect(meta.filter((m) => "name" in m && m.name === "robots")).toHaveLength(
			1,
		);
	});
});

const ROUTES = [
	"$slug.tsx",
	"$slug_.p.$productSlug.tsx",
	"$slug_.c.$categorySlug.tsx",
	"$slug_.checkout.tsx",
];

describe("every buyer route an offline store can be reached on", () => {
	for (const file of ROUTES) {
		const src = readFileSync(
			join(__dirname, "..", "..", "routes", file),
			"utf8",
		);

		test(`${file}: the loader hands head() the marker, not null`, () => {
			expect(src).toMatch(
				/result\.status === "unavailable"\)\s*return \{ unavailable: true, storeName: result\.storeName \}/,
			);
		});

		test(`${file}: head() answers it with storeUnavailableHead`, () => {
			expect(src).toMatch(
				/"unavailable" in loaderData\)\s*return storeUnavailableHead\(loaderData\.storeName\)/,
			);
		});
	}

	test("the component no longer renders a robots tag of its own", () => {
		const src = readFileSync(join(__dirname, "store-unavailable.tsx"), "utf8");
		expect(src).not.toMatch(/<meta\s+name="robots"/);
	});
});
