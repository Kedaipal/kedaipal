// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { storefrontOrigin, storefrontUrl } from "./storefront-url";

describe("storefront-url", () => {
	it("uses the window origin in the browser", () => {
		// jsdom default origin
		expect(storefrontOrigin()).toBe(window.location.origin);
	});

	it("builds the storefront URL from origin + slug", () => {
		expect(storefrontUrl("kek-lapis")).toBe(
			`${window.location.origin}/kek-lapis`,
		);
	});
});
