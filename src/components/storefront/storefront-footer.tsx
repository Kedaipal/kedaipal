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
		<footer className="mt-auto px-5 pb-6 pt-8 lg:px-8">
			<div className="flex justify-center">
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
					<img
						src="/poster/kedaipal-lockup.svg"
						alt="Kedaipal"
						className="h-5 w-auto"
					/>
				</a>
			</div>
		</footer>
	);
}
