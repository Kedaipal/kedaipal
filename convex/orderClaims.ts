/**
 * Claim links (TikTok Live, ClickUp 86eyq0epn — docs/claim-links.md).
 *
 * The seller keys a "mine" claim in Counter Checkout (items, qty, the price
 * they called out — incl. per-line overrides, 86eyphh8r) against the buyer's
 * phone and SENDS it instead of finishing the sale. The buyer gets a WhatsApp
 * link to `/claim/<token>`: a pre-filled, price-LOCKED checkout where they add
 * address, fulfilment date and (after commit, on the order page) payment.
 *
 * Load-bearing decisions:
 *  - A claim is an OFFER: stock decrements at buyer COMMIT, never at send
 *    (no reservation in v1 — the ledger, 86eybbxhf, upgrades this later).
 *  - Lines are FROZEN at send. The counter draft is a non-authoritative
 *    scratchpad whose prices re-resolve at create, so "price locked" needs its
 *    own snapshot; commit re-reads variant rows ONLY for stock/parcel weight.
 *  - The window is a FIXED deadline. Before commit it gates completion
 *    (expired ⇒ dead link + released price); at commit it CARRIES onto the
 *    order as `paymentDueAt` and runs until real money, with the sweep below
 *    auto-cancelling a due unpaid order so the stock comes back (Zaki,
 *    27 Aug — the Agoda model). Resend never moves the deadline.
 *  - Resend is cooled down + capped (convex/lib/orderClaims.ts) so the seller
 *    can't spam the buyer's WhatsApp.
 *  - Commit mirrors the STOREFRONT validation set (address shape, delivery
 *    on offer, pickup resolution, notice floor, opening hours, live stock) but
 *    deliberately skips the min-order rules and the mockup gate — the seller
 *    keyed the lines and agreed the price, the counter posture.
 */

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalMutation,
	mutation,
	type MutationCtx,
	query,
} from "./_generated/server";
import { linkOrderToCustomer } from "./customers";
import { stampRetailerActivation } from "./lib/activation";
import { stampProductsOrdered } from "./lib/productOrdered";
import { recordOrderCreated } from "./subscriptionUsage";
import { assertValidAddress } from "./lib/address";
import { sanitizeAttributionSource } from "./lib/attribution";
import { logAdminAction, requireRetailerAccess } from "./lib/auth";
import { type Country, DEFAULT_COUNTRY } from "./lib/country";
import { getDisplayName, requireCustomerName } from "./lib/customer";
import type { CartWeightItem } from "./lib/delivery";
import {
	assertValidFulfilmentDate,
	assertValidFulfilmentTime,
} from "./lib/fulfilmentDate";
import {
	CLAIM_RETENTION_MS,
	claimResendState,
	effectiveClaimStatus,
	isAutoCancelDue,
	paymentDueAtCommit,
	sanitizeClaimWindowMinutes,
} from "./lib/orderClaims";
import {
	computeOrderTotals,
	generateShortId,
	generateTrackingToken,
} from "./lib/order";
import type { OpeningHours } from "./lib/openingHours";
import { assertWithinOpeningHours } from "./lib/openingHours";
import { summarizeCartWeight } from "./lib/delivery";
import { rateLimiter } from "./lib/rateLimiter";
import { variantLabel } from "./lib/variant";
import { orderConfirmTemplateName } from "./lib/whatsapp";
import { type Locale, pickLocale, type PickupSnapshot } from "./lib/whatsappCopy";
import {
	addressValidator,
	applyStatusTransition,
	buildPickupSnapshot,
	loadCheckoutDeliveryQuote,
	resolveDeliveryForOrder,
} from "./orders";

const MAX_CLAIM_ITEMS = 100;
const MAX_CUSTOMER_NOTE = 500;
const SHORT_ID_RETRIES = 3;

type ClaimLine = Doc<"orderClaims">["lines"][number];

/** Sum of the frozen lines (sen) — the locked items total. */
function claimItemsTotal(lines: readonly ClaimLine[]): number {
	return lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
}

/**
 * Resolve + freeze the seller-keyed lines against the live catalog. The same
 * rules as counterCheckout.createOrderFromSession's loop (owner-only caller,
 * so a supplied unitPrice IS the seller pricing their own order): custom lines
 * must carry a price, standard lines may carry an override, stock on
 * hard-block variants must cover the quantity — checked here so the seller
 * never sends a link that's dead on arrival, but NOT decremented (commit
 * re-checks and decrements).
 */
