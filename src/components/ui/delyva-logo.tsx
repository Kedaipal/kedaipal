import { cn } from "#/lib/utils";
import { AppImage } from "./app-image";

/**
 * The DelyvaNow wordmark — the one way any surface renders it.
 *
 * "Delyva" is black ink on transparency, so on a dark card it vanished and
 * only "Now" was left. Official marks are never recoloured (the
 * `logoPillClass` rule in landing-ui.tsx), so dark mode gets the house
 * treatment for third-party marks instead: a white plate behind the mark.
 * Light mode renders it bare, exactly as before. CSS picks the treatment, not
 * `useTheme()`, so an SSR'd page is right before hydration.
 */
export function DelyvaLogo({
	heightClass,
	alt = "",
	className,
}: {
	/** The wordmark's height, e.g. `"h-3.5"`; the width follows its ratio. */
	heightClass: string;
	/** Empty when a visible label beside it already names Delyva. */
	alt?: string;
	className?: string;
}) {
	return (
		<span
			data-testid="delyva-logo"
			className={cn(
				// dark-ok: a white plate under Delyva's black-ink wordmark — the
				// mark itself may not be recoloured, so dark mode needs white behind it.
				"inline-flex shrink-0 items-center rounded-md dark:bg-white dark:px-1.5 dark:py-1",
				className,
			)}
		>
			<AppImage
				src="/img/delyva-logo.png"
				alt={alt}
				aspect={`${heightClass} w-auto`}
				fill={false}
			/>
		</span>
	);
}
