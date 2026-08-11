// Public delivery-charge quote for the storefront checkout (86extzdr8).
//
// The checkout page calls this live once the buyer picks an address
// suggestion, so the fee they see before "Send order" is resolved by the SAME
// pure function (`resolveDeliveryQuote`) that `orders.create` snapshots — the
// preview and the stored total can't diverge.
//
// PRIVACY: the response deliberately carries the FEE only, never the computed
// distance/band bound (radius) or zone/weight internals (weight mode). The
// business address is often the seller's home; returning raw distances to
// arbitrary probe coordinates would let a caller trilaterate it. Band-coarse
// fees are the accepted exposure (any store that publishes a zone price list
// reveals as much). See docs/fulfilment.md.

import { v } from "convex/values";
import { query } from "./_generated/server";
import { MY_STATES } from "./lib/address";
import {
	type CartWeightItem,
	type DeliveryConfig,
	type DeliveryQuoteReason,
	resolveDeliveryQuote,
	summarizeCartWeight,
} from "./lib/delivery";

const MY_STATE_SET: ReadonlySet<string> = new Set(MY_STATES);

// Mirrors MAX_ITEMS_PER_ORDER in convex/orders.ts — a cart the checkout would
// refuse anyway never earns a variant-fetch loop here.
const MAX_QUOTE_ITEMS = 100;

export type PublicDeliveryQuote =
	| { kind: "free"; reason?: "threshold" }
	| { kind: "fee"; fee: number }
	| { kind: "pending"; reason: DeliveryQuoteReason }
	// "store_unavailable" is produced only by the live-quote client collapse
	// (broken seller keys) — the static resolver never emits it.
	| { kind: "blocked"; reason: DeliveryQuoteReason | "store_unavailable" }
	// Pricing mode "lalamove": this reactive query can't fetch the provider —
	// the client must call the lalamove.quoteForCheckout ACTION once the buyer
	// picks an address, and no quote = no order (strict since 27 Jul: the buyer
	// always sees the real rider price; unquotable/pin-less addresses can't
	// submit).
	| { kind: "live" };

export const quote = query({
	args: {
		retailerId: v.id("retailers"),
		// Buyer's address coordinates — omitted while they haven't picked a
		// Google suggestion (radius mode then resolves per the out-of-range
		// policy: block → "pick a suggestion", arrange → fee-pending).
		latitude: v.optional(v.number()),
		longitude: v.optional(v.number()),
		// Buyer's address state (weight mode's zone key) — from the Google pick
		// or the manual-entry state select; omitted before either exists. An
		// unrecognized value is treated as absent, never as an unserved state.
		state: v.optional(v.string()),
		// Cart lines (weight mode) — the server reads each variant's parcel
		// weight itself, so a tampered client can only misprice its own PREVIEW
		// (orders.create re-resolves from validated items either way).
		items: v.optional(
			v.array(
				v.object({
					variantId: v.id("productVariants"),
					quantity: v.number(),
				}),
			),
		),
		// Cart line-item subtotal (sen) — drives the free-above thresholds.
		subtotal: v.number(),
	},
	handler: async (ctx, args): Promise<PublicDeliveryQuote> => {
		const retailer = await ctx.db.get(args.retailerId);
		if (!retailer) return { kind: "free" };
		if (retailer.deliveryConfig?.mode === "lalamove") {
			return { kind: "live" };
		}
		const destination =
			args.latitude !== undefined &&
			args.longitude !== undefined &&
			Number.isFinite(args.latitude) &&
			Number.isFinite(args.longitude)
				? { latitude: args.latitude, longitude: args.longitude }
				: undefined;
		const state =
			args.state !== undefined && MY_STATE_SET.has(args.state)
				? args.state
				: undefined;
		// Variant weights are read only when the mode prices by them — flat/
		// radius quotes never pay the fetch loop, and the subscription doesn't
		// pick up variant-doc invalidations it doesn't use.
		let cartWeight: ReturnType<typeof summarizeCartWeight> | undefined;
		if (retailer.deliveryConfig?.mode === "weight" && args.items) {
			const lines = args.items.slice(0, MAX_QUOTE_ITEMS);
			const weightItems: CartWeightItem[] = await Promise.all(
				lines.map(async (line): Promise<CartWeightItem> => {
					const variant = await ctx.db.get(line.variantId);
					// Missing/foreign variant → weightless line → the cart resolves
					// "missing_weights" (never a silent underweigh, never a leak).
					if (!variant || variant.retailerId !== args.retailerId) {
						return { parcelWeightG: 0, quantity: line.quantity };
					}
					return {
						parcelWeightG: variant.parcelWeightG,
						quantity: line.quantity,
						isCustom: variant.isCustom === true,
					};
				}),
			);
			cartWeight = summarizeCartWeight(weightItems);
		}
		const resolved = resolveDeliveryQuote({
			config: retailer.deliveryConfig as DeliveryConfig | undefined,
			subtotal: Math.max(0, args.subtotal),
			origin: retailer.businessAddress,
			destination,
			state,
			cartWeight,
		});
		// Strip the audit internals (distance/band/zone/weight) — fee only (see
		// privacy note above).
		if (resolved.kind === "fee") return { kind: "fee", fee: resolved.fee };
		return resolved;
	},
});
