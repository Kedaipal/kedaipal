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
import type { Country } from "../../convex/lib/country";

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
	/** Heavier than any rider vehicle can carry, and no courier priced it
	 * (25 Oct 2026). The address is fine — the ORDER is too big for a rider —
	 * so the copy offers pickup or the store, never a different address. */
	| { state: "too_heavy" }
	| { state: "unavailable" };

/**
 * What the checkout should treat as the store's delivery answer while the
 * reactive `delivery.quote` re-runs (25 Oct 2026).
 *
 * That query takes the cart and subtotal as arguments, so every quantity tap
 * is a NEW query whose result is empty until it lands. For that moment the
 * checkout forgot the store was live-priced: the ticket dropped its delivery
 * line, the total fell by the fee, and the live quote reset — found driving
 * a quantity stepper on a Delyva store. The caller reads with
 * `placeholderData: keepPreviousData`; this keeps the held answer ONLY when it
 * says "live", because a live answer doesn't depend on the cart or the
 * address (the action prices those). Any other kind is a fee FOR the old
 * cart or address, so it is dropped exactly as before — a stale flat or
 * distance fee must never show beside a new address.
 */
export function heldDeliveryAnswer<T extends { kind: string }>(read: {
	data: T | undefined;
	isPlaceholderData: boolean;
}): T | undefined {
	if (!read.isPlaceholderData) return read.data;
	return read.data?.kind === "live" ? read.data : undefined;
}

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
	country,
	postcode,
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
	 * WHICH lines. REQUIRED (PR #253 review): two surfaces omitted it and
	 * starved Delyva of a weight, silently re-opening the one-provider leak on
	 * claim links and address edits — the type now catches the next surface
	 * that forgets. Lines without a variantId (legacy pre-variant orders,
	 * custom lines) are simply not summable and belong filtered out by the
	 * caller; the server then refuses the Delyva bid rather than under-weighs. */
	items: Array<{ variantId: Id<"productVariants">; quantity: number }>;
	/** Epoch-ms MYT midnight of the chosen day — pre-orders are priced for
	 * THEIR day, so date changes re-quote like address changes. */
	fulfilmentDate?: number;
	/** Chosen time on that day (minutes since MYT midnight, 86eyg0n8e
	 * follow-up) — the quote then prices the exact moment instead of the noon
	 * heuristic; a time change re-quotes exactly like a date change. */
	fulfilmentTimeMinutes?: number;
	/** The Deliver-to country when it's ABROAD (z8r3fdr5yy) — the lane's
	 * EasyParcel price. Absent = a home delivery. */
	country?: Country;
	/** The typed postcode, watched — an overseas address is often entered by
	 * hand with no pin, and EasyParcel prices (and the order binds) on the
	 * postcode. Only read for an overseas quote. */
	postcode?: string;
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
	// Read at fire time so the quote that fires prices the cart as it stands.
	const itemsRef = useRef(items);
	itemsRef.current = items;
	// A provider-aware quote is BOUND to the cart it priced (Delyva bids on
	// the summed weight, and `sameQuotedLines` refuses the row against any
	// other cart at order create), so a quantity change at checkout must
	// re-quote — otherwise the buyer sees a stale fee and then a refusal
	// (Zaki, 23 Oct 2026). Order within the cart is presentation, so the key
	// is a sorted multiset. A rider-only (single-provider) quote ignores the
	// cart and never re-fires for it.
	const linesKey = providerAware
		? items
				.map((i) => `${i.variantId}:${i.quantity}`)
				.sort()
				.join("|")
		: "";
	// Cart edits are debounced LONGER than a pin pick: a buyer tapping + three
	// times should spend one quote, not three — each call draws on the
	// store's per-minute quote bucket (`lalamoveQuote`, 10/min, burst 4).
	const lastRef = useRef<{ pin: string; lines: string } | null>(null);

	const hasCoords = latitude !== undefined && longitude !== undefined;
	const lanePostcode = country !== undefined ? (postcode ?? "").trim() : "";
	// An overseas lane quote is priced on the postcode; a home one on the pin.
	const canQuote = country !== undefined ? lanePostcode !== "" : hasCoords;
	// biome-ignore lint/correctness/useExhaustiveDependencies: fires per picked pin / chosen day; the action identity is stable and the label is read fresh inside the timeout.
	useEffect(() => {
		if (!enabled || !retailerId || !canQuote) {
			seq.current++;
			setQuote({ state: "idle" });
			return;
		}
		const mySeq = ++seq.current;
		setQuote({ state: "loading" });
		const pin = `${country !== undefined ? `pc:${lanePostcode}` : `${latitude},${longitude}`},${fulfilmentDate},${fulfilmentTimeMinutes}`;
		const linesOnly =
			lastRef.current !== null &&
			lastRef.current.pin === pin &&
			lastRef.current.lines !== linesKey;
		lastRef.current = { pin, lines: linesKey };
		const timer = setTimeout(
			() => {
				const parts = partsRef.current?.() ?? {};
				const request = providerAware
					? quoteLive({
							retailerId,
							// An overseas quote binds to the postcode, never a pin.
							...(country !== undefined
								? { country }
								: { latitude, longitude }),
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
							// The legacy rider-only mode is home-only, so `canQuote`
							// above already required the pin.
							latitude: latitude as number,
							longitude: longitude as number,
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
			},
			linesOnly ? 900 : 400,
		);
		return () => clearTimeout(timer);
	}, [
		enabled,
		providerAware,
		retailerId,
		canQuote,
		latitude,
		longitude,
		country,
		lanePostcode,
		fulfilmentDate,
		fulfilmentTimeMinutes,
		linesKey,
	]);

	return quote;
}
