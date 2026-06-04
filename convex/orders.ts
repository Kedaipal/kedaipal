import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
	decrementAggregatesForCancel,
	linkOrderToCustomer,
} from "./customers";
import { assertValidAddress } from "./lib/address";
import { computeOrderTotals, generateShortId } from "./lib/order";
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
const SHORT_ID_RETRIES = 3;

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
	},
	handler: async (ctx, args): Promise<{ shortId: string }> => {
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

		const retailer = await ctx.db.get(args.retailerId);
		if (!retailer) throw new ConvexError("Retailer not found");

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
			if (product.requiresProof === true) requiresMockup = true;
			const variantId = variant._id;
			const label = variantLabel(variant.optionValues);
			const displayName = label ? `${product.name} (${label})` : product.name;
			if (!product.active || !variant.active)
				throw new ConvexError(`"${displayName}" is not available`);
			if (product.currency !== args.currency)
				throw new ConvexError(
					`Currency mismatch: order is ${args.currency} but "${displayName}" is ${product.currency}`,
				);
			const block = product.blockWhenOutOfStock === true;
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

		const orderId = await ctx.db.insert("orders", {
			retailerId: args.retailerId,
			shortId,
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
			mockupStatus: requiresMockup ? "pending" : undefined,
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

		return { shortId };
	},
});

/**
 * Returns the count of pending and confirmed orders for the retailer's dashboard tab indicators.
 */
export const countActionable = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<{ pending: number; confirmed: number }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) throw new Error("Retailer not found");
		if (retailer.userId !== identity.subject) throw new Error("Forbidden");

		const [pendingRows, confirmedRows] = await Promise.all([
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
		]);

		return { pending: pendingRows.length, confirmed: confirmedRows.length };
	},
});

export const get = query({
	args: { shortId: v.string() },
	handler: async (ctx, { shortId }): Promise<Doc<"orders"> | null> => {
		return ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
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
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, { retailerId, status, paginationOpts }) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) throw new Error("Retailer not found");
		if (retailer.userId !== identity.subject) throw new Error("Forbidden");

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
		if (
			status === "packed" &&
			order.mockupStatus !== undefined &&
			order.mockupStatus !== "approved" &&
			order.mockupWaivedAt === undefined
		) {
			throw new ConvexError(
				"Awaiting mockup approval — the buyer must approve the mockup (or you can proceed without approval) before this order can be packed",
			);
		}

		const now = Date.now();

		// Restore stock on the FIRST transition into cancelled. Idempotent —
		// re-cancelling a cancelled order is a no-op for stock. Only variants
		// whose parent product hard-blocks were ever decremented, so only those
		// are restored. Items without a variantId are legacy (pre-variant) orders
		// and are skipped.
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
				if (product?.blockWhenOutOfStock !== true) continue; // made-to-order
				await ctx.db.patch(variantId, {
					onHand: fresh.onHand + qty,
					updatedAt: now,
				});
			}

			// Reverse this order's contribution to the customer's lifetime
			// aggregates. Same first-transition guard keeps it idempotent.
			if (order.customerId) {
				await decrementAggregatesForCancel(ctx, {
					customerId: order.customerId,
					orderTotal: order.total,
				});
			}
		}

		const patch: Partial<{ status: typeof status; updatedAt: number; carrierTrackingUrl: string }> = {
			status,
			updatedAt: now,
		};
		if (status === "shipped" && carrierTrackingUrl) {
			const trimmed = carrierTrackingUrl.trim();
			if (trimmed.length > 0) {
				patch.carrierTrackingUrl = trimmed;
			}
		}
		await ctx.db.patch(orderId, patch);
		await ctx.db.insert("orderEvents", {
			orderId,
			status,
			note,
			createdAt: now,
		});

		// Fire-and-forget WhatsApp notification. Scheduled (not awaited) so the
		// mutation stays a pure transaction and the action runs with network access.
		await ctx.scheduler.runAfter(
			0,
			internal.whatsapp.notifyStatusChange,
			{ orderId },
		);
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
		shortId: v.string(),
		deliveryAddress: addressValidator,
	},
	handler: async (ctx, { shortId, deliveryAddress }): Promise<void> => {
		await rateLimiter.limit(ctx, "addressUpdate", {
			key: shortId,
			throws: true,
		});

		const order = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
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
		shortId: v.string(),
		pickupLocationId: v.id("pickupLocations"),
	},
	handler: async (ctx, { shortId, pickupLocationId }): Promise<void> => {
		await rateLimiter.limit(ctx, "addressUpdate", {
			key: shortId,
			throws: true,
		});

		const order = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
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
		shortId: v.string(),
		reference: v.optional(v.string()),
		proofStorageId: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ shortId, reference, proofStorageId },
	): Promise<void> => {
		await rateLimiter.limit(ctx, "paymentClaim", {
			key: shortId,
			throws: true,
		});

		const order = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		if (!order) throw new ConvexError("Order not found");
		if (order.paymentStatus === "received") {
			throw new ConvexError("Payment already confirmed");
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
	args: { shortId: v.string() },
	handler: async (ctx, { shortId }): Promise<string> => {
		await rateLimiter.limit(ctx, "proofUpload", {
			key: shortId,
			throws: true,
		});

		const order = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		if (!order) throw new ConvexError("Order not found");
		if (order.paymentStatus === "received") {
			throw new ConvexError("Payment already confirmed");
		}

		return ctx.storage.generateUploadUrl();
	},
});

