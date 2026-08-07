/**
 * HitPay hosted-checkout for buyer payments (86eyb6z3a).
 *
 * Flow: the buyer taps "Pay now" on /track/<token> → `createCheckout` mints a
 * payment request against the SELLER's own HitPay account (BYO credentials on
 * `retailers.hitpay`) and returns the hosted-checkout URL → the buyer pays in
 * their bank/wallet app → HitPay's v1 completion webhook (`/webhook/hitpay` in
 * http.ts) and the redirect-return reconcile (`verifyCheckout`) both funnel
 * into `orders.receiveGatewayPayment`, which applies the exact
 * markPaymentReceived semantics (received + auto-confirm + WhatsApp receipt).
 *
 * Requests are LAZY (minted on tap, never at order create) so they always
 * price the CURRENT total and the mockup/delivery-fee holds gate them
 * naturally; a stale link paid after a re-price is caught by the receive
 * mutation's amount check. Kedaipal never touches the money — see
 * docs/hitpay-gateway.md.
 */

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	action,
	internalAction,
	internalMutation,
	internalQuery,
} from "./_generated/server";
import {
	buildPaymentRequestParams,
	decimalStringToSen,
	HITPAY_API_BASE,
	HITPAY_MIN_AMOUNT_SEN,
	HITPAY_REQUEST_REUSE_MS,
	type HitpayCredentials,
	type HitpayPaymentRequest,
	resolveHitpayCredentials,
} from "./lib/hitpay";
import { isMockupGateClosed } from "./lib/order";
import { rateLimiter } from "./lib/rateLimiter";
import { orderByToken } from "./orders";

/** Buyer-facing failure copy, shared by both actions so the two doors read
 * the same. */
const GATEWAY_UNAVAILABLE =
	"Online payment isn't available for this order — use the store's payment details instead.";
const GATEWAY_DOWN =
	"Couldn't reach the payment service — try again in a moment, or pay by bank transfer.";

type CheckoutContext = {
	orderId: Id<"orders">;
	shortId: string;
	trackingToken: string;
	status: Doc<"orders">["status"];
	paymentStatus: "unpaid" | "claimed" | "received";
	holdsOpen: boolean;
	total: number;
	currency: string;
	customerName: string | undefined;
	customerWaPhone: string | undefined;
	storeName: string;
	credentials: HitpayCredentials | null;
	enabled: boolean;
	existing: {
		requestId: string;
		url: string;
		amountSen: number;
		currency: string;
		mintedAt: number;
	} | null;
	gatewayPaymentId: string | undefined;
};

/** Everything both public actions need, resolved in one transaction. The
 * credentials ride an INTERNAL query result only — they never appear in a
 * public function's return value. */
export const getCheckoutContext = internalQuery({
	args: { token: v.string() },
	handler: async (ctx, { token }): Promise<CheckoutContext | null> => {
		const order = await orderByToken(ctx, token);
		if (!order) return null;
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) return null;
		const hitpay = retailer.hitpay;
		return {
			orderId: order._id,
			shortId: order.shortId,
			trackingToken: order.trackingToken ?? "",
			status: order.status,
			paymentStatus: order.paymentStatus ?? "unpaid",
			holdsOpen:
				!isMockupGateClosed(order) && order.deliveryFeePending !== true,
			total: order.total,
			currency: order.currency,
			customerName: order.customer.name,
			customerWaPhone: order.customer.waPhone,
			storeName: retailer.storeName,
			credentials: resolveHitpayCredentials(hitpay),
			enabled: hitpay?.enabled === true,
			existing:
				order.gatewayRequestId &&
				order.gatewayCheckoutUrl &&
				order.gatewayRequestedAmount !== undefined &&
				order.gatewayRequestedAt !== undefined
					? {
							requestId: order.gatewayRequestId,
							url: order.gatewayCheckoutUrl,
							amountSen: order.gatewayRequestedAmount,
							currency: order.gatewayRequestedCurrency ?? order.currency,
							mintedAt: order.gatewayRequestedAt,
						}
					: null,
			gatewayPaymentId: order.gatewayPaymentId,
		};
	},
});

