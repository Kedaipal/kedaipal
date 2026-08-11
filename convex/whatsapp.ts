import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalAction,
	internalMutation,
	internalQuery,
} from "./_generated/server";
import {
	linkOrderToCustomer,
	moveOrderToPhone,
	refreshWaProfileName,
} from "./customers";
import {
	orderConfirmTemplateName,
	WhatsAppSendError,
} from "./lib/whatsapp";
import {
	type ConfirmationPushStatus,
	classifyPushFailure,
	pushOwnsTheMessage,
} from "./lib/confirmationPush";
import { type GuardedSender, makeGuardedSender } from "./wabaProtection";
import { stampRetailerActivation } from "./lib/activation";
import { classifyOptOutKeyword } from "./lib/wabaLimits";
import { isMockupGateClosed, isMockupPriceUnsettled } from "./lib/order";
import type { OrderStage, StatusLabels } from "./lib/orderStatus";
import { assertValidWaPhone } from "./lib/slug";
import {
	pickLocale,
	poweredByLine,
	privacyNoticeLine,
	renderDeliveryFeeLine,
	renderMessage,
	renderPickupBlock,
	renderSystemMessage,
	type DeliveryMethod,
	type Locale,
	type MessageTemplates,
	type PickupKind,
	type PickupSnapshot,
} from "./lib/whatsappCopy";
import { classifyInbound } from "./lib/inboundIntent";

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
		/**
		 * This inbound rescued an order whose confirmation push had FAILED — we
		 * just flipped it to "recovered". The caller needs this because the flip
		 * happens before it re-reads the order, so by then the status alone can no
		 * longer distinguish "already messaged, stay quiet" from "never reached
		 * them, this reply is their one message". See the guard in handleInbound.
		 */
		pushRecovered: boolean;
		orderId?: Id<"orders">;
		retailerId?: Id<"retailers">;
	}> => {
		const order = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		if (!order)
			return { matched: false, alreadyConfirmed: false, pushRecovered: false };

		const now = Date.now();
		const wasPending = order.status === "pending";
		const patch: Partial<Doc<"orders">> = { updatedAt: now };
		if (!order.customer.waPhone) {
			patch.customer = { ...order.customer, waPhone: fromPhone };
		}
		// Failed-push recovery (86eyf1rck): the confirmation push bounced off the
		// checkout-typed number, and the buyer just proved ownership of this order
		// by sending its ORD ref from a WORKING WhatsApp — adopt the sender's
		// number so every later message (status updates, payment ask) reaches
		// them, and clear the failure ("recovered" hides the tracking-page repair
		// card + the seller's amber note). Deliberately narrow: a healthy order's
		// stored number is never overwritten by a forwarded message — only a
		// FAILED push unlocks the re-stamp. The actual phone move + CRM relink is
		// applied below via the shared moveOrderToPhone.
		const pushFailed = order.confirmationPushStatus === "failed";
		const adoptSenderPhone =
			pushFailed &&
			!!order.customer.waPhone &&
			order.customer.waPhone !== fromPhone;
		if (pushFailed) {
			patch.confirmationPushStatus = "recovered";
		}
		if (wasPending) {
			patch.status = "confirmed";
		}
		// Persist status/phone changes (skip a pure updatedAt churn-write when
		// nothing else changed, preserving the previous idempotent behaviour).
		if (wasPending || patch.customer !== undefined || pushFailed) {
			await ctx.db.patch(order._id, patch);
		}
		if (wasPending) {
			await ctx.db.insert("orderEvents", {
				orderId: order._id,
				status: "confirmed",
				note: "Confirmed via WhatsApp",
				createdAt: now,
			});
			// First order reaching confirmed activates the store (one-time stamp).
			await stampRetailerActivation(ctx, order.retailerId, now);
		}

		// Customer linking + pushname capture. Orders that arrived with a phone
		// were already linked at checkout (customerId set) — skip to avoid double
		// counting. Phone-less orders are linked here (the late-bind case).
		let customerId = order.customerId;
		if (adoptSenderPhone) {
			// Recovery: move the order (and its CRM aggregates) off the typo'd
			// number onto the sender's real one. Shared with the buyer's own
			// "update number" repair so the two can't drift.
			customerId = await moveOrderToPhone(ctx, {
				// Re-read so the patch above (status/recovered) is reflected.
				order: (await ctx.db.get(order._id)) ?? order,
				newPhone: fromPhone,
			});
		}
		if (!customerId) {
			const linkPhone = patch.customer?.waPhone ?? order.customer.waPhone ?? fromPhone;
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
			pushRecovered: pushFailed,
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
		courierName: string | undefined;
		trackingNo: string | undefined;
		deliveryMethod: DeliveryMethod;
		// The order's frozen pickup kind — drives "pickup" vs "drop-off point"
		// wording in status copy. Undefined for delivery orders + legacy snapshots.
		pickupKind: PickupKind | undefined;
		paymentStatus: Doc<"orders">["paymentStatus"];
		total: number;
		currency: string;
		locale: Locale;
		messageTemplates: MessageTemplates | undefined;
		// Phase 2: stage config + this order's current stage, for stage-update
		// notifications (notifyStageEntry).
		orderStages: OrderStage[] | undefined;
		statusLabels: StatusLabels | undefined;
		currentStageId: string | undefined;
		// Lets an in-flight confirmation-push retry bail out when the buyer has
		// already been reached (86eyf1rck).
		confirmationPushStatus: Doc<"orders">["confirmationPushStatus"];
		// The two price holds (86eyfq0w5): while either is open the deferred
		// push must NOT fire — the template's total would be wrong. The mockup
		// hold asks whether a quote EXISTS (86eyd63r8), not whether the buyer has
		// approved it: the message goes out at submit, so `submitted` and
		// `changes_requested` both carry a real total.
		mockupPriceUnsettled: boolean;
		deliveryFeePending: boolean;
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
			courierName: order.courierName,
			trackingNo: order.trackingNo,
			deliveryMethod: (order.deliveryMethod as DeliveryMethod | undefined) ?? "delivery",
			pickupKind: (order.pickupSnapshot as PickupSnapshot | undefined)
				?.locationType,
			paymentStatus: order.paymentStatus,
			total: order.total,
			currency: order.currency,
			locale: (retailer.locale as Locale | undefined) ?? "en",
			messageTemplates: retailer.messageTemplates as
				| MessageTemplates
				| undefined,
			orderStages: retailer.orderStages as OrderStage[] | undefined,
			statusLabels: retailer.statusLabels as StatusLabels | undefined,
			currentStageId: order.currentStageId,
			confirmationPushStatus: order.confirmationPushStatus,
			mockupPriceUnsettled: isMockupPriceUnsettled(order),
			deliveryFeePending: order.deliveryFeePending === true,
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
		// Frozen trip direction (86eyg0n8e) — flips the confirm's "we'll update
		// you when it ships" line to collection wording.
		deliveryDirection: "standard" | "collection" | undefined;
		pickupSnapshot: PickupSnapshot | undefined;
		// Frozen delivery charge — renders the fee line in the confirm reply.
		deliverySnapshot: { fee: number } | undefined;
		// Order currency — needed to render the pickup-fee line in the block.
		currency: string;
		// True while a custom item still awaits buyer mockup approval — the
		// payment prompt is deferred until the gate opens (approve or waive).
		mockupPending: boolean;
		// True while the delivery charge awaits seller confirmation (radius
		// "arrange" order) — payment is deferred until orders.setDeliveryFee.
		deliveryFeePending: boolean;
		// The order already has (or is about to get) its ONE message via the
		// confirmation-push template, so this inbound reply must stay silent —
		// see the `pushOwnsTheMessage` guard in handleInbound.
		confirmationPushStatus: ConfirmationPushStatus | undefined;
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
			confirmationPushStatus: order.confirmationPushStatus as
				| ConfirmationPushStatus
				| undefined,
			locale: (retailer.locale as Locale | undefined) ?? "en",
			storeName: retailer.storeName,
			trackingToken: order.trackingToken,
			retailerWaPhone: retailer.waPhone,
			messageTemplates: retailer.messageTemplates as
				| MessageTemplates
				| undefined,
			deliveryMethod: (order.deliveryMethod as DeliveryMethod | undefined) ?? "delivery",
			deliveryDirection: order.deliveryDirection,
			pickupSnapshot: order.pickupSnapshot,
			deliverySnapshot: order.deliverySnapshot,
			currency: order.currency,
			mockupPending: isMockupGateClosed(order),
			deliveryFeePending: order.deliveryFeePending === true,
		};
	},
});

