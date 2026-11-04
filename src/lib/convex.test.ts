// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

// Provide a Convex URL so the factory builds the Convex bridge — we only assert
// the wiring shape, never open a connection (the client's sync layer is lazy).
vi.mock("./env", () => ({
	clientEnv: { VITE_CONVEX_URL: "https://example.convex.cloud" },
}));

describe("getQueryClients in the browser", () => {
	it("builds ONE QueryClient wired to the Convex adapter defaults", async () => {
		const { getQueryClients } = await import("./convex");
		const { queryClient, convexQueryClient } = getQueryClients();

		expect(queryClient).toBeInstanceOf(QueryClient);
		const defaults = queryClient.getDefaultOptions().queries;
		// convexQuery's queryKey holds a FunctionReference, so both hash + fetch must
		// come from the Convex bridge — asserting they're wired guards the contract.
		expect(typeof defaults?.queryKeyHashFn).toBe("function");
		expect(typeof defaults?.queryFn).toBe("function");
		// The knob that keeps back-nav instant: 10 min of post-unmount cache/subscription.
		expect(defaults?.gcTime).toBe(1000 * 60 * 10);

		// One cache, one WebSocket for the tab: every call hands back the same
		// clients (the server builds fresh ones — convex.server.test.ts).
		const again = getQueryClients();
		expect(again.queryClient).toBe(queryClient);
		expect(again.convexQueryClient).toBe(convexQueryClient);
		// The providers mount the client the bridge wraps, so Clerk's token
		// reaches adapter reads.
		expect(convexQueryClient?.convexClient).toBeDefined();
	});
});
