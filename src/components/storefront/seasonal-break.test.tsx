// @vitest-environment jsdom
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UseCart } from "../../hooks/useCart";
import { CartBar } from "./cart-bar";
import { ProductCard, type StorefrontProduct } from "./product-card";
import { OrderingPausedProvider, SeasonalBreakNotice } from "./seasonal-break";

afterEach(cleanup);

const cart = {
	itemCount: 2,
	total: 5000,
	currency: "MYR",
} as unknown as UseCart;

const product = {
	_id: "p1",
	name: "Ceramic mug",
	slug: "ceramic-mug",
	currency: "MYR",
	imageUrls: [],
	options: [],
	priceFrom: 5000,
	priceTo: 5000,
	hasQuotePricing: false,
	inStock: true,
	totalOnHand: 60,
	variants: [
		{
			_id: "v1",
			optionValues: [],
			onHand: 60,
			active: true,
			blockWhenOutOfStock: false,
			requiresProof: false,
			price: 5000,
			imageUrls: [],
		},
	],
} as unknown as StorefrontProduct;

/** Real router (the card + bar navigate), the way product-card.test.tsx does. */
function renderInRouter(paused: boolean, ui: React.ReactNode) {
	const rootRoute = createRootRoute({
		component: () => (
			<OrderingPausedProvider paused={paused}>
				{ui}
				<Outlet />
			</OrderingPausedProvider>
		),
	});
	const routeTree = rootRoute.addChildren([
		createRoute({
			getParentRoute: () => rootRoute,
			path: "/$slug/p/$productSlug",
			component: () => null,
		}),
		createRoute({
			getParentRoute: () => rootRoute,
			path: "/$slug/checkout",
			component: () => null,
		}),
		createRoute({
			getParentRoute: () => rootRoute,
			path: "/$slug",
			component: () => null,
		}),
	]);
	const router = createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: ["/dapur-nadia"] }),
	});
	// biome-ignore lint/suspicious/noExplicitAny: stub tree, not the app's registered one
	render(<RouterProvider router={router as any} />);
}

describe("Off-Season Hold on the storefront (z8r3fday24)", () => {
	it("the notice renders only while paused, and reads as a break — not a closed store", () => {
		const { unmount } = render(
			<OrderingPausedProvider paused={false}>
				<SeasonalBreakNotice storeName="Dapur Nadia" />
			</OrderingPausedProvider>,
		);
		expect(screen.queryByText("On a seasonal break")).toBeNull();
		unmount();

		render(
			<OrderingPausedProvider paused>
				<SeasonalBreakNotice storeName="Dapur Nadia" />
			</OrderingPausedProvider>,
		);
		expect(screen.getByText("On a seasonal break")).toBeTruthy();
		expect(screen.getByText(/Dapur Nadia is on a seasonal break/)).toBeTruthy();
		expect(screen.getByText(/check back when they reopen/)).toBeTruthy();
	});

	it("the cart bar keeps the basket but disables checkout with the reason", async () => {
		renderInRouter(true, <CartBar cart={cart} storeSlug="dapur-nadia" />);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Ordering paused" }),
			).toBeTruthy(),
		);
		expect(
			(
				screen.getByRole("button", {
					name: "Ordering paused",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		expect(screen.getByText("Not taking orders right now")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Checkout" })).toBeNull();
	});

	it("open store: the cart bar is untouched", async () => {
		renderInRouter(false, <CartBar cart={cart} storeSlug="dapur-nadia" />);
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Checkout" })).toBeTruthy(),
		);
		expect(screen.queryByText("Not taking orders right now")).toBeNull();
	});

	it("the product card's quick-add is disabled-with-reason while paused", async () => {
		renderInRouter(
			true,
			<ProductCard
				product={product}
				storeSlug="dapur-nadia"
				onQuickAdd={vi.fn()}
				cartQuantity={0}
				cartSubtotal={0}
			/>,
		);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Ordering paused" }),
			).toBeTruthy(),
		);
		expect(
			(
				screen.getByRole("button", {
					name: "Ordering paused",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
	});
});
