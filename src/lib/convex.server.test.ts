// @vitest-environment node
// The cross-request leak guard (z8r3fdue6f). On the Worker, SSR loaders now
// write Convex answers into the query cache and the SSR-query integration
// ships that cache in the HTML — so if two requests ever share a client, one
// buyer's store is served into another visitor's page. `node` (no `window`)
// is the server path, exactly as the Convex bridge itself detects it.
import { convexQuery } from "@convex-dev/react-query";
import { dehydrate } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";

vi.mock("./env", () => ({
	clientEnv: { VITE_CONVEX_URL: "https://example.convex.cloud" },
	serverEnv: {},
}));
// getRouter() is under test, not the app's ~100 routes — importing the real
// tree costs ~11s and proves nothing more about where the clients come from.
vi.mock("../routeTree.gen", async () => {
	const { createRootRoute } = await import("@tanstack/react-router");
	return { routeTree: createRootRoute() };
});

const storeA = convexQuery(api.retailers.getRetailerBySlug, {
	slug: "store-a",
});

describe("getQueryClients on the server", () => {
	it("builds fresh clients for every request — nothing is shared", async () => {
		const { getQueryClients } = await import("./convex");
		const first = getQueryClients();
		const second = getQueryClients();

		expect(second.queryClient).not.toBe(first.queryClient);
		expect(second.convexQueryClient).not.toBe(first.convexQueryClient);
		expect(second.convexQueryClient?.convexClient).not.toBe(
			first.convexQueryClient?.convexClient,
		);
	});

	it("one request's seeded store never reaches the next request's HTML", async () => {
		const { getQueryClients } = await import("./convex");
		const requestA = getQueryClients();
		requestA.queryClient.setQueryData(storeA.queryKey, {
			status: "ok",
			retailer: { storeName: "Store A" },
		});

		const requestB = getQueryClients();
		expect(requestB.queryClient.getQueryData(storeA.queryKey)).toBeUndefined();
		expect(dehydrate(requestB.queryClient).queries).toHaveLength(0);
	});

	it("getRouter() hands each request its own clients as router context", async () => {
		const { getRouter } = await import("../router");
		const a = getRouter().options.context;
		const b = getRouter().options.context;
		expect(a?.queryClient).toBeDefined();
		expect(b?.queryClient).not.toBe(a?.queryClient);
		expect(b?.convexQueryClient).not.toBe(a?.convexQueryClient);
	});
});