/**
 * Send the buyer the payment ask: `introBody` (the confirm template, or a
 * mockup-approved/waived/delivery-fee intro) → [pickup | delivery-fee block] →
 * transfer-reference line, with a "Make payment" CTA button (degrades to text).
 * Shared by the confirm reply and the post-mockup / delivery-fee payment
 * prompts so they all stay byte-for-byte consistent.
 *
 * Bank/QR details are NOT sent in chat (ticket 86ey98ju1) — the buyer is
 * pointed to their order page ("How to pay") via the intro's own link + the
 * "Make payment" button. The order-page link lives in the intro copy (every
 * intro carries it), so this function appends no separate "see how to pay"
 * block — the buyer sees the link exactly once.
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
		// Frozen delivery charge — rendered as its own line under the intro so
		// the buyer sees why the total is higher than the item sum. Optional;
		// callers for pickup/counter orders omit it.
		deliverySnapshot?: { fee: number };
		// Order currency for the pickup-fee / delivery-fee lines. Optional —
		// callers whose snapshot can't carry a fee (counter orders) omit it.
		currency?: string;
		// Optional trailing block appended to the very END of the message body,
		// e.g. the always-on "Powered by Kedaipal" growth line on order
		// confirmations. Include its own leading newlines.
		footerLine?: string;
	},
): Promise<void> {
	const {
		introBody,
		locale,
		shortId,
		storeName,
		trackingUrl,
		pickupSnapshot,
		deliverySnapshot,
		currency,
		footerLine = "",
	} = args;
	// Hard-coded, non-overridable: tells the shopper to use the order ID as the
	// transfer reference — the only deterministic way to match a bank
	// notification to an order, so it's always present.
	const transferReferenceLine = renderSystemMessage(locale, "transferReferenceLine", {
		shortId,
		storeName,
	});
	const pickupBlock = renderPickupBlock(locale, pickupSnapshot, currency);
	// Delivery-fee line (delivery orders) — sits where the pickup block would
	// (an order has one or the other), explaining the total before the pay ask.
	const deliveryFeeLine = renderDeliveryFeeLine(locale, deliverySnapshot, currency);
	// Layout: intro (carries the order-page link) → [pickup | delivery fee] →
	// blank line → transfer reference. The WHERE/WHY before the WHEN/HOW of paying.
	const withPickup = pickupBlock
		? `${introBody}\n${pickupBlock}`
		: `${introBody}${deliveryFeeLine}`;
	const withRef = `${withPickup}\n\n${transferReferenceLine}`;
	// Growth footer (e.g. "Powered by Kedaipal") sits last, quiet and out of the
	// way of the actionable content.
	const body = `${withRef}${footerLine}`;
	const brandImageUrl = "https://kedaipal.com/logo-2.png";
	// CTA intent — the adapter renders a tappable "Make payment" button in prod
	// and degrades to a plain image with caption when buttons can't be honoured
	// (e.g. non-HTTPS APP_URL in dev). The button opens the buyer's order page,
	// where "How to pay" + the "I've paid" confirm live.
	try {
		await wa.send(toPhone, {
			kind: "cta",
			body,
			buttonText: "Make payment",
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

		// Store QR poster: the buyer scanned the seller's PERMANENT printed QR
		// (`KPS-<token>`, 86ey5m35w). Start (or re-claim) a walk-in counter session
		// — it pops up on the cashier's open-checkouts list — then ack + push the
		// payment details so the buyer can pay while they queue. The ack carries
		// the privacy-policy link (PDPA notice at collection — a poster buyer never
		// touches the website before their number is stored).
		if (intent.kind === "store_checkout_start") {
			const start = await ctx.runMutation(
				internal.counterCheckout.startSessionFromStoreQr,
				{ token: intent.token, waPhone: fromPhone, profileName },
			);
			console.log("WA store-qr scan", { fromPhone, result: start.result });
			if (start.result === "not_found") {
				// Unknown/rotated poster token — generic hint, no store leaked.
				try {
					await wa.send(fromPhone, { kind: "text", body: fallback() });
				} catch (err) {
					console.error("WA store-qr fallback send failed", err);
				}
				return;
			}
			const body = renderSystemMessage(
				start.locale,
				start.result === "started" ? "storeQrConnected" : "storeQrBusy",
				{
					shortId: "",
					storeName: start.storeName,
					// The pairing code the buyer shows the cashier (started only).
					code: start.result === "started" ? start.code : undefined,
				},
			);
			try {
				await wa.send(fromPhone, { kind: "text", body });
			} catch (err) {
				console.error("WA store-qr reply failed", err);
			}
			// No payment details are pushed at scan any more (ticket 86ey98ju1 — raw
			// bank details out of chat, and no order/tracking page exists yet at scan
			// time). The buyer gets the "see how to pay on your order page" CTA once
			// the cashier rings up the order (notifyCounterOrderCreated).
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

		// One message per order (86eyd63r8). On the push path the buyer's message
		// is the confirmation template — already sent, in flight, or waiting on a
		// final price — so replying here would be a SECOND billable send for the
		// same order. That happens more than it looks: an old `?send=1` link, a
		// forwarded chat, or the buyer simply re-sending their reference. The
		// confirm above still ran (status/customer/pushname are updated) — only
		// the outbound reply is suppressed. `failed` deliberately still replies:
		// that push reached nobody, so this IS the buyer's one message and their
		// recovery route (confirmOrderFromWhatsApp just re-stamped "recovered").
		if (
			pushOwnsTheMessage(meta?.confirmationPushStatus) &&
			!result.pushRecovered
		) {
			if (!result.alreadyConfirmed && result.orderId) {
				await ctx.scheduler.runAfter(
					0,
					internal.email.notifyRetailerOrderAlert,
					{ orderId: result.orderId },
				);
			}
			return;
		}

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
			const pickupBlock = renderPickupBlock(
				locale,
				meta?.pickupSnapshot,
				meta?.currency,
			);
			const gatedBody =
				(pickupBlock ? `${gatedConfirm}\n${pickupBlock}` : gatedConfirm) +
				// Same always-on growth line as the normal confirm — a custom-order
				// buyer still sees it on their "order received" message.
				poweredByLine(locale);
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
		} else if (meta?.deliveryFeePending) {
			// Delivery charge still to be confirmed by the seller (radius-mode
			// "arrange" order) — same hold as the mockup branch above: branded
			// confirm, no transfer reference / payment block / "I've paid" CTA.
			// The payment prompt follows when the seller sets the charge
			// (orders.setDeliveryFee → notifyDeliveryFeeSet).
			const heldConfirm = renderSystemMessage(
				locale,
				"deliveryFeePendingConfirm",
				{ shortId, storeName, contactPhone, trackingUrl },
			);
			const heldBody = heldConfirm + poweredByLine(locale);
			const brandImageUrl = "https://kedaipal.com/logo-2.png";
			try {
				await sellerWa.send(fromPhone, {
					kind: "image",
					imageUrl: brandImageUrl,
					caption: heldBody,
				});
			} catch (err) {
				console.error("WA fee-held confirm send failed, falling back to text", err);
				try {
					await sellerWa.send(fromPhone, { kind: "text", body: heldBody });
				} catch (textErr) {
					console.error("WA fee-held confirm send failed", textErr);
				}
			}
		} else {
			const confirmBody = renderMessage(
				meta?.messageTemplates,
				locale,
				"confirm",
				{
					shortId,
					storeName,
					contactPhone,
					trackingUrl,
					deliveryMethod: meta?.deliveryMethod ?? "delivery",
					deliveryDirection: meta?.deliveryDirection,
					pickupKind: meta?.pickupSnapshot?.locationType,
				},
			);
			await sendPaymentMessage(sellerWa, fromPhone, {
				introBody: confirmBody,
				locale,
				shortId,
				storeName,
				trackingUrl,
				pickupSnapshot: meta?.pickupSnapshot,
				deliverySnapshot: meta?.deliverySnapshot,
				currency: meta?.currency,
				// Always-on growth line — appended here (not in the confirm template)
				// so a retailer's template override can't strip it. See poweredByLine.
				footerLine: poweredByLine(locale),
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

// NOTE (86eyd63r8, one message per order): every proactive AUTOMATIC buyer
// notification that used to live here — status changes, custom stage pings,
// payment received, mockup submitted, the payment-due prompts,
// delivery-fee-set, the day-11 reminder cron and the Lalamove
// proof-of-delivery photos — has been removed. An order gets exactly ONE
// automatic outbound WhatsApp: the confirmation push below, sent once the
// price is final. Everything that followed it is on the tracking page.
// The single seller-DRIVEN exception is notifyManualPaymentReminder — one
// human tap per send, window-boxed to days 11–14 (docs/payment-reminder.md).
// See docs/one-message-per-order.md.

/**
 * Metadata for the seller's manual payment reminder. Only fields the send
 * needs; the auth + eligibility + cooldown stamp already ran atomically in
 * orders.prepareManualReminder — the re-checks here only cover the state
 * changing between the seller's tap and this action running.
 */
