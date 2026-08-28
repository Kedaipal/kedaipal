/**
 * Code 128 (code set B) barcode encoder for the despatch label (86eyp63mp).
 *
 * Pure, dependency-free and typed — the `qr.ts` rationale applies here too: this
 * runs inside a Convex action, and pulling a barcode library in to emit ~170
 * black-and-white runs would be a worse trade than one well-tested table.
 *
 * WHAT IT ENCODES: the seller's OWN consignment number (`orders.trackingNo`),
 * recorded through the manual-courier flow (86eyehvk4). Kedaipal does not issue
 * courier AWBs, so this is never a courier-official barcode — it is the same
 * number printed as text right under it, in a form a warehouse scanner can read.
 *
 * CODE SET B ONLY. Set C would halve the width of an all-numeric consignment
 * number, but every real tracking number fits comfortably at set B's density
 * (a 12-digit J&T number is ~26 mm on a 105 mm label), and one code set means
 * one switch-free encoder. Set C is a size optimisation to add only if a seller
 * ever hits the width limit.
 */

/**
 * Element widths (bar, space, bar, space, bar, space) for Code 128 symbol
 * values 0…106. Value 106 (Stop) carries a seventh element — the terminating
 * bar. Set-B characters map as `value = charCode - 32`.
 *
 * `barcode.test.ts` checks every row against the format's own invariants —
 * six elements summing to 11 with an EVEN total bar width, widths in 1…4, all
 * 107 patterns distinct — which is what makes a transcription error loud.
 */
const PATTERNS: ReadonlyArray<readonly number[]> = [
	[2, 1, 2, 2, 2, 2], [2, 2, 2, 1, 2, 2], [2, 2, 2, 2, 2, 1], [1, 2, 1, 2, 2, 3],
	[1, 2, 1, 3, 2, 2], [1, 3, 1, 2, 2, 2], [1, 2, 2, 2, 1, 3], [1, 2, 2, 3, 1, 2],
	[1, 3, 2, 2, 1, 2], [2, 2, 1, 2, 1, 3], [2, 2, 1, 3, 1, 2], [2, 3, 1, 2, 1, 2],
	[1, 1, 2, 2, 3, 2], [1, 2, 2, 1, 3, 2], [1, 2, 2, 2, 3, 1], [1, 1, 3, 2, 2, 2],
	[1, 2, 3, 1, 2, 2], [1, 2, 3, 2, 2, 1], [2, 2, 3, 2, 1, 1], [2, 2, 1, 1, 3, 2],
	[2, 2, 1, 2, 3, 1], [2, 1, 3, 2, 1, 2], [2, 2, 3, 1, 1, 2], [3, 1, 2, 1, 3, 1],
	[3, 1, 1, 2, 2, 2], [3, 2, 1, 1, 2, 2], [3, 2, 1, 2, 2, 1], [3, 1, 2, 2, 1, 2],
	[3, 2, 2, 1, 1, 2], [3, 2, 2, 2, 1, 1], [2, 1, 2, 1, 2, 3], [2, 1, 2, 3, 2, 1],
	[2, 3, 2, 1, 2, 1], [1, 1, 1, 3, 2, 3], [1, 3, 1, 1, 2, 3], [1, 3, 1, 3, 2, 1],
	[1, 1, 2, 3, 1, 3], [1, 3, 2, 1, 1, 3], [1, 3, 2, 3, 1, 1], [2, 1, 1, 3, 1, 3],
	[2, 3, 1, 1, 1, 3], [2, 3, 1, 3, 1, 1], [1, 1, 2, 1, 3, 3], [1, 1, 2, 3, 3, 1],
	[1, 3, 2, 1, 3, 1], [1, 1, 3, 1, 2, 3], [1, 1, 3, 3, 2, 1], [1, 3, 3, 1, 2, 1],
	[3, 1, 3, 1, 2, 1], [2, 1, 1, 3, 3, 1], [2, 3, 1, 1, 3, 1], [2, 1, 3, 1, 1, 3],
	[2, 1, 3, 3, 1, 1], [2, 1, 3, 1, 3, 1], [3, 1, 1, 1, 2, 3], [3, 1, 1, 3, 2, 1],
	[3, 3, 1, 1, 2, 1], [3, 1, 2, 1, 1, 3], [3, 1, 2, 3, 1, 1], [3, 3, 2, 1, 1, 1],
	[3, 1, 4, 1, 1, 1], [2, 2, 1, 4, 1, 1], [4, 3, 1, 1, 1, 1], [1, 1, 1, 2, 2, 4],
	[1, 1, 1, 4, 2, 2], [1, 2, 1, 1, 2, 4], [1, 2, 1, 4, 2, 1], [1, 4, 1, 1, 2, 2],
	[1, 4, 1, 2, 2, 1], [1, 1, 2, 2, 1, 4], [1, 1, 2, 4, 1, 2], [1, 2, 2, 1, 1, 4],
	[1, 2, 2, 4, 1, 1], [1, 4, 2, 1, 1, 2], [1, 4, 2, 2, 1, 1], [2, 4, 1, 2, 1, 1],
	[2, 2, 1, 1, 1, 4], [4, 1, 3, 1, 1, 1], [2, 4, 1, 1, 1, 2], [1, 3, 4, 1, 1, 1],
	[1, 1, 1, 2, 4, 2], [1, 2, 1, 1, 4, 2], [1, 2, 1, 2, 4, 1], [1, 1, 4, 2, 1, 2],
	[1, 2, 4, 1, 1, 2], [1, 2, 4, 2, 1, 1], [4, 1, 1, 2, 1, 2], [4, 2, 1, 1, 1, 2],
	[4, 2, 1, 2, 1, 1], [2, 1, 2, 1, 4, 1], [2, 1, 4, 1, 2, 1], [4, 1, 2, 1, 2, 1],
	[1, 1, 1, 1, 4, 3], [1, 1, 1, 3, 4, 1], [1, 3, 1, 1, 4, 1], [1, 1, 4, 1, 1, 3],
	[1, 1, 4, 3, 1, 1], [4, 1, 1, 1, 1, 3], [4, 1, 1, 3, 1, 1], [1, 1, 3, 1, 4, 1],
	[1, 1, 4, 1, 3, 1], [3, 1, 1, 1, 4, 1], [4, 1, 1, 1, 3, 1], [2, 1, 1, 4, 1, 2],
	[2, 1, 1, 2, 1, 4], [2, 1, 1, 2, 3, 2], [2, 3, 3, 1, 1, 1, 2],
];

