// Storefront-side variant helpers: option-value availability for pill pickers
// (the two-reason grey-out) and selection→variant resolution. Mirrors the pure
// helpers in convex/lib/variant.ts; kept here so the storefront bundle doesn't
// import server code. See docs/product-variants.md §4/§7.

export type OptionAxis = { name: string; values: string[] };

export type VariantLike = {
	optionValues: string[];
	onHand: number;
	active?: boolean;
	// Resolved per-variant on the server (`variant.blockWhenOutOfStock ??
	// product.blockWhenOutOfStock`). A mixed product can have made-to-order
	// variants (false) alongside hard-block ones (true).
	blockWhenOutOfStock?: boolean;
	// The custom / made-to-order line lives OUTSIDE the option-axis grid, so it's
	// excluded from pill availability + selection resolution. See getCustomLine +
	// docs/custom-option.md.
	isCustom?: boolean;
};

/**
 * The product's single custom / made-to-order line, if it offers one. Selected
 * via its own storefront CTA — never through the axis pills.
 */
export function getCustomLine<T extends VariantLike>(
	variants: readonly T[],
): T | null {
	return variants.find((v) => v.isCustom) ?? null;
}

/** ["1kg","Fillet"] → "1kg / Fillet"; "" for the implicit default variant. */
export function variantLabel(optionValues: readonly string[]): string {
	return optionValues.join(" / ");
}

/**
 * Cartesian product of the axes' values, row-major + axis-aligned. Zero axes →
 * `[[]]` (one implicit default variant). Mirrors convex/lib/variant.ts; used by
 * the dashboard variant-grid editor to generate one row per combination.
 */
export function cartesian(options: readonly OptionAxis[]): string[][] {
	return options.reduce<string[][]>(
		(acc, axis) =>
			acc.flatMap((combo) => axis.values.map((value) => [...combo, value])),
		[[]],
	);
}

/** Positional equality of two option-value tuples. */
export function sameOptionValues(
	a: readonly string[],
	b: readonly (string | null)[],
): boolean {
	if (a.length !== b.length) return false;
	return a.every((val, i) => val === b[i]);
}

/**
 * Is this variant sellable right now? Made-to-order variants
 * (`blockWhenOutOfStock` falsy) are always sellable; hard-block variants require
 * on-hand stock. Inactive variants are never sellable. The storefront list
 * already filters to active variants, so `active` is usually true here — checked
 * defensively. The flag is resolved per-variant on the server.
 */
export function isSellable(variant: VariantLike): boolean {
	if (variant.active === false) return false;
	if (!variant.blockWhenOutOfStock) return true;
	return variant.onHand > 0;
}

/**
 * Can the standard (non-custom) variants still reach the product's minimum
 * order quantity (86ey9unyx)? Unreachable only when a minimum is set, the
 * product has standard variants, every active one hard-blocks on stock, and
 * their combined on-hand sits below the minimum — without this check the buyer
 * is told "Min 20", the stepper caps at stock, and checkout demands units that
 * can't be bought (a dead-end). Any made-to-order standard variant makes the
 * minimum always reachable (unbounded qty). The custom line never rescues it:
 * custom lines are excluded from minimum sums (see convex/lib/minOrderRules.ts)
 * — but it also isn't blocked by this state (its own CTA stays live).
 */
export function minQuantityUnreachable(
	minQuantity: number | undefined,
	variants: readonly VariantLike[],
): boolean {
	if (!minQuantity || minQuantity <= 1) return false;
	const standard = variants.filter((v) => !v.isCustom && v.active !== false);
	if (standard.length === 0) return false;
	if (standard.some((v) => !v.blockWhenOutOfStock)) return false;
	const purchasable = standard.reduce(
		(sum, v) => sum + Math.max(0, v.onHand),
		0,
	);
	return purchasable < minQuantity;
}

/**
 * For each axis, the set of values that — combined with the current selection
 * on the *other* axes — has at least one sellable variant. A value not in its
 * axis's set is greyed out (reason 1: no such combo; reason 2: sold out under
 * hard-block). `selection` is aligned to `options`; null = not yet chosen.
 * Sellability is judged per-variant (each variant carries its resolved
 * `blockWhenOutOfStock`).
 */
export function availableValuesPerAxis(
	options: readonly OptionAxis[],
	variants: readonly VariantLike[],
	selection: readonly (string | null)[],
): Set<string>[] {
	return options.map((axis, axisIndex) => {
		const available = new Set<string>();
		for (const value of axis.values) {
			// Build a hypothetical selection: this axis pinned to `value`, every
			// other axis kept at its current choice (null = wildcard).
			const matches = variants.some((variant) => {
				if (variant.isCustom) return false; // not an axis-addressable variant
				if (!isSellable(variant)) return false;
				return options.every((_, i) => {
					if (i === axisIndex) return variant.optionValues[i] === value;
					const chosen = selection[i];
					return chosen === null || variant.optionValues[i] === chosen;
				});
			});
			if (matches) available.add(value);
		}
		return available;
	});
}

/**
 * Resolve a fully-specified selection (no nulls) to its exact variant, or null
 * if the selection is incomplete or names no variant.
 */
export function resolveVariant<T extends VariantLike>(
	variants: readonly T[],
	selection: readonly (string | null)[],
): T | null {
	if (selection.some((s) => s === null)) return null;
	return (
		variants.find(
			// Skip the custom line — for a no-axes product it ALSO has optionValues
			// [], so it would otherwise shadow the real default variant.
			(variant) =>
				!variant.isCustom && sameOptionValues(variant.optionValues, selection),
		) ?? null
	);
}
