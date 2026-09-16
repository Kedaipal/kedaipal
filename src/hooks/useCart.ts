import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { DEFAULT_CURRENCY } from "../../convex/lib/currency";
import { formatEventBadge } from "../../convex/lib/productEvent";

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
	// The product's fixed event moment (`z8r3fdff9u`), frozen at add time like
	// price and name. Present = this line is an RSVP, which locks the WHOLE
	// order's fulfilment date and forces self-collect. Absent on legacy
	// persisted carts and on every normal product. The server re-reads the live
	// event at create — this copy exists so the checkout can render the lock
	// without a product join.
	event?: { date: number; timeMinutes?: number };
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

	// The ONE event this cart is RSVPing to, or undefined. Derived rather than
	// stored so it can never drift from the lines — removing the last event line
	// releases the lock by construction.
	const cartEvent = useMemo(
		() => state.items.find((i) => i.event !== undefined)?.event,
		[state.items],
	);
	const cartEventName = useMemo(
		() => state.items.find((i) => i.event !== undefined)?.name,
		[state.items],
	);

	// Adding to the cart can REFUSE (`z8r3fdff9u`): an order carries one
	// fulfilment date, so two events can't share a cart. Returns a result the
	// caller surfaces inline — the alternative is a silent no-op, which reads as
	// a broken button.
	//
	// Mixing an event with NORMAL products is allowed on purpose (she sells
	// puffs at her own event); the checkout says loudly that the whole order is
	// then locked to the event date and venue, and offers a one-tap escape.
	const addItem = useCallback(
		(
			item: Omit<CartItem, "quantity">,
			quantity = 1,
		): { ok: true } | { ok: false; reason: string } => {
			if (
				item.event !== undefined &&
				cartEvent !== undefined &&
				cartEvent.date !== item.event.date
			) {
				return {
					ok: false,
					reason: `Your cart already has an RSVP for ${formatEventBadge(cartEvent)} — check that one out first.`,
				};
			}
			dispatch({ type: "ADD", item, quantity });
			return { ok: true };
		},
		[cartEvent],
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
	// Drop every RSVP line in one tap (`z8r3fdff9u`) — the escape hatch from the
	// checkout's event lock. Removing the event releases the date + pickup
	// lock by construction, since `cartEvent` is derived from the lines.
	const removeEventLines = useCallback(() => {
		for (const item of state.items) {
			if (item.event !== undefined)
				dispatch({ type: "REMOVE", variantId: item.variantId });
		}
	}, [state.items]);

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

	// Per-product aggregates: the quantity drives the min-quantity-aware stepper
	// default + quick-add top-up, and both quantity + subtotal drive the grid's
	// "N in cart · RM total" affordance. Custom / made-to-order lines are excluded
	// — they never count toward a minimum, and they're a separate quoted
	// negotiation (price 0 in-cart until the seller quotes on the mockup), so
	// folding them into a running money total would understate it. Built once per
	// items change, then read per-card in O(1).
	const byProduct = useMemo(() => {
		const map = new Map<string, { quantity: number; subtotal: number }>();
		for (const i of state.items) {
			if (i.isCustom) continue;
			const agg = map.get(i.productId) ?? { quantity: 0, subtotal: 0 };
			agg.quantity += i.quantity;
			agg.subtotal += i.price * i.quantity;
			map.set(i.productId, agg);
		}
		return map;
	}, [state.items]);

	const quantityForProduct = useCallback(
		(productId: Id<"products">) => byProduct.get(productId)?.quantity ?? 0,
		[byProduct],
	);
	const subtotalForProduct = useCallback(
		(productId: Id<"products">) => byProduct.get(productId)?.subtotal ?? 0,
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
		// The event this cart is RSVPing to (undefined for a normal cart), plus
		// the product name that carries it — the checkout's lock banner needs both.
		cartEvent,
		cartEventName,
		itemCount,
		total,
		currency,
		addItem,
		updateQuantity,
		removeItem,
		removeEventLines,
		clearCart,
		quantityForProduct,
		subtotalForProduct,
	};
}

export type UseCart = ReturnType<typeof useCart>;
