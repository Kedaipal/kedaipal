import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { assertValidAddress } from "./lib/address";
import { computeOrderTotals, generateShortId } from "./lib/order";
import { rateLimiter } from "./lib/rateLimiter";
import { assertValidWaPhone } from "./lib/slug";

const addressValidator = v.object({
	line1: v.string(),
	line2: v.optional(v.string()),
	city: v.string(),
	state: v.string(),
	postcode: v.string(),
	notes: v.optional(v.string()),
	mapsUrl: v.optional(v.string()),
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
	name: string;
	price: number;
	quantity: number;
};

export const create = mutation({
	args: {
		retailerId: v.id("retailers"),
		items: v.array(
			v.object({
				productId: v.id("products"),
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

		if (args.items.length === 0)
			throw new ConvexError("Order must have at least one item");
		if (args.items.length > MAX_ITEMS_PER_ORDER)
			throw new ConvexError(`Maximum ${MAX_ITEMS_PER_ORDER} items per order`);

		const snapshotItems: OrderItemSnapshot[] = [];
		// Sum requested quantities per product so a single order with two line
		// items pointing at the same product is validated and decremented once.
		const requestedByProduct = new Map<Id<"products">, number>();
		for (const item of args.items) {
			if (!Number.isInteger(item.quantity) || item.quantity < 1)
				throw new ConvexError("Quantity must be a positive integer");
			const product = await ctx.db.get(item.productId);
			if (!product) throw new ConvexError(`Product ${item.productId} not found`);
			if (product.retailerId !== args.retailerId)
				throw new ConvexError("Product does not belong to this retailer");
			if (!product.active)
				throw new ConvexError(`Product "${product.name}" is not available`);
			if (product.currency !== args.currency)
				throw new ConvexError(
					`Currency mismatch: order is ${args.currency} but "${product.name}" is ${product.currency}`,
				);
			const requestedSoFar = requestedByProduct.get(item.productId) ?? 0;
			const newRequested = requestedSoFar + item.quantity;
			if (product.stock < newRequested)
				throw new ConvexError(
					`Only ${product.stock} of "${product.name}" in stock`,
				);
			requestedByProduct.set(item.productId, newRequested);
			snapshotItems.push({
				productId: item.productId,
				name: product.name,
				price: product.price,
				quantity: item.quantity,
			});
		}

		const { subtotal, total } = computeOrderTotals(snapshotItems);
		const now = Date.now();

		// Reserve stock — patch each product. Same transaction, so any failure
		// rolls back automatically. Re-fetch fresh to avoid stale closure values.
		for (const [productId, qty] of requestedByProduct) {
			const fresh = await ctx.db.get(productId);
			if (!fresh) throw new Error("Product disappeared mid-transaction");
			await ctx.db.patch(productId, {
				stock: fresh.stock - qty,
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
			createdAt: now,
			updatedAt: now,
		});

		await ctx.db.insert("orderEvents", {
			orderId,
			status: "pending",
			createdAt: now,
		});

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

		const now = Date.now();

		// Restore stock on the FIRST transition into cancelled. Idempotent —
		// re-cancelling a cancelled order is a no-op for stock.
		if (status === "cancelled" && order.status !== "cancelled") {
			const restoreByProduct = new Map<Id<"products">, number>();
			for (const item of order.items) {
				restoreByProduct.set(
					item.productId,
					(restoreByProduct.get(item.productId) ?? 0) + item.quantity,
				);
			}
			for (const [productId, qty] of restoreByProduct) {
				const fresh = await ctx.db.get(productId);
				if (!fresh) continue; // product was deleted; nothing to restore
				await ctx.db.patch(productId, {
					stock: fresh.stock + qty,
					updatedAt: now,
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
