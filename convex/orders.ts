import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	action,
	internalMutation,
	internalQuery,
	mutation,
	type MutationCtx,
	query,
	type QueryCtx,
} from "./_generated/server";
import {
	adjustAggregatesForTotalChange,
	decrementAggregatesForCancel,
	linkOrderToCustomer,
	moveOrderToPhone,
} from "./customers";
import { stampRetailerActivation } from "./lib/activation";
import {
	attributionBucket,
	sanitizeAttributionSource,
} from "./lib/attribution";
import { stampProductsOrdered } from "./lib/productOrdered";
import { assertValidAddress } from "./lib/address";
import {
	isStoredImageRenderable,
	UNRENDERABLE_PROOF_MESSAGE,
} from "./lib/imageContentType";
import { requireCustomerName } from "./lib/customer";
import { assertPlanFeature, assertSubscriptionActive } from "./subscriptions";
import {
	recordOrderCancelled,
	recordOrderCreated,
} from "./subscriptionUsage";
import {
	adminUserIds,
	isAdmin,
	logAdminAction,
	logDestructiveAdminAction,
	type RetailerAccess,
	requireRetailerAccess,
} from "./lib/auth";
import {
	assertValidFulfilmentDate,
	assertValidFulfilmentTime,
	hhmmFromMinutes,
	matchesFulfilmentWindow,
	ymdFromEpoch,
} from "./lib/fulfilmentDate";
import { assertWithinOpeningHours } from "./lib/openingHours";
import {
	collectMinQuantityShortfalls,
	type MinRuleItem,
	minOrderValueShortfall,
	minQuantityMessage,
} from "./lib/minOrderRules";
import { isUnseenOrder, orderBucket } from "./lib/orderBuckets";
import { type CsvOrder, ordersToCsv } from "./lib/orderCsv";
import {
	type ManualReminderBlock,
	manualReminderEligibility,
} from "./lib/paymentReminder";
import {
	buildInboxPredicate,
	type InboxFilterArgs,
	needsMockup,
	sortInboxOrders,
} from "./lib/orderInboxFilter";
import {
	extendedPaymentDue,
	isPaymentWindowLocked,
	PAYMENT_WINDOW_LOCK_REASON,
	paymentDeadlineApplies,
} from "./lib/orderClaims";
import { isReadyToShipForLabel } from "./lib/pdf/awb";
import {
	computeOrderTotals,
	generateShortId,
	generateTrackingToken,
	isCollectionGateClosed,
	isMockupGateClosed,
} from "./lib/order";
import { deleteOrderOwnedBlobs } from "./lib/orderBlobs";
import { normalizeTrackingToken } from "./lib/trackingToken";
import {
	type CartWeightItem,
	type CartWeightSummary,
	DELIVERY_FEE_MAX,
	type DeliveryConfig,
	type DeliveryQuoteReason,
	deliveryModeAllowed,
	type LiveProviderQuote,
	resolveDeliveryQuote,
	summarizeCartWeight,
} from "./lib/delivery";
import {
	CHECKOUT_QUOTE_MAX_AGE_MS,
	isActiveJobStatus,
	isRiderManagedTransition,
} from "./lib/lalamove";
import { resolveShipmentFields } from "./lib/couriers";
import {
	anchorOrdinal,
	type Locale,
	type OrderStage,
	resolveStages,
	stageLabel,
	type StatusLabels,
} from "./lib/orderStatus";
import { type PaymentMethod, resolvePaymentMethods } from "./lib/payment";
import { type Country, DEFAULT_COUNTRY } from "./lib/country";
import {
	type OrderReceiptData,
	orderToReceiptData,
} from "./lib/pdf/document";
import { buildOrderReceiptPdf } from "./lib/pdf/render";
import {
	type OrderPaymentMethod,
	orderPaymentMethodValidator,
} from "./lib/paymentMethod";
import {
	HITPAY_MIN_AMOUNT_SEN,
	hitpayCheckoutConfigured,
	mapHitpayPaymentType,
} from "./lib/hitpay";
import { rateLimiter } from "./lib/rateLimiter";
import { assertValidMobileForCountry } from "./lib/slug";
import { orderConfirmTemplateName } from "./lib/whatsapp";
import { variantLabel } from "./lib/variant";
import type { PickupSnapshot } from "./lib/whatsappCopy";

// Shared with convex/orderClaims.ts (claim-link commit runs the same
// storefront validation + delivery resolution — one author for both paths).
export const addressValidator = v.object({
	line1: v.string(),
	line2: v.optional(v.string()),
	city: v.string(),
	state: v.string(),
	postcode: v.string(),
	notes: v.optional(v.string()),
	mapsUrl: v.optional(v.string()),
	// Coordinates captured from Google Places autocomplete on the buyer's
	// checkout form. Optional — falls through cleanly when the buyer typed
	// the address manually.
	latitude: v.optional(v.number()),
	longitude: v.optional(v.number()),
	placeId: v.optional(v.string()),
});

const MAX_ITEMS_PER_ORDER = 100;
const MAX_CUSTOMER_NOTE = 500;
const SHORT_ID_RETRIES = 3;
// Up to 5 mockup images per order (designs/angles, or one per item in a
// multi-part custom order) — mirrors the product-image cap. See docs/proof-approval.md.
const MAX_MOCKUP_IMAGES = 5;

/**
 * The order's mockup image ids, newest model first. `mockupImageStorageIds` is
 * the source of truth; legacy/pre-multi orders fall back to the singular
 * `mockupImageStorageId`. Returns [] when no mockup has been sent.
 */
function resolveMockupImageIds(order: Doc<"orders">): string[] {
	if (order.mockupImageStorageIds && order.mockupImageStorageIds.length > 0)
		return order.mockupImageStorageIds;
	return order.mockupImageStorageId ? [order.mockupImageStorageId] : [];
}

/**
 * Freeze a pickup location into the immutable `pickupSnapshot` shape stored on
 * an order. Used at the two write sites (orders.create + updatePickupLocation)
 * so the frozen shape — including the drop-off kind + schedule note — can never
 * drift between them. `locationType` defaults to "self_collect" so a row created
 * before drop-off existed freezes as self-collect (no blank kind downstream).
 */
type DeliverySnapshot = NonNullable<Doc<"orders">["deliverySnapshot"]>;

/**
 * Buyer-facing refusal copy per blocked-quote reason ("block" policies only —
 * "arrange" policies land pending instead). The weight-mode reasons keep the
 * store in the sentence: the buyer's next move is contacting the seller, not
 * fixing their own input.
 */
function blockedDeliveryMessage(
	reason: DeliveryQuoteReason,
	state: string | undefined,
): string {
	const messages: Record<DeliveryQuoteReason, string> = {
		no_coords:
			"Pick your address from the suggestions so we can calculate the delivery fee",
		unquotable:
			"We couldn't price delivery to that address right now — please try again",
		out_of_range: "That address is outside this store's delivery area",
		no_state: "Add a delivery address so we can calculate the delivery fee",
		unserved_state: state
			? `This store doesn't deliver to ${state}`
			: "This store doesn't deliver to that state",
		over_bands:
			"This order is heavier than the store's delivery rates — contact the store on WhatsApp to arrange it",
		missing_weights:
			"The store can't price delivery for this order yet — contact them on WhatsApp to arrange it",
		custom_item:
			"This order includes a custom item, so the store confirms its delivery fee directly — contact them on WhatsApp",
	};
	return messages[reason];
}

/**
 * Resolve the delivery charge for a delivery order against the retailer's
 * config and freeze it into snapshot form. Shared by `create` and the buyer's
 * address re-price so both spell the outcome identically:
 *  - fee → a frozen `deliverySnapshot` (mirrored to `deliveryFee`);
 *  - free → nothing stored (0 is never stored — one spelling of free);
 *  - "arrange" out-of-range / coord-less / unquotable / unserved / overweight /
 *    unweighable → `pending: true` + the frozen `pendingReason` (drives the
 *    seller card's explanation — a Lalamove store must never read "outside
 *    your delivery bands"; the seller confirms the charge later via
 *    setDeliveryFee, payment ask held);
 *  - "block" → ConvexError, mirroring the storefront's disabled submit.
 */
export function resolveDeliveryForOrder(
	retailer: Doc<"retailers">,
	subtotal: number,
	address:
		| { latitude?: number; longitude?: number; state?: string }
		| undefined,
	// Cart parcel-weight summary (pricing mode "weight" only) — from
	// summarizeCartWeight over the order's resolved variants.
	cartWeight?: CartWeightSummary,
	// Live Lalamove quote loaded from its server-side deliveryQuotes row
	// (pricing mode "lalamove" only) — see loadCheckoutDeliveryQuote.
	liveQuote?: LiveProviderQuote,
): {
	snapshot: DeliverySnapshot | undefined;
	pending: boolean;
	pendingReason?: DeliveryQuoteReason;
} {
	const config = retailer.deliveryConfig as DeliveryConfig | undefined;
	// Country/mode mismatch (SG-lite belt-and-braces — updateSettings refuses
	// storing this): resolving would either throw a nonsense state error or
	// silently strand the order fee-pending, so refuse with the same
	// seller-side framing the checkout preview shows for this store.
	if (
		config &&
		!deliveryModeAllowed(retailer.country ?? DEFAULT_COUNTRY, config.mode)
	) {
		throw new ConvexError(
			"Delivery pricing isn't working for this store right now — it's on the store's side. Message them on WhatsApp to sort it out.",
		);
	}
	if (config?.mode === "radius" && !retailer.businessAddress) {
		// Shouldn't happen (updateSettings refuses radius without an address) —
		// fail open to free delivery rather than blocking the storefront.
		console.warn(
			`[orders] retailer ${retailer._id} has radius deliveryConfig but no businessAddress — treating delivery as free`,
		);
	}
	const quote = resolveDeliveryQuote({
		config,
		subtotal,
		origin: retailer.businessAddress,
		destination:
			address?.latitude !== undefined && address.longitude !== undefined
				? { latitude: address.latitude, longitude: address.longitude }
				: undefined,
		state: address?.state,
		cartWeight,
		liveQuote,
	});
	if (quote.kind === "blocked") {
		throw new ConvexError(blockedDeliveryMessage(quote.reason, address?.state));
	}
	if (quote.kind === "pending") {
		return { snapshot: undefined, pending: true, pendingReason: quote.reason };
	}
	if (quote.kind === "fee") {
		return {
			snapshot: {
				fee: quote.fee,
				mode: quote.mode,
				distanceKm: quote.distanceKm,
				bandMaxKm: quote.bandMaxKm,
				zoneName: quote.zoneName,
				chargeableKg: quote.chargeableKg,
				bandMaxKg: quote.bandMaxKg,
				quotationId: quote.quotationId,
				vehicleType: quote.vehicleType,
				quotedAt: quote.quotedAt,
			},
			pending: false,
		};
	}
	return { snapshot: undefined, pending: false };
}

/**
 * Load + validate the checkout's live Lalamove quote (86eyb5hrf). The client
 * only ever passes the deliveryQuotes ROW ID — the fee comes from our own
 * record, so it can't be tampered with. Returns undefined (→ the order falls
 * back to the store's onUnquotable policy, usually deliveryFeePending) when
 * the row is missing/foreign/stale or was priced for different coordinates
 * (a cheap-nearby-pin quote can't be replayed against a far delivery
 * address; ~11 m tolerance absorbs float noise, not geography).
 */
export async function loadCheckoutDeliveryQuote(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
	quoteId: Id<"deliveryQuotes"> | undefined,
	address: { latitude?: number; longitude?: number } | undefined,
): Promise<LiveProviderQuote | undefined> {
	if (!quoteId) return undefined;
	const row = await ctx.db.get(quoteId);
	if (!row || row.retailerId !== retailerId) return undefined;
	if (Date.now() - row.quotedAt > CHECKOUT_QUOTE_MAX_AGE_MS) return undefined;
	const COORD_TOLERANCE = 1e-4; // ≈11 m
	if (
		address?.latitude === undefined ||
		address.longitude === undefined ||
		Math.abs(address.latitude - row.latitude) > COORD_TOLERANCE ||
		Math.abs(address.longitude - row.longitude) > COORD_TOLERANCE
	) {
		return undefined;
	}
	// Consume the row — a quote freezes onto at most one order.
	await ctx.db.delete(row._id);
	return {
		fee: row.fee,
		quotationId: row.quotationId,
		vehicleType: row.vehicleType,
		quotedAt: row.quotedAt,
	};
}

export function buildPickupSnapshot(
	location: Doc<"pickupLocations">,
): PickupSnapshot {
	return {
		label: location.label,
		address: location.address,
		locationType: location.locationType ?? "self_collect",
		scheduleNote: location.scheduleNote,
		mapsUrl: location.mapsUrl,
		notes: location.notes,
		latitude: location.latitude,
		longitude: location.longitude,
		placeId: location.placeId,
		// Freeze the fee the buyer agreed to. Writes normalize 0 → undefined
		// (see pickupLocations.sanitizeFee); the guard here keeps any stray 0
		// from freezing so "free" is always `undefined` downstream.
		fee: location.fee && location.fee > 0 ? location.fee : undefined,
	};
}

const statusValidator = v.union(
	v.literal("pending"),
	v.literal("confirmed"),
	v.literal("packed"),
	v.literal("shipped"),
	v.literal("delivered"),
	v.literal("cancelled"),
);

const transitionStatusValidator = v.union(
	v.literal("confirmed"),
	v.literal("packed"),
	v.literal("shipped"),
	v.literal("delivered"),
	v.literal("cancelled"),
);

type OrderItemSnapshot = {
	productId: Id<"products">;
	variantId: Id<"productVariants">;
	name: string;
	variantLabel?: string;
	price: number;
	quantity: number;
};

/**
 * Look up an order by its high-entropy tracking token — the capability for the
 * buyer's no-auth tracking page + public buyer mutations. Replaces the old
 * shortId-as-capability (shortId is ~1M combinations, enumerable). See
 * docs/infra-cost-scaling.md §6.
 */
export async function orderByToken(
	ctx: QueryCtx | MutationCtx,
	trackingToken: string,
): Promise<Doc<"orders"> | null> {
	// Defence in depth for placeholder-polluted links (86eyheqzv): the server
	// entry 301s `/track/{{1}}<token>` before the router, but any polluted
	// token that reaches a query directly still resolves. Tokens never contain
	// braces, so stripping is unambiguous.
	const token = normalizeTrackingToken(trackingToken);
	if (token.length === 0) return null;
	return ctx.db
		.query("orders")
		.withIndex("by_tracking_token", (q) => q.eq("trackingToken", token))
		.first();
}

/**
 * Resolve an order for an endpoint shared by the buyer tracking page and the
 * authenticated seller dashboard. Two distinct trust models:
 *   - `token` → the buyer's unguessable capability; no auth required.
 *   - `shortId` → NOT a secret (short, human-facing), so it is only honoured for
 *     an authenticated retailer who OWNS the order. This closes both the buyer
 *     enumeration hole and the prior seller-side gap where any signed-in user
 *     could read any order by shortId.
 * Exactly one of the two must be supplied.
 */
// Exported for the Lalamove dispatch surfaces (convex/lalamove.ts), which
// authenticate the seller by shortId through the same owner-or-admin seam.
export async function resolveSharedOrder(
	ctx: QueryCtx,
	{ token, shortId }: { token?: string; shortId?: string },
): Promise<Doc<"orders"> | null> {
	if (token) return orderByToken(ctx, token);
	if (shortId) {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new ConvexError("Not authenticated");
		const order = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		if (!order) return null;
		const retailer = await ctx.db.get(order.retailerId);
		// Owner OR a Kedaipal admin operating this store (act-as). Same rule the
		// dashboard queries/mutations use — see convex/lib/auth.ts.
		if (
			!retailer ||
			(retailer.userId !== identity.subject &&
				!adminUserIds().includes(identity.subject))
		)
			throw new ConvexError("Forbidden");
		return order;
	}
	throw new ConvexError("Provide a tracking token or order ref");
}

/**
 * Return an order's tracking token, generating + persisting one if it's missing
 * (a pre-migration order that never went through `create`). Idempotent. Called by
 * the WhatsApp notify actions so an outbound tracking link is NEVER built from a
 * missing token (which would ship a dead `/track/` URL) — correctness no longer
 * depends on the bulk `backfillTrackingTokens` migration having run first; that's
 * now just an optimization. Returns null only if the order vanished.
 */
export const ensureTrackingToken = internalMutation({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }): Promise<string | null> => {
		const order = await ctx.db.get(orderId);
		if (!order) return null;
		if (order.trackingToken) return order.trackingToken;
		const token = generateTrackingToken();
		await ctx.db.patch(orderId, { trackingToken: token, updatedAt: Date.now() });
		return token;
	},
});

/**
 * Send-site stamp for the storefront confirmation push (86eyf1rck): "sent"
 * (with Meta's wamid, when echoed) or "failed" (the send itself errored).
 * Drives the tracking page's state card and the seller-side delivery note.
 */
/**
 * One-shot: release every order still stamped `deferred` (86eyd63r8).
 *
 * `deferred` was the 86eyfq0w5 state for an order whose total wasn't final —
 * its confirmation waited for a price-settling mutation to claim it. Orders now
 * push at create with the price named as words, so nothing produces `deferred`
 * any more and nothing claims it either; without this, any row already in that
 * state at deploy time would sit there forever and its buyer would never get
 * their one message.
 *
 * MUST RUN ON EVERY DEPLOYMENT that had the deferred path live:
 *
 *   npx convex run orders:releaseDeferredPushes
 *
 * Idempotent, and self-converging: every row it touches leaves the `deferred`
 * state, so re-running picks up the next batch. `done: false` in the result
 * means run it again. Batched rather than `.collect()`ed because `orders` is the
 * largest table in the database and a full collect can breach Convex's
 * per-query read limit on a busy deployment.
 *
 * Cancelled orders have their stamp cleared instead of released — the promise
 * died with the order. A missing buyer number needs no special case here; the
 * send action's own guard covers it.
 */
const DEFERRED_RELEASE_BATCH = 200;

export const releaseDeferredPushes = internalMutation({
	args: {},
	handler: async (
		ctx,
	): Promise<{ released: number; skipped: number; done: boolean }> => {
		const deferred = await ctx.db
			.query("orders")
			.filter((q) => q.eq(q.field("confirmationPushStatus"), "deferred"))
			.take(DEFERRED_RELEASE_BATCH);
		let released = 0;
		let skipped = 0;
		for (const order of deferred) {
			if (order.status === "cancelled") {
				// Same reasoning as applyStatusTransition's cancel branch: a deferred
				// stamp is a promise about a message, and there's no order to promise
				// about. Clear it rather than leave the buyer's page claiming one is
				// on the way.
				await ctx.db.patch(order._id, {
					confirmationPushStatus: undefined,
					updatedAt: Date.now(),
				});
				skipped++;
				continue;
			}
			await ctx.db.patch(order._id, {
				confirmationPushStatus: "sending",
				updatedAt: Date.now(),
			});
			await ctx.scheduler.runAfter(
				0,
				internal.whatsapp.notifyStorefrontOrderCreated,
				{ orderId: order._id },
			);
			released++;
		}
		const done = deferred.length < DEFERRED_RELEASE_BATCH;
		console.log("[orders] deferred-push release", { released, skipped, done });
		return { released, skipped, done };
	},
});

export const recordConfirmationPush = internalMutation({
	args: {
		orderId: v.id("orders"),
		status: v.union(v.literal("sent"), v.literal("failed")),
		wamid: v.optional(v.string()),
		// Required in practice for "failed" — drives whether the buyer is asked
		// to fix their number or merely told we're having trouble.
		failureKind: v.optional(
			v.union(v.literal("unreachable"), v.literal("system")),
		),
	},
	handler: async (
		ctx,
		{ orderId, status, wamid, failureKind },
	): Promise<void> => {
		const order = await ctx.db.get(orderId);
		if (!order) return;
		// The buyer may have reached us by another route while attempts were in
		// flight (manual send / corrected number) — never overwrite that.
		if (order.confirmationPushStatus === "recovered") return;
		await ctx.db.patch(orderId, {
			confirmationPushStatus: status,
			confirmationPushFailureKind: status === "failed" ? failureKind : undefined,
			confirmationPushAt: Date.now(),
			confirmationPushWamid: wamid,
			updatedAt: Date.now(),
		});
	},
});

/**
 * Webhook-side stamp: Meta's `statuses` webhook reported `failed` for an
 * outbound message. Statuses arrive for EVERY message the shared number sends,
 * so this is a cheap indexed probe — no matching order (not a confirmation
 * push) is the common case and a silent no-op. Only a push still believed
 * "sent" flips to "failed": "recovered" must never regress on a late/replayed
 * webhook event.
 */
export const markConfirmationPushFailed = internalMutation({
	args: {
		wamid: v.string(),
		errorDetail: v.optional(v.string()),
	},
	handler: async (ctx, { wamid, errorDetail }): Promise<void> => {
		const order = await ctx.db
			.query("orders")
			.withIndex("by_confirmation_wamid", (q) =>
				q.eq("confirmationPushWamid", wamid),
			)
			.first();
		if (!order || order.confirmationPushStatus !== "sent") return;
		console.warn("WA confirmation push failed for order", {
			shortId: order.shortId,
			errorDetail,
		});
		await ctx.db.patch(order._id, {
			confirmationPushStatus: "failed",
			// Meta accepted the send then failed to DELIVER it — that's the number,
			// not us, so the buyer gets the repair affordance.
			confirmationPushFailureKind: "unreachable",
			updatedAt: Date.now(),
		});
	},
});

/**
 * Buyer repairs the WhatsApp number on their own order after the confirmation
 * push failed to reach it (86eyf1rck).
 *
 * This is the direct fix for the only failure this feature can't self-heal: a
 * typo'd number. Without it the buyer's only route is to send us a wa.me
 * message so the inbound path can infer their real number — a workaround for a
 * missing edit control. Authorized by the tracking token exactly like
 * `updateDeliveryAddress`, and deliberately scoped to `failed` pushes: there is
 * no reason to rewrite the number on a healthy order, and keeping the window
 * that narrow means a leaked token can't quietly redirect a seller's
 * order messages.
 *
 * On success the order moves to the new number (carrying its CRM aggregates via
 * the shared `moveOrderToPhone`) and the push is re-scheduled from attempt 1,
 * so the buyer gets their confirmation without doing anything else.
 */
export const updateBuyerPhone = mutation({
	args: { token: v.string(), waPhone: v.string() },
	handler: async (ctx, { token, waPhone }): Promise<void> => {
		// Each accepted save costs an outbound template send.
		await rateLimiter.limit(ctx, "buyerPhoneUpdate", {
			key: token,
			throws: true,
		});

		const order = await orderByToken(ctx, token);
		if (!order) throw new ConvexError("Order not found");
		if (order.confirmationPushStatus !== "failed") {
			throw new ConvexError(
				"This order's WhatsApp number can't be changed right now",
			);
		}

		// The repair field wears the same country plate as the checkout field it
		// fixes — judge the new number by the STORE's country (SG-lite).
		const orderRetailer = await ctx.db.get(order.retailerId);
		let normalized: string;
		try {
			normalized = assertValidMobileForCountry(
				waPhone,
				orderRetailer?.country ?? DEFAULT_COUNTRY,
			);
		} catch (err) {
			throw new ConvexError((err as Error).message);
		}
		if (normalized === order.customer.waPhone) {
			throw new ConvexError(
				"That's the same number we already tried — check the digits and try again",
			);
		}

		await moveOrderToPhone(ctx, { order, newPhone: normalized });
		// Back to "sending" so the buyer sees the attempt in flight rather than a
		// stale failure, and a late webhook for the OLD message can't re-fail it
		// (markConfirmationPushFailed only acts on a push still believed "sent").
		await ctx.db.patch(order._id, {
			confirmationPushStatus: "sending",
			confirmationPushFailureKind: undefined,
			confirmationPushWamid: undefined,
			updatedAt: Date.now(),
		});
		await ctx.scheduler.runAfter(
			0,
			internal.whatsapp.notifyStorefrontOrderCreated,
			{ orderId: order._id },
		);
	},
});

