// Lalamove delivery integration — Convex functions (ClickUp 86eyb5hrf).
//
// Pure client mechanics live in convex/lib/lalamove.ts; webhook auth in
// convex/lib/lalamoveSignature.ts. This module owns:
//  - the network client (fetch against the Lalamove REST API),
//  - the public checkout quote action (live buyer-paid fee),
//  - webhook context resolution + the idempotent event handler.
// Dispatch (Book delivery) actions build on the same client. See
// docs/delivery-lalamove.md.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	action,
	internalMutation,
	internalQuery,
} from "./_generated/server";
import {
	buildLalamoveHeaders,
	buildQuotationBody,
	isActiveJobStatus,
	LALAMOVE_BASE_URL,
	type LalamoveCredentials,
	lalamoveAmountToSen,
	normalizeLalamoveStatus,
	parseLalamoveEventTime,
	parseQuotationResponse,
	resolveLalamoveCredentials,
} from "./lib/lalamove";
import { rateLimiter } from "./lib/rateLimiter";
import { applyStatusTransition } from "./orders";

/** Platform master credentials + environment from the deployment env. One
 * LALAMOVE_ENV switch flips the whole deployment sandbox ⇄ production. */
export function platformLalamoveEnv(): {
	apiKey?: string;
	apiSecret?: string;
	env?: string;
} {
	return {
		apiKey: process.env.LALAMOVE_API_KEY,
		apiSecret: process.env.LALAMOVE_API_SECRET,
		env: process.env.LALAMOVE_ENV,
	};
}

/** Non-2xx Lalamove response. `body` is the raw response text — surfaced in
 * logs and mapped to seller-friendly copy at the dispatch UI boundary. */
export class LalamoveApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly body: string,
	) {
		super(`Lalamove API ${status}: ${body.slice(0, 300)}`);
		this.name = "LalamoveApiError";
	}
}

/** Signed fetch against the Lalamove REST API. */
async function callLalamove(
	credentials: LalamoveCredentials,
	method: "GET" | "POST" | "DELETE" | "PATCH",
	path: string,
	body?: { data: Record<string, unknown> },
): Promise<unknown> {
	const bodyStr = body ? JSON.stringify(body) : "";
	const headers = await buildLalamoveHeaders({
		credentials,
		method,
		path,
		body: bodyStr,
		timestamp: Date.now(),
		requestId: crypto.randomUUID(),
	});
	const res = await fetch(`${LALAMOVE_BASE_URL[credentials.env]}${path}`, {
		method,
		headers,
		...(body ? { body: bodyStr } : {}),
	});
	const text = await res.text();
	if (!res.ok) throw new LalamoveApiError(res.status, text);
	return text ? JSON.parse(text) : {};
}

// ---------------------------------------------------------------------------
// Checkout quote (buyer-paid fee, pricing mode "lalamove")
// ---------------------------------------------------------------------------

/** Everything the quote action needs about the retailer, in one read. */
export const getQuoteContext = internalQuery({
	args: { retailerId: v.id("retailers") },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{
		origin: { latitude: number; longitude: number; label: string };
		vehicleType: string;
		booking: { apiKey?: string; apiSecret?: string };
	} | null> => {
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) return null;
		// Live quoting only exists under pricing mode "lalamove" — every other
		// mode prices via the pure resolver with no network involved.
		if (retailer.deliveryConfig?.mode !== "lalamove") return null;
		const origin = retailer.businessAddress;
		if (!origin) return null; // enable gate should prevent this — fail soft
		return {
			origin: {
				latitude: origin.latitude,
				longitude: origin.longitude,
				label: origin.label,
			},
			vehicleType: retailer.deliveryBooking?.vehicleType ?? "MOTORCYCLE",
			booking: {
				apiKey: retailer.deliveryBooking?.apiKey,
				apiSecret: retailer.deliveryBooking?.apiSecret,
			},
		};
	},
});

