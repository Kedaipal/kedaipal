// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { isThemedRouteId } from "./theme";

/**
 * Which surfaces dark mode reaches (z8r3fdadub).
 *
 * The shell emits the pre-paint theme script only on themed routes and strips
 * the class everywhere else, so a mistake here is visible two ways: a marketing
 * page inheriting a seller's dark preference, or an app page that never goes
 * dark at all. Both are silent — nothing throws — hence this test.
 */
describe("themed route ids", () => {
	const routeTree = readFileSync(
		join(__dirname, "../routeTree.gen.ts"),
		"utf8",
	);

	test("the seller app is themed", () => {
		expect(isThemedRouteId("/app")).toBe(true);
		expect(isThemedRouteId("/app/")).toBe(true);
		expect(isThemedRouteId("/app/orders")).toBe(true);
		expect(isThemedRouteId("/app/settings")).toBe(true);
		expect(isThemedRouteId("/app/admin/sellers")).toBe(true);
	});

	test("buyer surfaces are themed", () => {
		expect(isThemedRouteId("/$slug")).toBe(true);
		expect(isThemedRouteId("/$slug_/checkout")).toBe(true);
		expect(isThemedRouteId("/$slug_/p/$productSlug")).toBe(true);
		expect(isThemedRouteId("/track/$token")).toBe(true);
		expect(isThemedRouteId("/claim/$token")).toBe(true);
	});

	test("the marketing site is NOT themed", () => {
		// These are designed brand surfaces with hardcoded mesh backgrounds and a
		// `bg-primary` footer whose token flips hue. Out of scope by decision, not
		// by oversight — see lib/theme.ts.
		for (const id of [
			"/",
			"/pricing",
			"/cost",
			"/privacy",
			"/terms",
			"/acceptable-use",
			"/onboarding",
			"__root__",
		]) {
			expect(isThemedRouteId(id), `${id} must stay light`).toBe(false);
		}
	});

	test("sign-in and sign-up stay light", () => {
		// Clerk renders its own widget with its own appearance config; theming it
		// is a separate job nobody has done.
		expect(isThemedRouteId("/sign-in/$")).toBe(false);
		expect(isThemedRouteId("/sign-up/$")).toBe(false);
	});

	test("a prefix collision cannot smuggle a route in", () => {
		// `startsWith("/app")` alone would match a future `/apply` or `/appeal`.
		expect(isThemedRouteId("/apply")).toBe(false);
		expect(isThemedRouteId("/appeal/$id")).toBe(false);
		// And confirm no such route exists today, so the guard above is honest.
		expect(routeTree).not.toMatch(/id: '\/app(?!\/|')/);
	});

	test("every themed app route id in the tree is classified", () => {
		// Catches the reverse drift: a new /app route that somehow fails the check.
		const ids = [...routeTree.matchAll(/id: '(\/app[^']*)'/g)].map((m) => m[1]);
		expect(ids.length).toBeGreaterThan(10);
		for (const id of ids) {
			expect(isThemedRouteId(id), `${id} should be themed`).toBe(true);
		}
	});
});
