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
import { fetchLalamoveQuote } from "./lalamove";
import {
	type CartWeightItem,
	type DeliveryConfig,
	summarizeCartWeight,
} from "./lib/delivery";
import {
	type DelyvaItemType,
	resolveDelyvaCredentials,
} from "./lib/delyva";
import {
	cartItemType,
	chooseLiveQuote,
	isColdItemType,
	type ProviderQuote,
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
		cartWeightKg: number | null;
	} | null> => {
		const retailer = await ctx.db.get(args.retailerId);
		if (!retailer) return null;
		const config = retailer.deliveryConfig as DeliveryConfig | undefined;
		// Only the provider-aware mode routes here; "lalamove" keeps its own
		// single-provider action until stored rows migrate.
		if (config?.mode !== "live") return null;

		const delyvaConfig = retailer.delyva as
			| NonNullable<Doc<"retailers">["delyva"]>
			| undefined;
		const delyvaCredentials = resolveDelyvaCredentials(delyvaConfig);
		const itemType = cartItemType(delyvaConfig?.defaultItemType) as DelyvaItemType;

		let cartWeightKg: number | null = null;
		if (args.items?.length) {
			const lines = args.items.slice(0, MAX_QUOTE_ITEMS);
			const weightItems: CartWeightItem[] = await Promise.all(
				lines.map(async (line): Promise<CartWeightItem> => {
					const variant = await ctx.db.get(line.variantId);
					// Missing/foreign variant → weightless line → the summary says
					// "missing_weights" rather than silently under-weighing.
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
			const summary = summarizeCartWeight(weightItems);
			if (summary.kind === "ok") cartWeightKg = summary.grams / 1000;
		}

		return {
			currency: retailer.currency ?? "MYR",
			itemType,
			cold: isColdItemType(itemType),
			// Rider booking armed AND the country actually serves it — the same
			// pair the dispatch surfaces use, so checkout can't quote a provider
			// dispatch would refuse.
			lalamoveArmed: retailer.deliveryBooking?.enabled === true,
			delyva:
				delyvaCredentials &&
				delyvaConfig?.enabled === true &&
				delyvaConfig.pickupAddress &&
				// Stored optional, but an instantQuote without it is a 400 — an
				// account half-way through connecting simply doesn't bid.
				delyvaConfig.customerId !== undefined
					? {
							armed: true,
							credentials: delyvaCredentials,
							customerId: delyvaConfig.customerId,
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
			cartWeightKg,
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
		latitude: v.number(),
		longitude: v.number(),
		address: v.string(),
		/** Structured buyer address — Delyva prices on postcode, not the pin. */
		city: v.optional(v.string()),
		state: v.optional(v.string()),
		postcode: v.optional(v.string()),
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
		| { status: "store_unavailable" }
		| { status: "unavailable" }
	> => {
		// One bucket per store, as the single-provider action already does —
		// this call may hit two providers, so the ceiling matters more here.
		await rateLimiter.limit(ctx, "lalamoveQuote", {
			key: args.retailerId,
			throws: true,
		});
		if (!Number.isFinite(args.latitude) || !Number.isFinite(args.longitude)) {
			return { status: "unavailable" };
		}
		const context = await ctx.runQuery(internal.liveQuote.getLiveQuoteContext, {
			retailerId: args.retailerId,
			items: args.items,
		});
		if (!context) return { status: "store_unavailable" };

		const lalamoveContext = context.lalamoveArmed
			? await ctx.runQuery(internal.lalamove.getQuoteContext, {
					retailerId: args.retailerId,
				})
			: null;

		// Both providers at once: two sequential round-trips to third parties
		// would show up as checkout latency the buyer feels.
		const [lalamove, delyva] = await Promise.all([
			lalamoveContext
				? fetchLalamoveQuote({
						context: lalamoveContext,
						retailerId: args.retailerId,
						latitude: args.latitude,
						longitude: args.longitude,
						address: args.address,
						fulfilmentDate: args.fulfilmentDate,
						fulfilmentTimeMinutes: args.fulfilmentTimeMinutes,
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
		]);

		const quotes: ProviderQuote[] = [];
		if (lalamove)
			quotes.push({ provider: "lalamove", ...lalamove } as ProviderQuote);
		if (delyva) quotes.push({ provider: "delyva", ...delyva } as ProviderQuote);

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
				latitude: args.latitude,
				longitude: args.longitude,
			},
		);
		return { status: "quoted", quoteId, fee: outcome.fee };
	},
});
