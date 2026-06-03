// Storefront-side variant helpers: option-value availability for pill pickers
// (the two-reason grey-out) and selection→variant resolution. Mirrors the pure
// helpers in convex/lib/variant.ts; kept here so the storefront bundle doesn't
// import server code. See docs/product-variants.md §4/§7.

export type OptionAxis = { name: string; values: string[] };

export type VariantLike = {
	optionValues: string[];
	onHand: number;
	active?: boolean;
};

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
 * Is this variant sellable right now? Made-to-order products (blockOOS=false)
 * are always sellable; hard-block products require on-hand stock. Inactive
 * variants are never sellable. The storefront list already filters to active
 * variants, so `active` is usually true here — checked defensively.
 */
export function isSellable(variant: VariantLike, blockOOS: boolean): boolean {
	if (variant.active === false) return false;
	if (!blockOOS) return true;
	return variant.onHand > 0;
}

/**
 * For each axis, the set of values that — combined with the current selection
 * on the *other* axes — has at least one sellable variant. A value not in its
 * axis's set is greyed out (reason 1: no such combo; reason 2: sold out under
 * hard-block). `selection` is aligned to `options`; null = not yet chosen.
 */
export function availableValuesPerAxis(
	options: readonly OptionAxis[],
	variants: readonly VariantLike[],
	selection: readonly (string | null)[],
	blockOOS: boolean,
): Set<string>[] {
	return options.map((axis, axisIndex) => {
		const available = new Set<string>();
		for (const value of axis.values) {
			// Build a hypothetical selection: this axis pinned to `value`, every
			// other axis kept at its current choice (null = wildcard).
			const matches = variants.some((variant) => {
				if (!isSellable(variant, blockOOS)) return false;
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
		variants.find((variant) =>
			sameOptionValues(variant.optionValues, selection),
		) ?? null
	);
}
