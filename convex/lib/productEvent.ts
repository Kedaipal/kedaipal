// Event RSVP (`z8r3fdff9u`) — the ONE primitive an event needed: a fulfilment
// date FIXED on the product, which checkout locks to instead of letting each
// buyer pick their own.
//
// Deliberately NOT a fourth product `kind` and NOT variants-on-booking. An
// event is a normal `physical`/`service` product: it already has option axes
// (Set A / Set B / Set C — the food choice), per-variant stock, a storefront
// card, the inbox-by-fulfilment-date view and the WhatsApp confirmation. A
// booking listing has no variants at all ("one implicit variant", availability
// indexed on productId — docs/booking.md S1), so hanging a food choice off one
// would split capacity and reopen that index. See docs/event-rsvp.md.
//
// Pure + dependency-free (the `productKind` precedent): imported by BOTH the
// Convex mutations that validate it and the seller form / storefront that
// render it.

import {
	DAY_MS,
	MINUTES_PER_DAY,
	MYT_OFFSET_MS,
	formatFulfilmentDate,
	formatFulfilmentTime,
	isMytMidnight,
	todayMytMidnight,
} from "./fulfilmentDate";

/**
 * Hard ceiling on a seat cap. 500 is "the biggest room a Kedaipal seller
 * books", not a technical limit — it exists so a fat-fingered 5000 is caught
 * at the form rather than silently promising a hall we know she doesn't have.
 */
export const MAX_EVENT_SEATS = 500;

/**
 * A fixed-date event on a product.
 *
 * `seats` UNSET = uncapped — per-variant stock still applies, so a seller who
 * wants "30 of Set A, 20 of Set B" expresses that as stock and leaves the
 * total cap blank. Never default a missing value to anything; the
 * `capacityPerNight` posture.
 */
export type ProductEvent = {
	/** MYT midnight epoch — the one moment every RSVP's `fulfilmentDate` is
	 * forced to. */
	date: number;
	/** 0..1439 minutes from MYT midnight. Display + frozen onto each RSVP's
	 * `fulfilmentTimeMinutes`. Unset = an all-day event, date only. */
	timeMinutes?: number;
	/** Total seats across ALL options. Unset = uncapped. */
	seats?: number;
};

export type EventInput = {
	date?: number;
	timeMinutes?: number;
	seats?: number;
};

/**
 * Validate a seller-submitted event config.
 *
 * `allowPastDate` exists for the EDIT path: a seller re-saving an event that
 * has already run (fixing a typo'd seat cap the morning after) must not be
 * refused because the date is behind us. Create always refuses the past —
 * there is no such thing as taking RSVPs for last Tuesday.
 *
 * Throws with seller-facing copy; callers surface it verbatim (the
 * `sanitizeCapacityPerNight` posture).
 */
export function sanitizeEvent(
	raw: EventInput | undefined,
	opts: { now?: number; allowPastDate?: boolean } = {},
): ProductEvent | undefined {
	if (raw === undefined) return undefined;
	const now = opts.now ?? Date.now();

	if (raw.date === undefined || !Number.isFinite(raw.date))
		throw new Error("An event needs a date");
	if (!isMytMidnight(raw.date))
		throw new Error("Event date must be a calendar day");
	if (!opts.allowPastDate && raw.date < todayMytMidnight(now))
		throw new Error("Event date can't be in the past");

	let timeMinutes: number | undefined;
	if (raw.timeMinutes !== undefined) {
		if (
			!Number.isInteger(raw.timeMinutes) ||
			raw.timeMinutes < 0 ||
			raw.timeMinutes >= MINUTES_PER_DAY
		)
			throw new Error("Event time must be a time of day");
		timeMinutes = raw.timeMinutes;
	}

	let seats: number | undefined;
	// 0 normalizes to unset, so "no cap" has ONE spelling (minQuantity's
	// posture) — a stored 0 would otherwise read as "zero seats, sold out".
	if (raw.seats !== undefined && raw.seats !== 0) {
		if (
			!Number.isInteger(raw.seats) ||
			raw.seats < 1 ||
			raw.seats > MAX_EVENT_SEATS
		)
			throw new Error(
				`Seats must be a whole number between 1 and ${MAX_EVENT_SEATS}, or blank for no limit`,
			);
		seats = raw.seats;
	}

	return { date: raw.date, timeMinutes, seats };
}

