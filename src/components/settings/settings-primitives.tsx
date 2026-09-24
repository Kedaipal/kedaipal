/**
 * The shared shell pieces every Settings tab is built from.
 *
 * `Card` and `SectionHeading` had drifted into byte-identical copies in
 * `app.settings.tsx` and `fulfilment-tab.tsx`; adding a third copy for the
 * per-kind order-flow cards (z8r3fdh3w1) is how a house ends up looking like
 * three houses, so they live here instead. Reach for these rather than
 * re-deriving the card chrome.
 */

import { Info } from "lucide-react";
import type { ReactNode } from "react";
import {
	type FixHighlight,
	highlightRingClass,
} from "../../lib/country-setup-copy";

/**
 * One settings card. `id` is the deep-link anchor and `highlight` the ring a
 * Country-setup "Fix this" jump paints, so a linked card announces itself
 * rather than leaving the seller scanning a long tab (86eyqgujv).
 *
 * `scroll-mt-24` keeps the sticky header off the card once scrolled to.
 */
export function Card({
	children,
	id,
	highlight,
}: {
	children: ReactNode;
	id?: string;
	highlight?: FixHighlight;
}) {
	return (
		<section
			id={id}
			data-fix-highlight={highlight ?? undefined}
			className={`flex flex-col gap-4 rounded-2xl border bg-background p-5 scroll-mt-24 lg:p-6 ${highlightRingClass(highlight)}`}
		>
			{children}
		</section>
	);
}

export function SectionHeading({
	title,
	description,
}: {
	title: string;
	description?: string;
}) {
	return (
		<div className="flex flex-col gap-1">
			<h3 className="text-sm font-semibold text-foreground">{title}</h3>
			{description ? (
				<p className="text-xs text-muted-foreground leading-relaxed">
					{description}
				</p>
			) : null}
		</div>
	);
}

export function InfoBanner({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<div className="flex gap-3 rounded-xl border border-accent/20 bg-accent/5 px-4 py-3.5">
			<Info className="size-4 shrink-0 text-accent mt-0.5" aria-hidden="true" />
			<div className="flex flex-col gap-1.5 text-sm text-muted-foreground leading-relaxed">
				<p className="font-medium text-foreground">{title}</p>
				{children}
			</div>
		</div>
	);
}

/** Full-width save button on mobile, right-aligned and comfortable on desktop.
 * Shared so every tab's primary action lands in the same place. */
export const SAVE_BTN_CLASS =
	"h-11 lg:h-10 lg:w-auto lg:self-end lg:min-w-[160px]";
