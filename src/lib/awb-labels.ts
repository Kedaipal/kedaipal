/**
 * Client-side copy for despatch labels (86eyp63mp).
 *
 * The DATA lives server-side in `convex/lib/pdf/awb.ts` (skip reasons, sort
 * keys); the words a seller reads live here, so both surfaces that report a
 * batch — the print dialog and the ready-to-ship toast — say the same thing.
 */

import type {
	AwbSkipCounts,
	AwbSkipReason,
	AwbSort,
} from "../../convex/lib/pdf/awb";

/** Why an order couldn't be labelled, in the seller's words. Each names the
 * cause, not the mechanism — "can't be labelled" is not an explanation. */
const SKIP_COPY: Record<AwbSkipReason, (n: number) => string> = {
	no_address: (n) => `${n} for pickup (no delivery address)`,
	cancelled: (n) => `${n} cancelled`,
	not_found: (n) => `${n} no longer in your orders`,
};

/** Reading order: commonest and most self-explanatory first, the "something
 * odd happened" case last. Explicit rather than relying on object key order. */
const SKIP_ORDER: readonly AwbSkipReason[] = [
	"no_address",
	"cancelled",
	"not_found",
];

/** One line naming every skipped order and why, or `null` when none were.
 * Never a bare "skipped 3" — the repo's no-silent-caps rule. */
export function describeAwbSkips(skipped: AwbSkipCounts): string | null {
	const parts = SKIP_ORDER.filter((reason) => skipped[reason] > 0).map(
		(reason) => SKIP_COPY[reason](skipped[reason]),
	);
	if (parts.length === 0) return null;
	return `Skipped ${parts.join(", ")}.`;
}

export function totalSkipped(skipped: AwbSkipCounts): number {
	return Object.values(skipped).reduce((sum, n) => sum + n, 0);
}

/** Batch sort options, in the order the dialog offers them. Fulfilment date
 * leads because it matches the inbox's own default — the printed stack comes
 * out in the same order as the list the seller just ticked. */
export const AWB_SORT_OPTIONS: ReadonlyArray<{
	value: AwbSort;
	label: string;
	hint: string;
}> = [
	{
		value: "fulfilment",
		label: "Delivery date",
		hint: "Soonest first, like your Orders list",
	},
	{ value: "status", label: "Order status", hint: "New orders through to sent" },
	{
		value: "courier",
		label: "Courier",
		hint: "Groups each courier's parcels together",
	},
	{
		value: "area",
		label: "Delivery area",
		hint: "State, then town and postcode",
	},
];
