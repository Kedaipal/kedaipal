// The counter's price-field parsing — one author for the custom-line input on
// the catalog and the line-edit sheet, so the two can never disagree on what
// counts as a price.
//
// RM0 is a REAL price here (a comped item, a freebie with a purchase, a
// warranty redo): the counter's order door accepts it and the server turns an
// all-free cart into a free order. What is NOT a price is nothing typed —
// `Number("")` is 0, so a blank field is guarded explicitly or the Add button
// would add a free line the seller never priced.

/** "2500" sen → "25.00" for the price input. */
export function centsToRm(cents: number): string {
	return (cents / 100).toFixed(2);
}

/**
 * "25" / "25.50" / "0" → integer sen. NaN when blank, negative or not a
 * number — the callers read NaN as "no valid price yet".
 */
export function rmToCents(rm: string): number {
	if (rm.trim() === "") return Number.NaN;
	const n = Number(rm);
	if (!Number.isFinite(n) || n < 0) return Number.NaN;
	return Math.round(n * 100);
}
