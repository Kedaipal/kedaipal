import type { ReactNode } from "react";
import { cn } from "#/lib/utils";

/**
 * The composite-control chrome: a tinted, non-editable plate welded to the
 * front of a `bare` input, inside one border that owns the focus ring and the
 * invalid state.
 *
 * The plate makes the fixed part *visibly* not editable, so nobody wonders
 * whether to retype it — the shape every phone field in this market uses (Grab,
 * Shopee, Stripe). Generic on purpose: the plate holds a `+60` dial code in
 * `MyPhoneInput`, but the same shape is how an "RM" money field reads.
 *
 * Whatever sits on the plate is **a promise about what the field already
 * contains** — the caller's schema must accept a value typed without it, or the
 * plate tells the user to do something the validator then rejects.
 */
export function InputPrefixFrame({
	prefix,
	invalid = false,
	disabled = false,
	className,
	children,
}: {
	prefix: ReactNode;
	invalid?: boolean;
	disabled?: boolean;
	className?: string;
	/** The control itself — render it with `variant="bare"`. */
	children: ReactNode;
}) {
	return (
		// Mirrors the `field` input variant's chrome on the WRAPPER so the prefix
		// and the input read as one control. Focus + invalid styling has to be
		// lifted here too — a `bare` input paints neither. `overflow-hidden` lets
		// the plate fill the rounded corner.
		<div
			className={cn(
				"flex min-h-11 items-center overflow-hidden rounded-xl border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
				disabled && "cursor-not-allowed bg-input/50 opacity-50",
				invalid &&
					"border-destructive ring-3 ring-destructive/20 dark:border-destructive/50 dark:ring-destructive/40",
				className,
			)}
		>
			{/* `select-none` so a drag-select of the value doesn't sweep the fixed
			    part into the copy. */}
			<span className="flex select-none items-center gap-1.5 self-stretch border-r border-input bg-muted/60 px-3 text-muted-foreground">
				{prefix}
			</span>
			{children}
		</div>
	);
}
