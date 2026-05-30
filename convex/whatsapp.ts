import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalAction,
	internalMutation,
	internalQuery,
} from "./_generated/server";
import { linkOrderToCustomer, refreshWaProfileName } from "./customers";
import { getAdapter } from "./lib/channels/registry";
import { assertValidWaPhone } from "./lib/slug";
import {
	paymentQrCaption,
	pickLocale,
	renderMessage,
	renderPaymentInstructions,
	renderPickupBlock,
	renderSystemMessage,
	SHORT_ID_REGEX,
	type DeliveryMethod,
	type Locale,
	type MessageTemplates,
	type PaymentInstructions,
	type PickupSnapshot,
} from "./lib/whatsappCopy";

type ResolvedPayment = {
	instructions: PaymentInstructions | undefined;
	qrImageUrl: string | undefined;
};

type LocationPin = {
	latitude: number;
	longitude: number;
	name: string;
	address: string;
};

/**
 * Pick the location pin for the confirm reply. Self-collect orders point at
 * their pickup snapshot; delivery orders point at the buyer's destination.
 * Returns `undefined` when no coordinates were captured (legacy orders or
 * buyers who skipped Google autocomplete) — caller silently skips the send.
 */
function resolveLocationPin(meta: {
	deliveryMethod: DeliveryMethod;
	pickupSnapshot: PickupSnapshot | undefined;
	deliveryAddress: Doc<"orders">["deliveryAddress"];
}): LocationPin | undefined {
	if (meta.deliveryMethod === "self_collect") {
		const s = meta.pickupSnapshot;
		if (!s || typeof s.latitude !== "number" || typeof s.longitude !== "number")
			return undefined;
		return {
			latitude: s.latitude,
			longitude: s.longitude,
			name: s.label,
			address: s.address,
		};
	}
	const addr = meta.deliveryAddress;
	if (
		!addr ||
		typeof addr.latitude !== "number" ||
		typeof addr.longitude !== "number"
	)
		return undefined;
	// Compose a one-line address as both name and address — buyers see the
	// same string twice, but WhatsApp's location card uses `name` as the
	// preview heading and `address` as the body, so the duplication reads
	// cleanly.
	const parts: string[] = [addr.line1];
	if (addr.line2 && addr.line2.trim().length > 0) parts.push(addr.line2);
	parts.push(`${addr.postcode} ${addr.city}`);
	parts.push(addr.state);
	const oneLine = parts.join(", ");
	return {
		latitude: addr.latitude,
		longitude: addr.longitude,
		name: addr.line1,
		address: oneLine,
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

/**
 * Internal mutation invoked by handleInbound when an ORD-XXXX is matched.
 * Idempotent: re-confirming an already-confirmed order is a no-op for status,
 * but still stamps customer.waPhone if missing.
 */
export const confirmOrderFromWhatsApp = internalMutation({
	args: {
		shortId: v.string(),
		fromPhone: v.string(),
		// Sender's WhatsApp pushname, captured from the webhook contacts array.
		profileName: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ shortId, fromPhone, profileName },
	): Promise<{
		matched: boolean;
		alreadyConfirmed: boolean;
		orderId?: Id<"orders">;
		retailerId?: Id<"retailers">;
	}> => {
		const order = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		if (!order) return { matched: false, alreadyConfirmed: false };

		const now = Date.now();
		const wasPending = order.status === "pending";
		const patch: Partial<Doc<"orders">> = { updatedAt: now };
		if (!order.customer.waPhone) {
			patch.customer = { ...order.customer, waPhone: fromPhone };
		}
		if (wasPending) {
			patch.status = "confirmed";
		}
		// Persist status/phone changes (skip a pure updatedAt churn-write when
		// nothing else changed, preserving the previous idempotent behaviour).
		if (wasPending || patch.customer !== undefined) {
			await ctx.db.patch(order._id, patch);
		}
		if (wasPending) {
			await ctx.db.insert("orderEvents", {
				orderId: order._id,
				status: "confirmed",
				note: "Confirmed via WhatsApp",
				createdAt: now,
			});
		}

		// Customer linking + pushname capture. Orders that arrived with a phone
		// were already linked at checkout (customerId set) — skip to avoid double
		// counting. Phone-less orders are linked here (the late-bind case).
		let customerId = order.customerId;
		if (!customerId) {
			const linkPhone = order.customer.waPhone ?? fromPhone;
			let normalized: string | null = null;
			try {
				normalized = assertValidWaPhone(linkPhone);
			} catch {
				normalized = null;
			}
			if (normalized) {
				customerId = await linkOrderToCustomer(ctx, {
					retailerId: order.retailerId,
					waPhone: normalized,
					orderId: order._id,
					orderTotal: order.total,
					orderCreatedAt: order.createdAt,
					customerName: order.customer.name,
				});
			}
		}
		if (customerId && profileName) {
			await refreshWaProfileName(ctx, { customerId, profileName });
		}

		return {
			matched: true,
			alreadyConfirmed: !wasPending,
			orderId: order._id,
			retailerId: order.retailerId,
		};
	},
});

/**
 * Internal query for actions to load order + retailer for outbound messaging.
 */
export const getOrderWithRetailer = internalQuery({
	args: { orderId: v.id("orders") },
	handler: async (
		ctx,
		{ orderId },
	): Promise<{
		shortId: string;
		status: Doc<"orders">["status"];
		customerWaPhone: string | undefined;
		storeName: string;
		retailerWaPhone: string | undefined;
		retailerSlug: string;
		carrierTrackingUrl: string | undefined;
		deliveryMethod: DeliveryMethod;
		locale: Locale;
		messageTemplates: MessageTemplates | undefined;
	} | null> => {
		const order = await ctx.db.get(orderId);
		if (!order) return null;
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) return null;
		return {
			shortId: order.shortId,
			status: order.status,
			customerWaPhone: order.customer.waPhone,
			storeName: retailer.storeName,
			retailerWaPhone: retailer.waPhone,
			retailerSlug: retailer.slug,
			carrierTrackingUrl: order.carrierTrackingUrl,
			deliveryMethod: (order.deliveryMethod as DeliveryMethod | undefined) ?? "delivery",
			locale: (retailer.locale as Locale | undefined) ?? "en",
			messageTemplates: retailer.messageTemplates as
				| MessageTemplates
				| undefined,
		};
	},
});

