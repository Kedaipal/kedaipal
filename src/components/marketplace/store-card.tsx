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

/**
 * The directory's one hover/focus treatment for a CARD (z8r3fdkmyp): a 2px
 * lift, the border warming to mint, and a soft mint glow beneath — enough to
 * say "this is the one you're on", quiet enough to scan past. Shared by the
 * grid card, the highlight card and the Founding card so the page has one
 * feel. Keyboard focus gets the same lift plus a ring (not hover-only). Pointer
 * `hover:` only fires on hover-capable devices, so touch never sticks lifted;
 * reduced-motion drops the movement and keeps the colour.
 */
export const CARD_INTERACTION_CLASS =
	"transition-[translate,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-[0_12px_30px_-12px_color-mix(in_oklab,var(--accent)_45%,transparent)] focus-visible:-translate-y-0.5 focus-visible:border-accent/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent/25 motion-reduce:transition-[box-shadow,border-color] motion-reduce:hover:translate-y-0 motion-reduce:focus-visible:translate-y-0";

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
	showArea = true,
}: {
	card: MarketplaceStoreCard;
	now: number;
	/** Off where the card already names the area elsewhere (the highlight
	 * card prints it under the store name) — saying it twice only crowds. */
	showArea?: boolean;
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
				{showArea && card.storeArea ? (
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
				className="group flex min-h-[44px] items-center gap-3 px-5 py-3.5 transition-colors hover:bg-accent/5 focus-visible:bg-accent/5 focus-visible:outline-none lg:px-8"
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
				<ChevronRight
					aria-hidden
					className="size-4 shrink-0 text-border transition-[translate,color] group-hover:translate-x-0.5 group-hover:text-accent-emphasis motion-reduce:transition-none"
				/>
			</Link>
		);
	}

	return (
		<Link
			to="/$slug"
			params={{ slug: card.slug }}
			className={`flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4 ${CARD_INTERACTION_CLASS}`}
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