export const getManualReminderContext = internalQuery({
	args: { orderId: v.id("orders") },
	handler: async (
		ctx,
		{ orderId },
	): Promise<{
		retailerId: Id<"retailers">;
		shortId: string;
		storeName: string;
		customerWaPhone: string | undefined;
		total: number;
		currency: string;
		trackingToken: string | undefined;
		locale: Locale;
		pickupSnapshot: PickupSnapshot | undefined;
		status: Doc<"orders">["status"];
		paymentStatus: Doc<"orders">["paymentStatus"];
		mockupPending: boolean;
		deliveryFeePending: boolean;
	} | null> => {
		const order = await ctx.db.get(orderId);
		if (!order) return null;
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) return null;
		return {
			retailerId: order.retailerId,
			shortId: order.shortId,
			storeName: retailer.storeName,
			customerWaPhone: order.customer.waPhone,
			total: order.total,
			currency: order.currency,
			trackingToken: order.trackingToken,
			locale: (retailer.locale as Locale | undefined) ?? "en",
			pickupSnapshot: order.pickupSnapshot,
			status: order.status,
			paymentStatus: order.paymentStatus,
			mockupPending: isMockupGateClosed(order),
			deliveryFeePending: order.deliveryFeePending === true,
		};
	},
});

/**
 * The seller's "Send payment reminder" (orders.sendPaymentReminder) — the ONE
 * deliberate exception to one-message-per-order, because each send is a human
 * decision, not an automation: available only on days 11–14 of the open-payment
 * window, at most once per 24h (both enforced in prepareManualReminder before
 * this is ever invoked). Re-sends the full payment message — reminder intro →
 * amount + transfer ref → "Make payment" CTA to the order page.
 *
 * Sent as a gated `session_message` (kill switch / caps / opt-outs apply) and
 * best-effort: by day 11 the buyer's 24h service window is almost always
 * closed, so a free-form send can silently not deliver (Meta 131047) unless
 * the buyer has messaged recently. The button's helper copy says so — and
 * moving this onto a registered utility template is part of the remaining
 * 86eyd63r8 template work, which fixes the deliverability for good.
 */
