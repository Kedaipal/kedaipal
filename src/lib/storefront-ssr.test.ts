// @vitest-environment node
// Storefront loaders seed the query cache on the server (z8r3fdue6f). Runs the
// REAL stack — the per-request clients from lib/convex.ts, the Convex bridge's
// server path, the three storefront loaders — with only the wire stubbed: the
// bridge answers SSR reads through `ConvexHttpClient.consistentQuery`, keyed
// here by function name.
import { convexQuery } from "@convex-dev/react-query";
import { dehydrate, type QueryClient } from "@tanstack/react-query";
import { isNotFound, isRedirect } from "@tanstack/react-router";
import { ConvexHttpClient } from "convex/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { popularSince } from "../../convex/lib/popularProducts";
import { getQueryClients } from "./convex";
import {
	SSR_READ_TIMEOUT_MS,
	ssrDeadline,
	ssrRetailerBySlug,
	ssrStorefrontHome,
} from "./storefront-ssr";

vi.mock("./env", () => ({
	clientEnv: { VITE_CONVEX_URL: "https://example.convex.cloud" },
	serverEnv: {
		CONVEX_URL: "https://example.convex.cloud",
		SITE_URL: "https://kedaipal.com",
	},
}));

const RID = "retailer_1";
const okRetailer = {
	status: "ok",
	retailer: {
		_id: RID,
		slug: "montanic",
		storeName: "Montanic",
		locale: "en",
	},
};
const product = {
	_id: "product_1",
	slug: "yeti-tent",
	name: "Yeti Tent",
	description: "Four-season tent",
	imageUrls: ["https://cdn.example/yeti.jpg"],
	currency: "MYR",
	variants: [{ _id: "variant_1", name: "Default", price: 89_00, active: true }],
};
const categoryPage = {
	category: { name: "Yeti", slug: "yeti", description: undefined },
	products: [product],
};

type Answers = Record<string, () => Promise<unknown>>;
const HOME: Answers = {
	"retailers:getRetailerBySlug": async () => okRetailer,
	"products:list": async () => [product],
	"categories:listActivePublic": async () => [{ slug: "yeti", name: "Yeti" }],
	"products:popularProducts": async () => [product._id],
	"categories:getPublicPage": async () => categoryPage,
	"products:getPublicBySlug": async () => product,
};

/** Stub the wire: every SSR read answers from `answers` by function name. */
function stubConvex(answers: Answers) {
	return vi
		.spyOn(ConvexHttpClient.prototype, "consistentQuery")
		.mockImplementation(((name: string) => {
			const answer = answers[name];
			if (!answer) throw new Error(`unexpected read ${name}`);
			return answer();
		}) as never);
}

const seeded = (queryClient: QueryClient) =>
	dehydrate(queryClient)
		.queries.map((q) => q.queryHash.split("|")[1])
		.sort();

const retailerKey = (slug: string) =>
	convexQuery(api.retailers.getRetailerBySlug, { slug }).queryKey;

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("ssrRetailerBySlug", () => {
	it("answers AND seeds the component's key, which ships in the HTML", async () => {
		stubConvex(HOME);
		const { queryClient } = getQueryClients();

		const read = await ssrRetailerBySlug(
			queryClient,
			"montanic",
			ssrDeadline(),
		);

		expect(read).toEqual({ ok: true, value: okRetailer });
		expect(queryClient.getQueryData(retailerKey("montanic"))).toEqual(
			okRetailer,
		);
		expect(seeded(queryClient)).toEqual(["retailers:getRetailerBySlug"]);
	});

	it("soft-degrades on a Convex failure and ships NOTHING", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		stubConvex({
			"retailers:getRetailerBySlug": async () => {
				throw new Error("upstream 502");
			},
		});
		const { queryClient } = getQueryClients();

		const read = await ssrRetailerBySlug(
			queryClient,
			"montanic",
			ssrDeadline(),
		);

		expect(read).toEqual({ ok: false });
		// An errored entry in the payload would hydrate the browser into an
		// error state; an empty payload hands it to the live subscription.
		expect(seeded(queryClient)).toEqual([]);
	});

	it("gives up at the deadline instead of holding the first byte", async () => {
		vi.useFakeTimers();
		vi.spyOn(console, "error").mockImplementation(() => {});
		stubConvex({ "retailers:getRetailerBySlug": () => new Promise(() => {}) });
		const { queryClient } = getQueryClients();

		const pending = ssrRetailerBySlug(queryClient, "montanic", ssrDeadline());
		let settled = false;
		void pending.then(() => {
			settled = true;
		});
		await vi.advanceTimersByTimeAsync(SSR_READ_TIMEOUT_MS - 1);
		expect(settled).toBe(false);

		await vi.advanceTimersByTimeAsync(1);
		expect(await pending).toEqual({ ok: false });
		// Still in flight, so not an answer — it stays out of the HTML.
		expect(seeded(queryClient)).toEqual([]);
	});
});

