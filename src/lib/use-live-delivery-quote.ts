// Live courier quote for buyer-facing address surfaces (86eyb5hrf; strict
// since 27 Jul — no quote means no submit, so this state IS the gate).
//
// The reactive `delivery.quote` query only says a store is live-priced; the
// real fee comes from an ACTION, fired once per picked map pin (debounced as
// a keystroke guard). WHICH action is the store's mode, handed down as
// `providerAware`: "live" stores go through `liveQuote.quoteForCheckout`
// (every armed provider quoted, buyer pays the higher — z8r3fdbvdy) and
// not-yet-migrated "lalamove" stores keep the single-provider action, so a
// deploy alone never changes what anyone is charged. The action records the fee
// server-side and returns a row id — `orders.create` / `updateDeliveryAddress`
// load the fee from that row, so this state is display + gating only (same
// trust model as the static quote). Shared by the checkout sheet and the
// tracking page's address-edit dialog so the two can't drift.

import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export type LiveDeliveryQuoteState =
	| { state: "idle" }
	| { state: "loading" }
	| { state: "quoted"; quoteId: Id<"deliveryQuotes">; fee: number }
	/** The courier doesn't serve this destination — PERMANENT for this address
	 * (Lalamove covers city zones, not a radius), so the buyer must change it.
	 * Distinct from "unavailable" precisely so the copy can't say "try again". */
	| { state: "out_of_range" }
	/** The SELLER's delivery setup is broken (missing/revoked courier keys) —
	 * nothing the buyer does fixes it; the copy points at the store / pickup. */
	| { state: "store_unavailable" }
	/** The cart needs a cold chain and no armed courier carries one — the
	 * address is fine, so the copy must not send the buyer editing it. Riders
	 * are never substituted: they carry no temperature guarantee. */
	| { state: "no_cold_service" }
	| { state: "unavailable" };

export function useLiveDeliveryQuote({
	enabled,
	providerAware,
	retailerId,
	latitude,
	longitude,
	getAddressLabel,
	getAddressParts,
	items,
	fulfilmentDate,
	fulfilmentTimeMinutes,
}: {
	/** False while the store isn't live-priced / the surface is closed. */
	enabled: boolean;
	/** Store is on the provider-aware mode — quote every armed provider
	 * instead of Lalamove alone. From `delivery.quote`, never guessed. */
	providerAware?: boolean;
	retailerId: Id<"retailers"> | undefined;
	/** Undefined until the buyer picks a Google suggestion (no pin, no quote). */
	latitude: number | undefined;
	longitude: number | undefined;
	/** Read fresh at fire time (kept in a ref) so text-field edits that don't
	 * move the pin never re-quote. */
	getAddressLabel: () => string;
	/** The written address, read fresh at fire time like the label. Delyva
	 * prices on the POSTCODE, not the map pin, so a live-quote store with a
	 * courier armed needs these — Lalamove ignores them. */
	getAddressParts?: () => {
		city?: string;
		state?: string;
		postcode?: string;
	};
	/** Cart lines — the server re-reads each variant's weight itself (a
	 * client-supplied weight would buy a cheaper courier band); this only says
	 * WHICH lines. */
	items?: Array<{ variantId: Id<"productVariants">; quantity: number }>;
	/** Epoch-ms MYT midnight of the chosen day — pre-orders are priced for
	 * THEIR day, so date changes re-quote like address changes. */
	fulfilmentDate?: number;
	/** Chosen time on that day (minutes since MYT midnight, 86eyg0n8e
	 * follow-up) — the quote then prices the exact moment instead of the noon
	 * heuristic; a time change re-quotes exactly like a date change. */
	fulfilmentTimeMinutes?: number;
}): LiveDeliveryQuoteState {
	const quoteLalamove = useAction(api.lalamove.quoteForCheckout);
	const quoteLive = useAction(api.liveQuote.quoteForCheckout);
	const [quote, setQuote] = useState<LiveDeliveryQuoteState>({
		state: "idle",
	});
	const seq = useRef(0);
	const labelRef = useRef(getAddressLabel);
	labelRef.current = getAddressLabel;
	const partsRef = useRef(getAddressParts);
	partsRef.current = getAddressParts;
	// Read at fire time too: adding a cart line shouldn't re-quote on its own
	// (the pin hasn't moved), but the quote that DOES fire must price the cart
	// as it stands.
	const itemsRef = useRef(items);
	itemsRef.current = items;

	const hasCoords = latitude !== undefined && longitude !== undefined;
	// biome-ignore lint/correctness/useExhaustiveDependencies: fires per picked pin / chosen day; the action identity is stable and the label is read fresh inside the timeout.
	useEffect(() => {
		if (!enabled || !retailerId || !hasCoords) {
			seq.current++;
			setQuote({ state: "idle" });
			return;
		}
		const mySeq = ++seq.current;
		setQuote({ state: "loading" });
		const timer = setTimeout(() => {
			const parts = partsRef.current?.() ?? {};
			const request = providerAware
				? quoteLive({
						retailerId,
						latitude,
						longitude,
						address: labelRef.current(),
						city: parts.city,
						state: parts.state,
						postcode: parts.postcode,
						items: itemsRef.current,
						fulfilmentDate,
						fulfilmentTimeMinutes,
					})
				: quoteLalamove({
						retailerId,
						latitude,
						longitude,
						address: labelRef.current(),
						fulfilmentDate,
						fulfilmentTimeMinutes,
					});
			request
				.then((result) => {
					if (seq.current !== mySeq) return; // superseded by a newer pick
					setQuote(
						result.status === "quoted"
							? { state: "quoted", quoteId: result.quoteId, fee: result.fee }
							: { state: result.status },
					);
				})
				.catch(() => {
					if (seq.current !== mySeq) return;
					setQuote({ state: "unavailable" });
				});
		}, 400);
		return () => clearTimeout(timer);
	}, [
		enabled,
		providerAware,
		retailerId,
		hasCoords,
		latitude,
		longitude,
		fulfilmentDate,
		fulfilmentTimeMinutes,
	]);

	return quote;
}
