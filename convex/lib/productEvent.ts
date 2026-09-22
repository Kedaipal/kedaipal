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
	formatFulfilmentDateTime,
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
 * Length (days, inclusive) past which the FORM shows an amber "double-check
 * the last day" warning — a typo'd year on the end date keeps the listing up
 * and taking RSVPs long after the event, so an unusually long span is worth a
 * second look. Deliberately a warning, not a cap (Zaki, 23 Sep, reversing the
 * first build's hard 31-day block): a real 6-week class series must save, the
 * form already prints the whole range back (a cross-year range names both
 * years), and a hard cap's only workaround — leaving the last day blank —
 * reintroduces the exact vanishing-listing bug this field fixes. The server
 * enforces only the ticket's rules: a calendar day, not before the start.
 */
export const LONG_EVENT_WARN_DAYS = 14;

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
	/** LAST day of a multi-day event (MYT midnight, after `date`). Display +
	 * listing lifetime only: every RSVP's `fulfilmentDate` stays `date` (the
	 * check-in day), so the seat tally never changes key. Unset = a one-day
	 * event — the same-day value normalizes to unset, so it has one spelling. */
	endDate?: number;
};

export type EventInput = {
	date?: number;
	timeMinutes?: number;
	seats?: number;
	endDate?: number;
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

	let endDate: number | undefined;
	if (raw.endDate !== undefined && raw.endDate !== raw.date) {
		if (!Number.isFinite(raw.endDate) || !isMytMidnight(raw.endDate))
			throw new Error("Event end date must be a calendar day");
		if (raw.endDate < raw.date)
			throw new Error("Event end date can't be before its start date");
		endDate = raw.endDate;
	}

	return { date: raw.date, timeMinutes, seats, endDate };
}

/** Inclusive length of the event in days (1 for a one-day event). */
export function eventLengthDays(
	event: Pick<ProductEvent, "date" | "endDate">,
): number {
	return Math.round((eventLastDay(event) - event.date) / DAY_MS) + 1;
}

/** The event's last day — `endDate` for a multi-day event, else `date`. */
export function eventLastDay(
	event: Pick<ProductEvent, "date" | "endDate">,
): number {
	return event.endDate ?? event.date;
}

/**
 * Has this event finished?
 *
 * TRUE from MYT midnight on the day AFTER the event's LAST day — so the
 * listing stays up for the whole event (a guest checking the venue at 7 AM for
 * an 8 AM breakfast still finds it, and a 3-day camp doesn't vanish on its
 * second morning), and disappears from the storefront by itself afterwards. No
 * cron, no seller action: the seller of a one-off event is the last person who
 * should have to remember to unpublish it.
 */
export function isEventPassed(
	event: Pick<ProductEvent, "date" | "endDate">,
	now: number = Date.now(),
): boolean {
	return todayMytMidnight(now) > eventLastDay(event);
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
	const yearOf = (epoch: number) =>
		new Date(epoch + MYT_OFFSET_MS).getUTCFullYear();
	const monthOf = (epoch: number) =>
		new Date(epoch + MYT_OFFSET_MS).getUTCMonth();
	// Years are dropped only when EVERY day shown is this year — a camp from
	// 30 Dec to 1 Jan must name both years or the range reads backwards.
	const dropYear =
		yearOf(event.date) === thisYear && yearOf(eventLastDay(event)) === thisYear;
	// "Thu, 25 Sep 2026" → "Thu 25 Sep" (comma dropped: a badge, not a sentence).
	const day = (epoch: number) => {
		const full = formatFulfilmentDate(epoch).replace(",", "");
		return dropYear ? full.replace(` ${yearOf(epoch)}`, "") : full;
	};
	if (event.endDate === undefined) {
		return event.timeMinutes === undefined
			? day(event.date)
			: `${day(event.date)} · ${formatFulfilmentTime(event.timeMinutes)}`;
	}
	// Multi-day: the badge is a RANGE and drops the start time — on a grid
	// card the span is the fact, the hour is the product page's job
	// (`formatEventMoment` keeps it). Same month elides it from the start
	// ("Fri 4 – Sun 6 Dec"), so the chip fits one line on a 375px card.
	const sameMonth =
		monthOf(event.date) === monthOf(event.endDate) &&
		yearOf(event.date) === yearOf(event.endDate);
	const start = sameMonth
		? day(event.date).split(" ").slice(0, 2).join(" ")
		: day(event.date);
	return `${start} – ${day(event.endDate)}`;
}

/**
 * The FULL spelling of an event's moment, for every surface where a guest
 * commits or checks in — the checkout banner and read-back, the tracking page,
 * the seller's RSVPs panel and the WhatsApp RSVP confirm: "Fri, 4 Dec 2026
 * · 2:00 PM to Sun, 6 Dec 2026". Always spells the year (the
 * `formatFulfilmentDateTime` rule). One helper so a multi-day event can't read
 * as one day on the one surface that forgot the end date.
 */
export function formatEventMoment(
	event: Pick<ProductEvent, "date" | "timeMinutes" | "endDate">,
): string {
	const start = formatFulfilmentDateTime(event.date, event.timeMinutes);
	return event.endDate === undefined
		? start
		: `${start} to ${formatFulfilmentDate(event.endDate)}`;
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
	product: { event?: Pick<ProductEvent, "date" | "endDate"> },
	now: number = Date.now(),
): boolean {
	return product.event !== undefined && isEventPassed(product.event, now);
}
