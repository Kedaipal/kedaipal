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

import { DAY_MS, formatFulfilmentDate } from "../../../convex/lib/fulfilmentDate";
import { describeBookingSpan } from "../../lib/booking-dates";
import { formatPrice } from "../../lib/format";
import { AppImage } from "../ui/app-image";

/** The booking span an order carries, when it is one. */
export type OrderBookingSpan = {
	checkIn: number;
	checkOut: number;
	/** Fixed-length package (S7) — a validity window, not a stay. */
	packaged: boolean;
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
					{variantLabel ? (
						<span className="ml-1.5 font-normal text-muted-foreground">
							{variantLabel}
						</span>
					) : null}
				</p>
				<p className="text-xs text-muted-foreground">
					{booking
						? bookingLineDetail(booking, quantity, unitPrice, currency)
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
	// so a line whose quantity was ever touched still reads truthfully.
	const nights =
		quantity > 0
			? quantity
			: Math.round((booking.checkOut - booking.checkIn) / DAY_MS);
	return `${nights} night${nights === 1 ? "" : "s"} × ${formatPrice(unitPrice, currency)} · ${span}`;
}
