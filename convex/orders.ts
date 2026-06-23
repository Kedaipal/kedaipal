import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	mutation,
	type MutationCtx,
	query,
	type QueryCtx,
} from "./_generated/server";
import {
	adjustAggregatesForTotalChange,
	decrementAggregatesForCancel,
	linkOrderToCustomer,
} from "./customers";
import { assertValidAddress } from "./lib/address";
import { BUCKET_STATUSES, statusToBucket } from "./lib/orderBuckets";
import {
	computeOrderTotals,
	generateShortId,
	generateTrackingToken,
	isMockupGateClosed,
} from "./lib/order";
import {
	anchorOrdinal,
	type Locale,
	type OrderStage,
	resolveStages,
	stageLabel,
	stageNotifyPlan,
	type StatusLabels,
} from "./lib/orderStatus";
import { type PaymentMethod, resolvePaymentMethods } from "./lib/payment";
import { rateLimiter } from "./lib/rateLimiter";
import { assertValidWaPhone } from "./lib/slug";
import { variantLabel } from "./lib/variant";
import type { PickupSnapshot } from "./lib/whatsappCopy";

const addressValidator = v.object({
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
async function orderByToken(
	ctx: QueryCtx | MutationCtx,
	trackingToken: string,
): Promise<Doc<"orders"> | null> {
	return ctx.db
		.query("orders")
		.withIndex("by_tracking_token", (q) =>
			q.eq("trackingToken", trackingToken),
		)
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
async function resolveSharedOrder(
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
		if (!retailer || retailer.userId !== identity.subject)
			throw new ConvexError("Forbidden");
		return order;
	}
	throw new ConvexError("Provide a tracking token or order ref");
}

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
		// Optional free-text instruction the shopper typed at checkout.
		customerNote: v.optional(v.string()),
		// Optional reference image the buyer attached for a custom line, uploaded
		// pre-order via generateCustomImageUploadUrl. Stored as-is (a stray/invalid
		// id just resolves to no URL on display — same posture as proof images).
		customerImageStorageId: v.optional(v.string()),
	},
	handler: async (
		ctx,
		args,
	): Promise<{ shortId: string; trackingToken: string }> => {
		// Rate limit FIRST — public endpoint, throttle per storefront before any DB reads.
		await rateLimiter.limit(ctx, "orderCreate", {
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
		let sanitizedAddress: ReturnType<typeof assertValidAddress> | undefined;
		if (args.deliveryAddress) {
			try {
				sanitizedAddress = assertValidAddress(args.deliveryAddress);
			} catch (err) {
				throw new ConvexError((err as Error).message);
			}
		}

		// Customer waPhone is optional at checkout — the WhatsApp webhook
		// stamps it automatically when the shopper sends the order message.
		let customerWaPhone: string | undefined;
		if (args.customer.waPhone) {
			try {
				customerWaPhone = assertValidWaPhone(args.customer.waPhone);
			} catch (err) {
				throw new ConvexError((err as Error).message);
			}
		}
		const sanitizedCustomer = {
			name: args.customer.name?.trim() || undefined,
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

		const retailer = await ctx.db.get(args.retailerId);
		if (!retailer) throw new ConvexError("Retailer not found");

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
				sanitizedPickupSnapshot = {
					label: location.label,
					address: location.address,
					mapsUrl: location.mapsUrl,
					notes: location.notes,
					latitude: location.latitude,
					longitude: location.longitude,
					placeId: location.placeId,
				};
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
		}

		const { subtotal, total } = computeOrderTotals(snapshotItems);
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

		const orderId = await ctx.db.insert("orders", {
			retailerId: args.retailerId,
			shortId,
			trackingToken,
			items: snapshotItems,
			subtotal,
			total,
			currency: args.currency,
			status: "pending",
			channel: args.channel,
			customer: sanitizedCustomer,
			deliveryMethod: effectiveDeliveryMethod,
			deliveryAddress: sanitizedAddress,
			pickupLocationId: resolvedPickupLocationId,
			pickupSnapshot: sanitizedPickupSnapshot,
			customerNote: sanitizedCustomerNote,
			// Only keep the buyer image when the order actually has a custom line —
			// guards a stray id on a non-custom order.
			customerImageStorageId: requiresMockup
				? args.customerImageStorageId
				: undefined,
			mockupStatus: requiresMockup ? "pending" : undefined,
			statusChangedAt: now,
			createdAt: now,
			updatedAt: now,
		});

		await ctx.db.insert("orderEvents", {
			orderId,
			status: "pending",
			createdAt: now,
		});

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

		return { shortId, trackingToken };
	},
});

/**
 * Returns the count of pending and confirmed orders for the retailer's dashboard tab indicators.
 */
export const countActionable = query({
	args: { retailerId: v.id("retailers") },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{ pending: number; confirmed: number; mockupPending: number }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) throw new Error("Retailer not found");
		if (retailer.userId !== identity.subject) throw new Error("Forbidden");

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
		return {
			...order,
			statusLabels: retailer?.statusLabels as StatusLabels | undefined,
			orderStages: retailer?.orderStages as OrderStage[] | undefined,
			retailerLocale: (retailer?.locale ?? "en") as Locale,
		};
	},
});

