import { AppImage } from "../ui/app-image";

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
export function StorefrontFooter({
	/** Tighter vertical rhythm for pages that end in a bordered sticky bar
	 * (checkout, product) — the bar's own edge already separates the footer,
	 * so the browse pages' generous top gap just reads as dead space there. */
	compact = false,
	/** Drop the footer's own horizontal padding — for when it's nested inside
	 * a container that already supplies it (the mobile sticky CTA bar, which
	 * has its own `px-5`). Nesting there, instead of leaving this footer as a
	 * page-level sibling, is what makes the compact footer's spacing zero-gap
	 * on mobile: a `position: sticky` bar can render pinned to the viewport's
	 * visual bottom well before scrolling reaches the document's true end, so
	 * ANY content placed after it as a separate sibling shows a phantom gap
	 * until that exact scroll position (worse on real phones, where the
	 * address bar's show/hide resizes the dynamic viewport mid-scroll). Once
	 * the footer is a child of the sticky box instead, there is no "after" to
	 * fall out of sync with — see checkout-form.tsx / product-page.tsx. */
	edgeToEdge = false,
}: {
	compact?: boolean;
	edgeToEdge?: boolean;
} = {}) {
	return (
		<footer
			className={`mt-auto ${edgeToEdge ? "" : "px-5 lg:px-8"} ${compact ? "pb-4 pt-4" : "pb-6 pt-8"}`}
		>
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
