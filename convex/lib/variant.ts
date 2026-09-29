// Pure helpers for product option axes + variant combinations. No Convex
// imports — keep testable in isolation and mirrorable to src/lib/variant.ts
// for the storefront picker. See docs/product-variants.md.

export type OptionAxis = {
	name: string;
	values: string[];
};

// Scope guard (docs §1/§7): 1–2 axes covers ~all of F&B + metal prints; more
// axes explode the grid in UI and seller effort.
export const MAX_OPTION_AXES = 2;
export const MAX_VALUES_PER_AXIS = 25;
// THE cap on the cartesian blowup, and the only copy of it — the client-side
// editor, wizard and CSV import all import this constant rather than mirroring
// the number (they used to, and the mirrors drifted). Raised 50 → 100 on
// 2026-09-29 (z8r3fdjgvd): a two-axis "Adult 1 size × Adult 2 size" event
// listing needs 7 × 8 = 56, and one shared seat pool means it cannot be split
// across two products. Still well under the axis product (25 × 25 = 625), so
// the cap — not MAX_VALUES_PER_AXIS — is what refuses a runaway grid.
export const MAX_VARIANTS_PER_PRODUCT = 100;
export const MAX_AXIS_NAME_LENGTH = 40;
export const MAX_VALUE_LENGTH = 60;
// Custom / made-to-order line (docs/custom-option.md). One per product, lives
// outside the cartesian, so it doesn't count toward MAX_VARIANTS_PER_PRODUCT.
export const MAX_CUSTOM_LABEL_LENGTH = 40;
export const MAX_CUSTOM_PROMPT_LENGTH = 280;
export const DEFAULT_CUSTOM_LABEL = "Custom";

/**
 * Human label for a variant from its positional option values:
 * ["1kg", "Fillet"] → "1kg / Fillet". Empty (the implicit default variant) → "".
 */
export function variantLabel(optionValues: readonly string[]): string {
	return optionValues.join(" / ");
}

/** Positional equality of two option-value tuples. */
export function sameOptionValues(
	a: readonly string[],
	b: readonly string[],
): boolean {
	if (a.length !== b.length) return false;
	return a.every((val, i) => val === b[i]);
}

/**
 * Cartesian product of the axes' values, in row-major order aligned with the
 * axis order. Zero axes → `[[]]` (one implicit default variant), which is the
 * load-bearing invariant: every product resolves to ≥1 variant.
 */
export function cartesian(options: readonly OptionAxis[]): string[][] {
	return options.reduce<string[][]>(
		(acc, axis) =>
			acc.flatMap((combo) => axis.values.map((value) => [...combo, value])),
		[[]],
	);
}

export type OptionValidationError = string;

/**
 * Trim/normalize option axes and enforce the caps + structural rules. Returns
 * the cleaned axes. Throws a plain Error with a human message on violation —
 * callers (Convex mutations) re-wrap as ConvexError. Pure so it's unit-testable
 * and reusable client-side for inline validation.
 */
export function normalizeOptions(
	rawOptions: readonly OptionAxis[] | undefined,
): OptionAxis[] {
	if (!rawOptions || rawOptions.length === 0) return [];
	if (rawOptions.length > MAX_OPTION_AXES)
		throw new Error(`At most ${MAX_OPTION_AXES} option axes per product`);

	const seenAxisNames = new Set<string>();
	const normalized = rawOptions.map((axis) => {
		const name = axis.name.trim();
		if (name.length === 0) throw new Error("Option axis name is required");
		if (name.length > MAX_AXIS_NAME_LENGTH)
			throw new Error(
				`Option name must be at most ${MAX_AXIS_NAME_LENGTH} characters`,
			);
		const nameKey = name.toLowerCase();
		if (seenAxisNames.has(nameKey))
			throw new Error(`Duplicate option axis "${name}"`);
		seenAxisNames.add(nameKey);

		const values = axis.values.map((val) => val.trim()).filter((v) => v.length > 0);
		if (values.length === 0)
			throw new Error(`Option "${name}" needs at least one value`);
		if (values.length > MAX_VALUES_PER_AXIS)
			throw new Error(
				`Option "${name}" has too many values (max ${MAX_VALUES_PER_AXIS})`,
			);
		const seenValues = new Set<string>();
		for (const val of values) {
			if (val.length > MAX_VALUE_LENGTH)
				throw new Error(
					`Value "${val}" must be at most ${MAX_VALUE_LENGTH} characters`,
				);
			const valKey = val.toLowerCase();
			if (seenValues.has(valKey))
				throw new Error(`Duplicate value "${val}" in option "${name}"`);
			seenValues.add(valKey);
		}
		return { name, values };
	});

	const total = cartesian(normalized).length;
	if (total > MAX_VARIANTS_PER_PRODUCT)
		throw new Error(
			`That makes ${total} variants — max ${MAX_VARIANTS_PER_PRODUCT} per product`,
		);

	return normalized;
}

/**
 * Verify a variant's optionValues tuple is a valid member of the product's
 * option axes (right length, each value belongs to its axis). Returns true iff
 * the tuple names a real combination.
 */
export function isValidCombination(
	options: readonly OptionAxis[],
	optionValues: readonly string[],
): boolean {
	if (optionValues.length !== options.length) return false;
	return options.every((axis, i) => axis.values.includes(optionValues[i]));
}
