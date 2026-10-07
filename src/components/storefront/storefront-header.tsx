import { Share2 } from "lucide-react";
import type { ClosedDateRange } from "../../../convex/lib/closedDates";
import type { OpeningHours } from "../../../convex/lib/openingHours";
import { shareLink } from "../../lib/share";
import { AppImage } from "../ui/app-image";
import { FoundingMemberBadge } from "./founding-member-badge";
import { hasHoursLine, OpeningHoursLine } from "./opening-hours-line";

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
	/** Closed dates (z8r3fdhpm7) — "Closed today · Hari Raya" on the day and a
	 * heads-up for one starting soon, even on a 24/7 store. */
	closedDates?: ClosedDateRange[];
}

/** "Kek Sayang Bakery" → "KS" — the logo tile's fallback when a store has no
 * uploaded logo, so the brand block never renders a hole. Array.from keeps a
 * leading emoji/CJK character whole. */
export function storeInitials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	const initials =
		words.length >= 2
			? `${Array.from(words[0])[0]}${Array.from(words[1])[0]}`
			: Array.from(words[0] ?? "")
					.slice(0, 2)
					.join("");
	return initials.toUpperCase();
}

/**
 * The store's square logo tile — the uploaded logo when there is one, the
 * store's initials otherwise (a hole where the brand should be reads as
 * broken, and the initials tile is what the seller sees in the mock).
 * Three sizes: 56px in the store-home hero, 32px in the subpage app bar, and
 * 48px on the marketplace directory's store cards (z8r3fdkmyp) — one author
 * so a store's brand block looks the same wherever a card carries it.
 */
export function StoreLogoTile({
	storeName,
	logoUrl,
	size,
	onCover = false,
}: {
	storeName: string;
	logoUrl?: string | null;
	size: "hero" | "bar" | "card";
	onCover?: boolean;
}) {
	if (size === "card") {
		return logoUrl ? (
			<AppImage
				src={logoUrl}
				alt={`${storeName} logo`}
				aspect="size-12 shrink-0"
				sizes="48px"
				rounded="rounded-[14px]"
				objectFit="contain"
				className="border border-border bg-background"
			/>
		) : (
			<span
				aria-hidden
				className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-primary text-[15px] font-extrabold text-primary-foreground"
			>
				{storeInitials(storeName)}
			</span>
		);
	}

	if (size === "bar") {
		return logoUrl ? (
			<AppImage
				src={logoUrl}
				alt={`${storeName} logo`}
				aspect="size-8 shrink-0"
				sizes="32px"
				rounded="rounded-[10px]"
				objectFit="contain"
				className="border border-border bg-background"
			/>
		) : (
			<span
				aria-hidden
				className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-primary text-[11px] font-extrabold text-primary-foreground"
			>
				{storeInitials(storeName)}
			</span>
		);
	}

	const heroFrame = onCover
		? "border-white/80 shadow-lg"
		: "border-accent/20 shadow-sm";
	return logoUrl ? (
		<AppImage
			src={logoUrl}
			alt={`${storeName} logo`}
			aspect="size-14 shrink-0"
			sizes="56px"
			rounded="rounded-[18px]"
			objectFit="contain"
			className={`border-2 bg-background ${heroFrame}`}
		/>
	) : (
		<span
			aria-hidden
			className={`flex size-14 shrink-0 items-center justify-center rounded-[18px] border-2 bg-background text-lg font-extrabold text-foreground ${heroFrame}`}
		>
			{storeInitials(storeName)}
		</span>
	);
}

/**
 * The storefront's brand header — the store-home hero. Cover image as the
 * background (a primary-tinted, bottom-weighted scrim keeps text legible),
 * store logo (or initials tile), name with the founding badge beside it,
 * blurb, and the live opening-hours pill.
 *
 * Since the UI-polish pass (z8r3fdegb5) this full cover block renders ONLY on
 * the store home — every subpage (category, product, checkout) carries the
 * compact `StorefrontAppBar` instead, so a buyer landing on a shared deep
 * link reaches what they came for on the first screen. The Kedaipal mark left
 * the hero in the same pass: the footer already carries "Powered by".
 */