async function freezeClaimLines(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
	items: {
		variantId: Id<"productVariants">;
		quantity: number;
		unitPrice?: number;
	}[],
): Promise<ClaimLine[]> {
	const lines: ClaimLine[] = [];
	const requestedByVariant = new Map<
		Id<"productVariants">,
		{ qty: number; block: boolean; onHand: number }
	>();
	for (const item of items) {
		if (!Number.isInteger(item.quantity) || item.quantity < 1)
			throw new ConvexError("Quantity must be a positive integer");
		const variant = await ctx.db.get(item.variantId);
		if (!variant || variant.retailerId !== retailerId)
			throw new ConvexError("Item not found");
		const product = await ctx.db.get(variant.productId);
		if (!product) throw new ConvexError("Product not found");
		const label = variant.isCustom
			? (variant.customLabel ?? "Custom")
			: variantLabel(variant.optionValues);
		const displayName = label ? `${product.name} (${label})` : product.name;
		if (!product.active || !variant.active)
			throw new ConvexError(`"${displayName}" is not available`);
		let unitPrice: number;
		if (variant.isCustom === true || item.unitPrice !== undefined) {
			const entered = item.unitPrice;
			if (entered === undefined || !Number.isInteger(entered) || entered <= 0)
				throw new ConvexError(`Set a price for "${displayName}"`);
			unitPrice = entered;
		} else {
			unitPrice = variant.price;
		}
		const block =
			(variant.blockWhenOutOfStock ?? product.blockWhenOutOfStock) === true;
		const prior = requestedByVariant.get(item.variantId);
		const newQty = (prior?.qty ?? 0) + item.quantity;
		if (block && variant.onHand < newQty)
			throw new ConvexError(
				`Only ${variant.onHand} of "${displayName}" in stock`,
			);
		requestedByVariant.set(item.variantId, {
			qty: newQty,
			block,
			onHand: variant.onHand,
		});
		lines.push({
			productId: variant.productId,
			variantId: item.variantId,
			name: product.name,
			variantLabel: label || undefined,
			price: unitPrice,
			quantity: item.quantity,
		});
	}
	return lines;
}

/**
 * "Send to buyer" (86eyq0epn) — freeze the counter cart into a claim and
 * schedule the WhatsApp link. Owner-or-admin via the session. One LIVE claim
 * per session: an existing open claim is superseded (cancelled) first, because
 * the old link must die the moment the cart or a price changed. The chosen
 * window is remembered as the store's default for next time (the dialog says
 * so — Zaki's optional-flag-plus-minutes, with no hidden Settings card).
 */
export const sendClaim = mutation({
	args: {
		sessionId: v.id("counterCheckoutSessions"),
		items: v.array(
			v.object({
				variantId: v.id("productVariants"),
				quantity: v.number(),
				unitPrice: v.optional(v.number()),
			}),
		),
		windowMinutes: v.number(),
		// Where this buyer came from (86eyq0eq9) — the seller's own answer,
		// remembered as the store default for the rest of the session.
		attributionSource: v.optional(v.string()),
	},
	handler: async (
		ctx,
		args,
	): Promise<{
		claimId: Id<"orderClaims">;
		token: string;
		expiresAt: number;
	}> => {
		const session = await ctx.db.get(args.sessionId);
		if (!session) throw new ConvexError("Session not found");
		const access = await requireRetailerAccess(ctx, session.retailerId);
		const retailer = access.retailer;
		if (session.status !== "buyer_identified")
			throw new ConvexError("This checkout isn't open any more");
		if (!session.waPhone)
			throw new ConvexError(
				"Add the buyer's WhatsApp number first — an anonymous sale has nobody to send the link to.",
			);
		if (args.items.length === 0) throw new ConvexError("Add at least one item");
		if (args.items.length > MAX_CLAIM_ITEMS)
			throw new ConvexError(`Maximum ${MAX_CLAIM_ITEMS} items per order`);

		let windowMinutes: number;
		try {
			windowMinutes = sanitizeClaimWindowMinutes(args.windowMinutes);
		} catch (err) {
			throw new ConvexError((err as Error).message);
		}

		const lines = await freezeClaimLines(ctx, retailer._id, args.items);
		// Never throws (ticket AC) — a bad tag must not block a send.
		const sanitizedSource = sanitizeAttributionSource(args.attributionSource);
		const now = Date.now();

		// Supersede: the previous open claim for this session dies with this send
		// (its link renders "cancelled" from the next read).
		const priorClaims = await ctx.db
			.query("orderClaims")
			.withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
			.collect();
		for (const prior of priorClaims) {
			if (effectiveClaimStatus(prior, now) === "open") {
				await ctx.db.patch(prior._id, { status: "cancelled", updatedAt: now });
			}
		}

		const token = generateTrackingToken();
		const expiresAt = now + windowMinutes * 60 * 1000;
		const claimId = await ctx.db.insert("orderClaims", {
			retailerId: retailer._id,
			sessionId: args.sessionId,
			sellerUserId: retailer.userId,
			customerId: session.customerId,
			waPhone: session.waPhone,
			buyerName: session.waProfileName,
			lines,
			currency: retailer.currency ?? "MYR",
			token,
			status: "open",
			expiresAt,
			windowMinutes,
			attributionSource: sanitizedSource,
			sentCount: 1,
			lastSentAt: now,
			createdAt: now,
			updatedAt: now,
		});

		// Remember the window + origin as the store defaults (both surfaced in
		// the dialog, so the seller sets them once at the top of a live).
		const defaultsPatch: Record<string, unknown> = {};
		if (retailer.claimLinkWindowMinutes !== windowMinutes)
			defaultsPatch.claimLinkWindowMinutes = windowMinutes;
		if (retailer.claimLinkSource !== sanitizedSource)
			defaultsPatch.claimLinkSource = sanitizedSource;
		if (Object.keys(defaultsPatch).length > 0) {
			await ctx.db.patch(retailer._id, { ...defaultsPatch, updatedAt: now });
		}

		await ctx.scheduler.runAfter(0, internal.whatsapp.notifyClaimLink, {
			claimId,
		});
		await logAdminAction(ctx, access, "orderClaims.sendClaim", claimId);

		return { claimId, token, expiresAt };
	},
});

