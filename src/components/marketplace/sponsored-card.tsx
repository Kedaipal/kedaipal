import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { MarketplaceStoreCard } from "../../../convex/marketplace";
import { storeInitials } from "../storefront/storefront-header";
import { AppImage } from "../ui/app-image";
import {
	CARD_INTERACTION_CLASS,
	FoundingEmblemInline,
	StoreStatusLine,
} from "./store-card";

/**
 * A "Store highlights" card (z8r3fdkmyp) — the marketplace's sponsored rail.
 * The one card shape that renders a cover image, with the store's brand tile
 * overlapping it, storefront-hero style. The "Sponsored" label is part of the
 * card's contract, not a decoration: every paid placement is disclosed where
 * the buyer sees it, so the rail can never read as organic ranking.
 *
 * No cover uploaded → the tile area falls back to a mint-tinted panel with an
 * oversized initials watermark — the same "initials stand in for the brand"
 * rule the logo tile already follows, scaled up.
 */
export function SponsoredCard({
	card,
	now,
	className = "",
}: {
	card: MarketplaceStoreCard;
	now: number;
	className?: string;
}) {
	return (
		<Link
			to="/$slug"
			params={{ slug: card.slug }}
			className={`group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm ${CARD_INTERACTION_CLASS} ${className}`}
		>
			<span className="relative block h-32 shrink-0 bg-accent/10">
				{card.coverImageUrl ? (
					<AppImage
						src={card.coverImageUrl}
						alt=""
						aspect="h-32 w-full"
						sizes="(min-width: 1024px) 360px, 90vw"
						objectFit="cover"
					/>
				) : (
					<span
						aria-hidden
						className="flex h-full w-full items-center justify-center font-heading text-[56px] font-extrabold text-foreground/10"
					>
						{storeInitials(card.storeName)}
					</span>
				)}
				<span className="absolute right-2.5 top-2.5 rounded-full bg-background/95 px-2.5 py-1 text-[11px] font-bold text-foreground shadow-sm">
					Sponsored
				</span>
			</span>
			<span className="relative flex flex-col gap-2.5 px-4 pb-4 pt-2.5">
				{/* Brand tile overlapping the cover — the storefront hero's own
				    composition, so a store's card and its page rhyme. */}
				<span
					aria-hidden
					className="absolute -top-7 left-4 flex size-14 items-center justify-center overflow-hidden rounded-[18px] border-[3px] border-card bg-primary font-heading text-lg font-extrabold text-primary-foreground shadow-sm"
				>
					{card.logoUrl ? (
						<AppImage
							src={card.logoUrl}
							alt=""
							aspect="size-full"
							sizes="56px"
							objectFit="contain"
							className="bg-background"
						/>
					) : (
						storeInitials(card.storeName)
					)}
				</span>
				<span className="ml-[4.25rem] flex min-h-10 flex-col justify-center">
					<span className="flex items-center gap-1.5">
						<span className="truncate font-heading text-[17px] font-extrabold">
							{card.storeName}
						</span>
						{card.isFoundingMember ? (
							<FoundingEmblemInline rank={card.foundingMemberRank} />
						) : null}
					</span>
					{card.storeArea ? (
						<span className="truncate text-xs text-muted-foreground">
							{card.storeArea}
						</span>
					) : null}
				</span>
				<span className="line-clamp-2 min-h-[2.4rem] text-[13px] leading-[1.45] text-foreground/80">
					{card.storeDescription ?? ""}
				</span>
				{/* gap-3 keeps the status off "Visit store" however long it runs;
				    the area is NOT repeated here — it's already under the name. */}
				<span className="flex items-center justify-between gap-3">
					<StoreStatusLine card={card} now={now} showArea={false} />
					<span className="flex shrink-0 items-center gap-1 text-[13px] font-bold text-accent-emphasis">
						Visit store
						<ArrowRight
							aria-hidden
							className="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
						/>
					</span>
				</span>
			</span>
		</Link>
	);
}
