// Live Lalamove delivery quote for buyer-facing address surfaces (86eyb5hrf;
// strict since 27 Jul — no quote means no submit, so this state IS the gate).
//
// The reactive `delivery.quote` query only says a store is live-priced; the
// real fee comes from the `lalamove.quoteForCheckout` ACTION, fired once per
// picked map pin (debounced as a keystroke guard). The action records the fee
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
	| { state: "unavailable" };

export function useLiveDeliveryQuote({
	enabled,
	retailerId,
	latitude,
	longitude,
	getAddressLabel,
	fulfilmentDate,
}: {
	/** False while the store isn't live-priced / the surface is closed. */
	enabled: boolean;
	retailerId: Id<"retailers"> | undefined;
	/** Undefined until the buyer picks a Google suggestion (no pin, no quote). */
	latitude: number | undefined;
	longitude: number | undefined;
	/** Read fresh at fire time (kept in a ref) so text-field edits that don't
	 * move the pin never re-quote. */
	getAddressLabel: () => string;
	/** Epoch-ms MYT midnight of the chosen day — pre-orders are priced for
	 * THEIR day, so date changes re-quote like address changes. */
	fulfilmentDate?: number;
}): LiveDeliveryQuoteState {
	const quoteLalamove = useAction(api.lalamove.quoteForCheckout);
	const [quote, setQuote] = useState<LiveDeliveryQuoteState>({
		state: "idle",
	});
	const seq = useRef(0);
	const labelRef = useRef(getAddressLabel);
	labelRef.current = getAddressLabel;

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
			quoteLalamove({
				retailerId,
				latitude,
				longitude,
				address: labelRef.current(),
				fulfilmentDate,
			})
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
	}, [enabled, retailerId, hasCoords, latitude, longitude, fulfilmentDate]);

	return quote;
}