/** Persist a freshly minted request onto the order — with a same-transaction
 * re-check that the world didn't move while the action was on the wire. Also
 * the opportunistic freshness path for the account's enabled-methods list:
 * every real mint echoes it, so the settings chips + buyer copy stay true
 * without extra API calls. */
export const recordCheckoutRequest = internalMutation({
	args: {
		orderId: v.id("orders"),
		requestId: v.string(),
		url: v.string(),
		amountSen: v.number(),
		currency: v.string(),
		accountMethods: v.optional(v.array(v.string())),
	},
	handler: async (
		ctx,
		{ orderId, requestId, url, amountSen, currency, accountMethods },
	): Promise<{ ok: boolean }> => {
		const order = await ctx.db.get(orderId);
		if (!order) return { ok: false };
		if (accountMethods && accountMethods.length > 0) {
			const retailer = await ctx.db.get(order.retailerId);
			if (retailer?.hitpay?.apiKey) {
				await ctx.db.patch(order.retailerId, {
					hitpay: {
						...retailer.hitpay,
						paymentMethods: accountMethods,
						methodsCheckedAt: Date.now(),
					},
				});
			}
		}
		// The order settled or re-priced between the action's read and now —
		// refuse to store the link. Nobody has seen this URL yet (the action
		// only returns it after we say ok), so the orphaned request just
		// expires on HitPay's side, unpaid.
		if ((order.paymentStatus ?? "unpaid") !== "unpaid") return { ok: false };
		if (order.total !== amountSen) return { ok: false };
		await ctx.db.patch(orderId, {
			gatewayRequestId: requestId,
			gatewayCheckoutUrl: url,
			gatewayRequestedAmount: amountSen,
			gatewayRequestedCurrency: currency,
			gatewayRequestedAt: Date.now(),
			updatedAt: Date.now(),
		});
		return { ok: true };
	},
});

/** Context for the connect-time probe (below). */
export const getRefreshContext = internalQuery({
	args: { retailerId: v.id("retailers") },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{ credentials: HitpayCredentials; currency: string } | null> => {
		const retailer = await ctx.db.get(retailerId);
		const credentials = resolveHitpayCredentials(retailer?.hitpay);
		if (!retailer || !credentials) return null;
		return { credentials, currency: retailer.currency ?? "MYR" };
	},
});

/** Stamp the probe's outcome. A null list with a fresh `methodsCheckedAt`
 * means "the key was rejected" — the settings card renders the check-your-key
 * warning off exactly that shape. */
export const recordAccountMethods = internalMutation({
	args: {
		retailerId: v.id("retailers"),
		methods: v.union(v.array(v.string()), v.null()),
	},
	handler: async (ctx, { retailerId, methods }): Promise<void> => {
		const retailer = await ctx.db.get(retailerId);
		if (!retailer?.hitpay?.apiKey) return;
		await ctx.db.patch(retailerId, {
			hitpay: {
				...retailer.hitpay,
				paymentMethods: methods ?? undefined,
				methodsCheckedAt: Date.now(),
			},
		});
	},
});

/**
 * Connect-time probe (scheduled by retailers.updateSettings whenever a
 * credential is stored): mints a throwaway 1.00 request that expires in 5
 * minutes to (a) validate the pasted key against the right environment and
 * (b) read back the ACCOUNT's enabled payment methods — the source of truth
 * for the settings chips and the buyer's Pay-now copy. A 401/403 records
 * "checked, no list" (bad key); transient failures record nothing and leave
 * any previous truth in place.
 */
