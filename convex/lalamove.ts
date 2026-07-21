// Lalamove delivery integration — Convex functions (ClickUp 86eyb5hrf).
//
// Pure client mechanics live in convex/lib/lalamove.ts; webhook auth in
// convex/lib/lalamoveSignature.ts. This module owns:
//  - the network client (fetch against the Lalamove REST API),
//  - the public checkout quote action (live buyer-paid fee),
//  - webhook context resolution + the idempotent event handler.
// Dispatch (Book delivery) actions build on the same client. See
// docs/delivery-lalamove.md.

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	action,
	internalMutation,
	internalQuery,
	query,
} from "./_generated/server";
import {
	buildLalamoveHeaders,
	buildPlaceOrderBody,
	buildQuotationBody,
	type DeliveryJobStatus,
	isActiveJobStatus,
	LALAMOVE_BASE_URL,
	type LalamoveCredentials,
	lalamoveAmountToSen,
	MASTER_MONTHLY_SPEND_CAP_SEN,
	normalizeLalamoveStatus,
	parseLalamoveEventTime,
	parseOrderResponse,
	parseQuotationResponse,
	resolveLalamoveCredentials,
} from "./lib/lalamove";
import { rateLimiter } from "./lib/rateLimiter";
import { monthStartMyt } from "./lib/usagePeriod";
import { applyStatusTransition, resolveSharedOrder } from "./orders";
import { assertPlanFeature } from "./subscriptions";

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

// ---------------------------------------------------------------------------
// Dispatch — "Book delivery" (seller, order detail)
// ---------------------------------------------------------------------------

/** Why the Book-delivery button is unavailable — rendered disabled-with-reason
 * on order detail (never a dead end; each reason maps to copy + a fix path). */
export type DispatchBlock =
	| "not_delivery"
	| "bad_status"
	| "job_active"
	| "booking_disabled"
	| "plan_gated"
	| "no_credentials"
	| "no_coords"
	| "no_buyer_phone"
	| "no_seller_phone"
	| "spend_capped";

type BookingConfig = NonNullable<Doc<"retailers">["deliveryBooking"]>;

function dispatchBlockReason(args: {
	order: Doc<"orders">;
	retailer: Doc<"retailers">;
	activeJob: Doc<"deliveryJobs"> | undefined;
	credentials: LalamoveCredentials | null;
	planOk: boolean;
	monthMasterSpend: number;
}): DispatchBlock | null {
	const { order, retailer, activeJob, credentials, planOk } = args;
	if (order.deliveryMethod !== "delivery") return "not_delivery";
	if (order.status !== "confirmed" && order.status !== "packed")
		return "bad_status";
	if (activeJob) return "job_active";
	if (!retailer.deliveryBooking?.enabled || !retailer.businessAddress)
		return "booking_disabled";
	if (!planOk) return "plan_gated";
	if (!credentials) return "no_credentials";
	if (
		order.deliveryAddress?.latitude === undefined ||
		order.deliveryAddress.longitude === undefined
	)
		return "no_coords";
	if (!order.customer.waPhone) return "no_buyer_phone";
	if (!retailer.waPhone) return "no_seller_phone";
	if (
		credentials.mode === "master" &&
		args.monthMasterSpend >= MASTER_MONTHLY_SPEND_CAP_SEN
	)
		return "spend_capped";
	return null;
}

/** Rider-facing destination string from the frozen order address. */
function formatDeliveryAddress(
	address: NonNullable<Doc<"orders">["deliveryAddress"]>,
): string {
	return [
		address.line1,
		address.line2,
		`${address.postcode} ${address.city}`.trim(),
		address.state,
	]
		.filter((part): part is string => !!part && part.trim().length > 0)
		.join(", ");
}

/** Sum of this month's (MYT) master-account booking costs for a retailer —
 * indexed creation-time range read (insights precedent). Counts every master
 * job placed this month regardless of outcome: a cancelled booking can still
 * carry a fee, and a conservative meter is the point of a protective cap. */