/**
 * Re-send the SAME link (same token, same deadline — the countdown never
 * resets). Guarded by the shared cooldown + hard cap so the buyer's chat
 * isn't spammed; the claims list mirrors the same rule as a
 * disabled-with-reason button.
 */
export const resendClaim = mutation({
	args: { claimId: v.id("orderClaims") },
	handler: async (ctx, { claimId }): Promise<void> => {
		const claim = await ctx.db.get(claimId);
		if (!claim) throw new ConvexError("Claim not found");
		const access = await requireRetailerAccess(ctx, claim.retailerId);
		const now = Date.now();
		if (effectiveClaimStatus(claim, now) !== "open")
			throw new ConvexError(
				"This link is no longer open — send a fresh one instead",
			);
		const resend = claimResendState(claim, now);
		if (!resend.canResend) {
			throw new ConvexError(
				resend.reason === "max_sends"
					? "This link has been sent the maximum number of times — if the buyer still hasn't seen it, message them directly"
					: "Give the buyer a moment — you can resend in a few minutes",
			);
		}
		await ctx.db.patch(claimId, {
			sentCount: claim.sentCount + 1,
			lastSentAt: now,
			lastSendOutcome: undefined,
			updatedAt: now,
		});
		await ctx.scheduler.runAfter(0, internal.whatsapp.notifyClaimLink, {
			claimId,
		});
		await logAdminAction(ctx, access, "orderClaims.resendClaim", claimId);
	},
});

/** Seller releases an open claim — the buyer's link renders "cancelled". */
export const cancelClaim = mutation({
	args: { claimId: v.id("orderClaims") },
	handler: async (ctx, { claimId }): Promise<void> => {
		const claim = await ctx.db.get(claimId);
		if (!claim) throw new ConvexError("Claim not found");
		const access = await requireRetailerAccess(ctx, claim.retailerId);
		if (effectiveClaimStatus(claim, Date.now()) !== "open") return; // already dead — idempotent
		await ctx.db.patch(claimId, {
			status: "cancelled",
			updatedAt: Date.now(),
		});
		await logAdminAction(ctx, access, "orderClaims.cancelClaim", claimId);
	},
});

/** One row of the seller's claims list. */
export interface ClaimListRow {
	claimId: Id<"orderClaims">;
	sessionId: Id<"counterCheckoutSessions">;
	status: "open" | "completed" | "cancelled" | "expired";
	buyerName: string;
	waPhone: string;
	itemCount: number;
	itemsTotal: number;
	currency: string;
	token: string;
	expiresAt: number;
	windowMinutes: number;
	sentCount: number;
	lastSentAt: number;
	lastSendOutcome?: "sent" | "failed";
	/** Completed claims: the order it became (link target for the seller). */
	orderShortId?: string;
	createdAt: number;
}

/**
 * The counter page's "Waiting on buyers" panel: every effectively-open claim,
 * plus a short tail of recently settled ones (completed / expired / cancelled)
 * so the seller sees outcomes without hunting. Owner-or-admin.
 */