export const notifyManualPaymentReminder = internalAction({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }): Promise<void> => {
		const meta = await ctx
			.runQuery(internal.whatsapp.getManualReminderContext, { orderId })
			.catch((err) => {
				console.error("WA manual-reminder lookup failed", err);
				return null;
			});
		if (!meta) return;
		if (!meta.customerWaPhone) return;
		// Order left the "open + unpaid" state between the seller's tap and here.
		if (meta.status === "cancelled") return;
		if (meta.paymentStatus === "claimed" || meta.paymentStatus === "received")
			return;
		// Custom item re-gated (e.g. buyer requested changes) — payment isn't owed.
		if (meta.mockupPending) return;
		// Delivery charge re-flagged pending in the gap — the total isn't final.
		if (meta.deliveryFeePending) return;

		const appUrl = process.env.APP_URL ?? "https://kedaipal.com";
		const trackingToken =
			meta.trackingToken ??
			(await ctx.runMutation(internal.orders.ensureTrackingToken, { orderId }));
		if (!trackingToken) return; // order vanished — don't ship a dead link
		const locale = pickLocale(meta.locale);
		const trackingUrl = `${appUrl}/track/${trackingToken}`;
		const introBody = renderSystemMessage(locale, "paymentReminderIntro", {
			shortId: meta.shortId,
			storeName: meta.storeName,
			amount: `${meta.currency} ${(meta.total / 100).toFixed(2)}`,
			trackingUrl,
		});
		await sendPaymentMessage(
			makeGuardedSender(ctx, meta.retailerId, "session_message"),
			meta.customerWaPhone,
			{
				introBody,
				locale,
				shortId: meta.shortId,
				storeName: meta.storeName,
				trackingUrl,
				pickupSnapshot: meta.pickupSnapshot,
				currency: meta.currency,
			},
		);
	},
});

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