// ---------------------------------------------------------------------------
// Mockup / proof approval (docs/proof-approval.md). Code says "mockup", not
// "proof" — "proof" is the buyer's payment screenshot. Independent dimension;
// the confirmed→packed gate lives at the top of updateStatus above.
// ---------------------------------------------------------------------------

const MOCKUP_NOTE_MAX = 500;
// Grace after a mockup is sent before the seller may proceed without the buyer's
// approval (the deadlock escape). v1 is purely time-based — no reminder
// precondition until the Reminders Cron lands.
export const MOCKUP_WAIVE_GRACE_MS = 48 * 60 * 60 * 1000; // 48h

/** Owner-only: mint a one-shot upload URL for a mockup image. */
export const generateMockupUploadUrl = mutation({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }): Promise<string> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		await rateLimiter.limit(ctx, "productWrite", { key: identity.subject, throws: true });
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

/** Owner-only: attach a mockup and send it to the buyer → status `submitted`. */
export const submitMockup = mutation({
	args: { orderId: v.id("orders"), storageId: v.string() },
	handler: async (ctx, { orderId, storageId }): Promise<void> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		await rateLimiter.limit(ctx, "productWrite", { key: identity.subject, throws: true });
		const order = await ctx.db.get(orderId);
		if (!order) throw new ConvexError("Order not found");
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) throw new Error("Retailer not found");
		if (retailer.userId !== identity.subject) throw new Error("Forbidden");
		if (order.mockupStatus === undefined)
			throw new ConvexError("This order doesn't require a mockup");
		if (order.mockupStatus === "approved")
			throw new ConvexError("The mockup is already approved");
		const id = storageId.trim();
		if (!id) throw new ConvexError("Missing mockup image");

		const now = Date.now();
		await ctx.db.patch(orderId, {
			mockupStatus: "submitted",
			mockupImageStorageId: id,
			mockupSubmittedAt: now,
			mockupChangeNote: undefined,
			updatedAt: now,
		});
		await ctx.db.insert("orderEvents", {
			orderId,
			status: order.status,
			note: "mockup_submitted",
			createdAt: now,
		});
		// TODO(notifications): schedule WhatsApp send of the mockup image +
		// "review your mockup" link to the buyer.
	},
});

/** Public (buyer): approve the current mockup. shortId is the capability. */
export const approveMockup = mutation({
	args: { shortId: v.string() },
	handler: async (ctx, { shortId }): Promise<void> => {
		const order = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
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
		// TODO(notifications): alert the seller that the mockup was approved.
	},
});

/** Public (buyer): request changes to the current mockup. */
export const requestMockupChanges = mutation({
	args: { shortId: v.string(), note: v.optional(v.string()) },
	handler: async (ctx, { shortId, note }): Promise<void> => {
		const order = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
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
		// TODO(notifications): alert the seller that changes were requested.
	},
});

/** Owner-only: proceed without buyer approval (deadlock escape, time-guarded). */
export const waiveMockup = mutation({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }): Promise<void> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		await rateLimiter.limit(ctx, "productWrite", { key: identity.subject, throws: true });
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
	},
});

/**
 * Public query: resolve the current mockup image into a viewable URL for the
 * tracking page. shortId is the capability (same trust model as the rest of the
 * tracking page).
 */
export const getMockupUrl = query({
	args: { shortId: v.string() },
	handler: async (ctx, { shortId }): Promise<string | null> => {
		const order = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		if (!order?.mockupImageStorageId) return null;
		return (await ctx.storage.getUrl(order.mockupImageStorageId)) ?? null;
	},
});
