import { Slider as SliderPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "#/lib/utils";

interface SliderProps
	extends Omit<
		React.ComponentProps<typeof SliderPrimitive.Root>,
		"value" | "defaultValue" | "onValueChange"
	> {
	/** Current value (single-thumb). */
	value: number;
	onValueChange: (value: number) => void;
	/** Accessible label for the thumb (no visible label inside the control). */
	"aria-label"?: string;
}

/**
 * Single-value range slider built on Radix Slider. Mint `--accent` range,
 * generous ≥44px touch target on the thumb (via an invisible expanded hit
 * area) to satisfy the mobile tap-target rule.
 */
export function Slider({
	className,
	value,
	onValueChange,
	min = 0,
	max = 100,
	step = 1,
	...props
}: SliderProps) {
	return (
		<SliderPrimitive.Root
			data-slot="slider"
			className={cn(
				"relative flex w-full touch-none select-none items-center py-2.5",
				className,
			)}
			min={min}
			max={max}
			step={step}
			value={[value]}
			onValueChange={(values) => onValueChange(values[0] ?? min)}
			{...props}
		>
			<SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-muted">
				<SliderPrimitive.Range className="absolute h-full bg-accent" />
			</SliderPrimitive.Track>
			<SliderPrimitive.Thumb
				className={cn(
					"relative block size-6 rounded-full border-2 border-accent bg-background shadow-sm transition-colors",
					"focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent/40",
					// Invisible expanded hit area → ~44px touch target.
					"before:absolute before:-inset-2.5 before:content-['']",
				)}
			/>
		</SliderPrimitive.Root>
	);
}
