import { FoundingMemberBadge } from "./founding-member-badge";

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
}

/**
 * The storefront's brand header — Kedaipal mark, optional cover image as the
 * background (bottom-weighted scrim keeps text legible), store logo, name,
 * founding badge and blurb. Shared by the store home AND the nested category
 * pages so the look and feel is identical everywhere a buyer lands.
 */
export function StorefrontHeader({
	retailer,
}: {
	retailer: StorefrontHeaderRetailer;
}) {
	const hasCover = !!retailer.coverImageUrl;

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
					<img
						src={retailer.coverImageUrl ?? undefined}
						alt={`${retailer.storeName} cover`}
						className="absolute inset-0 h-full w-full object-cover"
					/>
					<div
						aria-hidden
						className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/20"
					/>
				</>
			) : null}
			<img
				src={hasCover ? "/logo-dark.svg" : "/logo-3.svg"}
				alt="Kedaipal"
				className={
					hasCover ? "relative h-5 w-auto opacity-95 drop-shadow" : "h-5 w-auto"
				}
			/>
			<div
				className={`flex gap-4 ${hasCover ? "relative items-end" : "items-center"}`}
			>
				{retailer.logoUrl ? (
					<img
						src={retailer.logoUrl}
						alt={`${retailer.storeName} logo`}
						className={`h-16 w-16 shrink-0 rounded-2xl border-2 bg-background object-contain ${
							hasCover
								? "border-white/80 shadow-lg"
								: "border-accent/20 shadow-sm"
						}`}
					/>
				) : null}
				<div className="flex flex-col gap-1">
					<h1
						className={`text-2xl font-bold leading-tight tracking-tight ${
							hasCover ? "text-white drop-shadow-md" : ""
						}`}
					>
						{retailer.storeName}
					</h1>
					{retailer.isFoundingMember ? (
						<FoundingMemberBadge rank={retailer.foundingMemberRank} />
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
				</div>
			</div>
		</header>
	);
}