export function StorefrontHeader({
	retailer,
	slug,
}: {
	retailer: StorefrontHeaderRetailer;
	/** Store slug — enables the desktop "Share store" chip (the URL it
	 * shares). Mobile keeps the hero clean; subpages share via the app bar. */
	slug?: string;
}) {
	const hasCover = !!retailer.coverImageUrl;

	return (
		<header
			className={
				hasCover
					? "relative flex min-h-[10.5rem] flex-col justify-end overflow-hidden px-5 pb-5 pt-6 lg:min-h-[12.5rem] lg:rounded-b-3xl lg:px-8 lg:pb-6"
					: "relative flex flex-col justify-end bg-gradient-to-b from-accent/10 to-background px-5 pb-6 pt-9 lg:rounded-b-3xl lg:px-8 lg:pb-7"
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
					{/* Primary-tinted scrim (z8r3fdegb5) — heavier at the base where
					    the text sits, near-clear at the top so the photo reads. */}
					<div
						aria-hidden
						className="absolute inset-0 bg-gradient-to-t from-primary/90 via-primary/45 to-primary/15"
					/>
				</>
			) : null}
			{slug ? (
				// Desktop-only "Share store" — sellers drop the link in chats; on
				// mobile the OS share sheet lives in the subpage app bar and the
				// hero stays clean (per the design).
				<button
					type="button"
					onClick={() => void shareLink(`/${slug}`)}
					className={`absolute right-5 top-5 hidden h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition-colors lg:inline-flex lg:right-8 ${
						hasCover
							? "border border-white/25 bg-primary/60 text-white backdrop-blur hover:bg-primary/75"
							: "border border-border bg-card text-foreground hover:bg-muted"
					}`}
				>
					<Share2 className="size-3.5" aria-hidden />
					Share store
				</button>
			) : null}
			{/* items-center, not items-end: the text column (name + blurb + pill)
			    is ~2× the logo's height, so bottom-aligning floated the name into
			    the sky while the logo hugged the floor — centring keeps the whole
			    identity reading as one block. gap-2 rhythm inside the column: the
			    mock's ~6px stack read cramped (Zaki, 28 Sep). */}
			<div
				className={`flex items-center gap-3.5 ${hasCover ? "relative" : ""}`}
			>
				<StoreLogoTile
					storeName={retailer.storeName}
					logoUrl={retailer.logoUrl}
					size="hero"
					onCover={hasCover}
				/>
				<div className="flex min-w-0 flex-col gap-2">
					{/* A <div>, not a <span>: it wraps the <h1>, and flow content
					    inside a phrasing element is an invalid content model. */}
					<div className="flex items-center gap-2">
						{/* The store home is *about* the store, so the name is the
						    page's <h1> — subpages name their own subject and carry the
						    compact app bar instead (see StorefrontAppBar). Wraps rather
						    than truncates: this is the one page whose job is the name. */}
						<h1
							className={`min-w-0 text-[22px] font-bold leading-tight tracking-tight lg:text-3xl ${
								hasCover ? "text-white drop-shadow-md" : ""
							}`}
						>
							{retailer.storeName}
						</h1>
						{retailer.isFoundingMember ? (
							<FoundingMemberBadge
								rank={retailer.foundingMemberRank}
								onCover={hasCover}
							/>
						) : null}
					</div>
					{retailer.storeDescription ? (
						// Seller's own blurb wins over the generic tagline. Plain text
						// (escaped by React), newlines preserved, clamped to keep the
						// header tidy. No empty block when unset.
						<p
							className={`line-clamp-2 whitespace-pre-line text-[13px] leading-snug ${
								hasCover ? "text-white/90 drop-shadow" : "text-muted-foreground"
							}`}
						>
							{retailer.storeDescription}
						</p>
					) : (
						<p
							className={`text-[13px] leading-snug ${hasCover ? "text-white/90 drop-shadow" : "text-muted-foreground"}`}
						>
							Browse &amp; order on WhatsApp
						</p>
					)}
					{hasHoursLine(retailer.openingHours, retailer.closedDates) ? (
						// Live open/closed status + tap-for-weekly-schedule
						// (86eyp5rav). Only stores that configured hours — or have
						// a closed date running or coming up (z8r3fdhpm7) — show
						// it; the 24/7 default stays clutter-free.
						<OpeningHoursLine
							hours={retailer.openingHours}
							closedDates={retailer.closedDates}
							onCover={hasCover}
						/>
					) : null}
				</div>
			</div>
		</header>
	);
}