export const getRetailerLocaleForOrder = internalQuery({
	args: { shortId: v.string() },
	handler: async (
		ctx,
		{ shortId },
	): Promise<{
		locale: Locale;
		storeName: string;
		retailerWaPhone: string | undefined;
		messageTemplates: MessageTemplates | undefined;
		deliveryMethod: DeliveryMethod;
		pickupSnapshot: PickupSnapshot | undefined;
		deliveryAddress: Doc<"orders">["deliveryAddress"];
		payment: ResolvedPayment;
	} | null> => {
		const order = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		if (!order) return null;
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) return null;
		const instructions = retailer.paymentInstructions as
			| PaymentInstructions
			| undefined;
		let qrImageUrl: string | undefined;
		if (instructions?.qrImageStorageId) {
			const url = await ctx.storage.getUrl(instructions.qrImageStorageId);
			qrImageUrl = url ?? undefined;
		}
		return {
			locale: (retailer.locale as Locale | undefined) ?? "en",
			storeName: retailer.storeName,
			retailerWaPhone: retailer.waPhone,
			messageTemplates: retailer.messageTemplates as
				| MessageTemplates
				| undefined,
			deliveryMethod: (order.deliveryMethod as DeliveryMethod | undefined) ?? "delivery",
			pickupSnapshot: order.pickupSnapshot,
			deliveryAddress: order.deliveryAddress,
			payment: { instructions, qrImageUrl },
		};
	},
});

/**
 * Process an inbound WhatsApp text message. Searches for an ORD-XXXX token,
 * confirms the order, and replies in the retailer's locale. Unknown messages
 * receive a friendly fallback in English (we don't yet know the retailer).
 */
