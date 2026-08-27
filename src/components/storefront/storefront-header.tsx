import type { OpeningHours } from "../../../convex/lib/openingHours";
import { AppImage } from "../ui/app-image";
import { FoundingMemberBadge } from "./founding-member-badge";
import { OpeningHoursLine } from "./opening-hours-line";

/** The public-safe retailer fields the header renders — a structural subset of
 * `getRetailerBySlug`'s payload so both the home and category routes can pass
 * their live query result straight through. */
export interface StorefrontHeaderRetailer {
	storeName: string;
	storeDescription?: string;
	coverImageUrl?: string | null;
	logoUrl?: string | null;
	isFoundingMember?: boolean;
	foundingMemberRank?: number;
	/** Store opening hours (86eyp5rav) — renders the live "Open now / Closed"
	 * line + weekly schedule. Undefined (open 24/7) renders nothing. */
	openingHours?: OpeningHours;
}

/**
 * The storefront's brand header — Kedaipal mark, optional cover image as the
 * background (bottom-weighted scrim keeps text legible), store logo, name,
 * founding badge and blurb. Shared by the store home, the nested category
 * pages, the product page and checkout so the look and feel is identical
 * everywhere a buyer lands.
 */
export function StorefrontHeader({
	retailer,
	asPageHeading = true,
}: {
	retailer: StorefrontHeaderRetailer;
	/**
	 * Whether the store name is this page's `<h1>`. True on the store home,
	 * where the store IS the page. False on every subpage (category, product,
	 * checkout), which names its own subject in an `<h1>` — the brand block is
	 * chrome there, so marking it up as the heading too would both duplicate
	 * the same `<h1>` across every page in the store and give the page two of
	 * them. Purely semantic: the rendered text is styled identically.
	 */
	asPageHeading?: boolean;
}) {
	const hasCover = !!retailer.coverImageUrl;
	const StoreName = asPageHeading ? "h1" : "p";

	return (
		<header
			className={
				hasCover
					? "relative flex min-h-[11rem] flex-col justify-between overflow-hidden px-5 pb-5 pt-6 lg:min-h-[15rem] lg:rounded-b-3xl lg:px-8 lg:pb-7 lg:pt-8"
					: "flex flex-col gap-4 bg-gradient-to-b from-accent/10 to-background px-5 pb-6 pt-10 lg:rounded-b-3xl lg:px-8 lg:pb-8"
			}
		>
			{hasCover ? (
				<>
					{/* LCP candidate — the loader preloads this URL and the head()
					    <link rel="preload"> only pays off if this instance is eager. */}
					<AppImage
						src={retailer.coverImageUrl}
						alt={`${retailer.storeName} cover`}
						aspect="absolute inset-0"
						priority
						// Full-bleed banner: it genuinely wants the widest candidate
						// on desktop, so this is the one surface that should reach
						// for 1280.
						sizes="100vw"
					/>
					<div
						aria-hidden
						className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/20"
					/>
				</>
			) : null}
			<AppImage
				src={hasCover ? "/logo-dark.svg" : "/logo-3.svg"}
				alt="Kedaipal"
				aspect="h-5 w-auto"
				fill={false}
				className={hasCover ? "opacity-95 drop-shadow" : undefined}
				priority
			/>
			<div
				className={`flex gap-4 ${hasCover ? "relative items-end" : "items-center"}`}
			>
				{retailer.logoUrl ? (
					<AppImage
						src={retailer.logoUrl}
						alt={`${retailer.storeName} logo`}
						aspect="h-16 w-16 shrink-0"
						sizes="64px"
						rounded="rounded-2xl"
						objectFit="contain"
						className={`border-2 bg-background ${
							hasCover
								? "border-white/80 shadow-lg"
								: "border-accent/20 shadow-sm"
						}`}
					/>
				) : null}
				<div className="flex flex-col gap-1">
					<StoreName
						className={`text-2xl font-bold leading-tight tracking-tight ${
							hasCover ? "text-white drop-shadow-md" : ""
						}`}
					>
						{retailer.storeName}
					</StoreName>
					{retailer.isFoundingMember ? (
						<FoundingMemberBadge
							rank={retailer.foundingMemberRank}
							onCover={hasCover}
						/>
					) : null}
					{retailer.storeDescription ? (
						// Seller's own blurb wins over the generic tagline. Plain text
						// (escaped by React), newlines preserved, clamped to keep the
						// header tidy. No empty block when unset.
						<p
							className={`line-clamp-2 whitespace-pre-line text-sm ${
								hasCover ? "text-white/90 drop-shadow" : "text-muted-foreground"
							}`}
						>
							{retailer.storeDescription}
						</p>
					) : (
						<p
							className={`text-sm ${hasCover ? "text-white/90 drop-shadow" : "text-muted-foreground"}`}
						>
							Browse &amp; order on WhatsApp
						</p>
					)}
					{retailer.openingHours ? (
						// Live open/closed status + tap-for-weekly-schedule
						// (86eyp5rav). Only stores that configured hours show it —
						// the 24/7 default stays clutter-free.
						<OpeningHoursLine
							hours={retailer.openingHours}
							onCover={hasCover}
						/>
					) : null}
				</div>
			</div>
		</header>
	);
}
