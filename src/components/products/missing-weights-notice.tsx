import { Link } from "@tanstack/react-router";
import { Scale, TriangleAlert } from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	WEIGHT_REQUIRED_COPY,
	type WeightPricing,
} from "../../../convex/lib/weightPricing";

/** The shape `products.missingParcelWeights` answers. */
export type MissingWeights = {
	count: number;
	choiceCount: number;
	named: Array<{ productId: Id<"products">; name: string }>;
};

/**
 * The readiness notice: which products a weight-priced checkout can't weigh,
 * and the one tap that fixes them all. ONE control for every place it
 * matters — the weight-zone rate card and the live courier card in Settings,
 * and the Products list — so the seller meets the same sentence wherever
 * they look. The CONSEQUENCE is the only line that differs, and it is keyed
 * by WHY the store prices by weight (`WEIGHT_REQUIRED_COPY`), never written
 * by the caller: a rate card strands the order, a courier quotes the floor.
 *
 * Renders nothing while the count is unknown or zero, so a call site is one
 * line with no conditional of its own.
 */
export function MissingWeightsNotice({
	missingWeights,
	reason,
}: {
	missingWeights: MissingWeights | undefined;
	reason: WeightPricing;
}) {
	if (!missingWeights || missingWeights.count === 0) return null;
	const { count, choiceCount, named } = missingWeights;
	return (
		<div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-100 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
			<p className="flex items-start gap-2 font-semibold">
				<TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
				<span>
					{count} product{count === 1 ? " has" : "s have"} no parcel weight —{" "}
					{WEIGHT_REQUIRED_COPY[reason].consequence}
				</span>
			</p>
			<ul className="flex flex-wrap gap-x-3 gap-y-1 pl-5.5">
				{named.map((p) => (
					<li key={p.productId}>
						<Link
							to="/app/products/$productId"
							params={{ productId: p.productId }}
							className="font-medium underline underline-offset-2"
						>
							{p.name}
						</Link>
					</li>
				))}
				{count > named.length ? (
					<li className="text-amber-800/80 dark:text-amber-300/80">
						+{count - named.length} more
					</li>
				) : null}
			</ul>
			{/* The fix, as the primary affordance: one page lists every unweighed
			    choice with a fill-all box, so a 40-product catalogue is weighed
			    in minutes rather than product by product. */}
			<Link
				to="/app/products/weights"
				className="inline-flex min-h-11 w-fit items-center gap-1.5 font-semibold underline underline-offset-2 hover:text-amber-950 dark:hover:text-amber-100"
			>
				<Scale aria-hidden className="size-3.5" />
				Set parcel weights
				<span className="font-normal opacity-80">
					· {choiceCount} choice{choiceCount === 1 ? "" : "s"}
				</span>
			</Link>
		</div>
	);
}
