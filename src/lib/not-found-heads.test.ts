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

type Meta = { title?: string; name?: string; content?: string };
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

describe("buyer routes matched only on the way stay silent", () => {
	test.each([
		"../routes/$slug",
		"../routes/$slug_.checkout",
		"../routes/$slug_.p.$productSlug",
		"../routes/$slug_.c.$categorySlug",
	])("%s", async (path) => {
		const head = await headOf(path);
		// Even with a store's data loaded (`/kek-sayang/zz`), the root owns it.
		const match = { status: "success" };
		expect(
			head({
				loaderData: { storeName: "Kek Sayang" },
				match,
				matches: [ROOT_MISS, match],
			}),
		).toEqual({});
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
