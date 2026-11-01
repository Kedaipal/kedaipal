// The Orders → Schedule view (`z8r3fdjv0d`): every dated programme on one
// screen, one row per (date, listing), with how many are registered and how
// many of those have paid. Pure — no Convex imports — so the grouping rules are
// unit-tested directly, like `eventSeats.ts`.
//
// The counting rules are deliberately the ones the seller already sees
// elsewhere, so this screen can never contradict the panel a row taps into:
//
//  - An EVENT counts SEATS (`items[].quantity`), never orders — the rule
//    `tallyEventSeats` uses, so "Registered 18" here is the "18 taken" on the
//    listing's RSVP panel. A guest RSVPing for three is three seats.
//  - A BOOKING counts bookings (one order = one booking). A stay's line
//    quantity is its nights and a package's is always 1, so quantity would
//    count nights for one listing and people for another.
//  - Only `cancelled` leaves (`holdsSeats` / `holdsCapacity`). A pending order
//    and a request awaiting approval both hold their place, so both count.
//
// Every registered unit lands in EXACTLY ONE bucket, so the chips always add up
// to the total and "how many do I still chase" is never a subtraction the
// seller has to do in their head:
//
//    registered = paid + claimed + unpaid + awaitingApproval + free + waitingOnCredits
//
// `claimed` is its own bucket because it is its own job: the buyer says they
// paid and the seller has not checked. Folding it into Paid tells the seller
// money landed that may not have; folding it into Unpaid sends them chasing a
// buyer who already paid. The inbox draws the same three-way line.

import type { Doc } from "../_generated/dataModel";
import { holdsSeats } from "./eventSeats";

/** How far ahead the screen looks, and how far back "Show past" reaches. Here,
 * in the pure module, so the route and the query share one number: the
 * client builds its window from these and the server refuses anything wider,
 * which keeps the order scan bounded whatever a hand-edited request asks. */
export const SCHEDULE_AHEAD_DAYS = 90;
export const SCHEDULE_PAST_DAYS = 30;

/** The order fields this grouping reads. Kept to the minimum so the caller
 * passes plain projections and a test can build one in a line. */
export type ScheduleOrder = {
	status: Doc<"orders">["status"];
	paymentStatus?: "unpaid" | "claimed" | "received";
	/** MYT midnight. Orders without one never reach this module. */
	fulfilmentDate?: number;
	deliveryMethod?: string;
	/** Booking orders carry their listing here (`orders.bookingProductId`). */
	bookingProductId?: string;
	/** `isFreeOrder` — resolved by the caller, because "free" has ONE meaning
	 * (zero AND no price still to settle) and this module must not grow a
	 * second, looser one. A RM0 made-to-order line awaiting its quote is owing,
	 * not free. */
	free: boolean;
	items: Array<{ productId: string; quantity: number }>;
	/** Waiting on credits (Credits T3.1) — resolved by the caller from the
	 * store's gate. Counted, never described: see `waitingOnCredits`. */
	creditGated: boolean;
};

/** The listing fields the rows need. */
export type ScheduleListing = {
	_id: string;
	name: string;
	kind: "event" | "booking";
	/** Events only. `date` is the RSVP key; the rest is display. */
	event?: {
		date: number;
		endDate?: number;
		timeMinutes?: number;
		seats?: number;
	};
};

export type ScheduleRow = {
	/** Stable React key: `${date}:${productId}`. */
	key: string;
	productId: string;
	name: string;
	kind: "event" | "booking";
	/** MYT midnight — the event day, or the booking's check-in. */
	date: number;
	/** Multi-day events only: the last day, shown as a span. Counts still key on
	 * `date` (the `tallyEventSeats` key). */
	endDate?: number;
	timeMinutes?: number;
	/** Event seat cap. Absent = no cap ("no cap", never "0 left"). Always absent
	 * on bookings, whose capacity is per NIGHT and so not a number for a date. */
	seats?: number;
	/** Seats (event) or bookings (booking) holding a place. */
	registered: number;
	/** The ORDERS behind `registered` that the seller can open — what the
	 * inbox's listing view will list, so the row's "Open 3 orders" is a promise
	 * the next screen keeps. Excludes orders waiting on credits, which the
	 * inbox hides until they're funded. */
	orders: number;
	/** Seller marked the money received (stored `received`, read as "Paid"). */
	paid: number;
	/** Buyer says they paid; the seller hasn't checked yet. */
	claimed: number;
	/** Payment still owed and not claimed — the ones to chase. */
	unpaid: number;
	/** A request (`booking_requested`) the seller hasn't approved. No payment has
	 * been asked for yet, so it is neither unpaid nor paid. */
	awaitingApproval: number;
	/** Nothing to pay (a free RSVP) — counted as registered, never as owing. */
	free: number;
	/** Arrived while the store had no credits (T3.1). The seller can't see these
	 * orders yet, so their payment state isn't theirs to read here either —
	 * they hold a place and are reported as waiting. */
	waitingOnCredits: number;
};