export const listClaims = query({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (ctx, { retailerId }): Promise<ClaimListRow[]> => {
		// Same resolve-the-store shape as counterCheckout's requireCounterRetailer:
		// explicit retailerId = admin act-as, otherwise the caller's own store.
		let resolvedRetailerId: Id<"retailers">;
		if (retailerId) {
			const access = await requireRetailerAccess(ctx, retailerId);
			resolvedRetailerId = access.retailer._id;
		} else {
			const identity = await ctx.auth.getUserIdentity();
			if (!identity) throw new ConvexError("Not authenticated");
			const retailer = await ctx.db
				.query("retailers")
				.withIndex("by_user", (q) => q.eq("userId", identity.subject))
				.unique();
			if (!retailer) throw new ConvexError("No store found for this account");
			resolvedRetailerId = retailer._id;
		}

		const now = Date.now();
		const open = await ctx.db
			.query("orderClaims")
			.withIndex("by_retailer_status", (q) =>
				q.eq("retailerId", resolvedRetailerId).eq("status", "open"),
			)
			.order("desc")
			.take(50);
		const settled: Doc<"orderClaims">[] = [];
		for (const status of ["completed", "expired", "cancelled"] as const) {
			const rows = await ctx.db
				.query("orderClaims")
				.withIndex("by_retailer_status", (q) =>
					q.eq("retailerId", resolvedRetailerId).eq("status", status),
				)
				.order("desc")
				.take(5);
			settled.push(...rows);
		}

		const out: ClaimListRow[] = [];
		for (const claim of [...open, ...settled]) {
			let orderShortId: string | undefined;
			if (claim.orderId) {
				const order = await ctx.db.get(claim.orderId);
				orderShortId = order?.shortId;
			}
			out.push({
				claimId: claim._id,
				sessionId: claim.sessionId,
				// Live-judged, so an open row past its deadline reads Expired before
				// the cron flips it.
				status: effectiveClaimStatus(claim, now),
				buyerName: getDisplayName({
					waProfileName: claim.buyerName,
					waPhone: claim.waPhone,
				}),
				waPhone: claim.waPhone,
				itemCount: claim.lines.reduce((n, l) => n + l.quantity, 0),
				itemsTotal: claimItemsTotal(claim.lines),
				currency: claim.currency,
				token: claim.token,
				expiresAt: claim.expiresAt,
				windowMinutes: claim.windowMinutes,
				sentCount: claim.sentCount,
				lastSentAt: claim.lastSentAt,
				lastSendOutcome: claim.lastSendOutcome,
				orderShortId,
				createdAt: claim.createdAt,
			});
		}
		// Open first (soonest deadline first), then settled newest-first.
		out.sort((a, b) => {
			const aOpen = a.status === "open" ? 0 : 1;
			const bOpen = b.status === "open" ? 0 : 1;
			if (aOpen !== bOpen) return aOpen - bOpen;
			return aOpen === 0
				? a.expiresAt - b.expiresAt
				: b.createdAt - a.createdAt;
		});
		return out;
	},
});

/** The buyer's claim-page payload — everything /claim/<token> renders from. */
export interface ClaimPagePayload {
	status: "open" | "completed" | "cancelled" | "expired";
	store: {
		retailerId: Id<"retailers">;
		storeName: string;
		slug: string;
		logoUrl: string | null;
		/** Buyer-facing store contact — the expired page's wa.me CTA. */
		waPhone?: string;
		country: Country;
		locale: Locale;
		currency: string;
		offerDelivery: boolean;
		offerSelfCollect: boolean;
		collectsFromCustomer: boolean;
		/** max(store notice, strictest per-product override on the claim). */
		minNoticeDays: number;
		openingHours?: OpeningHours;
		confirmPushEnabled: boolean;
	};
	/** Present only while the claim is OPEN. */
	open?: {
		lines: ClaimLine[];
		itemsTotal: number;
		buyerName?: string;
		waPhone: string;
		expiresAt: number;
		windowMinutes: number;
	};
	/** Present once COMPLETED — the idempotent re-open shows the order. */
	completed?: { trackingToken?: string; shortId: string };
}

/**
 * Public capability read for /claim/<token> — the same trust model as
 * orders.get's tracking token (unguessable, never enumerable). Unknown token
 * → null (the route 404s). A dead claim still returns the store block so the
 * expired/cancelled pages can offer the wa.me + storefront exits.
 */
export const getByToken = query({
	args: { token: v.string() },
	handler: async (ctx, { token }): Promise<ClaimPagePayload | null> => {
		const claim = await ctx.db
			.query("orderClaims")
			.withIndex("by_token", (q) => q.eq("token", token))
			.unique();
		if (!claim) return null;
		const retailer = await ctx.db.get(claim.retailerId);
		if (!retailer) return null;

		const now = Date.now();
		const status = effectiveClaimStatus(claim, now);

		// Strictest per-product notice across the frozen lines (storefront rule —
		// the buyer picks the date, so the floor applies here too).
		let minNoticeDays = retailer.minFulfilmentNoticeDays ?? 0;
		if (status === "open") {
			const seen = new Set<Id<"products">>();
			for (const line of claim.lines) {
				if (seen.has(line.productId)) continue;
				seen.add(line.productId);
				const product = await ctx.db.get(line.productId);
				if (product && (product.minNoticeDays ?? 0) > minNoticeDays)
					minNoticeDays = product.minNoticeDays ?? 0;
			}
		}

		const payload: ClaimPagePayload = {
			status,
			store: {
				retailerId: retailer._id,
				storeName: retailer.storeName,
				slug: retailer.slug,
				logoUrl: retailer.logoStorageId
					? await ctx.storage.getUrl(retailer.logoStorageId)
					: null,
				waPhone: retailer.waPhone,
				country: retailer.country ?? DEFAULT_COUNTRY,
				locale: pickLocale(retailer.locale),
				currency: retailer.currency ?? "MYR",
				// Same legacy-default posture as the storefront payload.
				offerDelivery: (retailer.offerDelivery ?? true) === true,
				offerSelfCollect: retailer.offerSelfCollect === true,
				collectsFromCustomer:
					retailer.deliveryBooking?.deliveryDirection === "collection",
				minNoticeDays,
				openingHours: retailer.openingHours as OpeningHours | undefined,
				confirmPushEnabled: orderConfirmTemplateName() !== undefined,
			},
		};
		if (status === "open") {
			payload.open = {
				lines: claim.lines,
				itemsTotal: claimItemsTotal(claim.lines),
				buyerName: claim.buyerName,
				waPhone: claim.waPhone,
				expiresAt: claim.expiresAt,
				windowMinutes: claim.windowMinutes,
			};
		}
		if (status === "completed" && claim.orderId) {
			const order = await ctx.db.get(claim.orderId);
			if (order) {
				payload.completed = {
					trackingToken: order.trackingToken,
					shortId: order.shortId,
				};
			}
		}
		return payload;
	},
});

