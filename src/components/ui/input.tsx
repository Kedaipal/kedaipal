import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "#/lib/utils";

const inputVariants = cva(
	// Shared chrome for every variant: width, border, background, focus ring,
	// placeholder, file-input, disabled and invalid (aria-invalid) states.
	"w-full min-w-0 border border-input bg-transparent transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
	{
		variants: {
			variant: {
				// shadcn default — compact control used in toolbars, search bars, etc.
				default: "h-8 rounded-lg px-2.5 py-1 text-base md:text-sm",
				// Mobile-first dashboard form field: ≥44px tap target, roomier.
				field: "min-h-11 rounded-xl px-4 text-base",
				// Unstyled child of a composite control (e.g. a "kedaipal.com/" slug
				// box) — the wrapping element owns the border, background and ring.
				bare: "h-auto rounded-none border-0 bg-transparent px-0 focus-visible:border-input focus-visible:ring-0",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

type InputProps = React.ComponentProps<"input"> &
	VariantProps<typeof inputVariants> & {
		/**
		 * Render the error/invalid state (destructive border + ring). Sets
		 * `aria-invalid` for assistive tech. Alias: pass `aria-invalid` directly.
		 */
		isError?: boolean;
	};

function Input({
	className,
	type,
	variant,
	isError,
	"aria-invalid": ariaInvalid,
	...props
}: InputProps) {
	return (
		<input
			type={type}
			data-slot="input"
			aria-invalid={isError || ariaInvalid}
			className={cn(inputVariants({ variant }), className)}
			{...props}
		/>
	);
}

export { Input, inputVariants };
