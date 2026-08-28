/**
 * Despatch-label template config (86eyp63mp) — what a store's printed label
 * shows, and on what paper.
 *
 * No Convex imports: the sanitizer runs in `retailers.updateSettings`, the
 * resolver runs in the label view-model AND in the Settings → Fulfilment card,
 * so client and server literally share this code (the `openingHours.ts` /
 * `minOrderRules.ts` posture).
 *
 * `undefined` = every default — every pre-existing store, zero migration. Each
 * field is optional on the stored row so a future toggle is a widen, not a
 * migration, and `sanitizeAwbConfig` drops any field that equals its default
 * (an all-default save normalises back to `undefined`) so "the defaults" has
 * exactly one spelling.
 *
 * IMPORTANT, and said in the settings card too: this is KEDAIPAL'S despatch
 * label, not a courier's official consignment note. A courier AWB is issued by
 * the courier's own booking API (the deferred Delyva/EasyParcel work); this
 * label carries the courier name + consignment number the seller already
 * records through the manual-courier flow (86eyehvk4).
 */

/**
 * A6 (105 × 148 mm) is the thermal-label standard. "a4-4up" prints four A6
 * labels per A4 sheet with cut guides — the DEFAULT, because every seller
 * already owns an A4 printer and a thermal printer is the upgrade, not the
 * entry ticket.
 */
export type AwbPaperSize = "a6" | "a4-4up";

export const AWB_PAPER_SIZES: readonly AwbPaperSize[] = ["a6", "a4-4up"];

/** Stored shape (schema `retailers.awbConfig`). Every field optional — absent
 * means "the default", so adding a toggle never breaks an existing row. */
export type StoredAwbConfig = {
	paperSize?: AwbPaperSize;
	showLogo?: boolean;
	showItems?: boolean;
	showCod?: boolean;
	showWeight?: boolean;
	showNote?: boolean;
	footerText?: string;
};

/** Fully-resolved config — what the renderer and the settings card both read. */
export type AwbConfig = {
	paperSize: AwbPaperSize;
	showLogo: boolean;
	showItems: boolean;
	showCod: boolean;
	showWeight: boolean;
	showNote: boolean;
	footerText?: string;
};

export const AWB_FOOTER_MAX = 120;

/**
 * Defaults, each chosen rather than inherited:
 *  - `paperSize: "a4-4up"` — see AwbPaperSize.
 *  - `showLogo` ON — the seller's brand on their own parcel. Silently skipped
 *    when the store has no logo, or one pdf-lib can't embed (SVG/WebP).
 *  - `showItems` OFF — a packing list on the OUTSIDE of a parcel tells everyone
 *    who handles it what is inside, and it eats a fixed-height label. Sellers
 *    who pack from the label turn it on; the card says both halves of that.
 *  - `showCod` ON — an unpaid parcel that doesn't shout the amount is how a
 *    seller gets short-paid. Rendered cause-true: only on genuinely unpaid
 *    orders (a settled one prints a PAID badge instead), so nobody is ever
 *    asked to pay twice.
 *  - `showWeight` ON — the first thing a counter clerk asks for.
 *  - `showNote` ON — the buyer's order note is where "call before delivery" and
 *    "leave at guardhouse" actually live. (Address notes are addressing
 *    information and always print, inside the address block.)
 */
export const AWB_DEFAULTS: AwbConfig = {
	paperSize: "a4-4up",
	showLogo: true,
	showItems: false,
	showCod: true,
	showWeight: true,
	showNote: true,
};

/** Fill the stored row's gaps with the defaults. */
export function resolveAwbConfig(stored: StoredAwbConfig | undefined): AwbConfig {
	return {
		paperSize: stored?.paperSize ?? AWB_DEFAULTS.paperSize,
		showLogo: stored?.showLogo ?? AWB_DEFAULTS.showLogo,
		showItems: stored?.showItems ?? AWB_DEFAULTS.showItems,
		showCod: stored?.showCod ?? AWB_DEFAULTS.showCod,
		showWeight: stored?.showWeight ?? AWB_DEFAULTS.showWeight,
		showNote: stored?.showNote ?? AWB_DEFAULTS.showNote,
		footerText: stored?.footerText,
	};
}

/**
 * Validate + normalise a config on its way to the database. `null` clears back
 * to the defaults (always allowed — a template choice never traps anyone).
 * Every field that matches its default is dropped, and a row left with nothing
 * to say resolves to `undefined`.
 */
export function sanitizeAwbConfig(
	input: StoredAwbConfig | null,
): StoredAwbConfig | undefined {
	if (input === null) return undefined;
	const resolved = resolveAwbConfig(input);
	if (!AWB_PAPER_SIZES.includes(resolved.paperSize)) {
		throw new Error("Pick a supported label size");
	}
	const footerText = input.footerText?.trim().replace(/\s+/g, " ");
	if (footerText !== undefined && footerText.length > AWB_FOOTER_MAX) {
		throw new Error(
			`Footer text must be ${AWB_FOOTER_MAX} characters or fewer`,
		);
	}

	const out: StoredAwbConfig = {};
	if (resolved.paperSize !== AWB_DEFAULTS.paperSize) {
		out.paperSize = resolved.paperSize;
	}
	if (resolved.showLogo !== AWB_DEFAULTS.showLogo) out.showLogo = resolved.showLogo;
	if (resolved.showItems !== AWB_DEFAULTS.showItems) {
		out.showItems = resolved.showItems;
	}
	if (resolved.showCod !== AWB_DEFAULTS.showCod) out.showCod = resolved.showCod;
	if (resolved.showWeight !== AWB_DEFAULTS.showWeight) {
		out.showWeight = resolved.showWeight;
	}
	if (resolved.showNote !== AWB_DEFAULTS.showNote) out.showNote = resolved.showNote;
	if (footerText) out.footerText = footerText;

	return Object.keys(out).length > 0 ? out : undefined;
}