describe("ssrStorefrontHome — one deadline for the whole loader", () => {
	it("a slow store read leaves the catalog only what's left of the budget", async () => {
		vi.useFakeTimers();
		vi.spyOn(console, "error").mockImplementation(() => {});
		stubConvex({
			"retailers:getRetailerBySlug": () =>
				new Promise((resolve) => setTimeout(() => resolve(okRetailer), 2_500)),
			"products:list": () => new Promise(() => {}),
			"categories:listActivePublic": async () => [],
			"products:popularProducts": async () => [],
		});
		const { queryClient } = getQueryClients();
		const deadline = ssrDeadline();

		const loader = (async () => {
			await ssrRetailerBySlug(queryClient, "montanic", deadline);
			return ssrStorefrontHome(queryClient, RID as never, deadline);
		})();
		let settled = false;
		void loader.then(() => {
			settled = true;
		});

		// 3s after the loader started — not 3s after the catalog started.
		await vi.advanceTimersByTimeAsync(SSR_READ_TIMEOUT_MS);
		expect(settled).toBe(true);
		expect(await loader).toEqual({ ok: false });
		// What answered in time still ships; the hung grid read doesn't.
		expect(seeded(queryClient)).toEqual([
			"categories:listActivePublic",
			"products:popularProducts",
			"retailers:getRetailerBySlug",
		]);
	});
});

type Loader = (ctx: {
	params: Record<string, string>;
	context: ReturnType<typeof getQueryClients>;
}) => Promise<unknown>;

async function loaderOf(
	path: "$slug" | "$slug_.c.$categorySlug" | "$slug_.p.$productSlug",
): Promise<Loader> {
	const mod =
		path === "$slug"
			? await import("../routes/$slug")
			: path === "$slug_.c.$categorySlug"
				? await import("../routes/$slug_.c.$categorySlug")
				: await import("../routes/$slug_.p.$productSlug");
	return mod.Route.options.loader as unknown as Loader;
}

