import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDown } from "lucide-react";
import type * as React from "react";

import { cn } from "#/lib/utils";

/**
 * Chrome for a native `<select>`, mirroring `inputVariants` so a picker and a
 * text field standing next to each other are the same control height, radius
 * and focus ring.
 *
 * `appearance-none` is LOAD-BEARING, not a reset for tidiness. The native
 * macOS caret paints hard against the right border and ignores the control's
 * padding, so a `<select>` sitting beside a native date/time input — whose
 * calendar and clock glyphs ARE inset — reads as visibly misaligned, and the
 * caret fights a `rounded-xl` focus ring. We suppress it and draw our own
 * chevron at `right-3.5`, which also makes Safari, Chrome and Firefox agree.
 *
 * `pr-10` reserves the chevron's lane: without it a long option label runs
 * under the glyph.
 */
const selectVariants = cva(
	"w-full min-w-0 appearance-none border border-input bg-background transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
	{
		variants: {
			variant: {
				// Compact control used in toolbars and dense rows.
				default: "h-8 rounded-lg pl-2.5 pr-8 text-base md:text-sm",
				// Mobile-first dashboard form field: ≥44px tap target, roomier.
				// Pairs with `<Input variant="field" />`.
				field: "min-h-11 rounded-xl pl-4 pr-10 text-base",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

type SelectProps = Omit<React.ComponentProps<"select">, "className"> &
	VariantProps<typeof selectVariants> & {
		/**
		 * Layout for the control — width above all (`w-56`, `w-full`). It lands
		 * on the positioning WRAPPER rather than the `<select>` itself, so the
		 * chevron is placed against the same box the seller sees; the select
		 * fills it. Chrome (height, radius, padding) comes from `variant`.
		 */
		className?: string;
		/**
		 * Render the error state (destructive border + ring). Sets
		 * `aria-invalid` for assistive tech. Alias: pass `aria-invalid` directly.
		 */
		isError?: boolean;
	};

/**
 * The house native `<select>`. Native on purpose: on a phone it opens the OS
 * picker wheel, which beats any listbox we could draw, and it needs no
 * portal, no focus trap and no JS to be accessible.
 */
function Select({
	className,
	variant,
	isError,
	children,
	disabled,
	"aria-invalid": ariaInvalid,
	...props
}: SelectProps) {
	return (
		<div className={cn("relative", className)}>
			<select
				data-slot="select"
				disabled={disabled}
				aria-invalid={isError || ariaInvalid}
				className={selectVariants({ variant })}
				{...props}
			>
				{children}
			</select>
			<ChevronDown
				aria-hidden="true"
				className={cn(
					// `pointer-events-none` so the glyph never eats the click that
					// should open the picker — the whole control stays one target.
					"pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground",
					variant === "default" ? "right-2.5" : "right-3.5",
					// The chevron dims WITH the control: a disabled select whose
					// caret still looks live reads as merely empty, not locked.
					disabled && "opacity-50",
				)}
			/>
		</div>
	);
}

export { Select, selectVariants };
