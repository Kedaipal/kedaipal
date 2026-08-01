// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import type { UseCart } from "../../hooks/useCart";
import { FeaturedProduct } from "./featured-product";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		params,
		children,
		...rest
	}: {
		to: string;
		params?: Record<string, string>;
		children: ReactNode;
	} & ComponentProps<"a">) => (
		<a
			href={Object.entries(params ?? {}).reduce(
				(path, [key, value]) => path.replace(`$${key}`, value),
				to,
			)}
			{...rest}
		>
			{children}
		</a>
	),
}));

// The component runs two subscriptions — products.list and popularProducts.
// The api refs are opaque under the mock, so route on the args shape: only
// popularProducts carries `since`.
let productsResult: unknown;
let popularResult: unknown;
vi.mock("convex/react", () => ({
	useQuery: (_fn: unknown, args: Record<string, unknown>) =>
		args && "since" in args ? popularResult : productsResult,
}));
vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

afterEach(cleanup);

const RID = "r1" as unknown as Id<"retailers">;

const makeProduct = (
	id: string,
	over: Record<string, unknown> = {},
): Record<string, unknown> => ({
	_id: id,
	name: `Product ${id}`,
	slug: id,
	currency: "MYR",
	description: "Rich, dense, tea-time classic",
	imageUrls: [],
	options: [],
	priceFrom: 4500,
	priceTo: 4500,
	hasQuotePricing: false,
	inStock: true,
	totalOnHand: 10,
	variants: [
		{
			_id: `v-${id}`,
			optionValues: [],
			price: 4500,
			onHand: 10,
			active: true,
			blockWhenOutOfStock: true,
			requiresProof: false,
			imageUrls: [],
		},
	],
	...over,
});

function makeCart(): UseCart {
	return {
		items: [],
		addItem: vi.fn(),
		quantityForProduct: () => 0,
		subtotalForProduct: () => 0,
	} as unknown as UseCart;
}

function mount(cart = makeCart()) {
	return render(
		<FeaturedProduct retailerId={RID} storeSlug="herb" cart={cart} />,
	);
}

describe("FeaturedProduct", () => {
	it("renders nothing while loading or when no product qualifies", () => {
		productsResult = undefined;
		popularResult = undefined;
		expect(mount().container.innerHTML).toBe("");
		cleanup();

		productsResult = [makeProduct("cake")];
		popularResult = [];
		expect(mount().container.innerHTML).toBe("");
	});

	it("features the top candidate with its blurb, price and a working link", () => {
		productsResult = [makeProduct("cake"), makeProduct("pie")];
		popularResult = ["cake"];
		mount();
		expect(screen.getByText("Popular this week")).toBeTruthy();
		expect(screen.getByText("Bestseller")).toBeTruthy();
		expect(screen.getByText("Rich, dense, tea-time classic")).toBeTruthy();
		// Image and title are separate links to the same page.
		const links = screen.getAllByRole("link", { name: "Product cake" });
		expect(links).toHaveLength(2);
		for (const link of links) {
			expect(link.getAttribute("href")).toBe("/herb/p/cake");
		}
		// Hands over to the grid below.
		expect(screen.getByText("All products")).toBeTruthy();
	});

	it("skips candidates that are unlisted or sold out, never featuring the unbuyable", () => {
		productsResult = [
			// Top candidate sold out; runner-up is fine. ("hidden-one" isn't in
			// the public list at all — a hidden/archived top seller.)
			makeProduct("soldout", { inStock: false }),
			makeProduct("pie"),
		];
		popularResult = ["hidden-one", "soldout", "pie"];
		mount();
		expect(screen.getByText("Product pie")).toBeTruthy();
		expect(screen.queryByText("Product soldout")).toBeNull();
	});

	it("quick-adds a single-variant product straight into the cart", () => {
		productsResult = [makeProduct("cake")];
		popularResult = ["cake"];
		const cart = makeCart();
		mount(cart);
		fireEvent.click(screen.getByRole("button", { name: /add/i }));
		expect(cart.addItem).toHaveBeenCalledWith(
			expect.objectContaining({ productId: "cake", price: 4500 }),
			1,
		);
	});

	it("degrades to nothing if the query throws — merchandising never blanks the store", () => {
		// A deploy window can briefly leave client and server disagreeing about
		// popularProducts; the row must swallow that, not hit the route boundary.
		productsResult = [makeProduct("cake")];
		popularResult = new Proxy([], {
			get() {
				throw new Error("Could not find public function");
			},
		});
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(mount().container.innerHTML).toBe("");
		} finally {
			spy.mockRestore();
		}
	});

	it("sends multi-variant products to the page to choose options", () => {
		productsResult = [
			makeProduct("cake", {
				options: [{ name: "Size", values: ["S", "M"] }],
				variants: [
					{
						_id: "v-s",
						optionValues: ["S"],
						price: 4500,
						onHand: 10,
						active: true,
						blockWhenOutOfStock: true,
						requiresProof: false,
						imageUrls: [],
					},
					{
						_id: "v-m",
						optionValues: ["M"],
						price: 5500,
						onHand: 10,
						active: true,
						blockWhenOutOfStock: true,
						requiresProof: false,
						imageUrls: [],
					},
				],
			}),
		];
		popularResult = ["cake"];
		mount();
		expect(screen.queryByRole("button", { name: /add/i })).toBeNull();
		expect(
			screen.getByRole("link", { name: /choose/i }).getAttribute("href"),
		).toBe("/herb/p/cake");
	});
});
