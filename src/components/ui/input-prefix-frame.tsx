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
/**
 * The metrics the frame lends its control: the `field` variant's 44px floor,
 * its horizontal padding and its type size, applied to the direct-child input.
 *
 * It lives HERE and not at each call site because a `bare` input is `px-0` —
 * the plate normally supplies the only gap there is, so the end a plate is
 * NOT welded to puts the value hard against the border. That shipped in the
 * voucher dialog's percentage field (`10` touching the frame, spotted by Zaki,
 * 12 Oct `z8r3fdr617`) after the same three classes had been hand-copied at
 * three call sites — one control, one rule, so the frame owns them.
 */
const SLOT_METRICS = "[&>input]:min-h-11 [&>input]:px-3 [&>input]:text-base";

export function InputPrefixFrame({
	prefix,
	side = "start",
	invalid = false,
	disabled = false,
	className,
	children,
}: {
	prefix: ReactNode;
	/**
	 * Which end the plate is welded to. `start` for a unit that PRECEDES its
	 * number (`RM`, `+60`); `end` for one that FOLLOWS it (`%`, `kg`, `km`) —
	 * a "%" plate on the left renders "%10", which is not how anyone writes a
	 * percentage (`z8r3fdr617`).
	 */
	side?: "start" | "end";
	invalid?: boolean;
	disabled?: boolean;
	className?: string;
	/**
	 * The control itself — render it with `variant="bare"`. The frame supplies
	 * its height, padding and type size (see `SLOT_METRICS`); a call site does
	 * not repeat them.
	 */
	children: ReactNode;
}) {
	// Same plate either way; only which border divides it from the field
	// changes, so both ends keep one rounded frame.
	const plate = (
		// `select-none` so a drag-select of the value doesn't sweep the fixed
		// part into the copy. `relative` so a plate that hosts a control (the
		// buyer phone picker's overlaid <select>) can cover all of it,
		// padding included — the whole 44px plate is the tap target.
		<span
			className={cn(
				"relative flex select-none items-center gap-1.5 self-stretch bg-muted/60 px-3 text-muted-foreground",
				side === "start" ? "border-r border-input" : "border-l border-input",
			)}
		>
			{prefix}
		</span>
	);
	return (
		// Mirrors the `field` input variant's chrome on the WRAPPER so the prefix
		// and the input read as one control. Focus + invalid styling has to be
		// lifted here too — a `bare` input paints neither. `overflow-hidden` lets
		// the plate fill the rounded corner.
		<div
			className={cn(
				"flex min-h-11 items-center overflow-hidden rounded-xl border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
				SLOT_METRICS,
				disabled && "cursor-not-allowed bg-input/50 opacity-50",
				// Invalid keeps its red border and ring under focus too — the
				// focus-within classes above would otherwise repaint it mint and hide
				// the error exactly while the user is fixing it.
				invalid &&
					"border-destructive ring-3 ring-destructive/20 focus-within:border-destructive focus-within:ring-destructive/20 dark:border-destructive/50 dark:ring-destructive/40 dark:focus-within:border-destructive/50 dark:focus-within:ring-destructive/40",
				className,
			)}
		>
			{side === "start" ? plate : null}
			{children}
			{side === "end" ? plate : null}
		</div>
	);
}
