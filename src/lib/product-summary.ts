// Plain-words summary of a product's selling setup, shown as the strip at the
// top of the edit form ("3 choices by Size · Made to order · RM 12–28") so a
// seller confirms what they have before touching anything. Pure — derived from
// the variant editor's draft state, so it live-updates as they edit.
// See docs/product-setup-wizard.md.

import { parsePriceInput } from "./format";

export type SummaryInput = {
	options: { name: string; values: string[] }[];
	rows: {
		optionValues: string[];
		price: string;
		active: boolean;
		blockWhenOutOfStock: boolean;
	}[];
	hasCustomLine: boolean;
};

/** "12" / "12.50" — trailing .00 dropped so the strip reads like speech. */
function formatMajor(n: number): string {
	return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function describeProduct(
	{ options, rows, hasCustomLine }: SummaryInput,
	currency: string,
): string {
	const parts: string[] = [];

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
			allTrack ? "From stock" : allMto ? "Made to order" : "Mixed fulfilment",
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

	if (hasCustomLine) parts.push("+ custom option");

	return parts.join(" · ");
}
