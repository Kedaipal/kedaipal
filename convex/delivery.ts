// Public delivery-charge quote for the storefront checkout (86extzdr8).
//
// The checkout sheet calls this live once the buyer picks an address
// suggestion, so the fee they see before "Send order" is resolved by the SAME
// pure function (`resolveDeliveryQuote`) that `orders.create` snapshots — the
// preview and the stored total can't diverge.
//
// PRIVACY: the response deliberately carries the FEE only, never the computed
// distance or band bound. The business address is often the seller's home;
// returning raw distances to arbitrary probe coordinates would let a caller
// trilaterate it. Band-coarse fees are the accepted exposure (any store that
// publishes a zone price list reveals as much). See docs/fulfilment.md.

import { v } from "convex/values";
import { query } from "./_generated/server";
import {
	type DeliveryConfig,
	resolveDeliveryQuote,
} from "./lib/delivery";

export type PublicDeliveryQuote =
	| { kind: "free"; reason?: "threshold" }
	| { kind: "fee"; fee: number }
	| { kind: "pending"; reason: "out_of_range" | "no_coords" | "unquotable" }
	| { kind: "blocked"; reason: "out_of_range" | "no_coords" | "unquotable" }
	// Pricing mode "lalamove": this reactive query can't fetch the provider —
	// the checkout must call the lalamove.quoteForCheckout ACTION once the
	// buyer picks an address. `onUnquotable` tells the client what happens
	// if that action comes back unavailable (copy + submit gating).
	| { kind: "live"; onUnquotable: "arrange" | "block" };

export const quote = query({
	args: {
		retailerId: v.id("retailers"),
		// Buyer's address coordinates — omitted while they haven't picked a
		// Google suggestion (radius mode then resolves per the out-of-range
		// policy: block → "pick a suggestion", arrange → fee-pending).
		latitude: v.optional(v.number()),
		longitude: v.optional(v.number()),
		// Cart line-item subtotal (sen) — drives the flat free-above threshold.
		subtotal: v.number(),
	},
	handler: async (ctx, args): Promise<PublicDeliveryQuote> => {
		const retailer = await ctx.db.get(args.retailerId);
		if (!retailer) return { kind: "free" };
		if (retailer.deliveryConfig?.mode === "lalamove") {
			return {
				kind: "live",
				onUnquotable: retailer.deliveryConfig.onUnquotable,
			};
		}
		const destination =
			args.latitude !== undefined &&
			args.longitude !== undefined &&
			Number.isFinite(args.latitude) &&
			Number.isFinite(args.longitude)
				? { latitude: args.latitude, longitude: args.longitude }
				: undefined;
		const resolved = resolveDeliveryQuote({
			config: retailer.deliveryConfig as DeliveryConfig | undefined,
			subtotal: Math.max(0, args.subtotal),
			origin: retailer.businessAddress,
			destination,
		});
		// Strip distanceKm/bandMaxKm — fee only (see privacy note above).
		if (resolved.kind === "fee") return { kind: "fee", fee: resolved.fee };
		return resolved;
	},
});
