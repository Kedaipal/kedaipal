// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

// Provide a Convex URL so getConvexClient() (reached via getQueryClient) doesn't
// throw — we only assert the wiring shape, never open a connection.
vi.mock("./env", () => ({
	clientEnv: { VITE_CONVEX_URL: "https://example.convex.cloud" },
}));

describe("getQueryClient", () => {
	it("builds a singleton QueryClient wired to the Convex adapter defaults", async () => {
		const { getQueryClient } = await import("./convex");
		const qc = getQueryClient();

		expect(qc).toBeInstanceOf(QueryClient);
		const defaults = qc.getDefaultOptions().queries;
		// convexQuery's queryKey holds a FunctionReference, so both hash + fetch must
		// come from the Convex bridge — asserting they're wired guards the contract.
		expect(typeof defaults?.queryKeyHashFn).toBe("function");
		expect(typeof defaults?.queryFn).toBe("function");
		// The knob that keeps back-nav instant: 10 min of post-unmount cache/subscription.
		expect(defaults?.gcTime).toBe(1000 * 60 * 10);

		// Lazy singleton — same instance on every call (one cache for the app).
		expect(getQueryClient()).toBe(qc);
	});
});
