// @vitest-environment jsdom
// Who titles the tab on a not-found render. TanStack keeps the DEEPEST
// route's title, and fuzzy matching still runs `/$slug` (and the other buyer
// routes) on the way to a URL nothing claims — so each of those heads must
// step aside for the root's "Page not found", and speak for itself only when
// its own loader threw notFound(). The real routes' `head()`s, called with the
// match shapes TanStack hands them (see not-found-page.test.tsx for those
// shapes produced by a real router).
import { describe, expect, test, vi } from "vitest";
import { NOT_FOUND_TITLE } from "./not-found";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	createFileRoute: () => (opts: Record<string, unknown>) => ({
		...opts,
		options: opts,
	}),
	createRootRoute: (opts: Record<string, unknown>) => ({
		...opts,
		options: opts,
	}),
}));

type Meta = {
	title?: string;
	name?: string;
	content?: string;
	charSet?: string;
};
type HeadFn = (ctx: {
	loaderData: unknown;
	match: { globalNotFound?: boolean; status?: string };
	matches: { globalNotFound?: boolean; status?: string }[];
}) => { meta?: Meta[] } | undefined;

async function headOf(path: string): Promise<HeadFn> {
	const mod = (await import(path)) as { Route: { options: { head: HeadFn } } };
	return mod.Route.options.head;
}

const titleOf = (head: { meta?: Meta[] } | undefined) =>
	head?.meta?.find((m) => m.title)?.title;
const robotsOf = (head: { meta?: Meta[] } | undefined) =>
	head?.meta?.find((m) => m.name === "robots")?.content;

const ROOT_MISS = { globalNotFound: true, status: "success" };

describe("routes matched only on the way stay silent", () => {
	// The full list is swept by not-found-head-sweep.test.ts; these pin the
	// two shapes with data LOADED, which the sweep (undefined loaderData)
	// doesn't reach: a store's head for `/kek-sayang/zz`, and a static
	// marketing page's for `/stores/x`.
	test.each([
		["../routes/$slug", { storeName: "Kek Sayang" }],
		["../routes/stores", { stores: [], focusedShowcase: null }],
	])("%s", async (path, loaderData) => {
		const head = await headOf(path);
		const match = { status: "success" };
		expect(head({ loaderData, match, matches: [ROOT_MISS, match] })).toEqual(
			{},
		);
	});

	test("/stores: speaks on an ordinary render (the wrapper silences only the miss)", async () => {
		const head = await headOf("../routes/stores");
		const match = { status: "success" };
		const out = head({
			loaderData: { stores: [], focusedShowcase: null },
			match,
			matches: [{ status: "success" }, match],
		});
		expect(titleOf(out)).toBeTruthy();
		expect(robotsOf(out)).toBe("index, follow");
	});
});

describe("a slug that names nobody titles its own miss", () => {
	test.each([
		"../routes/$slug",
		"../routes/$slug_.checkout",
	])("%s", async (path) => {
		const head = await headOf(path);
		const match = { status: "notFound" };
		const out = head({ loaderData: undefined, match, matches: [{}, match] });
		expect(titleOf(out)).toBe(NOT_FOUND_TITLE.store);
		expect(robotsOf(out)).toBe("noindex, follow");
	});
});

describe("layouts that own a global miss", () => {
	test("root: 'Page not found', out of search", async () => {
		const head = await headOf("../routes/__root");
		const out = head({ loaderData: undefined, match: ROOT_MISS, matches: [] });
		expect(titleOf(out)).toBe(NOT_FOUND_TITLE.site);
		expect(robotsOf(out)).toBe("noindex, follow");
	});

	test("root: NOT silenced when /app owns the miss — the charset and stylesheet live here", async () => {
		const head = await headOf("../routes/__root");
		const root = { status: "success" };
		const out = head({
			loaderData: undefined,
			match: root,
			matches: [root, { globalNotFound: true, status: "success" }],
		}) as { meta?: Meta[]; links?: unknown[] };
		expect(out.meta?.some((m) => "charSet" in m)).toBe(true);
		expect(out.links?.length).toBeGreaterThan(0);
	});

	test("root: an ordinary page keeps the house title and stays indexable", async () => {
		const head = await headOf("../routes/__root");
		const out = head({
			loaderData: undefined,
			match: { status: "success" },
			matches: [],
		});
		expect(titleOf(out)).toBe("Kedaipal — Order Hub for Small Retailers");
		expect(robotsOf(out)).toBe("index, follow");
	});

	test("/app: titles a dead dashboard link, and only that", async () => {
		const head = await headOf("../routes/app");
		const miss = { globalNotFound: true, status: "success" };
		expect(
			titleOf(head({ loaderData: undefined, match: miss, matches: [] })),
		).toBe(NOT_FOUND_TITLE.app);
		expect(
			titleOf(
				head({
					loaderData: undefined,
					match: { status: "success" },
					matches: [],
				}),
			),
		).toBeUndefined();
	});
});