describe("$slug loader — the store home", () => {
	it("seeds the store and every catalog read the home renders", async () => {
		const wire = stubConvex(HOME);
		const context = getQueryClients();
		const loader = await loaderOf("$slug");

		const data = await loader({ params: { slug: "montanic" }, context });

		expect(data).toMatchObject({
			storeName: "Montanic",
			canonicalUrl: "https://kedaipal.com/montanic",
		});
		expect(seeded(context.queryClient)).toEqual([
			"categories:listActivePublic",
			"products:list",
			"products:popularProducts",
			"retailers:getRetailerBySlug",
		]);
		// The shelf's key carries the same MYT-midnight `since` it renders with.
		expect(
			context.queryClient.getQueryData(
				convexQuery(api.products.popularProducts, {
					retailerId: RID as never,
					since: popularSince(),
				}).queryKey,
			),
		).toEqual([product._id]);
		// Four reads, one each — the share-image fallback reused the seeded
		// grid rather than asking for it a second time.
		expect(wire).toHaveBeenCalledTimes(4);
		expect(data).toMatchObject({
			ogImageUrl: expect.stringContaining("yeti.jpg"),
		});
	});

	it("a failed catalog read still renders the store — the grid paints live", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		stubConvex({
			...HOME,
			"products:list": async () => {
				throw new Error("upstream 502");
			},
		});
		const context = getQueryClients();
		const loader = await loaderOf("$slug");

		const data = await loader({ params: { slug: "montanic" }, context });

		expect(data).toMatchObject({
			storeName: "Montanic",
			ogImageUrl: undefined,
		});
		expect(seeded(context.queryClient)).not.toContain("products:list");
		expect(seeded(context.queryClient)).toContain(
			"retailers:getRetailerBySlug",
		);
	});

	it("still 404s an unknown slug and 301s a renamed one", async () => {
		const loader = await loaderOf("$slug");

		stubConvex({
			"retailers:getRetailerBySlug": async () => ({ status: "notFound" }),
		});
		const missing = await loader({
			params: { slug: "nobody" },
			context: getQueryClients(),
		}).catch((e: unknown) => e);
		expect(isNotFound(missing)).toBe(true);

		vi.restoreAllMocks();
		stubConvex({
			"retailers:getRetailerBySlug": async () => ({
				status: "redirect",
				to: "montanic",
			}),
		});
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
		stubConvex({
			"retailers:getRetailerBySlug": async () => {
				throw new Error("upstream 502");
			},
		});
		const context = getQueryClients();
		const loader = await loaderOf("$slug");

		expect(await loader({ params: { slug: "montanic" }, context })).toBeNull();
		expect(seeded(context.queryClient)).toEqual([]);
	});
});

describe("$slug/c/$categorySlug loader", () => {
	it("seeds the category's products and the store's categories", async () => {
		stubConvex(HOME);
		const context = getQueryClients();
		const loader = await loaderOf("$slug_.c.$categorySlug");

		const data = await loader({
			params: { slug: "montanic", categorySlug: "yeti" },
			context,
		});

		expect(data).toMatchObject({ categoryName: "Yeti" });
		expect(seeded(context.queryClient)).toEqual([
			"categories:getPublicPage",
			"categories:listActivePublic",
			"retailers:getRetailerBySlug",
		]);
	});

	it("still 404s an unknown category", async () => {
		stubConvex({ ...HOME, "categories:getPublicPage": async () => null });
		const loader = await loaderOf("$slug_.c.$categorySlug");
		const missing = await loader({
			params: { slug: "montanic", categorySlug: "nope" },
			context: getQueryClients(),
		}).catch((e: unknown) => e);
		expect(isNotFound(missing)).toBe(true);
	});
});

describe("$slug/p/$productSlug loader", () => {
	it("seeds the product; the head-only breadcrumb read is not shipped", async () => {
		stubConvex(HOME);
		const breadcrumb = vi
			.spyOn(ConvexHttpClient.prototype, "query")
			.mockResolvedValue({ name: "Yeti", slug: "yeti" } as never);
		const context = getQueryClients();
		const loader = await loaderOf("$slug_.p.$productSlug");

		const data = await loader({
			params: { slug: "montanic", productSlug: "yeti-tent" },
			context,
		});

		expect(data).toMatchObject({
			productName: "Yeti Tent",
			primaryCategory: { slug: "yeti" },
		});
		expect(breadcrumb).toHaveBeenCalledTimes(1);
		expect(seeded(context.queryClient)).toEqual([
			"products:getPublicBySlug",
			"retailers:getRetailerBySlug",
		]);
	});

	it("still 404s an unknown product", async () => {
		stubConvex({ ...HOME, "products:getPublicBySlug": async () => null });
		const loader = await loaderOf("$slug_.p.$productSlug");
		const missing = await loader({
			params: { slug: "montanic", productSlug: "nope" },
			context: getQueryClients(),
		}).catch((e: unknown) => e);
		expect(isNotFound(missing)).toBe(true);
	});
});
