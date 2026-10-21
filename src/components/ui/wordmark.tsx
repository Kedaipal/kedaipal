import { cn } from "../../lib/utils";
import { AppImage } from "./app-image";

/**
 * The Kedaipal wordmark, right in both themes (z8r3fdadub).
 *
 * `/logo-3.svg` is the navy lockup: on the dark ground it hits 1.09:1 and the
 * word simply disappears, leaving a floating mint emblem — the P0 the first
 * dark-mode review found on the storefront header, then found again on the
 * marketing nav, the legal header, /stores and the onboarding bar once the
 * theme reached those pages. One component so it cannot recur.
 *
 * Two instances swapped in CSS, NOT one `src` picked from `useTheme()`: most
 * of these pages SSR, and a hook-driven src would ship the navy mark from the
 * server and only correct after hydration. The `.dark` class is already on
 * <html> pre-paint, so `dark:hidden` is right on the first frame. Both carry
 * the alt — exactly one is ever displayed, and `display: none` keeps the other
 * out of the accessibility tree.
 *
 * `aspect` takes the size classes AppImage expects (`h-7 w-auto`); put any
 * responsive display classes on a wrapper, not here, so they never fight the
 * `dark:` pair.
 */
export function Wordmark({
	aspect,
	priority = false,
	className,
}: {
	aspect: string;
	priority?: boolean;
	className?: string;
}) {
	return (
		<>
			<AppImage
				src="/logo-3.svg"
				alt="Kedaipal"
				aspect={aspect}
				fill={false}
				priority={priority}
				className={cn("dark:hidden", className)}
			/>
			<AppImage
				src="/logo-dark.svg"
				alt="Kedaipal"
				aspect={aspect}
				fill={false}
				priority={priority}
				className={cn("hidden dark:block", className)}
			/>
		</>
	);
}