export const create = mutation({
	args: {
		retailerId: v.id("retailers"),
		items: v.array(
			v.object({
				// Orders reference the sellable variant. `variantId` is preferred
				// (the storefront cart always sends it). `productId` is accepted as
				// a convenience for single-variant products — it resolves to that
				// product's sole variant; ambiguous for multi-variant products and
				// rejected. Eases the flat→variant migration window. The parent
				// product is resolved server-side for name/currency/active + stock.
				variantId: v.optional(v.id("productVariants")),
				productId: v.optional(v.id("products")),
				quantity: v.number(),
			}),
		),
		currency: v.string(),
		channel: v.union(v.literal("whatsapp")),
		customer: v.object({
			name: v.optional(v.string()),
			waPhone: v.optional(v.string()),
		}),
		deliveryMethod: v.optional(
			v.union(v.literal("delivery"), v.literal("self_collect")),
		),
		deliveryAddress: v.optional(addressValidator),
		pickupLocationId: v.optional(v.id("pickupLocations")),
		// When the buyer needs the order — epoch-ms of a MYT-midnight calendar day.
		// Optional at the protocol level so legacy/other callers + tests don't all
		// need to pass it; the storefront UI requires it. Validated against the
		// retailer's notice window when present. See convex/lib/fulfilmentDate.ts.
		fulfilmentDate: v.optional(v.number()),
		// What time on that day (minutes since MYT midnight) — captured for
		// delivery orders; ignored on self-collect (their moment is governed by
		// the pickup point's own schedule). See the schema comment.
		fulfilmentTimeMinutes: v.optional(v.number()),
		// Optional free-text instruction the shopper typed at checkout.
		customerNote: v.optional(v.string()),
		// Optional reference image the buyer attached for a custom line, uploaded
		// pre-order via generateCustomImageUploadUrl. Stored as-is (a stray/invalid
		// id just resolves to no URL on display — same posture as proof images).
		customerImageStorageId: v.optional(v.string()),
		// Live Lalamove quote row minted by lalamove.quoteForCheckout (pricing
		// mode "lalamove" only). Only the ROW ID crosses the client — the fee is
		// read from our own record. Missing/stale/mismatched → the order falls
		// back to the store's onUnquotable policy. See docs/delivery-lalamove.md.
		deliveryQuoteId: v.optional(v.id("deliveryQuotes")),
		// Marketing source the buyer arrived from (86eyq0eq9) — the session's
		// captured `?src=`/`utm_source` tag. Client sends its cleaned copy but
		// the server re-sanitizes (authoritative); a bad value can never block
		// the order — it buckets to "other". See convex/lib/attribution.ts.
		attributionSource: v.optional(v.string()),
	},
	handler: async (
		ctx,
		args,
	): Promise<{
		shortId: string;
		trackingToken: string;
		// Server-resolved delivery charge, echoed back so the client builds the
		// wa.me message from the STORED numbers (never its preview quote).
		deliveryFee?: number;
		deliveryFeePending?: boolean;
		// True when the order was committed as `confirmed` at create and the WABA
		// confirmation push was scheduled (86eyf1rck) — checkout then navigates to
		// the tracking page WITHOUT ?send=1 (no wa.me handoff needed). False/absent
		// = the legacy buyer-sends-first flow (phone missing or template env unset).
		confirmedAtCreate?: boolean;
	}> => {
		// Rate limit FIRST — public endpoint, throttle per storefront before any
		// DB reads. Two limits on one key: the burst bucket shapes a live drop,
		// the daily ceiling bounds total confirmation-push spend (each order
		// schedules a Meta-billed template send that bypasses WABA gating — see
		// lib/rateLimiter.ts for the full cost model).
		await rateLimiter.limit(ctx, "orderCreate", {
			key: args.retailerId,
			throws: true,
		});
		await rateLimiter.limit(ctx, "orderCreateDaily", {
			key: args.retailerId,
			throws: true,
		});

		// Address invariant: required for delivery, forbidden for self_collect.
		const effectiveDeliveryMethod = args.deliveryMethod ?? "delivery";
		if (effectiveDeliveryMethod === "delivery" && !args.deliveryAddress) {
			throw new ConvexError(
				"Delivery address is required for delivery orders",
			);
		}
		if (effectiveDeliveryMethod === "self_collect" && args.deliveryAddress) {
			throw new ConvexError(
				"Self-collect orders should not include an address",
			);
		}
		// Pickup invariant mirror: pickupLocationId is only meaningful for
		// self_collect. Reject it on delivery orders so a stale client form can't
		// poison the order doc.
		if (
			effectiveDeliveryMethod === "delivery" &&
			args.pickupLocationId !== undefined
		) {
			throw new ConvexError(
				"Delivery orders should not include a pickup location",
			);
		}
		// Loaded before the address + phone checks below — the store's country
		// picks the address shape AND which validator arm judges the buyer's
		// number (SG-lite, 86eynw28q + 86eynw29u).
		const retailer = await ctx.db.get(args.retailerId);
		if (!retailer) throw new ConvexError("Retailer not found");
		const retailerCountry = retailer.country ?? DEFAULT_COUNTRY;

		// Address shape follows the STORE's country — SG stores take 6-digit
		// postal codes with "Singapore" as the state; MY keeps the 5-digit +
		// MY_STATES shape.
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


		// Customer waPhone: the storefront form requires it (86eyf1rck — the
		// confirmation push needs a reachable number), but it stays optional at
		// the protocol level so legacy callers/tests keep working; a phone-less
		// order simply rides the old buyer-sends-first wa.me flow, where the
		// WhatsApp webhook stamps the number on the inbound message.
		// Country-aware normalization (assertValidMobileForCountry, keyed off
		// the STORE's country): buyers type local numbers ("012-345 6789" /
		// "9123 4567"), and the stored form must match what Meta delivers
		// inbound (60… / 65…) or the customer record would fork.
		let customerWaPhone: string | undefined;
		if (args.customer.waPhone) {
			try {
				customerWaPhone = assertValidMobileForCountry(
					args.customer.waPhone,
					retailerCountry,
				);
			} catch (err) {
				throw new ConvexError((err as Error).message);
			}
		}
		// Name is required at checkout (≥3 chars) — enforced server-side here, not
		// just in the storefront form, so a direct mutation call can't create a
		// nameless/1-char order. Same rule + shared validator as the counter paths.
		const sanitizedCustomer = {
			name: requireCustomerName(args.customer.name),
			waPhone: customerWaPhone,
		};

		// Order note: trim, treat whitespace-only as absent, hard-cap length
		// (defense-in-depth — the client also caps + counts). Stored as plain text;
		// read-side views escape it (React default), so no markdown/HTML injection.
		const trimmedNote = args.customerNote?.trim();
		if (trimmedNote && trimmedNote.length > MAX_CUSTOMER_NOTE)
			throw new ConvexError(
				`Note must be ${MAX_CUSTOMER_NOTE} characters or fewer`,
			);
		const sanitizedCustomerNote =
			trimmedNote && trimmedNote.length > 0 ? trimmedNote : undefined;

		// Fulfilment date is validated AFTER the item loop below — the effective
		// notice window is max(store setting, every item's per-product override),
		// and the overrides only become known once items resolve.
		let sanitizedFulfilmentDate: number | undefined;

		// Delivery must be on offer. Mirrors the storefront gate (which hides the
		// delivery option when offerDelivery is off) and closes the gap where a
		// stale storefront tab could still POST a delivery order after the seller
		// switched to pickup-only. Legacy retailers (offerDelivery unset) read as
		// effectively offering delivery, so they're unaffected.
		if (
			effectiveDeliveryMethod === "delivery" &&
			(retailer.offerDelivery ?? true) === false
		) {
			throw new ConvexError("This store isn't offering delivery right now");
		}

		// Self-collect pickup resolution. The storefront only surfaces self-collect
		// when (offerSelfCollect && ≥1 active location), so the strict branch fires
		// whenever both gates are open server-side; when either is closed we
		// preserve the original behaviour (no pickup info on the order).
		let sanitizedPickupSnapshot: PickupSnapshot | undefined;
		let resolvedPickupLocationId: Id<"pickupLocations"> | undefined;
		if (effectiveDeliveryMethod === "self_collect" && retailer.offerSelfCollect === true) {
			const activeCount = await ctx.db
				.query("pickupLocations")
				.withIndex("by_retailer_active", (q) =>
					q.eq("retailerId", args.retailerId).eq("isActive", true),
				)
				.first();
			if (activeCount !== null) {
				if (!args.pickupLocationId) {
					throw new ConvexError(
						"Pick a pickup location to continue with self-collect",
					);
				}
				const location = await ctx.db.get(args.pickupLocationId);
				if (!location || location.retailerId !== args.retailerId) {
					throw new ConvexError("Pickup location not found");
				}
				if (!location.isActive) {
					throw new ConvexError("That pickup location is no longer available");
				}
				resolvedPickupLocationId = location._id;
				sanitizedPickupSnapshot = buildPickupSnapshot(location);
			}
		}

		if (args.items.length === 0)
			throw new ConvexError("Order must have at least one item");
		if (args.items.length > MAX_ITEMS_PER_ORDER)
			throw new ConvexError(`Maximum ${MAX_ITEMS_PER_ORDER} items per order`);

		const snapshotItems: OrderItemSnapshot[] = [];
		// Sum requested quantities per variant so a single order with two line
		// items pointing at the same variant is validated and decremented once.
		// Tracks whether the parent product hard-blocks on stock (drives whether
		// we enforce + decrement onHand vs treat as made-to-order/unlimited).
		const requestedByVariant = new Map<
			Id<"productVariants">,
			{ qty: number; block: boolean; onHand: number }
		>();
		// Whole-order mockup gating: set if ANY line's product requires a proof.
		let requiresMockup = false;
		// Strictest per-product notice override across the cart (0 = none).
		let maxItemNoticeDays = 0;
		// Minimum-order-rule inputs (86ey9unyx), collected alongside the snapshot:
		// per-line product id/name/qty + the flags the shared rules need. Checked
		// after the loop (the rules judge summed quantities + the subtotal).
		const ruleItems: MinRuleItem[] = [];
		// Parcel-weight inputs (86eyeea1n, pricing mode "weight") — collected from
		// the same resolved variants so the fee weighs exactly what was ordered.
		const weightItems: CartWeightItem[] = [];
		for (const item of args.items) {
			if (!Number.isInteger(item.quantity) || item.quantity < 1)
				throw new ConvexError("Quantity must be a positive integer");

			// Resolve the sellable variant from variantId (preferred) or a
			// single-variant product's productId (migration convenience).
			let variant: Doc<"productVariants"> | null;
			if (item.variantId) {
				variant = await ctx.db.get(item.variantId);
				if (!variant) throw new ConvexError(`Variant ${item.variantId} not found`);
			} else if (item.productId) {
				const variants = await ctx.db
					.query("productVariants")
					.withIndex("by_product", (q) => q.eq("productId", item.productId!))
					.collect();
				if (variants.length === 0)
					throw new ConvexError("Product has no variants");
				if (variants.length > 1)
					throw new ConvexError(
						"This product has multiple variants — specify which one",
					);
				variant = variants[0];
			} else {
				throw new ConvexError("Each item needs a variantId or productId");
			}
			if (variant.retailerId !== args.retailerId)
				throw new ConvexError("Variant does not belong to this retailer");
			const product = await ctx.db.get(variant.productId);
			if (!product) throw new ConvexError("Product not found");
			// Per-variant flags fall back to the (deprecated) product-level defaults
			// so legacy variants behave unchanged. Lets a mixed product gate only its
			// made-to-order "Custom" variant, not the fixed sizes.
			const variantRequiresProof = variant.requiresProof ?? product.requiresProof;
			if (variantRequiresProof === true) requiresMockup = true;
			// Per-product fulfilment-notice override — the strictest item rules.
			if ((product.minNoticeDays ?? 0) > maxItemNoticeDays) {
				maxItemNoticeDays = product.minNoticeDays ?? 0;
			}
			const variantId = variant._id;
			// The custom line has no optionValues — label it with its custom name so
			// the order, WhatsApp confirm, and seller dashboard show "… (Custom)"
			// rather than an unlabelled row indistinguishable from the default.
			const label = variant.isCustom
				? (variant.customLabel ?? "Custom")
				: variantLabel(variant.optionValues);
			const displayName = label ? `${product.name} (${label})` : product.name;
			if (!product.active || !variant.active)
				throw new ConvexError(`"${displayName}" is not available`);
			if (product.currency !== args.currency)
				throw new ConvexError(
					`Currency mismatch: order is ${args.currency} but "${displayName}" is ${product.currency}`,
				);
			const block = (variant.blockWhenOutOfStock ?? product.blockWhenOutOfStock) === true;
			const prior = requestedByVariant.get(variantId);
			const newRequested = (prior?.qty ?? 0) + item.quantity;
			// Stock is only enforced for hard-block products. Made-to-order
			// products (frozen pack-to-order, metal prints) never block — keeps
			// the "nothing gets missed" promise intact.
			if (block && variant.onHand < newRequested)
				throw new ConvexError(`Only ${variant.onHand} of "${displayName}" in stock`);
			requestedByVariant.set(variantId, {
				qty: newRequested,
				block,
				onHand: variant.onHand,
			});
			snapshotItems.push({
				productId: variant.productId,
				variantId,
				name: product.name,
				variantLabel: label || undefined,
				price: variant.price,
				quantity: item.quantity,
			});
			ruleItems.push({
				productId: variant.productId,
				name: product.name,
				quantity: item.quantity,
				minQuantity: product.minQuantity,
				isCustom: variant.isCustom,
				quoteOnRequest: variantRequiresProof === true && variant.price === 0,
			});
			weightItems.push({
				parcelWeightG: variant.parcelWeightG,
				quantity: item.quantity,
				isCustom: variant.isCustom === true,
			});
		}

		const itemSubtotal = snapshotItems.reduce(
			(sum, i) => sum + i.price * i.quantity,
			0,
		);

		// Minimum order rules (86ey9unyx) — the authoritative gate; the storefront
		// mirrors both checks pre-submit via the same shared module, so a buyer
		// only ever hits these from a stale tab or a direct call. Counter checkout
		// deliberately does NOT run them (the seller is standing there).
		const qtyShortfalls = collectMinQuantityShortfalls(ruleItems);
		if (qtyShortfalls.length > 0) {
			throw new ConvexError(minQuantityMessage(qtyShortfalls[0]));
		}
		const valueShortfall = minOrderValueShortfall(
			retailer.minOrderValue,
			itemSubtotal,
			ruleItems,
		);
		if (valueShortfall > 0) {
			throw new ConvexError(
				`Minimum order of ${args.currency} ${((retailer.minOrderValue ?? 0) / 100).toFixed(2)} — add ${args.currency} ${(valueShortfall / 100).toFixed(2)} more to check out`,
			);
		}

		// Fulfilment date: validated against the EFFECTIVE notice window — the
		// store-level setting raised by any cart item's per-product override
		// (custom cakes need lead time; ready stock doesn't). Applies to BOTH
		// delivery and self-collect. Counter checkout doesn't run this path.
		if (args.fulfilmentDate !== undefined) {
			try {
				sanitizedFulfilmentDate = assertValidFulfilmentDate(
					args.fulfilmentDate,
					Math.max(
						retailer.minFulfilmentNoticeDays ?? 0,
						maxItemNoticeDays,
					),
				);
			} catch (err) {
				throw new ConvexError((err as Error).message);
			}
		}
		// Fulfilment time (86eyg0n8e follow-up): kept only where it means
		// something — a delivery order WITH a date. Range-only validation by
		// design (see assertValidFulfilmentTime): "is the moment still ahead"
		// is judged at checkout client-side and again at dispatch, where a past
		// moment simply books "now" — a strict server check here would let
		// clock skew or a long-idle form reject a legitimate checkout.
		let sanitizedFulfilmentTime: number | undefined;
		if (
			args.fulfilmentTimeMinutes !== undefined &&
			sanitizedFulfilmentDate !== undefined &&
			effectiveDeliveryMethod === "delivery"
		) {
			try {
				sanitizedFulfilmentTime = assertValidFulfilmentTime(
					args.fulfilmentTimeMinutes,
				);
			} catch (err) {
				throw new ConvexError((err as Error).message);
			}
		}
		// Store opening hours (86eyp5rav): the fulfilment moment must fall inside
		// them — a closed day rejects for BOTH methods, the time window applies
		// only where a time exists (delivery; pickup is date-only, its point's
		// schedule note carries the detail). The storefront mirrors this check
		// pre-submit via the same shared function, so a buyer only hits it from
		// a stale tab or a direct call. Counter checkout doesn't run this path
		// (the seller is standing there — the min-notice posture). Unset hours
		// = open 24/7, the check no-ops.
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

		// Delivery charge (86extzdr8): resolved server-side at create — the
		// authoritative price, whatever the client previewed. Needs the item
		// subtotal (flat free-above threshold), so it runs after the item loop.
		let deliverySnapshot: DeliverySnapshot | undefined;
		let deliveryFeePending = false;
		let deliveryFeePendingReason: DeliveryQuoteReason | undefined;
		if (effectiveDeliveryMethod === "delivery") {
			// itemSubtotal is hoisted above (shared with the min-order rules).
			const liveQuote = await loadCheckoutDeliveryQuote(
				ctx,
				retailer._id,
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
		// Frozen trip direction (86eyg0n8e): stamped from the store's live
		// collection-service setting so buyer surfaces (tracking labels, WA
		// confirm) stay true to what this order promised even if the seller
		// toggles the mode later — the pickupSnapshot posture. Standard stays
		// unset (one spelling for the default; every pre-existing order).
		const deliveryDirection =
			effectiveDeliveryMethod === "delivery" &&
			retailer.deliveryBooking?.deliveryDirection === "collection"
				? ("collection" as const)
				: undefined;

		// The chosen pickup point's frozen fee and the delivery charge ride the
		// same extras seam as the mockup quote — total = subtotal + fees from the
		// very first insert.
		const { subtotal, total } = computeOrderTotals(snapshotItems, {
			pickupFee: sanitizedPickupSnapshot?.fee,
			deliveryFee: deliverySnapshot?.fee,
		});
		const now = Date.now();

		// Reserve stock for hard-block variants, in the same transaction (atomic;
		// rolls back on any failure). Convex mutations are OCC transactions — both
		// the validation read above and this write see one consistent snapshot, and
		// a conflicting concurrent write retries the whole mutation. So the on-hand
		// read during validation is still authoritative; no re-read is needed.
		for (const [variantId, { qty, block, onHand }] of requestedByVariant) {
			if (!block) continue;
			await ctx.db.patch(variantId, {
				onHand: onHand - qty,
				updatedAt: now,
			});
		}

		// Collision-safe shortId generation.
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

		// Unguessable capability for the no-auth tracking page. 142 bits of entropy
		// → a collision check would be theatre; just generate it.
		const trackingToken = generateTrackingToken();

		// Confirmation-push path (86eyf1rck): with a reachable buyer number AND
		// the approved template configured, the order is COMMITTED the moment the
		// buyer taps "Place order" — inserted as `confirmed`, activation stamped,
		// and Kedaipal's WABA pushes the confirmation template (scheduled below).
		// No step depends on the buyer surviving Meta's wa.me interstitial.
		// Template env unset ⇒ exact legacy behaviour (pending + ?send=1 handoff).
		//
		// EVERY order pushes at create, whether or not its total is final
		// (86eyd63r8, superseding the 86eyfq0w5 deferral). A price-on-quote line
		// is RM 0.00 until quoted and a fee-pending total grows by the arranged
		// fee, so the message can't always carry a number — but the fix for that
		// is to SAY so in the money parameter (PENDING_TOTAL_LABEL), not to
		// withhold the message. Deferring it meant a made-to-order buyer left
		// checkout with no confirmation and no link to the order page they
		// approve their mockup on, sometimes for days; and it bought nothing,
		// since the price still isn't final when they read it.
		const confirmedAtCreate =
			customerWaPhone !== undefined &&
			orderConfirmTemplateName() !== undefined;

		const orderId = await ctx.db.insert("orders", {
			retailerId: args.retailerId,
			shortId,
			trackingToken,
			items: snapshotItems,
			subtotal,
			total,
			currency: args.currency,
			status: confirmedAtCreate ? "confirmed" : "pending",
			channel: args.channel,
			source: "storefront",
			attributionSource: sanitizeAttributionSource(args.attributionSource),
			customer: sanitizedCustomer,
			deliveryMethod: effectiveDeliveryMethod,
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
			// Only keep the buyer image when the order actually has a custom line —
			// guards a stray id on a non-custom order.
			customerImageStorageId: requiresMockup
				? args.customerImageStorageId
				: undefined,
			mockupStatus: requiresMockup ? "pending" : undefined,
			// Stamped in the SAME transaction as the insert so the push state is
			// never ambiguous: a confirmed storefront order with no stamp would be
			// indistinguishable from one whose send is still in flight, and the
			// tracking page needs to tell the buyer which it is.
			confirmationPushStatus: confirmedAtCreate ? "sending" : undefined,
			statusChangedAt: now,
			createdAt: now,
			updatedAt: now,
		});

		await ctx.db.insert("orderEvents", {
			orderId,
			status: "pending",
			createdAt: now,
		});
		if (confirmedAtCreate) {
			// The timeline keeps both beats — placed, then confirmed — mirroring
			// what the legacy inbound-confirm path produced.
			await ctx.db.insert("orderEvents", {
				orderId,
				status: "confirmed",
				note: "Confirmed at checkout",
				createdAt: now,
			});
			// First order reaching confirmed activates the store (one-time stamp) —
			// the same milestone confirmOrderFromWhatsApp stamps on the legacy path.
			await stampRetailerActivation(ctx, args.retailerId, now);
		}

		// Meter the order against the retailer's monthly usage (SOFT cap — the
		// nudge banner, never a block on this public mutation).
		await recordOrderCreated(ctx, args.retailerId, now);

		// Mark every product on this order as having sold, so it can no longer be
		// permanently deleted out from under the order lines that now reference it.
		await stampProductsOrdered(ctx, snapshotItems, now);

		// Link to the aggregated customer record when we already know the phone.
		// Phone-less orders (link-in-bio checkout) are linked later when the
		// shopper messages the WhatsApp number — see confirmOrderFromWhatsApp.
		if (sanitizedCustomer.waPhone) {
			await linkOrderToCustomer(ctx, {
				retailerId: args.retailerId,
				waPhone: sanitizedCustomer.waPhone,
				orderId,
				orderTotal: total,
				orderCreatedAt: now,
				customerName: sanitizedCustomer.name,
			});
		}

		// Fire-and-forget email alert to the retailer about the new order.
		await ctx.scheduler.runAfter(
			0,
			internal.email.notifyRetailerOrderAlert,
			{ orderId },
		);

		// Seller WhatsApp order alert (86eyhw9zy) — storefront orders only, so
		// counter checkout (its own create path) never schedules one. The action
		// itself checks the opt-in toggle + template env and no-ops otherwise.
		await ctx.scheduler.runAfter(
			0,
			internal.whatsapp.notifySellerNewOrder,
			{ orderId },
		);

		// The buyer's WhatsApp confirmation — the ONE outbound message this order
		// sends (Meta bills per message from Oct 2026). Fire-and-forget like the
		// email; a send failure stamps confirmationPushStatus, never fails create.
		// Unconditional: a held price rides in the message as words, not as a
		// reason to hold the message back.
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

/**
 * Counts for the retailer's dashboard chrome.
 *
 * `newOrders` is what the nav badge renders: the same "New" definition the
 * inbox chip and the Home tile use (`orderBucket` → "new") — `pending` plus a
 * confirmation-push order the seller hasn't opened yet. It's a NOTIFICATION
 * count, so working through the orders drives it to zero; `pending + confirmed`
 * (what the badge used to show) counts orders the seller is actively working
 * and therefore only ever climbs. See docs/order-inbox.md.
 *
 * `pending`/`confirmed` stay on the payload as raw status counts — the order
 * toasts (src/hooks/useOrderToastNotifications.ts) announce on their deltas.
 */
export const countActionable = query({
	args: { retailerId: v.id("retailers") },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{
		newOrders: number;
		pending: number;
		confirmed: number;
		mockupPending: number;
	}> => {
		await requireRetailerAccess(ctx, retailerId);

		const [pendingRows, confirmedRows, mockupRows] = await Promise.all([
			ctx.db
				.query("orders")
				.withIndex("by_retailer_status", (q) =>
					q.eq("retailerId", retailerId).eq("status", "pending"),
				)
				.collect(),
			ctx.db
				.query("orders")
				.withIndex("by_retailer_status", (q) =>
					q.eq("retailerId", retailerId).eq("status", "confirmed"),
				)
				.collect(),
			// Seller-actionable mockup states ("changes_requested" + "pending") are
			// adjacent on the by_retailer_mockup index, so one contiguous range
			// catches exactly them — "approved"/"submitted"/undefined fall outside.
			// Mirrors the (..pending) range used by listByRetailer's mockup filter.
			ctx.db
				.query("orders")
				.withIndex("by_retailer_mockup", (q) =>
					q
						.eq("retailerId", retailerId)
						.gte("mockupStatus", "changes_requested")
						.lte("mockupStatus", "pending"),
				)
				.collect(),
		]);

		return {
			// Unseen push-path orders are a subset of `confirmedRows`, already in
			// memory — no extra read to add the badge's count.
			newOrders: pendingRows.length + confirmedRows.filter(isUnseenOrder).length,
			pending: pendingRows.length,
			confirmed: confirmedRows.length,
			mockupPending: mockupRows.length,
		};
	},
});

// The order plus the slice of the owning retailer needed to resolve buyer-facing
// status labels (tracking timeline + the seller's order-detail view). The order
// already carries `deliveryMethod`; we fold in the retailer's `statusLabels` +
// `locale` so the client resolver (src/lib/orderStatus.ts) has everything to
// render relabelled stages. See docs/order-status-customization.md.
export type OrderWithStatusLabels = Doc<"orders"> & {
	statusLabels?: StatusLabels;
	// Phase 2: the retailer's configured stages (undefined => buyer/seller
	// resolve the synthesized defaults from statusLabels). Drives the tracking
	// timeline + the seller's dynamic advance buttons.
	orderStages?: OrderStage[];
	retailerLocale: Locale;
	// Store country (SG-lite), resolved (undefined rows read as "MY"). The track
	// page keys the buyer phone-repair plate/validator arm and the address-edit
	// dialog's variant off it — this payload is that page's ONLY retailer read,
	// so the by-slug field alone can't reach it.
	retailerCountry: Country;
	// Store name + the vendor's own WhatsApp number, for the buyer "Message the
	// store" CTA on the tracking page (buyers otherwise only ever hear from the
	// shared Kedaipal WABA). `retailerWaPhone` undefined => the CTA is hidden.
	storeName: string;
	retailerWaPhone?: string;
	// The shared Kedaipal checkout number (same resolution as the storefront's
	// getRetailerBySlug), included ONLY while the order is still `pending`: it
	// powers the tracking page's "Send order on WhatsApp" handoff CTA — the
	// buyer-gesture replacement for the popup-blocked checkout `window.open`.
	// Undefined once the order is confirmed (or when no number is configured),
	// which also hides the CTA reactively the moment the bot confirms.
	checkoutPhone?: string;
	// Rider drop-off photos (Lalamove proof of delivery) — resolved only on
	// delivered delivery orders; the buyer sees the same shot the WhatsApp
	// follow-up carried, the seller the same thumbnails as the dispatch card.
	podImageUrls?: string[];
	// Live collection-rider strip (86eyg0n8e) — present only while a rider is
	// ACTIVELY collecting from the buyer on a collection order; the tracking
	// page renders it as a transient card, never a status. Driver phone, cost
	// and provider ids deliberately never cross.
	collectionRider?: {
		status: "assigning" | "ongoing" | "picked_up";
		driverName?: string;
		plateNumber?: string;
		shareLink?: string;
	};
};

export const get = query({
	// Buyer tracking page passes `token` (unguessable capability). Seller
	// dashboard passes `shortId` (authenticated + ownership-checked). See
	// resolveSharedOrder.
	args: {
		shortId: v.optional(v.string()),
		token: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ shortId, token },
	): Promise<OrderWithStatusLabels | null> => {
		const order = await resolveSharedOrder(ctx, { token, shortId });
		if (!order) return null;
		// One extra doc read on this hot public path so labels resolve from live
		// retailer config (relabelling is retroactive — no per-order snapshot).
		const retailer = await ctx.db.get(order.retailerId);
		// Anti-trilateration: the delivery snapshot's radius audit fields
		// (distanceKm ~10 m precision, bandMaxKm) are SELLER-ONLY — the public
		// `delivery.quote` strips them for the same reason. The buyer reaches this
		// query with a `token` (no auth), so on that path drop the whole snapshot:
		// the buyer UI only reads the `deliveryFee`/`deliveryFeePending` mirrors,
		// never the snapshot, so nothing legitimate depends on exposing it. The
		// authenticated seller/admin (`shortId`) path keeps the full snapshot for
		// the order-detail "— 7.4 km" audit line. See convex/delivery.ts.
		const isBuyerRead = token !== undefined;
		// Rider drop-off photo (Lalamove POD) — one indexed read, and only on
		// the delivered end-state of delivery orders, so the hot pending/active
		// tracking path pays nothing. Collection orders (86eyg0n8e) never
		// surface it here: their POD shows the rider dropping the buyer's gear
		// at the SELLER's doorstep — captioning that "taken by your rider at
		// drop-off" once the seller manually marks the order delivered would
		// read as nonsense to the buyer. The seller still sees it on the
		// dispatch card (getDeliveryJob).
		let podImageUrls: string[] | undefined;
		if (
			order.status === "delivered" &&
			order.deliveryMethod === "delivery" &&
			order.deliveryDirection !== "collection"
		) {
			const jobs = await ctx.db
				.query("deliveryJobs")
				.withIndex("by_order", (q) => q.eq("orderId", order._id))
				.collect();
			const withPod = jobs.find(
				(j) => j.status === "completed" && j.podImageStorageIds?.length,
			);
			if (withPod?.podImageStorageIds) {
				const urls = await Promise.all(
					withPod.podImageStorageIds.map((id) => ctx.storage.getUrl(id)),
				);
				const resolved = urls.filter((u): u is string => u !== null);
				if (resolved.length > 0) podImageUrls = resolved;
			}
		}
		// Live collection-rider strip (86eyg0n8e): while a rider is actively
		// collecting FROM this buyer, the tracking page shows the trip live —
		// the buyer's only window into "who is knocking and when", since
		// collection orders never mirror a tracking URL and never auto-advance.
		// Read from the live job row so it can't go stale (the whole reason the
		// mirror was skipped); one indexed read, collection orders only, and the
		// strip vanishes the moment the job leaves its active states. Exposes
		// trip state + driver name/plate + Lalamove's buyer-facing share page —
		// never the driver's phone, cost or provider ids.
		let collectionRider:
			| {
					status: "assigning" | "ongoing" | "picked_up";
					driverName?: string;
					plateNumber?: string;
					shareLink?: string;
			  }
			| undefined;
		if (
			order.deliveryMethod === "delivery" &&
			order.deliveryDirection === "collection" &&
			order.status !== "cancelled"
		) {
			const jobs = await ctx.db
				.query("deliveryJobs")
				.withIndex("by_order", (q) => q.eq("orderId", order._id))
				.collect();
			// The ACTIVE row, never .first() — failed attempts keep their rows.
			const active = jobs.find((j) => isActiveJobStatus(j.status));
			if (
				active &&
				(active.status === "assigning" ||
					active.status === "ongoing" ||
					active.status === "picked_up")
			) {
				collectionRider = {
					status: active.status,
					driverName: active.driver?.name,
					plateNumber: active.driver?.plateNumber || undefined,
					shareLink: active.shareLink,
				};
			}
		}
		return {
			...order,
			podImageUrls,
			collectionRider,
			deliverySnapshot: isBuyerRead ? undefined : order.deliverySnapshot,
			// Meta's message id has no buyer use and this read is unauthenticated —
			// strip it on the token path alongside the delivery snapshot. The
			// buyer-facing cards branch on `confirmationPushStatus`, never the wamid.
			confirmationPushWamid: isBuyerRead
				? undefined
				: order.confirmationPushWamid,
			statusLabels: retailer?.statusLabels as StatusLabels | undefined,
			orderStages: retailer?.orderStages as OrderStage[] | undefined,
			retailerLocale: (retailer?.locale ?? "en") as Locale,
			retailerCountry: retailer?.country ?? DEFAULT_COUNTRY,
			storeName: retailer?.storeName ?? "",
			retailerWaPhone: retailer?.waPhone,
			// Served while the order still needs (or benefits from) a path into the
			// shared-number chat: pending = the legacy manual/auto Send card; a
			// confirmation-push order keeps it for the "Open WhatsApp" anchor
			// ("sent") and the manual-send recovery card ("failed"). The cards
			// themselves gate on status + confirmationPushStatus.
			checkoutPhone:
				order.status === "pending" ||
				order.confirmationPushStatus !== undefined
					? (process.env.WHATSAPP_CHECKOUT_PHONE ?? retailer?.waPhone)
					: undefined,
		};
	},
});

// --- Order receipt PDF (UC A) ----------------------------------------------
// Buyer-facing receipt, generated ON DEMAND (not stored): it's deterministic
// from the order, so there's no value in persisting a blob that may never be
// downloaded. Authorized through the same resolveSharedOrder seam as `get` —
// the buyer reaches it with the tracking token, the seller with an owned
// shortId. See docs/invoices-receipts.md.

/** Assemble the receipt view-model inside the transaction (auth runs here via
 * resolveSharedOrder, so the action stays a thin render wrapper). */
export const receiptPdfInputs = internalQuery({
	args: { shortId: v.optional(v.string()), token: v.optional(v.string()) },
	handler: async (
		ctx,
		{ shortId, token },
	): Promise<{ data: OrderReceiptData; shortId: string } | null> => {
		const order = await resolveSharedOrder(ctx, { token, shortId });
		if (!order) return null;
		const retailer = await ctx.db.get(order.retailerId);
		return {
			shortId: order.shortId,
			data: orderToReceiptData({
				order,
				storeName: retailer?.storeName ?? "",
				paymentMethods: retailer ? resolvePaymentMethods(retailer) : [],
			}),
		};
	},
});

/**
 * Render an order receipt and return the PDF bytes (+ filename) for a client
 * download. Public action: the buyer passes `token`, the seller passes `shortId`
 * — authorization is enforced by receiptPdfInputs (resolveSharedOrder). Returns
 * null only when the order can't be found.
 */
export const generateReceiptPdf = action({
	args: { shortId: v.optional(v.string()), token: v.optional(v.string()) },
	handler: async (
		ctx,
		{ shortId, token },
	): Promise<{ pdf: ArrayBuffer; filename: string } | null> => {
		const inputs = await ctx.runQuery(internal.orders.receiptPdfInputs, {
			shortId,
			token,
		});
		if (!inputs) return null;
		const bytes = await buildOrderReceiptPdf(inputs.data);
		// Copy into a standalone ArrayBuffer so Convex serializes the exact bytes.
		const pdf = bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength,
		) as ArrayBuffer;
		// An unpaid order is an invoice, a settled one a receipt (see buildOrderReceiptPdf).
		const prefix = inputs.data.paid ? "Receipt" : "Invoice";
		return { pdf, filename: `${prefix}-${inputs.shortId}.pdf` };
	},
});

/**
 * Auth + eligibility + atomic cooldown stamp for a manual payment reminder, in
 * one mutation so two fast taps can't both slip past the 24h gate (compare on
 * the freshly-read `lastManualReminderAt`, then patch). Owner OR admin act-as
 * via resolveSharedOrder — the same seam the receipt PDF uses; throws
 * ConvexError on not-authenticated / forbidden. Returns the block reason (no
 * stamp) when the order isn't in a remindable state, else stamps and hands back
 * the orderId for the send.
 *
 * The window rules (day 11–14, 24h cooldown — 86eyd63r8 revision) live in the
 * pure `manualReminderEligibility`, shared verbatim with the dashboard button,
 * so the disabled-with-reason UI and this lock can never disagree.
 * See docs/payment-reminder.md.
 */
export const prepareManualReminder = internalMutation({
	args: { shortId: v.string() },
	handler: async (
		ctx,
		{ shortId },
	): Promise<
		| { ok: true; orderId: Id<"orders"> }
		| { ok: false; reason: ManualReminderBlock | "not_found" }
	> => {
		const order = await resolveSharedOrder(ctx, { shortId });
		if (!order) return { ok: false, reason: "not_found" };
		const eligibility = manualReminderEligibility(
			{
				status: order.status,
				paymentStatus: order.paymentStatus,
				mockupStatus: order.mockupStatus,
				mockupWaivedAt: order.mockupWaivedAt,
				deliveryFeePending: order.deliveryFeePending,
				lastManualReminderAt: order.lastManualReminderAt,
				createdAt: order.createdAt,
				customer: { waPhone: order.customer.waPhone },
			},
			Date.now(),
		);
		if (!eligibility.ok) return { ok: false, reason: eligibility.reason };
		const now = Date.now();
		await ctx.db.patch(order._id, {
			lastManualReminderAt: now,
			updatedAt: now,
		});
		return { ok: true, orderId: order._id };
	},
});

/**
 * Seller-triggered "Send payment reminder" — the one deliberate exception to
 * one-message-per-order (86eyd63r8): each send is a human tap, not an
 * automation, and the window is boxed to days 11–14 of the open-payment window
 * at most once per 24h (so an order can ever receive at most 4). Re-sends the
 * buyer the full payment message (amount + transfer ref + "Make payment" CTA
 * to their order page). Auth + eligibility + the cooldown stamp happen
 * atomically in prepareManualReminder; the actual send is best-effort through
 * the WABA `session_message` gateway (kill switch / caps / opt-outs apply, and
 * may silently not deliver outside Meta's 24h service window — the button's
 * helper says so). A blocked reason is returned WITHOUT sending, so the button
 * can explain why. See docs/payment-reminder.md.
 */
export const sendPaymentReminder = action({
	args: { shortId: v.string() },
	handler: async (
		ctx,
		{ shortId },
	): Promise<{ ok: boolean; reason?: ManualReminderBlock | "not_found" }> => {
		const prep = await ctx.runMutation(internal.orders.prepareManualReminder, {
			shortId,
		});
		if (!prep.ok) return { ok: false, reason: prep.reason };
		await ctx.runAction(internal.whatsapp.notifyManualPaymentReminder, {
			orderId: prep.orderId,
		});
		return { ok: true };
	},
});

/**
 * Public: resolve the seller's payment methods for the buyer's tracking page,
 * keyed by the tracking token (the capability). This page is the ONLY place a
 * buyer sees bank details — they left WhatsApp in 86ey98ju1, and the order's one
 * message (86eyd63r8) carries the tracking link, not the numbers. Legacy-aware
 * via `resolvePaymentMethods`; QR storage ids resolved to URLs. Returns `null`
 * when the seller has nothing configured (track page hides it).
 */
export const getPaymentMethods = query({
	args: { token: v.string() },
	handler: async (
		ctx,
		{ token },
	): Promise<{
		methods: Array<PaymentMethod & { qrImageUrl?: string }>;
		// Whether THIS order can be paid through the seller's HitPay checkout
		// right now (86eyb6z3a) — connection on + credentials stored + payment
		// still open + both price holds clear + total within HitPay's floor.
		// Server-side truth for the buyer's "Pay now" button; createCheckout
		// re-checks everything, so this is presentation, not authorization.
		gatewayAvailable: boolean;
		// The ACCOUNT's enabled rails (probed truth, see schema) so the Pay-now
		// explainer names only methods this seller actually offers. Undefined =
		// not yet probed → the page uses a generic "bank or eWallet" line.
		gatewayMethods?: string[];
	} | null> => {
		const order = await orderByToken(ctx, token);
		if (!order) return null;
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) return null;

		const gatewayAvailable =
			hitpayCheckoutConfigured(retailer.hitpay) &&
			order.status !== "cancelled" &&
			(order.paymentStatus ?? "unpaid") === "unpaid" &&
			!isMockupGateClosed(order) &&
			order.deliveryFeePending !== true &&
			order.total >= HITPAY_MIN_AMOUNT_SEN;

		const methods = resolvePaymentMethods(retailer);
		if (methods.length === 0 && !gatewayAvailable) return null;

		const resolved: Array<PaymentMethod & { qrImageUrl?: string }> = [];
		for (const m of methods) {
			let qrImageUrl: string | undefined;
			if (m.type === "qr" && m.qrImageStorageId) {
				const url = await ctx.storage.getUrl(m.qrImageStorageId);
				qrImageUrl = url ?? undefined;
			}
			resolved.push({ ...m, qrImageUrl });
		}
		return {
			methods: resolved,
			gatewayAvailable,
			gatewayMethods: gatewayAvailable
				? retailer.hitpay?.paymentMethods
				: undefined,
		};
	},
});

/**
 * Resolve the payment-proof storage ID into a viewable URL for the dashboard.
 * Auth-gated (Clerk) — only the owning retailer can see the screenshot. Public
 * shoppers must not be able to fish proof images for arbitrary shortIds, so
 * this is intentionally separate from the public `get` query.
 */
export const getPaymentProofUrl = query({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }): Promise<string | null> => {
		const order = await ctx.db.get(orderId);
		if (!order) return null;
		// Owner OR Kedaipal admin acting-as; throws Forbidden for anyone else.
		await requireRetailerAccess(ctx, order.retailerId);

		if (!order.paymentProofStorageId) return null;
		return (await ctx.storage.getUrl(order.paymentProofStorageId)) ?? null;
	},
});