/**
 * Public: resolve the seller's payment methods for the buyer's tracking page,
 * keyed by the tracking token (the capability — same details already go to the
 * buyer in the WhatsApp confirm reply). Legacy-aware via `resolvePaymentMethods`;
 * QR storage ids resolved to URLs. Returns `null` when the seller has nothing
 * configured (track page hides it).
 */
export const getPaymentMethods = query({
	args: { token: v.string() },
	handler: async (
		ctx,
		{ token },
	): Promise<Array<PaymentMethod & { qrImageUrl?: string }> | null> => {
		const order = await orderByToken(ctx, token);
		if (!order) return null;
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) return null;
		const methods = resolvePaymentMethods(retailer);
		if (methods.length === 0) return null;

		const resolved: Array<PaymentMethod & { qrImageUrl?: string }> = [];
		for (const m of methods) {
			let qrImageUrl: string | undefined;
			if (m.type === "qr" && m.qrImageStorageId) {
				const url = await ctx.storage.getUrl(m.qrImageStorageId);
				qrImageUrl = url ?? undefined;
			}
			resolved.push({ ...m, qrImageUrl });
		}
		return resolved;
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
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");

		const order = await ctx.db.get(orderId);
		if (!order) return null;
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) return null;
		if (retailer.userId !== identity.subject) throw new Error("Forbidden");

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
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) throw new Error("Retailer not found");
		if (retailer.userId !== identity.subject) throw new Error("Forbidden");

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
		dateFrom: v.optional(v.number()),
		dateTo: v.optional(v.number()),
		// Cross-cutting: only orders awaiting the seller's mockup action
		// (mockupStatus pending / changes_requested). ANDs with the other filters.
		mockupPending: v.optional(v.boolean()),
		searchText: v.optional(v.string()),
		limit: v.optional(v.number()),
	},
	handler: async (
		ctx,
		{
			retailerId,
			bucket,
			paymentStatuses,
			dateFrom,
			dateTo,
			mockupPending,
			searchText,
			limit,
		},
	) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) throw new Error("Retailer not found");
		if (retailer.userId !== identity.subject) throw new Error("Forbidden");

		const all = await ctx.db
			.query("orders")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.order("desc")
			.take(MAX_INBOX_SCAN);

		// Bucket counts (+ the cross-cutting mockup-pending count) over the full
		// set — independent of the active filters/search so the chips always show
		// true totals.
		const counts = {
			new: 0,
			in_progress: 0,
			completed: 0,
			cancelled: 0,
			mockupPending: 0,
		};
		const needsMockup = (s: string | undefined) =>
			s === "pending" || s === "changes_requested";
		for (const o of all) {
			counts[statusToBucket(o.status)]++;
			if (needsMockup(o.mockupStatus)) counts.mockupPending++;
		}

		const term = (searchText ?? "").trim().toLowerCase();
		const digits = term.replace(/\D/g, "");
		const payset =
			paymentStatuses && paymentStatuses.length > 0
				? new Set(paymentStatuses)
				: null;
		const bucketStatuses =
			bucket === "all" ? null : new Set(BUCKET_STATUSES[bucket]);

		const filtered = all.filter((o) => {
			if (bucketStatuses && !bucketStatuses.has(o.status)) return false;
			if (mockupPending && !needsMockup(o.mockupStatus)) return false;
			// Undefined paymentStatus reads as "unpaid".
			if (payset && !payset.has(o.paymentStatus ?? "unpaid")) return false;
			if (dateFrom !== undefined && o.createdAt < dateFrom) return false;
			if (dateTo !== undefined && o.createdAt > dateTo) return false;
			if (term.length > 0) {
				const name = (o.customer.name ?? "").toLowerCase();
				const phone = (o.customer.waPhone ?? "").replace(/\D/g, "");
				const idHit = o.shortId.toLowerCase().includes(term);
				const nameHit = name.length > 0 && name.includes(term);
				// Phone: match on trailing digits (handles +60 / 0 / local-part typing).
				const phoneHit = digits.length >= 4 && phone.endsWith(digits);
				// Item name / variant ("vanilla cake") — already in memory, so cheap.
				const itemHit = o.items.some(
					(it) =>
						it.name.toLowerCase().includes(term) ||
						(it.variantLabel ?? "").toLowerCase().includes(term),
				);
				if (!idHit && !nameHit && !phoneHit && !itemHit) return false;
			}
			return true;
		});

		const take = Math.max(1, Math.min(limit ?? 50, 200));
		return {
			orders: filtered.slice(0, take),
			total: filtered.length,
			counts,
			capped: all.length >= MAX_INBOX_SCAN,
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
async function applyStatusTransition(
	ctx: MutationCtx,
	order: Doc<"orders">,
	status: TransitionStatus,
	opts: { note?: string; carrierTrackingUrl?: string } = {},
): Promise<void> {
	const now = Date.now();

	// Restore stock on the FIRST transition into cancelled. Idempotent —
	// re-cancelling a cancelled order is a no-op for stock. Only variants whose
	// parent product hard-blocks were ever decremented, so only those are
	// restored. Items without a variantId are legacy (pre-variant) orders, skipped.
	if (status === "cancelled" && order.status !== "cancelled") {
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
		// Same first-transition guard keeps it idempotent.
		if (order.customerId) {
			await decrementAggregatesForCancel(ctx, {
				customerId: order.customerId,
				orderTotal: order.total,
			});
		}
	}

	const patch: Partial<{
		status: TransitionStatus;
		statusChangedAt: number;
		updatedAt: number;
		carrierTrackingUrl: string;
	}> = { status, statusChangedAt: now, updatedAt: now };
	if (status === "shipped" && opts.carrierTrackingUrl) {
		const trimmed = opts.carrierTrackingUrl.trim();
		if (trimmed.length > 0) patch.carrierTrackingUrl = trimmed;
	}
	await ctx.db.patch(order._id, patch);
	await ctx.db.insert("orderEvents", {
		orderId: order._id,
		status,
		note: opts.note,
		createdAt: now,
	});

	// Fire-and-forget WhatsApp notification. Scheduled (not awaited) so the
	// mutation stays a pure transaction and the action runs with network access.
	await ctx.scheduler.runAfter(0, internal.whatsapp.notifyStatusChange, {
		orderId: order._id,
	});
}

export const updateStatus = mutation({
	args: {
		orderId: v.id("orders"),
		status: transitionStatusValidator,
		note: v.optional(v.string()),
		// Carrier tracking URL — only accepted when transitioning to "shipped".
		// Ignored for other status transitions.
		carrierTrackingUrl: v.optional(v.string()),
	},
	handler: async (ctx, { orderId, status, note, carrierTrackingUrl }): Promise<void> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");

		const order = await ctx.db.get(orderId);
		if (!order) throw new Error("Order not found");

		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) throw new Error("Retailer not found");
		if (retailer.userId !== identity.subject) throw new Error("Forbidden");

		// Mockup gate: a proof-required order can't move into production (packed)
		// until the buyer has approved the mockup or the seller has waived it.
		// Gates only the forward production step — cancelling is always allowed.
		if (status === "packed" && isMockupGateClosed(order)) {
			throw new ConvexError(
				"Awaiting mockup approval — the buyer must approve the mockup (or you can proceed without approval) before this order can be packed",
			);
		}

		await applyStatusTransition(ctx, order, status, { note, carrierTrackingUrl });
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
	): Promise<{ updated: number; skipped: number }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		if (orderIds.length === 0) return { updated: 0, skipped: 0 };
		if (orderIds.length > 100)
			throw new ConvexError("Too many orders selected (max 100)");

		let updated = 0;
		let skipped = 0;
		for (const orderId of orderIds) {
			const order = await ctx.db.get(orderId);
			if (!order) throw new ConvexError("Order not found");
			const retailer = await ctx.db.get(order.retailerId);
			if (!retailer) throw new Error("Retailer not found");
			// Ownership is enforced for every order — a foreign id fails the batch.
			if (retailer.userId !== identity.subject) throw new Error("Forbidden");

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
			await applyStatusTransition(ctx, order, status);
			updated++;
		}
		return { updated, skipped };
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
		// Accepted only when the target stage is shipped-anchored; ignored otherwise.
		carrierTrackingUrl: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ orderId, stageId, note, carrierTrackingUrl },
	): Promise<void> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");

		const order = await ctx.db.get(orderId);
		if (!order) throw new Error("Order not found");
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) throw new Error("Retailer not found");
		if (retailer.userId !== identity.subject) throw new Error("Forbidden");

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

		const now = Date.now();
		const statusChanged = order.status !== targetStatus;

		const patch: Partial<{
			status: typeof targetStatus;
			currentStageId: string;
			carrierTrackingUrl: string;
			statusChangedAt: number;
			updatedAt: number;
		}> = { status: targetStatus, currentStageId: stage.id, updatedAt: now };
		// Reset the status clock only when the canonical status actually changes
		// (a within-anchor stage move keeps the same "Pending/Confirmed/…" bucket).
		if (statusChanged) patch.statusChangedAt = now;
		if (targetStatus === "shipped" && carrierTrackingUrl) {
			const trimmed = carrierTrackingUrl.trim();
			if (trimmed.length > 0) patch.carrierTrackingUrl = trimmed;
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

		const plan = stageNotifyPlan({
			notify: stage.notify,
			targetAnchor: targetStatus,
			statusChanged,
		});
		if (plan === "canonical") {
			// Anchor crossing → rich canonical copy (messageTemplates-aware).
			await ctx.scheduler.runAfter(0, internal.whatsapp.notifyStatusChange, {
				orderId,
			});
		} else if (plan === "stage") {
			// Within the same anchor → generic stage update.
			await ctx.scheduler.runAfter(0, internal.whatsapp.notifyStageEntry, {
				orderId,
				stageId: stage.id,
			});
		}
	},
});