/**
 * The buyer completes the claim — the order COMMITS here (86eyq0epn): frozen
 * lines at their LOCKED prices + the buyer's address/date, validated with the
 * storefront rule set, stock decremented now (not at send). Public,
 * token-authenticated, rate-limited. Idempotent: a claim that already
 * completed returns its order instead of failing, so a double-tap or a
 * reopened tab lands on the same order.
 */
export const commit = mutation({
	args: {
		token: v.string(),
		buyerName: v.optional(v.string()),
		deliveryMethod: v.union(
			v.literal("delivery"),
			v.literal("self_collect"),
		),
		deliveryAddress: v.optional(addressValidator),
		pickupLocationId: v.optional(v.id("pickupLocations")),
		fulfilmentDate: v.optional(v.number()),
		fulfilmentTimeMinutes: v.optional(v.number()),
		customerNote: v.optional(v.string()),
		deliveryQuoteId: v.optional(v.id("deliveryQuotes")),
	},
	handler: async (
		ctx,
		args,
	): Promise<{
		shortId: string;
		trackingToken: string;
		deliveryFee?: number;
		deliveryFeePending?: boolean;
		confirmedAtCreate?: boolean;
	}> => {
		await rateLimiter.limit(ctx, "claimCommit", {
			key: args.token,
			throws: true,
		});

		const claim = await ctx.db
			.query("orderClaims")
			.withIndex("by_token", (q) => q.eq("token", args.token))
			.unique();
		if (!claim) throw new ConvexError("This order link doesn't exist");

		// Idempotent re-commit: hand back the existing order (AC: "buyer opens
		// link twice / after completing").
		if (claim.status === "completed" && claim.orderId) {
			const existing = await ctx.db.get(claim.orderId);
			if (existing) {
				return {
					shortId: existing.shortId,
					trackingToken: existing.trackingToken ?? "",
					confirmedAtCreate: existing.status !== "pending" || undefined,
				};
			}
		}

		const now = Date.now();
		const status = effectiveClaimStatus(claim, now);
		if (status === "expired")
			throw new ConvexError(
				"This order link has expired — message the store to get a fresh one",
			);
		if (status !== "open")
			throw new ConvexError("This order link is no longer active");

		const retailer = await ctx.db.get(claim.retailerId);
		if (!retailer) throw new ConvexError("Store not found");
		const retailerCountry = retailer.country ?? DEFAULT_COUNTRY;

		// Same spend ceiling as any public order create — the commit schedules
		// the same Meta-billed confirmation push.
		await rateLimiter.limit(ctx, "orderCreate", {
			key: claim.retailerId,
			throws: true,
		});
		await rateLimiter.limit(ctx, "orderCreateDaily", {
			key: claim.retailerId,
			throws: true,
		});

		// --- Storefront validation set (mirrors orders.create) -----------------
		if (args.deliveryMethod === "delivery" && !args.deliveryAddress)
			throw new ConvexError("Delivery address is required for delivery orders");
		if (args.deliveryMethod === "self_collect" && args.deliveryAddress)
			throw new ConvexError("Self-collect orders should not include an address");
		if (
			args.deliveryMethod === "delivery" &&
			args.pickupLocationId !== undefined
		)
			throw new ConvexError(
				"Delivery orders should not include a pickup location",
			);

		let sanitizedAddress: ReturnType<typeof assertValidAddress> | undefined;
		if (args.deliveryAddress) {
			try {
				sanitizedAddress = assertValidAddress(
					args.deliveryAddress,
					retailerCountry,
				);
			} catch (err) {
				throw new ConvexError((err as Error).message);
			}
		}

		if (
			args.deliveryMethod === "delivery" &&
			(retailer.offerDelivery ?? true) === false
		)
			throw new ConvexError("This store isn't offering delivery right now");

		let sanitizedPickupSnapshot: PickupSnapshot | undefined;
		let resolvedPickupLocationId: Id<"pickupLocations"> | undefined;
		if (
			args.deliveryMethod === "self_collect" &&
			retailer.offerSelfCollect === true
		) {
			const activeCount = await ctx.db
				.query("pickupLocations")
				.withIndex("by_retailer_active", (q) =>
					q.eq("retailerId", claim.retailerId).eq("isActive", true),
				)
				.first();
			if (activeCount !== null) {
				if (!args.pickupLocationId)
					throw new ConvexError(
						"Pick a pickup location to continue with self-collect",
					);
				const location = await ctx.db.get(args.pickupLocationId);
				if (!location || location.retailerId !== claim.retailerId)
					throw new ConvexError("Pickup location not found");
				if (!location.isActive)
					throw new ConvexError("That pickup location is no longer available");
				resolvedPickupLocationId = location._id;
				sanitizedPickupSnapshot = buildPickupSnapshot(location);
			}
		}

		// Buyer name: editable on the claim page, falls back to the frozen one.
		const sanitizedCustomer = {
			name: requireCustomerName(args.buyerName ?? claim.buyerName),
			waPhone: claim.waPhone,
		};

		const trimmedNote = args.customerNote?.trim();
		if (trimmedNote && trimmedNote.length > MAX_CUSTOMER_NOTE)
			throw new ConvexError(
				`Note must be ${MAX_CUSTOMER_NOTE} characters or fewer`,
			);
		const sanitizedCustomerNote =
			trimmedNote && trimmedNote.length > 0 ? trimmedNote : undefined;

		// --- Live catalog re-read: stock + weight ONLY, never price -------------
		// The frozen lines ARE the order items; the variant rows are consulted for
		// hard-block stock (decremented below) and parcel weight (weight-mode
		// delivery pricing). A vanished variant invalidates the claim — there's
		// nothing to decrement or weigh, so the buyer is pointed at the store.
		const requestedByVariant = new Map<
			Id<"productVariants">,
			{ qty: number; block: boolean; onHand: number }
		>();
		const weightItems: CartWeightItem[] = [];
		let maxItemNoticeDays = 0;
		for (const line of claim.lines) {
			const variant = await ctx.db.get(line.variantId);
			if (!variant)
				throw new ConvexError(
					`"${line.name}" is no longer available — message the store to sort it out`,
				);
			const product = await ctx.db.get(line.productId);
			if ((product?.minNoticeDays ?? 0) > maxItemNoticeDays)
				maxItemNoticeDays = product?.minNoticeDays ?? 0;
			const block =
				(variant.blockWhenOutOfStock ?? product?.blockWhenOutOfStock) === true;
			const prior = requestedByVariant.get(line.variantId);
			const newQty = (prior?.qty ?? 0) + line.quantity;
			// Out of stock at commit (no reservation in v1): name the line and hand
			// the buyer the contact path — never silently drop lines (ticket AC).
			if (block && variant.onHand < newQty)
				throw new ConvexError(
					`"${line.name}" sold out while this link was open — message the store to arrange a partial order`,
				);
			requestedByVariant.set(line.variantId, {
				qty: newQty,
				block,
				onHand: variant.onHand,
			});
			weightItems.push({
				parcelWeightG: variant.parcelWeightG,
				quantity: line.quantity,
				isCustom: variant.isCustom === true,
			});
		}

		// Fulfilment date: storefront floor — the store notice raised by the
		// strictest per-product override on the claim (the buyer picks the date).
		let sanitizedFulfilmentDate: number | undefined;
		if (args.fulfilmentDate !== undefined) {
			try {
				sanitizedFulfilmentDate = assertValidFulfilmentDate(
					args.fulfilmentDate,
					Math.max(retailer.minFulfilmentNoticeDays ?? 0, maxItemNoticeDays),
				);
			} catch (err) {
				throw new ConvexError((err as Error).message);
			}
		}
		let sanitizedFulfilmentTime: number | undefined;
		if (
			args.fulfilmentTimeMinutes !== undefined &&
			sanitizedFulfilmentDate !== undefined &&
			args.deliveryMethod === "delivery"
		) {
			try {
				sanitizedFulfilmentTime = assertValidFulfilmentTime(
					args.fulfilmentTimeMinutes,
				);
			} catch (err) {
				throw new ConvexError((err as Error).message);
			}
		}
		if (sanitizedFulfilmentDate !== undefined) {
			try {
				assertWithinOpeningHours(
					retailer.openingHours,
					sanitizedFulfilmentDate,
					sanitizedFulfilmentTime,
				);
			} catch (err) {
				throw new ConvexError((err as Error).message);
			}
		}

		const itemSubtotal = claimItemsTotal(claim.lines);

		// Delivery charge — identical resolution to orders.create (fee frozen,
		// "arrange" cases land deliveryFeePending, "block" cases throw).
		let deliverySnapshot: Doc<"orders">["deliverySnapshot"];
		let deliveryFeePending = false;
		let deliveryFeePendingReason: Doc<"orders">["deliveryFeePendingReason"];
		if (args.deliveryMethod === "delivery") {
			const liveQuote = await loadCheckoutDeliveryQuote(
				ctx,
				claim.retailerId,
				args.deliveryQuoteId,
				sanitizedAddress,
			);
			const resolved = resolveDeliveryForOrder(
				retailer,
				itemSubtotal,
				sanitizedAddress,
				summarizeCartWeight(weightItems),
				liveQuote,
			);
			deliverySnapshot = resolved.snapshot;
			deliveryFeePending = resolved.pending;
			deliveryFeePendingReason = resolved.pendingReason;
		}
		const deliveryDirection =
			args.deliveryMethod === "delivery" &&
			retailer.deliveryBooking?.deliveryDirection === "collection"
				? ("collection" as const)
				: undefined;

		const { subtotal, total } = computeOrderTotals(claim.lines, {
			pickupFee: sanitizedPickupSnapshot?.fee,
			deliveryFee: deliverySnapshot?.fee,
		});

		// Decrement hard-block stock — the commit IS the sale (OCC transaction,
		// so the validation read above and this write see one snapshot).
		for (const [variantId, { qty, block, onHand }] of requestedByVariant) {
			if (!block) continue;
			await ctx.db.patch(variantId, { onHand: onHand - qty, updatedAt: now });
		}

		let shortId: string | null = null;
		for (let attempt = 0; attempt < SHORT_ID_RETRIES; attempt++) {
			const candidate = generateShortId();
			const existing = await ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", candidate))
				.first();
			if (!existing) {
				shortId = candidate;
				break;
			}
		}
		if (!shortId)
			throw new ConvexError("Failed to generate unique order ID, please retry");

		const trackingToken = generateTrackingToken();

		// Confirm-push posture mirrors orders.create: the claim always has a
		// phone, so the template env alone decides. NO mockup gate on claim
		// orders — design + price were agreed in the live (counter posture).
		const confirmedAtCreate = orderConfirmTemplateName() !== undefined;

		const orderId = await ctx.db.insert("orders", {
			retailerId: claim.retailerId,
			shortId,
			trackingToken,
			items: claim.lines,
			subtotal,
			total,
			currency: claim.currency,
			status: confirmedAtCreate ? "confirmed" : "pending",
			channel: "whatsapp",
			source: "claim",
			customer: sanitizedCustomer,
			deliveryMethod: args.deliveryMethod,
			deliveryDirection,
			deliveryAddress: sanitizedAddress,
			pickupLocationId: resolvedPickupLocationId,
			pickupSnapshot: sanitizedPickupSnapshot,
			pickupFee: sanitizedPickupSnapshot?.fee,
			deliverySnapshot,
			deliveryFee: deliverySnapshot?.fee,
			deliveryFeePending: deliveryFeePending || undefined,
			deliveryFeePendingReason,
			fulfilmentDate: sanitizedFulfilmentDate,
			fulfilmentTimeMinutes: sanitizedFulfilmentTime,
			customerNote: sanitizedCustomerNote,
			// The channel the seller tagged this claim with, carried onto the
			// order so Insights counts a live drop's revenue against the channel
			// that produced it (86eyq0eq9). Undefined = untagged → the order
			// buckets "direct", exactly as before this existed.
			attributionSource: claim.attributionSource,
			// The claim's window CONTINUES onto the order (Zaki, 27 Aug — the
			// Agoda model): stock just decremented, so the hold must run until
			// real money. Floored to a full runway so a buyer who spent most of
			// the window on the form still has a real chance to pay.
			paymentDueAt: paymentDueAtCommit(claim.expiresAt, now),
			confirmationPushStatus: confirmedAtCreate ? "sending" : undefined,
			statusChangedAt: now,
			createdAt: now,
			updatedAt: now,
		});

		await ctx.db.insert("orderEvents", {
			orderId,
			status: "pending",
			note: "claim_checkout",
			createdAt: now,
		});
		if (confirmedAtCreate) {
			await ctx.db.insert("orderEvents", {
				orderId,
				status: "confirmed",
				note: "Confirmed at checkout",
				createdAt: now,
			});
			await stampRetailerActivation(ctx, claim.retailerId, now);
		}

		await recordOrderCreated(ctx, claim.retailerId, now);
		await stampProductsOrdered(ctx, claim.lines, now);

		await linkOrderToCustomer(ctx, {
			retailerId: claim.retailerId,
			waPhone: claim.waPhone,
			orderId,
			orderTotal: total,
			orderCreatedAt: now,
			customerName: sanitizedCustomer.name,
		});

		// Settle the claim + its counter session.
		await ctx.db.patch(claim._id, {
			status: "completed",
			orderId,
			updatedAt: now,
		});
		const session = await ctx.db.get(claim.sessionId);
		if (session && session.status === "buyer_identified") {
			await ctx.db.patch(session._id, {
				status: "completed",
				orderId,
				updatedAt: now,
			});
		}

		// Same notification fan-out as a storefront order: seller email + WA
		// alert (both self-gating), buyer confirmation push (the order's ONE
		// outbound message).
		await ctx.scheduler.runAfter(0, internal.email.notifyRetailerOrderAlert, {
			orderId,
		});
		await ctx.scheduler.runAfter(0, internal.whatsapp.notifySellerNewOrder, {
			orderId,
		});
		if (confirmedAtCreate) {
			await ctx.scheduler.runAfter(
				0,
				internal.whatsapp.notifyStorefrontOrderCreated,
				{ orderId },
			);
		}

		return {
			shortId,
			trackingToken,
			deliveryFee: deliverySnapshot?.fee,
			deliveryFeePending: deliveryFeePending || undefined,
			confirmedAtCreate: confirmedAtCreate || undefined,
		};
	},
});

