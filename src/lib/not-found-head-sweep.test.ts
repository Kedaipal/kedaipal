// Every LEAF route's `head()` stays silent when the route was only matched on
// the way to a URL nothing claims.
//
// TanStack fuzzy-matches a static leaf as readily as a param one: `/pricing`
// is matched for `/pricing/anything`, `/stores` for `/stores/x`, and
// `/track/$token` — loader included — for `/track/<token>/x`. The deepest
// head wins the tag dedupe, so a leaf that speaks there puts its title,
// canonical, JSON-LD and even its `robots: index, follow` on a "Page not
// found" body. `pageHead` (src/lib/not-found.ts) is the one mechanism; this
// sweep fails on a route that declares `head` without it, so the next route
// can't regress silently. See docs/not-found.md.
import type { AnyRoute } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

/** Layouts that OWN misses, so their head must speak on one. Adding a route
 * here needs a reason a reviewer can check. */
const OWNS_MISSES: Record<string, string> = {
	// The root owns every miss no layout claims, and its head carries the
	// charset, viewport and stylesheet — a miss under `/app` must never
	// silence it.
	"__root.tsx":
		"owns global misses; charset/viewport/stylesheet live in its head",
	// Every dashboard route is a flat child of `/app`, so `/app` is the deepest
	// route with children under any dead `/app/...` link and titles it.
	"app.tsx": "owns every dashboard miss and titles it",
};

/** What TanStack hands a leaf matched on the way: its own match succeeded,
 * the root carries the miss. `loaderData` is undefined because a wrapped head
 * must return before it reads anything. */
const ON_THE_WAY = (() => {
	const match = { status: "success" as const };
	return {
		match,
		matches: [{ globalNotFound: true, status: "success" as const }, match],
		loaderData: undefined,
		params: {},
	};
})();

const modules = import.meta.glob<{ Route?: AnyRoute }>([
	"../routes/*.tsx",
	"!../routes/*.test.tsx",
]);

describe("a leaf route's head is silent when the miss is the root's", async () => {
	// TanStack types the context per route; the sweep hands every head the one
	// shape a route matched on the way receives.
	const heads: { path: string; head: (ctx: typeof ON_THE_WAY) => unknown }[] =
		[];
	for (const [file, load] of Object.entries(modules)) {
		const head = (await load()).Route?.options.head as
			| ((ctx: typeof ON_THE_WAY) => unknown)
			| undefined;
		if (typeof head === "function") {
			heads.push({ path: file.replace("../routes/", ""), head });
		}
	}

	it("finds the routes that set a head (the sweep is not silently empty)", () => {
		expect(heads.length).toBeGreaterThanOrEqual(16);
	});

	it("every owner listed here still declares a head", () => {
		const declared = new Set(heads.map((h) => h.path));
		for (const owner of Object.keys(OWNS_MISSES)) {
			expect(declared.has(owner), owner).toBe(true);
		}
	});

	for (const { path, head } of heads) {
		if (Object.hasOwn(OWNS_MISSES, path)) continue;
		it(`${path}: returns {} when matched only on the way`, () => {
			expect(head(ON_THE_WAY)).toEqual({});
		});
	}
});