export const refreshAccountMethods = internalAction({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<void> => {
		const context: {
			credentials: HitpayCredentials;
			currency: string;
		} | null = await ctx.runQuery(internal.hitpay.getRefreshContext, {
			retailerId,
		});
		if (!context) return;

		const params = new URLSearchParams();
		params.set("amount", "1.00");
		params.set("currency", context.currency.toUpperCase());
		params.set("purpose", "Kedaipal connection check — safe to ignore");
		params.set("reference_number", "KEDAIPAL-CONNECT");
		params.set("redirect_url", "https://kedaipal.com");
		params.set("send_sms", "false");
		params.set("send_email", "false");
		params.set("expires_after", "5 mins");

		let response: Response;
		try {
			response = await fetch(
				`${HITPAY_API_BASE[context.credentials.mode]}/payment-requests`,
				{
					method: "POST",
					headers: {
						"X-BUSINESS-API-KEY": context.credentials.apiKey,
						"Content-Type": "application/x-www-form-urlencoded",
						"X-Requested-With": "XMLHttpRequest",
					},
					body: params.toString(),
				},
			);
		} catch (err) {
			console.error("hitpay.refreshAccountMethods: probe failed", err);
			return;
		}
		if (response.status === 401 || response.status === 403) {
			console.warn("hitpay.refreshAccountMethods: key rejected", {
				retailerId,
			});
			await ctx.runMutation(internal.hitpay.recordAccountMethods, {
				retailerId,
				methods: null,
			});
			return;
		}
		if (!response.ok) {
			console.error("hitpay.refreshAccountMethods: probe rejected", {
				status: response.status,
				body: (await response.text()).slice(0, 300),
			});
			return;
		}
		const request = (await response.json()) as HitpayPaymentRequest;
		if (!request.payment_methods || request.payment_methods.length === 0) {
			return;
		}
		await ctx.runMutation(internal.hitpay.recordAccountMethods, {
			retailerId,
			methods: request.payment_methods,
		});
	},
});

/**
 * Public action: the buyer's "Pay now" tap. Returns the hosted-checkout URL
 * to redirect to (same tab). Token is the capability, exactly like
 * claimPayment; a fresh unexpired request for the same amount is reused so
 * two open tabs can't hold two live payable links.
 */
