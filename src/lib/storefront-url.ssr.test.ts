// Default (edge-runtime) environment — no `window`, exercising the SSR branch.
import { describe, expect, it } from "vitest";
import { storefrontOrigin, storefrontUrl } from "./storefront-url";

describe("storefront-url (SSR)", () => {
	it("falls back to the production origin without a window", () => {
		expect(storefrontOrigin()).toBe("https://kedaipal.com");
	});

	it("builds the production storefront URL", () => {
		expect(storefrontUrl("kek-lapis")).toBe("https://kedaipal.com/kek-lapis");
	});
});
