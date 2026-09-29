// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { type CartItem, useCart } from "./useCart";

const RID = "r1" as unknown as Id<"retailers">;

afterEach(() => localStorage.clear());

const customItem: Omit<CartItem, "quantity"> = {
	variantId: "vc" as unknown as Id<"productVariants">,
	productId: "p1" as unknown as Id<"products">,
	name: "Cake",
	optionLabel: "Custom",
	price: 0,
	currency: "MYR",
	isCustom: true,
};

describe("useCart — custom line is locked to qty 1", () => {
	it("re-requesting a custom line updates the note, not the quantity", () => {
		const { result } = renderHook(() => useCart(RID));

		act(() => result.current.addItem({ ...customItem, note: "first spec" }, 1));
		expect(result.current.items).toHaveLength(1);
		expect(result.current.items[0].quantity).toBe(1);

		// A second "Request custom order" must NOT stack to qty 2.
		act(() =>
			result.current.addItem({ ...customItem, note: "second spec" }, 1),
		);
		expect(result.current.items).toHaveLength(1);
		expect(result.current.items[0].quantity).toBe(1);
		expect(result.current.items[0].note).toBe("second spec");
	});

	it("still accumulates quantity for a normal variant", () => {
		const { result } = renderHook(() => useCart(RID));
		const normal: Omit<CartItem, "quantity"> = {
			variantId: "vn" as unknown as Id<"productVariants">,
			productId: "p1" as unknown as Id<"products">,
			name: "Tee",
			price: 1000,
			currency: "MYR",
		};
		act(() => result.current.addItem(normal, 1));
		act(() => result.current.addItem(normal, 2));
		expect(result.current.items[0].quantity).toBe(3);
	});
});

describe("useCart — quickRemoveProduct (card stepper −, z8r3fdegb5)", () => {
	const P1 = "p1" as unknown as Id<"products">;
	const line = (min?: number): Omit<CartItem, "quantity"> => ({
		variantId: "vn" as unknown as Id<"productVariants">,
		productId: P1,
		name: "Tee",
		price: 1000,
		currency: "MYR",
		minQuantity: min,
	});

	it("decrements the product's line by one", () => {
		const { result } = renderHook(() => useCart(RID));
		act(() => result.current.addItem(line(), 3));
		act(() => result.current.quickRemoveProduct(P1));
		expect(result.current.quantityForProduct(P1)).toBe(2);
	});

	it("removes the line when the last unit goes", () => {
		const { result } = renderHook(() => useCart(RID));
		act(() => result.current.addItem(line(), 1));
		act(() => result.current.quickRemoveProduct(P1));
		expect(result.current.items).toHaveLength(0);
	});

	it("drops the whole line below the product's minimum — symmetric with quick-add's min top-up", () => {
		const { result } = renderHook(() => useCart(RID));
		act(() => result.current.addItem(line(4), 4));
		// 4 → "3" would be a shortfall trap the card can't explain; it goes to 0.
		act(() => result.current.quickRemoveProduct(P1));
		expect(result.current.items).toHaveLength(0);
	});

	it("steps normally above the minimum", () => {
		const { result } = renderHook(() => useCart(RID));
		act(() => result.current.addItem(line(4), 6));
		act(() => result.current.quickRemoveProduct(P1));
		expect(result.current.quantityForProduct(P1)).toBe(5);
	});

	it("never touches a custom line", () => {
		const { result } = renderHook(() => useCart(RID));
		act(() => result.current.addItem(customItem, 1));
		act(() => result.current.quickRemoveProduct(customItem.productId));
		expect(result.current.items).toHaveLength(1);
	});
});

describe("useCart — per-product quantity (card stepper + quick-add top-up)", () => {
	const P1 = "p1" as unknown as Id<"products">;
	const P2 = "p2" as unknown as Id<"products">;
	const variant = (
		variantId: string,
		productId: Id<"products">,
		price: number,
	): Omit<CartItem, "quantity"> => ({
		variantId: variantId as unknown as Id<"productVariants">,
		productId,
		name: "Item",
		price,
		currency: "MYR",
	});

	it("returns 0 for a product not in the cart", () => {
		const { result } = renderHook(() => useCart(RID));
		expect(result.current.quantityForProduct(P1)).toBe(0);
	});

	it("sums quantity across a product's variants", () => {
		const { result } = renderHook(() => useCart(RID));
		// Two distinct variants of P1, plus another product.
		act(() => result.current.addItem(variant("v1", P1, 5000), 2));
		act(() => result.current.addItem(variant("v2", P1, 3000), 1));
		act(() => result.current.addItem(variant("v3", P2, 1990), 4)); // other product

		expect(result.current.quantityForProduct(P1)).toBe(3);
		// Other product is isolated.
		expect(result.current.quantityForProduct(P2)).toBe(4);
	});

	it("excludes custom / made-to-order lines from the count", () => {
		const { result } = renderHook(() => useCart(RID));
		act(() => result.current.addItem(variant("v1", P1, 5000), 2)); // priced
		act(() => result.current.addItem({ ...customItem, productId: P1 }, 1)); // custom, price 0

		// The custom line is a separate quoted negotiation, locked to qty 1 —
		// it must not put the standard line's stepper at the wrong number.
		expect(result.current.quantityForProduct(P1)).toBe(2);
	});

	it("reflects quantity changes and removals", () => {
		const { result } = renderHook(() => useCart(RID));
		act(() => result.current.addItem(variant("v1", P1, 5000), 2));

		act(() =>
			result.current.updateQuantity(
				"v1" as unknown as Id<"productVariants">,
				5,
			),
		);
		expect(result.current.quantityForProduct(P1)).toBe(5);

		act(() =>
			result.current.removeItem("v1" as unknown as Id<"productVariants">),
		);
		expect(result.current.quantityForProduct(P1)).toBe(0);
	});
});

