import { Link } from "@tanstack/react-router";
import type { MarketplaceStoreCard } from "../../../convex/marketplace";
import { SectionHeading } from "../storefront/section-heading";
import { StoreLogoTile } from "../storefront/storefront-header";
import { CARD_INTERACTION_CLASS, FoundingEmblemInline } from "./store-card";

/**
 * "The Founding 10" shelf (z8r3fdkmyp) — the first stores on Kedaipal, in
 * rank order, each with the founding emblem and its number. Horizontal
 * scroll on mobile (peek says "there's more"), a flat grid on desktop.
 * Renders nothing when the region has no founding stores — an empty shelf
 * with a grand name would be worse than none — and so owns its own top
 * margin (`className`): a wrapper's margin would outlive the shelf and leave
 * a dangling gap above "All stores".
 */
export function FoundingShelf({
	stores,
	className = "",
	railClassName,
}: {
	stores: MarketplaceStoreCard[];
	className?: string;
	/** The page's shared snapping-rail classes (gutter + scroll-padding). */
	railClassName: string;
}) {
	if (stores.length === 0) return null;
	return (
		<section className={`flex flex-col gap-3 ${className}`}>
			<div className="px-5 lg:px-8">
				<SectionHeading
					title="The Founding 10"
					context="The first stores on Kedaipal"
				/>
			</div>
			<ul
				className={`${railClassName} gap-2.5 lg:grid lg:grid-cols-5 lg:overflow-visible`}
			>
				{stores.map((card) => (
					<li key={card.slug} className="w-36 shrink-0 snap-start lg:w-auto">
						<Link
							to="/$slug"
							params={{ slug: card.slug }}
							className={`flex h-full flex-col items-center gap-2 rounded-2xl border border-border bg-card px-2.5 py-4 text-center ${CARD_INTERACTION_CLASS}`}
						>
							<StoreLogoTile
								storeName={card.storeName}
								logoUrl={card.logoUrl}
								size="card"
							/>
							{/* The rank is visible text beside the emblem, so the emblem's
							    own name stays rank-less — a reader hears it once. */}
							<span className="flex items-center gap-1">
								<FoundingEmblemInline size="md" />
								<span className="text-xs font-extrabold">
									#{card.foundingMemberRank}
								</span>
							</span>
							<span className="line-clamp-2 text-[13px] font-bold leading-[1.3]">
								{card.storeName}
							</span>
							{card.storeArea ? (
								<span className="max-w-full truncate text-[11px] text-muted-foreground">
									{card.storeArea}
								</span>
							) : null}
						</Link>
					</li>
				))}
			</ul>
		</section>
	);
}
