// Plain-words summary of a product's selling setup, shown as the strip at the
// top of the edit form ("3 choices by Size · Made to order · RM 12–28") so a
// seller confirms what they have before touching anything. Pure — derived from
// the variant editor's draft state, so it live-updates as they edit.
// See docs/product-setup-wizard.md.

import { weekendDaysLabel } from "../../convex/lib/productKind";
import { parsePriceInput } from "./format";

export type SummaryInput = {
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
	 * spots/night · RM 80/night" for a free-range stay, "Booking · 30-day
	 * package · RM 150 per package" for a fixed-length one (S7). */
	booking?: {
		capacityPerNight: string;
		packageLength?: string;
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
	{ options, rows, customLine, booking }: SummaryInput,
	currency: string,
): string {
	const parts: string[] = [];

	// A booking listing speaks its own vocabulary: capacity per night + a
	// per-night price ("Booking · 5 spots/night · RM 80/night"). Choices, stock
	// words and the bespoke line don't exist on this kind by construction.
	if (booking) {
		const price = parsePriceInput(rows[0]?.price.trim() ?? "");
		const cap = booking.capacityPerNight.trim();
		const days = Number(booking.packageLength?.trim() || "0");
		const isPackage = Number.isFinite(days) && days > 0;
		const parts = ["Booking"];
		if (isPackage) parts.push(`${days}-day package`);
		// Blank capacity = unlimited (S7); saying "1 spot/night" there would be
		// a different product from the one the seller configured.
		parts.push(
			cap.length === 0
				? "Unlimited spots"
				: `${cap} spot${cap === "1" ? "" : "s"}/night`,
		);
		parts.push(
			price && price > 0
				? `${currency} ${formatMajor(price)}${isPackage ? " per package" : "/night"}`
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
