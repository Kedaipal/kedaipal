// @vitest-environment jsdom
// Key parity (z8r3fdue6f): the store home's REAL components, rendered on the
// cache the REAL $slug loader seeded, must ask for nothing the loader didn't
// seed. A component whose args drift from the loader's (a new field, a
// reordered object, a different `since`) asks for a key the HTML never
// carried — the buyer gets a skeleton under a page that promised a catalog,
// and React reports the server/client mismatch. That drift is invisible to a
// test that only restates the keys, so this one renders.
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { CategoryRail } from "../components/storefront/category-rail";
import { FeaturedProduct } from "../components/storefront/featured-product";
import { ProductGrid } from "../components/storefront/product-grid";
import type { UseCart } from "../hooks/useCart";
import { getQueryClients } from "./convex";

vi.mock("./env", () => ({
	clientEnv: { VITE_CONVEX_URL: "https://example.convex.cloud" },
	serverEnv: { SITE_URL: "https://kedaipal.com" },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	Link: ({
		children,
		...rest
	}: { children: ReactNode } & ComponentProps<"a">) => (
		<a {...rest}>{children}</a>
	),
}));

const RID = "retailer_1";
const ANSWERS: Record<string, unknown> = {
	"retailers:getRetailerBySlug": {
		status: "ok",
		retailer: { _id: RID, slug: "montanic", storeName: "Montanic" },
	},
	"products:list": [],
	"categories:listActivePublic": [],
	"products:popularProducts": [],
};

const cart = {
	items: [],
	add: () => {},
	quantityOf: () => 0,
} as unknown as UseCart;

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	getQueryClients().queryClient.clear();
});

describe("the store home renders from exactly what its loader seeded", () => {
	it("CategoryRail, FeaturedProduct and ProductGrid ask for no new key", async () => {
		// In the browser the loader reads through the live client (a
		// client-side navigation); the subscription it opens is stubbed so no
		// WebSocket dials out.
		vi.spyOn(ConvexReactClient.prototype, "query").mockImplementation(((
			name: string,
		) => Promise.resolve(ANSWERS[name])) as never);
		vi.spyOn(ConvexReactClient.prototype, "watchQuery").mockReturnValue({
			onUpdate: () => () => {},
			localQueryResult: () => undefined,
		} as never);
		const context = getQueryClients();
		const { Route } = await import("../routes/$slug");
		await (
			Route.options.loader as unknown as (ctx: unknown) => Promise<unknown>
		)({ params: { slug: "montanic" }, context });
		const seeded = new Set(
			context.queryClient
				.getQueryCache()
				.getAll()
				.map((q) => q.queryHash),
		);
		expect(seeded.size).toBe(4);

		const retailerId = RID as Id<"retailers">;
		render(
			<QueryClientProvider client={context.queryClient}>
				<CategoryRail retailerId={retailerId} storeSlug="montanic" />
				<FeaturedProduct
					retailerId={retailerId}
					storeSlug="montanic"
					cart={cart}
				/>
				<ProductGrid retailerId={retailerId} storeSlug="montanic" cart={cart} />
			</QueryClientProvider>,
		);

		const asked = context.queryClient
			.getQueryCache()
			.getAll()
			.map((q) => q.queryHash);
		expect(asked.filter((hash) => !seeded.has(hash))).toEqual([]);
		// Every key the page reads answered from the seed — none is fetching.
		expect(
			context.queryClient
				.getQueryCache()
				.getAll()
				.filter((q) => q.state.status !== "success"),
		).toEqual([]);
	});
});
