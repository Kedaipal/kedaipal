/**
 * Provider-aware live delivery pricing at checkout (z8r3fdbvdy).
 *
 * Its own module on purpose: this orchestrates BOTH booking providers, so it
 * belongs to neither `lalamove.ts` nor `delyva.ts` — parking it in one of
 * them would make that provider look like the primary and the other like an
 * afterthought, which is exactly the assumption the multi-provider rework
 * removed.
 *
 * Flow: fetch every armed provider's price in parallel → apply the rule
 * (convex/lib/liveQuote.ts) → record ONE deliveryQuotes row for the winner.
 * Losers leave no row behind, because a row is redeemable at order create
 * and only the charged price may be.
 *
 * The RULE lives in the pure module; this file only fetches and records.
 */

import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	type DelyvaCheckoutContext,
	fetchDelyvaCheckoutQuote,
} from "./delyva";
import { fetchLalamoveQuote, vehicleLoadsFor } from "./lalamove";
import { resolveLalamoveCredentials } from "./lib/lalamove";
import type { CartWeightItem, DeliveryConfig } from "./lib/delivery";
import {
	type DelyvaItemType,
	resolveDelyvaCredentials,
} from "./lib/delyva";
import { delyvaBidsAtCheckout } from "./lib/courierBooking";
import { storeLanes } from "./crossBorder";
import { fetchEasyparcelCheckoutQuote } from "./easyparcel";
import {
	type Country,
	countryValidator,
	DEFAULT_COUNTRY,
	storeCurrencyOf,
} from "./lib/country";
import { COURIER_DESTINATIONS } from "./lib/courierProviders";
import {
	easyparcelConfigured,
	easyparcelQuoteBlock,
} from "./lib/easyparcelArming";
import {
	cartItemType,
	chooseLiveQuote,
	isColdItemType,
	liveQuoteWeightFacts,
	type ProviderQuote,
	weightGapStamp,
} from "./lib/liveQuote";
import { rateLimiter } from "./lib/rateLimiter";

/** Mirrors MAX_QUOTE_ITEMS in delivery.ts — a cart checkout would refuse
 * anyway never earns a variant-fetch loop. */
const MAX_QUOTE_ITEMS = 100;

/**
 * Everything the action needs, resolved in one read: which providers are
 * armed, the Delyva side's credentials and addresses, and the cart's weight
 * (summed from the VARIANTS, never from the client — a tampered weight would
 * otherwise buy a cheaper courier band).
 */