export const listByRetailer = query({
	args: {
		retailerId: v.id("retailers"),
		status: v.optional(statusValidator),
		// When true, return only orders awaiting the seller's mockup action
		// (mockupStatus "pending" or "changes_requested"), ignoring `status`.
		// Drives the "Mockup pending" filter pill on the orders page.
		mockupPending: v.optional(v.boolean()),
		paginationOpts: paginationOptsValidator,
	},
	handler: async (
		ctx,
		{ retailerId, status, mockupPending, paginationOpts },
	) => {
		await requireRetailerAccess(ctx, retailerId);

		if (mockupPending) {
			// "changes_requested" and "pending" are adjacent on the index (nothing
			// sorts between them), so a single contiguous range is exactly the
			// seller-actionable set — fully indexed + paginatable. Ordered desc by
			// index key: pending group (newest first), then changes_requested.
			return ctx.db
				.query("orders")
				.withIndex("by_retailer_mockup", (q) =>
					q
						.eq("retailerId", retailerId)
						.gte("mockupStatus", "changes_requested")
						.lte("mockupStatus", "pending"),
				)
				.order("desc")
				.paginate(paginationOpts);
		}

		if (status) {
			return ctx.db
				.query("orders")
				.withIndex("by_retailer_status", (q) =>
					q.eq("retailerId", retailerId).eq("status", status),
				)
				.order("desc")
				.paginate(paginationOpts);
		}
		return ctx.db
			.query("orders")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.order("desc")
			.paginate(paginationOpts);
	},
});

// Upper bound on how many of a retailer's orders the inbox scans per query.
// At the Phase-1 target (≤500 orders/retailer) this loads everything; beyond it,
// the oldest orders fall outside the scan (flagged via `capped`). Counts +
// filtering are in-memory over this set — see docs/order-inbox.md for why this
// beats indexed pagination + an Aggregate at this scale.
const MAX_INBOX_SCAN = 1000;

// Checkout-surface filter value, shared by the live inbox (`searchOrders`) and
// the CSV export so the two can't drift. Matches orders.source; legacy orders
// (no stamped source) read as "storefront" in the predicate.
const orderSourceValidator = v.union(
	v.literal("storefront"),
	v.literal("counter"),
	v.literal("claim"),
);

/**
 * Order inbox: one query that returns the filtered/searched page **plus** the
 * per-bucket counts (over the full set, independent of the active filters), in a
 * single subscription. Buckets are fulfilment-based; payment status + date are
 * orthogonal filters; search matches order #, customer name (partial, CI), and
 * phone (trailing digits). Owner-only.
 */
