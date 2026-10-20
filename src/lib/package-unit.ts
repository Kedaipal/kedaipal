// One narrower for the package-unit `<select>`s, so the wizard and the edit
// form can't drift on which values exist.
//
// The dropdowns used to inline `e.target.value === "day" ? "day" : "month"` —
// a ternary that silently collapses any third option back to "month". Adding
// "night" to one dropdown and not the other, or adding it to the markup but
// not the handler, would have looked correct and quietly discarded the choice.

import type { PackageUnit } from "../../convex/lib/productKind";

const UNITS: readonly PackageUnit[] = ["day", "night", "month"];

/** Narrow an untrusted `<select>` value to a `PackageUnit`, defaulting to the
 * gym/membership shape that drives the feature. */
export function asPackageUnit(value: string): PackageUnit {
	return (UNITS as readonly string[]).includes(value)
		? (value as PackageUnit)
		: "month";
}