const foundingWelcomeBody: Record<Locale, (rank: number, billingUrl: string) => string> = {
	en: (rank, billingUrl) =>
		`🎉 Welcome, Founding Member #${rank} of 10! Thank you for backing Kedaipal early — your 30% lifetime discount is locked in for good. We'll reach out to set up your white-glove onboarding call. Details: ${billingUrl}`,
	ms: (rank, billingUrl) =>
		`🎉 Tahniah! Anda kini Founding Member #${rank} dari 10 di Kedaipal. Terima kasih kerana mempercayai kami awal — diskaun 30% seumur hidup anda kekal selamanya. Pasukan kami akan hubungi anda untuk sesi white-glove. Butiran: ${billingUrl}`,
	zh: (rank, billingUrl) =>
		`🎉 恭喜！您现在是 Kedaipal 10 位创始会员中的第 #${rank} 位。谢谢您这么早就信任我们 —— 您的终身 30% 折扣已经锁定，永久有效。我们的团队会联系您安排专属的入驻协助。详情：${billingUrl}`,
};

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
		const body = foundingWelcomeBody[meta.locale](rank, billingUrl);
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
 * Scheduled by orders.create when the confirmation-push path is active
 * (86eyf1rck): the buyer's number was captured at checkout and the order is
 * already `confirmed`, so this pushes the ONE outbound message the order gets
 * — the Meta-approved `order_confirmation_utility` template (storefront buyers
 * have no open service window; free-form text can't reach them). The template
 * body is fixed at approval — a seller's custom confirm template does NOT
 * apply here (it takes over from the first in-window message onward). Payment
 * details deliberately stay out of the push (86ey98ju1 posture): the button
 * lands the buyer on the order page's "How to pay".
 *
 * Outcome is stamped onto the order either way (recordConfirmationPush):
 * "sent" + Meta's wamid (the statuses webhook may later flip it to "failed"),
 * or "failed" when the send itself errors — the tracking page then shows the
 * manual wa.me Send card as recovery.
 */
export const notifyStorefrontOrderCreated = internalAction({
	args: {
		orderId: v.id("orders"),
		// 1-based; the scheduler passes attempt+1 when retrying a transient
		// failure. Absent = first try (so existing scheduled jobs stay valid).
		attempt: v.optional(v.number()),
	},
	handler: async (ctx, { orderId, attempt: attemptArg }): Promise<void> => {
		const attempt = attemptArg ?? 1;
		const templateName = orderConfirmTemplateName();
		if (!templateName) return; // push path inactive — nothing to send
		const meta = await ctx
			.runQuery(internal.whatsapp.getOrderWithRetailer, { orderId })
			.catch((err) => {
				console.error("WA storefront-order lookup failed", err);
				return null;
			});
		if (!meta || !meta.customerWaPhone) return;
		// A cancelled order's confirmation must never go out — reachable when a
		// deferred order is cancelled between a gate opening and this running.
		if (meta.status === "cancelled") return;
		// A push that already landed (or was superseded by the buyer reaching us
		// another way) must not be re-sent by an in-flight retry.
		if (
			meta.confirmationPushStatus === "sent" ||
			meta.confirmationPushStatus === "recovered"
		) {
			return;
		}
		// Hold guard, defence-in-depth (86eyfq0w5): the transactional claim in
		// orders.ts (claimDeferredPush) only stamps "sending" + schedules when no
		// price hold remains, so a legitimate invocation never trips this. It
		// stays because sending a wrong "Total: {{3}}" is the one mistake this
		// feature must never make, whatever schedules us.
		if (meta.mockupPriceUnsettled || meta.deliveryFeePending) {
			console.warn("WA confirm push refused: price not final", {
				shortId: meta.shortId,
				mockupPriceUnsettled: meta.mockupPriceUnsettled,
				deliveryFeePending: meta.deliveryFeePending,
			});
			return;
		}

		const trackingToken =
			meta.trackingToken ??
			(await ctx.runMutation(internal.orders.ensureTrackingToken, { orderId }));
		if (!trackingToken) return; // order vanished — don't ship a dead link
		const locale = pickLocale(meta.locale);
		// Only EN + BM template variants are approved; zh rides EN until the
		// Mandarin phase 2/3 submits (and this map gains) a zh variant.
		const languageCode = locale === "ms" ? "ms" : "en";
		const money = `${meta.currency} ${(meta.total / 100).toFixed(2)}`;

		const wa = makeGuardedSender(ctx, meta.retailerId, "transactional");
		try {
			const receipt = await wa.send(meta.customerWaPhone, {
				kind: "template",
				templateName,
				languageCode,
				bodyParams: [meta.shortId, meta.storeName, money],
				// The approved button URL is https://kedaipal.com/track/{{1}} — Meta
				// appends ONLY this suffix (the tracking token, not the shortId).
				urlButtonParam: trackingToken,
			});
			if (receipt?.blocked) {
				// The WABA gateway suppressed it (opt-out, cap, pause). Not our
				// buyer's fault and not retryable here — the gateway is the policy.
				// Transactional bypasses gating today, so this is defence in depth.
				await ctx.runMutation(internal.orders.recordConfirmationPush, {
					orderId,
					status: "failed",
					failureKind: "system",
				});
				return;
			}
			await ctx.runMutation(internal.orders.recordConfirmationPush, {
				orderId,
				status: "sent",
				wamid: receipt?.providerMessageId,
			});
		} catch (err) {
			// Retry a blip rather than handing our problem to the buyer; give up
			// immediately on anything Meta will reject identically next time.
			const outcome = classifyPushFailure(
				err instanceof WhatsAppSendError
					? {
							httpStatus: err.httpStatus,
							metaCode: err.metaCode,
							responded: err.responded,
						}
					: // Not a send error at all (a bug in our own code path) — treat as
						// responded so it can't spin, and report it as ours.
						{ responded: true },
				attempt,
			);
			console.error("WA storefront confirm push failed", {
				shortId: meta.shortId,
				attempt,
				outcome,
				err,
			});
			if (outcome.retry) {
				await ctx.scheduler.runAfter(
					outcome.delayMs,
					internal.whatsapp.notifyStorefrontOrderCreated,
					{ orderId, attempt: attempt + 1 },
				);
				return;
			}
			await ctx.runMutation(internal.orders.recordConfirmationPush, {
				orderId,
				status: "failed",
				failureKind: outcome.kind,
			});
		}
	},
});

/**
 * Scheduled by counterCheckout.createOrderFromSession. The buyer scanned once, so
 * everything they need lands in that chat automatically — no rescan, no manual
 * seller step:
 *   - paid-in-person → a "confirmed & paid" text, then the RECEIPT PDF;
 *   - pay-later → the payment ask (transfer reference + an "I've paid" CTA that
 *     points to the order page's "How to pay", via the shared sendPaymentMessage),
 *     then the INVOICE PDF (whose "How to pay" block carries the actual details).
 * All sends are best-effort (errors logged) so the originating mutation never
 * fails on an outbound issue; the seller can resend the document from the Done
 * screen if needed.
 */
export const notifyCounterOrderCreated = internalAction({
	args: {
		orderId: v.id("orders"),
		// Append the PDPA notice-at-collection line to the confirmation. Set for a
		// manual-phone bind (86ey8vqp6) — the buyer never scanned, so this is our
		// first message to them. Scan buyers already got it in the connect ack.
		includePrivacyNotice: v.optional(v.boolean()),
	},
	handler: async (ctx, { orderId, includePrivacyNotice }): Promise<void> => {
		const meta = await ctx
			.runQuery(internal.whatsapp.getCounterOrderMeta, { orderId })
			.catch((err) => {
				console.error("WA counter-order lookup failed", err);
				return null;
			});
		// No buyer phone → nothing to send. Belt-and-braces: an anonymous walk-in
		// (86ey8vqp6) never schedules this action in the first place.
		if (!meta || !meta.customerWaPhone) return;

		const appUrl = process.env.APP_URL ?? "https://kedaipal.com";
		const trackingToken =
			meta.trackingToken ??
			(await ctx.runMutation(internal.orders.ensureTrackingToken, { orderId }));
		if (!trackingToken) return;
		const trackingUrl = `${appUrl}/track/${trackingToken}`;
		const money = `${meta.currency} ${(meta.total / 100).toFixed(2)}`;
		const paid = meta.paymentStatus === "received";
		const locale = pickLocale(meta.locale);
		const wa = makeGuardedSender(ctx, meta.retailerId, "transactional");
		// First-contact PDPA line for the manual-phone path (blank otherwise).
		const privacy = includePrivacyNotice ? privacyNoticeLine(locale) : "";

		if (paid) {
			const body =
				renderSystemMessage(locale, "counterOrderConfirmedPaid", {
					shortId: meta.shortId,
					storeName: meta.storeName,
					amount: money,
					trackingUrl,
				}) + privacy;
			try {
				await wa.send(meta.customerWaPhone, { kind: "text", body });
			} catch (err) {
				console.error("WA counter-order notify failed", err);
			}
		} else {
			// Pay-later: send the amount + transfer reference + "I've paid" CTA so the
			// buyer can settle from that chat without ever scanning again (boss ask).
			// Raw bank/QR details are never in chat (ticket 86ey98ju1) — the payment
			// CTA points to the order page's "How to pay", and the invoice PDF below
			// carries the details as the formal document.
			const intro =
				renderSystemMessage(locale, "counterOrderConfirmedUnpaid", {
					shortId: meta.shortId,
					storeName: meta.storeName,
					amount: money,
					trackingUrl,
				}) + privacy;
			try {
				await sendPaymentMessage(wa, meta.customerWaPhone, {
					introBody: intro,
					locale,
					shortId: meta.shortId,
					storeName: meta.storeName,
					trackingUrl,
					// Counter orders are collected at the counter — no pickup snapshot.
					pickupSnapshot: undefined,
				});
			} catch (err) {
				console.error("WA counter-order payment ask failed", err);
			}
		}

		// The receipt/invoice PDF is NOT WhatsApp'd (86eyd63r8) — that was this
		// order's second message, and a walk-in gets one like everyone else. The
		// PDF is still one tap away in both places it's actually wanted: the
		// cashier's Done screen (Download / Share, for handing it over there and
		// then) and the buyer's own tracking page, whose link is in the message
		// above.
	},
});