export const handleInbound = internalAction({
	args: {
		fromPhone: v.string(),
		text: v.string(),
		profileName: v.optional(v.string()),
	},
	handler: async (ctx, { fromPhone, text, profileName }): Promise<void> => {
		console.log("WA inbound received", {
			fromPhone,
			textLength: text.length,
			textPreview: text.slice(0, 120),
		});

		const fallback = (): string =>
			renderMessage(undefined, "en", "unknownFallback", {
				shortId: "",
				storeName: "",
			});

		const wa = getAdapter("whatsapp");

		const match = text.match(SHORT_ID_REGEX);
		if (!match) {
			console.log("WA inbound no shortId match → fallback", { fromPhone });
			try {
				await wa.send(fromPhone, { kind: "text", body: fallback() });
			} catch (err) {
				console.error("WA fallback send failed", err);
			}
			return;
		}

		const shortId = match[0];
		console.log("WA inbound parsed shortId", { fromPhone, shortId });
		const result = await ctx.runMutation(
			internal.whatsapp.confirmOrderFromWhatsApp,
			{ shortId, fromPhone, profileName },
		);
		console.log("WA confirm result", { fromPhone, shortId, ...result });

		if (!result.matched) {
			console.log("WA confirm not matched → fallback", { shortId, fromPhone });
			try {
				await wa.send(fromPhone, { kind: "text", body: fallback() });
			} catch (err) {
				console.error("WA fallback send failed", err);
			}
			return;
		}

		const meta = await ctx.runQuery(
			internal.whatsapp.getRetailerLocaleForOrder,
			{ shortId },
		);
		const locale = pickLocale(meta?.locale);
		const storeName = meta?.storeName ?? "Kedaipal";
		const contactPhone = meta?.retailerWaPhone;
		const appUrl = process.env.APP_URL ?? "https://kedaipal.com";
		const trackingUrl = `${appUrl}/track/${shortId}`;
		const confirmBody = renderMessage(
			meta?.messageTemplates,
			locale,
			"confirm",
			{ shortId, storeName, contactPhone, trackingUrl, deliveryMethod: meta?.deliveryMethod ?? "delivery" },
		);
		// Hard-coded, non-overridable: tells the shopper to use the order ID as
		// the transfer reference. This is the only deterministic way the retailer
		// can match a bank notification to an order, so it must always be present
		// regardless of any retailer-customised confirm template.
		const transferReferenceLine = renderSystemMessage(
			locale,
			"transferReferenceLine",
			{ shortId, storeName },
		);
		const paymentBlock = renderPaymentInstructions(
			locale,
			meta?.payment.instructions,
		);
		const pickupBlock = renderPickupBlock(locale, meta?.pickupSnapshot);
		// Layout: confirm → [pickup block] → blank line → transfer reference →
		// [payment block]. Pickup goes first so the buyer sees the WHERE before
		// the WHEN/HOW of paying.
		const confirmWithPickup = pickupBlock
			? `${confirmBody}\n${pickupBlock}`
			: confirmBody;
		const confirmWithRef = `${confirmWithPickup}\n\n${transferReferenceLine}`;
		const body = paymentBlock
			? `${confirmWithRef}\n${paymentBlock}`
			: confirmWithRef;
		const brandImageUrl = "https://kedaipal.com/logo-2.png";
		// Emit a CTA intent — the adapter renders it as a tappable "I've paid"
		// button in prod and degrades to a plain image with caption when the
		// channel/environment can't honour interactive buttons (e.g. non-HTTPS
		// APP_URL in dev).
		try {
			await wa.send(fromPhone, {
				kind: "cta",
				body,
				buttonText: "I've paid",
				url: trackingUrl,
				imageUrl: brandImageUrl,
			});
		} catch (err) {
			// Fall back to plain text if interactive/image send fails
			console.error("WA confirm send failed, falling back to text", err);
			try {
				await wa.send(fromPhone, { kind: "text", body });
			} catch (textErr) {
				console.error("WA confirm send failed", textErr);
			}
		}

		// Location pin — sent as a follow-up so the buyer gets a tappable map
		// preview that opens in their default maps app. For self-collect orders
		// the pin points at the pickup spot; for delivery it points at the
		// buyer's destination. Skipped when no coordinates were captured (legacy
		// orders / buyers who didn't pick a Google suggestion). Failures are
		// isolated from the confirm reply.
		const locationPin = meta ? resolveLocationPin(meta) : undefined;
		if (locationPin) {
			try {
				await wa.send(fromPhone, {
					kind: "location",
					latitude: locationPin.latitude,
					longitude: locationPin.longitude,
					name: locationPin.name,
					address: locationPin.address,
				});
			} catch (err) {
				console.error("WA location pin send failed", err);
			}
		}

		// QR image, if configured, is sent as a follow-up image message so the
		// shopper can long-press to save it. Failures are isolated from the text
		// reply above.
		const qrUrl = meta?.payment.qrImageUrl;
		if (qrUrl) {
			try {
				await wa.send(fromPhone, {
					kind: "image",
					imageUrl: qrUrl,
					caption: paymentQrCaption(locale),
				});
			} catch (err) {
				console.error("WA payment QR send failed", err);
			}
		}

		// Email the retailer about the newly confirmed order (only on first
		// confirmation, not idempotent re-sends). Fire-and-forget via scheduler.
		if (!result.alreadyConfirmed && result.orderId) {
			await ctx.scheduler.runAfter(
				0,
				internal.email.notifyRetailerOrderAlert,
				{ orderId: result.orderId },
			);
		}
	},
});

/**
 * Scheduled by orders.updateStatus. Sends a localized status update to the
 * shopper. Errors are swallowed (logged) so the originating mutation never
 * fails because of an outbound network issue.
 */
