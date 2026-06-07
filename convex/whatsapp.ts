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
import type { ChannelAdapter } from "./lib/channels/types";
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
		payment: ResolvedPayment;
		// True while a custom item still awaits buyer mockup approval — the
		// payment prompt is deferred until the gate opens (approve or waive).
		mockupPending: boolean;
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
			payment: { instructions, qrImageUrl },
			mockupPending: isMockupGateClosed(order),
		};
	},
});

/**
 * The mockup gate is "closed" while a custom item still needs buyer sign-off:
 * the order carries a `mockupStatus`, it isn't yet `approved`, and the seller
 * hasn't waived. While closed we defer the payment prompt (no "I've paid").
 * Open it by approving or waiving. Non-custom orders have no `mockupStatus` and
 * are never gated.
 */
function isMockupGateClosed(order: Doc<"orders">): boolean {
	return (
		order.mockupStatus !== undefined &&
		order.mockupStatus !== "approved" &&
		order.mockupWaivedAt === undefined
	);
}

/**
 * Send the buyer the payment ask: `introBody` (the confirm template, or a
 * mockup-approved/waived intro) → [pickup block] → transfer-reference line →
 * [payment block], rendered as an "I've paid" CTA (degrades to text), followed
 * by the QR image if configured. Shared by the confirm reply and the
 * post-mockup payment prompt so both stay byte-for-byte consistent.
 */
async function sendPaymentMessage(
	wa: ChannelAdapter,
	toPhone: string,
	args: {
		introBody: string;
		locale: Locale;
		shortId: string;
		storeName: string;
		trackingUrl: string;
		pickupSnapshot: PickupSnapshot | undefined;
		payment: ResolvedPayment;
	},
): Promise<void> {
	const { introBody, locale, shortId, storeName, trackingUrl, pickupSnapshot, payment } = args;
	// Hard-coded, non-overridable: tells the shopper to use the order ID as the
	// transfer reference — the only deterministic way to match a bank
	// notification to an order, so it's always present.
	const transferReferenceLine = renderSystemMessage(locale, "transferReferenceLine", {
		shortId,
		storeName,
	});
	const paymentBlock = renderPaymentInstructions(locale, payment.instructions);
	const pickupBlock = renderPickupBlock(locale, pickupSnapshot);
	// Layout: intro → [pickup] → blank line → transfer reference → [payment].
	// Pickup first so the buyer sees the WHERE before the WHEN/HOW of paying.
	const withPickup = pickupBlock ? `${introBody}\n${pickupBlock}` : introBody;
	const withRef = `${withPickup}\n\n${transferReferenceLine}`;
	const body = paymentBlock ? `${withRef}\n${paymentBlock}` : withRef;
	const brandImageUrl = "https://kedaipal.com/logo-2.png";
	// CTA intent — the adapter renders a tappable "I've paid" button in prod and
	// degrades to a plain image with caption when buttons can't be honoured
	// (e.g. non-HTTPS APP_URL in dev).
	try {
		await wa.send(toPhone, {
			kind: "cta",
			body,
			buttonText: "I've paid",
			url: trackingUrl,
			imageUrl: brandImageUrl,
		});
	} catch (err) {
		console.error("WA payment send failed, falling back to text", err);
		try {
			await wa.send(toPhone, { kind: "text", body });
		} catch (textErr) {
			console.error("WA payment send failed", textErr);
		}
	}
	// QR image, if configured, follows as a separate image so the buyer can
	// long-press to save it. Failures are isolated from the message above.
	if (payment.qrImageUrl) {
		try {
			await wa.send(toPhone, {
				kind: "image",
				imageUrl: payment.qrImageUrl,
				caption: paymentQrCaption(locale),
			});
		} catch (err) {
			console.error("WA payment QR send failed", err);
		}
	}
}

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

		if (meta?.mockupPending) {
			// Order still has a custom item awaiting buyer mockup approval — defer
			// the whole payment ask. Send a plain confirm telling them a design is
			// coming; the "I've paid" prompt follows on approval/waiver (see
			// notifyPaymentDue). No payment block, no QR, no CTA button.
			const gatedBody = renderSystemMessage(locale, "mockupPendingConfirm", {
				shortId,
				storeName,
				contactPhone,
				trackingUrl,
			});
			try {
				await wa.send(fromPhone, { kind: "text", body: gatedBody });
			} catch (err) {
				console.error("WA gated-confirm send failed", err);
			}
		} else {
			const confirmBody = renderMessage(
				meta?.messageTemplates,
				locale,
				"confirm",
				{ shortId, storeName, contactPhone, trackingUrl, deliveryMethod: meta?.deliveryMethod ?? "delivery" },
			);
			await sendPaymentMessage(wa, fromPhone, {
				introBody: confirmBody,
				locale,
				shortId,
				storeName,
				trackingUrl,
				pickupSnapshot: meta?.pickupSnapshot,
				payment: meta?.payment ?? { instructions: undefined, qrImageUrl: undefined },
			});
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

/**
 * Internal query: load the data needed to send a buyer the mockup for review.
 */
export const getMockupNotifyMeta = internalQuery({
	args: { orderId: v.id("orders") },
	handler: async (
		ctx,
		{ orderId },
	): Promise<{
		shortId: string;
		customerWaPhone: string | undefined;
		customerName: string | undefined;
		storeName: string;
		locale: Locale;
		mockupImageUrl: string | undefined;
	} | null> => {
		const order = await ctx.db.get(orderId);
		if (!order) return null;
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) return null;
		let mockupImageUrl: string | undefined;
		if (order.mockupImageStorageId) {
			const url = await ctx.storage.getUrl(order.mockupImageStorageId);
			mockupImageUrl = url ?? undefined;
		}
		return {
			shortId: order.shortId,
			customerWaPhone: order.customer.waPhone,
			customerName: order.customer.name,
			storeName: retailer.storeName,
			locale: (retailer.locale as Locale | undefined) ?? "en",
			mockupImageUrl,
		};
	},
});

