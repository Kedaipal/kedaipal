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
	internalAction,
	internalMutation,
	internalQuery,
	query,
	type QueryCtx,
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
	normalizeLalamoveStatus,
	parseLalamoveEventTime,
	parseOrderResponse,
	parsePodImages,
	parseQuotationResponse,
	resolveLalamoveCredentials,
	toLalamoveMyPhone,
	toLalamovePhone,
} from "./lib/lalamove";
import { rateLimiter } from "./lib/rateLimiter";
import { applyStatusTransition, resolveSharedOrder } from "./orders";
import { assertPlanFeature } from "./subscriptions";

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
		/** The buyer's chosen fulfilment day (epoch-ms MYT midnight). Future
		 * days are priced as a SCHEDULED pickup (noon MYT) so the locked fee
		 * reflects the delivery day, not checkout day. Today/omitted =
		 * immediate pricing. */
		fulfilmentDate: v.optional(v.number()),
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
		const credentials = resolveLalamoveCredentials(context.booking);
		if (!credentials) return { status: "unavailable" };

		try {
			// Pre-order pricing: a future fulfilment day is quoted as a SCHEDULED
			// pickup at noon MYT on that day (the hour barely moves the price;
			// the DAY can). Today stays an immediate quote. Guarded to Lalamove's
			// ~30-day scheduling window; anything odd falls back to immediate.
			const NOON_MYT_OFFSET_MS = 4 * 60 * 60 * 1000; // 12:00 MYT = 04:00 UTC
			const scheduleAt =
				args.fulfilmentDate !== undefined &&
				args.fulfilmentDate > Date.now() &&
				args.fulfilmentDate < Date.now() + 30 * 24 * 60 * 60 * 1000
					? args.fulfilmentDate + NOON_MYT_OFFSET_MS
					: undefined;
			const response = await callLalamove(
				credentials,
				"POST",
				"/v3/quotations",
				buildQuotationBody({
					serviceType: context.vehicleType,
					scheduleAt,
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
 * retailer whose credentials placed it (BYO-only: the seller's stored secret
 * is the only verifier). If a seller removes their key mid-flight, in-flight
 * events go unverifiable and are acked+ignored — the job then finishes via
 * the seller's Lalamove app instead of auto-transitions, never a 401 storm.
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
		// BYO-only: the verifying secret is the job retailer's own — there is no
		// platform account. Events with no matching job are unverifiable by
		// design (bookings the seller made outside Kedaipal, wallet events) and
		// the route acks + ignores them. `apiKey` stays a parameter for the log
		// line at the route (which sender key produced unmatched traffic).
		void apiKey;
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
					// A seller cancel (via our button) already stamped a clear reason;
					// Lalamove then echoes a CANCELED webhook whose cancelReason is
					// "other" for API cancels — don't let that mask "Cancelled by you".
					const sellerCancelled =
						job.status === "canceled" &&
						job.failureReason === "Cancelled by you";
					const cancelReason =
						typeof orderData.cancelReason === "string" &&
						orderData.cancelReason &&
						orderData.cancelReason.toLowerCase() !== "other"
							? orderData.cancelReason
							: undefined;
					await ctx.db.patch(job._id, {
						status,
						// A job recovering into an active state (driver-bail rematch,
						// clone catching up) must not carry a stale failure banner.
						...(isActiveJobStatus(status) ? { failureReason: undefined } : {}),
						lastEventAt: eventAt,
						updatedAt: now,
						...(shareLink && !job.shareLink ? { shareLink } : {}),
						...(status === "expired"
							? { failureReason: "No driver accepted the order" }
							: sellerCancelled
								? {} // keep "Cancelled by you"
								: status === "canceled"
									? { failureReason: cancelReason ?? "Cancelled by Lalamove" }
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
				// Rider dropped off → pull the proof-of-delivery photo
				// (isPODEnabled at place order). Scheduled regardless of the
				// order-transition guards above — the photo exists whenever the
				// JOB completed. Idempotent: the fetch no-ops once images are
				// stored, so replays/COMPLETED+POD_STATUS_CHANGED double-fire is
				// harmless.
				if (status === "completed" && !job.podImageStorageIds) {
					await ctx.scheduler.runAfter(0, internal.lalamove.fetchPodImages, {
						jobId: job._id,
						attempt: 0,
					});
				}
				return;
			}

			case "POD_STATUS_CHANGED": {
				// Dedicated proof-of-delivery event. Payload details vary by
				// market, so we treat it purely as a trigger and read the truth
				// from GET /v3/orders (same idempotent fetch as COMPLETED).
				if (!job.podImageStorageIds) {
					await ctx.scheduler.runAfter(0, internal.lalamove.fetchPodImages, {
						jobId: job._id,
						attempt: 0,
					});
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
				// Cancel-and-clone: for post-match adjustments Lalamove CANCELS the
				// original order and creates a clone under a NEW orderId, emitting
				// CANCELED (old) → ORDER_REPLACED → the clone's own status events.
				// If the CANCELED landed first, this job is sitting in a failed
				// state (and the vendor may have received a failure email — rare,
				// self-healing): repoint AND revive it, because the delivery is
				// still happening under the new id.
				const newId =
					typeof orderData.orderId === "string" ? orderData.orderId : undefined;
				if (newId && newId !== job.providerOrderId) {
					await ctx.db.patch(job._id, {
						providerOrderId: newId,
						status: "assigning",
						failureReason: undefined,
						lastEventAt: eventAt,
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
	| "no_seller_phone";

type BookingConfig = NonNullable<Doc<"retailers">["deliveryBooking"]>;

function dispatchBlockReason(args: {
	order: Doc<"orders">;
	retailer: Doc<"retailers">;
	activeJob: Doc<"deliveryJobs"> | undefined;
	credentials: LalamoveCredentials | null;
	planOk: boolean;
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
	// Lalamove MY validates the rider-contact AREA CODE: the seller's number
	// must be Malaysian (a non-MY buyer number is tolerated — dispatch falls
	// back to the seller as the rider contact; see getDispatchContext).
	if (!toLalamoveMyPhone(retailer.waPhone)) return "no_seller_phone";
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
			/** True when the buyer's WhatsApp isn't a Malaysian number — the
			 * rider contact fell back to the seller (surfaced in the confirm
			 * dialog so nobody is surprised when the rider calls the store). */
			buyerContactFallback: boolean;
			vehicleType: string;
			credentials: LalamoveCredentials;
	  };

/**
 * Shared eligibility + payload assembly for one booking attempt (used by the
 * dispatch context read below).
 */
async function dispatchContextForOrder(
	ctx: QueryCtx,
	order: Doc<"orders">,
	retailer: Doc<"retailers">,
	planOk: boolean,
): Promise<DispatchContext> {
	const jobs = await ctx.db
		.query("deliveryJobs")
		.withIndex("by_order", (q) => q.eq("orderId", order._id))
		.collect();
	const activeJob = jobs.find((j) => isActiveJobStatus(j.status));

	const credentials = resolveLalamoveCredentials(
		retailer.deliveryBooking as BookingConfig | undefined,
	);

	const blocked = dispatchBlockReason({
		order,
		retailer,
		activeJob,
		credentials,
		planOk,
	});
	if (blocked) return { ok: false, reason: blocked };
	// Non-null after dispatchBlockReason — restated for the type system.
	if (!credentials) return { ok: false, reason: "no_credentials" };

	const address = order.deliveryAddress!;
	const businessAddress = retailer.businessAddress!;
	// Lalamove MY rejects non-Malaysian phones (422 on +65 etc. — a real JB
	// cross-border-buyer case). The rider contact falls back to the SELLER
	// when the buyer's number isn't MY, with the buyer's actual number
	// carried in remarks so the rider can still reach them via the seller.
	const sellerPhone = toLalamoveMyPhone(retailer.waPhone);
	if (!sellerPhone) return { ok: false, reason: "no_seller_phone" };
	const buyerMyPhone = toLalamoveMyPhone(order.customer.waPhone);
	const remarksParts = [
		order.shortId,
		buyerMyPhone
			? undefined
			: `Buyer WhatsApp: ${toLalamovePhone(order.customer.waPhone!)}`,
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
		sender: { name: retailer.storeName, phone: sellerPhone },
		recipient: {
			name: order.customer.name ?? "Customer",
			phone: buyerMyPhone ?? sellerPhone,
			remarks: remarksParts.join(" · ").slice(0, 400) || undefined,
		},
		buyerContactFallback: buyerMyPhone === null,
		vehicleType:
			(retailer.deliveryBooking as BookingConfig).vehicleType ?? "MOTORCYCLE",
		credentials,
	};
}


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
		return dispatchContextForOrder(ctx, order, retailer, planOk);
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
		if (body.includes("phone")) {
			return "Lalamove rejected a contact phone number — riders need a Malaysian (+60) number. Check your WhatsApp number in Settings → Store.";
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
	args: {
		shortId: v.string(),
		// Per-order vehicle override (a big single order needs a car even when
		// the store default is motorcycle) — quotes are per-vehicle, so the
		// dialog re-runs this on a switch. Omitted → the settings default.
		vehicleType: v.optional(
			v.union(v.literal("MOTORCYCLE"), v.literal("CAR")),
		),
	},
	handler: async (
		ctx,
		{ shortId, vehicleType: vehicleOverride },
	): Promise<
		| {
				ok: false;
				reason: DispatchBlock | "not_found" | "quote_failed";
				message?: string;
		  }
		| {
				ok: true;
				quotationId: string;
				senderStopId: string;
				recipientStopId: string;
				fee: number;
				buyerPaidFee: number;
				vehicleType: string;
				buyerContactFallback: boolean;
		  }
	> => {
		const context = await ctx.runQuery(internal.lalamove.getDispatchContext, {
			shortId,
		});
		if (!context.ok) return context;
		const vehicleType = vehicleOverride ?? context.vehicleType;
		try {
			const response = await callLalamove(
				context.credentials,
				"POST",
				"/v3/quotations",
				buildQuotationBody({
					serviceType: vehicleType,
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
				vehicleType,
				buyerContactFallback: context.buyerContactFallback,
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
 * sat open). The one-active-job invariant is enforced ATOMICALLY by
 * reserveBooking BEFORE the external POST — a reservation row claims the
 * slot, so two concurrent confirms (e.g. the same order open on phone +
 * desktop, each with its own prepared quote) can never both dispatch a
 * rider: the loser is rejected before any money moves. commitBooking then
 * finalizes the reservation with Lalamove's order id; a failed POST
 * releases it (amber card + rebook), and a scheduled expiry sweeps a
 * reservation orphaned by a crash mid-call.
 */
export const confirmBooking = action({
	args: {
		shortId: v.string(),
		quotationId: v.string(),
		senderStopId: v.string(),
		recipientStopId: v.string(),
		// The vehicle the quotation was prepared with (dialog override) — the
		// quotationId already binds Lalamove to it; this keeps OUR ledger row
		// labelled with what was actually booked, not the settings default.
		vehicleType: v.optional(
			v.union(v.literal("MOTORCYCLE"), v.literal("CAR")),
		),
	},
	handler: async (
		ctx,
		args,
	): Promise<
		| {
				ok: false;
				reason: DispatchBlock | "not_found" | "booking_failed";
				message?: string;
		  }
		| { ok: true; providerOrderId: string; costActual: number }
	> => {
		const context = await ctx.runQuery(internal.lalamove.getDispatchContext, {
			shortId: args.shortId,
		});
		if (!context.ok) return context;
		// Claim the order's booking slot BEFORE the external side effect. If a
		// concurrent confirm already holds it, bail here — no rider dispatched.
		let jobId: Id<"deliveryJobs">;
		try {
			jobId = await ctx.runMutation(internal.lalamove.reserveBooking, {
				orderId: context.orderId,
				retailerId: context.retailerId,
				quotationId: args.quotationId,
				vehicleType: args.vehicleType ?? context.vehicleType,
			});
		} catch {
			return {
				ok: false,
				reason: "job_active",
				message: "A rider booking is already in progress for this order.",
			};
		}
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
			await ctx.runMutation(internal.lalamove.commitBooking, {
				jobId,
				providerOrderId: parsed.providerOrderId,
				costActual: parsed.priceTotal,
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
			const message = friendlyBookingError(err);
			// Free the slot so the seller can rebook immediately; the released row
			// doubles as the amber failed card.
			await ctx.runMutation(internal.lalamove.releaseReservation, {
				jobId,
				reason: message,
			});
			return { ok: false, reason: "booking_failed", message };
		}
	},
});

/** How long an uncommitted reservation may exist before the sweeper flags
 * it. Generous vs the ~seconds Lalamove round-trip so a slow-but-successful
 * POST can't race its own expiry. */
const RESERVATION_EXPIRY_MS = 5 * 60 * 1000;

/**
 * Atomically claim the one-active-job slot for an order, BEFORE the external
 * POST. Inserting the placeholder row and checking for a competitor happen in
 * one transaction, so of two racing confirms exactly one wins — the ledger
 * row now guards the Lalamove side effect too, not just itself. The
 * reservation is visible as a live "Finding rider" job to any concurrently
 * open order page, which is also what blocks its Book button.
 */
export const reserveBooking = internalMutation({
	args: {
		orderId: v.id("orders"),
		retailerId: v.id("retailers"),
		quotationId: v.string(),
		vehicleType: v.string(),
	},
	handler: async (ctx, args): Promise<Id<"deliveryJobs">> => {
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
		const jobId = await ctx.db.insert("deliveryJobs", {
			orderId: args.orderId,
			retailerId: args.retailerId,
			provider: "lalamove",
			// providerOrderId stays unset until commitBooking — the marker that
			// this row is a reservation, not a confirmed booking.
			status: "assigning",
			costActual: 0, // real figure patched in at commit (never client-supplied)
			quotationId: args.quotationId,
			vehicleType: args.vehicleType,
			createdAt: now,
			updatedAt: now,
		});
		// Crash safety: if the action dies between reserve and commit/release
		// (deploy, timeout), this sweep frees the slot instead of blocking the
		// order's bookings forever. No-op once committed or released.
		await ctx.scheduler.runAfter(
			RESERVATION_EXPIRY_MS,
			internal.lalamove.expireStaleReservation,
			{ jobId },
		);
		return jobId;
	},
});

/** Finalize a reservation with Lalamove's confirmed order. */
export const commitBooking = internalMutation({
	args: {
		jobId: v.id("deliveryJobs"),
		providerOrderId: v.string(),
		costActual: v.number(),
		shareLink: v.optional(v.string()),
		providerStatus: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const job = await ctx.db.get(args.jobId);
		if (!job) return;
		const now = Date.now();
		const status: DeliveryJobStatus =
			normalizeLalamoveStatus(args.providerStatus) ?? "assigning";
		await ctx.db.patch(args.jobId, {
			providerOrderId: args.providerOrderId,
			status,
			costActual: args.costActual,
			shareLink: args.shareLink,
			// A commit that lost a (5-min!) race against its own expiry sweep
			// revives the row — the booking DOES exist at Lalamove either way.
			failureReason: undefined,
			updatedAt: now,
		});
		// Mirror the tracking link early (fill-if-unset) — same posture as the
		// DRIVER_ASSIGNED webhook path.
		if (args.shareLink) {
			const order = await ctx.db.get(job.orderId);
			if (order && !order.carrierTrackingUrl) {
				await ctx.db.patch(order._id, {
					carrierTrackingUrl: args.shareLink,
					updatedAt: now,
				});
			}
		}
	},
});

/** Free a reservation whose POST failed — the row becomes the amber failed
 * card with one-tap rebook. No-op once committed (providerOrderId set). */
export const releaseReservation = internalMutation({
	args: { jobId: v.id("deliveryJobs"), reason: v.string() },
	handler: async (ctx, { jobId, reason }) => {
		const job = await ctx.db.get(jobId);
		if (!job || job.providerOrderId !== undefined) return;
		await ctx.db.patch(jobId, {
			status: "canceled",
			failureReason: reason,
			updatedAt: Date.now(),
		});
	},
});

/** Scheduled sweep for a reservation orphaned by a crash between reserve and
 * commit/release. The copy tells the seller to check their Lalamove app —
 * in the crash-mid-POST case the rider order may exist there untracked. */
export const expireStaleReservation = internalMutation({
	args: { jobId: v.id("deliveryJobs") },
	handler: async (ctx, { jobId }) => {
		const job = await ctx.db.get(jobId);
		if (!job || job.providerOrderId !== undefined) return; // committed
		if (job.status !== "assigning") return; // already released
		await ctx.db.patch(jobId, {
			status: "expired",
			failureReason:
				"Booking never confirmed — check your Lalamove app before rebooking",
			updatedAt: Date.now(),
		});
	},
});

// ---------------------------------------------------------------------------
// Proof of delivery — rider drop-off photo (isPODEnabled at place order)
// ---------------------------------------------------------------------------

/** POD may lag COMPLETED by a beat (rider uploads the shot as they close the
 * stop) — retry a few times before giving up quietly. */
const POD_FETCH_RETRY_MS = 2 * 60 * 1000;
const POD_FETCH_MAX_ATTEMPTS = 3;
/** One recipient stop → normally one photo; defensive cap either way. */
const POD_MAX_IMAGES = 3;

export const getPodContext = internalQuery({
	args: { jobId: v.id("deliveryJobs") },
	handler: async (
		ctx,
		{ jobId },
	): Promise<{
		providerOrderId: string;
		orderId: Id<"orders">;
		credentials: LalamoveCredentials;
	} | null> => {
		const job = await ctx.db.get(jobId);
		// Reservations have no provider order to read; already-stored jobs are
		// done (idempotency for COMPLETED + POD_STATUS_CHANGED double-fires).
		if (!job || job.providerOrderId === undefined || job.podImageStorageIds) {
			return null;
		}
		const retailer = await ctx.db.get(job.retailerId);
		const credentials = resolveLalamoveCredentials(
			retailer?.deliveryBooking as BookingConfig | undefined,
		);
		if (!credentials) return null; // keys removed post-booking — no proof, no drama
		return {
			providerOrderId: job.providerOrderId,
			orderId: job.orderId,
			credentials,
		};
	},
});

/**
 * Pull the rider's drop-off photo(s) from GET /v3/orders and store them as
 * OUR blobs (Lalamove's image URLs have undocumented lifetime — never
 * hotlink). On success: patch the job (vendor card thumbnails) and send the
 * buyer a WhatsApp photo follow-up to the delivered message. Every failure
 * mode degrades to "no photo", never blocking the delivery flow itself.
 */
export const fetchPodImages = internalAction({
	args: { jobId: v.id("deliveryJobs"), attempt: v.number() },
	handler: async (ctx, { jobId, attempt }): Promise<void> => {
		const context = await ctx.runQuery(internal.lalamove.getPodContext, {
			jobId,
		});
		if (!context) return;

		const retry = async () => {
			if (attempt + 1 < POD_FETCH_MAX_ATTEMPTS) {
				await ctx.scheduler.runAfter(
					POD_FETCH_RETRY_MS,
					internal.lalamove.fetchPodImages,
					{ jobId, attempt: attempt + 1 },
				);
			}
		};

		let images: ReturnType<typeof parsePodImages>;
		try {
			const response = await callLalamove(
				context.credentials,
				"GET",
				`/v3/orders/${context.providerOrderId}`,
			);
			images = parsePodImages(response);
		} catch (err) {
			console.warn("[lalamove] POD fetch failed", {
				providerOrderId: context.providerOrderId,
				attempt,
				message: err instanceof Error ? err.message : String(err),
			});
			await retry();
			return;
		}
		if (images.length === 0) {
			// Not uploaded yet (or POD unsupported for this market/vehicle —
			// after the last attempt we stop quietly).
			await retry();
			return;
		}

		const storageIds: Id<"_storage">[] = [];
		for (const image of images.slice(0, POD_MAX_IMAGES)) {
			try {
				const res = await fetch(image.imageUrl);
				if (!res.ok) continue;
				storageIds.push(await ctx.storage.store(await res.blob()));
			} catch (err) {
				console.warn("[lalamove] POD image download failed", {
					providerOrderId: context.providerOrderId,
					message: err instanceof Error ? err.message : String(err),
				});
			}
		}
		if (storageIds.length === 0) {
			await retry();
			return;
		}

		const stored = await ctx.runMutation(internal.lalamove.storePodImages, {
			jobId,
			storageIds,
		});
		if (!stored) return; // lost an idempotency race — mutation cleaned our blobs

		const imageUrls: string[] = [];
		for (const id of storageIds) {
			const url = await ctx.storage.getUrl(id);
			if (url) imageUrls.push(url);
		}
		if (imageUrls.length > 0) {
			await ctx.scheduler.runAfter(0, internal.whatsapp.notifyDeliveryPhoto, {
				orderId: context.orderId,
				imageUrls,
			});
		}
	},
});

/** Attach stored POD blobs to the job. Returns false (and deletes the
 * incoming blobs) if another fetch won the race — exactly one set survives. */
export const storePodImages = internalMutation({
	args: {
		jobId: v.id("deliveryJobs"),
		storageIds: v.array(v.id("_storage")),
	},
	handler: async (ctx, { jobId, storageIds }): Promise<boolean> => {
		const job = await ctx.db.get(jobId);
		if (!job || job.podImageStorageIds) {
			for (const id of storageIds) {
				await ctx.storage.delete(id);
			}
			return false;
		}
		await ctx.db.patch(jobId, {
			podImageStorageIds: storageIds,
			updatedAt: Date.now(),
		});
		return true;
	},
});

/**
 * DEV/TEST helper — inject a stand-in proof-of-delivery photo. Lalamove's
 * sandbox has no riders, so fetchPodImages can never find a real image
 * there; this runs the SAME post-parse pipeline (download → store →
 * storePodImages → buyer WhatsApp photo) with a placeholder, so the card
 * thumbnails and the WA follow-up can be eyeballed locally. Internal-only
 * (CLI/dashboard — clients can't call it):
 *
 *   npx convex run lalamove:devInjectPodImage '{"providerOrderId":"354…"}'
 */
export const devInjectPodImage = internalAction({
	args: {
		providerOrderId: v.string(),
		imageUrl: v.optional(v.string()),
	},
	handler: async (ctx, { providerOrderId, imageUrl }): Promise<string> => {
		const { jobId } = await ctx.runQuery(internal.lalamove.getWebhookContext, {
			providerOrderId,
			apiKey: "",
		});
		if (!jobId) return `no deliveryJobs row for ${providerOrderId}`;
		const source =
			imageUrl ?? "https://picsum.photos/seed/kedaipal-pod/800/600";
		const res = await fetch(source);
		if (!res.ok) return `image fetch failed: HTTP ${res.status}`;
		const storageId = await ctx.storage.store(await res.blob());
		const stored = await ctx.runMutation(internal.lalamove.storePodImages, {
			jobId,
			storageIds: [storageId],
		});
		if (!stored) return "job already has POD images — nothing injected";
		const url = await ctx.storage.getUrl(storageId);
		if (url) {
			const jobRow = await ctx.runQuery(internal.lalamove.getPodJobOrder, {
				jobId,
			});
			if (jobRow) {
				await ctx.scheduler.runAfter(0, internal.whatsapp.notifyDeliveryPhoto, {
					orderId: jobRow.orderId,
					imageUrls: [url],
				});
			}
		}
		return `injected 1 POD image onto job ${jobId} — check the order card + buyer WhatsApp`;
	},
});

/** Tiny lookup for devInjectPodImage — job → orderId. */
export const getPodJobOrder = internalQuery({
	args: { jobId: v.id("deliveryJobs") },
	handler: async (ctx, { jobId }): Promise<{ orderId: Id<"orders"> } | null> => {
		const job = await ctx.db.get(jobId);
		return job ? { orderId: job.orderId } : null;
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
		// A reservation (no providerOrderId yet) has nothing to cancel at
		// Lalamove — it either commits, releases, or expires within seconds.
		if (!active || active.providerOrderId === undefined) return null;
		const retailer = await ctx.db.get(order.retailerId);
		const credentials = resolveLalamoveCredentials(
			retailer?.deliveryBooking as BookingConfig | undefined,
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
			// Seller-facing (they read it on the order card); the CANCELED webhook
			// that follows preserves this instead of overwriting with "other".
			failureReason: "Cancelled by you",
			updatedAt: Date.now(),
		});
	},
});


/** Public job shape for the order-detail card — no credentials, no secrets. */
export type DeliveryJobView = {
	status: DeliveryJobStatus;
	/** Unset only for the seconds-long pre-commit reservation window. */
	providerOrderId?: string;
	costActual: number;
	vehicleType: string;
	driver?: { name: string; phone: string; plateNumber: string };
	shareLink?: string;
	failureReason?: string;
	createdAt: number;
	/** Rider drop-off photo URLs (proof of delivery), set once completed. */
	podImageUrls?: string[];
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
		/** Seller's opt-in "prompt me to book when I mark packed" preference —
		 * the card auto-opens the confirm dialog on the packed transition. */
		promptBookOnPacked: boolean;
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
		const blockReason = dispatchBlockReason({
			order,
			retailer,
			activeJob,
			credentials,
			planOk,
		});
		const promptBookOnPacked =
			retailer.deliveryBooking?.promptBookOnPacked === true;
		// Rider drop-off photos (proof of delivery) — resolved to URLs for the
		// card's completed state.
		let podImageUrls: string[] | undefined;
		if (latest?.podImageStorageIds?.length) {
			const urls = await Promise.all(
				latest.podImageStorageIds.map((id) => ctx.storage.getUrl(id)),
			);
			podImageUrls = urls.filter((u): u is string => u !== null);
		}
		return {
			promptBookOnPacked,
			job: latest
				? {
						status: latest.status,
						providerOrderId: latest.providerOrderId,
						costActual: latest.costActual,
						vehicleType: latest.vehicleType,
						driver: latest.driver,
						shareLink: latest.shareLink,
						failureReason: latest.failureReason,
						createdAt: latest.createdAt,
						podImageUrls,
					}
				: null,
			blockReason,
		};
	},
});


/**
 * Daily hygiene: delete checkout-quote rows that were never consumed (buyer
 * abandoned the sheet, superseded re-quotes). Anything older than 24h is far
 * past CHECKOUT_QUOTE_MAX_AGE_MS, so nothing valid can ever be purged. Rides
 * the system creation-time index; batch-capped as a runaway guard (the next
 * night catches any remainder).
 */
export const purgeStaleCheckoutQuotes = internalMutation({
	args: {},
	handler: async (ctx): Promise<void> => {
		const cutoff = Date.now() - 24 * 60 * 60 * 1000;
		const stale = await ctx.db
			.query("deliveryQuotes")
			.withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
			.take(1000);
		for (const row of stale) {
			await ctx.db.delete(row._id);
		}
		if (stale.length > 0) {
			console.log("[lalamove] purged stale checkout quotes", {
				count: stale.length,
			});
		}
	},
});
