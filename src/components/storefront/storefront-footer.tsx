import { AppImage } from "../ui/app-image";
import { ThemeToggle } from "../ui/theme-toggle";

/**
 * "Powered by Kedaipal" storefront footer badge (ticket 86ey8zh3r).
 *
 * Mirrors the Store QR Poster's powered-by lockup so the printed poster and the
 * web storefront carry one uniform brand mark: a mint "POWERED BY" pill above
 * the Kedaipal wordmark. Colours + shape match `store-poster.tsx` exactly
 * (mint border #B9D9CC / mint text #7BA394 / navy wordmark lockup). Quiet by
 * design so it never competes with the retailer's own brand — the on-page twin
 * of the "Powered by Kedaipal" line on WhatsApp order confirmations. No retailer
 * toggle: universal or the loop doesn't compound.
 *
 * The `?src=storefront_badge` tag is the repo's reserved PostHog attribution
 * convention (same as the poster QR `?src=` links) so the click path this badge
 * creates is measurable. Opens in a new tab so the buyer never loses the store.
 */
export function StorefrontFooter() {
	return (
		<footer
			// One rhythm on every storefront page — store home, category, product
			// and checkout all render this identically. It briefly took a `compact`
			// prop for the pages ending in a bottom CTA bar, on the theory that the
			// bar's own border already separated the badge; that only held while
			// those bars were `position: sticky` and sat in flow directly under it.
			// They're `fixed` now (so the badge is ordinary page content above a
			// floating bar, exactly like the store home) and the tighter spacing
			// just read as inconsistent.
			//
			// `mt-auto` anchors the badge to the BOTTOM of the page on short
			// pages — it only works while this <footer> is a DIRECT flex child of
			// the route's `min-h-dvh flex-col` container. Don't wrap it in a
			// breakpoint div: the wrapper becomes the flex child and the margin
			// silently stops applying (that regression shipped once already).
			className="mt-auto px-5 pb-6 pt-8 lg:px-8"
		>
			<div className="flex items-center justify-center gap-3">
				{/* The buyer's only theme control, deliberately down here: the page
				    already matched their phone on arrival, so this is an override, not
				    a decision they owe us above the fold. */}
				<ThemeToggle />
				<a
					href="https://kedaipal.com?src=storefront_badge"
					target="_blank"
					rel="noopener noreferrer"
					aria-label="Powered by Kedaipal"
					className="flex flex-col items-center gap-2 rounded-2xl px-2 py-1 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
				>
					<span className="rounded-full border border-[#B9D9CC] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#7BA394]">
						Powered by
					</span>
					{/* Navy lockup in light, near-white in dark — swapped in CSS for the
					    same SSR reason as the header mark. The dark asset is the same
					    file with #0F172A → #F8FAFC; the mint emblem is untouched, so
					    `dark:invert` was not an option (it would turn the mint
					    magenta). */}
					<AppImage
						src="/poster/kedaipal-lockup.svg"
						alt="Kedaipal"
						aspect="h-5 w-auto"
						fill={false}
						className="dark:hidden"
					/>
					<AppImage
						src="/poster/kedaipal-lockup-dark.svg"
						alt=""
						aspect="h-5 w-auto"
						fill={false}
						className="hidden dark:block"
					/>
				</a>
			</div>
		</footer>
	);
}
