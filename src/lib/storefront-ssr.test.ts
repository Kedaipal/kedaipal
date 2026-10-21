// @vitest-environment node
// Storefront loaders seed the query cache on the server (z8r3fdue6f). Runs the
// REAL stack — the per-request clients from lib/convex.ts, the Convex bridge's
// server path, the $slug loader — with only the wire stubbed: the bridge
// answers SSR reads through `ConvexHttpClient.consistentQuery`.
import { convexQuery } from "@convex-dev/react-query";
import { dehydrate } from "@tanstack/react-query";
import { isNotFound, isRedirect } from "@tanstack/react-router";
import { ConvexHttpClient } from "convex/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { getQueryClients } from "./convex";
import { SSR_READ_TIMEOUT_MS, ssrRetailerBySlug } from "./storefront-ssr";

vi.mock("./env", () => ({
	clientEnv: { VITE_CONVEX_URL: "https://example.convex.cloud" },
	serverEnv: { SITE_URL: "https://kedaipal.com" },
}));

const retailerKey = (slug: string) =>
	convexQuery(api.retailers.getRetailerBySlug, { slug }).queryKey;

const okRetailer = {
	status: "ok",
	retailer: {
		_id: "retailer_1",
		slug: "montanic",
		storeName: "Montanic",
		coverImageUrl: "https://cdn.example/cover.jpg",
		locale: "en",
	},
};

function stubConvex(impl: () => Promise<unknown>) {
	return vi
		.spyOn(ConvexHttpClient.prototype, "consistentQuery")
		.mockImplementation(impl as never);
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("ssrRetailerBySlug", () => {
	it("answers AND seeds the component's key, which ships in the HTML", async () => {
		stubConvex(async () => okRetailer);
		const { queryClient } = getQueryClients();

		const read = await ssrRetailerBySlug(queryClient, "montanic");

		expect(read).toEqual({ ok: true, value: okRetailer });
		expect(queryClient.getQueryData(retailerKey("montanic"))).toEqual(
			okRetailer,
		);
		const shipped = dehydrate(queryClient).queries;
		expect(shipped).toHaveLength(1);
		expect(shipped[0]?.state.data).toEqual(okRetailer);
	});

	it("soft-degrades on a Convex failure and ships NOTHING", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		stubConvex(async () => {
			throw new Error("upstream 502");
		});
		const { queryClient } = getQueryClients();

		const read = await ssrRetailerBySlug(queryClient, "montanic");

		expect(read).toEqual({ ok: false });
		// An errored entry in the payload would hydrate the browser into an
		// error state; an empty payload hands it to the live subscription.
		expect(dehydrate(queryClient).queries).toHaveLength(0);
	});

	it("gives up after the loader budget instead of holding the first byte", async () => {
		vi.useFakeTimers();
		vi.spyOn(console, "error").mockImplementation(() => {});
		stubConvex(() => new Promise(() => {}));
		const { queryClient } = getQueryClients();

		const pending = ssrRetailerBySlug(queryClient, "montanic");
		await vi.advanceTimersByTimeAsync(SSR_READ_TIMEOUT_MS - 1);
		let settled = false;
		void pending.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);

		await vi.advanceTimersByTimeAsync(1);
		expect(await pending).toEqual({ ok: false });
		// Still in flight, so not an answer — it stays out of the HTML.
		expect(dehydrate(queryClient).queries).toHaveLength(0);
	});
});

describe("$slug loader on the seeded cache", () => {
	type Loader = (ctx: {
		params: { slug: string };
		context: ReturnType<typeof getQueryClients>;
	}) => Promise<unknown>;
	const loadStorefront = async () => {
		const { Route } = await import("../routes/$slug");
		return Route.options.loader as unknown as Loader;
	};

	it("returns the head() data and leaves the store in the cache", async () => {
		stubConvex(async () => okRetailer);
		const context = getQueryClients();
		const loader = await loadStorefront();

		const data = await loader({ params: { slug: "montanic" }, context });

		expect(data).toMatchObject({
			storeName: "Montanic",
			canonicalUrl: "https://kedaipal.com/montanic",
		});
		expect(context.queryClient.getQueryData(retailerKey("montanic"))).toEqual(
			okRetailer,
		);
	});

	it("still 404s an unknown slug and 301s a renamed one", async () => {
		const loader = await loadStorefront();

		stubConvex(async () => ({ status: "notFound" }));
		const missing = await loader({
			params: { slug: "nobody" },
			context: getQueryClients(),
		}).catch((e: unknown) => e);
		expect(isNotFound(missing)).toBe(true);

		vi.restoreAllMocks();
		stubConvex(async () => ({ status: "redirect", to: "montanic" }));
		const renamed = await loader({
			params: { slug: "old-name" },
			context: getQueryClients(),
		}).catch((e: unknown) => e);
		expect(isRedirect(renamed)).toBe(true);
		expect(renamed).toMatchObject({
			options: { params: { slug: "montanic" }, statusCode: 301 },
		});
	});

	it("renders the shell (null) on a transient failure — never an error page", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		stubConvex(async () => {
			throw new Error("upstream 502");
		});
		const context = getQueryClients();
		const loader = await loadStorefront();

		expect(await loader({ params: { slug: "montanic" }, context })).toBeNull();
		expect(dehydrate(context.queryClient).queries).toHaveLength(0);
	});
});
