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
	classifyQuoteFailure,
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
	decryptLalamoveCredentials,
	resolveDispatchSchedule,
	resolveLalamoveCredentials,
	classifyBookingFailure,
	resolveScheduleAt,
	toLalamoveMyPhone,
	toLalamovePhone,
} from "./lib/lalamove";
import { DEFAULT_COUNTRY } from "./lib/country";
import { riderBookingAllowed } from "./lib/delivery";
import { rateLimiter } from "./lib/rateLimiter";
import { composeFulfilmentMoment } from "./lib/fulfilmentDate";
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

/** Signed fetch against the Lalamove REST API. The single decrypt-at-use
 * choke point (86eyn25gk): credentials arrive from internal queries possibly
 * still carrying ciphertext, and the env must come from the PLAINTEXT key —
 * decrypting here fixes every caller at once. */
async function callLalamove(
	credentials: LalamoveCredentials,
	method: "GET" | "POST" | "DELETE" | "PATCH",
	path: string,
	body?: { data: Record<string, unknown> },
): Promise<unknown> {
	const live = await decryptLalamoveCredentials(credentials);
	const bodyStr = body ? JSON.stringify(body) : "";
	const headers = await buildLalamoveHeaders({
		credentials: live,
		method,
		path,
		body: bodyStr,
		timestamp: Date.now(),
		requestId: crypto.randomUUID(),
	});
	const res = await fetch(`${LALAMOVE_BASE_URL[live.env]}${path}`, {
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
		deliveryDirection: "standard" | "collection";
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
			deliveryDirection:
				retailer.deliveryBooking?.deliveryDirection ?? "standard",
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
		/** The buyer's chosen time on that day (minutes since MYT midnight,
		 * 86eyg0n8e follow-up). When present the quote is priced for the EXACT
		 * moment instead of the noon heuristic — the same resolveScheduleAt
		 * rule dispatch uses, so the buyer-paid fee and the booked trip can't
		 * be priced for different moments. Omitted (older clients, no time
		 * captured) keeps the noon behaviour byte-identical. */
		fulfilmentTimeMinutes: v.optional(v.number()),
	},
	handler: async (
		ctx,
		args,
	): Promise<
		| { status: "quoted"; quoteId: Id<"deliveryQuotes">; fee: number }
		// The destination isn't in Lalamove's service area — a PERMANENT answer
		// for this address, so the buyer must be told to change it, never to
		// "try again shortly" (27 Jul: Alor Setar on a Selangor store read as a
		// system glitch). See classifyQuoteFailure.
		| { status: "out_of_range" }
		// The SELLER's Lalamove setup is broken (missing/revoked keys, no
		// pickup pin) — not the buyer's fault and not retryable by them; the
		// copy points at the store / pickup instead of an endless retry.
		| { status: "store_unavailable" }
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
		if (!context) return { status: "store_unavailable" };
		const credentials = resolveLalamoveCredentials(context.booking);
		if (!credentials) return { status: "store_unavailable" };

		try {
			// Pre-order pricing: a future fulfilment day is quoted as a SCHEDULED
			// pickup at noon MYT on that day (the hour barely moves the price;
			// the DAY can). Today stays an immediate quote. Guarded to Lalamove's
			// ~30-day scheduling window; anything odd falls back to immediate.
			const NOON_MYT_OFFSET_MS = 4 * 60 * 60 * 1000; // 12:00 MYT = 04:00 UTC
			const scheduleAt =
				args.fulfilmentDate !== undefined &&
				args.fulfilmentTimeMinutes !== undefined
					? resolveScheduleAt(
							composeFulfilmentMoment(
								args.fulfilmentDate,
								args.fulfilmentTimeMinutes,
							),
						)
					: args.fulfilmentDate !== undefined &&
							args.fulfilmentDate > Date.now() &&
							args.fulfilmentDate < Date.now() + 30 * 24 * 60 * 60 * 1000
						? args.fulfilmentDate + NOON_MYT_OFFSET_MS
						: undefined;
			const storeStop = {
				coordinates: {
					latitude: context.origin.latitude,
					longitude: context.origin.longitude,
				},
				address: context.origin.label,
			};
			const buyerStop = {
				coordinates: {
					latitude: args.latitude,
					longitude: args.longitude,
				},
				address: args.address.trim().slice(0, 500) || "Delivery address",
			};
			const response = await callLalamove(
				credentials,
				"POST",
				"/v3/quotations",
				buildQuotationBody({
					serviceType: context.vehicleType,
					scheduleAt,
					// Collection service quotes the trip the rider will actually
					// drive (buyer → store); route prices aren't guaranteed
					// direction-symmetric (tolls, one-ways), and dispatch re-quotes
					// the same direction — so the buyer-paid fee and the variance
					// display stay honest.
					stops:
						context.deliveryDirection === "collection"
							? [buyerStop, storeStop]
							: [storeStop, buyerStop],
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
			// Three buyer stories, three copies — and only ONE is retryable.
			// See classifyQuoteFailure for the taxonomy + live measurements.
			const status =
				err instanceof LalamoveApiError
					? classifyQuoteFailure(err.status, err.body)
					: ("unavailable" as const);
			if (status !== "out_of_range") {
				// Coverage refusals are expected business outcomes, not errors;
				// broken-store and transient cases stay in the logs.
				console.warn("[lalamove] checkout quote failed", {
					retailerId: args.retailerId,
					status,
					message: err instanceof Error ? err.message : String(err),
				});
			}
			return { status };
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
				// stale events are naturally idempotent here too. COLLECTION jobs
				// update the JOB row only (86eyg0n8e): picked_up means the rider
				// took the goods FROM the buyer and completed means they reached
				// the SELLER — neither is "shipped/delivered to the customer", so
				// the seller advances the order by hand (their custom stages tell
				// the real story: collected → cleaning → …).
				const collection = job.deliveryDirection === "collection";
				const order = await ctx.db.get(job.orderId);
				if (!order || order.status === "cancelled") return;
				// The goods physically arrived with the seller. Recording WHEN is
				// not advancing the order — the lifecycle stays theirs — but it's
				// the only order-level trace that collection happened, and both
				// the seller's due-date badge and the buyer's page need it (see
				// orders.collectedAt). Set-if-unset, so replays never move it.
				if (
					collection &&
					status === "completed" &&
					order.collectedAt === undefined
				) {
					await ctx.db.patch(order._id, {
						collectedAt: eventAt,
						updatedAt: now,
					});
				}
				if (!collection) {
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
				// before we ever saw a shareLink on a status event. NOT for
				// collection jobs: their order never auto-ships, and a later manual
				// shipped-anchored advance would present the stale LEG-1 collection
				// trip as shipment tracking — the link stays on the job row (seller
				// card) instead.
				const link = job.shareLink ?? shareLink;
				if (link && job.deliveryDirection !== "collection") {
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
	| "country_unsupported"
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
	// Country FIRST — ahead of even `not_delivery`, because every reason below
	// names a fix, and in a market Lalamove doesn't serve there is no fix to
	// name. A store switched from Malaysia keeps `deliveryBooking.enabled`, so
	// without this the card fell through to `no_seller_phone` and told a
	// Singapore seller to "add a Malaysian (+60) WhatsApp number" — advice the
	// country switch itself refuses to let them take (86eyqgujv).
	if (!riderBookingAllowed(retailer.country ?? DEFAULT_COUNTRY))
		return "country_unsupported";
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
			/** "collection" reverses the trip: origin/sender are the BUYER's
			 * side, destination/recipient the seller's (86eyg0n8e). Snapshotted
			 * onto the job row at reserve so the webhook obeys what was booked,
			 * not the live setting. */
			deliveryDirection: "standard" | "collection";
			/** The exact moment the buyer asked for (fulfilment date + time),
			 * when both were captured — the default pickup time for a booking.
			 * resolveScheduleAt decides at prepare time whether it is still
			 * ahead (schedule for then) or past/imminent (book now). */
			requestedMoment?: number;
			/** Which Lalamove world this store books in, read from the STAMPED
			 * `deliveryBooking.env` (86eypncfy). Deliberately NOT
			 * `credentials.env`: that is inferred from the stored value, which is
			 * ciphertext, and a ciphertext never starts with `pk_test_` — so it
			 * reads "production" for everyone and would silently suppress the one
			 * warning that matters. Undefined = a row the backfill hasn't stamped
			 * yet; callers must treat that as "unknown", never as production. */
			env?: "sandbox" | "production";
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
	const remarks = remarksParts.join(" · ").slice(0, 400) || undefined;
	const storePoint = {
		latitude: businessAddress.latitude,
		longitude: businessAddress.longitude,
		address: businessAddress.label,
	};
	const buyerPoint = {
		latitude: address.latitude!,
		longitude: address.longitude!,
		address: formatDeliveryAddress(address),
	};
	const storeContact = { name: retailer.storeName, phone: sellerPhone };
	const buyerContact = {
		name: order.customer.name ?? "Customer",
		phone: buyerMyPhone ?? sellerPhone,
	};
	// Collection service (86eyg0n8e): the whole trip reverses — rider collects
	// at the BUYER's address (buyer becomes the sender contact, same +60
	// fallback) and drops off at the store. Remarks always ride the recipient
	// stop (the only remarks slot in Lalamove v3), which either way is the stop
	// where the order ref matters at hand-over.
	const collection =
		(retailer.deliveryBooking as BookingConfig).deliveryDirection ===
		"collection";
	return {
		ok: true,
		orderId: order._id,
		retailerId: retailer._id,
		shortId: order.shortId,
		buyerPaidFee: order.deliveryFee ?? 0,
		origin: {
			latitude: collection ? buyerPoint.latitude : storePoint.latitude,
			longitude: collection ? buyerPoint.longitude : storePoint.longitude,
			label: collection ? buyerPoint.address : storePoint.address,
		},
		destination: collection ? storePoint : buyerPoint,
		sender: collection ? buyerContact : storeContact,
		recipient: {
			...(collection ? storeContact : buyerContact),
			remarks,
		},
		buyerContactFallback: buyerMyPhone === null,
		env: (retailer.deliveryBooking as BookingConfig | undefined)?.env,
		vehicleType:
			(retailer.deliveryBooking as BookingConfig).vehicleType ?? "MOTORCYCLE",
		deliveryDirection: collection ? "collection" : "standard",
		requestedMoment:
			order.fulfilmentDate !== undefined &&
			order.fulfilmentTimeMinutes !== undefined
				? composeFulfilmentMoment(
						order.fulfilmentDate,
						order.fulfilmentTimeMinutes,
					)
				: undefined,
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


/**
 * Map a Lalamove API failure to seller-facing copy, via the error ID rather
 * than a substring of the raw body (86eypncfy — the old body sniffing
 * reported anything merely containing "credit"/"balance" as a wallet
 * problem).
 *
 * `env` matters for exactly one case and it is the case that cost us a
 * vendor: on a SANDBOX key an insufficient-balance refusal is not a wallet
 * problem at all. Lalamove's test environment has its own play-money wallet
 * that no real top-up can ever reach, so "top it up in the Lalamove app"
 * sends the seller to spend money that cannot possibly help — which is
 * precisely what happened to Wagyu Walid across 26 hours and nine attempts.
 */
function friendlyBookingError(
	err: unknown,
	env?: "sandbox" | "production",
): string {
	if (err instanceof LalamoveApiError) {
		switch (classifyBookingFailure(err.body)) {
			case "wallet":
				return env === "sandbox"
					? "These are Lalamove TEST keys, so this booking is hitting the sandbox — its balance is play money and topping up your real wallet can't change it. Paste your live keys (they start with pk_prod_) in Settings → Fulfilment to book real riders."
					: "Your Lalamove wallet doesn't have enough balance. Top it up in the Lalamove Business account these API keys belong to — a top-up in the personal Lalamove app credits a different wallet — then book again.";
			case "quote_expired":
				return "The price quote expired — get a fresh price and confirm within 5 minutes.";
			case "bad_phone":
				return "Lalamove rejected a contact phone number — riders need a Malaysian (+60) number. Check your WhatsApp number in Settings → Store.";
			case "out_of_range":
				return "Lalamove doesn't serve this drop-off address. The order needs to go out another way.";
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
		// Per-booking pickup-moment override (86eyp5qd1): the modal's time
		// picker. A number = "come at this exact moment" (rider leaves earlier
		// than the promise, or a 3am ask moved to a sane slot), "now" = dispatch
		// immediately even though the buyer's moment is still ahead. Omitted →
		// the buyer's fulfilment moment, exactly as before. Quotes are bound to
		// their scheduleAt, so any change here re-runs this action.
		scheduleAtOverride: v.optional(v.union(v.number(), v.literal("now"))),
	},
	handler: async (
		ctx,
		{ shortId, vehicleType: vehicleOverride, scheduleAtOverride },
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
				/** The pickup moment this quotation was scheduled for — the
				 * buyer's fulfilment date+time (or the seller's override,
				 * 86eyp5qd1) when still ahead at prepare time. Undefined = the
				 * rider comes now (the moment is past/imminent, or the order
				 * carries no time). The dialog says which; confirmBooking stamps
				 * it on the job. */
				scheduledFor?: number;
				/** The buyer's own fulfilment moment, untouched by any override —
				 * lets the modal warn when the trip being bought no longer
				 * matches what the order promises the buyer (86eyp5qd1). */
				buyerRequestedMoment?: number;
				/** When this quotation stops being bookable — Lalamove honours one
				 * for exactly 5 minutes (86eypncfy). Parsed all along and thrown
				 * away, which let the confirm dialog sit on a dead quote and
				 * re-send it forever. Undefined = the provider didn't say; the
				 * client falls back to its own 5-minute clock from receipt. */
				expiresAt?: number;
		  }
	> => {
		const context = await ctx.runQuery(internal.lalamove.getDispatchContext, {
			shortId,
		});
		if (!context.ok) return context;
		const vehicleType = vehicleOverride ?? context.vehicleType;
		// The buyer's ask is the DEFAULT; past or imminent books now — the
		// same pure rule the checkout quote used to price the fee. A seller
		// override (86eyp5qd1) rides the same clamps; only an explicit pick
		// beyond Lalamove's 30-day window is refused outright.
		const schedule = resolveDispatchSchedule(
			scheduleAtOverride,
			context.requestedMoment,
		);
		if (!schedule.ok) {
			return { ok: false, reason: "quote_failed", message: schedule.message };
		}
		const scheduledFor = schedule.scheduleAt;
		try {
			const response = await callLalamove(
				context.credentials,
				"POST",
				"/v3/quotations",
				buildQuotationBody({
					serviceType: vehicleType,
					scheduleAt: scheduledFor,
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
				scheduledFor,
				buyerRequestedMoment: context.requestedMoment,
				expiresAt: parsed.expiresAt
					? (Number.isFinite(Date.parse(parsed.expiresAt))
						? Date.parse(parsed.expiresAt)
						: undefined)
					: undefined,
			};
		} catch (err) {
			console.warn("[lalamove] dispatch quote failed", {
				shortId,
				message: err instanceof Error ? err.message : String(err),
			});
			return {
				ok: false,
				reason: "quote_failed",
				message: friendlyBookingError(err, context.env),
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
		// The scheduled pickup the quotation was prepared with (see
		// prepareBooking.scheduledFor) — display truth for the job row only;
		// Lalamove's timing is already bound by the quotationId.
		scheduledFor: v.optional(v.number()),
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
				deliveryDirection: context.deliveryDirection,
				scheduledAt: args.scheduledFor,
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
			const message = friendlyBookingError(err, context.env);
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
		deliveryDirection: v.optional(
			v.union(v.literal("standard"), v.literal("collection")),
		),
		scheduledAt: v.optional(v.number()),
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
		// Dispatch reads the store's LIVE direction, while `orders.deliveryDirection`
		// was frozen at create — so an order placed before the seller switched to
		// collection, and booked after, produces a collection trip on an order that
		// still calls itself standard. Everything downstream keys off the ORDER
		// (the status gate, the buyer's live-rider strip, the labels), so it would
		// all be blind to a rider genuinely heading to the buyer's door. Freeze the
		// real direction onto the order here, set-if-unset — a booking is the
		// moment the trip becomes a fact. Never un-set: a standard booking on a
		// collection order leaves the order alone.
		if (args.deliveryDirection === "collection") {
			const order = await ctx.db.get(args.orderId);
			if (order && order.deliveryDirection === undefined) {
				await ctx.db.patch(args.orderId, {
					deliveryDirection: "collection",
					updatedAt: now,
				});
			}
		}
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
			// "standard" stays unset (one spelling for the default) — only a
			// collection booking changes webhook behaviour.
			deliveryDirection:
				args.deliveryDirection === "collection" ? "collection" : undefined,
			scheduledAt: args.scheduledAt,
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
		// DRIVER_ASSIGNED webhook path, including its collection exclusion.
		if (args.shareLink && job.deliveryDirection !== "collection") {
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
		deliveryDirection: "standard" | "collection";
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
			deliveryDirection: job.deliveryDirection ?? "standard",
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

		// The rider's drop-off photo is NOT WhatsApp'd (86eyd63r8) — for either
		// trip direction. It was the one send in the codebase that produced N
		// messages from a single event (up to 3 images), and the order's single
		// message has long since gone out. Standard deliveries show the photos on
		// the buyer's tracking page + the seller's dispatch card; collection jobs
		// stay seller-only (86eyg0n8e — the shot is the rider at the SELLER's
		// door, and orders.get already hides it from the track page).
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
		return `injected 1 POD image onto job ${jobId} — check the order card + the buyer's tracking page`;
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
	/** Newest webhook event applied to the job — set means the seller's webhook
	 * registration demonstrably works, so status flows automatically (drives
	 * the order-detail manual-advance gate via riderDrivesOrderStatus). */
	lastEventAt?: number;
	/** Rider drop-off photo URLs (proof of delivery), set once completed. */
	podImageUrls?: string[];
	/** The direction THIS trip was booked in (86eyg0n8e), frozen at reserve.
	 * Describes what happened; the store-level setting below says what a NEW
	 * booking would do. They differ after a seller switches modes — and will
	 * differ routinely once direction can vary per order (per-product v2). */
	deliveryDirection: "standard" | "collection";
	/** Scheduled pickup moment, when this booking was placed for later —
	 * lets the card say "Scheduled · 3:30 PM" instead of sitting on
	 * "Finding rider" for hours. Unset = immediate booking. */
	scheduledAt?: number;
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
		/** Rider dispatch IS this vendor's delivery method. Settings couples this
		 * 1:1 with the "Lalamove" delivery-charge choice (picking it enables
		 * booking, switching away disables it), so it answers the seller-facing
		 * question "do I send riders or parcels?" — and the dashboard drops every
		 * manual parcel-courier surface when it's true (86eyff02p). Distinct from
		 * `blockReason === null`, which is about THIS order being bookable now. */
		bookingEnabled: boolean;
		/** The STORE's current direction (86eyg0n8e) — what booking from this
		 * card would do right now, so it drives the button/dialog wording and
		 * the manual-advance gate. What a past trip actually did lives on
		 * `job.deliveryDirection`; the two only diverge after a mode switch (and
		 * routinely once direction varies per order — per-product v2). */
		deliveryDirection: "standard" | "collection";
		/** Which Lalamove world a booking from this card would hit (86eypncfy).
		 * "sandbox" means no real rider can ever be dispatched and the buyer's
		 * fee was priced by the test environment, so the card says so out loud
		 * at every point of spend. Undefined = un-stamped row (pre-backfill) —
		 * rendered as nothing rather than a false all-clear. */
		env?: "sandbox" | "production";
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
			env: (retailer.deliveryBooking as BookingConfig | undefined)?.env,
			// Agrees with `blockReason` by construction: a stored `enabled` flag
			// carried in from Malaysia is not a working booking setup, and the
			// mark-shipped prompt keys off this to decide rider-vs-courier.
			bookingEnabled:
				retailer.deliveryBooking?.enabled === true &&
				riderBookingAllowed(retailer.country ?? DEFAULT_COUNTRY),
			deliveryDirection:
				retailer.deliveryBooking?.deliveryDirection ?? "standard",
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
						lastEventAt: latest.lastEventAt,
						podImageUrls,
						// Unset on rows booked before collection existed → standard,
						// which is exactly what those trips were.
						deliveryDirection: latest.deliveryDirection ?? "standard",
						scheduledAt: latest.scheduledAt,
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

/**
 * DEV/TEST helper — measure Lalamove's REAL constraints on a scheduled
 * pickup, so our lead-time floor is grounded in their behaviour instead of a
 * guess. Posts quotations (which never book or charge) at a series of
 * offsets from now and reports which are accepted.
 *
 *   npx convex run lalamove:devProbeScheduleAt '{"offsetsMinutes":[5,15,25,35,60]}'
 *
 * SANDBOX ONLY — refuses on a production key pair, mirroring
 * scripts/lalamove-simulate-webhook.mjs. Internal (CLI/dashboard only).
 */
export const devProbeScheduleAt = internalAction({
	args: {
		offsetsMinutes: v.array(v.number()),
		/** Defaults to the first retailer with Lalamove credentials. */
		retailerId: v.optional(v.id("retailers")),
	},
	handler: async (
		ctx,
		{ offsetsMinutes, retailerId },
	): Promise<Record<string, string>> => {
		const probe = await ctx.runQuery(internal.lalamove.getProbeContext, {
			retailerId,
		});
		if (!probe) return { error: "no retailer with Lalamove credentials" };
		// Judge sandbox-ness on the PLAINTEXT key — the stored value may be
		// ciphertext, whose pre-decrypt env always reads "production".
		const probeCredentials = await decryptLalamoveCredentials(
			probe.credentials,
		);
		if (probeCredentials.env !== "sandbox") {
			return { error: "refusing: not a sandbox key pair" };
		}
		const out: Record<string, string> = {};
		for (const offset of offsetsMinutes) {
			const at = Date.now() + offset * 60_000;
			try {
				const response = await callLalamove(
					probe.credentials,
					"POST",
					"/v3/quotations",
					buildQuotationBody({
						serviceType: "MOTORCYCLE",
						scheduleAt: at,
						stops: [
							{
								coordinates: {
									latitude: probe.origin.latitude,
									longitude: probe.origin.longitude,
								},
								address: probe.origin.label,
							},
							{
								coordinates: { latitude: 3.1073, longitude: 101.6067 },
								address: "12 Jln Mawar 3, Petaling Jaya, Selangor",
							},
						],
					}),
				);
				const parsed = parseQuotationResponse(response);
				out[`+${offset}m`] = `OK — ${(parsed.priceTotal / 100).toFixed(2)}`;
			} catch (err) {
				out[`+${offset}m`] =
					err instanceof LalamoveApiError
						? `HTTP ${err.status} ${err.body.slice(0, 160)}`
						: String(err).slice(0, 160);
			}
		}
		return out;
	},
});

/** Credentials + pickup pin for devProbeScheduleAt. */
export const getProbeContext = internalQuery({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{
		origin: { latitude: number; longitude: number; label: string };
		credentials: LalamoveCredentials;
	} | null> => {
		const retailers = retailerId
			? [await ctx.db.get(retailerId)]
			: await ctx.db.query("retailers").collect();
		for (const r of retailers) {
			if (!r?.businessAddress) continue;
			const credentials = resolveLalamoveCredentials(
				r.deliveryBooking as BookingConfig | undefined,
			);
			if (!credentials) continue;
			return {
				origin: {
					latitude: r.businessAddress.latitude,
					longitude: r.businessAddress.longitude,
					label: r.businessAddress.label,
				},
				credentials,
			};
		}
		return null;
	},
});