describe("useCart — hydration signal (checkout's empty-vs-unknown guard)", () => {
	const P1 = "p1" as unknown as Id<"products">;
	const stored = [
		{
			variantId: "v1",
			productId: P1,
			name: "Kek Batik",
			price: 4500,
			currency: "MYR",
			quantity: 2,
		},
	];

	it("is false while the retailer is still unknown", () => {
		const { result } = renderHook(() => useCart(undefined));
		// The route hasn't resolved the store yet, so hydration hasn't even been
		// ATTEMPTED — an empty `items` here means "unknown", not "empty cart".
		// Checkout must hold its skeleton instead of offering "Browse the store".
		expect(result.current.hydrated).toBe(false);
		expect(result.current.items).toEqual([]);
	});

	it("flips true once this retailer's stored cart is applied", () => {
		localStorage.setItem(`kedaipal:cart:${RID}`, JSON.stringify(stored));
		const { result } = renderHook(() => useCart(RID));
		expect(result.current.hydrated).toBe(true);
		expect(result.current.items).toHaveLength(1);
		expect(result.current.itemCount).toBe(2);
	});

	it("is true for a genuinely empty cart (so checkout can still say so)", () => {
		const { result } = renderHook(() => useCart(RID));
		expect(result.current.hydrated).toBe(true);
		expect(result.current.items).toEqual([]);
	});

	it("re-arms when the retailer changes — a cart is per store", () => {
		localStorage.setItem(`kedaipal:cart:${RID}`, JSON.stringify(stored));
		const { result, rerender } = renderHook(
			({ id }: { id: Id<"retailers"> | undefined }) => useCart(id),
			{ initialProps: { id: undefined as Id<"retailers"> | undefined } },
		);
		expect(result.current.hydrated).toBe(false);

		rerender({ id: RID });
		expect(result.current.hydrated).toBe(true);
		expect(result.current.itemCount).toBe(2);
	});
});

describe("useCart — an RSVP can never be a cart line (z8r3fdhh45)", () => {
	// An event carries its own fixed fulfilment moment, so it is checked out
	// standalone (`?rsvp=`). Carts persisted BEFORE that change can still hold
	// an RSVP line; hydrating one would strand the buyer with a basket
	// `orders.create` refuses and no way to see why — so it is dropped here.
	const KEY = `kedaipal:cart:${RID}`;
	const normal = {
		variantId: "vn",
		productId: "p1",
		name: "Ceramic mug",
		price: 1990,
		currency: "MYR",
		quantity: 1,
	};
	const rsvp = {
		variantId: "ve",
		productId: "pe",
		name: "Baking class",
		price: 500,
		currency: "MYR",
		quantity: 1,
		event: { date: Date.UTC(2099, 10, 7) },
	};

	it("drops a persisted RSVP line and keeps the rest of the basket", () => {
		localStorage.setItem(KEY, JSON.stringify([normal, rsvp]));
		const { result } = renderHook(() => useCart(RID));
		expect(result.current.items).toHaveLength(1);
		expect(result.current.items[0].name).toBe("Ceramic mug");
		expect(result.current.itemCount).toBe(1);
	});

	it("leaves an RSVP-only cart empty rather than unusable", () => {
		localStorage.setItem(KEY, JSON.stringify([rsvp]));
		const { result } = renderHook(() => useCart(RID));
		expect(result.current.items).toHaveLength(0);
		// Hydration still COMPLETED — the checkout must render its real empty
		// state, not hold a skeleton forever.
		expect(result.current.hydrated).toBe(true);
	});

	it("persists the healed cart, so the RSVP line cannot come back", async () => {
		localStorage.setItem(KEY, JSON.stringify([normal, rsvp]));
		const { result } = renderHook(() => useCart(RID));
		// A write of any kind flushes the hydrated (healed) state back to storage.
		act(() =>
			result.current.updateQuantity(
				"vn" as unknown as Id<"productVariants">,
				2,
			),
		);
		const stored = JSON.parse(localStorage.getItem(KEY) ?? "[]");
		expect(stored).toHaveLength(1);
		expect(stored[0]).not.toHaveProperty("event");
	});
});
