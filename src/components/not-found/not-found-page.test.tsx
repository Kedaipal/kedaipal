// @vitest-environment jsdom
// The not-found page against a REAL TanStack router, so the behaviour the
// page relies on is pinned along with the page: a URL nothing claims is a 404
// (the status Start serves), a dead `/app/...` link renders INSIDE the
// dashboard layout (fuzzy mode), and `/$slug` is still matched on the way to
// `/foo/bar` — which is why its head must stay silent there.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	notFound,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { missOwnedElsewhere, rendersNotFound } from "../../lib/not-found";
import { NotFoundPage, RouteNotFound } from "./not-found-page";

// The router restores scroll on navigation; jsdom doesn't implement it.
beforeAll(() => {
	vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(cleanup);

function buildRouter(path: string) {
	const rootRoute = createRootRoute({ component: Outlet });
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <p>Home</p>,
	});
	const appRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/app",
		component: () => (
			<div data-testid="dashboard-shell">
				<Outlet />
			</div>
		),
	});
	const appOrdersRoute = createRoute({
		getParentRoute: () => appRoute,
		path: "/orders",
		component: () => <p>Orders</p>,
	});
	const storesRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/stores",
		component: () => <p>Stores</p>,
	});
	// Mirrors src/routes/$slug.tsx: one known store, every other slug 404s
	// through the shared page in its store context.
	const slugRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/$slug",
		loader: ({ params }) => {
			if (params.slug !== "kek-sayang") throw notFound();
			return { storeName: "Kek Sayang" };
		},
		notFoundComponent: function StoreMiss() {
			const { slug } = slugRoute.useParams();
			return <NotFoundPage context="store" path={`/${slug}`} />;
		},
		component: () => <p>Storefront</p>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([
			indexRoute,
			appRoute.addChildren([appOrdersRoute]),
			storesRoute,
			slugRoute,
		]),
		history: createMemoryHistory({ initialEntries: [path] }),
		defaultNotFoundComponent: RouteNotFound,
	});
	return router;
}

/** Loads `path`, renders it, and waits until `text` is on screen. */
async function renderAt(path: string, text: string | RegExp) {
	const router = buildRouter(path);
	await router.load();
	render(<RouterProvider router={router} />);
	await screen.findByText(text);
	return router;
}

function link(name: RegExp) {
	return screen.getByRole("link", { name }).getAttribute("href");
}

describe("not-found page — site context", () => {
	test("an unclaimed URL is a 404 with the homepage and the directory as ways out", async () => {
		const router = await renderAt("/foo/bar", "Page not found");
		expect(router.state.statusCode).toBe(404);
		expect(
			screen.getByRole("heading", { level: 1, name: "Page not found" }),
		).toBeTruthy();
		// The path is printed back — seeing it is how the typo gets spotted.
		expect(screen.getByText("/foo/bar")).toBeTruthy();
		expect(link(/go to homepage/i)).toBe("/");
		expect(link(/browse stores/i)).toBe("/stores");
		// The Kedaipal mark leads home.
		expect(link(/kedaipal home/i)).toBe("/");
	});

	test("/$slug is matched on the way, so its head must defer to the root's", async () => {
		const router = await renderAt("/foo/bar", "Page not found");
		const matches = router.state.matches;
		const root = matches[0];
		const slug = matches.find((m) => m.routeId === "/$slug");
		expect(root.globalNotFound).toBe(true);
		// The reason missOwnedElsewhere exists: fuzzy matching still ran
		// `/$slug` (slug "foo"). If TanStack ever stops doing this, the guard
		// is dead weight — and this line says so.
		expect(slug).toBeTruthy();
		expect(missOwnedElsewhere(matches, slug ?? {})).toBe(true);
		expect(missOwnedElsewhere(matches, root)).toBe(false);
	});
});

describe("not-found page — store context", () => {
	test("a slug that names nobody: 'couldn't find that store', directory first", async () => {
		const router = await renderAt(
			"/kek-sayang-bakeri",
			"We couldn't find that store",
		);
		expect(router.state.statusCode).toBe(404);
		expect(
			screen.getByRole("heading", {
				level: 1,
				name: "We couldn't find that store",
			}),
		).toBeTruthy();
		expect(screen.getByText("/kek-sayang-bakeri")).toBeTruthy();
		expect(link(/browse stores/i)).toBe("/stores");
		expect(link(/go to kedaipal/i)).toBe("/");
		expect(screen.getByText(/ask them to send it again/i)).toBeTruthy();

		const slug = router.state.matches.find((m) => m.routeId === "/$slug");
		expect(slug && rendersNotFound(slug)).toBe(true);
		expect(missOwnedElsewhere(router.state.matches, slug ?? {})).toBe(false);
	});

	test("a real store still renders its storefront with a 200", async () => {
		const router = await renderAt("/kek-sayang", "Storefront");
		expect(router.state.statusCode).toBe(200);
		expect(screen.getByText("Storefront")).toBeTruthy();
	});
});

describe("not-found page — dashboard context", () => {
	test("renders INSIDE the dashboard shell, with Home and the nearest section", async () => {
		const router = await renderAt(
			"/app/orders/old/link",
			"This page doesn't exist",
		);
		expect(router.state.statusCode).toBe(404);
		const shell = screen.getByTestId("dashboard-shell");
		expect(shell.textContent).toContain("This page doesn't exist");
		expect(link(/back to home/i)).toBe("/app");
		expect(link(/go to orders/i)).toBe("/app/orders");
		// The shell is the brand: no second wordmark inside it.
		expect(screen.queryByRole("link", { name: /kedaipal home/i })).toBeNull();

		const app = router.state.matches.find((m) => m.routeId === "/app");
		expect(app && rendersNotFound(app)).toBe(true);
	});

	test("no section link when the path names no section", async () => {
		await renderAt("/app/nonsense", "This page doesn't exist");
		expect(link(/back to home/i)).toBe("/app");
		expect(screen.queryByRole("link", { name: /go to/i })).toBeNull();
	});
});

describe("wiring", () => {
	test("the app router uses this page as its default not-found component", () => {
		// The real router imports the whole generated route tree, which drags in
		// every route's Clerk/Convex imports; the wiring is one line, so pin it
		// by source rather than boot the app.
		const source = readFileSync(
			join(__dirname, "..", "..", "router.tsx"),
			"utf8",
		);
		expect(source).toMatch(/defaultNotFoundComponent:\s*RouteNotFound/);
	});
});
