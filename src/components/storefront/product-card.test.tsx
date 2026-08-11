// @vitest-environment jsdom
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductCard, type StorefrontProduct } from "./product-card";

afterEach(cleanup);

// Minimal in-stock, single-variant product → renders the quick-add "Add" button.
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

/**
 * Real router, not a mock — the card's product links ARE the thing under test
 * (see docs/storefront-product-pages.md: an `<a href>` is what a crawler can
 * follow and what gives buyers ⌘-click / copy-link-address), so the assertions
 * need genuine hrefs. Mirrors `dashboard/bottom-nav.test.tsx`.
 */
function renderCard(
	overrides: Partial<React.ComponentProps<typeof ProductCard>> = {},
) {
	const rootRoute = createRootRoute({
		component: () => (
			<>
				<ProductCard
					product={product}
					storeSlug="kfrozenfood"
					onQuickAdd={vi.fn()}
					cartQuantity={0}
					cartSubtotal={0}
					{...overrides}
				/>
				<Outlet />
			</>
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
			path: "/$slug",
			component: () => null,
		}),
	]);
	const router = createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: ["/kfrozenfood"] }),
	});
	// biome-ignore lint/suspicious/noExplicitAny: stub tree, not the app's registered one
	render(<RouterProvider router={router as any} />);
	return router;
}

/**
 * The card's ONE announced door. Role-based on purpose: the photo link is
 * `aria-hidden`, so this can't accidentally match it — and with no photo the
 * placeholder repeats the product name, which would make getByText ambiguous.
 */
const nameLink = () => screen.getByRole("link", { name: "Ceramic mug" });

describe("ProductCard — in-cart line", () => {
	it("shows nothing when the product is not in the cart", async () => {
		renderCard();
		await waitFor(() => expect(nameLink()).toBeTruthy());
		expect(screen.queryByText(/in cart/i)).toBeNull();
	});

	it("shows count and running total once in the cart", async () => {
		renderCard({ cartQuantity: 3, cartSubtotal: 15000 });
		// Regex tolerates the NBSP Intl inserts between "RM" and the amount.
		await waitFor(() =>
			expect(screen.getByText(/^3 in cart · RM\s*150\.00$/)).toBeTruthy(),
		);
	});

	it("shows the count alone when everything in cart is quote-priced (subtotal 0)", async () => {
		renderCard({ cartQuantity: 1, cartSubtotal: 0 });
		await waitFor(() => expect(screen.getByText("1 in cart")).toBeTruthy());
		// No stray "· RM" money fragment when there's no total to show.
		expect(screen.queryByText(/·/)).toBeNull();
	});
});

describe("ProductCard — price label (86eyhn4mr)", () => {
	/** The bespoke line a made-to-order seller offers, priced from RM 40. */
	const customLine = {
		_id: "vc",
		optionValues: [],
		onHand: 0,
		active: true,
		blockWhenOutOfStock: false,
		requiresProof: true,
		price: 4000,
		imageUrls: [],
		isCustom: true,
	};

	it("prints a plain price when every variant is a fixed price", async () => {
		renderCard();
		await waitFor(() => expect(nameLink()).toBeTruthy());
		expect(screen.queryByText(/from/i)).toBeNull();
	});

	it("prefixes From when the only line is a custom one with a starting price", async () => {
		renderCard({
			product: {
				...product,
				priceFrom: 4000,
				priceTo: 4000,
				variants: [customLine],
			} as unknown as StorefrontProduct,
		});
		// A single price that the mockup quote lands on top of — the whole point
		// of the ticket: without "From" the buyer reads RM 40 as the bill.
		await waitFor(() => expect(screen.getByText("From")).toBeTruthy());
		expect(screen.getByText(/RM\s*40\.00/)).toBeTruthy();
	});

	it("prefixes From when a custom line sits beside identically-priced stock", async () => {
		// priceFrom === priceTo, so the range alone wouldn't have flagged it.
		renderCard({
			product: {
				...product,
				variants: [product.variants[0], { ...customLine, price: 5000 }],
			} as unknown as StorefrontProduct,
		});
		await waitFor(() => expect(screen.getByText("From")).toBeTruthy());
	});
});

describe("ProductCard — product page links", () => {
	const HREF = "/kfrozenfood/p/ceramic-mug";

	it("makes the name a real anchor to the product page, not a click handler", async () => {
		renderCard();
		const name = await waitFor(nameLink);
		// A crawler (and ⌘-click, and "copy link address") needs an <a href> —
		// a <button onClick={navigate}> is invisible to all three.
		expect(name.tagName).toBe("A");
		expect(name.getAttribute("href")).toBe(HREF);
	});

	it("links the photo to the same page but hides it from the a11y tree", async () => {
		renderCard();
		await waitFor(() => expect(nameLink()).toBeTruthy());
		const anchors = Array.from(
			document.querySelectorAll<HTMLAnchorElement>("a[href]"),
		);
		expect(anchors.every((a) => a.getAttribute("href") === HREF)).toBe(true);
		// The photo link is decorative — the name link is the card's one
		// announced door, so screen readers don't hear the destination twice.
		const decorative = anchors.filter(
			(a) => a.getAttribute("aria-hidden") === "true",
		);
		expect(decorative).toHaveLength(1);
		expect(decorative[0]?.tabIndex).toBe(-1);
	});

	it("gives a multi-variant product's Choose CTA the same href", async () => {
		renderCard({
			product: {
				...product,
				options: [{ name: "Size", values: ["S", "M"] }],
			} as unknown as StorefrontProduct,
		});
		const choose = await waitFor(() =>
			screen.getByRole("link", { name: /choose/i }),
		);
		expect(choose.getAttribute("href")).toBe(HREF);
	});

	it("renders Choose as a disabled button (not a link) when the product can't be ordered", async () => {
		renderCard({
			product: {
				...product,
				options: [{ name: "Size", values: ["S", "M"] }],
				inStock: false,
			} as unknown as StorefrontProduct,
		});
		await waitFor(() => expect(screen.getByText("Out of stock")).toBeTruthy());
		// Disabled-with-reason beats a link that leads to an unorderable page —
		// and an <a> can't be disabled.
		const choose = screen.getByRole("button", { name: /choose/i });
		expect(choose.hasAttribute("disabled")).toBe(true);
		expect(screen.queryByRole("link", { name: /choose/i })).toBeNull();
	});

	it("navigates to the product page when the name is clicked", async () => {
		const router = renderCard();
		const name = await waitFor(nameLink);
		// Left-click a real Link → client-side router navigation.
		fireEvent.click(name);
		await waitFor(() => expect(router.state.location.pathname).toBe(HREF));
	});
});
