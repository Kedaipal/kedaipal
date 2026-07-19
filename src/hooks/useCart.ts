import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * Cart state for the public storefront. Persisted to localStorage and keyed
 * per `retailerId` so a shopper browsing two stores in the same browser
 * doesn't see items bleed across them.
 *
 * Prices are stored in minor units (see `src/lib/format.ts`).
 */

export type CartItem = {
	// The sellable variant — the cart's dedupe identity. Two variants of the
	// same product ("1kg / Fillet" vs "500g / Whole") are distinct lines.
	variantId: Id<"productVariants">;
	productId: Id<"products">;
	name: string;
	// Human label of the chosen option values ("1kg / Fillet"); absent for
	// single-variant products. Rendered next to the product name.
	optionLabel?: string;
	price: number; // minor units
	currency: string;
	quantity: number;
	imageUrl?: string;
	// True for a made-to-order variant sold at RM0 — the price is quoted by the
	// seller after the order (on the mockup). Rendered as "Price on quote".
	quoteOnRequest?: boolean;
	// Product-level minimum order quantity, snapshotted at add time (like price/
	// name) so the checkout can judge shortfalls without a live product join.
	// The server re-checks against the live value at create. Summed across the
	// product's lines; custom lines never count. See convex/lib/minOrderRules.ts.
	minQuantity?: number;
	// Buyer's request for a custom / made-to-order line ("unicorn theme, size 8").
	// Captured at add-time; composed (labelled) into the order's customerNote at
	// checkout so the seller sees it in WhatsApp + the dashboard. See docs/custom-option.md.
	note?: string;
	// The custom / made-to-order line. Locked to qty 1 — it's one bespoke
	// negotiation (the seller's single mockup + quote settle scope, quantity, and
	// final price). Re-requesting updates the note instead of incrementing qty.
	isCustom?: boolean;
	// Optional buyer reference image for a custom line. Uploaded on attach (Convex
	// storage id; serializable so it survives cart persistence) and passed to
	// orders.create at checkout. See docs/custom-option.md.
	customImageStorageId?: string;
};

type CartState = {
	items: CartItem[];
	// The retailerId whose persisted cart has been APPLIED to `items`. The
	// persist effect only writes once this matches — otherwise a fresh mount's
	// initial empty state races the async HYDRATE dispatch and wipes the stored
	// cart (surfaced by SPA navigation between the store home and a category
	// page, where the remount happens with the retailer already cached).
	hydratedFor: string | null;
};

type CartAction =
	| { type: "ADD"; item: Omit<CartItem, "quantity">; quantity: number }
	| { type: "SET_QTY"; variantId: Id<"productVariants">; quantity: number }
	| { type: "REMOVE"; variantId: Id<"productVariants"> }
	| { type: "CLEAR" }
	| { type: "HYDRATE"; items: CartItem[]; retailerId: string };

const EMPTY_STATE: CartState = { items: [], hydratedFor: null };

function reducer(state: CartState, action: CartAction): CartState {
	switch (action.type) {
		case "HYDRATE":
			return { items: action.items, hydratedFor: action.retailerId };
		case "ADD": {
			const existing = state.items.find(
				(i) => i.variantId === action.item.variantId,
			);
			if (existing) {
				return {
					...state,
					items: state.items.map((i) =>
						i.variantId === action.item.variantId
							? {
									...i,
									// A custom line stays qty 1 (one bespoke negotiation);
									// any other variant accumulates as usual.
									quantity: i.isCustom
										? i.quantity
										: i.quantity + action.quantity,
									// Re-requesting a custom line updates its note + image (latest
									// wins); keep the prior values if this add carried none.
									note: action.item.note ?? i.note,
									customImageStorageId:
										action.item.customImageStorageId ?? i.customImageStorageId,
								}
							: i,
					),
				};
			}
			return {
				...state,
				items: [...state.items, { ...action.item, quantity: action.quantity }],
			};
		}
		case "SET_QTY": {
			if (action.quantity <= 0) {
				return {
					...state,
					items: state.items.filter((i) => i.variantId !== action.variantId),
				};
			}
			return {
				...state,
				items: state.items.map((i) =>
					i.variantId === action.variantId
						? { ...i, quantity: action.quantity }
						: i,
				),
			};
		}
		case "REMOVE":
			return {
				...state,
				items: state.items.filter((i) => i.variantId !== action.variantId),
			};
		case "CLEAR":
			// Keep `hydratedFor` — a deliberate clear must still persist (it IS a
			// cart write), unlike the pre-hydration empty state.
			return { ...state, items: [] };
	}
}

