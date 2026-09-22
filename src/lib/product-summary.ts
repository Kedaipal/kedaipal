// Plain-words summary of a product's selling setup, shown as the strip at the
// top of the edit form ("3 choices by Size · Made to order · RM 12–28") so a
// seller confirms what they have before touching anything. Pure — derived from
// the variant editor's draft state, so it live-updates as they edit.
// See docs/product-setup-wizard.md.

import { describeEvent } from "../../convex/lib/productEvent";
import {
	type PackageUnit,
	weekendDaysLabel,
} from "../../convex/lib/productKind";
import { bookingPriceSuffix } from "./booking-dates";
import { parsePriceInput } from "./format";

export type SummaryInput = {
	/** Fixed event config (`z8r3fdff9u`), or null/absent for a normal product.
	 * Leads the strip ("Event · Fri 25 Sep · 8:00 AM · 30 seats") because it's
	 * what the product IS — the choices and stock words describe the rest. */
	event?: {
		date: number;
		timeMinutes?: number;
		seats?: number;
		endDate?: number;
	} | null;
	options: { name: string; values: string[] }[];
	rows: {
		optionValues: string[];
		price: string;
		active: boolean;
		blockWhenOutOfStock: boolean;
		/** Needed to tell a **made-to-order** product (bespoke, quoted, mockup
		 * approved) from one that's merely made fresh with a fixed price. */
		requiresProof: boolean;
	}[];
	/** The product's bespoke line, if it offers one — its price is the seller's
	 * starting price, so the strip needs the value, not just its presence. */
	customLine: { price: string } | null;
	/** Booking kind describes itself in booking words — "Booking · 5
	 * spots/night · RM 80/night" for a free-range stay, "Booking · 1-month
	 * package · 20 at a time · RM 150/month" for a fixed-length one (S7).
	 *
	 * `packageUnit` is required knowledge, not decoration: the strip was
	 * written when every package was days and kept saying "1-day package" on
	 * a 1-month membership after units shipped, which on the edit page reads
	 * exactly like the unit silently going back to days. Absent = days, the
	 * same default `isMonthlyUnit` reads for a pre-units listing. */
	booking?: {
		capacityPerNight: string;
		packageLength?: string;
		packageUnit?: PackageUnit;
		autoAccept?: boolean;
		/** Weekend per-night rate as typed (RM) + the nights it covers (S13).
		 * Blank/absent = one rate; ignored on a package. */
		weekendPrice?: string;
		weekendDays?: readonly number[];
	} | null;
};

