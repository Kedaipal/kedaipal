import { Info } from "lucide-react";
import { formatPrice } from "../../lib/format";

// The page's one statement that refundable booking deposits are excluded
// (z8r3fdcw70). Seng (Hidden Gems'ite, Founding #7) had to ASK whether sales
// included the security deposit — a constraint is surfaced, never enforced
// silently — so the answer is on the page, with the amount, whenever there is
// an amount to state.
//
// Why a page-level line and not a sub-label inside the "Revenue earned" tile
// (which is what the ticket specified):
//
//   1. The deposit is netted out of EVERY money figure here — earned, the
//      trend, collected, the payment donut, the by-source rows and therefore
//      Avg order. Saying so inside one tile makes a claim about that tile and
//      silently implies its three neighbours are gross. The exclusion is a
//      property of the page, so it is stated at the page.
//   2. The tile had no room for the reason, only the amount, so the reason had
//      to ride a hover `title` — which does nothing on a phone. This page's own
//      trend chart was built as a scrubber rather than a tooltip for exactly
//      that reason (docs/insights.md); shipping the explanation hover-only here
//      would have repeated the mistake the same file warns about.
//   3. A full-width line has room for the EXACT figure. The tiles compact money
//      above RM 10,000 and pair it with a full-precision hover; the amount here
//      is the only copy of itself, so it is never rounded.
//
// Renders nothing at 0, so a store without booking deposits sees the page it
// has always seen.

export function DepositNote({
	depositsExcluded,
	currency,
}: {
	/** Σ security deposit netted out of every figure in the current range. */
	depositsExcluded: number;
	currency: string;
}) {
	if (depositsExcluded <= 0) return null;
	return (
		<div className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
			<Info className="mt-0.5 size-4 shrink-0" />
			<span>
				<span className="font-semibold text-foreground">
					{formatPrice(depositsExcluded, currency)}
				</span>{" "}
				in security deposits is excluded from every figure on this page — held
				money, not sales. If you keep part of one, that is recorded on the
				order, not here.
			</span>
		</div>
	);
}