export const saveCheckoutQuote = internalMutation({
	args: {
		retailerId: v.id("retailers"),
		quotationId: v.string(),
		fee: v.number(),
		vehicleType: v.string(),
		latitude: v.number(),
		longitude: v.number(),
	},
	handler: async (ctx, args): Promise<Id<"deliveryQuotes">> => {
		return await ctx.db.insert("deliveryQuotes", {
			...args,
			quotedAt: Date.now(),
		});
	},
});

/**
 * Public storefront action: live Lalamove fee for the buyer's picked address.
 * Fired once per address selection (debounced client-side, rate-limited per
 * retailer here). NEVER throws to the buyer for provider problems — any
 * failure returns "unavailable" and checkout falls back per the store's
 * onUnquotable policy (kill-switch edge case in the ticket: zero storefront
 * breakage). The fee is recorded server-side (deliveryQuotes row) and
 * orders.create loads it by id — the client can display the fee but can
 * never dictate it.
 */
export const quoteForCheckout = action({
	args: {
		retailerId: v.id("retailers"),
		latitude: v.number(),
		longitude: v.number(),
		/** Buyer's formatted address (shown to the rider at dispatch re-quote
		 * time too, so keep it human). */
		address: v.string(),
	},
	handler: async (
		ctx,
		args,
	): Promise<
		| { status: "quoted"; quoteId: Id<"deliveryQuotes">; fee: number }
		| { status: "unavailable" }
	> => {
		await rateLimiter.limit(ctx, "lalamoveQuote", {
			key: args.retailerId,
			throws: true,
		});
		if (!Number.isFinite(args.latitude) || !Number.isFinite(args.longitude)) {
			return { status: "unavailable" };
		}
		const context = await ctx.runQuery(internal.lalamove.getQuoteContext, {
			retailerId: args.retailerId,
		});
		if (!context) return { status: "unavailable" };
		const credentials = resolveLalamoveCredentials(
			context.booking,
			platformLalamoveEnv(),
		);
		if (!credentials) return { status: "unavailable" };

		try {
			const response = await callLalamove(
				credentials,
				"POST",
				"/v3/quotations",
				buildQuotationBody({
					serviceType: context.vehicleType,
					stops: [
						{
							coordinates: {
								latitude: context.origin.latitude,
								longitude: context.origin.longitude,
							},
							address: context.origin.label,
						},
						{
							coordinates: {
								latitude: args.latitude,
								longitude: args.longitude,
							},
							address: args.address.trim().slice(0, 500) || "Delivery address",
						},
					],
				}),
			);
			const parsed = parseQuotationResponse(response);
			const quoteId: Id<"deliveryQuotes"> = await ctx.runMutation(
				internal.lalamove.saveCheckoutQuote,
				{
					retailerId: args.retailerId,
					quotationId: parsed.quotationId,
					fee: parsed.priceTotal,
					vehicleType: context.vehicleType,
					latitude: args.latitude,
					longitude: args.longitude,
				},
			);
			return { status: "quoted", quoteId, fee: parsed.priceTotal };
		} catch (err) {
			console.warn("[lalamove] checkout quote failed", {
				retailerId: args.retailerId,
				message: err instanceof Error ? err.message : String(err),
			});
			return { status: "unavailable" };
		}
	},
});

// ---------------------------------------------------------------------------
// Webhook (POST /webhook/lalamove → convex/http.ts → here)
// ---------------------------------------------------------------------------

/**
 * Resolve which secret(s) may verify an inbound webhook event.
 *
 * Order-scoped events resolve through the JOB row (by_provider_order) → the
 * retailer whose credentials placed it. We return BOTH the retailer's BYO
 * secret and the platform secret when available: if a seller swaps/removes
 * their key mid-flight, in-flight events (signed with whichever key placed
 * the order) still verify. Trying multiple HMAC secrets is not a weakening —
 * each candidate is a full HMAC check.
 *
 * Events with no matching job (bookings made outside Kedaipal on the same
 * account, wallet events): verifiable only when signed by the platform key;
 * BYO events we can't attribute are dropped by the route (nothing to act on).
 */
