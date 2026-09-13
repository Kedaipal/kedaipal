// One line of an order's Items list, rendered identically on the seller's
// order page and the buyer's tracking page.
//
// Extracted because the two had drifted: the seller's grew thumbnails
// (86eyrtz74) while the buyer's — the side that actually needs to recognise
// what they ordered — kept a bare name, and BOTH printed a booking as
// "2 × RM 80.00" as though the guest had bought two campsites.
//
// A booking's `quantity` IS its night count (bookings ride the standard money
// math so totals, CSV, insights and receipts need no special case). That's
// right for arithmetic and wrong for reading, so the SPAN is what renders:
// "2 nights × RM 80.00 · 31 Aug → 2 Sep", and a fixed-length package — one flat
// price, quantity 1 — states its validity window instead.
//
// A weekend rate (S13) splits one stay into two lines whose frozen
// `variantLabel` names the kind of night; the kind is read back through the
// SAME module that wrote it (`bookingNightKind`), so the sub-line can say
// "2 weekend nights × RM 120.00" and the title row needn't repeat the label.

import { partitionNights } from "../../../convex/lib/bookingAvailability";
import {
	DAY_MS,
	formatFulfilmentDate,
} from "../../../convex/lib/fulfilmentDate";
import {
	type BookingNightKind,
	bookingNightKind,
} from "../../../convex/lib/productKind";
import {
	describeBookingSpan,
	describeNights,
	formatNight,
} from "../../lib/booking-dates";
import { formatPrice } from "../../lib/format";
import { AppImage } from "../ui/app-image";

/** The booking span an order carries, when it is one. */
export type OrderBookingSpan = {
	checkIn: number;
	checkOut: number;
	/** Fixed-length package (S7) — a validity window, not a stay. */
	packaged: boolean;
	/** Frozen weekend night set (S13, `orders.bookingWeekendDays`). Lets a
	 * split line name ITS OWN nights instead of repeating the whole stay.
	 * Absent on a single-rate booking and on every pre-S13 one. */
	weekendDays?: readonly number[];
};

export function OrderItemLine({
	name,
	variantLabel,
	quantity,
	unitPrice,
	lineTotal,
	currency,
	imageUrl,
	booking,
}: {
	name: string;
	variantLabel?: string;
	quantity: number;
	unitPrice: number;
	lineTotal: number;
	currency: string;
	/** Resolved thumbnail, or undefined for the fallback box. Deliberately NOT
	 * frozen onto the order — a replaced photo shows the new one, a deleted one
	 * degrades to AppImage's placeholder rather than a broken image. */
	imageUrl?: string;
	/** Set on a booking order's line — replaces the "N × price" sub-line. */
	booking?: OrderBookingSpan;
}) {
	// A weekend/weekday line carries its kind in the frozen label; the
	// sub-line says it, so the title row doesn't repeat it.
	const nightKind = booking ? bookingNightKind(variantLabel) : undefined;
	const titleLabel = nightKind === undefined ? variantLabel : undefined;
	return (
		<li className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
			<AppImage
				src={imageUrl}
				alt={name}
				sizes="44px"
				className="size-11 shrink-0 rounded-xl border border-border object-cover"
			/>
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium">
					{name}
					{titleLabel ? (
						<span className="ml-1.5 font-normal text-muted-foreground">
							{titleLabel}
						</span>
					) : null}
				</p>
				<p className="text-xs text-muted-foreground">
					{booking
						? bookingLineDetail(
								booking,
								quantity,
								unitPrice,
								currency,
								nightKind,
							)
						: `${quantity} × ${formatPrice(unitPrice, currency)}`}
				</p>
			</div>
			<p className="shrink-0 text-sm font-semibold tabular-nums">
				{formatPrice(lineTotal, currency)}
			</p>
		</li>
	);
}

/**
 * The sub-line for a booking. A package is one flat price for a window, so it
 * says only what the window is; a free-range stay is genuinely per-night, so
 * the nights and the nightly rate both earn their place.
 */
function bookingLineDetail(
	booking: OrderBookingSpan,
	quantity: number,
	unitPrice: number,
	currency: string,
	nightKind: BookingNightKind | undefined,
): string {
	const span = describeBookingSpan(booking.checkIn, booking.checkOut, {
		isPackage: booking.packaged,
		format: formatFulfilmentDate,
	});
	if (booking.packaged) {
		// On a package `quantity` is the NUMBER OF PACKAGES and `price` the price
		// of one, so "3 × RM 450.00" is exactly the arithmetic — no need to store
		// the package length on the order to say something true. A single package
		// says only its window: "1 ×" is noise.
		return quantity > 1
			? `${quantity} × ${formatPrice(unitPrice, currency)} · ${span}`
			: span;
	}
	// `quantity` is the night count, but derive from the dates as the fallback
	// so a line whose quantity was ever touched still reads truthfully. (On a
	// split stay each line's quantity is ITS nights, never the whole span's.)
	const nights =
		quantity > 0
			? quantity
			: Math.round((booking.checkOut - booking.checkIn) / DAY_MS);
	const noun = nightKind ? `${nightKind} night` : "night";
	const count = `${nights} ${noun}${nights === 1 ? "" : "s"} × ${formatPrice(unitPrice, currency)}`;
	// A split line names ITS OWN nights. Printing the whole stay on both lines
	// (as this did at first) said "Thu 17 → Sat 19" twice over, once beside
	// RM 40 and once beside RM 50, so each line looked priced for the entire
	// stay — and neither said which night was the expensive one.
	const own = ownNights(booking, nightKind);
	if (own !== null) return `${count} · ${describeNights(own, formatNight)}`;
	// One line for the whole stay (no weekend rate, or a pre-S13 booking with
	// no frozen night set): the span IS this line's span, so it still reads.
	return `${count} · ${span}`;
}

/**
 * The nights THIS line charged for, or null when the line covers the whole
 * stay (nothing to narrow) or the order predates the frozen night set.
 */
function ownNights(
	booking: OrderBookingSpan,
	nightKind: BookingNightKind | undefined,
): number[] | null {
	if (nightKind === undefined || booking.weekendDays === undefined) return null;
	const { weekday, weekend } = partitionNights(
		booking.checkIn,
		booking.checkOut,
		booking.weekendDays,
	);
	const own = nightKind === "weekend" ? weekend : weekday;
	// A set that came out empty means the frozen days no longer describe this
	// span (only reachable if a row were edited by hand) — fall back rather
	// than print a line with no nights at all.
	return own.length > 0 ? own : null;
}
