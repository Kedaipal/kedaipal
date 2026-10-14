// The bulk promotion flow (`z8r3fducfd`) — pick products → set the discount →
// review every line → save. Pure on purpose: the picker's grouping, the
// review's per-line prices and the payload the server receives are all
// decided here, so the screens only render them and the tests pin them.
//
// Every price comes from `promoPriceFromPercent` — the same rounding the
// single-product quick fill uses — so a promotion and a product form can
// never compute two different "20% off" prices for the same line.

import { promoPriceFromPercent } from "../../convex/lib/promo";
import {
	MAX_PROMOTION_PRICES,
	type PromotionPhase,
} from "../../convex/lib/promotions";
import { formatPrice, parsePriceInput } from "./format";

export type FlowVariant = {
	_id: string;
	label: string;
	/** List price, sen. 0 = priced by quote. */
	price: number;
	/** The sale price the line carries NOW, sen (seeds an edit). */
	promoPrice?: number;
};

export type FlowProduct = {
	_id: string;
	name: string;
	isBooking: boolean;
	isEvent: boolean;
	variants: FlowVariant[];
};

/** What one line of the review shows. */
export type ReviewLine =
	| {
			kind: "sale";
			variant: FlowVariant;
			/** The price as the seller sees it in the field (major units). */
			input: string;
			/** Did the seller type over the computed price? */
			edited: boolean;
			/** Parsed sen when the input is a valid sale price, else null. */
			sen: number | null;
			issue?: string;
	  }
	| { kind: "skip"; variant: FlowVariant; reason: string };

/** Why a line can't go on sale at all, or null when it can. */
export function lineSkipReason(
	variant: FlowVariant,
	percentOff: number,
): string | null {
	if (variant.price <= 0) return "Not on sale · priced by quote";
	if (promoPriceFromPercent(variant.price, percentOff) === null)
		return "Not on sale · too small to discount";
	return null;
}

const toMajor = (sen: number) => (sen / 100).toFixed(2);

/**
 * Every line of one product at this percent, with the seller's typed
 * overrides (keyed by variant id) laid over the computed price. An override
 * of "" takes that line off sale on purpose.
 */
export function reviewLinesFor(
	product: FlowProduct,
	percentOff: number,
	overrides: Readonly<Record<string, string>>,
): ReviewLine[] {
	return product.variants.map((variant) => {
		const skip = lineSkipReason(variant, percentOff);
		if (skip !== null) return { kind: "skip", variant, reason: skip };
		const computed = promoPriceFromPercent(variant.price, percentOff) as number;
		const typed = overrides[variant._id];
		const input = typed ?? toMajor(computed);
		const edited = typed !== undefined && typed !== toMajor(computed);
		if (input.trim() === "")
			return { kind: "sale", variant, input, edited: true, sen: null };
		const major = parsePriceInput(input);
		const sen = major === null ? null : Math.round(major * 100);
		const issue =
			sen === null || sen <= 0
				? "Numbers only — e.g. 31.50."
				: sen >= variant.price
					? "Must be below the normal price."
					: undefined;
		return {
			kind: "sale",
			variant,
			input,
			edited,
			sen: issue ? null : sen,
			issue,
		};
	});
}

/** Overrides that reproduce what a product carries now — an edit starts
 * from the prices the storefront is showing, not from a recomputation. */
export function overridesFromCurrent(
	products: readonly FlowProduct[],
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const product of products)
		for (const variant of product.variants)
			out[variant._id] =
				variant.promoPrice !== undefined && variant.promoPrice < variant.price
					? toMajor(variant.promoPrice)
					: "";
	return out;
}

export type MemberPayload = {
	productId: string;
	prices: Array<{ variantId: string; promoPrice: number }>;
};

export type ReviewSummary = {
	members: MemberPayload[];
	onSale: number;
	total: number;
	/** Lines left blank on purpose (at normal price). */
	blank: number;
	/** Lines that can't be saved as typed. */
	invalid: number;
	/** Products where nothing ended up on sale. */
	emptyProducts: string[];
};

/** The whole review in one pass — what the footer counts and what Save sends. */
export function summariseReview(
	products: readonly FlowProduct[],
	percentOff: number,
	overrides: Readonly<Record<string, string>>,
): ReviewSummary {
	const members: MemberPayload[] = [];
	let onSale = 0;
	let total = 0;
	let blank = 0;
	let invalid = 0;
	const emptyProducts: string[] = [];
	for (const product of products) {
		const prices: MemberPayload["prices"] = [];
		for (const line of reviewLinesFor(product, percentOff, overrides)) {
			total++;
			if (line.kind === "skip") continue;
			if (line.issue) {
				invalid++;
				continue;
			}
			if (line.sen === null) {
				blank++;
				continue;
			}
			prices.push({ variantId: line.variant._id, promoPrice: line.sen });
			onSale++;
		}
		if (prices.length === 0) emptyProducts.push(product.name);
		members.push({ productId: product._id, prices });
	}
	return { members, onSale, total, blank, invalid, emptyProducts };
}

