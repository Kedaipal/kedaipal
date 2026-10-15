// @vitest-environment jsdom
/**
 * The leave guard (z8r3fdtk82), driven through a REAL memory router so the
 * blocker is the one the app runs, not a mock of it.
 */
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { UnsavedState } from "../../lib/product-form-dirty";
import { UnsavedChangesGuard } from "./unsaved-changes-guard";

afterEach(cleanup);

/**
 * Navigate the way a link or the sidebar does. Through the HISTORY, which is
 * where blockers sit: `router.navigate` is typed against the app's own route
 * tree, which this throwaway tree isn't.
 */
function go(
	router: ReturnType<typeof setup>,
	path: string,
	opts?: { ignoreBlocker?: boolean },
) {
	router.history.push(path, undefined, opts);
}

function setup(state: UnsavedState) {
	const root = createRootRoute({ component: () => <Outlet /> });
	const edit = createRoute({
		getParentRoute: () => root,
		path: "/edit",
		validateSearch: (s: Record<string, unknown>) =>
			s.tab === "b" ? { tab: "b" as const } : {},
		component: () => (
			<>
				<UnsavedChangesGuard state={state} />
				<p>editing</p>
			</>
		),
	});
	const list = createRoute({
		getParentRoute: () => root,
		path: "/list",
		component: () => <p>the list</p>,
	});
	const router = createRouter({
		routeTree: root.addChildren([edit, list]),
		history: createMemoryHistory({ initialEntries: ["/edit"] }),
	});
	render(<RouterProvider router={router} />);
	return router;
}

describe("UnsavedChangesGuard", () => {
	it("lets a clean page go without asking", async () => {
		const router = setup("none");
		await screen.findByText("editing");
		await act(async () => go(router, "/list"));
		expect(await screen.findByText("the list")).toBeTruthy();
	});

	it("stops a navigation away from unsaved changes and asks first", async () => {
		const router = setup("changes");
		await screen.findByText("editing");
		act(() => {
			go(router, "/list");
		});
		expect(await screen.findByText("Leave without saving?")).toBeTruthy();
		expect(screen.getByText("editing")).toBeTruthy();
		// Keep editing = stay put, dialog gone.
		await act(async () => {
			screen.getByRole("button", { name: "Keep editing" }).click();
		});
		expect(screen.queryByText("Leave without saving?")).toBeNull();
		expect(router.state.location.pathname).toBe("/edit");
	});

	it("Discard changes lets the navigation through", async () => {
		const router = setup("changes");
		await screen.findByText("editing");
		act(() => {
			go(router, "/list");
		});
		await screen.findByText("Leave without saving?");
		await act(async () => {
			screen.getByRole("button", { name: "Discard changes" }).click();
		});
		expect(await screen.findByText("the list")).toBeTruthy();
		expect(router.state.location.pathname).toBe("/list");
	});

	it("names an in-flight upload instead of 'changes'", async () => {
		const router = setup("uploading");
		await screen.findByText("editing");
		act(() => {
			go(router, "/list");
		});
		expect(await screen.findByText("A photo is still uploading")).toBeTruthy();
	});

	it("never blocks a move within the same page (wizard ↔ full form)", async () => {
		const router = setup("changes");
		await screen.findByText("editing");
		await act(async () => go(router, "/edit?tab=b"));
		await waitFor(() =>
			expect(router.state.location.search).toEqual({ tab: "b" }),
		);
		expect(screen.queryByText("Leave without saving?")).toBeNull();
	});

	it("a save's own exit (ignoreBlocker) is never asked about", async () => {
		const router = setup("changes");
		await screen.findByText("editing");
		await act(async () => go(router, "/list", { ignoreBlocker: true }));
		expect(await screen.findByText("the list")).toBeTruthy();
	});
});
