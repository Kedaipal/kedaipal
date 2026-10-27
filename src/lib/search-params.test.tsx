// @vitest-environment jsdom
// searchText + the router behaviour that makes it and "close every key"
// necessary (z8r3fdtk87): `/app/admin/sellers?q=9981` and `/stores?q=2024`
// crashed to "Something went wrong" because the URL's number leaked past
// validateSearch into `q.trim()`.
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { searchText } from "./search-params";

afterEach(cleanup);

describe("searchText", () => {
	it("reads the scalars TanStack's JSON parse makes out of text back as that text", () => {
		expect(searchText("9981yuzu")).toBe("9981yuzu");
		expect(searchText(9981)).toBe("9981");
		expect(searchText(60123456789)).toBe("60123456789");
		expect(searchText(true)).toBe("true");
	});

	it("keeps the user's spaces — a search box mid-typing is not trimmed", () => {
		expect(searchText("mak ")).toBe("mak ");
	});

	it("reads blank and non-text values as absent, never throws", () => {
		for (const raw of [undefined, null, "", "   ", [1], { a: 1 }, Number.NaN]) {
			expect(searchText(raw)).toBeUndefined();
		}
	});
});

/** Renders one route through a REAL memory router and returns what
 * `useSearch()` handed the component. */
async function searchSeenAt(
	url: string,
	validateSearch: (s: Record<string, unknown>) => { q?: string },
) {
	cleanup();
	const root = createRootRoute({ component: () => <Outlet /> });
	const page = createRoute({
		getParentRoute: () => root,
		path: "/page",
		validateSearch,
		component: function Page() {
			const search = page.useSearch() as Record<string, unknown>;
			return <output>{`${typeof search.q}:${String(search.q)}`}</output>;
		},
	});
	const router = createRouter({
		routeTree: root.addChildren([page]),
		history: createMemoryHistory({ initialEntries: [url] }),
	});
	render(<RouterProvider router={router} />);
	return (await screen.findByRole("status")).textContent;
}

// Pins the TanStack behaviour the whole fix rests on. If a router upgrade
// changes it, this is the test that says why the routes are written this way.
describe("the router merges validateSearch OVER the raw search", () => {
	it("an OMITTED key leaks the raw value — `?q=9981` reaches the component as a number", async () => {
		const omitting = (s: Record<string, unknown>) =>
			typeof s.q === "string" ? { q: s.q } : {};
		expect(await searchSeenAt("/page?q=9981", omitting)).toBe("number:9981");
	});

	it("an explicit `undefined` blocks the leak, and searchText keeps the query", async () => {
		const closed = (s: Record<string, unknown>) => ({
			q: typeof s.q === "string" ? s.q : undefined,
		});
		expect(await searchSeenAt("/page?q=9981", closed)).toBe(
			"undefined:undefined",
		);
		const asText = (s: Record<string, unknown>) => ({ q: searchText(s.q) });
		expect(await searchSeenAt("/page?q=9981", asText)).toBe("string:9981");
	});

	it("text the app wrote itself round-trips as a string (why typing never crashed)", async () => {
		const omitting = (s: Record<string, unknown>) =>
			typeof s.q === "string" ? { q: s.q } : {};
		expect(await searchSeenAt("/page?q=%229981%22", omitting)).toBe(
			"string:9981",
		);
	});
});