export const notifyStatusChange = internalAction({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }): Promise<void> => {
		type Meta = {
			shortId: string;
			status: Doc<"orders">["status"];
			customerWaPhone: string | undefined;
			storeName: string;
			retailerWaPhone: string | undefined;
			retailerSlug: string;
			carrierTrackingUrl: string | undefined;
			deliveryMethod: DeliveryMethod;
			locale: Locale;
			messageTemplates: MessageTemplates | undefined;
		};
		let meta: Meta | null = null;
		try {
			meta = await ctx.runQuery(internal.whatsapp.getOrderWithRetailer, {
				orderId,
			});
		} catch (err) {
			console.error("WA notify lookup failed", err);
			return;
		}
		if (!meta) return;
		if (!meta.customerWaPhone) return;
		if (meta.status === "pending" || meta.status === "confirmed") return;

		const appUrl = process.env.APP_URL ?? "https://kedaipal.com";
		const trackingUrl = `${appUrl}/track/${meta.shortId}`;
		const locale = pickLocale(meta.locale);
		const body = renderMessage(meta.messageTemplates, locale, meta.status, {
			shortId: meta.shortId,
			storeName: meta.storeName,
			contactPhone: meta.retailerWaPhone,
			trackingUrl,
			carrierTrackingUrl: meta.carrierTrackingUrl,
			deliveryMethod: meta.deliveryMethod,
		});
		try {
			await getAdapter("whatsapp").send(meta.customerWaPhone, {
				kind: "text",
				body,
			});
		} catch (err) {
			console.error("WA status notify failed", err);
		}
	},
});

/**
 * Scheduled by orders.markPaymentReceived. Sends a localized "payment received"
 * message to the shopper. Same swallow-errors / no-op-on-missing-waPhone shape
 * as `notifyStatusChange`. Bypasses the regular status pipeline because the
 * payment dimension is independent and we don't want to send two messages
 * when this fires alongside an auto-confirm.
 */
export const notifyPaymentReceived = internalAction({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }): Promise<void> => {
		type Meta = {
			shortId: string;
			status: Doc<"orders">["status"];
			customerWaPhone: string | undefined;
			storeName: string;
			retailerWaPhone: string | undefined;
			retailerSlug: string;
			carrierTrackingUrl: string | undefined;
			deliveryMethod: DeliveryMethod;
			locale: Locale;
			messageTemplates: MessageTemplates | undefined;
		};
		let meta: Meta | null = null;
		try {
			meta = await ctx.runQuery(internal.whatsapp.getOrderWithRetailer, {
				orderId,
			});
		} catch (err) {
			console.error("WA payment-received lookup failed", err);
			return;
		}
		if (!meta) return;
		if (!meta.customerWaPhone) return;

		const appUrl = process.env.APP_URL ?? "https://kedaipal.com";
		const trackingUrl = `${appUrl}/track/${meta.shortId}`;
		const locale = pickLocale(meta.locale);
		const body = renderSystemMessage(locale, "paymentReceived", {
			shortId: meta.shortId,
			storeName: meta.storeName,
			trackingUrl,
		});
		try {
			await getAdapter("whatsapp").send(meta.customerWaPhone, {
				kind: "text",
				body,
			});
		} catch (err) {
			console.error("WA payment-received send failed", err);
		}
	},
});

// Re-export validator for tests / other modules.
export { statusValidator };

// ---------------------------------------------------------------------------
// Diagnostic helpers
// ---------------------------------------------------------------------------

/**
 * One-shot diagnostic: send a canned WhatsApp message to a retailer's saved
 * waPhone so we can verify Meta Cloud API delivery end-to-end independently of
 * the order flow. Invoke with:
 *   npx convex run whatsapp:sendTestRetailerAlert '{"retailerId":"..."}'
 */
export const sendTestRetailerAlert = internalAction({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<void> => {
		const retailer = await ctx.runQuery(
			internal.whatsapp.getRetailerForDiagnostic,
			{ retailerId },
		);
		if (!retailer) {
			console.error(`Diagnostic skipped: retailer not found (id=${retailerId})`);
			return;
		}
		if (!retailer.waPhone) {
			console.error(
				`Diagnostic skipped: retailer waPhone is empty (id=${retailerId}, storeName=${retailer.storeName})`,
			);
			return;
		}
		try {
			await getAdapter("whatsapp").send(retailer.waPhone, {
				kind: "text",
				body: `Kedaipal test alert for ${retailer.storeName}. If you see this, WhatsApp delivery is working.`,
			});
			console.log(
				`Diagnostic alert sent (storeName=${retailer.storeName}, to=${retailer.waPhone})`,
			);
		} catch (err) {
			console.error(
				`Diagnostic alert failed (storeName=${retailer.storeName}, to=${retailer.waPhone}): ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
			throw err;
		}
	},
});

export const getRetailerForDiagnostic = internalQuery({
	args: { retailerId: v.id("retailers") },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{ waPhone: string | undefined; storeName: string } | null> => {
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) return null;
		return { waPhone: retailer.waPhone, storeName: retailer.storeName };
	},
});
