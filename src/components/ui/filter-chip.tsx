import { Minus } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * The one filter/segment chip for list toolbars (orders buckets, product status,
 * customer sort, filter-sheet values). Replaces the hand-rolled chips that had
 * drifted into three different active styles.
 *
 * Two tones:
 * - `primary` (navy solid) — the DEFAULT, and everything the system derives:
 *   workflow buckets, booking periods, sort, tabs-as-chips. A row of these
 *   reads as one control with several positions.
 * - `accent` (soft mint) — reserved for two cases. Inside a filter panel or
 *   settings card (payment status, due window, fulfilment options), where a
 *   chip reads as "this constraint is on" against a plain background; and for
 *   PINNED in the inbox row, which is deliberately the one mint chip among
 *   navy ones. Pinning is the seller's OWN mark on an order — not a category
 *   the app computed — so it is meant to stand apart from the row rather than
 *   blend into it (owner call, 1 Sep).
 *
 * The rule that does NOT hold: "accent = any applied constraint". That was the
 * original wording and it licensed new filter chips into mint one at a time
 * until the row was half navy and half green. Booking periods were added that
 * way and taken back out. Default to `primary`; reach for `accent` only for
 * the two cases above.
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
	/**
	 * `"mixed"` is a real third state, not a styling flag: a chip that summarises
	 * several options (the inbox's bucket chips over their statuses) must not read
	 * as OFF while two of its three are on. Renders the dash the house uses for
	 * "some" everywhere else (see `BulkSelectRow`) and reports `aria-pressed`
	 * `"mixed"`, which is the native tri-state for a toggle button.
	 */
	selected?: boolean | "mixed";
	tone?: "primary" | "accent";
	/** Optional count rendered as a small pill inside the chip; caps at 99+. */
	count?: number;
	/** `attention` = amber (e.g. the New bucket), `muted` = quiet slate. */
	countTone?: "muted" | "attention";
}) {
	const mixed = selected === "mixed";
	const on = selected === true;
	return (
		<button
			type="button"
			aria-pressed={mixed ? "mixed" : on}
			className={cn(
				"inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
				on
					? tone === "primary"
						? "border-primary bg-primary text-primary-foreground"
						: "border-accent bg-accent/15 font-semibold text-accent-emphasis"
					: mixed
						? // Between off and on, and legibly so: the selected border with
							// an unfilled body. Never the solid fill — "some" reading the
							// same as "all" is the exact lie the dash is here to prevent.
							tone === "primary"
							? "border-primary bg-primary/10 font-semibold text-foreground"
							: "border-accent bg-accent/5 font-semibold text-accent-emphasis"
						: "border-border bg-card text-muted-foreground hover:border-accent/40 hover:text-foreground",
				className,
			)}
			{...props}
		>
			{mixed ? <Minus className="size-3.5 shrink-0" aria-hidden="true" /> : null}
			{children}
			{count != null ? (
				<span
					className={cn(
						"flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-semibold leading-none tabular-nums",
						on
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
