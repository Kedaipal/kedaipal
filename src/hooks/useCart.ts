import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { DEFAULT_CURRENCY } from "../../convex/lib/currency";

/**
 * Cart state for the public storefront. Persisted to localStorage and keyed
 * per `retailerId` so a shopper browsing two stores in the same browser
 * doesn't see items bleed across them.
 *
 * Prices are stored in minor units (see `src/lib/format.ts`).
 *
 * **INVARIANT — the cart holds only buyer-scheduled lines** (`z8r3fdhh45`).
 * An order carries exactly ONE fulfilment contract: one method, one date, one
 * place. So a product that carries its own FIXED fulfilment moment can never
 * be a cart line — it is checked out standalone, on its own route:
 *
 * - a **booking** (`?booking=`) — its own date range, capacity and approval;
 * - an **event RSVP** (`?rsvp=`) — the seller's date, the seller's venue.
 *
 * Everything else (physical goods, food, services, made-to-order) has a date
 * the BUYER picks, so those lines share a cart freely. This is enforced
 * structurally — neither flow has an add-to-cart to reach — and backstopped in
 * `orders.create` for stale tabs. It is deliberately NOT a rule about product
 * KIND: a service's fulfilment is identical to a physical good's, so services
 * belong in the cart.
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
	// Per-product fulfilment-notice override, frozen at add time — checkout
	// raises the earliest pickable date to the strictest item in the cart.
	// Absent on legacy persisted carts → treated as 0 (no override).
	minNoticeDays?: number;
	// Per-product prep window in MINUTES, frozen at add time — checkout raises
	// the earliest pickable TIME to the slowest item in the cart, the way
	// minNoticeDays raises the earliest DATE. Absent on legacy persisted carts
	// → treated as 0 (no window). The server re-derives both from the live
	// products at create and is the judge; these exist so the buyer is stopped
	// at the picker rather than at the error.
	prepMinutes?: number;
	// The product's pickup note as it read when added — lets checkout show the
	// "Before you collect" block without a product join. NOT the copy that
	// reaches the order: orders.create freezes the LIVE product's note, so a
	// seller's edit between add and checkout still lands.
	pickupNote?: string;
	// Optional buyer reference image for a custom line. Uploaded on attach (Convex
	// storage id; serializable so it survives cart persistence) and passed to
	// orders.create at checkout. See docs/custom-option.md.
	customImageStorageId?: string;
	// Answers to the product's buyer questions (z8r3fdkjek), keyed by question
	// id — entered at CHECKOUT (one set per line), persisted so a refresh on
	// the checkout page doesn't wipe them. Not validated against the product
	// here (hydrate has no catalogue): checkout sends only ids the LIVE
	// product still asks, and the server drops anything else.
	answers?: Record<string, string>;
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
	| {
			type: "SET_ANSWER";
			variantId: Id<"productVariants">;
			questionId: string;
			/** undefined clears the answer. */
			answer: string | undefined;
	  }
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
		case "SET_ANSWER":
			return {
				...state,
				items: state.items.map((i) => {
					if (i.variantId !== action.variantId) return i;
					const { [action.questionId]: _cleared, ...rest } = i.answers ?? {};
					const answers =
						action.answer === undefined
							? rest
							: { ...rest, [action.questionId]: action.answer };
					return {
						...i,
						answers: Object.keys(answers).length > 0 ? answers : undefined,
					};
				}),
			};
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

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every((v) => typeof v === "string")
	);
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
				// An RSVP is checked out standalone (`z8r3fdhh45`), so it can no
				// longer be a cart line. A cart persisted before that change may
				// still carry one — dropped on hydrate rather than left to be
				// refused at `orders.create`, which would strand the buyer with a
				// basket they can't check out and can't see the problem with.
				(i as { event?: unknown }).event === undefined &&
				typeof i.variantId === "string" &&
				typeof i.productId === "string" &&
				typeof i.name === "string" &&
				typeof i.price === "number" &&
				typeof i.currency === "string" &&
				typeof i.quantity === "number" &&
				i.quantity > 0,
		).map((i) =>
			// A malformed answers map is dropped, the LINE kept — losing typed
			// answers is a nuisance, losing the basket is a dead end.
			i.answers === undefined || isStringRecord(i.answers)
				? i
				: { ...i, answers: undefined },
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
	// The product card's stepper "−" (z8r3fdegb5). Steppers only render for
	// quick-addable products (single variant, never custom), so the product
	// resolves to exactly one line. Dropping below the product's minimum
	// removes the line outright — symmetric with quick-add, whose first tap
	// adds the whole minimum, and it keeps the card from manufacturing a
	// shortfall it has no room to explain (checkout can, the card can't).
	const quickRemoveProduct = useCallback(
		(productId: Id<"products">) => {
			const line = state.items.find(
				(i) => i.productId === productId && !i.isCustom,
			);
			if (!line) return;
			const min = Math.max(1, line.minQuantity ?? 1);
			const next = line.quantity - 1;
			dispatch({
				type: "SET_QTY",
				variantId: line.variantId,
				quantity: next < min ? 0 : next,
			});
		},
		[state.items],
	);
	const removeItem = useCallback(
		(variantId: Id<"productVariants">) =>
			dispatch({ type: "REMOVE", variantId }),
		[],
	);
	const clearCart = useCallback(() => dispatch({ type: "CLEAR" }), []);
	const setAnswer = useCallback(
		(
			variantId: Id<"productVariants">,
			questionId: string,
			answer: string | undefined,
		) => dispatch({ type: "SET_ANSWER", variantId, questionId, answer }),
		[],
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
			currency: state.items[0]?.currency ?? DEFAULT_CURRENCY,
		};
	}, [state.items]);

	// Per-product quantity: drives the min-quantity-aware stepper default, the
	// quick-add top-up, and the card's −/n/+ stepper (z8r3fdegb5). Custom /
	// made-to-order lines are excluded — they never count toward a minimum, and
	// they're a separate quoted negotiation. Built once per items change, then
	// read per-card in O(1).
	const byProduct = useMemo(() => {
		const map = new Map<string, number>();
		for (const i of state.items) {
			if (i.isCustom) continue;
			map.set(i.productId, (map.get(i.productId) ?? 0) + i.quantity);
		}
		return map;
	}, [state.items]);

	const quantityForProduct = useCallback(
		(productId: Id<"products">) => byProduct.get(productId) ?? 0,
		[byProduct],
	);

	// Has THIS retailer's persisted cart been read into state yet? The reducer
	// starts at EMPTY_STATE and hydrates in an effect, so the first committed
	// render always reports an empty cart — measured: navigating to checkout
	// painted "Your cart is empty" before the items arrived. Surfaces that would
	// otherwise render a dead-end empty state (and offer a "browse the store"
	// exit) must hold a skeleton until this is true. `retailerId` undefined =
	// hydration hasn't even been attempted.
	const hydrated = retailerId !== undefined && state.hydratedFor === retailerId;

	return {
		hydrated,
		items: state.items,
		itemCount,
		total,
		currency,
		addItem,
		updateQuantity,
		quickRemoveProduct,
		removeItem,
		clearCart,
		setAnswer,
		quantityForProduct,
	};
}

export type UseCart = ReturnType<typeof useCart>;