export const searchOrders = query({
	args: {
		retailerId: v.id("retailers"),
		bucket: v.union(
			v.literal("all"),
			v.literal("new"),
			v.literal("in_progress"),
			v.literal("completed"),
			v.literal("cancelled"),
		),
		paymentStatuses: v.optional(
			v.array(
				v.union(
					v.literal("unpaid"),
					v.literal("claimed"),
					v.literal("received"),
				),
			),
		),
		// Filter by how the order was settled (see lib/paymentMethod.ts). ANDs with
		// the other filters. `paymentMethods` matches concrete methods;
		// `methodUnspecified` matches orders with NO recorded method (online /
		// WA-self-claim / legacy). Supplying both ORs them (e.g. "DuitNow OR
		// unspecified"). Neither supplied = no method filtering.
		paymentMethods: v.optional(v.array(orderPaymentMethodValidator)),
		methodUnspecified: v.optional(v.boolean()),
		dateFrom: v.optional(v.number()),
		dateTo: v.optional(v.number()),
		// Fulfilment-date chip filter (Today / Tomorrow / This week). Matches on the
		// order's fulfilmentDate (MYT calendar day); dateless orders never match.
		// ANDs with the other filters. Distinct from dateFrom/dateTo, which filter
		// on createdAt. See convex/lib/fulfilmentDate.ts.
		fulfilmentWindow: v.optional(
			v.union(
				v.literal("today"),
				v.literal("tomorrow"),
				v.literal("this_week"),
			),
		),
		// Cross-cutting: only orders awaiting the seller's mockup action
		// (mockupStatus pending / changes_requested). ANDs with the other filters.
		mockupPending: v.optional(v.boolean()),
		// Checkout surface: "storefront" (online) vs "counter" (walk-in). Legacy
		// orders read as "storefront". ANDs with the other filters.
		source: v.optional(orderSourceValidator),
		// Marketing origin (86eyq0eq9): `attributionBucket` keys — a stamped
		// `?src=` tag, "counter", or "direct". Multi-select ORs within itself and
		// ANDs with the rest. Free-form by design (sellers invent their own
		// tags), so this is v.string() rather than a literal union; the picker is
		// driven by `availableSources` below. Distinct dimension from `source`.
		attributionSources: v.optional(v.array(v.string())),
		searchText: v.optional(v.string()),
		// Pin privilege (86eyrtz74): keep PINNED orders in the result even when
		// they fail the filters above. On by default in the UI — the seller pins
		// an order so they can filter to something else and still compare against
		// it. Not a plan-gated inbox feature (see the gate below): pinning is
		// all-tier, so its visibility rule has to be too.
		showPinned: v.optional(v.boolean()),
		// Max rows to return. OMIT it for the inbox: the query then returns the
		// whole filtered+sorted window (up to MAX_INBOX_SCAN) as a *stable*
		// subscription, and the client paginates by slicing that window — so
		// "Load more" never re-scans (see docs/order-inbox.md). Callers that only
		// need the counts (e.g. the Home strip) pass `limit: 1` to stay cheap.
		limit: v.optional(v.number()),
	},
	handler: async (
		ctx,
		{
			retailerId,
			bucket,
			paymentStatuses,
			paymentMethods,
			methodUnspecified,
			dateFrom,
			dateTo,
			fulfilmentWindow,
			mockupPending,
			source,
			attributionSources,
			searchText,
			showPinned,
			limit,
		},
	) => {
		const access = await requireRetailerAccess(ctx, retailerId);

		// Order Inbox plan gate (Pro+). The PLAIN list — default bucket, no
		// filters, no search — stays available to every tier (that's the all-tier
		// "Order pipeline" pricing row); only the inbox surfaces (buckets,
		// filters, search) require the feature. Admin act-as bypasses, same as
		// the soft-lock. The Starter UI hides these controls; this is the
		// defense-in-depth backstop.
		const usesInboxFeatures =
			bucket !== "all" ||
			paymentStatuses !== undefined ||
			paymentMethods !== undefined ||
			methodUnspecified !== undefined ||
			dateFrom !== undefined ||
			dateTo !== undefined ||
			fulfilmentWindow !== undefined ||
			mockupPending !== undefined ||
			source !== undefined ||
			attributionSources !== undefined ||
			(searchText !== undefined && searchText.trim().length > 0);
		if (usesInboxFeatures && !access.actingAsAdmin)
			await assertPlanFeature(ctx, retailerId, "orderInbox");

		const all = await ctx.db
			.query("orders")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.order("desc")
			.take(MAX_INBOX_SCAN);

		// Bucket counts (+ cross-cutting counts: mockup-pending, due-today, unpaid)
		// over the full set — independent of the active filters/search so the chips,
		// the due-today banner, and the Home "today strip" always show true totals.
		const now = Date.now();
		const counts = {
			new: 0,
			in_progress: 0,
			completed: 0,
			cancelled: 0,
			mockupPending: 0,
			/** Open (new / in-progress) orders whose fulfilment date is today (MYT). */
			dueToday: 0,
			/** Open orders not yet paid or awaiting payment review. */
			unpaid: 0,
			/** Sum of `total` across those unpaid open orders (RM outstanding). */
			unpaidAmount: 0,
			/**
			 * Packed + paid parcel orders waiting to go out (86eyp63mp) — the
			 * one-click "print all despatch labels" queue. Computed here, over the
			 * FULL set like every other count, precisely so the control's number is
			 * the store's real backlog and doesn't move when the seller filters the
			 * inbox. See convex/lib/pdf/awb.ts `isReadyToShipForLabel`.
			 */
			readyToShip: 0,
			/**
			 * Orders the seller has pinned (86eyrtz74). Counted over the FULL set
			 * like every other count, so the Pinned chip states the real total and
			 * doesn't shrink as the seller filters — the chip is the only standing
			 * reminder that a pin set exists at all, given pins never auto-clear.
			 */
			pinned: 0,
		};
		// Which marketing origins actually appear in this seller's window
		// (86eyq0eq9). Tallied over the FULL scan like `counts` — never over the
		// filtered set — so picking one source can't make the others vanish from
		// the picker. Free-form tags mean the filter UI cannot hardcode a list;
		// this is that list, and it costs nothing (we already hold every row).
		const sourceTally = new Map<string, number>();

		for (const o of all) {
			const b = orderBucket(o);
			counts[b]++;
			const asrc = attributionBucket(o);
			sourceTally.set(asrc, (sourceTally.get(asrc) ?? 0) + 1);
			if (needsMockup(o.mockupStatus)) counts.mockupPending++;
			const open = b === "new" || b === "in_progress";
			// Counter orders default their date to today at create — they're not a
			// promised-by date, so they must never inflate the "due today" nudge
			// (they'd swamp it at counter-heavy stores). See ClickUp 86ey8r734.
			if (
				open &&
				o.source !== "counter" &&
				o.fulfilmentDate !== undefined &&
				matchesFulfilmentWindow(o.fulfilmentDate, "today", now)
			) {
				counts.dueToday++;
			}
			if (open && (o.paymentStatus ?? "unpaid") !== "received") {
				counts.unpaid++;
				counts.unpaidAmount += o.total;
			}
			if (isReadyToShipForLabel(o)) counts.readyToShip++;
			if (o.pinnedAt !== undefined) counts.pinned++;
		}

		// Filter + sort via the shared inbox predicate, so the export honours the
		// exact same rules (see lib/orderInboxFilter.ts).
		const filtered = all.filter(
			buildInboxPredicate({
				bucket,
				paymentStatuses,
				paymentMethods,
				methodUnspecified,
				dateFrom,
				dateTo,
				fulfilmentWindow,
				mockupPending,
				source,
				attributionSources,
				searchText,
				showPinned,
			}),
		);
		// Pinned first, then newest-created (the scan order) — the inbox's default
		// "Newest first" sort. The inbox applies its "Due date" toggle client-side
		// over this stable window (the same `sortInboxOrders`), so toggling never
		// re-queries; the non-pinned tail keeps its createdAt-desc order, which is
		// what that client-side `due` sort uses as its tiebreaker.
		// See docs/order-inbox.md ("Sort"). Export sorts independently.
		//
		// Partitioning HERE and not only on the client is what makes `limit`
		// safe: a counts-only caller trims the payload, and a pin must never be
		// the row that gets trimmed away.
		const sorted = sortInboxOrders(filtered, "recent");

		// No `limit` → return the full window (the inbox slices client-side, so
		// its subscription args stay stable across "Load more"). A supplied limit
		// (Home's counts-only `limit: 1`) still trims the payload. Either way the
		// hard ceiling is the scan window, never the old silent 200-row cap.
		const take = Math.max(1, Math.min(limit ?? MAX_INBOX_SCAN, MAX_INBOX_SCAN));
		return {
			orders: sorted.slice(0, take),
			total: sorted.length,
			counts,
			// Most-used origin first — the picker mirrors the Insights ordering.
			// Ties break ALPHABETICALLY, not by scan order: equal-count origins
			// would otherwise swap places every time a new order lands, and a
			// filter list that reshuffles under the seller is worse than one in
			// a slightly arbitrary but stable order.
			availableSources: [...sourceTally.entries()]
				.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
				.map(([key]) => key),
			// True when the scan hit MAX_INBOX_SCAN: orders older than the newest
			// 1,000 are outside the window, so the list AND counts under-report.
			// The inbox surfaces this in a footer; export is the full-history path.
			capped: all.length >= MAX_INBOX_SCAN,
		};
	},
});

/**
 * Bulk export to CSV (bookkeeping). Two modes:
 *   - `orderIds` given → export exactly those owned orders (the seller's
 *     multi-selection), regardless of the active filter.
 *   - otherwise → export everything matching the same inbox filter as
 *     `searchOrders`, via the shared predicate so the export can't diverge from
 *     what's on screen.
 * Returns the CSV text + a row count; the client turns it into a download. See
 * docs/invoices-receipts.md.
 */
// Reusable validators for the inbox-filter args, shared by the export action and
// its internal page query so the two can't drift.
const exportFilterValidators = {
	bucket: v.union(
		v.literal("all"),
		v.literal("new"),
		v.literal("in_progress"),
		v.literal("completed"),
		v.literal("cancelled"),
	),
	paymentStatuses: v.optional(
		v.array(
			v.union(
				v.literal("unpaid"),
				v.literal("claimed"),
				v.literal("received"),
			),
		),
	),
	paymentMethods: v.optional(v.array(orderPaymentMethodValidator)),
	methodUnspecified: v.optional(v.boolean()),
	// Marketing origin (86eyq0eq9) — kept in lockstep with the inbox so a CSV
	// export of a filtered view contains exactly the rows the seller was
	// looking at (the invariant orderInboxFilter.ts exists to protect).
	attributionSources: v.optional(v.array(v.string())),
	dateFrom: v.optional(v.number()),
	dateTo: v.optional(v.number()),
	fulfilmentWindow: v.optional(
		v.union(
			v.literal("today"),
			v.literal("tomorrow"),
			v.literal("this_week"),
		),
	),
	mockupPending: v.optional(v.boolean()),
	source: v.optional(orderSourceValidator),
	searchText: v.optional(v.string()),
	// Pin privilege (86eyrtz74) — kept in the SHARED validator set so an export
	// of a filtered view contains exactly the rows the seller was looking at,
	// forced-in pins included. See InboxFilterArgs.showPinned.
	showPinned: v.optional(v.boolean()),
} as const;

// Bookkeeping exports paginate the FULL result set in bounded pages — they must
// not be limited to the inbox's reactive 1000-doc scan (that silently truncates
// financial records). EXPORT_SCAN_CAP bounds the worst case (a matching range
// that sits beyond this many of the newest orders), surfaced as a `capped` flag
// so the UI can warn rather than return silently-incomplete books. ~10 months at
// the Scale tier's 2,000 orders/month.
const EXPORT_PAGE_SIZE = 500;
const EXPORT_SCAN_CAP = 20_000;

/**
 * Project an order to the shape the column registry reads (drops the heavy and
 * the secret: storage ids, gateway/push plumbing, and above all `trackingToken`
 * — the capability for the buyer's no-auth tracking page, which must never
 * reach a spreadsheet). `categories` is filled in separately by the caller (see
 * `attachOrderCategories`) because it needs extra reads.
 */
function orderToCsvSource(o: Doc<"orders">): CsvOrder {
	return {
		shortId: o.shortId,
		createdAt: o.createdAt,
		fulfilmentDate: o.fulfilmentDate,
		fulfilmentTimeMinutes: o.fulfilmentTimeMinutes,
		status: o.status,
		paymentStatus: o.paymentStatus,
		paymentMethod: o.paymentMethod,
		paymentReference: o.paymentReference,
		paymentReceivedAt: o.paymentReceivedAt,
		deliveryMethod: o.deliveryMethod,
		deliveryDirection: o.deliveryDirection,
		source: o.source,
		attributionSource: o.attributionSource,
		customer: o.customer,
		items: o.items,
		subtotal: o.subtotal,
		mockupQuotedAmount: o.mockupQuotedAmount,
		pickupFee: o.pickupFee,
		deliveryFee: o.deliveryFee,
		deliveryFeePending: o.deliveryFeePending,
		total: o.total,
		currency: o.currency,
		customerNote: o.customerNote,
		deliveryAddress: o.deliveryAddress
			? {
					line1: o.deliveryAddress.line1,
					line2: o.deliveryAddress.line2,
					city: o.deliveryAddress.city,
					state: o.deliveryAddress.state,
					postcode: o.deliveryAddress.postcode,
					notes: o.deliveryAddress.notes,
				}
			: undefined,
		pickupSnapshot: o.pickupSnapshot
			? { label: o.pickupSnapshot.label, address: o.pickupSnapshot.address }
			: undefined,
		courierName: o.courierName,
		trackingNo: o.trackingNo,
		cancelledReason: o.cancelledReason,
		pinnedAt: o.pinnedAt,
	};
}

/**
 * Fill in `categories` for a page of export rows (86eyrtz74).
 *
 * Categories are a pure browse layer and are deliberately NEVER frozen onto an
 * order line (docs/product-categories.md), so this is a LIVE lookup — the
 * column is labelled "Categories (current)" for that reason.
 *
 * Batched by distinct `productId` across the whole page, with a memo shared
 * across pages by the caller: a 500-row page of a repeat-order store touches a
 * handful of products, and the naive per-line fan-out would be thousands of
 * index reads for the same answer. Category names are resolved once per
 * category id for the same reason.
 */
async function attachOrderCategories(
	ctx: QueryCtx,
	orders: Doc<"orders">[],
	rows: CsvOrder[],
	memo: Map<string, string[]>,
): Promise<void> {
	const unseen = new Set<Id<"products">>();
	for (const o of orders) {
		for (const it of o.items) if (!memo.has(it.productId)) unseen.add(it.productId);
	}
	for (const productId of unseen) {
		const joins = await ctx.db
			.query("productCategories")
			.withIndex("by_product", (q) => q.eq("productId", productId))
			.collect();
		const names: string[] = [];
		for (const j of joins) {
			const cat = await ctx.db.get(j.categoryId);
			// Archived categories still name a real grouping the seller used, so
			// they stay in the export — dropping them would blank the column for
			// a store mid-reorganisation.
			if (cat) names.push(cat.name);
		}
		memo.set(productId, names);
	}
	for (const [i, o] of orders.entries()) {
		const row = rows[i];
		if (!row) continue;
		// Deduped ACROSS lines: the column answers "what kinds of thing is this
		// order", not "what is each line" — a 12-line order of one category
		// should read "Kuih", not "Kuih, Kuih, Kuih…".
		const names = new Set<string>();
		for (const it of o.items) for (const n of memo.get(it.productId) ?? []) names.add(n);
		row.categories = [...names].sort((a, b) => a.localeCompare(b));
	}
}

async function assertExportAccess(
	ctx: QueryCtx,
	retailerId: Id<"retailers">,
): Promise<void> {
	// Owner OR Kedaipal admin acting-as (see convex/lib/auth.ts).
	const access = await requireRetailerAccess(ctx, retailerId);
	// CSV export is part of the Order Inbox surface (Pro+); admin act-as bypasses.
	if (!access.actingAsAdmin)
		await assertPlanFeature(ctx, retailerId, "orderInbox");
}

/**
 * Seller-side access to a single order: the caller must own the order's retailer
 * OR be a Kedaipal admin operating that store (act-as). Returns the order + the
 * access descriptor so mutations can attribute admin-on-behalf writes. Throws
 * "Order not found" / "Forbidden" to match the pre-existing inline checks.
 */
async function requireOrderAccess(
	ctx: QueryCtx | MutationCtx,
	orderId: Id<"orders">,
): Promise<{ order: Doc<"orders">; access: RetailerAccess }> {
	const order = await ctx.db.get(orderId);
	if (!order) throw new Error("Order not found");
	const access = await requireRetailerAccess(ctx, order.retailerId);
	return { order, access };
}

// Explicit alias so the action's `runQuery(exportPage)` result has a type that
// doesn't depend (circularly) on inferring this same file's exports.
type ExportPageResult = {
	rows: CsvOrder[];
	scanned: number;
	isDone: boolean;
	cursor: string | null;
};

/** One page of export rows: applies the inbox filter to a paginated slice of the
 * retailer's orders (newest first) and projects matches to CSV rows. Ownership-
 * checked on every page. Internal — driven by the `exportOrders` action. */
export const exportPage = internalQuery({
	args: {
		retailerId: v.id("retailers"),
		...exportFilterValidators,
		paginationOpts: paginationOptsValidator,
	},
	handler: async (
		ctx,
		{ retailerId, paginationOpts, ...filters },
	): Promise<ExportPageResult> => {
		await assertExportAccess(ctx, retailerId);
		const page = await ctx.db
			.query("orders")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.order("desc")
			.paginate(paginationOpts);
		const predicate = buildInboxPredicate(filters as InboxFilterArgs);
		const matched = page.page.filter(predicate);
		const rows = matched.map(orderToCsvSource);
		// Memo is per-page: each page is its own transaction, so it can't span
		// them. Within a 500-row page it still collapses a repeat-order store's
		// thousands of line lookups down to one read per distinct product.
		await attachOrderCategories(ctx, matched, rows, new Map());
		return {
			rows,
			scanned: page.page.length,
			isDone: page.isDone,
			cursor: page.continueCursor,
		};
	},
});

/** Export rows for an explicit selection of order ids (the ticked rows). Drops
 * anything not owned by this retailer (defends against a tampered id list). */
export const exportByIds = internalQuery({
	args: { retailerId: v.id("retailers"), orderIds: v.array(v.id("orders")) },
	handler: async (ctx, { retailerId, orderIds }): Promise<CsvOrder[]> => {
		await assertExportAccess(ctx, retailerId);
		const fetched = await Promise.all(orderIds.map((id) => ctx.db.get(id)));
		const owned = fetched.filter(
			(o): o is Doc<"orders"> => o?.retailerId === retailerId,
		);
		const rows = owned.map(orderToCsvSource);
		await attachOrderCategories(ctx, owned, rows, new Map());
		return rows;
	},
});

/**
 * Bulk export to CSV (bookkeeping). Two modes:
 *   - `orderIds` given → export exactly those owned orders (the seller's ticked
 *     selection), regardless of the active filter.
 *   - otherwise → export everything matching the same inbox filter as
 *     `searchOrders` (shared predicate), paginating the FULL result set so the
 *     export isn't capped at the inbox's reactive 1000-doc window.
 * Returns the CSV text, a row count, and `capped` (true iff the scan hit
 * EXPORT_SCAN_CAP before exhausting the matches — the UI warns the seller their
 * export may be incomplete). An action (not a query): a one-shot file generation,
 * not a reactive subscription. See docs/invoices-receipts.md.
 */
export const exportOrders = action({
	args: {
		retailerId: v.id("retailers"),
		...exportFilterValidators,
		// When set, export exactly these orders (the seller's ticked selection).
		orderIds: v.optional(v.array(v.id("orders"))),
		// Narrow the export to these columns — the table view's "export visible
		// columns" path (86eyrtz74). Plain strings, not a literal union, because
		// the keys are resolved leniently against the registry: a client running
		// an older build must never fail an export over a column that has since
		// been renamed. Omitted/empty = every column, which is what the cards
		// view (no column picker) and any older client send.
		columnKeys: v.optional(v.array(v.string())),
	},
	handler: async (
		ctx,
		{ retailerId, orderIds, columnKeys, ...filters },
	): Promise<{ csv: string; count: number; capped: boolean }> => {
		let rows: CsvOrder[];
		let capped = false;

		if (orderIds && orderIds.length > 0) {
			rows = await ctx.runQuery(internal.orders.exportByIds, {
				retailerId,
				orderIds,
			});
		} else {
			rows = [];
			let scanned = 0;
			let cursor: string | null = null;
			for (;;) {
				const page: ExportPageResult = await ctx.runQuery(
					internal.orders.exportPage,
					{
						retailerId,
						...filters,
						paginationOpts: { numItems: EXPORT_PAGE_SIZE, cursor },
					},
				);
				rows.push(...page.rows);
				scanned += page.scanned;
				cursor = page.cursor;
				if (page.isDone) break;
				if (scanned >= EXPORT_SCAN_CAP) {
					capped = true;
					break;
				}
			}
		}

		// Pinned first, then fulfilment date. The pinned-first PARTITION is shared
		// with the inbox (`sortInboxOrders` owns that rule for both surfaces, so a
		// pin can never be trimmed away by a `limit`), but the sort inside each
		// partition is deliberately fixed to "due" here rather than mirroring the
		// inbox's "recent" default: a bookkeeping file wants the fulfilment queue,
		// and the export has always sorted this way. The `Pinned` column keeps
		// those rows identifiable once the file is open in Excel.
		const sorted = sortInboxOrders(rows, "due");
		return {
			csv: ordersToCsv(sorted, columnKeys),
			count: sorted.length,
			capped,
		};
	},
});

type TransitionStatus =
	| "confirmed"
	| "packed"
	| "shipped"
	| "delivered"
	| "cancelled";

/**
 * Apply a canonical status transition to an ALREADY-AUTHORIZED order: restore
 * stock + reverse the customer's lifetime aggregates on the first move into
 * "cancelled", stamp `status` + `statusChangedAt`, append an `orderEvent`, and
 * schedule the WhatsApp notification. Shared by `updateStatus` (single) and
 * `bulkUpdateStatus` so neither can drift from the gate/stock semantics.
 *
 * The caller owns auth AND the mockup gate (single throws; bulk skips), so this
 * helper assumes the transition is permitted.
 */
/**
 * Undo an order's live-side effects: restore reserved stock, reverse the
 * customer's lifetime aggregates, and un-meter the order from its creation
 * month. This is the exact inverse of what `create` did, and is applied on the
 * FIRST move into "cancelled" AND on a hard delete of a still-live order.
 *
 * The caller owns the guard: this MUST run at most once per order (a cancelled
 * order has already had it applied, so re-running would double-count). Only
 * variants whose parent product hard-blocks were ever decremented at create, so
 * only those are restored; items without a variantId are legacy (pre-variant),
 * skipped.
 */
async function reverseCancellationEffects(
	ctx: MutationCtx,
	order: Doc<"orders">,
	now: number,
): Promise<void> {
	const restoreByVariant = new Map<Id<"productVariants">, number>();
	for (const item of order.items) {
		if (!item.variantId) continue;
		restoreByVariant.set(
			item.variantId,
			(restoreByVariant.get(item.variantId) ?? 0) + item.quantity,
		);
	}
	for (const [variantId, qty] of restoreByVariant) {
		const fresh = await ctx.db.get(variantId);
		if (!fresh) continue; // variant was deleted; nothing to restore
		const product = await ctx.db.get(fresh.productId);
		if (!product) continue;
		// Mirror the create-time decrement: a variant was only reserved when
		// its resolved flag hard-blocks (per-variant override ?? product default).
		const block = fresh.blockWhenOutOfStock ?? product.blockWhenOutOfStock;
		if (block !== true) continue; // made-to-order — never decremented
		await ctx.db.patch(variantId, { onHand: fresh.onHand + qty, updatedAt: now });
	}

	// Reverse this order's contribution to the customer's lifetime aggregates.
	if (order.customerId) {
		await decrementAggregatesForCancel(ctx, {
			customerId: order.customerId,
			orderTotal: order.total,
		});
	}

	// Un-meter the order from its creation month (runs regardless of customer
	// linkage — every created order was counted). See convex/subscriptionUsage.ts.
	await recordOrderCancelled(ctx, order.retailerId, order.createdAt);
}

