import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	type ActionCtx,
	internalAction,
	internalQuery,
} from "./_generated/server";
import { sendEmail } from "./lib/email";
import {
	type DeliveryMethod,
	type Locale,
	renderRetailerEmail,
	type RetailerEmailKey,
} from "./lib/emailCopy";
import { formatFulfilmentDate } from "./lib/fulfilmentDate";

/**
 * Internal query for the email action to load order + retailer email + locale.
 * Mirrors whatsapp.getOrderForRetailerAlert but returns notifyEmail instead of
 * the retailer's WhatsApp number.
 *
 * Also returns the payment-claim fields so the action can render the
 * `paymentClaimed` template without a second roundtrip.
 */
export const getOrderForRetailerEmail = internalQuery({
	args: { orderId: v.id("orders") },
	handler: async (
		ctx,
		{ orderId },
	): Promise<{
		shortId: string;
		status: Doc<"orders">["status"];
		itemCount: number;
		total: number;
		currency: string;
		customerName: string;
		deliveryMethod: DeliveryMethod;
		fulfilmentDate: number | undefined;
		notifyEmail: string | undefined;
		storeName: string;
		locale: Locale;
		paymentReference: string | undefined;
		paymentProofStorageId: string | undefined;
		mockupChangeNote: string | undefined;
		requiresMockup: boolean;
	} | null> => {
		const order = await ctx.db.get(orderId);
		if (!order) return null;
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) return null;
		return {
			shortId: order.shortId,
			status: order.status,
			itemCount: order.items.reduce((sum, i) => sum + i.quantity, 0),
			total: order.total,
			currency: order.currency,
			customerName: order.customer.name ?? "Anonymous",
			deliveryMethod: (order.deliveryMethod as DeliveryMethod | undefined) ?? "delivery",
			fulfilmentDate: order.fulfilmentDate,
			notifyEmail: retailer.notifyEmail,
			storeName: retailer.storeName,
			locale: (retailer.locale as Locale | undefined) ?? "en",
			paymentReference: order.paymentReference,
			paymentProofStorageId: order.paymentProofStorageId,
			mockupChangeNote: order.mockupChangeNote,
			// A set mockupStatus means the order has a made-to-order custom line.
			requiresMockup: order.mockupStatus !== undefined,
		};
	},
});

/**
 * Seller alerts for the mockup-approval loop. Scheduled from
 * orders.approveMockup / orders.requestMockupChanges. Fire-and-forget; errors
 * are swallowed so the buyer's mutation never fails on an outbound issue.
 */
async function sendMockupSellerEmail(
	ctx: ActionCtx,
	orderId: Id<"orders">,
	key: "mockupApproved" | "mockupChangesRequested" | "mockupDeclined",
): Promise<void> {
	let meta: {
		shortId: string;
		itemCount: number;
		total: number;
		currency: string;
		customerName: string;
		deliveryMethod: DeliveryMethod;
		notifyEmail: string | undefined;
		storeName: string;
		locale: Locale;
		mockupChangeNote: string | undefined;
	} | null = null;
	try {
		meta = await ctx.runQuery(internal.email.getOrderForRetailerEmail, {
			orderId,
		});
	} catch (err) {
		console.error(`Email ${key} lookup failed`, err);
		return;
	}
	if (!meta || !meta.notifyEmail) return;

	const totalFormatted = `${meta.currency} ${(meta.total / 100).toFixed(2)}`;
	const dashboardUrl = `${process.env.SITE_URL ?? "https://kedaipal.com"}/app/orders/${meta.shortId}`;
	const { subject, html, text } = renderRetailerEmail(meta.locale, key, {
		shortId: meta.shortId,
		itemCount: meta.itemCount,
		totalFormatted,
		customerName: meta.customerName,
		deliveryMethod: meta.deliveryMethod,
		storeName: meta.storeName,
		dashboardUrl,
		mockupChangeNote: meta.mockupChangeNote,
	});
	try {
		await sendEmail(meta.notifyEmail, subject, html, text);
	} catch (err) {
		console.error(
			`Email ${key} failed (shortId=${meta.shortId}): ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

export const notifyMockupApproved = internalAction({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }): Promise<void> => {
		await sendMockupSellerEmail(ctx, orderId, "mockupApproved");
	},
});

export const notifyMockupChangesRequested = internalAction({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }): Promise<void> => {
		await sendMockupSellerEmail(ctx, orderId, "mockupChangesRequested");
	},
});

export const notifyMockupDeclined = internalAction({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }): Promise<void> => {
		await sendMockupSellerEmail(ctx, orderId, "mockupDeclined");
	},
});

/**
 * Scheduled by orders.create (newOrder) and whatsapp.handleInbound after a
 * successful ORD-XXXX match (orderConfirmed). Sends the retailer an email
 * alert. Errors are swallowed (logged) so the originating mutation never fails
 * because of an outbound issue.
 */
export const notifyRetailerOrderAlert = internalAction({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }): Promise<void> => {
		let meta: {
			shortId: string;
			status: Doc<"orders">["status"];
			itemCount: number;
			total: number;
			currency: string;
			customerName: string;
			deliveryMethod: DeliveryMethod;
			fulfilmentDate: number | undefined;
			notifyEmail: string | undefined;
			storeName: string;
			locale: Locale;
			requiresMockup: boolean;
		} | null = null;
		try {
			meta = await ctx.runQuery(internal.email.getOrderForRetailerEmail, {
				orderId,
			});
		} catch (err) {
			console.error("Email retailer notify lookup failed", err);
			return;
		}
		if (!meta) {
			console.error(
				`Email retailer alert skipped: no order meta (orderId=${orderId})`,
			);
			return;
		}
		if (!meta.notifyEmail) {
			console.warn(
				`Email retailer alert skipped: notifyEmail is empty (orderId=${orderId}, shortId=${meta.shortId})`,
			);
			return;
		}

		const alertKey: RetailerEmailKey =
			meta.status === "pending" ? "newOrder" : "orderConfirmed";
		const totalFormatted = `${meta.currency} ${(meta.total / 100).toFixed(2)}`;
		const dashboardUrl = `${process.env.SITE_URL ?? "https://kedaipal.com"}/app/orders/${meta.shortId}`;

		const { subject, html, text } = renderRetailerEmail(meta.locale, alertKey, {
			shortId: meta.shortId,
			itemCount: meta.itemCount,
			totalFormatted,
			customerName: meta.customerName,
			deliveryMethod: meta.deliveryMethod,
			storeName: meta.storeName,
			dashboardUrl,
			requiresMockup: meta.requiresMockup,
			fulfilmentDateLabel:
				meta.fulfilmentDate !== undefined
					? formatFulfilmentDate(meta.fulfilmentDate)
					: undefined,
		});

		try {
			await sendEmail(meta.notifyEmail, subject, html, text);
		} catch (err) {
			console.error(
				`Email retailer alert failed (shortId=${meta.shortId}, to=${meta.notifyEmail}): ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}
	},
});

