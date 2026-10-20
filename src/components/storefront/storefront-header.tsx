import { MessageCircle, Share2, Store, Truck } from "lucide-react";
import type { ClosedDateRange } from "../../../convex/lib/closedDates";
import type { Locale } from "../../../convex/lib/locale";
import type { OpeningHours } from "../../../convex/lib/openingHours";
import { shareLink } from "../../lib/share";
import { buildStoreChatLink } from "../../lib/store-chat";
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
	/** The island's "Ask on WhatsApp" action (z8r3fdvwcy): the store's own
	 * number, the owner's switch (absent = on) and the locale the prefill
	 * speaks. No number, or switched off → no action; Share stays. */
	waPhone?: string;
	storefrontChatEnabled?: boolean;
	locale?: Locale;
	/** The island's fulfilment fact — "Delivery & pickup · <area>" — from the
	 * methods the store has switched on (`offerDelivery` absent = on, the
	 * legacy default; `offerSelfCollect` absent = off) and the area line the
	 * seller wrote for the marketplace card. */
	offerDelivery?: boolean;
	offerSelfCollect?: boolean;
	storeArea?: string;
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
 * Three sizes: 64px (84px on `lg`) on the store-home island card, 32px in the
 * subpage app bar, and 48px on the marketplace directory's store cards
 * (z8r3fdkmyp) — one author so a store's brand block looks the same wherever
 * a card carries it.
 */
