// The seller calendar's listing selector.
//
// Was a row of `FilterChip` pills carrying nothing but a name, with "All
// listings" appended LAST — the overview and the default, sitting after the
// things it summarises. A card carries what the seller actually picks by: the
// photo they recognise the plot from, its price, and how many spots a night
// holds (the denominator the grid's pills are counted against).

import { LayoutGrid } from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { PackageUnit } from "../../../convex/lib/productKind";
import { bookingPriceSuffix } from "../../lib/booking-dates";
import { formatPrice } from "../../lib/format";
import { cn } from "../../lib/utils";
import { AppImage } from "../ui/app-image";

export type CalendarListing = {
	_id: Id<"products">;
	name: string;
	imageUrl: string | null;
	price?: number;
	capacityPerNight?: number;
	packageLength?: number;
	packageUnit?: PackageUnit;
};

export function BookingListingCards({
	listings,
	selected,
	onSelect,
	currency,
}: {
	listings: CalendarListing[];
	selected: Id<"products"> | "all";
	onSelect: (next: Id<"products"> | "all") => void;
	currency: string;
}) {
	// One listing needs no picker at all — it is already the only answer, and
	// the calendar auto-selects it.
	if (listings.length <= 1) return null;
	return (
		<div className="-mx-4 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
			{/* All listings LEADS. It is the overview and the default; appending it
			    after the listings it summarises was placement by convenience. */}
			<ListingCard
				selected={selected === "all"}
				onClick={() => onSelect("all")}
				title="All listings"
				subtitle={`${listings.length} listings · counts only`}
				thumb={
					<span className="flex size-9 items-center justify-center rounded-[10px] bg-muted text-muted-foreground lg:size-10">
						<LayoutGrid className="size-[18px]" aria-hidden />
					</span>
				}
			/>
			{listings.map((listing) => (
				<ListingCard
					key={listing._id}
					selected={selected === listing._id}
					onClick={() => onSelect(listing._id)}
					title={listing.name}
					subtitle={listingSubtitle(listing, currency)}
					thumb={
						<AppImage
							src={listing.imageUrl ?? undefined}
							alt={listing.name}
							sizes="40px"
							className="size-9 shrink-0 rounded-[10px] border border-border object-cover lg:size-10"
						/>
					}
				/>
			))}
		</div>
	);
}

/** Price + capacity, or whichever of the two the listing actually has. */
function listingSubtitle(listing: CalendarListing, currency: string): string {
	const parts: string[] = [];
	if (listing.price !== undefined) {
		parts.push(
			`${formatPrice(listing.price, currency)}${bookingPriceSuffix(listing.packageLength, listing.packageUnit)}`,
		);
	}
	parts.push(
		listing.capacityPerNight === undefined
			? "unlimited"
			: `${listing.capacityPerNight} spot${listing.capacityPerNight === 1 ? "" : "s"}`,
	);
	return parts.join(" · ");
}

function ListingCard({
	selected,
	onClick,
	title,
	subtitle,
	thumb,
}: {
	selected: boolean;
	onClick: () => void;
	title: string;
	subtitle: string;
	thumb: React.ReactNode;
}) {
	return (
		<button
			type="button"
			aria-pressed={selected}
			onClick={onClick}
			className={cn(
				"flex shrink-0 snap-start items-center gap-2.5 rounded-2xl border p-2 pr-3.5 text-left transition-colors lg:p-2.5 lg:pr-4",
				selected
					? "border-accent bg-accent/8 ring-3 ring-accent/15"
					: "border-border bg-card hover:border-accent/50",
			)}
		>
			{thumb}
			<span className="min-w-0">
				<span className="block truncate text-sm font-semibold leading-tight">
					{title}
				</span>
				<span
					className={cn(
						"mt-0.5 block truncate text-xs leading-snug",
						selected ? "text-accent-emphasis" : "text-muted-foreground",
					)}
				>
					{subtitle}
				</span>
			</span>
		</button>
	);
}