/**
 * Whether a live Lalamove rider — not the seller — owns this advance.
 *
 * True only when the order has an ACTIVE job whose webhook has demonstrably
 * fired (`lastEventAt` set) AND the target anchor is one the webhook drives
 * (shipped at pickup, delivered at drop-off). Webhook-less sellers keep manual
 * control; that degraded path is documented in docs/delivery-lalamove.md.
 *
 * The damage this prevents is PERMANENT, not cosmetic: `applyStatusTransition`
 * WhatsApps the buyer immediately, and the webhook's own guards
 * (`SHIPPABLE_FROM` = confirmed|packed) skip the real pickup event once the
 * order already reads "shipped" — so an early manual advance means the buyer
 * gets a shipped notice with NO live-tracking link, and the rider's later
 * pickup can never heal it.
 *
 * Mirrors the client-side gate in app.orders.$shortId.tsx, which is a UX
 * affordance only — the inbox bulk bar reaches the same transitions with no
 * gate at all, so this is the authoritative one.
 */
async function riderOwnsTransition(
	ctx: MutationCtx,
	order: Doc<"orders">,
	targetAnchor: "confirmed" | "packed" | "shipped" | "delivered",
): Promise<boolean> {
	if (!isRiderManagedTransition(targetAnchor, order.status)) return false;
	// Collection orders (86eyg0n8e): the rider drives the FRONT of the flow —
	// the webhook moves the JOB only, and the order stays the seller's to
	// advance by hand throughout — so this gate would both lie ("it updates
	// itself" never comes true) and strand. Read from the ORDER's frozen
	// direction, never the store's live setting, mirroring the client: a mode
	// switch must not re-gate (or un-gate) in-flight orders.
	if (order.deliveryDirection === "collection") return false;
	// An order can hold SEVERAL job rows: a failed booking's released row is kept
	// on purpose (it doubles as the amber "failed" card) and `reserveBooking`
	// then lets the seller rebook, so a live rider is routinely NOT the oldest
	// row. `by_order` is indexed on orderId alone, so `.first()` would return the
	// oldest and fail open on exactly the rebooked orders most likely to reach
	// for the manual button. Pick the ACTIVE row, like every other by_order
	// reader (dispatchContextForOrder, reserveBooking, the cancel resolver).
	const jobs = await ctx.db
		.query("deliveryJobs")
		.withIndex("by_order", (q) => q.eq("orderId", order._id))
		.collect();
	// Gated from the moment of BOOKING, not from the first webhook event — the
	// same rule as the client (86eyg0n8e): requiring `lastEventAt` left the gate
	// off during exactly the window it matters most, between placing the booking
	// and the first event landing. The confirm-gated override is what protects
	// the webhook-less seller instead, and cancelling the booking lifts the gate
	// outright, so neither can be stranded.
	return jobs.some((j) => isActiveJobStatus(j.status));
}

/** Seller-facing message for a blocked manual advance. The order-detail
 * stepper offers an explicit "Update manually" confirm that overrides it. */
const RIDER_GATE_MESSAGE =
	"A Lalamove rider is on this order — with your Lalamove webhook set up, it updates itself when the rider picks up or drops off. Open the order and use “Update manually” to move it yourself.";

// Exported for the Lalamove webhook's auto-transitions (convex/lalamove.ts) —
// rider picked up → shipped, completed → delivered ride the SAME path as a
// seller tap, so WhatsApp notify, stage vocabulary, activation stamping and
// orderEvents all come free. The webhook side guards which source statuses
// are eligible; this helper stays transition-mechanics only.
export async function applyStatusTransition(
	ctx: MutationCtx,
	order: Doc<"orders">,
	status: TransitionStatus,
	opts: {
		note?: string;
		carrierTrackingUrl?: string;
		courierName?: string;
		trackingNo?: string;
	} = {},
): Promise<void> {
	const now = Date.now();

	// Restore stock + reverse aggregates/usage on the FIRST transition into
	// cancelled. Idempotent — re-cancelling a cancelled order is a no-op.
	if (status === "cancelled" && order.status !== "cancelled") {
		await reverseCancellationEffects(ctx, order, now);
	}

	const patch: Partial<{
		status: TransitionStatus;
		statusChangedAt: number;
		updatedAt: number;
		carrierTrackingUrl: string;
		courierName: string;
		trackingNo: string;
		currentStageId: string | undefined;
		confirmationPushStatus: undefined;
		paymentDueAt: undefined;
	}> = { status, statusChangedAt: now, updatedAt: now };
	// A payment deadline dies whenever the clock stops meaning anything — every
	// cancellation (seller, admin, or the auto-cancel sweep) AND every advance
	// past `confirmed`, because a seller who packs an unpaid order has decided
	// to fulfil it. Clearing on cancel alone (PR #227 review) stranded those
	// rows in the by_payment_due range forever: the 1-minute sweep re-read a
	// set that only grew, and the buyer's page threatened a cancellation the
	// server would never carry out. Keeps the schema's stated invariant true —
	// the index range only ever holds live clocks.
	if (!paymentDeadlineApplies(status) && order.paymentDueAt !== undefined) {
		patch.paymentDueAt = undefined;
	}
	// `sending` and `deferred` are PROMISES about a message ("your confirmation
	// is on its way") — cancelling the order invalidates them, so clear the
	// stamp or the buyer's page keeps promising a message that will never come:
	// the send action returns early on a cancelled order, so a stamp left at
	// `sending` would be stuck there forever. Terminal states
	// (sent/failed/recovered) are history, not promises, and survive untouched
	// — as does a send that races this and lands anyway, since
	// recordConfirmationPush writes the true outcome after us.
	//
	// `deferred` is legacy (86eyfq0w5); nothing creates it any more, but rows
	// can still be in it until `releaseDeferredPushes` has run.
	if (
		status === "cancelled" &&
		(order.confirmationPushStatus === "sending" ||
			order.confirmationPushStatus === "deferred")
	) {
		patch.confirmationPushStatus = undefined;
	}
	// Courier fields describe a parcel shipment, so they only apply to delivery
	// orders (undefined deliveryMethod reads as delivery, per the rest of the
	// file). The UI never offers them on self-collect; if they arrive anyway they
	// are ignored rather than failing the transition — moving the status is this
	// path's real job, and a stray field shouldn't strand the order.
	if (status === "shipped" && order.deliveryMethod !== "self_collect") {
		// Shared trim/cap/URL-derivation with the edit-after card — a known
		// courier + number auto-resolves the buyer-facing deep link.
		const shipment = resolveShipmentFields(opts);
		if (shipment.courierName) patch.courierName = shipment.courierName;
		if (shipment.trackingNo) patch.trackingNo = shipment.trackingNo;
		if (shipment.carrierTrackingUrl)
			patch.carrierTrackingUrl = shipment.carrierTrackingUrl;
	}
	// This path transitions the CANONICAL status without stage awareness (the
	// stage-aware path is advanceToStage, which sets both). A stored
	// `currentStageId` from an earlier stepper tap would otherwise go stale and
	// pin the displayed stage behind the real status — e.g. the Lalamove webhook
	// delivering an order the seller had marked "Packed" left the tracking page
	// reading "Packed". Clear it so the stage derives from the new status; a
	// same-status replay keeps any within-anchor custom stage.
	if (order.currentStageId !== undefined && status !== order.status) {
		patch.currentStageId = undefined;
	}
	await ctx.db.patch(order._id, patch);
	await ctx.db.insert("orderEvents", {
		orderId: order._id,
		status,
		note: opts.note,
		createdAt: now,
	});

	// Any forward (non-cancel) transition means this order is live — activate the
	// store on the first one. One-time set-if-unset, so a seller manually
	// confirming (or skipping straight to packed/shipped) counts, and a later
	// cancellation never un-sets it.
	if (status !== "cancelled") {
		await stampRetailerActivation(ctx, order.retailerId, now);
	}

	// No WhatsApp here. Status changes — including cancellation — are silent by
	// policy (86eyd63r8): an order gets exactly ONE outbound message, the
	// confirmation push, and the tracking page carries every state after it. The
	// seller is told plainly at each send-nothing surface (the advance stepper,
	// the cancel dialog, the bulk bar) so "the buyer wasn't told" is never a
	// surprise. See docs/one-message-per-order.md.

	// NOTE: Lalamove dispatch is never triggered server-side. Marking a delivery
	// order packed surfaces a "book a rider now?" prompt CLIENT-side (opt-in
	// deliveryBooking.promptBookOnPacked) so the seller always sees today's
	// price and taps to confirm — money never moves without a human. See
	// docs/delivery-lalamove.md ("Prompt to book on packed") + BookDeliveryCard.
}

/**
 * Stamp an order as seen by the seller (86eyf1rck). Idempotent set-if-unset.
 *
 * Confirmation-push orders are born `confirmed`, so `pending` no longer marks
 * "haven't looked at this yet" — this does. Called when the seller opens the
 * order, which is the moment they've actually looked at it; that drains it from
 * the New bucket, the Home tile and the age escalation. Never un-set, so an
 * order can't bounce back to "new" after being read.
 */
export const markSeen = mutation({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }): Promise<void> => {
		const { order } = await requireOrderAccess(ctx, orderId);
		if (order.seenAt !== undefined) return;
		// No updatedAt bump: "the seller looked at it" isn't an order change, and
		// touching updatedAt would corrupt the time-in-status badge.
		await ctx.db.patch(order._id, { seenAt: Date.now() });
	},
});

/**
 * Pin / unpin an order (86eyrtz74) — the seller's manual bookmark.
 *
 * Idempotent by design: the control is a one-tap toggle on a card, a table row
 * AND the detail page, so a double-tap or a stale client must never flip the
 * state back. `pinned` is the desired end state, not a toggle instruction.
 *
 * Un-gated by plan: a bookmark is a one-bit annotation on an order the seller
 * can already see, not an inbox search feature, so gating it behind Pro would
 * mean a Starter watching pinned rows sort to the top of a list they were never
 * allowed to pin into. Only the soft-lock (`assertSubscriptionActive`) applies,
 * matching every other "manage what you already have" write.
 *
 * Never bumps `updatedAt` — bookmarking is not progress on the order, and the
 * time-in-status badge reads that field (the `markSeen` trap).
 */
export const setPinned = mutation({
	args: { orderId: v.id("orders"), pinned: v.boolean() },
	handler: async (ctx, { orderId, pinned }): Promise<void> => {
		const { order, access } = await requireOrderAccess(ctx, orderId);
		await assertSubscriptionActive(ctx, order.retailerId);
		const isPinned = order.pinnedAt !== undefined;
		if (isPinned === pinned) return;
		await ctx.db.patch(order._id, {
			pinnedAt: pinned ? Date.now() : undefined,
		});
		await logAdminAction(
			ctx,
			access,
			pinned ? "orders.pin" : "orders.unpin",
			orderId,
		);
	},
});

export const updateStatus = mutation({
	args: {
		orderId: v.id("orders"),
		status: transitionStatusValidator,
		note: v.optional(v.string()),
		// Shipment tracking — only accepted when transitioning to "shipped".
		// Ignored for other status transitions. A registry courier + number
		// auto-derives carrierTrackingUrl (convex/lib/couriers.ts).
		carrierTrackingUrl: v.optional(v.string()),
		courierName: v.optional(v.string()),
		trackingNo: v.optional(v.string()),
		// Deliberate override of the rider gate below — the seller confirmed the
		// automatic update never arrived (dead/unregistered webhook).
		overrideRiderGate: v.optional(v.boolean()),
	},
	handler: async (
		ctx,
		{
			orderId,
			status,
			note,
			carrierTrackingUrl,
			courierName,
			trackingNo,
			overrideRiderGate,
		},
	): Promise<void> => {
		const { order, access } = await requireOrderAccess(ctx, orderId);

		// Mockup gate: a proof-required order can't move into production (packed)
		// until the buyer has approved the mockup or the seller has waived it.
		// Gates only the forward production step — cancelling is always allowed.
		if (status === "packed" && isMockupGateClosed(order)) {
			throw new ConvexError(
				"Awaiting mockup approval — the buyer must approve the mockup (or you can proceed without approval) before this order can be packed",
			);
		}

		// Collection gate (86eyg0n8e) — the goods are still with the buyer, so no
		// production status can be true. Cancelling stays open (same posture as
		// the mockup gate above). Checked before the rider gate so a collection
		// order's active trip always gets THIS message, never the rider one.
		if (
			status !== "cancelled" &&
			anchorOrdinal(status) >= anchorOrdinal("packed") &&
			isCollectionGateClosed(order)
		) {
			throw new ConvexError(
				"This order is still with your customer — send a rider to collect it first. If the items are already with you, use “I already have the items” on the order page.",
			);
		}

		// Rider gate: a live Lalamove booking drives shipped/delivered. Cancelling
		// is never gated (not a rider-managed anchor). Sits before the transition
		// so the manual courier fields above can't land on an order a rider
		// already owns.
		if (
			!overrideRiderGate &&
			status !== "cancelled" &&
			(await riderOwnsTransition(ctx, order, status))
		) {
			throw new ConvexError(RIDER_GATE_MESSAGE);
		}

		await applyStatusTransition(ctx, order, status, {
			note,
			carrierTrackingUrl,
			courierName,
			trackingNo,
		});
		await logAdminAction(ctx, access, "orders.updateStatus", orderId);
	},
});

/**
 * Bulk-apply one canonical status to many orders (the inbox's multi-select). Uses
 * the SAME per-order path as `updateStatus` so the mockup gate + stock-restore
 * can't be bypassed. Per-order it SKIPS (rather than failing the batch) when the
 * order is already in that status or is mockup-gated for "packed" — and reports
 * a summary. All orders must belong to the caller's retailer.
 */
export const bulkUpdateStatus = mutation({
	args: {
		orderIds: v.array(v.id("orders")),
		status: transitionStatusValidator,
	},
	handler: async (
		ctx,
		{ orderIds, status },
	): Promise<{
		updated: number;
		skipped: number;
		/** Of `skipped`, how many were collection orders whose items are still
		 * with the buyer — the one skip reason the seller can act on, so the
		 * toast can name it instead of leaving a silent no-op. */
		skippedAwaitingCollection: number;
		/** Of `skipped`, how many had a live Lalamove rider driving the order —
		 * named for the same reason: a silent skip is hidden behaviour, and the
		 * fix (wait for the rider, or override from the order page) is per-order. */
		skippedRiderManaged: number;
	}> => {
		if (orderIds.length === 0)
			return {
				updated: 0,
				skipped: 0,
				skippedAwaitingCollection: 0,
				skippedRiderManaged: 0,
			};
		if (orderIds.length > 100)
			throw new ConvexError("Too many orders selected (max 100)");

		let updated = 0;
		let skipped = 0;
		let skippedAwaitingCollection = 0;
		let skippedRiderManaged = 0;
		// The inbox multi-select is single-retailer, so every id resolves to the
		// same access descriptor; keep the last one for a single batch audit row.
		let batchAccess: RetailerAccess | undefined;
		for (const orderId of orderIds) {
			const order = await ctx.db.get(orderId);
			if (!order) throw new ConvexError("Order not found");
			// Owner OR admin acting-as is enforced for every order — a foreign id
			// fails the batch (requireRetailerAccess throws Forbidden).
			const firstResolve = batchAccess === undefined;
			batchAccess = await requireRetailerAccess(ctx, order.retailerId);
			// Bulk actions are an Order Inbox surface (Pro+) — gate once on the
			// first order (the selection is single-retailer); admin act-as bypasses.
			if (firstResolve && !batchAccess.actingAsAdmin)
				await assertPlanFeature(ctx, order.retailerId, "orderInbox");

			// Skip no-ops + transitions blocked by the mockup gate (don't fail the
			// whole batch on one ineligible order).
			if (order.status === status) {
				skipped++;
				continue;
			}
			if (status === "packed" && isMockupGateClosed(order)) {
				skipped++;
				continue;
			}
			// A collection order whose items haven't arrived can't be moved into
			// production in bulk either — skipped, not fatal, so the rest of the
			// batch still lands (mockup-gate posture).
			if (
				status !== "cancelled" &&
				anchorOrdinal(status) >= anchorOrdinal("packed") &&
				isCollectionGateClosed(order)
			) {
				skipped++;
				skippedAwaitingCollection++;
				continue;
			}
			// A live rider owns shipped/delivered — skip rather than message the
			// buyer early without a tracking link. Deliberately no bulk override:
			// overriding is a per-order judgement call (did THIS order's automatic
			// update fail?), so it lives behind the order-detail confirm.
			if (
				status !== "cancelled" &&
				(await riderOwnsTransition(ctx, order, status))
			) {
				skipped++;
				skippedRiderManaged++;
				continue;
			}
			await applyStatusTransition(ctx, order, status);
			updated++;
		}
		if (batchAccess)
			await logAdminAction(ctx, batchAccess, "orders.bulkUpdateStatus");
		return { updated, skipped, skippedAwaitingCollection, skippedRiderManaged };
	},
});

/**
 * Permanently erase an ALREADY-AUTHORIZED order and everything derived from it.
 * Irreversible — there is no soft-delete tombstone. Shared by `deleteOrder`
 * (single) and `bulkDeleteOrders` so the cascade can't drift.
 *
 * Unlike cancellation this is SILENT: no WhatsApp/email is sent (a hard delete
 * is for test/spam/duplicate orders you want gone, not for telling the buyer).
 *
 * Cascade:
 *  1. If the order is still live (not already cancelled), reverse its create-time
 *     effects — restore stock, reverse customer aggregates, un-meter usage. A
 *     cancelled order already had this applied on cancel, so we must NOT repeat it.
 *  2. Delete every storage blob the order owns (buyer reference image, payment
 *     proof, mockup image(s)). Order receipt/invoice PDFs are generated on demand
 *     and never persisted, so there's nothing to clean up there.
 *  3. Delete the order's `orderEvents` timeline.
 *  4. Unlink any counter-checkout session that produced this order (the session
 *     is ephemeral and purged on its own cron; we just drop the dangling ref).
 *  5. Delete the order row itself.
 */
async function deleteOrderCascade(
	ctx: MutationCtx,
	order: Doc<"orders">,
): Promise<void> {
	const now = Date.now();

	// 1. Reverse live-side effects only for an order that hasn't already been
	//    cancelled (a cancelled order reversed them on the way into cancelled).
	if (order.status !== "cancelled") {
		await reverseCancellationEffects(ctx, order, now);
	}

	// 2. Delete owned storage blobs — via the SHARED helper (86eyetzbk), which is
	//    the one place that knows what an order owns. The account cascade
	//    (retailers.deleteUser) open-coded its own shorter list and leaked the
	//    buyer image + mockups; sharing means a future blob field is freed by
	//    both callers or neither.
	await deleteOrderOwnedBlobs(ctx, order);

	// 3. Delete the order's event timeline.
	const events = await ctx.db
		.query("orderEvents")
		.withIndex("by_order", (q) => q.eq("orderId", order._id))
		.collect();
	for (const event of events) {
		await ctx.db.delete(event._id);
	}

	// 4. Unlink the counter-checkout session that spawned this order, if any.
	const sessions = await ctx.db
		.query("counterCheckoutSessions")
		.withIndex("by_order", (q) => q.eq("orderId", order._id))
		.collect();
	for (const session of sessions) {
		await ctx.db.patch(session._id, { orderId: undefined, updatedAt: now });
	}

	// 5. Delete the order's Lalamove booking ledger. An ACTIVE booking is the
	//    seller's to cancel on Lalamove's side (the delete dialog warns before
	//    this point); once the rows are gone, late webhooks for these provider
	//    ids become unmatched traffic and the route acks + ignores them.
	const jobs = await ctx.db
		.query("deliveryJobs")
		.withIndex("by_order", (q) => q.eq("orderId", order._id))
		.collect();
	for (const job of jobs) {
		for (const podId of job.podImageStorageIds ?? []) {
			await ctx.storage.delete(podId);
		}
		await ctx.db.delete(job._id);
	}

	// 6. Delete the order.
	await ctx.db.delete(order._id);
}

/**
 * Hard-delete a single order — **Kedaipal admin only**. Permanent and
 * irreversible. A plain seller is rejected server-side (Forbidden) even though
 * they own the store: permanently erasing order/payment records sits with
 * Kedaipal, not the seller, who uses Cancel (tombstoned + buyer notified)
 * instead. The gate is admin membership (`isAdmin`), NOT `access.actingAsAdmin`
 * — an admin can erase orders in ANY store, including one they personally own
 * (which resolves via the owner branch, so `actingAsAdmin` is false there). The
 * dashboard hides the action for sellers, but this guard — not the hidden UI —
 * is the real boundary. EVERY erase is audited, including one in a store the
 * admin owns (`logDestructiveAdminAction`) — the deleted row can't be asked who
 * removed it, so the trace has to be unconditional.
 * ClickUp `86eyaqzpd` (admin-only restriction) atop `86ey8fr8t` (the erase),
 * `86eyhz189` (always audited).
 */
export const deleteOrder = mutation({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }): Promise<void> => {
		const { order, access } = await requireOrderAccess(ctx, orderId);
		if (!(await isAdmin(ctx))) throw new Error("Forbidden");
		await deleteOrderCascade(ctx, order);
		await logDestructiveAdminAction(ctx, access, "orders.hardDelete", orderId);
	},
});

/**
 * Bulk hard-delete (the inbox multi-select) — **Kedaipal admin only**, same
 * policy as the single `deleteOrder`. Capped at 100/batch.
 * No plan gate: permanent erasure is an admin ops action, not a paid feature.
 *
 * The admin gate is checked ONCE up front (`isAdmin` — one caller identity for
 * the whole batch, cheaper than per-order and ownership-agnostic so an admin can
 * bulk-erase in a store they own too). The per-order `requireRetailerAccess`
 * stays: it confirms each order's retailer exists and supplies the access record
 * for that order's audit row (an admin passes it for every store, so it never
 * rejects here).
 *
 * Audit is ONE ROW PER ERASED ORDER, not one per batch (86eyhz189). A batch row
 * could only carry a single `retailerId`, so a batch spanning two stores would
 * file the whole erase under whichever store happened to be last — and a bare
 * count answers "how many" when the question an irreversible delete raises is
 * "WHICH order is gone". Per-order rows are correct across stores by construction.
 */
export const bulkDeleteOrders = mutation({
	args: { orderIds: v.array(v.id("orders")) },
	handler: async (ctx, { orderIds }): Promise<{ deleted: number }> => {
		if (orderIds.length === 0) return { deleted: 0 };
		if (orderIds.length > 100)
			throw new ConvexError("Too many orders selected (max 100)");
		if (!(await isAdmin(ctx))) throw new Error("Forbidden");

		let deleted = 0;
		for (const orderId of orderIds) {
			const order = await ctx.db.get(orderId);
			if (!order) throw new ConvexError("Order not found");
			const access = await requireRetailerAccess(ctx, order.retailerId);
			await deleteOrderCascade(ctx, order);
			await logDestructiveAdminAction(
				ctx,
				access,
				"orders.bulkDeleteOrders",
				orderId,
			);
			deleted++;
		}
		return { deleted };
	},
});