export const getLiveQuoteContext = internalQuery({
	args: {
		retailerId: v.id("retailers"),
		/** Where the parcel is going (z8r3fdr5yy). Absent = the store's own
		 * country. Abroad, only a live lane routes here, priced by EasyParcel. */
		country: v.optional(countryValidator),
		items: v.optional(
			v.array(
				v.object({
					variantId: v.id("productVariants"),
					quantity: v.number(),
				}),
			),
		),
	},
	handler: async (
		ctx,
		args,
	): Promise<{
		currency: string;
		itemType: DelyvaItemType;
		cold: boolean;
		lalamoveArmed: boolean;
		delyva: (DelyvaCheckoutContext & { armed: true }) | null;
		/** EasyParcel bids: on a live lane (the only bidder abroad), or at home
		 * on a store where it carries domestic parcels (SG). */
		easyparcel: {
			sender: { postcode: string; state?: string; country: Country };
		} | null;
		destination: Country;
		storeCountry: Country;
		/** Goods value in major units — EasyParcel declares it on the parcel. */
		goodsValue: number;
		cartWeightKg: number | null;
		/** The cart was priced at the one-kilo floor, and how many of its
		 * lines a product weight would have priced — stamped on the quote row
		 * so the order can say so (`liveQuoteWeightFacts`). */
		weightFloored: boolean;
		unweighedLines: number;
	} | null> => {
		const retailer = await ctx.db.get(args.retailerId);
		if (!retailer) return null;
		const storeCountry = retailer.country ?? DEFAULT_COUNTRY;
		const destination = args.country ?? storeCountry;
		const abroad = destination !== storeCountry;
		const config = retailer.deliveryConfig as DeliveryConfig | undefined;
		if (abroad) {
			// Abroad only a LIVE lane routes here — the one EasyParcel prices.
			const lane = (await storeLanes(ctx, retailer)).effective.find(
				(l) => l.country === destination,
			);
			if (lane?.pricing.kind !== "live") return null;
		} else if (config?.mode !== "live") {
			// Only the provider-aware mode routes here; "lalamove" keeps its own
			// single-provider action until stored rows migrate.
			return null;
		}

		// EasyParcel bids abroad (the lane's courier) or at home where it
		// carries domestic parcels — and only while it can actually quote.
		const easyparcelConn =
			abroad || COURIER_DESTINATIONS.easyparcel[storeCountry] !== "abroad"
				? await ctx.db
						.query("easyparcelConnections")
						.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
						.unique()
				: null;
		const easyparcel =
			easyparcelConn?.pickupAddress &&
			easyparcelQuoteBlock({
				conn: easyparcelConn,
				configured: easyparcelConfigured(),
				senderPhone: retailer.waPhone,
				storeCurrency: storeCurrencyOf(retailer),
			}) === null
				? {
						sender: {
							postcode: easyparcelConn.pickupAddress.postcode,
							state: easyparcelConn.pickupAddress.state,
							country: storeCountry,
						},
					}
				: null;

		const delyvaConfig = retailer.delyva as
			| NonNullable<Doc<"retailers">["delyva"]>
			| undefined;
		const delyvaCredentials = resolveDelyvaCredentials(delyvaConfig);
		const itemType = cartItemType(delyvaConfig?.defaultItemType) as DelyvaItemType;

		let cartWeightKg: number | null = null;
		let weightFloored = false;
		let unweighedLines = 0;
		let goodsMinor = 0;
		if (args.items?.length) {
			const lines = args.items.slice(0, MAX_QUOTE_ITEMS);
			const weightItems: CartWeightItem[] = await Promise.all(
				lines.map(async (line): Promise<CartWeightItem> => {
					const variant = await ctx.db.get(line.variantId);
					// Missing/foreign variant → weightless line → quoted at the
					// floor (liveQuoteWeightKg), never at a borrowed weight.
					if (!variant || variant.retailerId !== args.retailerId) {
						return { parcelWeightG: 0, quantity: line.quantity };
					}
					goodsMinor += variant.price * line.quantity;
					return {
						parcelWeightG: variant.parcelWeightG,
						quantity: line.quantity,
						isCustom: variant.isCustom === true,
					};
				}),
			);
			const facts = liveQuoteWeightFacts(weightItems);
			cartWeightKg = facts?.kg ?? null;
			weightFloored = facts?.floored ?? false;
			unweighedLines = facts?.unweighedLines ?? 0;
		}

		return {
			currency: storeCurrencyOf(retailer),
			itemType,
			cold: isColdItemType(itemType),
			// Rider booking armed AND the country actually serves it — the same
			// pair the dispatch surfaces use, so checkout can't quote a provider
			// dispatch would refuse.
			// Riders and Delyva are domestic: they never bid on a parcel abroad.
			lalamoveArmed: !abroad && retailer.deliveryBooking?.enabled === true,
			// Armed, country-allowed AND holding the pickup address an
			// instantQuote needs (a 400 without it) — `delyvaBidsAtCheckout`,
			// the same predicate the public `delivery.quote` tells the checkout
			// copy with, so "by rider or courier" can never disagree with who
			// actually bids. The customerId is part of "credentials".
			delyva:
				!abroad &&
				delyvaCredentials &&
				delyvaConfig?.pickupAddress &&
				delyvaBidsAtCheckout(retailer)
					? {
							armed: true,
							credentials: delyvaCredentials,
							customerId: delyvaCredentials.customerId,
							origin: {
								address1: delyvaConfig.pickupAddress.address1,
								address2: delyvaConfig.pickupAddress.address2,
								city: delyvaConfig.pickupAddress.city,
								state: delyvaConfig.pickupAddress.state,
								postcode: delyvaConfig.pickupAddress.postcode,
								country: retailer.country ?? "MY",
							},
							itemType,
						}
					: null,
			easyparcel,
			destination,
			storeCountry,
			goodsValue: goodsMinor / 100,
			cartWeightKg,
			weightFloored,
			unweighedLines,
		};
	},
});

/**
 * Public storefront action: the live delivery fee for the buyer's picked
 * address, priced across every provider the store has armed.
 *
 * Never throws to the buyer for a provider problem — every failure resolves
 * to a status the checkout has copy for. Coordinates stay REQUIRED even
 * though Delyva prices on the written address: the redemption check at order
 * create is coordinate-based, and one replay control covering both providers
 * is worth more than saving a rider-less store a map pin.
 */