export const createCheckout = action({
	args: { token: v.string() },
	handler: async (ctx, { token }): Promise<{ url: string }> => {
		await rateLimiter.limit(ctx, "gatewayCheckout", {
			key: token,
			throws: true,
		});

		const context: CheckoutContext | null = await ctx.runQuery(
			internal.hitpay.getCheckoutContext,
			{ token },
		);
		if (!context) throw new ConvexError("Order not found");
		if (context.status === "cancelled") {
			throw new ConvexError("This order was cancelled");
		}
		if (context.paymentStatus === "received") {
			throw new ConvexError("Payment already confirmed");
		}
		if (context.paymentStatus === "claimed") {
			throw new ConvexError(
				"You've already told the store you paid — they're checking it now.",
			);
		}
		if (!context.holdsOpen) {
			// Mirrors claimPayment's holds: the total isn't final yet, so no
			// payment request may exist for it. The page hides Pay-now in these
			// states; this is defence against a direct call.
			throw new ConvexError(
				"The order total isn't confirmed yet — payment opens once the store finalises it.",
			);
		}
		if (
			!context.enabled ||
			!context.credentials ||
			context.total < HITPAY_MIN_AMOUNT_SEN
		) {
			throw new ConvexError(GATEWAY_UNAVAILABLE);
		}

		// Reuse a fresh, still-correct link — no new HitPay request, no second
		// live payable URL for the same order.
		const now = Date.now();
		if (
			context.existing &&
			context.existing.amountSen === context.total &&
			context.existing.currency.toUpperCase() ===
				context.currency.toUpperCase() &&
			now - context.existing.mintedAt < HITPAY_REQUEST_REUSE_MS
		) {
			return { url: context.existing.url };
		}

		const appUrl = process.env.APP_URL ?? "https://kedaipal.com";
		// Convex system env var — the deployment's own HTTP-actions origin.
		// Missing (odd local/test setups) degrades gracefully: no webhook param,
		// and the redirect-return reconcile still confirms the payment.
		const siteUrl = process.env.CONVEX_SITE_URL;
		if (!siteUrl) {
			console.error(
				"hitpay.createCheckout: CONVEX_SITE_URL unset — minting request without a webhook; relying on redirect reconcile",
			);
		}
		const params = buildPaymentRequestParams({
			amountSen: context.total,
			currency: context.currency,
			shortId: context.shortId,
			storeName: context.storeName,
			redirectUrl: `${appUrl}/track/${context.trackingToken}`,
			webhookUrl: siteUrl ? `${siteUrl}/webhook/hitpay` : "",
			buyerName: context.customerName,
			buyerPhone: context.customerWaPhone,
		});
		if (!siteUrl) params.delete("webhook");

		let response: Response;
		try {
			response = await fetch(
				`${HITPAY_API_BASE[context.credentials.mode]}/payment-requests`,
				{
					method: "POST",
					headers: {
						"X-BUSINESS-API-KEY": context.credentials.apiKey,
						"Content-Type": "application/x-www-form-urlencoded",
						"X-Requested-With": "XMLHttpRequest",
					},
					body: params.toString(),
				},
			);
		} catch (err) {
			console.error("hitpay.createCheckout: request failed", err);
			throw new ConvexError(GATEWAY_DOWN);
		}
		if (!response.ok) {
			// 401 = the seller's key is wrong/revoked; 422 = our payload. Either
			// way the buyer can't fix it — log for the seller/ops, keep the
			// buyer-facing message actionable (manual methods are on the page).
			console.error("hitpay.createCheckout: HitPay rejected the request", {
				status: response.status,
				body: (await response.text()).slice(0, 500),
				shortId: context.shortId,
			});
			throw new ConvexError(GATEWAY_DOWN);
		}
		const request = (await response.json()) as HitpayPaymentRequest;
		if (!request?.id || !request?.url) {
			console.error("hitpay.createCheckout: malformed create response", {
				shortId: context.shortId,
			});
			throw new ConvexError(GATEWAY_DOWN);
		}

		const recorded: { ok: boolean } = await ctx.runMutation(
			internal.hitpay.recordCheckoutRequest,
			{
				orderId: context.orderId,
				requestId: request.id,
				url: request.url,
				amountSen: context.total,
				currency: context.currency.toUpperCase(),
				accountMethods: request.payment_methods,
			},
		);
		if (!recorded.ok) {
			// The order changed under us (paid / re-priced mid-flight). The minted
			// request was never shown to anyone; it expires unpaid on HitPay.
			throw new ConvexError(
				"The order just changed — refresh the page and try again.",
			);
		}
		return { url: request.url };
	},
});

/**
 * Public action: reconcile an order against HitPay's status API. Fired by the
 * order page when the buyer lands back from checkout (never trusting the
 * redirect's query params) — and the safety net for a lost webhook, so a paid
 * order can never stay stuck "unpaid" while the buyer is looking at it.
 */
export const verifyCheckout = action({
	args: { token: v.string() },
	handler: async (
		ctx,
		{ token },
	): Promise<{ paymentStatus: "received" | "unpaid" }> => {
		await rateLimiter.limit(ctx, "gatewayVerify", {
			key: token,
			throws: true,
		});

		const context: CheckoutContext | null = await ctx.runQuery(
			internal.hitpay.getCheckoutContext,
			{ token },
		);
		if (!context) throw new ConvexError("Order not found");
		if (context.paymentStatus === "received") {
			return { paymentStatus: "received" };
		}
		if (!context.existing || !context.credentials) {
			return { paymentStatus: "unpaid" };
		}

		const settled = await fetchSettledPayment(
			context.credentials,
			context.existing.requestId,
		);
		if (!settled) return { paymentStatus: "unpaid" };

		const result: { applied: boolean; reason?: string } =
			await ctx.runMutation(internal.orders.receiveGatewayPayment, {
				orderId: context.orderId,
				paymentId: settled.paymentId,
				amountSen: settled.amountSen,
				currency: settled.currency,
				paymentType: settled.paymentType,
			});
		return {
			paymentStatus:
				result.applied || result.reason === "duplicate"
					? "received"
					: "unpaid",
		};
	},
});

