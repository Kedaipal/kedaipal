/**
 * Public storefront badge shown on kedaipal.com/<slug> for a Founding Member.
 * Reads the denormalized `isFoundingMember` flag (public-safe). Subscription
 * state is never exposed to shoppers. See docs/manual-subscription.md.
 *
 * Visual: Kris's "Plain" badge artwork (speech-bubble emblem with a mint star).
 * Two colour variants ship so the emblem always contrasts with the storefront
 * header — the navy badge is the default for light backgrounds, and the mint
 * badge swaps in under `.dark`. The "Founding Member" label rides alongside the
 * emblem on purpose: the artwork alone doesn't tell a shopper what it means, and
 * a hover tooltip wouldn't surface on mobile (our hard requirement). The visible
 * label also carries the meaning for screen readers, so the images are marked
 * decorative. See ClickUp 86exrhptc.
 *
 * `onCover`: when the header sits on a seller's cover image, the badge rides the
 * same light-on-scrim treatment as the store name and blurb (white label + the
 * mint emblem, which reads on the dark scrim regardless of theme) so it can't
 * wash out on a dark cover — the bug the theme-only variants left behind. See
 * StorefrontHeader + ClickUp 86eycww5z.
 */
export function FoundingMemberBadge({
	rank,
	onCover = false,
}: {
	rank?: number;
	onCover?: boolean;
}) {
	const label = `Founding Member${rank ? ` #${rank}` : ""}`;

	if (onCover) {
		return (
			<span className="inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-white drop-shadow">
				{/* Mint emblem reads against the header scrim regardless of theme. */}
				<img
					src="/img/badges/founding-badge-mint.png"
					alt=""
					aria-hidden="true"
					className="h-7 w-auto"
				/>
				{label}
			</span>
		);
	}

	return (
		<span className="inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-foreground">
			{/* Navy on light, mint on dark — always reads against the header. */}
			<img
				src="/img/badges/founding-badge-navy.png"
				alt=""
				aria-hidden="true"
				className="h-7 w-auto dark:hidden"
			/>
			<img
				src="/img/badges/founding-badge-mint.png"
				alt=""
				aria-hidden="true"
				className="hidden h-7 w-auto dark:block"
			/>
			{label}
		</span>
	);
}
