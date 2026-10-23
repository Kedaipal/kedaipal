import { Link } from "@tanstack/react-router";
import { Scale } from "lucide-react";
import type { Doc } from "../../../convex/_generated/dataModel";
import { formatFloorKg } from "../../../convex/lib/weightPricing";

type Snapshot = NonNullable<Doc<"orders">["deliverySnapshot"]>;

/**
 * Did the courier price this order at the one-kilo floor rather than its
 * real weight? True only for a Delyva-won live quote that was floored — a
 * rider's price never used the weight, so a floored cart under a rider fee
 * is not something the seller lost money on.
 */
export function pricedAtFloor(
	snapshot: Snapshot | undefined,
): snapshot is Snapshot & { weightFloored: true } {
	return (
		snapshot?.mode === "live" &&
		snapshot.quoteProvider === "delyva" &&
		snapshot.weightFloored === true
	);
}

/** The sentence, one author for the order page and the dispatch card. */
export function floorPricedLine(snapshot: Snapshot): string {
	const n = snapshot.unweighedLines ?? 0;
	// "then": the weight may well be set by the time the seller reads this
	// (the dispatch box beside it prefills from today's product weights), and
	// the note is about the moment the buyer was priced.
	const items =
		n === 0
			? "a custom item has no fixed weight"
			: `${n} item${n === 1 ? " had" : "s had"} no weight then`;
	return `Priced at the ${formatFloorKg()} floor at checkout — ${items}. A heavier parcel costs you the difference when you book.`;
}

/**
 * The seller's order-page note under a floor-priced delivery fee (23 Oct
 * 2026): the fee showed "RM 4.75" with nothing saying the floor priced it
 * and only the dispatch card's blank weight field hinting (the `/test-code`
 * pass on PR #415). Buyers never see this — the buyer paid the floor and
 * owes nothing more. Links the fix only when there is one to set.
 */
export function FloorPricedNote({ snapshot }: { snapshot: Snapshot }) {
	const n = snapshot.unweighedLines ?? 0;
	return (
		<p className="flex items-start gap-2 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
			<Scale aria-hidden className="mt-0.5 size-3.5 shrink-0" />
			<span>
				{floorPricedLine(snapshot)}
				{n > 0 ? (
					<>
						{" "}
						<Link
							to="/app/products/weights"
							className="font-semibold underline underline-offset-2"
						>
							Set parcel weights
						</Link>
					</>
				) : null}
			</span>
		</p>
	);
}
