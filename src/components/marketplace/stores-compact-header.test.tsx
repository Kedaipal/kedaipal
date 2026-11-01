// @vitest-environment jsdom
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
import type { MarketplaceChip } from "../../lib/marketplace";
import { StoresCompactHeader } from "./stores-compact-header";

afterEach(cleanup);

const CHIPS: Array<{ id: MarketplaceChip; label: string }> = [
	{ id: "all", label: "All stores" },
	{ id: "open", label: "Open now" },
];

/** Real router: the bar's logo and seller CTA are links. */
function renderBar(props: { visible: boolean; docked?: boolean }) {
	const rootRoute = createRootRoute({ component: () => <Outlet /> });
	const index = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => (
			<StoresCompactHeader
				{...props}
				search=""
				onSearch={() => {}}
				chip="all"
				chips={CHIPS}
				onChip={() => {}}
				maxLength={80}
				placeholder="Stores or booths…"
			/>
		),
	});
	const app = createRoute({
		getParentRoute: () => rootRoute,
		path: "/app",
		component: () => null,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([index, app]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	// biome-ignore lint/suspicious/noExplicitAny: stub tree, not the app's registered one
	render(<RouterProvider router={router as any} />);
}

/** The bar's root: the element that carries aria-hidden. */
async function bar() {
	const input = await screen.findByPlaceholderText("Stores or booths…");
	const root = input.closest("[aria-hidden]");
	if (!(root instanceof HTMLElement)) throw new Error("bar root not found");
	return { input, root };
}

describe("StoresCompactHeader — a takeover on the directory, the header on a booth-QR view", () => {
	it("before the hero scrolls past: hidden, out of the tab order, fixed over the page", async () => {
		renderBar({ visible: false });
		const { input, root } = await bar();
		expect(root.getAttribute("aria-hidden")).toBe("true");
		expect(input.tabIndex).toBe(-1);
		expect(root.className).toContain("fixed");
		expect(root.className).toContain("-translate-y-full");
	});

	it("once the hero has scrolled past: shown and tabbable", async () => {
		renderBar({ visible: true });
		const { input, root } = await bar();
		expect(root.getAttribute("aria-hidden")).toBe("false");
		expect(input.tabIndex).toBe(0);
	});

	it("docked: shown even at the top of the page — clearing a search can never slide it away", async () => {
		// The review: on a booth-QR view the bar was pinned only while refined,
		// so backspacing to empty at scrollY 0 hid the bar under a focused input.
		renderBar({ visible: false, docked: true });
		const { input, root } = await bar();
		expect(root.getAttribute("aria-hidden")).toBe("false");
		expect(input.tabIndex).toBe(0);
		// In the flow, not over it — nothing is left underneath to cover.
		expect(root.className).toContain("sticky");
		expect(root.className).not.toContain("fixed");
		expect(root.className).not.toContain("-translate-y-full");
		const cta = screen.getByRole("link", { name: "Open your store" });
		expect(cta.tabIndex).toBe(0);
	});

	it("the chip row never squeezes into the theme toggle — it is shrink-0 and appears only from xl", async () => {
		// Staging report (2 Nov): between lg and the width four chips + toggle + CTA
		// need, the row shrank but its chips didn't, and they painted over the toggle.
		renderBar({ visible: true });
		await bar();
		const row = screen.getByRole("button", { name: "Open now" }).parentElement;
		expect(row?.className).toContain("shrink-0");
		expect(row?.className).toContain("xl:flex");
		expect(row?.className).not.toContain("lg:flex");
	});

	it("carries no market switch — /stores shows the buyer's own market only", async () => {
		// z8r3fdwduz: the market comes from the edge's geo answer, Shopee-style.
		renderBar({ visible: true });
		await bar();
		expect(screen.queryByRole("group", { name: /region/i })).toBeNull();
		for (const name of ["MY", "SG", "Malaysia", "Singapore"]) {
			expect(screen.queryByRole("button", { name })).toBeNull();
		}
	});
});
