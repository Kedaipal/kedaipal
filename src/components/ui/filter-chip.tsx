import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * The one filter/segment chip for list toolbars (orders buckets, product status,
 * customer sort, filter-sheet values). Replaces the hand-rolled chips that had
 * drifted into three different active styles.
 *
 * Two tones, chosen by WHERE the chip lives — not by what it means, which was
 * the older rule and drifted:
 * - `primary` (navy solid) — the inbox CHIP ROW, all of it: buckets, pins,
 *   booking periods, sort, tabs-as-chips. One row, one language. Meaning is
 *   carried by the label, the count and the dividers between groups, never by
 *   a second colour — a row that mixes navy and mint reads as two apps.
 * - `accent` (soft mint) — chips INSIDE a filter panel or a settings card
 *   (payment status, due window, fulfilment options), where the chip reads as
 *   "this constraint is on" against a plain background and there is no navy
 *   row for it to clash with.
 *
 * Always `rounded-full` and ≥40px tall (h-10) with a 44px hit area via padding —
 * pass `className="h-11"` where the chip is the row's only control.
 */
export function FilterChip({
	selected = false,
	tone = "primary",
	count,
	countTone = "muted",
	className,
	children,
	...props
}: ComponentProps<"button"> & {
	selected?: boolean;
	tone?: "primary" | "accent";
	/** Optional count rendered as a small pill inside the chip; caps at 99+. */
	count?: number;
	/** `attention` = amber (e.g. the New bucket), `muted` = quiet slate. */
	countTone?: "muted" | "attention";
}) {
	return (
		<button
			type="button"
			aria-pressed={selected}
			className={cn(
				"inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
				selected
					? tone === "primary"
						? "border-primary bg-primary text-primary-foreground"
						: "border-accent bg-accent/15 font-semibold text-accent-emphasis"
					: "border-border bg-card text-muted-foreground hover:border-accent/40 hover:text-foreground",
				className,
			)}
			{...props}
		>
			{children}
			{count != null ? (
				<span
					className={cn(
						"flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-semibold leading-none tabular-nums",
						selected
							? tone === "primary"
								? countTone === "attention"
									? "bg-amber-500 text-white"
									: "bg-white/25 text-primary-foreground"
								: "bg-accent/25 text-accent-emphasis"
							: countTone === "attention"
								? "bg-amber-500 text-white"
								: "bg-muted text-muted-foreground",
					)}
				>
					{count > 99 ? "99+" : count}
				</span>
			) : null}
		</button>
	);
}

/**
 * Horizontally-scrolling chip row that bleeds to the screen edge on mobile
 * (standard pattern for bucket/sort rows). Children are FilterChips.
 */
export function FilterChipRow({
	className,
	children,
}: {
	className?: string;
	children: ReactNode;
}) {
	return (
		<div
			className={cn(
				"-mx-5 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden",
				className,
			)}
		>
			{children}
		</div>
	);
}