/** "12" / "12.50" — trailing .00 dropped so the strip reads like speech. */
function formatMajor(n: number): string {
	return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * The one-line consequence under the seller's weekend-rate field (S13) —
 * "Fri and Sat nights charge RM 120, other nights RM 80." Shared by the
 * wizard and the edit form so the two can't explain the same knob
 * differently. Pure over the typed drafts; `null` when the rate is blank
 * (the caller shows its own "leave blank" hint).
 */
export function weekendRateConsequence(
	{
		basePrice,
		weekendPrice,
		weekendDays,
	}: {
		basePrice: string;
		weekendPrice: string;
		weekendDays: readonly number[];
	},
	currency: string,
): string | null {
	const weekend = parsePriceInput(weekendPrice.trim());
	if (weekend === null || weekend <= 0) return null;
	if (weekendDays.length === 0) return "Pick at least one night for this rate.";
	if (weekendDays.length === 7) {
		return "That's every night — set it as the price per night instead.";
	}
	const nights = weekendDaysLabel(weekendDays).replace(" & ", " and ");
	const base = parsePriceInput(basePrice.trim());
	const other =
		base !== null && base > 0
			? `, other nights ${currency} ${formatMajor(base)}`
			: "";
	return `${nights} nights charge ${currency} ${formatMajor(weekend)}${other}.`;
}

export function describeProduct(
	{ event, options, rows, customLine, booking }: SummaryInput,
	currency: string,
): string {
	const parts: string[] = [];
	// An event announces itself first — a booking never carries one, so this
	// only ever prefixes the product branches below.
	if (event) parts.push(describeEvent(event));

	// A booking listing speaks its own vocabulary: capacity per night + a
	// per-night price ("Booking · 5 spots/night · RM 80/night"). Choices, stock
	// words and the bespoke line don't exist on this kind by construction.
	if (booking) {
		const price = parsePriceInput(rows[0]?.price.trim() ?? "");
		const cap = booking.capacityPerNight.trim();
		const length = Number(booking.packageLength?.trim() || "0");
		const isPackage = Number.isFinite(length) && length > 0;
		const unit: PackageUnit = booking.packageUnit ?? "day";
		const parts = ["Booking"];
		// Hyphenated adjective, singular unit: "1-month package", "30-day
		// package", "2-night package" — the shape packageCountLabel already uses.
		if (isPackage) parts.push(`${length}-${unit} package`);
		// Blank capacity = unlimited (S7); saying "1 spot/night" there would be
		// a different product from the one the seller configured. A package is
		// counted AT A TIME, not per night — the words the capacity field and
		// the wizard review already use for it.
		parts.push(
			cap.length === 0
				? "Unlimited spots"
				: isPackage
					? `${cap} at a time`
					: `${cap} spot${cap === "1" ? "" : "s"}/night`,
		);
		// The ONE span author, so this strip, the storefront card and the price
		// field say "RM 150/month" alike. "Per package" is the wording that
		// helper's own docblock retired: it made the reader open the listing to
		// find out what span they were buying.
		parts.push(
			price && price > 0
				? `${currency} ${formatMajor(price)}${bookingPriceSuffix(isPackage ? length : undefined, unit)}`
				: "No price yet",
		);
		// The second rate, named by its nights: "RM 120 Fri & Sat". A package
		// has one flat price, so the weekend rate never shows there.
		const weekend = parsePriceInput(booking.weekendPrice?.trim() ?? "");
		if (
			!isPackage &&
			weekend &&
			weekend > 0 &&
			booking.weekendDays &&
			booking.weekendDays.length > 0
		) {
			parts.push(
				`${currency} ${formatMajor(weekend)} ${weekendDaysLabel(booking.weekendDays)}`,
			);
		}
		if (booking.autoAccept) parts.push("Instant book");
		return parts.join(" · ");
	}

	// A made-to-order product describes itself: no choices, no stock, and a
	// price that doesn't exist yet by design. Reading "One item · Made fresh ·
	// No price yet" would frame all three as things left to fill in.
	const madeToOrderOnly =
		options.length === 0 &&
		rows.length === 1 &&
		rows[0]?.requiresProof === true &&
		rows[0].blockWhenOutOfStock === false;
	if (madeToOrderOnly) {
		const base = parsePriceInput(rows[0].price.trim());
		// No "from" prefix: one variant means the storefront prints a flat price.
		return [
			...parts,
			"Made to order",
			base && base > 0 ? `${currency} ${formatMajor(base)}` : "Price on quote",
		].join(" · ");
	}

	// The editor's **made-to-order type**: no matrix at all, the product IS its
	// bespoke line (see VariantEditor.switchToMadeToOrder). Without this the
	// strip fell through to "One item · No price yet · + custom option" — three
	// wrong statements about a perfectly configured product. Its price is a
	// STARTING price (the mockup quote lands on top), so this says exactly what
	// the storefront prints: "From RM 40" (86eyhn4mr).
	if (options.length === 0 && rows.length === 0 && customLine) {
		const base = parsePriceInput(customLine.price.trim());
		return [
			...parts,
			"Made to order",
			base && base > 0
				? `From ${currency} ${formatMajor(base)}`
				: "Price on quote",
		].join(" · ");
	}

	// What the buyer picks.
	if (options.length === 0) {
		parts.push("One item");
	} else {
		const axisNames = options
			.map((a) => a.name.trim())
			.filter((n) => n.length > 0)
			.join(" × ");
		const n = rows.length;
		parts.push(
			`${n} choice${n === 1 ? "" : "s"}${axisNames ? ` by ${axisNames}` : ""}`,
		);
	}

	// How orders are prepared. Inactive rows don't count — they're off sale.
	const activeRows = rows.filter((r) => r.active);
	const judged = activeRows.length > 0 ? activeRows : rows;
	if (judged.length > 0) {
		const allTrack = judged.every((r) => r.blockWhenOutOfStock);
		const allMto = judged.every((r) => !r.blockWhenOutOfStock);
		parts.push(
			allTrack ? "From stock" : allMto ? "Made fresh" : "Mixed fulfilment",
		);
	}

	// Price (range across active rows with a valid price).
	const prices = activeRows
		.map((r) => parsePriceInput(r.price.trim()))
		.filter((p): p is number => p !== null);
	if (prices.length === 0) {
		parts.push("No price yet");
	} else {
		const min = Math.min(...prices);
		const max = Math.max(...prices);
		parts.push(
			min === max
				? `${currency} ${formatMajor(min)}`
				: `${currency} ${formatMajor(min)}–${formatMajor(max)}`,
		);
	}

	if (customLine) parts.push("+ custom option");

	return parts.join(" · ");
}
