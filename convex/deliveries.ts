/**
 * Deliveries — the seller's daily view of everything going out (86eye9xd4,
 * 6A). Settings is where delivery is CONFIGURED; this is where it is CHECKED:
 * the courier wallet, the bookings made through Kedaipal (Lalamove riders and
 * Delyva couriers, one `deliveryJobs` ledger) and the parcels a seller ships
 * by hand — the queue still waiting for a consignment number, and what's in
 * transit with one.
 *
 * One query serves the Deliveries page AND the Home card, so the two never
 * disagree and the page opens instantly from Home (shared TanStack cache).
 *
 * Every read is bounded (newest N on an index) and every order it touches
 * goes through the credit gate (Credits T3.1): a gated order keeps its
 * number and status — the seller can see something is waiting — but loses
 * anything that leads back to the buyer (destination, tracking links, proof
 * photos).
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { readLalamoveWallet, type WalletView } from "./courierWallets";
import { creditGateFor, isOrderGated } from "./creditLock";
import { requireRetailerAccess } from "./lib/auth";
import { DEFAULT_CURRENCY } from "./lib/currency";
import { resolveDelyvaCredentials } from "./lib/delyva";
import {
	type DeliveryJobStatus,
	isActiveJobStatus,
} from "./lib/deliveryJobs";
import { storeBooksCouriers } from "./lib/courierBooking";
import { hasLalamoveCredentials } from "./lib/lalamove";
import { isReadyToShipForLabel } from "./lib/pdf/awb";

/** Bookings read per call — a month of a busy rider seller with room over. */
const JOB_SCAN = 200;
/** Bookings listed on the page. */
const JOB_ROWS = 100;
/** Orders read per status for the parcel queue. */
const PARCEL_SCAN = 200;
/** Parcels listed per section. */
const PARCEL_ROWS = 50;

export type JobGroup = "active" | "completed" | "failed";

export type DeliveryJobRow = {
	jobId: Id<"deliveryJobs">;
	orderId: Id<"orders">;
	shortId: string;
	provider: "lalamove" | "delyva";
	status: DeliveryJobStatus;
	group: JobGroup;
	direction: "standard" | "collection";
	/** Rider name for Lalamove, the courier service for Delyva. */
	carrier?: string;
	/** "Bike" / "Car" for a rider; undefined for a parcel courier. */
	vehicle?: "Bike" | "Car";
	cost: number;
	createdAt: number;
	failureReason?: string;
	/** The order this job belongs to has moved on (shipped by other means,
	 * cancelled) — a failed booking on it needs nothing. */
	orderSettled: boolean;
	/** A failed booking that still needs one: the order's NEWEST attempt, on
	 * an order still waiting. Older failures on the same order are history. */
	rebookable: boolean;
	/** Live tracking + the proof photo lead to the buyer's address, so a
	 * credit-gated order drops them. */
	shareLink?: string;
	hasProof: boolean;
	/** Still finding a Lalamove rider, so a tip (priority fee) can help. */
	tippable: boolean;
	/** Tips already on it — inside `cost`. */
	priorityFee?: number;
	gated: boolean;
};

export type ParcelRow = {
	orderId: Id<"orders">;
	shortId: string;
	/** "Kuching, Sarawak" — undefined on a gated order. */
	destination?: string;
	deliveryFee?: number;
	courierName?: string;
	trackingNo?: string;
	trackingUrl?: string;
	/** Paid + packed + has an address: its despatch label prints. */
	labelReady: boolean;
	labelPrintedAt?: number;
	gated: boolean;
};

export type DeliveriesOverview = {
	currency: string;
	wallet: WalletView;
	/** Has this store ever booked, or set up, a courier account? */
	booksCouriers: boolean;
	/** A rider or courier can be booked from an order right now (Lalamove or
	 * Delyva switched on) — the To-ship queue's next step is "Book", not
	 * "Add number". */
	bookingArmed: boolean;
	/** Does it hand parcels to a courier itself (needs a consignment number)? */
	shipsParcels: boolean;
	jobs: DeliveryJobRow[];
	counts: {
		active: number;
		/** Failed bookings on orders still waiting to go out — to rebook. */
		needsAttention: number;
		toShip: number;
		inTransit: number;
		/** Packed + paid parcels whose despatch label prints — the same
		 * predicate as the print queue (`isReadyToShipForLabel`). */
		labelsReady: number;
	};
	/** This calendar month's successful-or-live bookings and what they cost. */
	month: { start: number; bookings: number; cost: number; partial: boolean };
	toShip: ParcelRow[];
	inTransit: ParcelRow[];
};

function groupOf(status: DeliveryJobStatus): JobGroup {
	if (isActiveJobStatus(status)) return "active";
	return status === "completed" ? "completed" : "failed";
}

/** Start of the current month in Malaysia/Singapore time (UTC+8 — both). */
function monthStart(now: number): number {
	const local = new Date(now + 8 * 3_600_000);
	return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - 8 * 3_600_000;
}

