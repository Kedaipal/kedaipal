import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import type {
	InsightsRangeSearch,
	OrdersDrillSearch,
} from "../../lib/home-view";
import { cn } from "../../lib/utils";

/**
 * The shell every Home insight card wears (z8r3fdrgzj).
 *
 * Its shape is the redesign's whole argument: an eyebrow saying WHICH window,
 * then the CONCLUSION as a sentence, then the evidence. A seller should be able
 * to read the headline and stop — the bars underneath are there to be trusted,
 * not decoded. One shell for all three cards so they can never drift into three
 * slightly different ideas of what a card is.
 */
export function InsightCard({
	icon: Icon,
	eyebrow,
	headline,
	children,
	footerLabel,
	footerTo,
	footerSearch,
	className,
}: {
	icon: LucideIcon;
	/** "Best sellers · last 7 days" — the subject and the window, always both. */
	eyebrow: string;
	/** The point of the card, in a sentence. */
	headline: string;
	children?: ReactNode;
	/** The drill-in. Omitted when there is nothing more to see. */
	footerLabel?: string;
	footerTo?: string;
	footerSearch?: OrdersDrillSearch | InsightsRangeSearch;
	className?: string;
}) {
	return (
		<section
			className={cn(
				"flex flex-col gap-3 rounded-2xl border border-border bg-card p-4",
				className,
			)}
		>
			<p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
				<Icon className="size-3.5 shrink-0" aria-hidden="true" />
				{eyebrow}
			</p>
			<h3 className="font-heading text-[17px] font-extrabold leading-snug tracking-tight">
				{headline}
			</h3>
			{children}
			{footerLabel && footerTo ? (
				<Link
					to={footerTo}
					search={footerSearch}
					className="-mx-1 -mb-1 mt-auto flex min-h-11 items-center justify-between gap-2 rounded-xl px-1 text-sm font-semibold text-accent-emphasis hover:underline"
				>
					{footerLabel}
					<ChevronRight className="size-4 shrink-0" aria-hidden="true" />
				</Link>
			) : null}
		</section>
	);
}

/**
 * The dashed stand-in shown instead of the three cards below the order
 * threshold. Dashed on purpose: it reads as a placeholder for something that is
 * coming, where a solid card would read as a finished thing that is empty.
 */
export function InsightThreshold({ line }: { line: string }) {
	return (
		<p className="rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
			{line}
		</p>
	);
}