export const getWebhookContext = internalQuery({
	args: {
		providerOrderId: v.optional(v.string()),
		apiKey: v.string(),
	},
	handler: async (
		ctx,
		{ providerOrderId, apiKey },
	): Promise<{
		jobId: Id<"deliveryJobs"> | null;
		secrets: string[];
	}> => {
		const platform = platformLalamoveEnv();
		const secrets: string[] = [];
		let jobId: Id<"deliveryJobs"> | null = null;

		if (providerOrderId) {
			const job = await ctx.db
				.query("deliveryJobs")
				.withIndex("by_provider_order", (q) =>
					q.eq("providerOrderId", providerOrderId),
				)
				.unique();
			if (job) {
				jobId = job._id;
				const retailer = await ctx.db.get(job.retailerId);
				const byoSecret = retailer?.deliveryBooking?.apiSecret?.trim();
				if (byoSecret) secrets.push(byoSecret);
			}
		}
		// Platform secret verifies master-mode jobs and (harmlessly) acts as the
		// fallback candidate everywhere else. Only offered when the sender's
		// apiKey matches ours OR we found a job (mid-flight key-swap tolerance).
		const platformSecret = platform.apiSecret?.trim();
		if (
			platformSecret &&
			(jobId !== null || (platform.apiKey && apiKey === platform.apiKey))
		) {
			secrets.push(platformSecret);
		}
		return { jobId, secrets };
	},
});

/** Order statuses that may auto-advance from a rider event. `pending` is
 * deliberately absent — an unconfirmed order never ships itself. */
const SHIPPABLE_FROM = new Set(["confirmed", "packed"]);
const DELIVERABLE_FROM = new Set(["confirmed", "packed", "shipped"]);

/**
 * Apply one verified webhook event to its job (and possibly its order).
 * Idempotent + out-of-order safe:
 *  - job fields only move forward per `lastEventAt` (older events fill gaps,
 *    never regress);
 *  - repeated identical events are no-ops (status equality / order-status
 *    guards);
 *  - the ORDER never regresses: picked_up → shipped only from
 *    confirmed/packed, completed → delivered only from confirmed/packed/
 *    shipped, and a cancelled order is never touched. The JOB row, by
 *    contrast, follows provider truth including regressions (driver bailed →
 *    back to "assigning").
 */
