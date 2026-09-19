import { StickyNote } from "lucide-react";
import type { Locale } from "../../../convex/lib/locale";
import { PICKUP_NOTES_HEADING } from "../../../convex/lib/pickupNote";
import { cn } from "../../lib/utils";

/**
 * The seller's collection instructions for an order (ClickUp `z8r3fdff97`) —
 * "side counter", "bring an ice bag, these melt in 20 min" — rendered the same
 * way wherever they appear: the buyer's /track page, the seller's order page
 * and checkout. One component, so the heading, the dedupe (done upstream by
 * `orderPickupNotes`) and the look can't drift between surfaces.
 *
 * Takes already-distinct notes. Renders NOTHING for an empty list, so callers
 * don't need a guard.
 *
 * Deliberately NOT line-clamped: these are the surfaces people come to read,
 * each note is capped at 200 characters at save, and a clamp would hide the
 * very instruction the buyer needs at the door. (The storefront product card,
 * where the note competes with the purchase controls, does clamp.)
 */
export function PickupNotes({
	notes,
	audience,
	locale = "en",
	className,
}: {
	notes: readonly string[];
	/** The buyer is told what to do; the seller is told what the buyer saw. */
	audience: "buyer" | "seller";
	locale?: Locale;
	className?: string;
}) {
	if (notes.length === 0) return null;
	return (
		<div
			className={cn(
				"flex gap-2.5 rounded-xl bg-accent/10 px-3 py-2.5",
				className,
			)}
		>
			<StickyNote
				className="mt-0.5 size-4 shrink-0 text-accent-emphasis"
				aria-hidden="true"
			/>
			<div className="min-w-0 flex-1">
				<p className="text-xs font-semibold text-accent-emphasis">
					{audience === "buyer"
						? PICKUP_NOTES_HEADING[locale]
						: "Before they collect"}
				</p>
				{audience === "seller" ? (
					// The seller edits the product, not the order — say which one
					// this is, so an edit that isn't reflected here isn't a mystery.
					<p className="text-xs text-muted-foreground">
						From your product&apos;s pickup note, as it read when this order was
						placed.
					</p>
				) : null}
				{notes.length === 1 ? (
					<p className="mt-1 text-sm text-foreground wrap-break-word">
						{notes[0]}
					</p>
				) : (
					<ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-foreground">
						{notes.map((note) => (
							<li key={note} className="wrap-break-word">
								{note}
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