/**
 * Scheduled by orders.claimPayment. Emails the retailer that a shopper has
 * tapped "I've paid" on the tracking page. Includes the optional reference
 * and a resolved storage URL for the screenshot, when available. Same skip
 * conditions and swallow-errors pattern as `notifyRetailerOrderAlert`.
 */
export const notifyPaymentClaimed = internalAction({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }): Promise<void> => {
		let meta: {
			shortId: string;
			status: Doc<"orders">["status"];
			itemCount: number;
			total: number;
			currency: string;
			customerName: string;
			deliveryMethod: DeliveryMethod;
			notifyEmail: string | undefined;
			storeName: string;
			locale: Locale;
			paymentReference: string | undefined;
			paymentProofStorageId: string | undefined;
		} | null = null;
		try {
			meta = await ctx.runQuery(internal.email.getOrderForRetailerEmail, {
				orderId,
			});
		} catch (err) {
			console.error("Email payment-claimed lookup failed", err);
			return;
		}
		if (!meta) {
			console.error(
				`Email payment-claimed skipped: no order meta (orderId=${orderId})`,
			);
			return;
		}
		if (!meta.notifyEmail) {
			console.warn(
				`Email payment-claimed skipped: notifyEmail is empty (orderId=${orderId}, shortId=${meta.shortId})`,
			);
			return;
		}

		let proofUrl: string | undefined;
		if (meta.paymentProofStorageId) {
			try {
				const url = await ctx.storage.getUrl(meta.paymentProofStorageId);
				proofUrl = url ?? undefined;
			} catch (err) {
				console.error(
					`Email payment-claimed proof URL resolve failed (shortId=${meta.shortId}): ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
			}
		}

		const totalFormatted = `${meta.currency} ${(meta.total / 100).toFixed(2)}`;
		const dashboardUrl = `${process.env.SITE_URL ?? "https://kedaipal.com"}/app/orders/${meta.shortId}`;

		const { subject, html, text } = renderRetailerEmail(
			meta.locale,
			"paymentClaimed",
			{
				shortId: meta.shortId,
				itemCount: meta.itemCount,
				totalFormatted,
				customerName: meta.customerName,
				deliveryMethod: meta.deliveryMethod,
				storeName: meta.storeName,
				dashboardUrl,
				paymentReference: meta.paymentReference,
				proofUrl,
			},
		);

		try {
			await sendEmail(meta.notifyEmail, subject, html, text);
		} catch (err) {
			console.error(
				`Email payment-claimed failed (shortId=${meta.shortId}, to=${meta.notifyEmail}): ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}
	},
});