/**
 * Phase 2: advance an order INTO one of the retailer's stages (their configured
 * `orderStages`, or a synthesized "default:<anchor>" stage — same code path
 * either way). The canonical `orders.status` is DERIVED from the stage's anchor,
 * so every Layer-1 gate keeps working unchanged:
 *  - the mockup gate blocks reaching production (any packed-or-later anchor)
 *    while a required mockup is unapproved/​unwaived — config can't bypass it;
 *  - the carrier-URL field is accepted only when entering a shipped-anchored
 *    stage.
 * Cancellation is NOT a stage (terminal, system-managed) — use `updateStatus`
 * for that, which keeps the stock-restore/aggregate logic. Notification policy:
 * `stage.notify` is the single source of truth — an anchor-CROSSING move reuses
 * the rich `notifyStatusChange` copy (so `messageTemplates` overrides + the
 * delivery/self_collect wording are preserved with zero regression); a notifying
 * move WITHIN an anchor sends the generic `notifyStageEntry` update; `confirmed`
 * never messages from here (the confirm/payment flow owns buyer comms at that
 * point), matching today's behaviour.
 */
export const advanceToStage = mutation({
	args: {
		orderId: v.id("orders"),
		stageId: v.string(),
		note: v.optional(v.string()),
		// Shipment tracking — accepted only when the target stage is
		// shipped-anchored; ignored otherwise. A registry courier + number
		// auto-derives carrierTrackingUrl (convex/lib/couriers.ts).
		carrierTrackingUrl: v.optional(v.string()),
		courierName: v.optional(v.string()),
		trackingNo: v.optional(v.string()),
		// Collection service escape (86eyg0n8e): the seller asserts the items are
		// already with them — they collected in person, or the rider's webhook
		// never reported. Stamps `collectedAt` so the order unblocks for good
		// instead of asking again at every stage. Ignored on standard orders.
		markCollected: v.optional(v.boolean()),
		// Set by the order-detail "Update manually" confirm — the seller asserts
		// the rider's automatic update never landed (or they have no webhook and
		// are moving it themselves). See riderOwnsTransition.
		overrideRiderGate: v.optional(v.boolean()),
	},
	handler: async (
		ctx,
		{
			orderId,
			stageId,
			note,
			carrierTrackingUrl,
			courierName,
			trackingNo,
			markCollected,
			overrideRiderGate,
		},
	): Promise<void> => {
		const { order, access } = await requireOrderAccess(ctx, orderId);
		const retailer = access.retailer;

		if (order.status === "cancelled") {
			throw new ConvexError("A cancelled order can't be advanced.");
		}

		const stages = resolveStages({
			orderStages: retailer.orderStages as OrderStage[] | undefined,
			labels: retailer.statusLabels as StatusLabels | undefined,
			deliveryMethod:
				(order.deliveryMethod as "delivery" | "self_collect" | undefined) ??
				"delivery",
		});
		const stage = stages.find((s) => s.id === stageId);
		if (!stage) throw new ConvexError("Unknown stage for this order.");

		const targetStatus = stage.anchor;

		// Mockup gate: production (packed) or anything later cannot proceed while a
		// required mockup is unresolved. Checking by anchor ordinal (not just
		// "packed") closes the bypass where a config skips the packed anchor.
		if (
			anchorOrdinal(targetStatus) >= anchorOrdinal("packed") &&
			isMockupGateClosed(order)
		) {
			throw new ConvexError(
				"Awaiting mockup approval — the buyer must approve the mockup (or you can proceed without approval) before this order can move into production.",
			);
		}

		// Collection gate (86eyg0n8e): on a COLLECTION order the rider brings the
		// goods IN, so nothing downstream ("packed", "cleaning", "ready") can be
		// true before they arrive. The seller books the rider first and the order
		// waits. Same anchor-ordinal shape as the mockup gate above, and the same
		// escape posture: `markCollected` lets a seller who fetched the items
		// themselves (or whose webhook never reported) proceed — which stamps the
		// arrival, so this asks once, not at every stage. Standard delivery is
		// untouched: the rider takes goods OUT, so packing precedes the trip.
		const collectingFromBuyer =
			isCollectionGateClosed(order) &&
			anchorOrdinal(targetStatus) >= anchorOrdinal("packed");
		if (collectingFromBuyer && markCollected !== true) {
			throw new ConvexError(
				"This order is still with your customer — send a rider to collect it first. If the items are already with you, use “I already have the items” on the order page.",
			);
		}

		// Rider gate — same rule as updateStatus. Within-anchor stage moves don't
		// change canonical status, so isRiderManagedTransition lets them through.
		// Checked after the collection gate, and never fires on collection orders
		// (riderOwnsTransition rules them out by the order's frozen direction).
		if (
			!overrideRiderGate &&
			(await riderOwnsTransition(ctx, order, targetStatus))
		) {
			throw new ConvexError(RIDER_GATE_MESSAGE);
		}

		const now = Date.now();
		const statusChanged = order.status !== targetStatus;

		const patch: Partial<{
			status: typeof targetStatus;
			currentStageId: string;
			carrierTrackingUrl: string;
			courierName: string;
			trackingNo: string;
			statusChangedAt: number;
			updatedAt: number;
			collectedAt: number;
			paymentDueAt: undefined;
		}> = { status: targetStatus, currentStageId: stage.id, updatedAt: now };
		// Custom stages patch `status` here rather than through
		// applyStatusTransition, so the payment-deadline cleanup has to be
		// repeated — same rule, same reason (see that helper). Without this a
		// store on custom stages leaks exactly the rows the other path fixed.
		if (
			!paymentDeadlineApplies(targetStatus) &&
			order.paymentDueAt !== undefined
		) {
			patch.paymentDueAt = undefined;
		}
		// Set-if-unset, so a later manual advance can't move the arrival moment.
		if (collectingFromBuyer && markCollected === true) {
			patch.collectedAt = now;
		}
		// Reset the status clock only when the canonical status actually changes
		// (a within-anchor stage move keeps the same "Pending/Confirmed/…" bucket).
		if (statusChanged) patch.statusChangedAt = now;
		// Delivery-only, and ignored (not fatal) on self-collect — see
		// applyStatusTransition for the reasoning.
		if (
			targetStatus === "shipped" &&
			order.deliveryMethod !== "self_collect"
		) {
			const shipment = resolveShipmentFields({
				carrierTrackingUrl,
				courierName,
				trackingNo,
			});
			if (shipment.courierName) patch.courierName = shipment.courierName;
			if (shipment.trackingNo) patch.trackingNo = shipment.trackingNo;
			if (shipment.carrierTrackingUrl)
				patch.carrierTrackingUrl = shipment.carrierTrackingUrl;
		}
		await ctx.db.patch(orderId, patch);

		// Freeze the EN label onto the event so order history survives a later
		// rename/delete of the stage (pickupSnapshot pattern).
		await ctx.db.insert("orderEvents", {
			orderId,
			status: targetStatus,
			stageId: stage.id,
			stageLabel: stageLabel(stage, "en"),
			note,
			createdAt: now,
		});

		// Custom stages are a seller-side vocabulary for the inbox and the buyer's
		// tracking timeline — they never message the buyer (86eyd63r8). The old
		// per-stage `notify` toggle and its MAX_NOTIFY_STAGES cap are gone with it.
		await logAdminAction(ctx, access, "orders.advanceStage", orderId);
	},
});

/**
 * Set or clear the manual shipment tracking on an order (courier name +
 * tracking number + link — the link auto-derives for registry couriers, or is
 * pasted for "Other"). Retailer may receive the consignment number after
 * marking shipped, so this is intentionally not restricted by status.
 * Deliberately NEVER messages the buyer (Meta bills per outbound message from
 * Oct 2026) — late-added tracking surfaces on the buyer's tracking page only.
 */
export const setShipmentTracking = mutation({
	args: {
		orderId: v.id("orders"),
		courierName: v.optional(v.string()),
		trackingNo: v.optional(v.string()),
		carrierTrackingUrl: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ orderId, courierName, trackingNo, carrierTrackingUrl },
	): Promise<void> => {
		const { order, access } = await requireOrderAccess(ctx, orderId);

		// All-blank input resolves to all-undefined = tracking cleared.
		const shipment = resolveShipmentFields({
			courierName,
			trackingNo,
			carrierTrackingUrl,
		});
		// A self-collect order has no shipment to track, and the UI hides this
		// card there — so refuse to SET, but always allow the all-blank CLEAR so
		// an order that changed fulfilment method (or carries pre-guard data) can
		// never be trapped with tracking it shouldn't have. Mirrors the
		// set-gated/clear-un-gated posture used for chargeable pickup.
		const isClearing =
			shipment.courierName === undefined &&
			shipment.trackingNo === undefined &&
			shipment.carrierTrackingUrl === undefined;
		if (order.deliveryMethod === "self_collect" && !isClearing) {
			throw new ConvexError(
				"Shipment tracking applies to delivery orders only — this order is for self-collect.",
			);
		}
		await ctx.db.patch(orderId, {
			courierName: shipment.courierName,
			trackingNo: shipment.trackingNo,
			carrierTrackingUrl: shipment.carrierTrackingUrl,
			updatedAt: Date.now(),
		});
		await logAdminAction(ctx, access, "orders.setShipmentTracking", orderId);
	},
});

/**
 * Every mutation that RE-PRICES an order must call this (PR #178 review,
 * finding 1). A HitPay request is minted lazily on the buyer's tap and stays
 * payable at HitPay for up to an hour, frozen at the total it was minted for —
 * so any re-price in between leaves a live link at the wrong price. Paying it
 * produces an authentic payment `receiveGatewayPayment` refuses to apply:
 * money moved, the order stays unpaid, and a human has to reconcile it.
 *
 * Killing the link instead turns that into "this link expired, tap Pay now
 * again" at the CORRECT price — a failed payment the buyer can retry beats a
 * successful one at the wrong number. That is also why this is preferred over
 * simply refusing to re-price while a request is live: refusing would block the
 * seller from fixing a delivery charge for up to an hour, and would do nothing
 * about the buyer-driven re-prices (address / pickup-point edits) that open the
 * same window.
 *
 * The dead id is deliberately KEPT in `gatewayPreviousRequestId`: HitPay can
 * ignore or race our delete, and an authentic late payment must still resolve
 * to this order (the webhook reads that index) and reach the amount check.
 * Clearing it outright would turn such a payment into an unknown-ack-200 —
 * money moved and nothing recorded, strictly worse than a surfaced mismatch.
 */
async function voidStaleGatewayRequest(
	ctx: MutationCtx,
	order: Doc<"orders">,
	newTotal: number,
): Promise<void> {
	// Same price = the minted link is still exactly right; a re-price that
	// lands on the old number (fee corrected back) must not cost the buyer
	// their open checkout.
	if (newTotal === order.total) return;
	await releaseGatewayRequest(ctx, order);
}

/** The unconditional half of `voidStaleGatewayRequest` — retire whatever live
 * request the order holds, keeping its id correlatable. Separate because
 * `clearGatewayPaymentIssue` must retire the request even though no re-price
 * happened: that request is the one the unapplied payment landed on, and
 * HitPay may treat it as settled, so the next tap must mint a fresh one rather
 * than reuse a link that could refuse the buyer. */
async function releaseGatewayRequest(
	ctx: MutationCtx,
	order: Doc<"orders">,
): Promise<void> {
	// A settled order's request is history: `createCheckout` already refuses on
	// `received`, so there's no second payment to prevent, and asking HitPay to
	// delete a request it has taken money on is a pointless rejected call.
	if ((order.paymentStatus ?? "unpaid") === "received") return;
	const requestId = order.gatewayRequestId;
	if (!requestId) return;
	await ctx.db.patch(order._id, {
		gatewayPreviousRequestId: requestId,
		gatewayRequestId: undefined,
		gatewayCheckoutUrl: undefined,
		gatewayRequestedAmount: undefined,
		gatewayRequestedCurrency: undefined,
		gatewayRequestedAt: undefined,
	});
	await ctx.scheduler.runAfter(0, internal.hitpay.voidRequest, {
		retailerId: order.retailerId,
		requestId,
	});
}

/**
 * Public mutation that lets the shopper edit their delivery address while the
 * order is still pending. Trust model mirrors the tracking page: the shortId
 * is the capability — anyone who knows it can edit. Once the order moves out
 * of "pending" the address is locked and the shopper must contact the store.
 */
export const updateDeliveryAddress = mutation({
	args: {
		token: v.string(),
		deliveryAddress: addressValidator,
		// Lalamove-priced stores (strict since 27 Jul): the edit dialog fetches a
		// fresh live quote for the new pin and passes its server-side row id, so
		// the re-priced fee is the real rider price — same trust model as create.
		deliveryQuoteId: v.optional(v.id("deliveryQuotes")),
	},
	handler: async (
		ctx,
		{ token, deliveryAddress, deliveryQuoteId },
	): Promise<void> => {
		await rateLimiter.limit(ctx, "addressUpdate", {
			key: token,
			throws: true,
		});

		const order = await orderByToken(ctx, token);
		if (!order) throw new ConvexError("Order not found");

		if (order.status !== "pending") {
			throw new ConvexError(
				"Address can only be edited while the order is pending",
			);
		}
		if (order.deliveryMethod === "self_collect") {
			throw new ConvexError("Self-collect orders do not have a delivery address");
		}

		// The retailer resolves first because the address SHAPE follows the
		// store's country (SG-lite): SG orders re-validate against the 6-digit
		// postal-code + "Singapore" arm, MY against the classic shape.
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) throw new ConvexError("Store not found");

		let sanitized: ReturnType<typeof assertValidAddress>;
		try {
			sanitized = assertValidAddress(
				deliveryAddress,
				retailer.country ?? DEFAULT_COUNTRY,
			);
		} catch (err) {
			throw new ConvexError((err as Error).message);
		}

		// Re-price the delivery charge against the NEW address — a distance-band
		// fee is a function of where the order goes, so the fee follows the
		// address exactly like the pickup fee follows the point (see
		// updatePickupLocation). Blocked destinations throw (the old address —
		// and its total — stay untouched); a radius/weight "arrange" edit flips
		// the order back to fee-pending. A lalamove-priced edit needs the live
		// quote loaded above or it throws — an address change can never silently
		// drop the buyer onto a seller-calculates path. Pending-only gate above
		// means no payment has been asked for yet, so the total is still safe to
		// move.
		const liveQuote = await loadCheckoutDeliveryQuote(
			ctx,
			order.retailerId,
			deliveryQuoteId,
			sanitized,
		);
		// Weight-mode re-price (86eyeea1n) weighs the ORDER's frozen lines against
		// live variant weights — a state change can move the order to another
		// zone's bands, so the weight must be summed again, not read off the old
		// snapshot. A line whose variant is gone (legacy pre-variant orders)
		// reads weightless and resolves per onUnpriceable — never a silent
		// underweigh.
		let cartWeight: CartWeightSummary | undefined;
		if (retailer.deliveryConfig?.mode === "weight") {
			const weightItems: CartWeightItem[] = await Promise.all(
				order.items.map(async (item): Promise<CartWeightItem> => {
					const variant = item.variantId
						? await ctx.db.get(item.variantId)
						: null;
					return {
						parcelWeightG: variant?.parcelWeightG ?? 0,
						quantity: item.quantity,
						isCustom: variant?.isCustom === true,
					};
				}),
			);
			cartWeight = summarizeCartWeight(weightItems);
		}
		const resolved = resolveDeliveryForOrder(
			retailer,
			order.subtotal,
			sanitized,
			cartWeight,
			liveQuote,
		);
		const { subtotal, total } = computeOrderTotals(order.items, {
			quotedAmount: order.mockupQuotedAmount,
			pickupFee: order.pickupFee,
			deliveryFee: resolved.snapshot?.fee,
		});
		// Keep the customer's denormalized totalSpent in step with the new total.
		if (order.customerId && total !== order.total)
			await adjustAggregatesForTotalChange(ctx, {
				customerId: order.customerId,
				delta: total - order.total,
			});

		const now = Date.now();
		// The buyer may have a HitPay link open at the OLD price right now.
		await voidStaleGatewayRequest(ctx, order, total);
		await ctx.db.patch(order._id, {
			deliveryAddress: sanitized,
			deliverySnapshot: resolved.snapshot,
			deliveryFee: resolved.snapshot?.fee,
			deliveryFeePending: resolved.pending || undefined,
			// Re-freeze (or clear) the reason with the flag — a re-price that
			// resolves to a fee must not leave a stale explanation behind.
			deliveryFeePendingReason: resolved.pendingReason,
			subtotal,
			total,
			updatedAt: now,
		});
		await ctx.db.insert("orderEvents", {
			orderId: order._id,
			status: "pending",
			note: "address_updated",
			createdAt: now,
		});
	},
});

/**
 * Seller (or admin act-as): set — or adjust — the delivery charge on a
 * delivery order. This is how a fee-pending "arrange via WhatsApp" order
 * (radius mode, out of range / no coordinates) gets its final total: the
 * seller agrees the charge with the buyer in chat, enters it here, and the
 * held payment ask goes out with the updated total. Also usable to correct a
 * charge before any payment is in motion (typo insurance) — locked once the
 * buyer claims or the seller marks payment received, mirroring the mockup
 * quote's "no re-pricing after commitment" posture. `fee` of 0 = deliver free
 * (clears the charge and the pending flag).
 */
export const setDeliveryFee = mutation({
	args: { orderId: v.id("orders"), fee: v.number() },
	handler: async (ctx, { orderId, fee }): Promise<void> => {
		const order = await ctx.db.get(orderId);
		if (!order) throw new ConvexError("Order not found");
		// Owner OR admin acting-as (see convex/lib/auth.ts).
		const access = await requireRetailerAccess(ctx, order.retailerId);
		if ((order.deliveryMethod ?? "delivery") !== "delivery")
			throw new ConvexError("Only delivery orders carry a delivery charge");
		if (order.status === "cancelled")
			throw new ConvexError("This order was cancelled");
		if (
			order.paymentStatus === "claimed" ||
			order.paymentStatus === "received"
		) {
			throw new ConvexError(
				"Payment is already in motion — the delivery charge can't change now",
			);
		}
		if (!Number.isInteger(fee) || fee < 0)
			throw new ConvexError("Delivery charge must be a whole, non-negative amount");
		if (fee > DELIVERY_FEE_MAX)
			throw new ConvexError("Delivery charge is unrealistically large — check the amount");

		const snapshot: DeliverySnapshot | undefined =
			fee > 0 ? { fee, mode: "manual" } : undefined;
		const now = Date.now();
		const { subtotal, total } = computeOrderTotals(order.items, {
			quotedAmount: order.mockupQuotedAmount,
			pickupFee: order.pickupFee,
			deliveryFee: snapshot?.fee,
		});
		// Keep the customer's denormalized totalSpent in step with the new total.
		if (order.customerId && total !== order.total)
			await adjustAggregatesForTotalChange(ctx, {
				customerId: order.customerId,
				delta: total - order.total,
			});
		// Correcting a charge on an order the buyer can already pay (holds clear,
		// nothing claimed yet) is exactly the window that produced a mispriced
		// live link — kill it before the total moves under the buyer.
		await voidStaleGatewayRequest(ctx, order, total);
		await ctx.db.patch(orderId, {
			deliverySnapshot: snapshot,
			deliveryFee: snapshot?.fee,
			deliveryFeePending: undefined,
			deliveryFeePendingReason: undefined,
			subtotal,
			total,
			// A fee-pending order was UNPAYABLE, so its payment deadline was
			// suspended (the auto-cancel sweep skips fee-pending rows). The fee
			// landing is the moment it becomes payable — guarantee the runway,
			// or a deadline that lapsed during the seller's own pricing delay
			// would cancel the order the instant it could finally be paid.
			...(order.paymentDueAt !== undefined
				? { paymentDueAt: extendedPaymentDue(order.paymentDueAt, now) }
				: {}),
			updatedAt: now,
		});
		await ctx.db.insert("orderEvents", {
			orderId,
			status: order.status,
			note: `delivery_fee_set (fee ${fee})`,
			createdAt: now,
		});
		// No WhatsApp here (86eyd63r8). The buyer's one message went out at
		// checkout saying the total was still to be confirmed, and its button
		// opens the order page — which is reading this fee live, the moment this
		// mutation commits. A second send to restate a number they can already
		// see is exactly what the one-message rule exists to stop.
		await logAdminAction(ctx, access, "orders.setDeliveryFee", orderId);
	},
});

/**
 * Seller (or admin act-as): move an order's fulfilment date/time — the
 * 3am-advance-order fix (86eyp5qd1). The buyer picks the moment at checkout
 * and until now nothing could change it, so a vendor faced with a 3 AM
 * delivery ask had no way out but to serve it or ghost it. The seller agrees
 * a new time with the buyer in chat, records it here, and every live surface
 * follows: the buyer's tracking page updates instantly (reactive read), later
 * stage messages/emails render from live fields, dispatch re-derives its
 * schedule from the order. Deliberately NO new WhatsApp send (one-msg-per-
 * order posture) — messages already sent keep the old time; the chat
 * agreement covers that gap, and the order page is the record.
 *
 * The buyer-facing minimum-notice floor does NOT apply — the notice window
 * exists to protect the seller's lead time, and here the seller is the one
 * moving the date. The [today, +30d] range still holds (checkout's ceiling).
 *
 * All-tier: this is a correctness escape hatch, not a feature to upsell.
 */
export const rescheduleFulfilment = mutation({
	args: {
		orderId: v.id("orders"),
		fulfilmentDate: v.number(),
		// Only meaningful on delivery orders (mirrors create — self-collect and
		// counter orders are date-only). Omitted → the order's existing time is
		// kept, so a date-only change can never silently drop the clock.
		fulfilmentTimeMinutes: v.optional(v.number()),
	},
	handler: async (
		ctx,
		{ orderId, fulfilmentDate, fulfilmentTimeMinutes },
	): Promise<void> => {
		const order = await ctx.db.get(orderId);
		if (!order) throw new ConvexError("Order not found");
		// Owner OR admin acting-as (see convex/lib/auth.ts).
		const access = await requireRetailerAccess(ctx, order.retailerId);
		if (order.status === "cancelled")
			throw new ConvexError("This order was cancelled");
		if (order.status === "shipped" || order.status === "delivered")
			throw new ConvexError(
				"This order is already on its way — the fulfilment date can't change now",
			);
		if (order.source === "counter")
			throw new ConvexError(
				"Counter orders are fulfilled on the spot — there's no date to move",
			);
		// Collection (86eyg0n8e): the date answers "when do we collect?" — once
		// the goods are with the seller that question is history, and moving the
		// date would rewrite it.
		if (order.collectedAt !== undefined)
			throw new ConvexError(
				"This order was already collected — the date can't change now",
			);
		// The buyer is inside a claim link's payment window (86eyq0epn): they
		// hold a confirmed order with a live countdown and may be mid-payment.
		// The dialog hides the trigger behind the same predicate; this is the
		// backstop, so a stale tab can't move the date under a paying buyer.
		if (isPaymentWindowLocked(order))
			throw new ConvexError(PAYMENT_WINDOW_LOCK_REASON);
		// An ACTIVE rider booking is frozen against Lalamove's quotationId and
		// will NOT follow the order — rescheduling under it would desync the
		// buyer's promise from the trip actually booked. The dialog says so and
		// points at cancelling the booking first; this is the backstop.
		const jobs = await ctx.db
			.query("deliveryJobs")
			.withIndex("by_order", (q) => q.eq("orderId", orderId))
			.collect();
		if (jobs.some((j) => isActiveJobStatus(j.status)))
			throw new ConvexError(
				"A rider booking is active for this order — cancel the booking first, then reschedule",
			);

		let sanitizedDate: number;
		try {
			// Notice floor 0 on purpose — see the docblock.
			sanitizedDate = assertValidFulfilmentDate(fulfilmentDate, 0);
		} catch (err) {
			throw new ConvexError((err as Error).message);
		}
		const isDelivery = (order.deliveryMethod ?? "delivery") === "delivery";
		let sanitizedTime: number | undefined;
		if (fulfilmentTimeMinutes !== undefined && isDelivery) {
			try {
				sanitizedTime = assertValidFulfilmentTime(fulfilmentTimeMinutes);
			} catch (err) {
				throw new ConvexError((err as Error).message);
			}
		}
		const nextTime = isDelivery
			? (sanitizedTime ?? order.fulfilmentTimeMinutes)
			: order.fulfilmentTimeMinutes;

		const now = Date.now();
		// Audit trail in the delivery_fee_set style — compact, ASCII, greppable.
		const stamp = (d: number | undefined, tm: number | undefined) =>
			d === undefined
				? "unset"
				: tm === undefined
					? ymdFromEpoch(d)
					: `${ymdFromEpoch(d)} ${hhmmFromMinutes(tm)}`;
		await ctx.db.patch(orderId, {
			fulfilmentDate: sanitizedDate,
			fulfilmentTimeMinutes: nextTime,
			updatedAt: now,
		});
		await ctx.db.insert("orderEvents", {
			orderId,
			status: order.status,
			note: `fulfilment_rescheduled (from ${stamp(order.fulfilmentDate, order.fulfilmentTimeMinutes)} to ${stamp(sanitizedDate, nextTime)})`,
			createdAt: now,
		});
		await logAdminAction(ctx, access, "orders.rescheduleFulfilment", orderId);
	},
});

