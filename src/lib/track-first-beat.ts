// The first node of the buyer's tracking timeline (/track/<token>).
//
// Pure so the four cases are pinned without rendering the page. The node is
// always "done" — any order on that page has been received — so its WORD is
// the only thing that varies, and it has to be true of what actually happened.

import { BOOKING_RECEIVED_LABEL, type Locale } from "./orderStatus";

export function trackFirstBeatLabel(opts: {
	/** A booking (stay or package) — by `deliveryMethod`, not product kind. */
	isBooking: boolean;
	status: string;
	/** Set when a request left `booking_requested` without approval. */
	bookingResolution?: string;
	locale: Locale;
	/** The store's `booking_requested` label (renames + locale applied). */
	requestedLabel: string;
	/** The store's `pending` label ("Order Received"). */
	pendingLabel: string;
}): string {
	// Still waiting, or a request that was declined/expired: the request IS
	// the story — including an RSVP on an event that approves each guest,
	// which shares this status (judged by status, not by kind).
	if (
		opts.status === "booking_requested" ||
		opts.bookingResolution !== undefined
	)
		return opts.requestedLabel;
	// Past the request — instant-booked or approved. "Awaiting Approval" as a
	// done step told an instant-book guest they had waited for nothing.
	if (opts.isBooking) return BOOKING_RECEIVED_LABEL[opts.locale];
	return opts.pendingLabel;
}
