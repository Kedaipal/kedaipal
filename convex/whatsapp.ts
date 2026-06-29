import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalAction,
	internalMutation,
	internalQuery,
} from "./_generated/server";
import { linkOrderToCustomer, refreshWaProfileName } from "./customers";
import { type GuardedSender, makeGuardedSender } from "./wabaProtection";
import { classifyOptOutKeyword } from "./lib/wabaLimits";
import { isMockupGateClosed } from "./lib/order";
import {
	type LegacyPaymentInstructions,
	type PaymentMethod,
	resolvePaymentMethods,
} from "./lib/payment";
import {
	type OrderStage,
	resolveStages,
	stageDescription,
	stageLabel,
	type StatusLabels,
} from "./lib/orderStatus";
import { assertValidWaPhone } from "./lib/slug";
import {
	paymentQrCaption,
	pickLocale,
	renderMessage,
	renderPaymentMethods,
	renderPickupBlock,
	renderStageUpdate,
	renderSystemMessage,
	type DeliveryMethod,
	type Locale,
	type MessageTemplates,
	type PickupSnapshot,
} from "./lib/whatsappCopy";
import { classifyInbound } from "./lib/inboundIntent";

// A payment method with its QR storage id resolved to a viewable URL (qr only).
type ResolvedPaymentMethod = PaymentMethod & { qrImageUrl?: string };

type ResolvedPayment = {
	methods: ResolvedPaymentMethod[];
};

/**
 * Resolve a retailer's payment methods (legacy-aware) and turn each `qr`
 * method's storage id into a viewable URL for the confirm/payment messages.
 */
async function resolvePaymentForMessage(
	ctx: { storage: { getUrl: (id: string) => Promise<string | null> } },
	retailer: {
		paymentMethods?: PaymentMethod[];
		paymentInstructions?: LegacyPaymentInstructions;
	},
): Promise<ResolvedPayment> {
	const methods = resolvePaymentMethods(retailer);
	const resolved: ResolvedPaymentMethod[] = [];
	for (const m of methods) {
		let qrImageUrl: string | undefined;
		if (m.type === "qr" && m.qrImageStorageId) {
			const url = await ctx.storage.getUrl(m.qrImageStorageId);
			qrImageUrl = url ?? undefined;
		}
		resolved.push({ ...m, qrImageUrl });
	}
	return { methods: resolved };
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
		retailerId: Id<"retailers">;
		shortId: string;
		trackingToken: string | undefined;
		status: Doc<"orders">["status"];
		customerWaPhone: string | undefined;
		storeName: string;
		retailerWaPhone: string | undefined;
		retailerSlug: string;
		carrierTrackingUrl: string | undefined;
		deliveryMethod: DeliveryMethod;
		locale: Locale;
		messageTemplates: MessageTemplates | undefined;
		// Phase 2: stage config + this order's current stage, for stage-update
		// notifications (notifyStageEntry).
		orderStages: OrderStage[] | undefined;
		statusLabels: StatusLabels | undefined;
		currentStageId: string | undefined;
	} | null> => {
		const order = await ctx.db.get(orderId);
		if (!order) return null;
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) return null;
		return {
			retailerId: order.retailerId,
			shortId: order.shortId,
			trackingToken: order.trackingToken,
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
			orderStages: retailer.orderStages as OrderStage[] | undefined,
			statusLabels: retailer.statusLabels as StatusLabels | undefined,
			currentStageId: order.currentStageId,
		};
	},
});

export const getRetailerLocaleForOrder = internalQuery({
	args: { shortId: v.string() },
	handler: async (
		ctx,
		{ shortId },
	): Promise<{
		retailerId: Id<"retailers">;
		locale: Locale;
		storeName: string;
		trackingToken: string | undefined;
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
		return {
			retailerId: order.retailerId,
			locale: (retailer.locale as Locale | undefined) ?? "en",
			storeName: retailer.storeName,
			trackingToken: order.trackingToken,
			retailerWaPhone: retailer.waPhone,
			messageTemplates: retailer.messageTemplates as
				| MessageTemplates
				| undefined,
			deliveryMethod: (order.deliveryMethod as DeliveryMethod | undefined) ?? "delivery",
			pickupSnapshot: order.pickupSnapshot,
			payment: await resolvePaymentForMessage(ctx, retailer),
			mockupPending: isMockupGateClosed(order),
		};
	},
});

