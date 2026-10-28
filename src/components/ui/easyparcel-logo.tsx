import { cn } from "#/lib/utils";
import { AppImage } from "./app-image";

/**
 * The EasyParcel wordmark — the one way any surface renders it.
 *
 * `logo_horizontal.svg` from EasyParcel's own site, untouched: official marks
 * are never redrawn or recoloured (the `logoPillClass` rule in landing-ui.tsx).
 * Unlike Delyva's black ink it is a single brand pink that reads on a light
 * AND a dark card, so it needs no dark-mode plate — it renders bare in both.
 */
export function EasyparcelLogo({
	heightClass,
	alt = "",
	className,
}: {
	/** The wordmark's height, e.g. `"h-3.5"`; the width follows its ratio. */
	heightClass: string;
	/** Empty when a visible label beside it already names EasyParcel. */
	alt?: string;
	className?: string;
}) {
	return (
		<AppImage
			src="/img/easyparcel-logo.svg"
			alt={alt}
			aspect={`${heightClass} w-auto`}
			fill={false}
			className={cn("shrink-0", className)}
		/>
	);
}