/**
 * Set or clear the carrier tracking URL on an order.
 * Retailer may receive the courier link after marking shipped, so this is
 * intentionally not restricted by status.
 */
export const setCarrierTrackingUrl = mutation({
	args: {
		orderId: v.id("orders"),
		carrierTrackingUrl: v.optional(v.string()),
	},
	handler: async (ctx, { orderId, carrierTrackingUrl }): Promise<void> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");

		const order = await ctx.db.get(orderId);
		if (!order) throw new Error("Order not found");

		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) throw new Error("Retailer not found");
		if (retailer.userId !== identity.subject) throw new Error("Forbidden");

		const trimmed = carrierTrackingUrl?.trim() ?? "";
		await ctx.db.patch(orderId, {
			carrierTrackingUrl: trimmed.length > 0 ? trimmed : undefined,
			updatedAt: Date.now(),
		});
	},
});

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
	},
	handler: async (ctx, { token, deliveryAddress }): Promise<void> => {
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

		let sanitized: ReturnType<typeof assertValidAddress>;
		try {
			sanitized = assertValidAddress(deliveryAddress);
		} catch (err) {
			throw new ConvexError((err as Error).message);
		}

		const now = Date.now();
		await ctx.db.patch(order._id, {
			deliveryAddress: sanitized,
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
		await ctx.db.patch(order._id, {
			pickupLocationId: location._id,
			pickupSnapshot: {
				label: location.label,
				address: location.address,
				mapsUrl: location.mapsUrl,
				notes: location.notes,
				latitude: location.latitude,
				longitude: location.longitude,
				placeId: location.placeId,
			},
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
		// Payment is gated behind mockup approval — the buyer's tracking page
		// disables "I've paid" while the gate is closed; reject a direct call too.
		if (isMockupGateClosed(order)) {
			throw new ConvexError(
				"Please approve the mockup before paying — your order total is confirmed once you approve the design.",
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
	},
});

/**
 * Retailer-only mutation: mark that the payment has landed in the bank app.
 * Auto-bumps `pending → confirmed` (the new payment-received WhatsApp message
 * already covers the shopper-facing handshake, so this skips the regular
 * `notifyStatusChange` to avoid sending two messages).
 */
export const markPaymentReceived = mutation({
	args: {
		orderId: v.id("orders"),
		note: v.optional(v.string()),
	},
	handler: async (ctx, { orderId, note }): Promise<void> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");

		const order = await ctx.db.get(orderId);
		if (!order) throw new Error("Order not found");

		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) throw new Error("Retailer not found");
		if (retailer.userId !== identity.subject) throw new Error("Forbidden");

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

		const now = Date.now();
		const trimmedNote = note?.trim();
		const shouldAutoConfirm = order.status === "pending";

		const patch: Partial<Doc<"orders">> = {
			paymentStatus: "received",
			paymentReceivedAt: now,
			updatedAt: now,
		};
		if (shouldAutoConfirm) {
			patch.status = "confirmed";
		}
		await ctx.db.patch(orderId, patch);

		if (shouldAutoConfirm) {
			await ctx.db.insert("orderEvents", {
				orderId,
				status: "confirmed",
				note: "payment_received_auto_confirm",
				createdAt: now,
			});
		} else {
			await ctx.db.insert("orderEvents", {
				orderId,
				status: order.status,
				note: trimmedNote && trimmedNote.length > 0
					? `payment_received: ${trimmedNote}`
					: "payment_received",
				createdAt: now,
			});
		}

		await ctx.scheduler.runAfter(
			0,
			internal.whatsapp.notifyPaymentReceived,
			{ orderId },
		);
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
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) throw new Error("Retailer not found");
		if (retailer.userId !== identity.subject) throw new Error("Forbidden");
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
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		const order = await ctx.db.get(orderId);
		if (!order) return; // order gone → nothing to protect; let the blobs GC
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) throw new Error("Retailer not found");
		if (retailer.userId !== identity.subject) throw new Error("Forbidden");
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
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) throw new Error("Retailer not found");
		if (retailer.userId !== identity.subject) throw new Error("Forbidden");
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
		const { subtotal, total } = computeOrderTotals(order.items, effectiveQuote);
		// Keep the customer's denormalized totalSpent in step with the new total.
		if (order.customerId)
			await adjustAggregatesForTotalChange(ctx, {
				customerId: order.customerId,
				delta: total - order.total,
			});

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
		await ctx.scheduler.runAfter(0, internal.whatsapp.notifyMockupSubmitted, {
			orderId,
		});
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
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) throw new Error("Retailer not found");
		if (retailer.userId !== identity.subject) throw new Error("Forbidden");
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
		const { subtotal, total } = computeOrderTotals(order.items, effectiveQuote);
		// Keep the customer's denormalized totalSpent in step with the new total.
		if (order.customerId)
			await adjustAggregatesForTotalChange(ctx, {
				customerId: order.customerId,
				delta: total - order.total,
			});
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
		// Gate is now open → send the buyer the payment prompt that was deferred
		// at confirm time (the "I've paid" CTA over WhatsApp).
		await ctx.scheduler.runAfter(0, internal.whatsapp.notifyPaymentDue, {
			orderId: order._id,
			reason: "approved",
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
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) throw new Error("Retailer not found");
		if (retailer.userId !== identity.subject) throw new Error("Forbidden");
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
		// Gate forced open without buyer approval → the buyer still needs to pay,
		// so send the payment prompt deferred at confirm time.
		await ctx.scheduler.runAfter(0, internal.whatsapp.notifyPaymentDue, {
			orderId,
			reason: "waived",
		});
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
			await ctx.db.patch(order._id, {
				status: "cancelled",
				mockupStatus: undefined,
				mockupQuotedAmount: undefined,
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
		// quote + gate, recompute the total.
		const { subtotal, total } = computeOrderTotals(kept);
		if (order.customerId)
			await adjustAggregatesForTotalChange(ctx, {
				customerId: order.customerId,
				delta: total - order.total,
			});
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
		// The gate is now open and the buyer owes for the ready-made remainder, but
		// they may close the page — nudge them with the payment prompt over
		// WhatsApp. Skip if payment was already taken (e.g. seller marked received).
		if ((order.paymentStatus ?? "unpaid") === "unpaid")
			await ctx.scheduler.runAfter(0, internal.whatsapp.notifyPaymentDue, {
				orderId: order._id,
				reason: "declined",
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