/**
 * Send the buyer the payment ask: `introBody` (the confirm template, or a
 * mockup-approved/waived intro) → [pickup block] → transfer-reference line →
 * [payment block], rendered as an "I've paid" CTA (degrades to text), followed
 * by the QR image if configured. Shared by the confirm reply and the
 * post-mockup payment prompt so both stay byte-for-byte consistent.
 */
async function sendPaymentMessage(
	wa: GuardedSender,
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
	const paymentBlock = renderPaymentMethods(locale, payment.methods);
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
	// Each configured QR method follows as its own image (captioned with the
	// method label, so a buyer with several QRs knows which is which) so they can
	// long-press to save it. Failures are isolated from the message above.
	for (const m of payment.methods) {
		if (m.type !== "qr" || !m.qrImageUrl) continue;
		try {
			await wa.send(toPhone, {
				kind: "image",
				imageUrl: m.qrImageUrl,
				caption: paymentQrCaption(locale, m.label),
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

		// Pre-confirm replies below (checkout bind, unknown/no-match fallbacks) have
		// no attributable seller yet, so they use a system-scoped, session-category
		// guarded sender: per-seller caps are skipped but the global WABA-health
		// halt, opt-out, and audit log still apply. Once an order is matched we
		// switch to a seller-bound transactional sender.
		const wa = makeGuardedSender(ctx, null, "session_message");

		// Global opt-out / opt-in keywords (STOP/BERHENTI/UNSUB, START/MULA) —
		// checked before any other intent so a STOP is never treated as an order.
		// The opt-out list is global across the shared WABA. The ack reply is
		// transactional so it isn't suppressed by the opt-out we just registered.
		const optKeyword = classifyOptOutKeyword(text);
		if (optKeyword) {
			const ack = makeGuardedSender(ctx, null, "transactional");
			if (optKeyword.kind === "out") {
				await ctx.runMutation(internal.wabaProtection.registerOptOut, {
					waPhone: fromPhone,
					source: optKeyword.source,
				});
				try {
					await ack.send(fromPhone, {
						kind: "text",
						body: "You've been unsubscribed from Kedaipal store marketing messages. Order updates for active orders still apply. Reply START to resubscribe.\n\nAnda telah berhenti melanggan mesej pemasaran kedai Kedaipal. Balas MULA untuk melanggan semula.",
					});
				} catch (err) {
					console.error("WA opt-out ack failed", err);
				}
			} else {
				await ctx.runMutation(internal.wabaProtection.reactivateOptIn, {
					waPhone: fromPhone,
				});
				try {
					await ack.send(fromPhone, {
						kind: "text",
						body: "You're resubscribed and will receive updates again. Reply STOP to unsubscribe anytime.\n\nAnda telah melanggan semula. Balas STOP untuk berhenti.",
					});
				} catch (err) {
					console.error("WA opt-in ack failed", err);
				}
			}
			return;
		}

		const intent = classifyInbound(text);

		// Counter Checkout: the buyer scanned the seller's `KP-<token>` QR. Bind
		// their WhatsApp identity to the session (the seller's dashboard flips live)
		// and reply so the buyer knows it worked. See docs/counter-checkout.md.
		if (intent.kind === "checkout_bind") {
			const bind = await ctx.runMutation(
				internal.counterCheckout.bindCheckoutSession,
				{ token: intent.token, waPhone: fromPhone, profileName },
			);
			console.log("WA checkout bind", { fromPhone, result: bind.result });
			const body =
				bind.result === "bound"
					? `✅ You're connected to ${bind.storeName}. The cashier will confirm your order shortly.`
					: bind.result === "expired"
						? "This checkout link has expired — please ask the cashier to show a fresh QR."
						: bind.result === "already_used"
							? "This checkout link has already been used. Please ask the cashier for a new QR if you'd like to order again."
							: fallback();
			try {
				await wa.send(fromPhone, { kind: "text", body });
			} catch (err) {
				console.error("WA checkout-bind reply failed", err);
			}
			return;
		}

		if (intent.kind === "unknown") {
			console.log("WA inbound unknown intent → fallback", { fromPhone });
			try {
				await wa.send(fromPhone, { kind: "text", body: fallback() });
			} catch (err) {
				console.error("WA fallback send failed", err);
			}
			return;
		}

		const shortId = intent.shortId;
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
		// Order matched → attribute the confirm/payment sends to the seller so the
		// per-seller guardrails + audit apply. These are transactional (order
		// confirmation), so they bypass opt-out/pause/caps — the core promise.
		const sellerWa = meta?.retailerId
			? makeGuardedSender(ctx, meta.retailerId, "transactional")
			: makeGuardedSender(ctx, null, "transactional");
		const locale = pickLocale(meta?.locale);
		const storeName = meta?.storeName ?? "Kedaipal";
		const contactPhone = meta?.retailerWaPhone;
		const appUrl = process.env.APP_URL ?? "https://kedaipal.com";
		// Never build a tokenless `/track/` link (a dead URL): self-heal a missing
		// token for pre-migration orders. result.orderId is set whenever matched.
		const trackingToken =
			meta?.trackingToken ??
			(result.orderId
				? await ctx.runMutation(internal.orders.ensureTrackingToken, {
						orderId: result.orderId,
					})
				: null);
		const trackingUrl = `${appUrl}/track/${trackingToken ?? ""}`;

		if (meta?.mockupPending) {
			// Order still has a custom item awaiting buyer mockup approval — defer
			// the payment ask. Same branded layout as the normal confirm (logo
			// header + pickup block) but WITHOUT the transfer-reference line,
			// payment block, QR, or "I've paid" CTA — there's no price to pay yet.
			// The full payment prompt follows on approval/waiver (notifyPaymentDue).
			const gatedConfirm = renderSystemMessage(locale, "mockupPendingConfirm", {
				shortId,
				storeName,
				contactPhone,
				trackingUrl,
			});
			const pickupBlock = renderPickupBlock(locale, meta?.pickupSnapshot);
			const gatedBody = pickupBlock
				? `${gatedConfirm}\n${pickupBlock}`
				: gatedConfirm;
			const brandImageUrl = "https://kedaipal.com/logo-2.png";
			try {
				// Image message carries the brand logo as the header without needing
				// an interactive button (which would force a CTA we don't want here).
				await sellerWa.send(fromPhone, {
					kind: "image",
					imageUrl: brandImageUrl,
					caption: gatedBody,
				});
			} catch (err) {
				console.error("WA gated-confirm send failed, falling back to text", err);
				try {
					await sellerWa.send(fromPhone, { kind: "text", body: gatedBody });
				} catch (textErr) {
					console.error("WA gated-confirm send failed", textErr);
				}
			}
		} else {
			const confirmBody = renderMessage(
				meta?.messageTemplates,
				locale,
				"confirm",
				{ shortId, storeName, contactPhone, trackingUrl, deliveryMethod: meta?.deliveryMethod ?? "delivery" },
			);
			await sendPaymentMessage(sellerWa, fromPhone, {
				introBody: confirmBody,
				locale,
				shortId,
				storeName,
				trackingUrl,
				pickupSnapshot: meta?.pickupSnapshot,
				payment: meta?.payment ?? { methods: [] },
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
			retailerId: Id<"retailers">;
			shortId: string;
			trackingToken: string | undefined;
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
		const trackingToken =
			meta.trackingToken ??
			(await ctx.runMutation(internal.orders.ensureTrackingToken, { orderId }));
		if (!trackingToken) return; // order vanished — don't ship a dead link
		const trackingUrl = `${appUrl}/track/${trackingToken}`;
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
			await makeGuardedSender(ctx, meta.retailerId, "transactional").send(meta.customerWaPhone, {
				kind: "text",
				body,
			});
		} catch (err) {
			console.error("WA status notify failed", err);
		}
	},
});

/**
 * Phase 2: scheduled by orders.advanceToStage when a seller advances an order
 * into a custom stage that does NOT cross a canonical anchor (so the rich status
 * templates in `notifyStatusChange` don't fire) and the stage has `notify: true`
 * — e.g. Cleaning → Washing, both anchored to `packed`. Sends one generic
 * stage-update message built from the stage's (store-locale) label + optional
 * description. Same swallow-errors / no-op-on-missing-waPhone shape as the other
 * notify actions. Anchor-CROSSING moves go through notifyStatusChange instead,
 * so this never double-sends.
 */
export const notifyStageEntry = internalAction({
	args: { orderId: v.id("orders"), stageId: v.string() },
	handler: async (ctx, { orderId, stageId }): Promise<void> => {
		const meta = await ctx
			.runQuery(internal.whatsapp.getOrderWithRetailer, { orderId })
			.catch((err) => {
				console.error("WA stage-update lookup failed", err);
				return null;
			});
		if (!meta) return;
		if (!meta.customerWaPhone) return;

		const locale = pickLocale(meta.locale);
		const stages = resolveStages({
			orderStages: meta.orderStages,
			labels: meta.statusLabels,
			deliveryMethod: meta.deliveryMethod,
		});
		const stage = stages.find((s) => s.id === stageId);
		if (!stage) return; // stage was deleted between schedule + run — drop silently

		const appUrl = process.env.APP_URL ?? "https://kedaipal.com";
		const trackingToken =
			meta.trackingToken ??
			(await ctx.runMutation(internal.orders.ensureTrackingToken, { orderId }));
		if (!trackingToken) return; // order vanished — don't ship a dead link
		const body = renderStageUpdate(locale, {
			shortId: meta.shortId,
			stageLabel: stageLabel(stage, locale),
			stageDescription: stageDescription(stage, locale),
			trackingUrl: `${appUrl}/track/${trackingToken}`,
			contactPhone: meta.retailerWaPhone,
		});
		try {
			await makeGuardedSender(ctx, meta.retailerId, "transactional").send(meta.customerWaPhone, {
				kind: "text",
				body,
			});
		} catch (err) {
			console.error("WA stage-update notify failed", err);
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
			retailerId: Id<"retailers">;
			shortId: string;
			trackingToken: string | undefined;
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
		const trackingToken =
			meta.trackingToken ??
			(await ctx.runMutation(internal.orders.ensureTrackingToken, { orderId }));
		if (!trackingToken) return; // order vanished — don't ship a dead link
		const trackingUrl = `${appUrl}/track/${trackingToken}`;
		const locale = pickLocale(meta.locale);
		const body = renderSystemMessage(locale, "paymentReceived", {
			shortId: meta.shortId,
			storeName: meta.storeName,
			trackingUrl,
		});
		try {
			await makeGuardedSender(ctx, meta.retailerId, "transactional").send(meta.customerWaPhone, {
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
		retailerId: Id<"retailers">;
		shortId: string;
		trackingToken: string | undefined;
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
			retailerId: order.retailerId,
			shortId: order.shortId,
			trackingToken: order.trackingToken,
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
			retailerId: Id<"retailers">;
			shortId: string;
			trackingToken: string | undefined;
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
		const trackingToken =
			meta.trackingToken ??
			(await ctx.runMutation(internal.orders.ensureTrackingToken, { orderId }));
		if (!trackingToken) return; // order vanished — don't ship a dead link
		const trackingUrl = `${appUrl}/track/${trackingToken}`;
		const greeting = meta.customerName ? ` ${meta.customerName}` : "";
		const body =
			meta.locale === "ms"
				? `Hai${greeting}! Mockup untuk pesanan ${meta.shortId} dari ${meta.storeName} sudah siap. Sila semak dan luluskan sebelum kami mula membuatnya: ${trackingUrl}`
				: `Hi${greeting}! The mockup for your ${meta.storeName} order ${meta.shortId} is ready. Please review and approve it before we start making it: ${trackingUrl}`;
		const buttonText = meta.locale === "ms" ? "Semak mockup" : "Review mockup";

		const wa = makeGuardedSender(ctx, meta.retailerId, "transactional");
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
		retailerId: Id<"retailers">;
		shortId: string;
		trackingToken: string | undefined;
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
		return {
			retailerId: order.retailerId,
			shortId: order.shortId,
			trackingToken: order.trackingToken,
			customerWaPhone: order.customer.waPhone,
			locale: (retailer.locale as Locale | undefined) ?? "en",
			storeName: retailer.storeName,
			pickupSnapshot: order.pickupSnapshot,
			payment: await resolvePaymentForMessage(ctx, retailer),
		};
	},
});

/**
 * Scheduled by orders.approveMockup / orders.waiveMockup, and by
 * orders.declineMockupItem when a buyer drops the custom item from a mixed order
 * (the ready-made remainder is now payable). Now that the mockup gate is open,
 * send the buyer the payment ask (the "I've paid" prompt) that was deferred at
 * confirm time. `reason` only picks the intro line; the payment body is
 * identical to the standard confirm reply. Errors swallowed (logged).
 */
export const notifyPaymentDue = internalAction({
	args: {
		orderId: v.id("orders"),
		reason: v.union(
			v.literal("approved"),
			v.literal("waived"),
			v.literal("declined"),
		),
	},
	handler: async (ctx, { orderId, reason }): Promise<void> => {
		let meta: {
			retailerId: Id<"retailers">;
			shortId: string;
			trackingToken: string | undefined;
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
		const trackingToken =
			meta.trackingToken ??
			(await ctx.runMutation(internal.orders.ensureTrackingToken, { orderId }));
		if (!trackingToken) return; // order vanished — don't ship a dead link
		const trackingUrl = `${appUrl}/track/${trackingToken}`;
		const introKey =
			reason === "approved"
				? "paymentDueApproved"
				: reason === "waived"
					? "paymentDueWaived"
					: "paymentDueDeclined";
		const introBody = renderSystemMessage(meta.locale, introKey, {
			shortId: meta.shortId,
			storeName: meta.storeName,
		});
		const wa = makeGuardedSender(ctx, meta.retailerId, "transactional");
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
			await makeGuardedSender(ctx, retailerId, "transactional").send(retailer.waPhone, {
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

// --- Founding Member welcome (docs/manual-subscription.md) ------------------

export const getFoundingWelcomeMeta = internalQuery({
	args: { retailerId: v.id("retailers") },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{
		waPhone: string | undefined;
		storeName: string;
		locale: Locale;
	} | null> => {
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) return null;
		return {
			waPhone: retailer.waPhone,
			storeName: retailer.storeName,
			locale: (retailer.locale as Locale | undefined) ?? "en",
		};
	},
});

/** Stamp `welcomedAt` on the retailer's founding-member row after the send. */
export const markFoundingWelcomed = internalMutation({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<void> => {
		const row = await ctx.db
			.query("foundingMembers")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		if (row && row.welcomedAt === undefined) {
			await ctx.db.patch(row._id, { welcomedAt: Date.now() });
		}
	},
});

/**
 * Scheduled by invoices.markPaid when a Founding rank is claimed. Sends the
 * "Welcome, Founding Member #N of 10" WhatsApp to the retailer (the seller), then
 * stamps welcomedAt. Errors swallowed (logged) so the originating mutation never
 * fails on an outbound issue.
 */
export const notifyFoundingWelcome = internalAction({
	args: { retailerId: v.id("retailers"), rank: v.number() },
	handler: async (ctx, { retailerId, rank }): Promise<void> => {
		let meta: {
			waPhone: string | undefined;
			storeName: string;
			locale: Locale;
		} | null = null;
		try {
			meta = await ctx.runQuery(internal.whatsapp.getFoundingWelcomeMeta, {
				retailerId,
			});
		} catch (err) {
			console.error("WA founding-welcome lookup failed", err);
			return;
		}
		if (!meta || !meta.waPhone) return;

		const appUrl = process.env.APP_URL ?? "https://kedaipal.com";
		const billingUrl = `${appUrl}/app/settings?tab=billing`;
		const body =
			meta.locale === "ms"
				? `🎉 Tahniah! Anda kini Founding Member #${rank} dari 10 di Kedaipal. Terima kasih kerana mempercayai kami awal — diskaun 30% seumur hidup anda kekal selamanya. Pasukan kami akan hubungi anda untuk sesi white-glove. Butiran: ${billingUrl}`
				: `🎉 Welcome, Founding Member #${rank} of 10! Thank you for backing Kedaipal early — your 30% lifetime discount is locked in for good. We'll reach out to set up your white-glove onboarding call. Details: ${billingUrl}`;
		try {
			await makeGuardedSender(ctx, retailerId, "transactional").send(meta.waPhone, {
				kind: "text",
				body,
			});
			await ctx.runMutation(internal.whatsapp.markFoundingWelcomed, {
				retailerId,
			});
		} catch (err) {
			console.error("WA founding-welcome send failed", err);
		}
	},
});

// --- Counter Checkout (docs/counter-checkout.md) ----------------------------

/** Load the data needed to send a buyer their counter-order confirmation. */
export const getCounterOrderMeta = internalQuery({
	args: { orderId: v.id("orders") },
	handler: async (
		ctx,
		{ orderId },
	): Promise<{
		retailerId: Id<"retailers">;
		customerWaPhone: string | undefined;
		storeName: string;
		locale: Locale;
		shortId: string;
		trackingToken: string | undefined;
		total: number;
		currency: string;
		paymentStatus: "unpaid" | "claimed" | "received";
	} | null> => {
		const order = await ctx.db.get(orderId);
		if (!order) return null;
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) return null;
		return {
			retailerId: order.retailerId,
			customerWaPhone: order.customer.waPhone,
			storeName: retailer.storeName,
			locale: (retailer.locale as Locale | undefined) ?? "en",
			shortId: order.shortId,
			trackingToken: order.trackingToken,
			total: order.total,
			currency: order.currency,
			paymentStatus: (order.paymentStatus ?? "unpaid") as
				| "unpaid"
				| "claimed"
				| "received",
		};
	},
});

/**
 * Scheduled by counterCheckout.createOrderFromSession. Sends the buyer a free-form
 * order confirmation + tracking link (their KP scan opened the 24h CS window).
 * Branches on payment: "received" when settled in-person, otherwise a pay-&-track
 * nudge. Errors swallowed (logged) so the originating mutation never fails on an
 * outbound issue.
 */
export const notifyCounterOrderCreated = internalAction({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }): Promise<void> => {
		const meta = await ctx
			.runQuery(internal.whatsapp.getCounterOrderMeta, { orderId })
			.catch((err) => {
				console.error("WA counter-order lookup failed", err);
				return null;
			});
		if (!meta || !meta.customerWaPhone) return;

		const appUrl = process.env.APP_URL ?? "https://kedaipal.com";
		const trackingToken =
			meta.trackingToken ??
			(await ctx.runMutation(internal.orders.ensureTrackingToken, { orderId }));
		if (!trackingToken) return;
		const trackingUrl = `${appUrl}/track/${trackingToken}`;
		const money = `${meta.currency} ${(meta.total / 100).toFixed(2)}`;
		const paid = meta.paymentStatus === "received";

		const body =
			meta.locale === "ms"
				? paid
					? `🧾 Pesanan ${meta.shortId} disahkan di ${meta.storeName}. Jumlah ${money}. ✅ Pembayaran diterima — terima kasih! Jejak pesanan: ${trackingUrl}`
					: `🧾 Pesanan ${meta.shortId} disahkan di ${meta.storeName}. Jumlah ${money}. Bayar & jejak pesanan di sini: ${trackingUrl}`
				: paid
					? `🧾 Order ${meta.shortId} confirmed at ${meta.storeName}. Total ${money}. ✅ Payment received — thank you! Track your order: ${trackingUrl}`
					: `🧾 Order ${meta.shortId} confirmed at ${meta.storeName}. Total ${money}. Pay & track your order here: ${trackingUrl}`;
		try {
			await makeGuardedSender(ctx, meta.retailerId, "transactional").send(meta.customerWaPhone, {
				kind: "text",
				body,
			});
		} catch (err) {
			console.error("WA counter-order notify failed", err);
		}
	},
});