function storageKey(retailerId: string): string {
	return `kedaipal:cart:${retailerId}`;
}

function readPersisted(retailerId: string): CartItem[] {
	if (typeof window === "undefined") return [];
	try {
		const raw = window.localStorage.getItem(storageKey(retailerId));
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(i): i is CartItem =>
				typeof i === "object" &&
				i !== null &&
				typeof i.variantId === "string" &&
				typeof i.productId === "string" &&
				typeof i.name === "string" &&
				typeof i.price === "number" &&
				typeof i.currency === "string" &&
				typeof i.quantity === "number" &&
				i.quantity > 0,
		);
	} catch {
		return [];
	}
}

export function useCart(retailerId: Id<"retailers"> | undefined) {
	const [state, dispatch] = useReducer(reducer, EMPTY_STATE);

	// Hydrate from localStorage when retailerId becomes available or changes.
	useEffect(() => {
		if (!retailerId) return;
		dispatch({ type: "HYDRATE", items: readPersisted(retailerId), retailerId });
	}, [retailerId]);

	// Persist on change — but never before this retailer's hydration has been
	// APPLIED to state, or a fresh mount's empty initial state would overwrite
	// the stored cart (see CartState.hydratedFor).
	useEffect(() => {
		if (!retailerId || state.hydratedFor !== retailerId) return;
		if (typeof window === "undefined") return;
		try {
			window.localStorage.setItem(
				storageKey(retailerId),
				JSON.stringify(state.items),
			);
		} catch {
			// Quota exceeded or storage disabled — ignore silently for MVP.
		}
	}, [retailerId, state.items, state.hydratedFor]);

	const addItem = useCallback(
		(item: Omit<CartItem, "quantity">, quantity = 1) =>
			dispatch({ type: "ADD", item, quantity }),
		[],
	);
	const updateQuantity = useCallback(
		(variantId: Id<"productVariants">, quantity: number) =>
			dispatch({ type: "SET_QTY", variantId, quantity }),
		[],
	);
	const removeItem = useCallback(
		(variantId: Id<"productVariants">) =>
			dispatch({ type: "REMOVE", variantId }),
		[],
	);
	const clearCart = useCallback(() => dispatch({ type: "CLEAR" }), []);

	// Units of a product already in the cart, summed across its variant lines
	// (custom lines excluded — they never count toward a minimum). Drives the
	// min-quantity-aware stepper default + quick-add top-up.
	const quantityForProduct = useCallback(
		(productId: Id<"products">) =>
			state.items.reduce(
				(sum, i) =>
					i.productId === productId && !i.isCustom ? sum + i.quantity : sum,
				0,
			),
		[state.items],
	);

	const { itemCount, total, currency } = useMemo(() => {
		let count = 0;
		let sum = 0;
		for (const i of state.items) {
			count += i.quantity;
			sum += i.price * i.quantity;
		}
		return {
			itemCount: count,
			total: sum,
			currency: state.items[0]?.currency ?? "MYR",
		};
	}, [state.items]);

	return {
		items: state.items,
		itemCount,
		total,
		currency,
		addItem,
		updateQuantity,
		removeItem,
		clearCart,
		quantityForProduct,
	};
}

export type UseCart = ReturnType<typeof useCart>;