async function monthMasterSpend(
	ctx: { db: { query: (t: "deliveryJobs") => any } },
	retailerId: Id<"retailers">,
): Promise<number> {
	const monthStart = monthStartMyt(Date.now());
	const rows: Doc<"deliveryJobs">[] = await ctx.db
		.query("deliveryJobs")
		.withIndex("by_retailer", (q: any) =>
			q.eq("retailerId", retailerId).gte("_creationTime", monthStart),
		)
		.collect();
	return rows
		.filter((r) => r.credentialMode === "master")
		.reduce((sum, r) => sum + r.costActual, 0);
}

type DispatchContext =
	| { ok: false; reason: DispatchBlock | "not_found" }
	| {
			ok: true;
			orderId: Id<"orders">;
			retailerId: Id<"retailers">;
			shortId: string;
			buyerPaidFee: number;
			origin: { latitude: number; longitude: number; label: string };
			destination: { latitude: number; longitude: number; address: string };
			sender: { name: string; phone: string };
			recipient: { name: string; phone: string; remarks?: string };
			vehicleType: string;
			credentials: LalamoveCredentials;
	  };

/**
 * Auth + full eligibility for a booking attempt, in one read. INTERNAL —
 * the resolved credentials ride back to the calling action and must never
 * reach a client (the public surface is getDeliveryJob below).
 */
export const getDispatchContext = internalQuery({
	args: { shortId: v.string() },
	handler: async (ctx, { shortId }): Promise<DispatchContext> => {
		const order = await resolveSharedOrder(ctx, { shortId });
		if (!order) return { ok: false, reason: "not_found" };
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) return { ok: false, reason: "not_found" };

		const jobs = await ctx.db
			.query("deliveryJobs")
			.withIndex("by_order", (q) => q.eq("orderId", order._id))
			.collect();
		const activeJob = jobs.find((j) => isActiveJobStatus(j.status));

		const credentials = resolveLalamoveCredentials(
			retailer.deliveryBooking as BookingConfig | undefined,
			platformLalamoveEnv(),
		);

		// Plan gate — admin act-as bypasses (white-glove), mirroring updateSettings.
		const identity = await ctx.auth.getUserIdentity();
		const actingAsAdmin =
			identity !== null && retailer.userId !== identity.subject;
		let planOk = true;
		if (!actingAsAdmin) {
			try {
				await assertPlanFeature(ctx, retailer._id, "delivery");
			} catch {
				planOk = false;
			}
		}

		const blocked = dispatchBlockReason({
			order,
			retailer,
			activeJob,
			credentials,
			planOk,
			monthMasterSpend:
				credentials?.mode === "master"
					? await monthMasterSpend(ctx, retailer._id)
					: 0,
		});
		if (blocked) return { ok: false, reason: blocked };
		// Non-null after dispatchBlockReason — restated for the type system.
		if (!credentials) return { ok: false, reason: "no_credentials" };

		const address = order.deliveryAddress!;
		const businessAddress = retailer.businessAddress!;
		const remarksParts = [
			order.shortId,
			order.deliveryAddress?.notes,
			order.customerNote,
		].filter((p): p is string => !!p && p.trim().length > 0);
		return {
			ok: true,
			orderId: order._id,
			retailerId: retailer._id,
			shortId: order.shortId,
			buyerPaidFee: order.deliveryFee ?? 0,
			origin: {
				latitude: businessAddress.latitude,
				longitude: businessAddress.longitude,
				label: businessAddress.label,
			},
			destination: {
				latitude: address.latitude!,
				longitude: address.longitude!,
				address: formatDeliveryAddress(address),
			},
			sender: { name: retailer.storeName, phone: retailer.waPhone! },
			recipient: {
				name: order.customer.name ?? "Customer",
				phone: order.customer.waPhone!,
				remarks: remarksParts.join(" · ").slice(0, 400) || undefined,
			},
			vehicleType:
				(retailer.deliveryBooking as BookingConfig).vehicleType ?? "MOTORCYCLE",
			credentials,
		};
	},
});

/** Map a Lalamove API failure to seller-facing copy — the wallet case gets
 * the explicit "top up" ask the ticket requires; everything else stays
 * honest-but-generic (the raw body is in the logs). */
