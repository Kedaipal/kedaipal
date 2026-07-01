import { Award } from "lucide-react";

/**
 * Public storefront badge shown on kedaipal.com/<slug> for a Founding Member.
 * Reads the denormalized `isFoundingMember` flag (public-safe). Subscription
 * state is never exposed to shoppers. See docs/manual-subscription.md.
 *
 * Visual: Midnight Mint theme via semantic tokens — `accent` is mint (#10B981
 * in light) and flips to bright mint with a navy foreground in dark mode, so
 * this single pill is the "mint default / navy variant for dark backgrounds"
 * Kris specified. Styling matches the landing founding banner's accent Sticker
 * (`bg-accent text-accent-foreground`) so the cohort reads consistently across
 * the landing page and the storefront.
 *
 * TODO(design): swap the typographic pill for Kris's supplied artwork once the
 * files land in the repo — full set (Detail + Plain, mint + navy) lives in the
 * workspace at 10_Assets/kedaipal-assets/Badges/. Drop them under
 * public/img/badges/ and render an <img> here; keep the `rank` suffix. See
 * ClickUp 86exrhptc.
 */
export function FoundingMemberBadge({ rank }: { rank?: number }) {
	return (
		<span className="inline-flex w-fit items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground shadow-sm shadow-accent/25">
			<Award className="size-3.5" aria-hidden="true" />
			Founding Member{rank ? ` #${rank}` : ""}
		</span>
	);
}