/**
 * Scheduled by orders.submitMockup. Sends the buyer the mockup image + a CTA to
 * review/approve it on the tracking page. Errors swallowed (logged) so the
 * originating mutation never fails on an outbound issue.
 */
export const notifyMockupSubmitted = internalAction({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }): Promise<void> => {
		let meta: {
			shortId: string;
			customerWaPhone: string | undefined;
			customerName: string | undefined;
			storeName: string;
			locale: Locale;
			mockupImageUrl: string | undefined;
		} | null = null;
		try {
			meta = await ctx.runQuery(internal.whatsapp.getMockupNotifyMeta, {
				orderId,
			});
		} catch (err) {
			console.error("WA mockup-submitted lookup failed", err);
			return;
		}
		if (!meta || !meta.customerWaPhone) return;

		const appUrl = process.env.APP_URL ?? "https://kedaipal.com";
		const trackingUrl = `${appUrl}/track/${meta.shortId}`;
		const greeting = meta.customerName ? ` ${meta.customerName}` : "";
		const body =
			meta.locale === "ms"
				? `Hai${greeting}! Mockup untuk pesanan ${meta.shortId} dari ${meta.storeName} sudah siap. Sila semak dan luluskan sebelum kami mula membuatnya: ${trackingUrl}`
				: `Hi${greeting}! The mockup for your ${meta.storeName} order ${meta.shortId} is ready. Please review and approve it before we start making it: ${trackingUrl}`;
		const buttonText = meta.locale === "ms" ? "Semak mockup" : "Review mockup";

		const wa = getAdapter("whatsapp");
		try {
			await wa.send(
				meta.customerWaPhone,
				meta.mockupImageUrl
					? {
							kind: "cta",
							body,
							buttonText,
							url: trackingUrl,
							imageUrl: meta.mockupImageUrl,
						}
					: { kind: "text", body },
			);
		} catch (err) {
			console.error("WA mockup-submitted send failed, falling back to text", err);
			try {
				await wa.send(meta.customerWaPhone, { kind: "text", body });
			} catch (textErr) {
				console.error("WA mockup-submitted send failed", textErr);
			}
		}
	},
});

/**
 * Internal query: load everything needed to send the buyer a payment prompt
 * once the mockup gate opens. Distinct from getRetailerLocaleForOrder because
 * this path is keyed by orderId (scheduled from a mutation) and needs the
 * buyer's phone.
 */
export const getPaymentPromptMeta = internalQuery({
	args: { orderId: v.id("orders") },
	handler: async (
		ctx,
		{ orderId },
	): Promise<{
		shortId: string;
		customerWaPhone: string | undefined;
		locale: Locale;
		storeName: string;
		pickupSnapshot: PickupSnapshot | undefined;
		payment: ResolvedPayment;
	} | null> => {
		const order = await ctx.db.get(orderId);
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
			shortId: order.shortId,
			customerWaPhone: order.customer.waPhone,
			locale: (retailer.locale as Locale | undefined) ?? "en",
			storeName: retailer.storeName,
			pickupSnapshot: order.pickupSnapshot,
			payment: { instructions, qrImageUrl },
		};
	},
});

/**
 * Scheduled by orders.approveMockup / orders.waiveMockup. Now that the mockup
 * gate is open, send the buyer the payment ask (the "I've paid" prompt) that
 * was deferred at confirm time. `reason` only picks the intro line; the payment
 * body is identical to the standard confirm reply. Errors swallowed (logged).
 */
export const notifyPaymentDue = internalAction({
	args: {
		orderId: v.id("orders"),
		reason: v.union(v.literal("approved"), v.literal("waived")),
	},
	handler: async (ctx, { orderId, reason }): Promise<void> => {
		let meta: {
			shortId: string;
			customerWaPhone: string | undefined;
			locale: Locale;
			storeName: string;
			pickupSnapshot: PickupSnapshot | undefined;
			payment: ResolvedPayment;
		} | null = null;
		try {
			meta = await ctx.runQuery(internal.whatsapp.getPaymentPromptMeta, {
				orderId,
			});
		} catch (err) {
			console.error("WA payment-due lookup failed", err);
			return;
		}
		if (!meta || !meta.customerWaPhone) return;

		const appUrl = process.env.APP_URL ?? "https://kedaipal.com";
		const trackingUrl = `${appUrl}/track/${meta.shortId}`;
		const introBody = renderSystemMessage(
			meta.locale,
			reason === "approved" ? "paymentDueApproved" : "paymentDueWaived",
			{ shortId: meta.shortId, storeName: meta.storeName },
		);
		const wa = getAdapter("whatsapp");
		await sendPaymentMessage(wa, meta.customerWaPhone, {
			introBody,
			locale: meta.locale,
			shortId: meta.shortId,
			storeName: meta.storeName,
			trackingUrl,
			pickupSnapshot: meta.pickupSnapshot,
			payment: meta.payment,
		});
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
