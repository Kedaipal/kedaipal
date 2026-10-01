import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { isNewStore } from "../../../convex/lib/marketplaceListing";
import type { MarketplaceStoreCard } from "../../../convex/marketplace";
import { cardOpenStatus } from "../../lib/marketplace";
import { StoreLogoTile } from "../storefront/storefront-header";
import { AppImage } from "../ui/app-image";

/**
 * The marketplace directory's store card (z8r3fdkmyp) — two layouts, ONE
 * component, because they are the same idea: `row` is the mobile all-stores
 * list (tile · name/blurb/status · chevron), `grid` is the desktop 4-up card.
 * The sponsored highlight rail has its own component (`SponsoredCard`) — a
 * cover-image card is a different shape, not a variant of this one.
 */

/**
 * The founding emblem as a plain image, NOT the storefront's popover button:
 * the whole card is a link, and a button nested inside a link is broken
 * interaction (and invalid markup). The emblem still names itself for screen
 * readers; the story behind it lives on the storefront the tap opens.
 *
 * Navy on light, mint on dark — the storefront badge's own swap, so the
 * emblem never vanishes into a dark card. One author for every directory
 * surface (row, grid, highlight card, Founding shelf): `sm` beside a name,
 * `md` as the shelf's rank mark.
 */
export function FoundingEmblemInline({
	rank,
	size = "sm",
}: {
	/** Folded into the accessible name — omit where the rank is visible text. */
	rank?: number;
	size?: "sm" | "md";
}) {
	const alt = `Founding Member${rank ? ` #${rank}` : ""}`;
	const aspect =
		size === "md" ? "h-[18px] w-auto shrink-0" : "h-3.5 w-auto shrink-0";
	return (
		<>
			<AppImage
				src="/img/badges/founding-badge-navy.png"
				alt={alt}
				aspect={aspect}
				className="dark:hidden"
				fill={false}
			/>
			{/* Same name on both: whichever is display:none drops out of the
			    accessibility tree, so the visible one must always carry it. */}
			<AppImage
				src="/img/badges/founding-badge-mint.png"
				alt={alt}
				aspect={aspect}
				className="hidden dark:block"
				fill={false}
			/>
		</>
	);
}

/** "New" chip — mint tint, mirrors the storefront's accent chip language. */
function NewChip() {
	return (
		<span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10.5px] font-bold text-accent-emphasis">
			New
		</span>
	);
}

/**
 * The live one-line status + area ("● Open now · Ampang, KL"). Mint dot when
 * open; the closed/paused states speak in muted text. `suppressHydrationWarning`
 * for the same reason as the storefront hours line — the text depends on the
 * wall clock, and SSR vs hydration can straddle a minute boundary.
 */
export function StoreStatusLine({
	card,
	now,
}: {
	card: MarketplaceStoreCard;
	now: number;
}) {
	const status = cardOpenStatus(card, now);
	return (
		<span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-tight">
			<span
				aria-hidden
				className={`size-1.5 shrink-0 rounded-full ${
					status.open ? "bg-accent" : "bg-muted-foreground/60"
				}`}
			/>
			<span
				suppressHydrationWarning
				className={`truncate ${
					status.open
						? "font-semibold text-accent-emphasis"
						: "text-muted-foreground"
				}`}
			>
				{status.label}
				{card.storeArea ? (
					<span className="font-normal text-muted-foreground">
						{" · "}
						{card.storeArea}
					</span>
				) : null}
			</span>
		</span>
	);
}

export function StoreCard({
	card,
	variant,
	now,
}: {
	card: MarketplaceStoreCard;
	variant: "row" | "grid";
	now: number;
}) {
	const isNew = isNewStore(card.createdAt, now);
	const nameRow = (
		<span className="flex min-w-0 items-center gap-1.5">
			<span className="truncate text-[14.5px] font-bold">{card.storeName}</span>
			{card.isFoundingMember ? (
				<FoundingEmblemInline rank={card.foundingMemberRank} />
			) : null}
			{isNew ? <NewChip /> : null}
		</span>
	);

	if (variant === "row") {
		return (
			<Link
				to="/$slug"
				params={{ slug: card.slug }}
				className="flex min-h-[44px] items-center gap-3 px-5 py-3.5 transition-colors hover:bg-muted/40 lg:px-8"
			>
				<StoreLogoTile
					storeName={card.storeName}
					logoUrl={card.logoUrl}
					size="card"
				/>
				<span className="flex min-w-0 grow flex-col gap-0.5">
					{nameRow}
					{card.storeDescription ? (
						<span className="truncate text-xs text-muted-foreground">
							{card.storeDescription}
						</span>
					) : null}
					<StoreStatusLine card={card} now={now} />
				</span>
				<ChevronRight aria-hidden className="size-4 shrink-0 text-border" />
			</Link>
		);
	}

	return (
		<Link
			to="/$slug"
			params={{ slug: card.slug }}
			className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4 transition-shadow hover:shadow-md"
		>
			<span className="flex items-center gap-2.5">
				<StoreLogoTile
					storeName={card.storeName}
					logoUrl={card.logoUrl}
					size="card"
				/>
				{nameRow}
			</span>
			{/* Fixed two-line zone so sibling cards stay the same height whether a
			    store wrote one word or the full cap (design-system §cards). */}
			<span className="line-clamp-2 min-h-[2.25rem] text-[12.5px] leading-[1.45] text-muted-foreground">
				{card.storeDescription ?? ""}
			</span>
			<StoreStatusLine card={card} now={now} />
		</Link>
	);
}