/** Stamp the WhatsApp send outcome onto the claim (from notifyClaimLink) —
 * "failed" drives the claims list's copy-the-link-yourself fallback. */
export const recordClaimSendOutcome = internalMutation({
	args: {
		claimId: v.id("orderClaims"),
		outcome: v.union(v.literal("sent"), v.literal("failed")),
	},
	handler: async (ctx, { claimId, outcome }): Promise<void> => {
		const claim = await ctx.db.get(claimId);
		if (!claim) return;
		await ctx.db.patch(claimId, {
			lastSendOutcome: outcome,
			updatedAt: Date.now(),
		});
	},
});

/**
 * Cron (every minute): auto-cancel orders whose payment deadline has passed —
 * the teeth of the carried timer. Walks the tiny by_payment_due range (the
 * field's present-means-live contract keeps it near-empty), re-judges each row
 * with the shared `isAutoCancelDue` predicate (claimed / fee-pending /
 * live-gateway-session / already-advanced rows are PROTECTED — see the
 * predicate's comment), and cancels through `applyStatusTransition` so stock
 * restore, aggregate reversal, usage un-metering and the push-stamp cleanup
 * are the same code a seller's own Cancel runs. Stamps `cancelledReason` so
 * the buyer's page can say WHY instead of a bare "Cancelled". No WhatsApp —
 * one-message-per-order policy; the tracking page carries the state.
 */
