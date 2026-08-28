import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/**
 * The shadcn/ui Table primitives, adopted for visual consistency (86eyrtz74).
 *
 * Standard shadcn markup, with the project's semantic tokens rather than raw
 * colors — `bg-muted`, `border-border`, `text-muted-foreground` — so it reads
 * correctly in light and dark without a second palette.
 *
 * `Table` wraps itself in an `overflow-x-auto` container: wide content must
 * scroll inside its own box and never take the page sideways with it (the
 * design system's hard rule). `min-w-0` is on the wrapper so a flex parent
 * can't let it push the body wide.
 *
 * ⚠️ **That wrapper is a scroll container on BOTH axes.** CSS forces
 * `overflow-y` to `auto` as soon as `overflow-x` is, so the wrapper — not the
 * page — becomes the sticky containing block for anything inside it. A
 * `sticky top-0` header therefore does **nothing** unless the wrapper has a
 * bounded height and actually scrolls vertically; it silently scrolls away with
 * the page instead. Pass a `max-h-*` via `wrapperClassName` to make a sticky
 * header work (see `order-table.tsx`), and don't "tidy away" that height.
 */
export function Table({
	className,
	wrapperClassName,
	...props
}: ComponentProps<"table"> & { wrapperClassName?: string }) {
	return (
		<div
			className={cn(
				"relative min-w-0 w-full overflow-x-auto",
				wrapperClassName,
			)}
		>
			<table
				className={cn(
					"w-full caption-bottom border-collapse text-sm",
					className,
				)}
				{...props}
			/>
		</div>
	);
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
	return <thead className={cn("[&_tr]:border-b", className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
	return (
		<tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />
	);
}

export function TableFooter({ className, ...props }: ComponentProps<"tfoot">) {
	return (
		<tfoot
			className={cn(
				"border-t border-border bg-muted/50 font-medium [&>tr]:last:border-b-0",
				className,
			)}
			{...props}
		/>
	);
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
	return (
		<tr
			className={cn(
				"border-b border-border/60 transition-colors hover:bg-muted/40 data-[state=selected]:bg-accent/10",
				className,
			)}
			{...props}
		/>
	);
}

export function TableHead({ className, ...props }: ComponentProps<"th">) {
	return (
		<th
			className={cn(
				// Headers read as a distinct band, not as faint captions: near-full
				// foreground rather than `muted-foreground`, 12px rather than 11, and
				// `h-11` — which also puts the sort control on the 44px touch floor.
				"h-11 px-2.5 text-left align-middle text-xs font-bold uppercase tracking-[0.06em] text-foreground/75 [&:has([role=checkbox])]:pr-0",
				className,
			)}
			{...props}
		/>
	);
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
	return (
		<td
			className={cn(
				"px-2 align-middle text-[13px] [&:has([role=checkbox])]:pr-0",
				className,
			)}
			{...props}
		/>
	);
}

export function TableCaption({
	className,
	...props
}: ComponentProps<"caption">) {
	return (
		<caption
			className={cn("mt-4 text-sm text-muted-foreground", className)}
			{...props}
		/>
	);
}