/**
 * Public mutation that lets the shopper switch their self-collect pickup point
 * while the order is still pending. Same trust model as `updateDeliveryAddress`
 * — shortId is the capability — and same status gate (pending-only). The new
 * snapshot is frozen onto the order, so subsequent edits to the source
 * location do not rewrite history.
 */
export const updatePickupLocation = mutation({
	args: {
		token: v.string(),
		pickupLocationId: v.id("pickupLocations"),
	},
	handler: async (ctx, { token, pickupLocationId }): Promise<void> => {
		await rateLimiter.limit(ctx, "addressUpdate", {
			key: token,
			throws: true,
		});

		const order = await orderByToken(ctx, token);
		if (!order) throw new ConvexError("Order not found");

		if (order.status !== "pending") {
			throw new ConvexError(
				"Pickup location can only be edited while the order is pending",
			);
		}
		if (order.deliveryMethod !== "self_collect") {
			throw new ConvexError("Delivery orders do not have a pickup location");
		}

		const location = await ctx.db.get(pickupLocationId);
		if (!location || location.retailerId !== order.retailerId) {
			throw new ConvexError("Pickup location not found");
		}
		if (!location.isActive) {
			throw new ConvexError("That pickup location is no longer available");
		}

		const now = Date.now();
		// The fee follows the point: switching to a paid location re-applies its
		// fee, switching to a free one drops it — the buyer sees the new total
		// on the tracking page before anyone asks for payment (pending-only
		// gate above means no payment has been taken yet). The mockup quote, an
		// independent extra, is preserved.
		const snapshot = buildPickupSnapshot(location);
		const { subtotal, total } = computeOrderTotals(order.items, {
			quotedAmount: order.mockupQuotedAmount,
			pickupFee: snapshot.fee,
			deliveryFee: order.deliveryFee,
		});
		// Keep the customer's denormalized totalSpent in step with the new total.
		if (order.customerId && total !== order.total)
			await adjustAggregatesForTotalChange(ctx, {
				customerId: order.customerId,
				delta: total - order.total,
			});
		// A paid→free (or free→paid) point switch moves the total, so any live
		// HitPay link is now mispriced.
		await voidStaleGatewayRequest(ctx, order, total);
		await ctx.db.patch(order._id, {
			pickupLocationId: location._id,
			pickupSnapshot: snapshot,
			pickupFee: snapshot.fee,
			subtotal,
			total,
			updatedAt: now,
		});
		await ctx.db.insert("orderEvents", {
			orderId: order._id,
			status: "pending",
			note: "pickup_location_updated",
			createdAt: now,
		});
	},
});

const PAYMENT_REFERENCE_MAX = 80;

/**
 * Public mutation: shopper claims they've paid for their order. Trust model
 * mirrors `updateDeliveryAddress` — knowing the shortId is the capability.
 *
 * Idempotent: re-submitting overwrites the reference / proof and refreshes
 * `paymentClaimedAt`. Rejects only when the order is already `received`, since
 * a confirmed-by-retailer payment shouldn't be re-claimed.
 */
export const claimPayment = mutation({
	args: {
		token: v.string(),
		reference: v.optional(v.string()),
		proofStorageId: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ token, reference, proofStorageId },
	): Promise<void> => {
		await rateLimiter.limit(ctx, "paymentClaim", {
			key: token,
			throws: true,
		});

		const order = await orderByToken(ctx, token);
		if (!order) throw new ConvexError("Order not found");
		if (order.paymentStatus === "received") {
			throw new ConvexError("Payment already confirmed");
		}
		// The SELLER has to look at this proof to decide whether money arrived,
		// and they're a different person from whoever uploaded it — so a file
		// they can't open must not reach them. The client refuses undecodable
		// uploads already; this closes the direct-call gap that a client guard
		// structurally cannot. See convex/lib/imageContentType.ts.
		if (
			proofStorageId &&
			!(await isStoredImageRenderable(ctx, proofStorageId as Id<"_storage">))
		) {
			throw new ConvexError(UNRENDERABLE_PROOF_MESSAGE);
		}
		// Payment is gated behind mockup approval — the buyer's tracking page
		// disables "I've paid" while the gate is closed; reject a direct call too.
		if (isMockupGateClosed(order)) {
			throw new ConvexError(
				"Please approve the mockup before paying — your order total is confirmed once you approve the design.",
			);
		}
		// Same hold while the delivery charge is unconfirmed — the total the
		// buyer would be claiming against isn't final yet.
		if (order.deliveryFeePending === true) {
			throw new ConvexError(
				"The seller is still confirming your delivery charge — you'll get the payment details right after.",
			);
		}

		const trimmedRef = reference?.trim();
		if (trimmedRef && trimmedRef.length > PAYMENT_REFERENCE_MAX) {
			throw new ConvexError(
				`Reference must be ${PAYMENT_REFERENCE_MAX} characters or fewer`,
			);
		}
		const trimmedProof = proofStorageId?.trim();

		const now = Date.now();
		const patch: Partial<Doc<"orders">> = {
			paymentStatus: "claimed",
			paymentClaimedAt: now,
			updatedAt: now,
		};
		if (trimmedRef && trimmedRef.length > 0) {
			patch.paymentReference = trimmedRef;
		}
		if (trimmedProof && trimmedProof.length > 0) {
			patch.paymentProofStorageId = trimmedProof;
		}
		await ctx.db.patch(order._id, patch);
		await ctx.db.insert("orderEvents", {
			orderId: order._id,
			status: order.status,
			note: "payment_claimed",
			createdAt: now,
		});

		await ctx.scheduler.runAfter(
			0,
			internal.email.notifyPaymentClaimed,
			{ orderId: order._id },
		);

		// Seller WhatsApp payment-claim alert (86eyhw9zy). Counter pay-later
		// orders included — a claim lands hours after the sale, when nobody is
		// standing at the counter. The action checks toggle + template env.
		await ctx.scheduler.runAfter(
			0,
			internal.whatsapp.notifySellerPaymentClaim,
			{ orderId: order._id },
		);
	},
});

/**
 * The one author of the payment-received state change, shared by the seller's
 * `markPaymentReceived` and the HitPay gateway's webhook receive (86eyb6z3a) so
 * the two paths can never drift: paymentStatus → received, pending orders
 * auto-confirm (+ the activation stamp), and the orderEvents row is written.
 * NO WhatsApp goes out here (86eyd63r8, one message per order): the buyer's
 * order page flips to "Payment received" live, and both callers' seller
 * surfaces say so — the confirm dialog for the manual path, the paid card for
 * the gateway path.
 *
 * Callers own their guards: the seller path throws on the mockup/delivery-fee
 * holds (the money hasn't moved yet, so refusing is safe); the gateway path
 * enforces those holds at CHECKOUT-CREATION time instead, because by webhook
 * time the buyer's money has already moved and refusing to record it would be
 * a lie. Callers also own idempotency (skip when already `received`).
 */
async function applyPaymentReceived(
	ctx: MutationCtx,
	order: Doc<"orders">,
	opts: {
		now: number;
		paymentMethod?: OrderPaymentMethod;
		/** Detail folded into the non-auto-confirm event note. */
		noteDetail?: string;
		/** Extra fields written in the same patch (gateway ids). */
		extraPatch?: Partial<Doc<"orders">>;
	},
): Promise<void> {
	const { now, paymentMethod, noteDetail, extraPatch } = opts;
	const shouldAutoConfirm = order.status === "pending";

	const patch: Partial<Doc<"orders">> = {
		...extraPatch,
		paymentStatus: "received",
		paymentReceivedAt: now,
		// Real money retires the payment deadline (86eyq0epn) — the ONE receive
		// core every path runs through, so the countdown stops on `received` and
		// never on a mere claim. Unconditional: clearing an unset field is a
		// no-op.
		paymentDueAt: undefined,
		// The single retirement point for an unresolved gateway payment (PR #178
		// review, finding 1). Whatever route settles the order — the seller
		// reconciling the odd payment in their HitPay dashboard and marking it
		// received by hand, or a correctly-priced payment landing afterwards —
		// the buyer's "we're checking a payment" card and the seller's amber note
		// must both retire, and this is the one function every receive path runs
		// through. Unconditional: clearing an unset field is a no-op.
		gatewayPaymentIssue: undefined,
		updatedAt: now,
	};
	if (paymentMethod) patch.paymentMethod = paymentMethod;
	if (shouldAutoConfirm) {
		patch.status = "confirmed";
	}
	await ctx.db.patch(order._id, patch);

	if (shouldAutoConfirm) {
		await ctx.db.insert("orderEvents", {
			orderId: order._id,
			status: "confirmed",
			note: "payment_received_auto_confirm",
			createdAt: now,
		});
		// First order reaching confirmed activates the store (one-time stamp).
		await stampRetailerActivation(ctx, order.retailerId, now);
	} else {
		await ctx.db.insert("orderEvents", {
			orderId: order._id,
			status: order.status,
			note: noteDetail && noteDetail.length > 0
				? `payment_received: ${noteDetail}`
				: "payment_received",
			createdAt: now,
		});
	}
}

/**
 * Retailer-only mutation: mark that the payment has landed in the bank app.
 * Auto-bumps `pending → confirmed`. Nothing is WhatsApp'd (86eyd63r8) — the
 * buyer's order page shows the received state live.
 */
export const markPaymentReceived = mutation({
	args: {
		orderId: v.id("orders"),
		note: v.optional(v.string()),
		// Optional: the seller has just verified the money landed, so this is the
		// one point an online order's method is reliably known. See
		// convex/lib/paymentMethod.ts.
		paymentMethod: v.optional(orderPaymentMethodValidator),
	},
	handler: async (ctx, { orderId, note, paymentMethod }): Promise<void> => {
		const { order, access } = await requireOrderAccess(ctx, orderId);

		if (order.paymentStatus === "received") {
			// Idempotent — second click is a no-op.
			return;
		}
		// Can't mark payment received while the mockup gate is closed — the buyer
		// hasn't been asked to pay and the price may not be final. Mirrors the
		// disabled dashboard button; defense-in-depth against a direct call.
		if (isMockupGateClosed(order)) {
			throw new ConvexError(
				"Approve or remove the custom item first — the buyer is asked to pay only after the mockup is approved (or you proceed without approval).",
			);
		}
		// Delivery charge must be settled before money is recorded — otherwise
		// the received amount is being reconciled against an unfinished total.
		// Set the charge (0 = deliver free) and this unblocks.
		if (order.deliveryFeePending === true) {
			throw new ConvexError(
				"Set the delivery charge first — the order total isn't final until you do.",
			);
		}

		await applyPaymentReceived(ctx, order, {
			now: Date.now(),
			paymentMethod,
			noteDetail: note?.trim(),
		});
		await logAdminAction(ctx, access, "orders.confirmPayment", orderId);
	},
});

/**
 * Internal receive path for a settled HitPay charge (86eyb6z3a) — called by
 * the `/webhook/hitpay` route and the redirect-return reconcile action, both
 * of which have already VERIFIED the event (HMAC / authenticated status
 * fetch). This mutation is the single judge of what an authentic event is
 * allowed to do:
 *  - idempotent by `gatewayPaymentId` (duplicate deliveries no-op);
 *  - the paid amount+currency must echo the order's CURRENT total — a stale
 *    checkout link paid after a re-price records an event + emails the seller
 *    instead of auto-receiving (the money moved; a human reconciles it);
 *  - otherwise it applies the exact `markPaymentReceived` semantics via
 *    `applyPaymentReceived` (auto-confirm, activation — no WhatsApp, 86eyd63r8).
 * Deliberately NO hold guards here: checkout creation enforces them, and
 * money that has already moved must never be silently dropped.
 *
 * Both refusals also freeze `gatewayPaymentIssue` onto the order (PR #178
 * review, finding 1). The event note + seller email alone made this a silent
 * state: the buyer's page still read plain "unpaid" with Pay-now live — an
 * invitation to pay a second time — and the seller's only signal was an email.
 * The stamp is what the buyer's and seller's cards render from, so the surface
 * is identical whether the WEBHOOK or the redirect reconcile found the payment.
 */
export const receiveGatewayPayment = internalMutation({
	args: {
		orderId: v.id("orders"),
		paymentId: v.string(),
		amountSen: v.number(),
		currency: v.string(),
		paymentType: v.optional(v.string()),
		// How the gateway is NAMED to the seller ("HitPay") — passed in by the
		// provider-specific caller rather than known here, like every other
		// `gateway*` field on this table. It reaches the seller's alert and email
		// verbatim, so it must never be empty (Meta rejects empty template
		// parameters outright).
		provider: v.string(),
	},
	handler: async (
		ctx,
		{ orderId, paymentId, amountSen, currency, paymentType, provider },
	): Promise<{
		applied: boolean;
		reason?: "duplicate" | "amount_mismatch" | "cancelled" | "gone";
	}> => {
		const order = await ctx.db.get(orderId);
		// Distinct from "duplicate" on purpose: the order was hard-deleted between
		// the correlating query and this mutation. Nothing was applied and nothing
		// CAN be, so the caller must not report it to the buyer as "received".
		if (!order) return { applied: false, reason: "gone" };
		if (
			order.gatewayPaymentId === paymentId ||
			order.paymentStatus === "received"
		) {
			// Duplicate webhook delivery, or the seller already marked it by hand.
			return { applied: false, reason: "duplicate" };
		}

		const now = Date.now();
		if (order.status === "cancelled") {
			// Pay-after-cancel (PR #172 review, finding 2): createCheckout refuses
			// cancelled orders, but a link minted BEFORE the cancel stays payable
			// at HitPay for up to an hour. An authentic late payment must never
			// resurrect the order — it needs a human and a refund. Event + seller
			// email, no state flip.
			await ctx.db.insert("orderEvents", {
				orderId,
				status: order.status,
				note: `gateway_paid_after_cancel: paid ${(amountSen / 100).toFixed(2)} ${currency.toUpperCase()} on the cancelled order (hitpay ${paymentId})`,
				createdAt: now,
			});
			await ctx.db.patch(orderId, {
				gatewayPaymentIssue: {
					kind: "paid_after_cancel",
					paidAmountSen: amountSen,
					paidCurrency: currency.toUpperCase(),
					paymentId,
					at: now,
				},
				updatedAt: now,
			});
			await ctx.scheduler.runAfter(
				0,
				internal.email.notifyGatewayPaymentIssue,
				{
					orderId,
					kind: "paid_after_cancel",
					paidAmountSen: amountSen,
					paidCurrency: currency.toUpperCase(),
					paymentId,
				},
			);
			return { applied: false, reason: "cancelled" };
		}
		if (
			amountSen !== order.total ||
			currency.toUpperCase() !== order.currency.toUpperCase()
		) {
			// Authentic payment, wrong number — the buyer paid an outdated checkout
			// link (total re-priced after mint) or a tampered/foreign request.
			// Record + tell the seller; never auto-receive a mismatched amount.
			await ctx.db.insert("orderEvents", {
				orderId,
				status: order.status,
				note: `gateway_amount_mismatch: paid ${(amountSen / 100).toFixed(2)} ${currency.toUpperCase()}, order total ${(order.total / 100).toFixed(2)} ${order.currency.toUpperCase()} (hitpay ${paymentId})`,
				createdAt: now,
			});
			await ctx.db.patch(orderId, {
				gatewayPaymentIssue: {
					kind: "amount_mismatch",
					paidAmountSen: amountSen,
					paidCurrency: currency.toUpperCase(),
					paymentId,
					at: now,
				},
				updatedAt: now,
			});
			await ctx.scheduler.runAfter(
				0,
				internal.email.notifyGatewayPaymentIssue,
				{
					orderId,
					kind: "amount_mismatch",
					paidAmountSen: amountSen,
					paidCurrency: currency.toUpperCase(),
					paymentId,
				},
			);
			return { applied: false, reason: "amount_mismatch" };
		}

		await applyPaymentReceived(ctx, order, {
			now,
			// A gateway settlement is always a known settlement — unknown rails
			// stamp "other" rather than staying blank (see mapHitpayPaymentType).
			paymentMethod: mapHitpayPaymentType(paymentType) ?? "other",
			noteDetail: `hitpay${paymentType ? ` (${paymentType})` : ""}`,
			extraPatch: {
				gatewayPaymentId: paymentId,
				// The HitPay payment id doubles as the transfer reference the seller
				// can look up in their HitPay dashboard.
				paymentReference: paymentId,
			},
		});

		// Tell the seller their buyer paid (86eyd63r8). This is the ONE receive
		// path no human on their side witnessed — `markPaymentReceived` is their
		// own click and deliberately notifies nothing. Both are scheduled: the
		// email self-suppresses whenever the WhatsApp alert will actually reach
		// them, and the alert forces the email back if it gives up, so exactly one
		// channel fires and it's never zero.
		await ctx.scheduler.runAfter(0, internal.email.notifyPaymentReceived, {
			orderId,
			provider,
		});
		await ctx.scheduler.runAfter(
			0,
			internal.whatsapp.notifySellerPaymentReceived,
			{ orderId, provider },
		);
		return { applied: true };
	},
});

/**
 * Seller (or admin act-as): retire an unresolved gateway payment notice
 * (PR #178 review, finding 1) WITHOUT marking the order paid.
 *
 * `applyPaymentReceived` covers the case where the seller accepts the odd
 * payment. The other real outcome has no such path: the seller refunds it in
 * HitPay and wants the customer to pay again properly. Since an unresolved
 * issue blocks `createCheckout` (so the buyer can't be charged twice while it
 * stands), without this the refund would leave the buyer permanently unable to
 * pay online — the exact dead end this finding is about, just moved one step
 * later. The seller is the only party who knows the money was returned, so
 * they own the switch.
 *
 * Deliberately not subscription- or plan-gated: clearing a warning is never a
 * paid feature, and a past-due store must still be able to unblock a customer.
 */
export const clearGatewayPaymentIssue = mutation({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }): Promise<void> => {
		const order = await ctx.db.get(orderId);
		if (!order) throw new ConvexError("Order not found");
		const access = await requireRetailerAccess(ctx, order.retailerId);
		const issue = order.gatewayPaymentIssue;
		if (!issue) return; // already resolved (e.g. a payment landed) — no-op
		const now = Date.now();
		// Retire the request the odd payment landed on, so the buyer's next tap
		// mints a fresh link instead of reusing one HitPay may already consider
		// settled (the reuse window is blind to that).
		await releaseGatewayRequest(ctx, order);
		await ctx.db.patch(orderId, {
			gatewayPaymentIssue: undefined,
			updatedAt: now,
		});
		// The money really moved, so the trail must outlive the notice.
		await ctx.db.insert("orderEvents", {
			orderId,
			status: order.status,
			note: `gateway_issue_resolved_by_seller: ${issue.kind}, paid ${(issue.paidAmountSen / 100).toFixed(2)} ${issue.paidCurrency} (hitpay ${issue.paymentId})`,
			createdAt: now,
		});
		await logAdminAction(ctx, access, "orders.clearGatewayPaymentIssue", orderId);
	},
});

/**
 * Late method enrichment for webhook-received payments (86eyb6z3a): the v1
 * completion webhook carries no payment_type, so the receive stamps "other"
 * and the reconcile action follows up with the status fetch's real rail.
 * Only upgrades an "other" stamp on the SAME settled payment — never rewrites
 * a seller's hand-picked method.
 */
export const recordGatewayMethod = internalMutation({
	args: {
		orderId: v.id("orders"),
		paymentId: v.string(),
		paymentType: v.string(),
	},
	handler: async (ctx, { orderId, paymentId, paymentType }): Promise<void> => {
		const order = await ctx.db.get(orderId);
		if (!order) return;
		if (order.gatewayPaymentId !== paymentId) return;
		if (order.paymentMethod !== undefined && order.paymentMethod !== "other") {
			return;
		}
		const method = mapHitpayPaymentType(paymentType);
		if (!method || method === order.paymentMethod) return;
		await ctx.db.patch(orderId, { paymentMethod: method });
	},
});

/**
 * Public mutation: mint a one-shot Convex storage upload URL so the shopper
 * can attach a payment screenshot before submitting `claimPayment`. Same
 * shortId-as-capability trust model. Refused once the order is already
 * `received` so we don't accept proof for a closed claim.
 */
export const generateOrderProofUploadUrl = mutation({
	args: { token: v.string() },
	handler: async (ctx, { token }): Promise<string> => {
		await rateLimiter.limit(ctx, "proofUpload", {
			key: token,
			throws: true,
		});

		const order = await orderByToken(ctx, token);
		if (!order) throw new ConvexError("Order not found");
		if (order.paymentStatus === "received") {
			throw new ConvexError("Payment already confirmed");
		}

		return ctx.storage.generateUploadUrl();
	},
});

/**
 * Public mutation: mint a one-shot upload URL for a buyer's reference image on a
 * custom/made-to-order line, BEFORE the order exists (so keyed by retailerId, not
 * shortId). The returned storageId is passed back to `orders.create`. Same trust
 * posture as the storefront order-create flow — rate-limited, no auth.
 */
export const generateCustomImageUploadUrl = mutation({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<string> => {
		await rateLimiter.limit(ctx, "customImageUpload", {
			key: retailerId,
			throws: true,
		});
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) throw new ConvexError("Store not found");
		return ctx.storage.generateUploadUrl();
	},
});

/**
 * Resolve the buyer's custom-line reference image to a viewable URL. Dual-use:
 * the buyer's tracking page passes `token`; the seller order-detail page passes
 * `shortId` (authenticated + ownership-checked). See resolveSharedOrder.
 */
