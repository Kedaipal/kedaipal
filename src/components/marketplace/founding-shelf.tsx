import { Link } from "@tanstack/react-router";
import type { MarketplaceStoreCard } from "../../../convex/marketplace";
import { SectionHeading } from "../storefront/section-heading";
import { StoreLogoTile } from "../storefront/storefront-header";
import { AppImage } from "../ui/app-image";

/**
 * "The Founding 10" shelf (z8r3fdkmyp) — the first stores on Kedaipal, in
 * rank order, each with the founding emblem and its number. Horizontal
 * scroll on mobile (peek says "there's more"), a flat grid on desktop.
 * Renders nothing when the region has no founding stores — an empty shelf
 * with a grand name would be worse than none.
 */
export function FoundingShelf({ stores }: { stores: MarketplaceStoreCard[] }) {
	if (stores.length === 0) return null;
	return (
		<section className="flex flex-col gap-3">
			<div className="px-5 lg:px-8">
				<SectionHeading
					title="The Founding 10"
					context="The first stores on Kedaipal"
				/>
			</div>
			<ul className="flex snap-x gap-2.5 overflow-x-auto px-5 pb-1 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-8">
				{stores.map((card) => (
					<li key={card.slug} className="w-36 shrink-0 snap-start lg:w-auto">
						<Link
							to="/$slug"
							params={{ slug: card.slug }}
							className="flex h-full flex-col items-center gap-2 rounded-2xl border border-border bg-card px-2.5 py-4 text-center transition-shadow hover:shadow-md"
						>
							<StoreLogoTile
								storeName={card.storeName}
								logoUrl={card.logoUrl}
								size="card"
							/>
							<span className="flex items-center gap-1">
								<AppImage
									src="/img/badges/founding-badge-navy.png"
									alt="Founding Member"
									aspect="h-[18px] w-auto"
									fill={false}
								/>
								<span className="text-xs font-extrabold">
									#{card.foundingMemberRank}
								</span>
							</span>
							<span className="line-clamp-2 text-[13px] font-bold leading-[1.3]">
								{card.storeName}
							</span>
							{card.storeArea ? (
								<span className="truncate text-[11px] text-muted-foreground">
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
