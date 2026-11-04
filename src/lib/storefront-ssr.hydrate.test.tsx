// @vitest-environment jsdom
// The browser half of the storefront SSR seed (z8r3fdue6f): what the server
// shipped is hydrated into the tab's one QueryClient before the first render,
// so the component's own `useQuery(convexQuery(...))` paints from it — no
// skeleton, no fetch — and an empty payload leaves the skeleton path exactly
// as it was before SSR seeding existed.
import { ConvexQueryClient, convexQuery } from "@convex-dev/react-query";
import {
	dehydrate,
	hydrate,
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { getQueryClients } from "./convex";

vi.mock("./env", () => ({
	clientEnv: { VITE_CONVEX_URL: "https://example.convex.cloud" },
}));

const URL_ = "https://example.convex.cloud";
const retailer = { status: "ok", retailer: { storeName: "Montanic" } };

/** What the Worker would put in the HTML: the same bridge hash, one answer. */
function serverPayload(seed: boolean) {
	const bridge = new ConvexQueryClient(URL_);
	const server = new QueryClient({
		defaultOptions: { queries: { queryKeyHashFn: bridge.hashFn() } },
	});
	if (seed) {
		server.setQueryData(
			convexQuery(api.retailers.getRetailerBySlug, { slug: "montanic" })
				.queryKey,
			retailer,
		);
	}
	// The integration serialises the payload into a <script>; round-trip it.
	return JSON.parse(JSON.stringify(dehydrate(server)));
}

function Probe({ onRender }: { onRender: (data: unknown) => void }) {
	// Exactly the storefront route's read.
	const data = useQuery(
		convexQuery(api.retailers.getRetailerBySlug, { slug: "montanic" }),
	).data;
	onRender(data);
	return null;
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	getQueryClients().queryClient.clear();
});

describe("hydrating the storefront seed", () => {
	it("first render paints the shipped store with no client fetch", () => {
		// The live subscription still attaches (that's what keeps price/stock
		// live) — stubbed here so no WebSocket opens.
		vi.spyOn(ConvexReactClient.prototype, "watchQuery").mockReturnValue({
			onUpdate: () => () => {},
			localQueryResult: () => undefined,
		} as never);
		const fetch = vi.spyOn(ConvexReactClient.prototype, "query");
		const { queryClient } = getQueryClients();
		hydrate(queryClient, serverPayload(true));

		const renders: unknown[] = [];
		render(
			<QueryClientProvider client={queryClient}>
				<Probe onRender={(d) => renders.push(d)} />
			</QueryClientProvider>,
		);

		expect(renders[0]).toEqual(retailer);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("an empty payload (SSR read failed) leaves the skeleton path to the live query", () => {
		vi.spyOn(ConvexReactClient.prototype, "watchQuery").mockReturnValue({
			onUpdate: () => () => {},
			localQueryResult: () => undefined,
		} as never);
		vi.spyOn(ConvexReactClient.prototype, "query").mockReturnValue(
			new Promise(() => {}),
		);
		const { queryClient } = getQueryClients();
		hydrate(queryClient, serverPayload(false));

		const renders: unknown[] = [];
		render(
			<QueryClientProvider client={queryClient}>
				<Probe onRender={(d) => renders.push(d)} />
			</QueryClientProvider>,
		);

		// `undefined` is the storefront's StorefrontSkeleton branch.
		expect(renders[0]).toBeUndefined();
	});
});
