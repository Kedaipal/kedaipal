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
 */
export function Table({ className, ...props }: ComponentProps<"table">) {
	return (
		<div className="relative min-w-0 w-full overflow-x-auto">
			<table
				className={cn("w-full caption-bottom border-collapse text-sm", className)}
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
				"h-[42px] px-2 text-left align-middle text-[11px] font-bold uppercase tracking-wider text-muted-foreground [&:has([role=checkbox])]:pr-0",
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