export const overview = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<DeliveriesOverview> => {
		const { retailer } = await requireRetailerAccess(ctx, retailerId, {
			area: "orders",
			level: "read",
		});
		const now = Date.now();
		const gate = await creditGateFor(ctx, retailerId, now);
		const orderCache = new Map<Id<"orders">, Doc<"orders"> | null>();
		const orderOf = async (id: Id<"orders">) => {
			if (!orderCache.has(id)) orderCache.set(id, await ctx.db.get(id));
			return orderCache.get(id) ?? null;
		};

		// --- Bookings ------------------------------------------------------
		const jobs = await ctx.db
			.query("deliveryJobs")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.order("desc")
			.take(JOB_SCAN);
		const start = monthStart(now);
		const month = { start, bookings: 0, cost: 0, partial: false };
		for (const job of jobs) {
			if (job.createdAt < start || groupOf(job.status) === "failed") continue;
			month.bookings++;
			month.cost += job.costActual;
		}
		// The scan ran out while still inside this month — the totals are a
		// floor, and the page says so rather than presenting them as the month.
		month.partial =
			jobs.length === JOB_SCAN &&
			(jobs[jobs.length - 1]?.createdAt ?? 0) >= start;

		// Any order with a booking — live, delivered or failed — is accounted
		// for in Courier bookings (a failed one as "to rebook"), so the To-ship
		// queue never asks for the same order twice.
		const bookedOrders = new Set<Id<"orders">>();
		const jobRows: DeliveryJobRow[] = [];
		let active = 0;
		let needsAttention = 0;
		const seenOrders = new Set<Id<"orders">>();
		for (const job of jobs) {
			const group = groupOf(job.status);
			bookedOrders.add(job.orderId);
			const order = await orderOf(job.orderId);
			const orderSettled =
				!order ||
				order.status === "cancelled" ||
				order.status === "shipped" ||
				order.status === "delivered";
			if (group === "active") active++;
			// Only the NEWEST booking per order speaks for it: a failed attempt
			// that was then rebooked needs nothing.
			const newestForOrder = !seenOrders.has(job.orderId);
			seenOrders.add(job.orderId);
			const rebookable = group === "failed" && newestForOrder && !orderSettled;
			if (rebookable) needsAttention++;
			if (jobRows.length >= JOB_ROWS || !order) continue;
			const gated = isOrderGated(gate, order);
			jobRows.push({
				jobId: job._id,
				orderId: job.orderId,
				shortId: order.shortId,
				provider: job.provider,
				status: job.status,
				group,
				direction: job.deliveryDirection ?? "standard",
				carrier:
					job.provider === "lalamove" ? job.driver?.name : job.serviceName,
				vehicle:
					job.provider === "lalamove"
						? job.vehicleType === "CAR"
							? "Car"
							: "Bike"
						: undefined,
				cost: job.costActual,
				createdAt: job.createdAt,
				failureReason: job.failureReason,
				orderSettled,
				rebookable,
				shareLink: gated ? undefined : job.shareLink,
				hasProof: !gated && (job.podImageStorageIds?.length ?? 0) > 0,
				tippable:
					!gated &&
					job.provider === "lalamove" &&
					job.status === "assigning" &&
					job.providerOrderId !== undefined &&
					!(job.scheduledAt !== undefined && job.scheduledAt > now),
				priorityFee: job.priorityFee,
				gated,
			});
		}

		// --- Parcels you ship yourself -------------------------------------
		const parcelRow = (order: Doc<"orders">): ParcelRow => {
			const gated = isOrderGated(gate, order);
			const address = order.deliveryAddress;
			return {
				orderId: order._id,
				shortId: order.shortId,
				destination:
					gated || !address
						? undefined
						: [address.city, address.state].filter(Boolean).join(", "),
				deliveryFee: order.deliveryFee,
				courierName: order.courierName,
				trackingNo: gated ? undefined : order.trackingNo,
				trackingUrl: gated ? undefined : order.carrierTrackingUrl,
				labelReady: isReadyToShipForLabel(order),
				labelPrintedAt: order.labelPrintedAt,
				gated,
			};
		};
		const isParcel = (order: Doc<"orders">) =>
			(order.deliveryMethod ?? "delivery") === "delivery" &&
			order.deliveryDirection !== "collection";

		const packed = await ctx.db
			.query("orders")
			.withIndex("by_retailer_status", (q) =>
				q.eq("retailerId", retailerId).eq("status", "packed"),
			)
			.order("desc")
			.take(PARCEL_SCAN);
		const toShipAll = packed.filter(
			(o) => isParcel(o) && !o.trackingNo && !bookedOrders.has(o._id),
		);
		const shipped = await ctx.db
			.query("orders")
			.withIndex("by_retailer_status", (q) =>
				q.eq("retailerId", retailerId).eq("status", "shipped"),
			)
			.order("desc")
			.take(PARCEL_SCAN);
		const inTransitAll = shipped.filter((o) => isParcel(o) && !!o.trackingNo);

		const mode = retailer.deliveryConfig?.mode ?? "free";
		const booksCouriers =
			jobs.length > 0 ||
			hasLalamoveCredentials(retailer.deliveryBooking) ||
			resolveDelyvaCredentials(retailer.delyva) !== null;
		// Radius sellers drive their own deliveries — there is no consignment
		// number to chase. Every other delivering store may hand parcels over.
		const shipsParcels =
			toShipAll.length > 0 ||
			inTransitAll.length > 0 ||
			((retailer.offerDelivery ?? true) &&
				mode !== "radius" &&
				mode !== "live" &&
				mode !== "lalamove");

		return {
			currency: retailer.currency ?? DEFAULT_CURRENCY,
			wallet: await readLalamoveWallet(ctx, retailerId),
			booksCouriers,
			bookingArmed: storeBooksCouriers(retailer),
			shipsParcels,
			jobs: jobRows,
			counts: {
				active,
				needsAttention,
				toShip: toShipAll.length,
				inTransit: inTransitAll.length,
				labelsReady: packed.filter(isReadyToShipForLabel).length,
			},
			month,
			// Oldest first — the parcel that's waited longest goes out first.
			toShip: toShipAll.slice(-PARCEL_ROWS).reverse().map(parcelRow),
			inTransit: inTransitAll.slice(0, PARCEL_ROWS).map(parcelRow),
		};
	},
});