/** Fetch a payment request's settled payment (if any) from HitPay's status
 * API. Returns null on any failure — callers treat that as "not settled". */
async function fetchSettledPayment(
	credentials: HitpayCredentials,
	requestId: string,
): Promise<{
	paymentId: string;
	amountSen: number;
	currency: string;
	paymentType: string | undefined;
} | null> {
	let response: Response;
	try {
		response = await fetch(
			`${HITPAY_API_BASE[credentials.mode]}/payment-requests/${requestId}`,
			{
				headers: {
					"X-BUSINESS-API-KEY": credentials.apiKey,
					"X-Requested-With": "XMLHttpRequest",
				},
			},
		);
	} catch (err) {
		console.error("hitpay: status fetch failed", err);
		return null;
	}
	if (!response.ok) {
		console.error("hitpay: status fetch rejected", {
			status: response.status,
		});
		return null;
	}
	const request = (await response.json()) as HitpayPaymentRequest;
	const payment = request.payments?.find((p) => p.status === "succeeded");
	if (!payment) return null;
	const amountSen = decimalStringToSen(payment.amount);
	if (amountSen === null) return null;
	return {
		paymentId: payment.id,
		amountSen,
		currency: payment.currency,
		paymentType: payment.payment_type,
	};
}

/** Webhook correlation: resolve the order + the retailer's verifying salt
 * from the payment_request_id the callback carries (the Lalamove
 * per-retailer-secret posture). `salt: null` = the order is ours but the
 * seller's credential is gone (disconnected mid-flight) — the route fails
 * closed on that. */
export const getWebhookContext = internalQuery({
	args: { paymentRequestId: v.string() },
	handler: async (
		ctx,
		{ paymentRequestId },
	): Promise<{ orderId: Id<"orders">; salt: string | null } | null> => {
		const order = await ctx.db
			.query("orders")
			.withIndex("by_gateway_request", (q) =>
				q.eq("gatewayRequestId", paymentRequestId),
			)
			.first();
		if (!order) return null;
		const retailer = await ctx.db.get(order.retailerId);
		const credentials = resolveHitpayCredentials(retailer?.hitpay);
		return { orderId: order._id, salt: credentials?.salt ?? null };
	},
});

/** Context for the post-webhook method enrichment (below). */
export const getEnrichContext = internalQuery({
	args: { orderId: v.id("orders") },
	handler: async (
		ctx,
		{ orderId },
	): Promise<{
		requestId: string;
		paymentId: string;
		credentials: HitpayCredentials;
	} | null> => {
		const order = await ctx.db.get(orderId);
		if (!order?.gatewayRequestId || !order.gatewayPaymentId) return null;
		const retailer = await ctx.db.get(order.retailerId);
		const credentials = resolveHitpayCredentials(retailer?.hitpay);
		if (!credentials) return null;
		return {
			requestId: order.gatewayRequestId,
			paymentId: order.gatewayPaymentId,
			credentials,
		};
	},
});

/**
 * The v1 completion webhook doesn't say WHICH rail paid (no payment_type
 * field), so webhook-received orders stamp method "other" and this follow-up
 * fetches the real rail from the status API — keeping the inbox Method filter
 * and the Insights donut honest for gateway orders. Best-effort: any failure
 * just leaves "other".
 */
export const enrichPaymentMethod = internalAction({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }): Promise<void> => {
		const context: {
			requestId: string;
			paymentId: string;
			credentials: HitpayCredentials;
		} | null = await ctx.runQuery(internal.hitpay.getEnrichContext, {
			orderId,
		});
		if (!context) return;
		const settled = await fetchSettledPayment(
			context.credentials,
			context.requestId,
		);
		if (!settled?.paymentType) return;
		if (settled.paymentId !== context.paymentId) return;
		await ctx.runMutation(internal.orders.recordGatewayMethod, {
			orderId,
			paymentId: settled.paymentId,
			paymentType: settled.paymentType,
		});
	},
});
