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
}: {
	/** The store whose page this is. Omit only where none is in scope yet
	 * (a loading skeleton, a not-found page for an unknown slug). */
	slug?: string;
	/** Which buyer surface the badge sits on — picks the `?src=` tag. */
	surface?: PoweredBySurface;
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
					<AppImage
						src="/poster/kedaipal-lockup.svg"
						alt="Kedaipal"
						aspect="h-5 w-auto"
						fill={false}
					/>
				</a>
			</div>
		</footer>
	);
}
