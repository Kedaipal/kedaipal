/**
 * "Powered by Kedaipal" storefront footer badge (ticket 86ey8zh3r).
 *
 * A quiet, always-on growth surface on every kedaipal.com/<slug> page: a small
 * Kedaipal logomark + wordmark linking to the marketing site. Deliberately
 * understated (muted text, small mark) so it never competes with the retailer's
 * own brand — the on-page twin of the "Powered by Kedaipal" line on WhatsApp
 * order confirmations. No retailer toggle: universal or the loop doesn't
 * compound.
 *
 * The `?src=storefront_badge` tag is the repo's reserved PostHog attribution
 * convention (same as the poster QR `?src=` links) so the click path this badge
 * creates is measurable. Opens in a new tab so the buyer never loses the store.
 */
export function StorefrontFooter() {
	return (
		<footer className="mt-auto px-5 pb-4 pt-8 lg:px-8">
			<div className="flex justify-center border-t border-border/60 pt-6">
				<a
					href="https://kedaipal.com?src=storefront_badge"
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
				>
					<img
						src="/logo.svg"
						alt=""
						aria-hidden
						className="h-4 w-auto opacity-70"
					/>
					<span>
						Powered by <span className="font-semibold">Kedaipal</span>
					</span>
				</a>
			</div>
		</footer>
	);
}