/** Why Save is off, or null. Disabled-with-reason, never a silent no-op. */
export function reviewBlockedReason(summary: ReviewSummary): string | null {
	if (summary.invalid > 0)
		return summary.invalid === 1
			? "1 price can't be saved as typed — fix it above."
			: `${summary.invalid} prices can't be saved as typed — fix them above.`;
	if (summary.onSale === 0)
		return "Nothing is on sale yet — set at least one price.";
	if (summary.onSale > MAX_PROMOTION_PRICES)
		return `That's ${summary.onSale.toLocaleString("en-MY")} sale prices — one promotion holds up to ${MAX_PROMOTION_PRICES.toLocaleString("en-MY")}. Split it into two.`;
	return null;
}

// --- Picker -------------------------------------------------------------------

export type PickerSection = { key: string; name: string; productIds: string[] };

/**
 * The picker's groups: each category in the seller's order, then "Other
 * products" for anything uncategorised. A product in two categories appears
 * in both — selection is by product, so ticking it in one ticks it in the
 * other and both group headers stay true.
 */
export function pickerSections(
	products: ReadonlyArray<{ _id: string; categoryIds: readonly string[] }>,
	categories: ReadonlyArray<{ _id: string; name: string }>,
): PickerSection[] {
	const sections: PickerSection[] = categories
		.map((c) => ({
			key: c._id,
			name: c.name,
			productIds: products
				.filter((p) => p.categoryIds.includes(c._id))
				.map((p) => p._id),
		}))
		.filter((s) => s.productIds.length > 0);
	const known = new Set(categories.map((c) => c._id));
	const loose = products
		.filter((p) => !p.categoryIds.some((id) => known.has(id)))
		.map((p) => p._id);
	if (loose.length > 0)
		sections.push({
			key: "uncategorised",
			name: sections.length > 0 ? "Other products" : "All products",
			productIds: loose,
		});
	return sections;
}

/** Case-insensitive match on name or item code. */
export function matchesSearch(
	product: { name: string; sku?: string },
	query: string,
): boolean {
	const q = query.trim().toLowerCase();
	if (q === "") return true;
	return (
		product.name.toLowerCase().includes(q) ||
		(product.sku?.toLowerCase().includes(q) ?? false)
	);
}

// --- Display ----------------------------------------------------------------

/** The phase's badge wording. */
export const PHASE_LABEL: Record<PromotionPhase, string> = {
	applying: "Applying…",
	scheduled: "Scheduled",
	live: "Live",
	ending: "Ending…",
	ended: "Ended",
};

const when = (ms: number) =>
	new Date(ms).toLocaleString("en-MY", {
		weekday: "short",
		day: "numeric",
		month: "short",
		hour: "numeric",
		minute: "2-digit",
	});

/** "1h 42m" / "3d 4h" / "12m" — the house countdown grain. */
export function timeLeft(ms: number): string {
	const mins = Math.max(0, Math.round(ms / 60_000));
	const d = Math.floor(mins / 1440);
	const h = Math.floor((mins % 1440) / 60);
	const m = mins % 60;
	if (d > 0) return `${d}d ${h}h`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

/** The one line under a promotion's name that says when it runs. */
export function windowLine(
	promotion: { startsAt?: number; endsAt?: number; endedAt?: number },
	phase: PromotionPhase,
	now: number,
	/** Off where a countdown already says it (the detail page's hero). */
	opts: { timeLeft?: boolean } = {},
): string {
	if (promotion.endedAt !== undefined)
		return `Ended ${when(promotion.endedAt)}`;
	if (phase === "ended" && promotion.endsAt !== undefined)
		return `Ended ${when(promotion.endsAt)}`;
	if (phase === "scheduled" && promotion.startsAt !== undefined)
		return promotion.endsAt !== undefined
			? `Starts ${when(promotion.startsAt)} · ends ${when(promotion.endsAt)}`
			: `Starts ${when(promotion.startsAt)} · no end date`;
	if (promotion.endsAt === undefined)
		return "Running · no end date, until you end it";
	return opts.timeLeft === false
		? `Ends ${when(promotion.endsAt)}`
		: `Ends ${when(promotion.endsAt)} · ${timeLeft(promotion.endsAt - now)} left`;
}

/** "from RM 14.40" — the lowest sale price a product's lines carry now. */
export function lowestSale(
	variants: readonly FlowVariant[],
	currency: string,
): { sale: string; list: string } | null {
	const onSale = variants.filter(
		(v) => v.promoPrice !== undefined && v.promoPrice < v.price && v.price > 0,
	);
	if (onSale.length === 0) return null;
	const best = onSale.reduce((a, b) =>
		(a.promoPrice as number) <= (b.promoPrice as number) ? a : b,
	);
	return {
		sale: formatPrice(best.promoPrice as number, currency),
		list: formatPrice(best.price, currency),
	};
}

/** "2 of 3 lines on sale" — counted, never guessed at. A blank line may be a
 * choice the seller left at full price on purpose or one added after the
 * promotion started; the row states the count and the product page shows
 * which, rather than claiming a reason it can't know. */
export function saleLineCount(variants: readonly FlowVariant[]): {
	onSale: number;
	priced: number;
} {
	const priced = variants.filter((v) => v.price > 0);
	return {
		onSale: priced.filter(
			(v) => v.promoPrice !== undefined && v.promoPrice < v.price,
		).length,
		priced: priced.length,
	};
}
