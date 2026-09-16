import useEmblaCarousel from "embla-carousel-react";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { COUNTRIES, type Country } from "../../../convex/lib/country";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";

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

/**
 * The one answer to the "another dead app" fear — white-glove onboarding,
 * stated as a promise, directly under the primary CTA (ClickUp 86eye3p6z §B).
 *
 * There is exactly ONE author of this sentence (`guarantee_line`) because the
 * WhatsApp outreach ladder makes the same promise word-for-word; a second copy
 * would drift and we'd be promising two different things to the same seller.
 * Callers pass their own colour/size via `className` — the surfaces it lands on
 * are light, navy and mint.
 */
export function GuaranteeLine({ className }: { className?: string }) {
	return (
		<p className={cn("flex items-start gap-2", className)}>
			<ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" />
			<span className="font-medium">{m.guarantee_line()}</span>
		</p>
	);
}

/**
 * Mobile centered carousel (Embla — the engine under shadcn's Carousel),
 * for rails whose CENTER slide is the centerpiece (the pricing tiers, owner
 * call 29 Aug: Pro dead-center with neighbours peeking both sides). CSS
 * scroll-snap can't truly center the first/last slide or park an initial
 * index reliably, which is why this earns a library where the other rails
 * keep the house snap classes.
 *
 * Desktop is untouched: the `(min-width: 768px)` breakpoint deactivates
 * Embla entirely and `desktopClass` (usually `md:grid …`) takes over the
 * same flex container. Wrap each slide in `centerSnapSlideClass()`.
 */
export function CenterSnapCarousel({
	children,
	desktopClass,
	startIndex = 0,
	className,
}: {
	children: ReactNode;
	/** Layout classes for md+ where Embla is inactive (e.g. "md:grid …"). */
	desktopClass?: string;
	/** Slide index parked in the center on mount (mobile only). */
	startIndex?: number;
	className?: string;
}) {
	const [emblaRef] = useEmblaCarousel({
		align: "center",
		startIndex,
		containScroll: false,
		breakpoints: { "(min-width: 768px)": { active: false } },
	});
	return (
		<div
			ref={emblaRef}
			className={cn("-mx-5 overflow-hidden md:mx-0 md:overflow-visible", className)}
		>
			<div className={cn("flex touch-pan-y", desktopClass)}>{children}</div>
		</div>
	);
}

/** A slide inside `CenterSnapCarousel` — 80% width with side peeks below
 * `sm`, 60% to `md`, then whatever the desktop layout says. */
export function centerSnapSlideClass(extra?: string) {
	return cn(
		"min-w-0 shrink-0 grow-0 basis-[80%] px-2 first:pl-4 last:pr-4 sm:basis-[60%] md:basis-auto md:px-0 md:first:pl-0 md:last:pr-0",
		extra,
	);
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

interface RegionToggleProps {
	region: Country;
	onChange: (next: Country) => void;
	className?: string;
}

/**
 * MY/SG segmented toggle, on all three public pricing surfaces (landing
 * teaser, `/pricing`, `/cost`) — overrides the region detected from the
 * visitor's IP and persists the pick in a cookie, which then outranks
 * detection on every later visit, server-side included (`lib/geo-region.ts`).
 *
 * Geo-IP is a guess about a person, and it is wrong often enough to matter —
 * VPNs, corporate proxies, carrier NAT egressing in another country, and the
 * JB commuter on a Singapore network. This control is what stops a wrong guess
 * from being a dead end. Short "MY"/"SG" labels keep the pill compact; the
 * full country name rides `aria-label` per button so a screen-reader user
 * hears "Malaysia" / "Singapore", not two letters.
 */
export function RegionToggle({ region, onChange, className }: RegionToggleProps) {
	return (
		<fieldset
			aria-label={m.region_toggle_label()}
			className={cn(
				"m-0 inline-flex rounded-full border border-border bg-card p-1",
				className,
			)}
		>
			{COUNTRIES.map((c) => (
				<button
					key={c}
					type="button"
					aria-pressed={region === c}
					aria-label={c === "MY" ? m.region_my() : m.region_sg()}
					onClick={() => onChange(c)}
					className={cn(
						// tap-target: 44px is the touch-rule floor (design-system §mobile) —
						// the first cut's min-h-9 (36px) failed the 29 Aug mobile audit.
						"tap-target min-w-16 rounded-full px-4 text-sm font-semibold transition-colors",
						region === c
							? "bg-primary text-primary-foreground"
							: "text-muted-foreground hover:text-foreground",
					)}
				>
					{c}
				</button>
			))}
		</fieldset>
	);
}

/**
 * White pill shared by every third-party brand mark on the landing (payment
 * rails, couriers) so each chip has one silhouette in both themes: official
 * marks may not be recoloured and most carry their own colours, so a white
 * ground is the only treatment that stays legible and compliant when the page
 * flips to dark. One idea, one control — the payment wall and the courier rail
 * render the identical chip.
 */
export const logoPillClass =
	"inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-white shadow-sm transition-transform duration-200 hover:-translate-y-0.5";

/**
 * One auto-scrolling row of chips (the Mobbin logo-wall rows). Renders the
 * children twice — the second copy `aria-hidden` — so the loop is seamless;
 * hovering the ROW pauses it, so a reader can chase a chip without it
 * escaping. Reduced motion stops it via the shared `animate-kp-marquee*` CSS.
 *
 * `children` is a render function so the duplicate copy can pass `hidden` to
 * its images (empty `alt`) and the names aren't announced twice.
 */
export function LogoMarqueeRow({
	children,
	reverse = false,
	className,
}: {
	children: (hidden: boolean) => ReactNode;
	reverse?: boolean;
	className?: string;
}) {
	const copy = (hidden: boolean) => (
		<div
			aria-hidden={hidden || undefined}
			className="flex shrink-0 items-center gap-2.5 pr-2.5"
		>
			{children(hidden)}
		</div>
	);
	return (
		<div className={cn("flex overflow-hidden py-1", className)}>
			<div
				className={cn(
					"flex hover:[animation-play-state:paused]",
					reverse ? "animate-kp-marquee-slow-reverse" : "animate-kp-marquee-slow",
				)}
			>
				{copy(false)}
				{copy(true)}
			</div>
		</div>
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