function friendlyBookingError(err: unknown): string {
	if (err instanceof LalamoveApiError) {
		const body = err.body.toLowerCase();
		if (
			body.includes("insufficient") ||
			body.includes("balance") ||
			body.includes("credit")
		) {
			return "Your Lalamove wallet doesn't have enough balance. Top it up in the Lalamove app, then retry the booking.";
		}
		if (body.includes("expired") || body.includes("quotation")) {
			return "The price quote expired — tap Book delivery again for a fresh price.";
		}
	}
	return "Lalamove couldn't process the booking right now. Please try again in a moment.";
}

/**
 * Step 1 of the two-tap dispatch: re-quote the delivery at TODAY's price
 * (checkout quotes are long dead — Lalamove honours quotes 5 minutes) and
 * hand back everything the confirm dialog shows: fresh price, what the buyer
 * paid, and the opaque ids confirmBooking needs within the 5-minute window.
 */
export const prepareBooking = action({
	args: { shortId: v.string() },
	handler: async (
		ctx,
		{ shortId },
	): Promise<
		| { ok: false; reason: DispatchBlock | "not_found" | "quote_failed"; message?: string }
		| {
				ok: true;
				quotationId: string;
				senderStopId: string;
				recipientStopId: string;
				fee: number;
				buyerPaidFee: number;
				vehicleType: string;
				credentialMode: "byo" | "master";
		  }
	> => {
		const context = await ctx.runQuery(internal.lalamove.getDispatchContext, {
			shortId,
		});
		if (!context.ok) return context;
		try {
			const response = await callLalamove(
				context.credentials,
				"POST",
				"/v3/quotations",
				buildQuotationBody({
					serviceType: context.vehicleType,
					stops: [
						{
							coordinates: context.origin,
							address: context.origin.label,
						},
						{
							coordinates: context.destination,
							address: context.destination.address,
						},
					],
				}),
			);
			const parsed = parseQuotationResponse(response);
			return {
				ok: true,
				quotationId: parsed.quotationId,
				senderStopId: parsed.stopIds[0],
				recipientStopId: parsed.stopIds[1],
				fee: parsed.priceTotal,
				buyerPaidFee: context.buyerPaidFee,
				vehicleType: context.vehicleType,
				credentialMode: context.credentials.mode,
			};
		} catch (err) {
			console.warn("[lalamove] dispatch quote failed", {
				shortId,
				message: err instanceof Error ? err.message : String(err),
			});
			return {
				ok: false,
				reason: "quote_failed",
				message: friendlyBookingError(err),
			};
		}
	},
});

/**
 * Step 2: place the rider order against the confirmed quotation and write
 * the ledger row. All eligibility re-checks run again (the dialog may have
 * sat open); the one-active-job invariant is enforced ATOMICALLY inside
 * recordBooking, so two fast taps cannot double-book.
 */
export const confirmBooking = action({
	args: {
		shortId: v.string(),
		quotationId: v.string(),
		senderStopId: v.string(),
		recipientStopId: v.string(),
	},
	handler: async (
		ctx,
		args,
	): Promise<
		| { ok: false; reason: DispatchBlock | "not_found" | "booking_failed"; message?: string }
		| { ok: true; providerOrderId: string; costActual: number }
	> => {
		const context = await ctx.runQuery(internal.lalamove.getDispatchContext, {
			shortId: args.shortId,
		});
		if (!context.ok) return context;
		try {
			const response = await callLalamove(
				context.credentials,
				"POST",
				"/v3/orders",
				buildPlaceOrderBody({
					quotationId: args.quotationId,
					sender: {
						stopId: args.senderStopId,
						name: context.sender.name,
						phone: context.sender.phone,
					},
					recipient: {
						stopId: args.recipientStopId,
						name: context.recipient.name,
						phone: context.recipient.phone,
						remarks: context.recipient.remarks,
					},
					orderRef: context.shortId,
				}),
			);
			const parsed = parseOrderResponse(response);
			await ctx.runMutation(internal.lalamove.recordBooking, {
				orderId: context.orderId,
				retailerId: context.retailerId,
				providerOrderId: parsed.providerOrderId,
				costActual: parsed.priceTotal,
				quotationId: args.quotationId,
				vehicleType: context.vehicleType,
				credentialMode: context.credentials.mode,
				shareLink: parsed.shareLink,
				providerStatus: parsed.status,
			});
			return {
				ok: true,
				providerOrderId: parsed.providerOrderId,
				costActual: parsed.priceTotal,
			};
		} catch (err) {
			console.warn("[lalamove] booking failed", {
				shortId: args.shortId,
				message: err instanceof Error ? err.message : String(err),
			});
			return {
				ok: false,
				reason: "booking_failed",
				message: friendlyBookingError(err),
			};
		}
	},
});

