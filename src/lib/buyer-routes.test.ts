// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { BUYER_ROUTE_IDS, isBuyerRouteId } from "./buyer-routes";

describe("buyer route ids", () => {
	test("every listed id exists in the generated route tree", () => {
		// The provider branch in __root.tsx keys on these ids — an id that stops
		// existing (route rename/move) would silently turn that buyer surface
		// back into a Clerk page. Match against the generated file so the
		// contract breaks loudly in CI instead.
		const routeTree = readFileSync(
			join(__dirname, "../routeTree.gen.ts"),
			"utf8",
		);
		for (const id of BUYER_ROUTE_IDS) {
			expect(
				routeTree,
				`route id ${id} missing from routeTree.gen.ts`,
			).toContain(`'${id}'`);
		}
	});

	test("classifies buyer vs non-buyer ids", () => {
		expect(isBuyerRouteId("/$slug")).toBe(true);
		expect(isBuyerRouteId("/track/$token")).toBe(true);
		expect(isBuyerRouteId("/$slug_/checkout")).toBe(true);
		// Clerk surfaces must never be classified as buyer routes.
		expect(isBuyerRouteId("/app")).toBe(false);
		expect(isBuyerRouteId("/")).toBe(false);
		expect(isBuyerRouteId("/pricing")).toBe(false);
		expect(isBuyerRouteId("__root__")).toBe(false);
	});
});