export const cancelUnpaidDueOrders = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, { cursor }) => {
		const now = Date.now();
		const page = await ctx.db
			.query("orders")
			.withIndex("by_payment_due", (q) =>
				q.gt("paymentDueAt", 0).lt("paymentDueAt", now),
			)
			.paginate({ numItems: 50, cursor: cursor ?? null });
		let cancelled = 0;
		for (const order of page.page) {
			if (!isAutoCancelDue(order, now)) continue;
			await applyStatusTransition(ctx, order, "cancelled", {
				note: "payment_window_expired",
			});
			// applyStatusTransition clears paymentDueAt on every cancel; the
			// reason stamp is this sweep's own signature.
			await ctx.db.patch(order._id, {
				cancelledReason: "payment_window_expired",
			});
			cancelled++;
		}
		if (!page.isDone) {
			await ctx.scheduler.runAfter(
				0,
				internal.orderClaims.cancelUnpaidDueOrders,
				{ cursor: page.continueCursor },
			);
		}
		return { cancelled, isDone: page.isDone };
	},
});

/**
 * Cron: flip open claims past their fixed deadline to `expired`. Reads judge
 * expiry live (effectiveClaimStatus), so this is housekeeping — it keeps the
 * by_retailer_status buckets true. Batched + self-scheduling.
 */
