import { AppImage } from "../ui/app-image";

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
 */
export function FoundingMemberBadge({ rank }: { rank?: number }) {
	return (
		<span className="inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-foreground">
			{/* Navy on light, mint on dark — always reads against the header. The
			    visible "Founding Member" label carries the meaning for screen
			    readers, so both artwork variants stay decorative (empty alt). */}
			<AppImage
				src="/img/badges/founding-badge-navy.png"
				alt=""
				aspect="h-7 w-auto"
				className="dark:hidden"
				fill={false}
				priority
			/>
			<AppImage
				src="/img/badges/founding-badge-mint.png"
				alt=""
				aspect="h-7 w-auto"
				className="hidden dark:block"
				fill={false}
				priority
			/>
			Founding Member{rank ? ` #${rank}` : ""}
		</span>
	);
}