export const getCustomerImageUrl = query({
	// Dual-use: buyer `token`, or authenticated seller `shortId`.
	args: {
		shortId: v.optional(v.string()),
		token: v.optional(v.string()),
	},
	handler: async (ctx, { shortId, token }): Promise<string | null> => {
		const order = await resolveSharedOrder(ctx, { token, shortId });
		if (!order?.customerImageStorageId) return null;
		return (await ctx.storage.getUrl(order.customerImageStorageId)) ?? null;
	},
});

// ---------------------------------------------------------------------------
// Mockup / proof approval (docs/proof-approval.md). Code says "mockup", not
// "proof" — "proof" is the buyer's payment screenshot. Independent dimension;
// the confirmed→packed gate lives at the top of updateStatus above.
// ---------------------------------------------------------------------------

const MOCKUP_NOTE_MAX = 500;
// Sanity cap on a custom-work quote (minor units) — RM1,000,000. Guards typos
// like an extra few zeros from producing an absurd total.
const MOCKUP_QUOTE_MAX = 100_000_000;
// Grace after a mockup is sent before the seller may proceed without the buyer's
// approval (the deadlock escape). v1 is purely time-based — no reminder
// precondition until the Reminders Cron lands.
export const MOCKUP_WAIVE_GRACE_MS = 48 * 60 * 60 * 1000; // 48h

// `isMockupGateClosed` is defined once in ./lib/order (shared with whatsapp.ts
// and the dashboard/tracking pages).

/**
 * Validate an optional new quote against the prior one, returning the effective
 * quote (minor units). Omitting `quotedAmount` keeps whatever was set before;
 * providing one re-prices. Shared by submitMockup + updateMockupQuote.
 */
function resolveMockupQuote(
	quotedAmount: number | undefined,
	prior: number | undefined,
): number | undefined {
	if (quotedAmount === undefined) return prior;
	if (!Number.isInteger(quotedAmount) || quotedAmount < 0)
		throw new ConvexError("Quote must be a whole, non-negative amount");
	if (quotedAmount > MOCKUP_QUOTE_MAX)
		throw new ConvexError("Quote is unrealistically large — check the amount");
	return quotedAmount;
}

/** Owner-only: mint a one-shot upload URL for a mockup image. */
export const generateMockupUploadUrl = mutation({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }): Promise<string> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		await rateLimiter.limit(ctx, "mockupSubmit", { key: identity.subject, throws: true });
		const order = await ctx.db.get(orderId);
		if (!order) throw new ConvexError("Order not found");
		// Owner OR admin acting-as (see convex/lib/auth.ts).
		await requireRetailerAccess(ctx, order.retailerId);
		if (order.mockupStatus === undefined)
			throw new ConvexError("This order doesn't require a mockup");
		return ctx.storage.generateUploadUrl();
	},
});

/**
 * Owner-only: delete mockup blobs that were uploaded but never attached — e.g.
 * the seller picked 5 images and the 3rd upload failed, so `submitMockup` never
 * ran and images 1–2 would otherwise orphan. Defensive: never deletes an id that
 * the order currently references (a live mockup). Best-effort; the client fires
 * this on a failed multi-upload.
 */
export const discardMockupUploads = mutation({
	args: { orderId: v.id("orders"), storageIds: v.array(v.string()) },
	handler: async (ctx, { orderId, storageIds }): Promise<void> => {
		const order = await ctx.db.get(orderId);
		if (!order) return; // order gone → nothing to protect; let the blobs GC
		// Owner OR admin acting-as (see convex/lib/auth.ts).
		await requireRetailerAccess(ctx, order.retailerId);
		const referenced = new Set(resolveMockupImageIds(order));
		for (const id of storageIds) {
			const trimmed = id.trim();
			if (!trimmed || referenced.has(trimmed)) continue;
			await ctx.storage.delete(trimmed);
		}
	},
});

/**
 * Owner-only: attach a mockup and send it to the buyer → status `submitted`.
 * `quotedAmount` (minor units, optional) is the seller's price for the custom
 * work. It's re-enterable on each round; when present it's folded into `total`
 * immediately as a *proposed* total (the buyer locks it by approving). Omit it
 * for made-to-order items that already carry a fixed storefront price.
 */
export const submitMockup = mutation({
	args: {
		orderId: v.id("orders"),
		// `storageIds` is preferred (1–5 images). `storageId` is the single-image
		// back-compat path. Exactly one must resolve to ≥1 id.
		storageId: v.optional(v.string()),
		storageIds: v.optional(v.array(v.string())),
		quotedAmount: v.optional(v.number()),
	},
	handler: async (
		ctx,
		{ orderId, storageId, storageIds, quotedAmount },
	): Promise<void> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		await rateLimiter.limit(ctx, "mockupSubmit", { key: identity.subject, throws: true });
		const order = await ctx.db.get(orderId);
		if (!order) throw new ConvexError("Order not found");
		// Owner OR admin acting-as (see convex/lib/auth.ts).
		const access = await requireRetailerAccess(ctx, order.retailerId);
		if (order.mockupStatus === undefined)
			throw new ConvexError("This order doesn't require a mockup");
		if (order.mockupStatus === "approved")
			throw new ConvexError("The mockup is already approved");
		const ids = (storageIds ?? (storageId ? [storageId] : []))
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
		if (ids.length === 0) throw new ConvexError("Missing mockup image");
		if (ids.length > MAX_MOCKUP_IMAGES)
			throw new ConvexError(`At most ${MAX_MOCKUP_IMAGES} mockup images`);

		const effectiveQuote = resolveMockupQuote(
			quotedAmount,
			order.mockupQuotedAmount,
		);

		const now = Date.now();
		// Quote, pickup fee and delivery fee are independent extras — carry the
		// frozen fees so re-pricing the custom work never drops a charge.
		const { subtotal, total } = computeOrderTotals(order.items, {
			quotedAmount: effectiveQuote,
			pickupFee: order.pickupFee,
			deliveryFee: order.deliveryFee,
		});
		// Keep the customer's denormalized totalSpent in step with the new total.
		if (order.customerId)
			await adjustAggregatesForTotalChange(ctx, {
				customerId: order.customerId,
				delta: total - order.total,
			});

		// A WAIVED mockup opens the payment gate without reaching "approved", so
		// the buyer can hold a live link while the seller re-quotes here.
		await voidStaleGatewayRequest(ctx, order, total);
		await ctx.db.patch(orderId, {
			mockupStatus: "submitted",
			// Source of truth is the array; the singular stays in sync as [0] for
			// legacy readers (WhatsApp send + the quote guard).
			mockupImageStorageIds: ids,
			mockupImageStorageId: ids[0],
			mockupSubmittedAt: now,
			mockupChangeNote: undefined,
			mockupQuotedAmount: effectiveQuote,
			subtotal,
			total,
			updatedAt: now,
		});
		await ctx.db.insert("orderEvents", {
			orderId,
			status: order.status,
			note:
				effectiveQuote && effectiveQuote > 0
					? `mockup_submitted (quote ${effectiveQuote})`
					: "mockup_submitted",
			createdAt: now,
		});
		// No WhatsApp here (86eyd63r8). The buyer already has this order's one
		// message — sent at checkout, with the total named as "to be confirmed"
		// and a button onto the order page. That page is where the mockup and its
		// quote appear and where the buyer approves them, live, so submitting is
		// not an event that needs its own send. The seller is in that chat by hand
		// anyway; a made-to-order design is a conversation, not a notification.
		await logAdminAction(ctx, access, "orders.submitMockup", orderId);
	},
});

/**
 * Owner-only: re-price the custom work WITHOUT re-sending the mockup. Patches
 * `mockupQuotedAmount` + recomputes `total` (the buyer sees it live on the
 * tracking page), but — unlike submitMockup — does NOT touch `mockupSubmittedAt`
 * (so the 48h waiver clock keeps running) and does NOT notify the buyer over
 * WhatsApp. This is what the dashboard "Save price" control calls, so adjusting
 * the price several times can't spam the buyer or reset the waiver grace.
 */
export const updateMockupQuote = mutation({
	args: { orderId: v.id("orders"), quotedAmount: v.optional(v.number()) },
	handler: async (ctx, { orderId, quotedAmount }): Promise<void> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		await rateLimiter.limit(ctx, "mockupSubmit", { key: identity.subject, throws: true });
		const order = await ctx.db.get(orderId);
		if (!order) throw new ConvexError("Order not found");
		// Owner OR admin acting-as (see convex/lib/auth.ts).
		const access = await requireRetailerAccess(ctx, order.retailerId);
		if (order.mockupStatus === undefined)
			throw new ConvexError("This order doesn't require a mockup");
		if (order.mockupStatus === "approved")
			throw new ConvexError("The mockup is already approved");
		if (!order.mockupImageStorageId)
			throw new ConvexError("Send the mockup before pricing it");

		const effectiveQuote = resolveMockupQuote(
			quotedAmount,
			order.mockupQuotedAmount,
		);
		const now = Date.now();
		// Same extras rule as submitMockup — keep the frozen fees.
		const { subtotal, total } = computeOrderTotals(order.items, {
			quotedAmount: effectiveQuote,
			pickupFee: order.pickupFee,
			deliveryFee: order.deliveryFee,
		});
		// Keep the customer's denormalized totalSpent in step with the new total.
		if (order.customerId)
			await adjustAggregatesForTotalChange(ctx, {
				customerId: order.customerId,
				delta: total - order.total,
			});
		await voidStaleGatewayRequest(ctx, order, total);
		await ctx.db.patch(orderId, {
			mockupQuotedAmount: effectiveQuote,
			subtotal,
			total,
			updatedAt: now,
		});
		await ctx.db.insert("orderEvents", {
			orderId,
			status: order.status,
			note:
				effectiveQuote && effectiveQuote > 0
					? `mockup_quote_updated (quote ${effectiveQuote})`
					: "mockup_quote_updated",
			createdAt: now,
		});
		await logAdminAction(ctx, access, "orders.updateMockupQuote", orderId);
	},
});

/** Public (buyer): approve the current mockup. The tracking token is the capability. */
export const approveMockup = mutation({
	args: { token: v.string() },
	handler: async (ctx, { token }): Promise<void> => {
		const order = await orderByToken(ctx, token);
		if (!order) throw new ConvexError("Order not found");
		await rateLimiter.limit(ctx, "mockupReview", { key: order.retailerId, throws: true });
		if (order.mockupStatus === undefined)
			throw new ConvexError("This order has no mockup to approve");
		if (order.mockupStatus === "approved") return; // idempotent
		if (order.mockupStatus !== "submitted")
			throw new ConvexError("There's no mockup awaiting your approval yet");

		const now = Date.now();
		await ctx.db.patch(order._id, {
			mockupStatus: "approved",
			mockupApprovedAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("orderEvents", {
			orderId: order._id,
			status: order.status,
			note: "mockup_approved",
			createdAt: now,
		});
		await ctx.scheduler.runAfter(0, internal.email.notifyMockupApproved, {
			orderId: order._id,
		});
	},
});

/** Public (buyer): request changes to the current mockup. */
export const requestMockupChanges = mutation({
	args: { token: v.string(), note: v.optional(v.string()) },
	handler: async (ctx, { token, note }): Promise<void> => {
		const order = await orderByToken(ctx, token);
		if (!order) throw new ConvexError("Order not found");
		await rateLimiter.limit(ctx, "mockupReview", { key: order.retailerId, throws: true });
		if (order.mockupStatus !== "submitted")
			throw new ConvexError("There's no mockup awaiting your review yet");
		const trimmed = note?.trim();
		if (trimmed && trimmed.length > MOCKUP_NOTE_MAX)
			throw new ConvexError(`Note must be ${MOCKUP_NOTE_MAX} characters or fewer`);

		const now = Date.now();
		await ctx.db.patch(order._id, {
			mockupStatus: "changes_requested",
			mockupChangeNote: trimmed && trimmed.length > 0 ? trimmed : undefined,
			updatedAt: now,
		});
		await ctx.db.insert("orderEvents", {
			orderId: order._id,
			status: order.status,
			note:
				trimmed && trimmed.length > 0
					? `changes_requested: ${trimmed}`
					: "changes_requested",
			createdAt: now,
		});
		await ctx.scheduler.runAfter(
			0,
			internal.email.notifyMockupChangesRequested,
			{ orderId: order._id },
		);
	},
});

/** Owner-only: proceed without buyer approval (deadlock escape, time-guarded). */
export const waiveMockup = mutation({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }): Promise<void> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		await rateLimiter.limit(ctx, "mockupSubmit", { key: identity.subject, throws: true });
		const order = await ctx.db.get(orderId);
		if (!order) throw new ConvexError("Order not found");
		// Owner OR admin acting-as (see convex/lib/auth.ts).
		const access = await requireRetailerAccess(ctx, order.retailerId);
		if (order.mockupStatus === undefined)
			throw new ConvexError("This order doesn't require a mockup");
		if (order.mockupStatus === "approved" || order.mockupWaivedAt !== undefined)
			return; // gate already open
		if (order.mockupSubmittedAt === undefined)
			throw new ConvexError("Send the mockup to the buyer first");
		if (Date.now() - order.mockupSubmittedAt < MOCKUP_WAIVE_GRACE_MS)
			throw new ConvexError(
				"You can only proceed without approval after the buyer has had time to respond",
			);

		const now = Date.now();
		await ctx.db.patch(orderId, { mockupWaivedAt: now, updatedAt: now });
		await ctx.db.insert("orderEvents", {
			orderId,
			status: order.status,
			note: "mockup_waived",
			createdAt: now,
		});
		await logAdminAction(ctx, access, "orders.waiveMockup", orderId);
	},
});

/**
 * Public (buyer): decline the custom (made-to-order) item. The tracking token is
 * the capability. Drops every `requiresProof` line from the order, recomputes the
 * total (clearing the quote), and re-opens the fulfilment gate so the remaining
 * ready-made items proceed normally. If the order was custom-only, declining is
 * equivalent to cancelling it (stock restored, aggregates reversed).
 */
export const declineMockupItem = mutation({
	args: { token: v.string() },
	handler: async (ctx, { token }): Promise<void> => {
		const order = await orderByToken(ctx, token);
		if (!order) throw new ConvexError("Order not found");
		await rateLimiter.limit(ctx, "mockupReview", { key: order.retailerId, throws: true });
		if (order.mockupStatus === undefined)
			throw new ConvexError("This order has no custom item to decline");
		if (order.mockupStatus === "approved")
			throw new ConvexError("The custom item has already been approved");

		// Resolve which lines are the made-to-order/custom ones (requiresProof
		// resolves true: per-variant override ?? product default).
		const customVariantIds = new Set<string>();
		for (const item of order.items) {
			if (!item.variantId) continue;
			const variant = await ctx.db.get(item.variantId);
			if (!variant) continue;
			const product = await ctx.db.get(variant.productId);
			if (!product) continue;
			if ((variant.requiresProof ?? product.requiresProof) === true)
				customVariantIds.add(item.variantId);
		}
		if (customVariantIds.size === 0)
			throw new ConvexError("No custom item on this order to decline");

		const kept = order.items.filter(
			(i) => !i.variantId || !customVariantIds.has(i.variantId),
		);
		const dropped = order.items.filter(
			(i) => i.variantId && customVariantIds.has(i.variantId),
		);

		const now = Date.now();

		// Restore stock for any dropped line that hard-blocks (defensive — custom
		// items are normally made-to-order and were never reserved).
		const restoreByVariant = new Map<Id<"productVariants">, number>();
		for (const item of dropped) {
			if (!item.variantId) continue;
			restoreByVariant.set(
				item.variantId,
				(restoreByVariant.get(item.variantId) ?? 0) + item.quantity,
			);
		}
		for (const [variantId, qty] of restoreByVariant) {
			const fresh = await ctx.db.get(variantId);
			if (!fresh) continue;
			const product = await ctx.db.get(fresh.productId);
			if (!product) continue;
			if ((fresh.blockWhenOutOfStock ?? product.blockWhenOutOfStock) !== true)
				continue;
			await ctx.db.patch(variantId, { onHand: fresh.onHand + qty, updatedAt: now });
		}

		const droppedNote = `custom_declined: ${dropped
			.map((i) => (i.variantLabel ? `${i.name} (${i.variantLabel})` : i.name))
			.join(", ")}`;

		// Custom-only order → declining is a cancellation.
		if (kept.length === 0) {
			if (order.status !== "cancelled" && order.customerId)
				await decrementAggregatesForCancel(ctx, {
					customerId: order.customerId,
					orderTotal: order.total,
				});
			// Un-meter on the first transition into cancelled (mirrors
			// applyStatusTransition — this cancel path bypasses that helper).
			if (order.status !== "cancelled")
				await recordOrderCancelled(ctx, order.retailerId, order.createdAt);
			await ctx.db.patch(order._id, {
				status: "cancelled",
				mockupStatus: undefined,
				mockupQuotedAmount: undefined,
				// The promise of a message dies with the order (see
				// applyStatusTransition's cancel branch — this cancel path bypasses
				// that helper, so it clears the stamp itself; same two in-flight
				// states, same reasoning).
				confirmationPushStatus:
					order.confirmationPushStatus === "sending" ||
					order.confirmationPushStatus === "deferred"
						? undefined
						: order.confirmationPushStatus,
				updatedAt: now,
			});
			await ctx.db.insert("orderEvents", {
				orderId: order._id,
				status: "cancelled",
				note: droppedNote,
				createdAt: now,
			});
			await ctx.scheduler.runAfter(0, internal.email.notifyMockupDeclined, {
				orderId: order._id,
			});
			return;
		}

		// Mixed order → keep the ready-made items, drop the custom one, clear the
		// quote + gate, recompute the total. The pickup fee survives — the buyer
		// still collects the remaining items at the same paid point.
		const { subtotal, total } = computeOrderTotals(kept, {
			pickupFee: order.pickupFee,
			deliveryFee: order.deliveryFee,
		});
		if (order.customerId)
			await adjustAggregatesForTotalChange(ctx, {
				customerId: order.customerId,
				delta: total - order.total,
			});
		await voidStaleGatewayRequest(ctx, order, total);
		await ctx.db.patch(order._id, {
			items: kept,
			subtotal,
			total,
			mockupStatus: undefined,
			mockupQuotedAmount: undefined,
			updatedAt: now,
		});
		await ctx.db.insert("orderEvents", {
			orderId: order._id,
			status: order.status,
			note: droppedNote,
			createdAt: now,
		});
		await ctx.scheduler.runAfter(0, internal.email.notifyMockupDeclined, {
			orderId: order._id,
		});
	},
});

/**
 * Public query: resolve the current mockup image(s) into viewable URLs for the
 * tracking page (and the seller's order detail). shortId is the capability (same
 * trust model as the rest of the tracking page). Returns [] when none / unresolved.
 */
export const getMockupUrls = query({
	// Dual-use: buyer `token`, or authenticated seller `shortId`.
	args: {
		shortId: v.optional(v.string()),
		token: v.optional(v.string()),
	},
	handler: async (ctx, { shortId, token }): Promise<string[]> => {
		const order = await resolveSharedOrder(ctx, { token, shortId });
		if (!order) return [];
		const urls = await Promise.all(
			resolveMockupImageIds(order).map((id) => ctx.storage.getUrl(id)),
		);
		return urls.filter((u): u is string => u !== null);
	},
});

/**
 * Thumbnails for an order's line items (86eyrtz74) — so a seller packing an
 * order can recognise the product by sight instead of parsing
 * "Kek Lapis Sarawak · 1 kg".
 *
 * Resolution per line: the VARIANT's first image, else the PRODUCT's first
 * image, else nothing (the caller renders `AppImage`'s fallback).
 *
 * Keyed the same way as `getMockupUrls`: buyer `token` OR authenticated seller
 * `shortId`, via `resolveSharedOrder`. Returns one entry per line item in line
 * order — NOT a map keyed by product/variant id — because the same product can
 * appear on two lines and the caller renders by position.
 *
 * The image is deliberately NOT frozen onto the order (unlike name/price): it
 * is a packing aid, not a financial record, so a seller who replaces a product
 * photo should see the new one everywhere. The cost is that a deleted photo
 * leaves a line with no thumbnail, which degrades to the standard fallback box.
 *
 * Batched: one read per distinct variant + product across the order, not per
 * line, and storage URLs resolve in parallel.
 */
export const getItemImageUrls = query({
	args: {
		shortId: v.optional(v.string()),
		token: v.optional(v.string()),
	},
	handler: async (ctx, { shortId, token }): Promise<(string | null)[]> => {
		const order = await resolveSharedOrder(ctx, { token, shortId });
		if (!order) return [];

		const variantIds = new Set<Id<"productVariants">>();
		const productIds = new Set<Id<"products">>();
		for (const it of order.items) {
			if (it.variantId) variantIds.add(it.variantId);
			productIds.add(it.productId);
		}
		const variantFirst = new Map<string, string | undefined>();
		const productFirst = new Map<string, string | undefined>();
		await Promise.all([
			...[...variantIds].map(async (id) => {
				const v = await ctx.db.get(id);
				variantFirst.set(id, v?.imageStorageIds[0]);
			}),
			...[...productIds].map(async (id) => {
				const p = await ctx.db.get(id);
				productFirst.set(id, p?.imageStorageIds[0]);
			}),
		]);

		return Promise.all(
			order.items.map(async (it) => {
				const storageId =
					(it.variantId ? variantFirst.get(it.variantId) : undefined) ??
					productFirst.get(it.productId);
				if (!storageId) return null;
				return ctx.storage.getUrl(storageId);
			}),
		);
	},
});

/**
 * One-shot backfill (86eyg0n8e): stamp `collectedAt` on COLLECTION orders whose
 * rider already completed the trip before that field existed.
 *
 *   npx convex run orders:backfillCollectionCollectedAt
 *
 * Without it, such an order sits behind the collection gate forever — the rider
 * genuinely brought the goods in, but nothing recorded WHEN, so the seller would
 * have to take the "I already have the items" escape on an order that needs no
 * escape. The arrival moment is taken from the job's last webhook event (its
 * completion), falling back to the job's `updatedAt`.
 *
 * **Production is a no-op** — the collection service has never shipped there, so
 * no order carries `deliveryDirection: "collection"` yet. This exists for dev
 * deployments that tested the flow before the field landed. Idempotent: only
 * touches rows where `collectedAt` is unset.
 */
export const backfillCollectionCollectedAt = internalMutation({
	args: {},
	handler: async (ctx): Promise<{ scanned: number; stamped: number }> => {
		const jobs = await ctx.db
			.query("deliveryJobs")
			.filter((q) => q.eq(q.field("status"), "completed"))
			.collect();
		let stamped = 0;
		for (const job of jobs) {
			if (job.deliveryDirection !== "collection") continue;
			const order = await ctx.db.get(job.orderId);
			if (!order) continue;
			if (order.deliveryDirection !== "collection") continue;
			if (order.collectedAt !== undefined) continue;
			await ctx.db.patch(order._id, {
				collectedAt: job.lastEventAt ?? job.updatedAt,
				updatedAt: Date.now(),
			});
			stamped++;
		}
		console.log("[orders] collectedAt backfill", {
			scanned: jobs.length,
			stamped,
		});
		return { scanned: jobs.length, stamped };
	},
});
