import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
	type FixHighlight,
	highlightRingClass,
} from "../../lib/country-setup-copy";
import { cn } from "../../lib/utils";

/**
 * A setting asked as a QUESTION, collapsed to one line that carries its
 * current ANSWER (z8r3fdv1z2).
 *
 * Built for the product edit form, where every optional capability (a sale,
 * an event, custom orders, buyer questions…) used to be its own full card. A
 * seller who never read a release note could scroll past "Promotion" without
 * learning the product could be on sale. As a row, the capability reads as a
 * question ("Is it on sale right now?") and its answer ("No" / "Yes · 20%
 * off · ends Fri 6:00 PM") says whether it is on without opening anything.
 * The answer is what keeps this from being an FAQ accordion: it is STATE.
 *
 * Rules the row owns:
 * - **Collapsed by default, every visit.** `defaultOpen` exists for a deep
 *   link (`?spot=`), not for "this one is on" — the answer already says so,
 *   and a page that changes shape per product is harder to learn.
 * - **The panel stays mounted** while closed (`hidden`), so a half-typed
 *   draft inside survives a collapse and the "take me to the error" helper
 *   can still find an invalid field in it.
 * - **A closed panel opens itself on {@link REVEAL_EVENT}.**
 *   `focusFirstInvalidField` dispatches it when the first error sits inside a
 *   collapsed row, so a refused save never points at something hidden.
 * - **The switch lives in the panel, never on the header.** One tap on a
 *   header must not end a live sale the seller can't see the terms of.
 */

/** Dispatched on a collapsed panel to open it (see focus-error.ts). */
export const REVEAL_EVENT = "kp:reveal";
/** Marks a row's panel, so helpers can find the disclosure an element is in. */
export const DISCLOSURE_PANEL_ATTR = "data-disclosure-panel";

export type QuestionTone = "off" | "set" | "warn" | "error";

export function QuestionGroup({
	title,
	description,
	children,
}: {
	/** Short uppercase kicker — "Selling options", "At checkout". */
	title: string;
	/** One line under the kicker, only where the group needs saying. */
	description?: string;
	children: ReactNode;
}) {
	const headingId = useId();
	return (
		<section aria-labelledby={headingId} className="flex flex-col gap-2">
			<div className="px-1">
				<h3
					id={headingId}
					className="font-sans text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
				>
					{title}
				</h3>
				{description ? (
					<p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
				) : null}
			</div>
			{/* No overflow-hidden: a spotlit row's ring pulses OUTWARD and must not
			    be clipped by its own list. Corners are rounded per row instead. */}
			<ul className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card shadow-sm">
				{children}
			</ul>
		</section>
	);
}

export function QuestionRow({
	id,
	icon,
	question,
	answer,
	tone = "off",
	badge,
	defaultOpen = false,
	highlight,
	children,
}: {
	/** Anchor for a `?spot=` deep link (`SPOTLIGHT_ANCHOR.<key>.anchor`). */
	id?: string;
	icon: ReactNode;
	/** The capability, asked the way a seller would ask it. */
	question: string;
	/** What it is set to right now, in plain words (src/components/forms/product-answers.ts). */
	answer: string;
	tone?: QuestionTone;
	/** A short pill on the header — e.g. the app's Pro badge for a plan
	 * feature this store can't turn on, so the seller learns it without
	 * opening the row. A slot, so this `ui/` primitive depends on no app
	 * component. */
	badge?: ReactNode;
	defaultOpen?: boolean;
	highlight?: FixHighlight;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);
	const panelId = useId();
	const panelRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const panel = panelRef.current;
		if (!panel) return;
		const reveal = () => setOpen(true);
		panel.addEventListener(REVEAL_EVENT, reveal);
		return () => panel.removeEventListener(REVEAL_EVENT, reveal);
	}, []);

	return (
		<li
			id={id}
			className={cn(
				// overflow-hidden rounds the hover fill to the list's corners; a
				// box-shadow ring on this same element is never clipped by it.
				"scroll-mt-24 overflow-hidden first:rounded-t-2xl last:rounded-b-2xl",
				highlight && cn("relative z-[1]", highlightRingClass(highlight)),
				tone === "error" && "shadow-[inset_3px_0_0_var(--destructive)]",
			)}
		>
			<button
				type="button"
				aria-expanded={open}
				aria-controls={panelId}
				onClick={() => setOpen((v) => !v)}
				className={cn(
					"flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50",
				)}
			>
				<span
					aria-hidden="true"
					className={cn(
						"flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-[18px]",
						tone === "warn"
							? "bg-amber-500/12 text-amber-700 dark:text-amber-400"
							: tone === "error"
								? "bg-destructive/10 text-destructive"
								: tone === "set"
									? "bg-accent/12 text-accent-emphasis"
									: "bg-muted text-accent-emphasis",
					)}
				>
					{icon}
				</span>
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="text-sm font-semibold leading-snug">{question}</span>
					{/* Two lines, not one: an answer's warning ("prep has no effect
					    while notice is on") comes LAST, exactly where a one-line
					    truncation would cut it off on a phone. */}
					<span
						data-question-answer
						className={cn(
							"mt-0.5 line-clamp-2 text-xs leading-snug",
							tone === "set" && "font-medium text-accent-emphasis",
							tone === "warn" &&
								"font-medium text-amber-700 dark:text-amber-400",
							tone === "error" && "font-medium text-destructive",
							tone === "off" && "text-muted-foreground",
						)}
					>
						{answer}
					</span>
				</span>
				{badge ? <span className="shrink-0">{badge}</span> : null}
				<ChevronDown
					aria-hidden="true"
					className={cn(
						"size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
						open && "rotate-180",
					)}
				/>
			</button>
			<div
				ref={panelRef}
				id={panelId}
				hidden={!open}
				{...{ [DISCLOSURE_PANEL_ATTR]: "" }}
				className="flex flex-col gap-4 border-t border-border bg-muted/20 px-4 py-4"
			>
				{children}
			</div>
		</li>
	);
}
