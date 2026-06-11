import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * Shared primitives for the landing page redesign. Everything uses the
 * existing theme tokens (primary navy, accent mint, card, border) so the
 * landing stays consistent with the rest of the product.
 */

/** Class string for a big pill CTA — apply to a <Link>/<a>/<button>. */
export function ctaPillClass(
	variant: "accent" | "primary" | "outline" = "accent",
) {
	const base =
		"group inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full px-7 text-base font-semibold transition-all duration-200 hover:-translate-y-0.5 active:translate-y-px focus-visible:outline-none focus-visible:ring-4";
	const variants = {
		accent:
			"bg-accent text-accent-foreground shadow-lg shadow-accent/25 hover:bg-accent/90 hover:shadow-xl hover:shadow-accent/30 focus-visible:ring-accent/30",
		primary:
			"bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90 focus-visible:ring-primary/30",
		outline:
			"border-2 border-border bg-background text-foreground hover:border-foreground/25 hover:bg-muted focus-visible:ring-ring/20",
	} as const;
	return cn(base, variants[variant]);
}

interface StickerProps {
	children: ReactNode;
	className?: string;
	tone?: "accent" | "primary" | "outline" | "destructive";
	rotate?: number;
}

/** Rotated sticker-style chip. */
export function Sticker({
	children,
	className,
	tone = "accent",
	rotate = -2,
}: StickerProps) {
	const tones = {
		accent: "bg-accent text-accent-foreground",
		primary: "bg-primary text-primary-foreground",
		outline: "border border-accent/30 bg-accent/10 text-accent",
		destructive: "bg-destructive text-destructive-foreground",
	} as const;
	return (
		<span
			className={cn(
				"inline-flex w-fit items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider shadow-sm",
				tones[tone],
				className,
			)}
			style={{ transform: `rotate(${rotate}deg)` }}
		>
			{children}
		</span>
	);
}

interface EyebrowProps {
	children: ReactNode;
	className?: string;
}

/** Small uppercase section label with an accent dot. */
export function Eyebrow({ children, className }: EyebrowProps) {
	return (
		<p
			className={cn(
				"inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-accent",
				className,
			)}
		>
			<span
				aria-hidden
				className="inline-block size-1.5 rounded-full bg-accent"
			/>
			{children}
		</p>
	);
}

interface MarqueeProps {
	items: string[];
	className?: string;
	separator?: string;
}

function MarqueeRow({
	items,
	separator,
	hidden = false,
}: {
	items: string[];
	separator: string;
	hidden?: boolean;
}) {
	return (
		<div
			aria-hidden={hidden || undefined}
			className="flex shrink-0 items-center gap-6 pr-6"
		>
			{items.map((item) => (
				<span key={item} className="flex items-center gap-6">
					<span className="whitespace-nowrap">{item}</span>
					<span aria-hidden className="text-accent">
						{separator}
					</span>
				</span>
			))}
		</div>
	);
}

/** Full-bleed scrolling strip. Content duplicated for a seamless loop. */
export function Marquee({ items, className, separator = "✶" }: MarqueeProps) {
	return (
		<div
			className={cn(
				"relative flex overflow-hidden bg-primary py-3 text-primary-foreground",
				className,
			)}
		>
			<div className="animate-kp-marquee flex text-sm font-semibold uppercase tracking-[0.15em]">
				<MarqueeRow items={items} separator={separator} />
				<MarqueeRow items={items} separator={separator} hidden />
			</div>
		</div>
	);
}
