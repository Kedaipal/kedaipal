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
import { SponsoredCard } from "./sponsored-card";
import { StoreCard } from "./store-card";

afterEach(cleanup);

/** Tue 16 Jan 2024 10:00 MYT. */
const NOW = Date.UTC(2024, 0, 16, 2, 0, 0);

function card(overrides: Partial<MarketplaceStoreCard>): MarketplaceStoreCard {
	return {
		slug: "kedai-x",
		storeName: "Kedai X",
		storeDescription: "Frozen pau and dim sum",
		country: "MY",
		offersDelivery: true,
		sponsored: false,
		orderingPaused: false,
		createdAt: NOW - 90 * 24 * 60 * 60 * 1000,
		...overrides,
	};
}

/**
 * Real router, not a mock — the card IS a link to the storefront, and a
 * genuine href is the assertion that buyers (and crawlers) can follow it.
 * Mirrors `storefront/product-card.test.tsx`.
 */
function renderCard(
	c: MarketplaceStoreCard,
	variant: "row" | "grid" | "highlight" = "row",
) {
	const rootRoute = createRootRoute({
		component: () => (
			<>
				{variant === "highlight" ? (
					<SponsoredCard card={c} now={NOW} />
				) : (
					<StoreCard card={c} variant={variant} now={NOW} />
				)}
				<Outlet />
			</>
		),
	});
	const routeTree = rootRoute.addChildren([
		createRoute({
			getParentRoute: () => rootRoute,
			path: "/$slug",
			component: () => null,
		}),
	]);
	const router = createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	// biome-ignore lint/suspicious/noExplicitAny: stub tree, not the app's registered one
	render(<RouterProvider router={router as any} />);
}

describe("StoreCard states", () => {
	it("links to the storefront by slug", async () => {
		renderCard(card({}));
		const link = await screen.findByRole("link");
		expect(link.getAttribute("href")).toBe("/kedai-x");
	});

	it("default: name, blurb, live open status with area", async () => {
		renderCard(card({ storeArea: "Ampang, KL" }));
		expect(await screen.findByText("Kedai X")).toBeTruthy();
		expect(screen.getByText("Frozen pau and dim sum")).toBeTruthy();
		expect(screen.getByText(/Open now/)).toBeTruthy();
		expect(screen.getByText(/Ampang, KL/)).toBeTruthy();
	});

	it("founding member: the emblem names itself with its rank", async () => {
		renderCard(card({ isFoundingMember: true, foundingMemberRank: 3 }));
		// Light + dark artwork both carry the name; CSS shows exactly one.
		expect(await screen.findAllByAltText("Founding Member #3")).toHaveLength(2);
	});

	it("new store: the New chip shows inside the window", async () => {
		renderCard(card({ createdAt: NOW - 24 * 60 * 60 * 1000 }));
		expect(await screen.findByText("New")).toBeTruthy();
	});

	it("off-season hold: browse-only, never Open now", async () => {
		renderCard(card({ orderingPaused: true }));
		expect(await screen.findByText(/On a break — browse only/)).toBeTruthy();
		expect(screen.queryByText(/Open now/)).toBeNull();
	});

	it("grid variant renders the same facts", async () => {
		renderCard(card({}), "grid");
		expect(await screen.findByText("Kedai X")).toBeTruthy();
		expect(screen.getByText(/Open now/)).toBeTruthy();
	});
});

describe("SponsoredCard (Store highlights)", () => {
	it("carries the Sponsored label and names the area ONCE — never beside Visit store", async () => {
		renderCard(
			card({
				sponsored: true,
				storeArea: "Belakang ais box sebelah rumah kau",
			}),
			"highlight",
		);
		expect(await screen.findByText("Sponsored")).toBeTruthy();
		expect(
			screen.getAllByText(/Belakang ais box sebelah rumah kau/),
		).toHaveLength(1);
		expect(screen.getByText("Visit store")).toBeTruthy();
	});
});
