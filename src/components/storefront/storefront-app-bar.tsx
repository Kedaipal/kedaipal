import { Link } from "@tanstack/react-router";
import { ArrowLeft, Share2 } from "lucide-react";
import { shareLink } from "../../lib/share";
import { FoundingMemberBadge } from "./founding-member-badge";
import { hasHoursLine, OpeningHoursLine } from "./opening-hours-line";
import {
	StoreLogoTile,
	type StorefrontHeaderRetailer,
} from "./storefront-header";

/**
 * The compact storefront subpage header (z8r3fdegb5) — category, product and
 * checkout pages render this instead of the full cover hero, so a buyer
 * opening a shared deep link sees what they came for on the first screen
 * (the cover cost 176px before anything they tapped the link for).
 *
 * Anatomy: a 44px back button (this bar OWNS "back" — the old "← All
 * products" text links below the header are gone), the store's 32px logo
 * tile + name + founding badge + live hours line as one tappable block that
 * also leads home, and a 44px share icon for the page's canonical URL (the
 * OS share sheet on mobile — the WhatsApp path — clipboard elsewhere).
 *
 * Not sticky, deliberately: the category page's search-and-chips bar (T3)
 * sticks to `top-0`, and two competing sticky bars would stack into an
 * inch of chrome on a phone.
 */
export function StorefrontAppBar({
	retailer,
	slug,
	backToProductSlug,
	shareUrl,
}: {
	retailer: StorefrontHeaderRetailer;
	/** Store slug — the back button's and identity block's destination. */
	slug: string;
	/**
	 * When the page sits UNDER a product (the booking request flow), back
	 * leads to that listing rather than the store home — one back control
	 * per screen, pointing one level up.
	 */
	backToProductSlug?: string;
	/** The page's canonical URL for the share icon. Defaults to the store
	 * home — pass the category/product URL so the buyer shares the page
	 * they're on, not just the store. */
	shareUrl?: string;
}) {
	const backLabel = backToProductSlug
		? "Back to the listing"
		: `Back to ${retailer.storeName}`;
	return (
		<header className="border-b border-border bg-background">
			<div className="mx-auto flex h-14 max-w-6xl items-center gap-0.5 px-1.5 lg:h-16 lg:px-4">
				{backToProductSlug ? (
					<Link
						to="/$slug/p/$productSlug"
						params={{ slug, productSlug: backToProductSlug }}
						aria-label={backLabel}
						className="tap-target flex items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
					>
						<ArrowLeft className="size-5" aria-hidden />
					</Link>
				) : (
					<Link
						to="/$slug"
						params={{ slug }}
						activeOptions={{ exact: true }}
						aria-label={backLabel}
						className="tap-target flex items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
					>
						<ArrowLeft className="size-5" aria-hidden />
					</Link>
				)}
				{/* Identity is a plain block, not a link: the badge (popover) and
				    hours line (dialog) are buttons of their own, and nesting them
				    in a link would be interactive-inside-interactive. The back
				    button beside it owns the way home. */}
				<div className="flex min-w-0 flex-1 items-center gap-2.5 py-1">
					<StoreLogoTile
						storeName={retailer.storeName}
						logoUrl={retailer.logoUrl}
						size="bar"
					/>
					<span className="flex min-w-0 flex-col gap-0.5">
						<span className="flex min-w-0 items-center gap-1.5">
							<span className="truncate font-heading text-sm font-extrabold leading-tight tracking-tight">
								{retailer.storeName}
							</span>
							{retailer.isFoundingMember ? (
								<FoundingMemberBadge
									rank={retailer.foundingMemberRank}
									size="sm"
								/>
							) : null}
						</span>
						{hasHoursLine(retailer.openingHours, retailer.closedDates) ? (
							<OpeningHoursLine
								hours={retailer.openingHours}
								closedDates={retailer.closedDates}
								onCover={false}
								variant="bar"
							/>
						) : null}
					</span>
				</div>
				<button
					type="button"
					onClick={() => void shareLink(shareUrl ?? `/${slug}`)}
					aria-label="Share this page"
					className="tap-target flex items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
				>
					<Share2 className="size-5" aria-hidden />
				</button>
			</div>
		</header>
	);
}