const START_B = 104;
const STOP = 106;

/**
 * Longest text we will draw as a barcode. Beyond this the bars get too narrow
 * to scan reliably at the label's fixed width, and an unreadable barcode is
 * worse than none — the caller falls back to the number in plain text.
 * 24 characters ≈ 0.29 mm per module across an A6 label's usable width; real
 * consignment numbers run 10–16.
 */
export const BARCODE_MAX_CHARS = 24;

/** A barcode as alternating runs, starting with a BAR. Widths are in modules. */
export type Barcode = {
	/** Element widths, bar-first and strictly alternating bar/space. */
	runs: number[];
	/** Total width in modules — divide the drawing area by this. */
	modules: number;
	/** The exact text encoded (after normalisation), for the caption below. */
	text: string;
};

/**
 * Normalise seller-entered text to what code set B can carry: trim, uppercase
 * (consignment numbers are conventionally uppercase, and a lowercase letter is
 * a different symbol that no courier prints), and drop anything outside
 * printable ASCII. Returns "" when nothing usable is left.
 */
export function normalizeBarcodeText(raw: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional printable-ASCII clamp
	return raw.trim().toUpperCase().replace(/[^\x20-\x7E]/g, "");
}

/**
 * Encode `raw` as Code 128-B, or return `null` when it can't be drawn legibly
 * (empty after normalisation, or longer than BARCODE_MAX_CHARS). Callers treat
 * `null` as "print the number as text only" — never as an error.
 */
export function encodeCode128(raw: string): Barcode | null {
	const text = normalizeBarcodeText(raw);
	if (text.length === 0 || text.length > BARCODE_MAX_CHARS) return null;

	const values = [START_B];
	for (const ch of text) values.push(ch.charCodeAt(0) - 32);

	// Modulo-103 weighted checksum: start value + Σ(position × value).
	let checksum = START_B;
	for (let i = 1; i < values.length; i++) checksum += i * values[i];
	values.push(checksum % 103, STOP);

	const runs: number[] = [];
	for (const value of values) runs.push(...PATTERNS[value]);
	return {
		runs,
		modules: runs.reduce((sum, w) => sum + w, 0),
		text,
	};
}

/** The raw pattern table, for the invariant tests. */
export const CODE128_PATTERNS = PATTERNS;