export const expireStaleClaims = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, { cursor }) => {
		const now = Date.now();
		const page = await ctx.db
			.query("orderClaims")
			.withIndex("by_status_expiry", (q) =>
				q.eq("status", "open").lt("expiresAt", now),
			)
			.paginate({ numItems: 100, cursor: cursor ?? null });
		for (const claim of page.page) {
			await ctx.db.patch(claim._id, { status: "expired", updatedAt: now });
		}
		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, internal.orderClaims.expireStaleClaims, {
				cursor: page.continueCursor,
			});
		}
		return { expired: page.page.length, isDone: page.isDone };
	},
});

/**
 * Daily purge: DELETE dead claims (expired / cancelled) past the retention
 * window — they hold buyer PII (phone + name) and serve no further purpose.
 * Completed claims are kept (they link to an order; order retention is the
 * PDPA pack's job). Mirrors counterCheckout.purgeStaleSessions.
 */
export const purgeStaleClaims = internalMutation({
	args: {
		status: v.optional(v.union(v.literal("expired"), v.literal("cancelled"))),
		cursor: v.optional(v.union(v.string(), v.null())),
	},
	handler: async (ctx, { status, cursor }) => {
		const sweepStatus = status ?? "expired";
		const cutoff = Date.now() - CLAIM_RETENTION_MS;
		const page = await ctx.db
			.query("orderClaims")
			.withIndex("by_status_expiry", (q) =>
				q.eq("status", sweepStatus).lt("expiresAt", cutoff),
			)
			.paginate({ numItems: 100, cursor: cursor ?? null });
		for (const claim of page.page) {
			await ctx.db.delete(claim._id);
		}
		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, internal.orderClaims.purgeStaleClaims, {
				status: sweepStatus,
				cursor: page.continueCursor,
			});
		} else if (sweepStatus === "expired") {
			await ctx.scheduler.runAfter(0, internal.orderClaims.purgeStaleClaims, {
				status: "cancelled",
			});
		}
	},
});