export const recordBooking = internalMutation({
	args: {
		orderId: v.id("orders"),
		retailerId: v.id("retailers"),
		providerOrderId: v.string(),
		costActual: v.number(),
		quotationId: v.string(),
		vehicleType: v.string(),
		credentialMode: v.union(v.literal("byo"), v.literal("master")),
		shareLink: v.optional(v.string()),
		providerStatus: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<Id<"deliveryJobs">> => {
		// One ACTIVE job per order, enforced where it's atomic. The action's
		// pre-check filters the common case; this is the race-proof gate.
		const jobs = await ctx.db
			.query("deliveryJobs")
			.withIndex("by_order", (q) => q.eq("orderId", args.orderId))
			.collect();
		if (jobs.some((j) => isActiveJobStatus(j.status))) {
			throw new ConvexError(
				"A rider booking is already in progress for this order",
			);
		}
		const now = Date.now();
		const status: DeliveryJobStatus =
			normalizeLalamoveStatus(args.providerStatus) ?? "assigning";
		const jobId = await ctx.db.insert("deliveryJobs", {
			orderId: args.orderId,
			retailerId: args.retailerId,
			provider: "lalamove",
			providerOrderId: args.providerOrderId,
			status,
			costActual: args.costActual,
			quotationId: args.quotationId,
			vehicleType: args.vehicleType,
			credentialMode: args.credentialMode,
			shareLink: args.shareLink,
			createdAt: now,
			updatedAt: now,
		});
		// Mirror the tracking link early (fill-if-unset) — same posture as the
		// DRIVER_ASSIGNED webhook path.
		if (args.shareLink) {
			const order = await ctx.db.get(args.orderId);
			if (order && !order.carrierTrackingUrl) {
				await ctx.db.patch(order._id, {
					carrierTrackingUrl: args.shareLink,
					updatedAt: now,
				});
			}
		}
		return jobId;
	},
});

/**
 * Cancel the active Lalamove job for an order (seller action — used before
 * or after cancelling the order itself). Deliberately NOT gated by the
 * dispatch eligibility checks: cancelling must work even when booking
 * wouldn't (e.g. order already cancelled, plan downgraded). Rider-assigned
 * cancellations can incur Lalamove fees — the UI warns before calling.
 */
export const cancelBooking = action({
	args: { shortId: v.string() },
	handler: async (
		ctx,
		{ shortId },
	): Promise<{ ok: boolean; message?: string }> => {
		const target = await ctx.runQuery(internal.lalamove.getCancelContext, {
			shortId,
		});
		if (!target) return { ok: false, message: "No active booking to cancel." };
		try {
			await callLalamove(
				target.credentials,
				"DELETE",
				`/v3/orders/${target.providerOrderId}`,
			);
		} catch (err) {
			console.warn("[lalamove] cancel failed", {
				shortId,
				message: err instanceof Error ? err.message : String(err),
			});
			return {
				ok: false,
				message:
					"Lalamove couldn't cancel this booking — the rider may already be too far along. Check the Lalamove app or contact their support.",
			};
		}
		await ctx.runMutation(internal.lalamove.markJobCancelled, {
			jobId: target.jobId,
		});
		return { ok: true };
	},
});

export const getCancelContext = internalQuery({
	args: { shortId: v.string() },
	handler: async (
		ctx,
		{ shortId },
	): Promise<{
		jobId: Id<"deliveryJobs">;
		providerOrderId: string;
		credentials: LalamoveCredentials;
	} | null> => {
		const order = await resolveSharedOrder(ctx, { shortId });
		if (!order) return null;
		const jobs = await ctx.db
			.query("deliveryJobs")
			.withIndex("by_order", (q) => q.eq("orderId", order._id))
			.collect();
		const active = jobs.find((j) => isActiveJobStatus(j.status));
		if (!active) return null;
		const retailer = await ctx.db.get(order.retailerId);
		const credentials = resolveLalamoveCredentials(
			retailer?.deliveryBooking as BookingConfig | undefined,
			platformLalamoveEnv(),
		);
		if (!credentials) return null;
		return {
			jobId: active._id,
			providerOrderId: active.providerOrderId,
			credentials,
		};
	},
});

export const markJobCancelled = internalMutation({
	args: { jobId: v.id("deliveryJobs") },
	handler: async (ctx, { jobId }) => {
		const job = await ctx.db.get(jobId);
		if (!job || !isActiveJobStatus(job.status)) return;
		await ctx.db.patch(jobId, {
			status: "canceled",
			failureReason: "Cancelled by seller",
			updatedAt: Date.now(),
		});
	},
});

/** Public job shape for the order-detail card — no credentials, no secrets. */
export type DeliveryJobView = {
	status: DeliveryJobStatus;
	providerOrderId: string;
	costActual: number;
	vehicleType: string;
	credentialMode: "byo" | "master";
	driver?: { name: string; phone: string; plateNumber: string };
	shareLink?: string;
	failureReason?: string;
	createdAt: number;
};

/**
 * Order-detail read: the latest booking (active or the most recent attempt)
 * plus WHY booking is currently unavailable (null = the button is live).
 * Owner-or-admin via the shortId seam.
 */
export const getDeliveryJob = query({
	args: { shortId: v.string() },
	handler: async (
		ctx,
		{ shortId },
	): Promise<{
		job: DeliveryJobView | null;
		blockReason: DispatchBlock | null;
		monthMasterSpend?: number;
		masterSpendCap?: number;
	} | null> => {
		const order = await resolveSharedOrder(ctx, { shortId });
		if (!order) return null;
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) return null;

		const jobs = await ctx.db
			.query("deliveryJobs")
			.withIndex("by_order", (q) => q.eq("orderId", order._id))
			.collect();
		const activeJob = jobs.find((j) => isActiveJobStatus(j.status));
		const latest =
			activeJob ??
			[...jobs].sort((a, b) => b.createdAt - a.createdAt)[0] ??
			null;

		const credentials = resolveLalamoveCredentials(
			retailer.deliveryBooking as BookingConfig | undefined,
			platformLalamoveEnv(),
		);
		const identity = await ctx.auth.getUserIdentity();
		const actingAsAdmin =
			identity !== null && retailer.userId !== identity.subject;
		let planOk = true;
		if (!actingAsAdmin) {
			try {
				await assertPlanFeature(ctx, retailer._id, "delivery");
			} catch {
				planOk = false;
			}
		}
		const spend =
			credentials?.mode === "master"
				? await monthMasterSpend(ctx, retailer._id)
				: undefined;
		const blockReason = dispatchBlockReason({
			order,
			retailer,
			activeJob,
			credentials,
			planOk,
			monthMasterSpend: spend ?? 0,
		});
		return {
			job: latest
				? {
						status: latest.status,
						providerOrderId: latest.providerOrderId,
						costActual: latest.costActual,
						vehicleType: latest.vehicleType,
						credentialMode: latest.credentialMode,
						driver: latest.driver,
						shareLink: latest.shareLink,
						failureReason: latest.failureReason,
						createdAt: latest.createdAt,
					}
				: null,
			blockReason,
			monthMasterSpend: spend,
			masterSpendCap:
				credentials?.mode === "master" ? MASTER_MONTHLY_SPEND_CAP_SEN : undefined,
		};
	},
});
