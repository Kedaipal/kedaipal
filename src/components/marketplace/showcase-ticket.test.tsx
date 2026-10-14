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
import type { MarketplaceStoreCard } from "../../../convex/marketplace";
import type { PublicShowcase } from "../../../convex/showcases";
import type { ShowcaseTicketData } from "../../lib/showcase";
import { ShowcaseStage } from "./showcase-stage";
import { ShowcaseTicket } from "./showcase-ticket";

afterEach(cleanup);

/** Sat 17 Oct 2026 12:00 MYT. */
const NOW = Date.UTC(2026, 9, 17, 4, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function card(slug: string, extra: Partial<MarketplaceStoreCard> = {}) {
	return {
		slug,
		storeName: `Store ${slug}`,
		country: "MY",
		offersDelivery: true,
		sponsored: false,
		orderingPaused: false,
		createdAt: NOW - 90 * DAY,
		...extra,
	} satisfies MarketplaceStoreCard;
}

const showcase: PublicShowcase = {
	slug: "campfest-2026",
	title: "Malaysia Campfest 2026",
	tagline: "Order ahead, pick up at the booth.",
	country: "MY",
	theme: "campfire",
	endsAt: NOW + 2 * DAY,
	members: [],
};

/** Real router: the ticket IS a link to the storefront, and the stage's
 * "See all" is a link to the focused view — genuine hrefs are the assertion. */
function renderInRouter(element: React.ReactNode) {
	const rootRoute = createRootRoute({ component: () => <Outlet /> });
	const index = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <>{element}</>,
	});
	const store = createRoute({
		getParentRoute: () => rootRoute,
		path: "/$slug",
		component: () => null,
	});
	const stores = createRoute({
		getParentRoute: () => rootRoute,
		path: "/stores",
		component: () => null,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([index, store, stores]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	// biome-ignore lint/suspicious/noExplicitAny: stub tree, not the app's registered one
	render(<RouterProvider router={router as any} />);
}

describe("ShowcaseTicket", () => {
	it("is a link to the store, names the booth on the stub, and the status line", async () => {
		renderInRouter(
			<ShowcaseTicket
				ticket={{ card: card("rimba-gear"), label: "Booth B4" }}
				now={NOW}
			/>,
		);
		const link = await screen.findByRole("link", { name: /Store rimba-gear/ });
		expect(link.getAttribute("href")).toBe("/rimba-gear");
		expect(screen.getByText("Booth")).toBeTruthy();
		expect(screen.getByText("B4")).toBeTruthy();
		expect(screen.getByText("Open now")).toBeTruthy();
	});

	it("no booth label → the tent stub, and the area stands in under the name", async () => {
		renderInRouter(
			<ShowcaseTicket
				ticket={{ card: card("kopi", { storeArea: "Puchong" }) }}
				now={NOW}
			/>,
		);
		await screen.findByRole("link");
		expect(screen.getByText("At event")).toBeTruthy();
		expect(screen.getByText("Puchong")).toBeTruthy();
	});

	it("a cover renders as the panel image; without one the initials watermark shows", async () => {
		renderInRouter(
			<>
				<ShowcaseTicket
					ticket={{ card: card("a"), coverImageUrl: "https://img/a.jpg" }}
					now={NOW}
				/>
				<ShowcaseTicket ticket={{ card: card("b") }} now={NOW} />
			</>,
		);
		await screen.findAllByRole("link");
		expect(document.querySelector('img[src*="a.jpg"]')).toBeTruthy();
		// "SB" = Store b's initials, watermarked large (aria-hidden, so by text).
		expect(screen.getAllByText("SB").length).toBeGreaterThan(0);
	});

	it("the notches are a real die-cut, never painted circles", async () => {
		renderInRouter(
			<ShowcaseTicket ticket={{ card: card("a"), label: "B4" }} now={NOW} />,
		);
		await screen.findByText("Store a");
		// The holes come from the `kp-ticket-cut` mask, so a cover photo or a
		// gradient behind the ticket shows THROUGH them. The first build painted
		// round spans in the theme colour, which only passed for holes on that
		// one flat colour — none may come back.
		expect(document.querySelector(".kp-ticket-cut")).toBeTruthy();
		expect(document.querySelector("a .rounded-full.size-4")).toBeNull();
	});

	it("inert tickets (under the pile) are out of the tab order and hidden from readers", async () => {
		renderInRouter(
			<ShowcaseTicket ticket={{ card: card("a") }} now={NOW} inert />,
		);
		await screen.findByText("Store a");
		const link = document.querySelector("a");
		expect(link?.getAttribute("tabindex")).toBe("-1");
		expect(link?.getAttribute("aria-hidden")).toBe("true");
	});
});

describe("ShowcaseStage", () => {
	const tickets = (n: number): ShowcaseTicketData[] =>
		Array.from({ length: n }, (_, i) => ({ card: card(`s${i}`) }));

	it("stage: title, the time chip, and 'See all N' to the focused view", async () => {
		renderInRouter(
			<ShowcaseStage
				showcase={showcase}
				tickets={tickets(3)}
				now={NOW}
				mode="stage"
				railClassName="flex"
			/>,
		);
		expect(
			await screen.findByRole("heading", { name: "Malaysia Campfest 2026" }),
		).toBeTruthy();
		expect(screen.getAllByText("Until Mon").length).toBeGreaterThan(0);
		const seeAll = screen.getAllByRole("link", { name: /See all 3/ });
		expect(seeAll[0].getAttribute("href")).toBe(
			"/stores?showcase=campfest-2026",
		);
	});

	it("no stores (the admin preview only): a hint, never 'See all 0'", async () => {
		renderInRouter(
			<ShowcaseStage
				showcase={showcase}
				tickets={[]}
				now={NOW}
				mode="stage"
				railClassName="flex"
			/>,
		);
		expect(
			await screen.findByText("Stores you add appear here as tickets."),
		).toBeTruthy();
		expect(screen.queryByText(/See all/)).toBeNull();
	});

	it("seven stores: five stand on the desktop grid and the pile badge counts the rest", async () => {
		renderInRouter(
			<ShowcaseStage
				showcase={showcase}
				tickets={tickets(7)}
				now={NOW}
				mode="stage"
				railClassName="flex"
			/>,
		);
		await screen.findByRole("heading", { name: "Malaysia Campfest 2026" });
		expect(screen.getByText(/\+2 more · See all 7/)).toBeTruthy();
		// Every ticket in the pile is still a real link to its store.
		expect(document.querySelectorAll('a[href="/s6"]').length).toBeGreaterThan(
			0,
		);
	});

	it("focused: a way back, and every ticket laid out with no pile", async () => {
		let left = false;
		renderInRouter(
			<ShowcaseStage
				showcase={showcase}
				tickets={tickets(7)}
				now={NOW}
				mode="focused"
				railClassName="flex"
				onBack={() => {
					left = true;
				}}
			/>,
		);
		const back = await screen.findByRole("button", { name: /All stores/ });
		back.click();
		expect(left).toBe(true);
		expect(screen.queryByText(/more · See all/)).toBeNull();
		expect(document.querySelectorAll('a[href="/s6"]').length).toBe(1);
	});
});
