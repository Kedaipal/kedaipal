import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { Locale } from "../../../convex/lib/locale";
import {
	type PoweredBySurface,
	poweredByHref,
} from "../../../convex/lib/poweredBy";
import { AppImage } from "../ui/app-image";

/**
 * "Powered by Kedaipal" buyer-facing footer badge (ticket 86ey8zh3r, on
 * every buyer surface since z8r3fdcwd0).
 *
 * Mirrors the Store QR Poster's powered-by lockup so the printed poster and
 * every buyer web page carry one uniform brand mark: a mint "POWERED BY" pill
 * above the Kedaipal wordmark. Colours + shape match `store-poster.tsx`
 * exactly (mint border #B9D9CC / mint text #7BA394 / navy wordmark lockup).
 * Quiet by design so it never competes with the retailer's own brand — the
 * on-page twin of the "Powered by Kedaipal" line on WhatsApp order
 * confirmations and of the mark on the receipt PDF. No retailer toggle:
 * universal or the loop doesn't compound.
 *
 * The href is built by ONE function (`poweredByHref`): `?src=powered-by[-…]`
 * names the surface the click came from and `&store=<slug>` names whose badge
 * it was. The landing page captures both; they ride the GA4 funnel and land on
 * `retailers.signupSource` / `retailers.signupReferrerId`, so "sellers acquired
 * via other sellers' pages — and which sellers" is measurable. Opens in a new
 * tab so the buyer never loses the page they were on.
 */
export function StorefrontFooter({
	slug,
	surface = "storefront",
	discover = false,
	locale = "en",
}: {
	/** The store whose page this is. Omit only where none is in scope yet
	 * (a loading skeleton, a not-found page for an unknown slug). */
	slug?: string;
	/** Which buyer surface the badge sits on — picks the `?src=` tag. */
	surface?: PoweredBySurface;
	/**
	 * Show "Discover more stores" — the buyer's door to the /stores directory
	 * (z8r3fdkmyp). Opt-in per page: ON where a buyer is BROWSING (store home,
	 * category, product, store-not-found) AND on the order page, in every
	 * state, unpaid included (Arif, 14 Oct 2026, z8r3fducgw: the order page was
	 * a dead end, and below every payment card it doesn't compete with one).
	 * Still OFF at checkout and on a claim page, where it would only pull a
	 * buyer out of a purchase they haven't placed yet. The caller also passes
	 * false for a store that opted out of the marketplace.
	 * Kept here at the foot, quiet, rather than as a Kedaipal mark at the top:
	 * the top of a storefront is the seller's brand, and a header logo would
	 * walk their own buyers to competitors first (Zaki, 1 Oct 2026).
	 */
	discover?: boolean;
	/** The store's language. Only the order page localises its chrome, so
	 * only it passes one; every other buyer page reads English. */
	locale?: Locale;
}) {
	return (
		<footer
			// One rhythm on every buyer page — store home, category, product,
			// checkout, order page and claim page all render this identically. It
			// briefly took a `compact` prop for the pages ending in a bottom CTA
			// bar, on the theory that the bar's own border already separated the
			// badge; that only held while those bars were `position: sticky` and
			// sat in flow directly under it. They're `fixed` now (so the badge is
			// ordinary page content above a floating bar, exactly like the store
			// home) and the tighter spacing just read as inconsistent.
			//
			// `mt-auto` anchors the badge to the BOTTOM of the page on short
			// pages — it only works while this <footer> is a DIRECT flex child of
			// the route's `min-h-dvh flex-col` container. Don't wrap it in a
			// breakpoint div: the wrapper becomes the flex child and the margin
			// silently stops applying (that regression shipped once already).
			className="mt-auto px-5 pb-6 pt-8 lg:px-8"
		>
			{discover ? (
				<div className="mb-5 flex justify-center">
					<Link
						to="/stores"
						className="group inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/10 hover:text-accent-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
					>
						{locale === "ms"
							? "Terokai lebih banyak kedai di Kedaipal"
							: "Discover more stores on Kedaipal"}
						<ArrowRight
							aria-hidden
							className="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
						/>
					</Link>
				</div>
			) : null}
			<div className="flex justify-center">
				<a
					href={poweredByHref(surface, slug)}
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