const ZERO_COUNTS = {
	registered: 0,
	paid: 0,
	claimed: 0,
	unpaid: 0,
	awaitingApproval: 0,
	free: 0,
	waitingOnCredits: 0,
} as const;

/** Which bucket one registered order belongs in. Order matters: a gated order
 * is reported as waiting whatever its payment state, and an unapproved request
 * has had no payment asked for. */
export function scheduleBucket(
	order: Pick<
		ScheduleOrder,
		"status" | "paymentStatus" | "free" | "creditGated"
	>,
): Exclude<keyof typeof ZERO_COUNTS, "registered"> {
	if (order.creditGated) return "waitingOnCredits";
	if (order.status === "booking_requested") return "awaitingApproval";
	if (order.paymentStatus === "received") return "paid";
	if (order.paymentStatus === "claimed") return "claimed";
	if (order.free) return "free";
	return "unpaid";
}

/**
 * Group the window's orders into schedule rows.
 *
 * `listings` is every listing an order or a seeded event refers to, by id.
 * `seedEvents` are the event listings whose date falls in the window: each one
 * gets a row even with nobody registered, because "0 of 30" is the most useful
 * thing this screen can say five days before a luncheon.
 *
 * An order line whose listing isn't in `listings` (a plain product on a dated
 * order) is ignored, so a cake ordered for Saturday never shows up here. That
 * is what makes this the DATED-PROGRAMMES view, not a second calendar.
 */
export function buildScheduleRows(args: {
	orders: readonly ScheduleOrder[];
	listings: ReadonlyMap<string, ScheduleListing>;
	seedEvents: readonly ScheduleListing[];
}): ScheduleRow[] {
	const rows = new Map<string, ScheduleRow>();

	const rowFor = (listing: ScheduleListing, date: number): ScheduleRow => {
		const key = `${date}:${listing._id}`;
		const existing = rows.get(key);
		if (existing) return existing;
		// An event's span, time and cap describe ITS date. An order that sits on
		// a different day (the event was moved after it was placed) gets a row of
		// its own on the day that buyer was told, with no cap claimed for it.
		const onEventDay =
			listing.event !== undefined && listing.event.date === date;
		const row: ScheduleRow = {
			key,
			productId: listing._id,
			name: listing.name,
			kind: listing.kind,
			date,
			endDate: onEventDay ? listing.event?.endDate : undefined,
			timeMinutes: onEventDay ? listing.event?.timeMinutes : undefined,
			seats: onEventDay ? listing.event?.seats : undefined,
			orders: 0,
			...ZERO_COUNTS,
		};
		rows.set(key, row);
		return row;
	};

	for (const listing of args.seedEvents) {
		if (listing.event) rowFor(listing, listing.event.date);
	}

	for (const order of args.orders) {
		if (!holdsSeats(order.status)) continue;
		const date = order.fulfilmentDate;
		if (date === undefined) continue;
		const bucket = scheduleBucket(order);

		if (order.deliveryMethod === "booking") {
			// One booking, one unit. The listing comes from the denormalised id,
			// falling back to the first line for rows from before it existed.
			const id = order.bookingProductId ?? order.items[0]?.productId;
			const listing = id === undefined ? undefined : args.listings.get(id);
			if (listing?.kind !== "booking") continue;
			const row = rowFor(listing, date);
			row.registered += 1;
			row[bucket] += 1;
			if (!order.creditGated) row.orders += 1;
			continue;
		}

		// Event lines: seats, per listing. One order can hold several event
		// lines in principle; each lands on its own listing's row.
		const counted = new Set<ScheduleRow>();
		for (const item of order.items) {
			const listing = args.listings.get(item.productId);
			if (listing?.kind !== "event") continue;
			const row = rowFor(listing, date);
			row.registered += item.quantity;
			row[bucket] += item.quantity;
			// Once per row, however many lines (Set A + Set B) the order holds.
			if (!order.creditGated && !counted.has(row)) {
				row.orders += 1;
				counted.add(row);
			}
		}
	}

	return [...rows.values()].sort(
		(a, b) =>
			a.date - b.date ||
			(a.timeMinutes ?? -1) - (b.timeMinutes ?? -1) ||
			a.name.localeCompare(b.name),
	);
}