export const applyWebhookEvent = internalMutation({
	args: {
		jobId: v.id("deliveryJobs"),
		eventType: v.string(),
		data: v.any(),
		eventTimestamp: v.number(),
	},
	handler: async (ctx, { jobId, eventType, data, eventTimestamp }) => {
		const job = await ctx.db.get(jobId);
		if (!job) return;
		const payload = (data ?? {}) as Record<string, unknown>;
		const orderData = (payload.order ?? {}) as Record<string, unknown>;
		const eventAt = parseLalamoveEventTime(data, eventTimestamp);
		const stale = job.lastEventAt !== undefined && eventAt < job.lastEventAt;
		const now = Date.now();
		const shareLink =
			typeof orderData.shareLink === "string" && orderData.shareLink
				? orderData.shareLink
				: undefined;

		switch (eventType) {
			case "ORDER_STATUS_CHANGED": {
				const status = normalizeLalamoveStatus(
					typeof orderData.status === "string" ? orderData.status : undefined,
				);
				if (!status) {
					console.warn("[lalamove] webhook: unknown order status", {
						providerOrderId: job.providerOrderId,
						raw: orderData.status,
					});
					return;
				}
				if (!stale) {
					const enteringFailure =
						(status === "canceled" ||
							status === "expired" ||
							status === "rejected") &&
						isActiveJobStatus(job.status);
					const cancelReason =
						typeof orderData.cancelReason === "string" &&
						orderData.cancelReason
							? orderData.cancelReason
							: undefined;
					await ctx.db.patch(job._id, {
						status,
						lastEventAt: eventAt,
						updatedAt: now,
						...(shareLink && !job.shareLink ? { shareLink } : {}),
						...(status === "expired"
							? { failureReason: "No driver accepted the order" }
							: cancelReason
								? { failureReason: cancelReason }
								: {}),
					});
					if (enteringFailure) {
						await ctx.scheduler.runAfter(
							0,
							internal.email.notifyDeliveryJobFailed,
							{
								orderId: job.orderId,
								reason:
									status === "expired"
										? "No driver accepted the order"
										: cancelReason,
							},
						);
					}
				}

				// Order auto-transitions ride order-status guards, so replayed /
				// stale events are naturally idempotent here too.
				const order = await ctx.db.get(job.orderId);
				if (!order || order.status === "cancelled") return;
				if (status === "picked_up" && SHIPPABLE_FROM.has(order.status)) {
					await applyStatusTransition(ctx, order, "shipped", {
						carrierTrackingUrl: job.shareLink ?? shareLink,
					});
				} else if (
					status === "completed" &&
					DELIVERABLE_FROM.has(order.status)
				) {
					await applyStatusTransition(ctx, order, "delivered");
				}
				return;
			}

			case "DRIVER_ASSIGNED": {
				const driverData = (payload.driver ?? {}) as Record<string, unknown>;
				const driver = {
					name: typeof driverData.name === "string" ? driverData.name : "Driver",
					phone: typeof driverData.phone === "string" ? driverData.phone : "",
					plateNumber:
						typeof driverData.plateNumber === "string"
							? driverData.plateNumber
							: "",
				};
				await ctx.db.patch(job._id, {
					driver,
					updatedAt: now,
					...(shareLink && !job.shareLink ? { shareLink } : {}),
				});
				// Mirror the live-tracking link onto the order early (fill-if-unset)
				// so the shipped message always carries it even if PICKED_UP arrives
				// before we ever saw a shareLink on a status event.
				const link = job.shareLink ?? shareLink;
				if (link) {
					const order = await ctx.db.get(job.orderId);
					if (order && !order.carrierTrackingUrl) {
						await ctx.db.patch(order._id, {
							carrierTrackingUrl: link,
							updatedAt: now,
						});
					}
				}
				return;
			}

			case "ORDER_AMOUNT_CHANGED": {
				// Post-match adjustments (waiting fees etc.) — keep the ledger's
				// actual cost true. Unparseable amounts are logged, never applied.
				const priceBreakdown = (orderData.priceBreakdown ?? {}) as Record<
					string,
					unknown
				>;
				const total = priceBreakdown.total;
				if (typeof total === "string" || typeof total === "number") {
					try {
						await ctx.db.patch(job._id, {
							costActual: lalamoveAmountToSen(total),
							updatedAt: now,
						});
					} catch (err) {
						console.warn("[lalamove] webhook: unparseable amount", {
							providerOrderId: job.providerOrderId,
							total,
							message: err instanceof Error ? err.message : String(err),
						});
					}
				}
				return;
			}

			case "ORDER_REPLACED": {
				// Cancel-and-clone: Lalamove cancelled the order and cloned a new
				// one (post-match adjustments). Follow the replacement — subsequent
				// events reference the NEW provider order id.
				const newId =
					typeof orderData.orderId === "string" ? orderData.orderId : undefined;
				if (newId && newId !== job.providerOrderId) {
					await ctx.db.patch(job._id, {
						providerOrderId: newId,
						updatedAt: now,
					});
				}
				return;
			}

			default:
				// WALLET_BALANCE_CHANGED and future event types — observability
				// only for v1 (wallet surfaces are a follow-up; see docs).
				console.log("[lalamove] webhook: unhandled eventType", {
					eventType,
					providerOrderId: job.providerOrderId,
				});
		}
	},
});