export const quoteForCheckout = action({
	args: {
		retailerId: v.id("retailers"),
		/** The buyer's pin. Optional only for an overseas lane quote, which
		 * EasyParcel prices — and redemption binds — on the postcode. */
		latitude: v.optional(v.number()),
		longitude: v.optional(v.number()),
		address: v.string(),
		/** Structured buyer address — Delyva prices on postcode, not the pin. */
		city: v.optional(v.string()),
		state: v.optional(v.string()),
		postcode: v.optional(v.string()),
		/** The buyer's Deliver-to country (z8r3fdr5yy) — absent = home. */
		country: v.optional(countryValidator),
		items: v.optional(
			v.array(
				v.object({
					variantId: v.id("productVariants"),
					quantity: v.number(),
				}),
			),
		),
		fulfilmentDate: v.optional(v.number()),
		fulfilmentTimeMinutes: v.optional(v.number()),
	},
	handler: async (
		ctx,
		args,
	): Promise<
		| { status: "quoted"; quoteId: Id<"deliveryQuotes">; fee: number }
		| { status: "out_of_range" }
		| { status: "no_cold_service" }
		| { status: "too_heavy" }
		| { status: "store_unavailable" }
		| { status: "unavailable" }
	> => {
		// One bucket per store, as the single-provider action already does —
		// this call may hit two providers, so the ceiling matters more here.
		await rateLimiter.limit(ctx, "lalamoveQuote", {
			key: args.retailerId,
			throws: true,
		});
		const pinned =
			args.latitude !== undefined &&
			args.longitude !== undefined &&
			Number.isFinite(args.latitude) &&
			Number.isFinite(args.longitude);
		const context = await ctx.runQuery(internal.liveQuote.getLiveQuoteContext, {
			retailerId: args.retailerId,
			country: args.country,
			items: args.items,
		});
		if (!context) return { status: "store_unavailable" };
		// Home deliveries stay pin-bound (riders price the pin, and one replay
		// control covers every provider). An overseas lane quote is EasyParcel
		// alone, priced on the postcode — so it binds to that instead.
		const laneQuote = context.destination !== context.storeCountry;
		if (laneQuote ? !args.postcode?.trim() : !pinned) {
			return { status: "unavailable" };
		}

		const lalamoveContext = context.lalamoveArmed
			? await ctx.runQuery(internal.lalamove.getQuoteContext, {
					retailerId: args.retailerId,
				})
			: null;
		// The rider is quoted the vehicle that can carry the cart (25 Oct
		// 2026): Lalamove's own per-market loads, cached; unknown = the seller's
		// vehicle, as before. Read before the parallel fetch — usually a cache
		// hit, an inline `/v3/cities` call only the first time a market quotes.
		const lalamoveCredentials = lalamoveContext
			? resolveLalamoveCredentials(lalamoveContext.booking, lalamoveContext.country)
			: null;
		const vehicleLoads =
			lalamoveContext && lalamoveCredentials
				? await vehicleLoadsFor(ctx, {
						retailerId: args.retailerId,
						credentials: lalamoveCredentials,
						env: lalamoveContext.env,
						inlineFetch: true,
					})
				: null;

		// Every provider at once: sequential round-trips to third parties
		// would show up as checkout latency the buyer feels.
		const [lalamove, delyva, easyparcel] = await Promise.all([
			// Riders bid at home only, where the pin was required above.
			lalamoveContext &&
			args.latitude !== undefined &&
			args.longitude !== undefined
				? fetchLalamoveQuote({
						context: lalamoveContext,
						retailerId: args.retailerId,
						latitude: args.latitude,
						longitude: args.longitude,
						address: args.address,
						fulfilmentDate: args.fulfilmentDate,
						fulfilmentTimeMinutes: args.fulfilmentTimeMinutes,
						cartKg: context.cartWeightKg,
						loads: vehicleLoads,
					})
				: null,
			context.delyva && args.postcode
				? fetchDelyvaCheckoutQuote({
						context: context.delyva,
						destination: {
							address1: args.address.trim().slice(0, 500) || "Delivery address",
							city: args.city ?? "",
							state: args.state ?? "",
							postcode: args.postcode,
							country: context.delyva.origin.country,
						},
						weightKg: context.cartWeightKg ?? 0,
					})
				: null,
			context.easyparcel && args.postcode
				? fetchEasyparcelCheckoutQuote(ctx, {
						retailerId: args.retailerId,
						sender: context.easyparcel.sender,
						receiver: {
							postcode: args.postcode,
							state: args.state,
							country: context.destination,
						},
						weightKg: context.cartWeightKg ?? 0,
						parcelValue: context.goodsValue,
						fulfilmentDate: args.fulfilmentDate,
					})
				: null,
		]);

		const quotes: ProviderQuote[] = [];
		if (lalamove)
			quotes.push({ provider: "lalamove", ...lalamove } as ProviderQuote);
		if (delyva) quotes.push({ provider: "delyva", ...delyva } as ProviderQuote);
		if (easyparcel)
			quotes.push({ provider: "easyparcel", ...easyparcel } as ProviderQuote);

		const outcome = chooseLiveQuote({
			quotes,
			storeCurrency: context.currency,
			cold: context.cold,
		});
		if (outcome.kind === "unquotable") return { status: outcome.reason };

		const quoteId: Id<"deliveryQuotes"> = await ctx.runMutation(
			internal.lalamove.saveCheckoutQuote,
			{
				retailerId: args.retailerId,
				provider: outcome.provider,
				quotationId: outcome.quotationId,
				fee: outcome.fee,
				currency: outcome.currency,
				vehicleType: outcome.vehicleType,
				serviceCode: outcome.serviceCode,
				serviceName: outcome.serviceName,
				considered: outcome.considered,
				// The cart this price belongs to — redemption refuses any other.
				lines: args.items,
				...(laneQuote
					? { postcode: args.postcode?.trim() }
					: { latitude: args.latitude, longitude: args.longitude }),
				// What the courier priced without: the floor, and any line with
				// no weight even when the floor didn't fire (`weightGapStamp`).
				...weightGapStamp({
					provider: outcome.provider,
					weightFloored: context.weightFloored,
					unweighedLines: context.unweighedLines,
				}),
			},
		);
		return { status: "quoted", quoteId, fee: outcome.fee };
	},
});
