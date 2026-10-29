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
import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { storeLanes } from "./crossBorder";
import { MY_STATES } from "./lib/address";
import { countryValidator, DEFAULT_COUNTRY } from "./lib/country";
import {
	laneFor,
	resolveCrossBorderQuote,
	shipsAbroad,
} from "./lib/crossBorder";
import {
	delyvaBidsAtCheckout,
	lalamoveBookingArmed,
} from "./lib/courierBooking";
import {
	type CartWeightItem,
	type DeliveryConfig,
	type DeliveryQuoteReason,
	deliveryModeAllowed,
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
	// "store_unavailable" = seller-side breakage the buyer can't fix: the
	// live-quote client collapse (broken seller keys), or — server-emitted —
	// a stored delivery mode the store's country doesn't support (SG-lite
	// read guard below; updateSettings refuses storing that combination).
	| { kind: "blocked"; reason: DeliveryQuoteReason | "store_unavailable" }
	// Pricing mode "lalamove": this reactive query can't fetch the provider —
	// the client must call the lalamove.quoteForCheckout ACTION once the buyer
	// picks an address, and no quote = no order (strict since 27 Jul: the buyer
	// always sees the real rider price; unquotable/pin-less addresses can't
	// submit).
	// `providerAware` says WHICH action fetches the real fee: the
	// provider-aware `liveQuote.quoteForCheckout` (mode "live", quotes every
	// armed provider and charges the higher) or the single-provider
	// `lalamove.quoteForCheckout` (mode "lalamove", pre-migration). The client
	// can't infer it — both modes look identical from here — and calling the
	// wrong one would price a store by rules it hasn't been moved to yet.
	// `riders` / `couriers`: WHICH kinds of provider can bid, so the address
	// helper can say "by rider or courier" and drop "outside the rider's
	// coverage can't be delivered" when a courier reaches the whole country
	// (the /test-code pass on PR #415 caught the lie on a Delyva store). One
	// bit each, derived from owner-only config that never crosses here.
	| { kind: "live"; providerAware: boolean; riders: boolean; couriers: boolean }
	// Cross-border (z8r3fdr5yy): the cart holds products that ship within the
	// store's country only. Named, so checkout can offer a one-tap Remove for
	// each instead of a submit error — the order never splits silently.
	| {
			kind: "home_only";
			products: Array<{ productId: Id<"products">; name: string }>;
	  }
	// Cross-border: the store isn't taking orders to that country right now
	// (the lane is paused or gone since the page loaded).
	| { kind: "no_lane" };

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
		// The "Deliver to" country the buyer picked (z8r3fdr5yy). Absent or the
		// store's own = a domestic quote, exactly as before. Another country is
		// priced by the store's lane — never the domestic config.
		country: v.optional(countryValidator),
	},
	handler: async (ctx, args): Promise<PublicDeliveryQuote> => {
		const retailer = await ctx.db.get(args.retailerId);
		if (!retailer) return { kind: "free" };
		const storeCountry = retailer.country ?? DEFAULT_COUNTRY;
		if (args.country !== undefined && args.country !== storeCountry) {
			const lane = laneFor(
				(await storeLanes(ctx, retailer)).effective,
				args.country,
			);
			if (!lane) return { kind: "no_lane" };
			const lines = (args.items ?? []).slice(0, MAX_QUOTE_ITEMS);
			const homeOnly: Array<{ productId: Id<"products">; name: string }> = [];
			const weightItems: CartWeightItem[] = [];
			for (const line of lines) {
				const variant = await ctx.db.get(line.variantId);
				if (!variant || variant.retailerId !== args.retailerId) {
					weightItems.push({ parcelWeightG: 0, quantity: line.quantity });
					continue;
				}
				weightItems.push({
					parcelWeightG: variant.parcelWeightG,
					quantity: line.quantity,
					isCustom: variant.isCustom === true,
				});
				const product = await ctx.db.get(variant.productId);
				if (
					product &&
					!shipsAbroad(product) &&
					!homeOnly.some((p) => p.productId === product._id)
				)
					homeOnly.push({ productId: product._id, name: product.name });
			}
			if (homeOnly.length > 0) return { kind: "home_only", products: homeOnly };
			const resolved = resolveCrossBorderQuote({
				pricing: lane.pricing,
				subtotal: Math.max(0, args.subtotal),
				cartWeight:
					lane.pricing.kind === "weight" && lines.length > 0
						? summarizeCartWeight(weightItems)
						: undefined,
				country: lane.country,
			});
			if (resolved.kind === "fee") return { kind: "fee", fee: resolved.fee };
			return resolved;
		}
		// Country/mode mismatch (SG-lite belt-and-braces — updateSettings refuses
		// storing this): an MY-only pricing mode on an SG store can only misprice
		// or strand every order fee-pending, so surface it as the seller-side
		// blocked state ("it's on the store's side, not yours") instead.
		if (
			retailer.deliveryConfig &&
			!deliveryModeAllowed(
				retailer.country ?? DEFAULT_COUNTRY,
				retailer.deliveryConfig.mode,
			)
		) {
			return { kind: "blocked", reason: "store_unavailable" };
		}
		if (
			retailer.deliveryConfig?.mode === "lalamove" ||
			retailer.deliveryConfig?.mode === "live"
		) {
			const providerAware = retailer.deliveryConfig.mode === "live";
			return {
				kind: "live",
				providerAware,
				// The legacy single-provider mode is riders by definition.
				riders: providerAware ? lalamoveBookingArmed(retailer) : true,
				couriers: providerAware && delyvaBidsAtCheckout(retailer),
			};
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
