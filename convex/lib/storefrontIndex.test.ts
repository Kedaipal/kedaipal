import { describe, expect, test } from "vitest";
import { storefrontIndexable, storefrontLastmod } from "./storefrontIndex";

const live = {
	unclaimed: false,
	offline: false,
	subscriptionStatus: "active" as const,
	visibleProductCount: 3,
};

describe("storefrontIndexable", () => {
	test("a claimed, online, subscribed store with products is indexable", () => {
		expect(storefrontIndexable(live)).toBe(true);
	});

	test.each(["trialing", "past_due", "on_hold"] as const)(
		"%s stays in the index — the storefront still serves a real catalogue",
		(subscriptionStatus) => {
			expect(storefrontIndexable({ ...live, subscriptionStatus })).toBe(true);
		},
	);

	test("no subscription row at all reads as live (pre-billing store)", () => {
		expect(storefrontIndexable({ ...live, subscriptionStatus: null })).toBe(true);
	});

	test("cancelled drops out", () => {
		expect(storefrontIndexable({ ...live, subscriptionStatus: "cancelled" })).toBe(false);
	});

	test("an empty storefront drops out", () => {
		expect(storefrontIndexable({ ...live, visibleProductCount: 0 })).toBe(false);
	});

	test("unclaimed and offline drop out whatever else is true", () => {
		expect(storefrontIndexable({ ...live, unclaimed: true })).toBe(false);
		expect(storefrontIndexable({ ...live, offline: true })).toBe(false);
	});
});

describe("storefrontLastmod", () => {
	test("is the newest of the store write and any product write", () => {
		expect(
			storefrontLastmod({ retailerUpdatedAt: 10, productUpdatedAts: [5, 30, 20] }),
		).toBe(30);
		expect(storefrontLastmod({ retailerUpdatedAt: 50, productUpdatedAts: [5] })).toBe(50);
	});

	test("with no products it is the store write, never -Infinity", () => {
		expect(storefrontLastmod({ retailerUpdatedAt: 7, productUpdatedAts: [] })).toBe(7);
	});
});