export function StoreLogoTile({
	storeName,
	logoUrl,
	size,
}: {
	storeName: string;
	logoUrl?: string | null;
	size: "hero" | "bar" | "card";
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
				// dark-ok: `bg-white`, not `bg-background` — this is one of the storefront's
				// object-contain user images, so the mat SHOWS. Seller logos are routinely
				// dark ink on transparent and would vanish into a dark mat; a white plate
				// matches every other user-supplied contain image (track page, billing,
				// order mockups).
				className="border border-border bg-white"
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
				// dark-ok: `bg-white`, not `bg-background` — this is one of the storefront's
				// object-contain user images, so the mat SHOWS. Seller logos are routinely
				// dark ink on transparent and would vanish into a dark mat; a white plate
				// matches every other user-supplied contain image (track page, billing,
				// order mockups).
				className="border border-border bg-white"
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

	// Island tile (z8r3fdvwcy): it sits ON the card, never on the photo, so
	// one frame serves both themes — a card-coloured border lifts it off the
	// island the way the mock's white hairline does, and `shadow-md` gives it
	// the small lift the mock draws under it.
	const islandFrame =
		"border-2 border-card shadow-md shadow-primary/15 dark:shadow-none";
	return logoUrl ? (
		<AppImage
			src={logoUrl}
			alt={`${storeName} logo`}
			aspect="size-16 shrink-0 lg:size-21"
			sizes="84px"
			rounded="rounded-[18px] lg:rounded-[22px]"
			objectFit="contain"
			// dark-ok: `bg-white`, not `bg-background` — this is one of the storefront's
			// object-contain user images, so the mat SHOWS. Seller logos are routinely
			// dark ink on transparent and would vanish into a dark mat; a white plate
			// matches every other user-supplied contain image (track page, billing,
			// order mockups).
			className={`bg-white ${islandFrame}`}
		/>
	) : (
		<span
			aria-hidden
			className={`flex size-16 shrink-0 items-center justify-center rounded-[18px] bg-primary font-heading text-xl font-extrabold tracking-tight text-primary-foreground lg:size-21 lg:rounded-[22px] lg:text-[26px] ${islandFrame}`}
		>
			{storeInitials(storeName)}
		</span>
	);
}

/** "Delivery & pickup" / "Delivery" / "Pickup" from the methods a store has
 * on, or null when it offers neither (a bookings-only store) — then the
 * facts block carries no fulfilment line rather than an empty one. */
export function fulfilmentLabel(
	retailer: Pick<
		StorefrontHeaderRetailer,
		"offerDelivery" | "offerSelfCollect"
	>,
): string | null {
	const delivery = retailer.offerDelivery !== false;
	const pickup = retailer.offerSelfCollect === true;
	if (delivery && pickup) return "Delivery & pickup";
	if (delivery) return "Delivery";
	if (pickup) return "Pickup";
	return null;
}

/** The two cover actions as 44px icon circles (z8r3fdvwcy) — frosted navy
 * over a photo so a white glyph reads whatever the picture is (never
 * lightened to match the outline, a pale sky would swallow it), outline on
 * the no-cover mint band. */
const COVER_ICON_BASE =
	"flex size-11 items-center justify-center rounded-full transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";
const COVER_ICON_FROSTED =
	"bg-primary/45 text-white ring-1 ring-white/25 backdrop-blur hover:bg-primary/60";
const COVER_ICON_OUTLINE =
	"border border-border bg-card text-foreground shadow-sm hover:bg-muted";

/** The desktop island's labelled actions — one outline pill shape for both,
 * 44px, so Share and Ask read as a pair. */
const ISLAND_ACTION =
	"inline-flex h-11 items-center gap-2 rounded-full border border-border bg-card px-4.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * The storefront's brand header — the store-home hero, as an ISLAND
 * (z8r3fdvwcy). The cover photo is a clean band with no text on it; a raised
 * card floats over its bottom edge carrying the identity (logo tile, name,
 * founding badge, blurb) and the facts a buyer reads at a glance (live hours,
 * a closure ahead, delivery & pickup · area). The two buyer actions — Ask on
 * WhatsApp and Share — sit as 44px icon circles at the cover's top-right on a
 * phone, and as a labelled row inside the island from `lg`. The cart pill is
 * the island family's other member; T2 adds the compact scrolled bar.
 *
 * Since the UI-polish pass (z8r3fdegb5) this full block renders ONLY on the
 * store home — every subpage (category, product, checkout) carries the
 * compact `StorefrontAppBar` instead, so a buyer landing on a shared deep
 * link reaches what they came for on the first screen. The Kedaipal mark
 * left the hero in the same pass: the footer already carries "Powered by".
 *
 * Everything here is static markup from the payload — no client state — so
 * SSR paints the island and the cover icons on the first byte.
 */
export function StorefrontHeader({
	retailer,
	slug,
}: {
	retailer: StorefrontHeaderRetailer;
	/** Store slug — enables the Share action (the URL it shares). Subpages
	 * share via the app bar. */
	slug?: string;
}) {
	const hasCover = !!retailer.coverImageUrl;
	const chatHref = buildStoreChatLink(retailer, retailer.locale ?? "en");
	const chatLabel = `Ask ${retailer.storeName} on WhatsApp`;
	const share = slug ? () => void shareLink(`/${slug}`) : null;
	const iconClass = `${COVER_ICON_BASE} ${hasCover ? COVER_ICON_FROSTED : COVER_ICON_OUTLINE}`;
	const showHours = hasHoursLine(retailer.openingHours, retailer.closedDates);
	const fulfilment = fulfilmentLabel(retailer);
	const hasFacts = showHours || fulfilment !== null;

	return (
		<header>
			{/* The cover band: 224px / 280px, photo only under a light scrim —
			    heavier at the top where the icons sit, near-clear through the
			    middle so the photo reads, a touch at the base so the island's
			    edge has something to lift off. `lg:rounded-b-3xl` as before. */}
			<div
				className={
					hasCover
						? "relative h-56 overflow-hidden bg-primary lg:h-70 lg:rounded-b-3xl"
						: "relative h-44 overflow-hidden bg-gradient-to-b from-accent/15 to-accent/5 lg:h-56 lg:rounded-b-3xl"
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
							className="absolute inset-0 bg-gradient-to-b from-primary/40 via-primary/0 via-45% to-primary/20"
						/>
					</>
				) : (
					// No cover: a soft mint band with a faint dot grid, so the
					// island still has something to float over and a brand-new
					// store looks finished rather than blank.
					<div
						aria-hidden
						className="absolute inset-0 opacity-15 [background-image:radial-gradient(var(--color-accent)_1px,transparent_1px)] [background-size:18px_18px]"
					/>
				)}
				{/* Mobile actions: WhatsApp then Share, right-aligned at the
				    cover's top-right. Desktop carries them labelled inside the
				    island instead, so the cover stays clean there. */}
				{chatHref || share ? (
					<div className="absolute inset-x-4 top-3.5 flex items-center justify-end gap-2 lg:hidden">
						{chatHref ? (
							<a
								href={chatHref}
								target="_blank"
								rel="noopener"
								aria-label={chatLabel}
								className={iconClass}
							>
								<MessageCircle className="size-5" aria-hidden />
							</a>
						) : null}
						{share ? (
							<button
								type="button"
								onClick={share}
								aria-label="Share this store"
								className={iconClass}
							>
								<Share2 className="size-5" aria-hidden />
							</button>
						) : null}
					</div>
				) : null}
			</div>

			{/* The island: overlaps the band by 72px (88px on lg), inset 16px
			    (32px on lg) like the cart pill, 24px radius, soft navy lift +
			    a hairline ring; dark mode drops the shadow and keeps a lighter
			    ring, since a shadow on a dark page is invisible anyway. From
			    `lg` it is one wrapping row: identity · facts · actions. */}
			<section
				aria-label="About this store"
				className="relative -mt-18 mx-4 rounded-3xl bg-card p-4 shadow-xl shadow-primary/15 ring-1 ring-foreground/5 lg:-mt-22 lg:mx-8 lg:flex lg:flex-wrap lg:items-start lg:gap-x-8 lg:gap-y-6 lg:px-7 lg:py-6 dark:shadow-none dark:ring-white/10"
			>
				{/* items-center, not items-start: with a blurb the text stack is the
				    tile's height and the two read the same; without one the name
				    would float at the tile's top edge over empty space. */}
				<div className="flex items-center gap-3.5 lg:min-w-0 lg:flex-[1_1_420px] lg:gap-4.5">
					<StoreLogoTile
						storeName={retailer.storeName}
						logoUrl={retailer.logoUrl}
						size="hero"
					/>
					<div className="flex min-w-0 flex-1 flex-col gap-1 lg:gap-1.5">
						{/* A <div>, not a <span>: it wraps the <h1>, and flow content
						    inside a phrasing element is an invalid content model. */}
						<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
							{/* The store home is *about* the store, so the name is the
							    page's <h1> — subpages name their own subject and carry the
							    compact app bar instead (see StorefrontAppBar). Wraps rather
							    than truncates: this is the one page whose job is the name. */}
							<h1 className="min-w-0 font-heading text-[22px] font-extrabold leading-[1.1] tracking-tight lg:text-[32px] lg:leading-[1.05]">
								{retailer.storeName}
							</h1>
							{retailer.isFoundingMember ? (
								<FoundingMemberBadge rank={retailer.foundingMemberRank} />
							) : null}
						</div>
						{retailer.storeDescription ? (
							// Seller's own blurb. Plain text (escaped by React), newlines
							// preserved, clamped to keep the card tidy. No blurb → no
							// row, so the facts move up rather than a filler line.
							<p className="line-clamp-2 whitespace-pre-line text-[13px] leading-snug text-muted-foreground lg:max-w-130 lg:text-[15px] lg:leading-normal">
								{retailer.storeDescription}
							</p>
						) : null}
					</div>
				</div>

				{hasFacts ? (
					// The facts block: hours (tap for the weekly schedule), a
					// closure ahead, and what the store fulfils where. Ruled off
					// above on a phone; a left rule beside the identity on lg.
					<div className="mt-3.5 flex flex-col gap-2 border-t border-border/60 pt-3 lg:mt-0 lg:min-w-60 lg:flex-[0_1_340px] lg:gap-2.5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-7">
						{showHours ? (
							<OpeningHoursLine
								hours={retailer.openingHours}
								closedDates={retailer.closedDates}
								onCover={false}
								variant="island"
							/>
						) : null}
						{fulfilment ? (
							<p className="flex min-h-6 items-center gap-2 text-[13px] leading-snug lg:text-sm">
								{retailer.offerDelivery !== false ? (
									<Truck
										className="size-4 shrink-0 text-muted-foreground"
										aria-hidden
									/>
								) : (
									<Store
										className="size-4 shrink-0 text-muted-foreground"
										aria-hidden
									/>
								)}
								<span className="min-w-0 truncate">
									<span className="font-medium">{fulfilment}</span>
									{retailer.storeArea ? (
										<span className="text-muted-foreground">
											{" · "}
											{retailer.storeArea}
										</span>
									) : null}
								</span>
							</p>
						) : null}
					</div>
				) : null}

				{/* Desktop actions, labelled, inside the island. `flex-wrap` on
				    the section drops this row under the identity when the facts
				    column needs the width. */}
				{chatHref || share ? (
					<div className="hidden gap-2.5 lg:flex lg:self-center">
						{share ? (
							<button type="button" onClick={share} className={ISLAND_ACTION}>
								<Share2 className="size-4" aria-hidden />
								Share store
							</button>
						) : null}
						{chatHref ? (
							<a
								href={chatHref}
								target="_blank"
								rel="noopener"
								className={ISLAND_ACTION}
							>
								<MessageCircle className="size-4" aria-hidden />
								Ask on WhatsApp
							</a>
						) : null}
					</div>
				) : null}
			</section>
		</header>
	);
}