/**
 * Has this event finished?
 *
 * TRUE from MYT midnight on the day AFTER the event — so the listing stays up
 * for the whole event day (a guest checking the venue at 7 AM for an 8 AM
 * breakfast still finds it), and disappears from the storefront by itself the
 * next morning. No cron, no seller action: the seller of a one-off event is
 * the last person who should have to remember to unpublish it.
 */
export function isEventPassed(
	event: Pick<ProductEvent, "date">,
	now: number = Date.now(),
): boolean {
	return todayMytMidnight(now) > event.date;
}

/** Days until the event (0 = today, negative = past). Drives the seller-side
 * "in 9 days" / "ran 3 days ago" wording. */
export function daysUntilEvent(
	event: Pick<ProductEvent, "date">,
	now: number = Date.now(),
): number {
	return Math.round((event.date - todayMytMidnight(now)) / DAY_MS);
}

/**
 * Glanceable badge for the storefront card and chip: "Thu 25 Sep · 8:00 AM".
 *
 * The year is dropped for an event inside the current MYT year and kept
 * otherwise — a card is read at a glance, but "Thu 25 Sep" for an event 14
 * months out would be a lie of omission. Confirmations use
 * `formatFulfilmentDateTime` instead, which always spells the year: the buyer
 * needs no ambiguity about the day they're committing to.
 */
export function formatEventBadge(
	event: ProductEvent,
	now: number = Date.now(),
): string {
	const thisYear = new Date(
		todayMytMidnight(now) + MYT_OFFSET_MS,
	).getUTCFullYear();
	const eventYear = new Date(event.date + MYT_OFFSET_MS).getUTCFullYear();
	// "Thu, 25 Sep 2026" → "Thu 25 Sep" (comma dropped: a badge, not a sentence).
	const full = formatFulfilmentDate(event.date).replace(",", "");
	const date =
		eventYear === thisYear ? full.replace(` ${eventYear}`, "") : full;
	return event.timeMinutes === undefined
		? date
		: `${date} · ${formatFulfilmentTime(event.timeMinutes)}`;
}

/**
 * Seats still open, or `undefined` when the event is uncapped. Kept here (not
 * inlined at each call site) so the storefront's "12 seats left", the seller's
 * RSVPs panel and the server's cap refusal can never disagree about the
 * arithmetic — including the clamp, which matters after a seller LOWERS a cap
 * below what's already taken.
 */
export function seatsLeft(
	event: Pick<ProductEvent, "seats">,
	taken: number,
): number | undefined {
	if (event.seats === undefined) return undefined;
	return Math.max(0, event.seats - taken);
}

/** Seller-facing summary for the product list subtitle and the wizard review:
 * "Event · Thu 25 Sep · 8:00 AM · 30 seats". */
export function describeEvent(
	event: ProductEvent,
	now: number = Date.now(),
): string {
	const parts = [`Event · ${formatEventBadge(event, now)}`];
	if (event.seats !== undefined)
		parts.push(`${event.seats} seat${event.seats === 1 ? "" : "s"}`);
	return parts.join(" · ");
}

/**
 * Should a PUBLIC storefront read drop this product?
 *
 * The one predicate every buyer-facing read applies — the grid, the product
 * page, the category page, the by-id endpoint, the sitemap and the popular
 * rail — so a finished event can't linger on one surface after vanishing from
 * the others. Non-event products are never hidden by it.
 *
 * Seller surfaces deliberately do NOT apply it: a past event stays in the
 * dashboard with its headcount, because "how many came to the September one?"
 * is a question about history.
 */
export function hiddenFromStorefront(
	product: { event?: Pick<ProductEvent, "date"> },
	now: number = Date.now(),
): boolean {
	return product.event !== undefined && isEventPassed(product.event, now);
}
