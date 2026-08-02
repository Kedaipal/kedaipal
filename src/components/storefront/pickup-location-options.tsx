import { Clock, ExternalLink, MapPin } from "lucide-react";
import type { ReactNode } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { formatPrice } from "../../lib/format";
import { deriveMapsUrl } from "../../lib/google-address";

/** Pickup kind — "self_collect" (seller's place) or "drop_off" (meetup point). */
export type PickupKind = "self_collect" | "drop_off";

/** Public-safe pickup location shape returned by `listActivePublicBySlug`. */
export interface PublicPickupLocation {
	_id: Id<"pickupLocations">;
	label: string;
	address: string;
	locationType: PickupKind;
	scheduleNote?: string;
	mapsUrl?: string;
	notes?: string;
	latitude?: number;
	longitude?: number;
	placeId?: string;
	/** Flat fee (minor units) added to the order total when this point is
	 * chosen. Undefined = free. */
	fee?: number;
	sortOrder: number;
}

/** The fee a location adds to the total — 0 when free/unset. */
export function pickupFeeOf(
	location: PublicPickupLocation | undefined,
): number {
	return location?.fee && location.fee > 0 ? location.fee : 0;
}

/** Buyer-facing sub-heading per pickup kind (one vocabulary, both sides). */
export const PICKUP_KIND_HEADING: Record<PickupKind, string> = {
	self_collect: "Self-collect",
	drop_off: "Drop-off",
};

/**
 * Auto-selected confirmation card when the retailer has exactly one active
 * pickup location. No interaction needed — the location is resolved at submit
 * time.
 */
export function PickupSummaryCard({
	location,
	currency,
}: {
	location: PublicPickupLocation;
	currency: string;
}) {
	return (
		// Fill only, no outline: this renders inside the checkout's bordered
		// section, where a bordered card would read as a second competing card.
		<section className="flex flex-col gap-2 rounded-xl bg-accent/5 p-4">
			<div className="flex items-start gap-2">
				<MapPin
					className="size-4 shrink-0 text-accent mt-0.5"
					aria-hidden="true"
				/>
				<div className="flex min-w-0 flex-col gap-1">
					<div className="flex items-center gap-2">
						<p className="text-sm font-semibold leading-tight">
							{location.label}
						</p>
						<PickupKindBadge kind={location.locationType} />
						<PickupFeeChip fee={location.fee} currency={currency} />
					</div>
					<p className="text-xs text-muted-foreground whitespace-pre-line">
						{location.address}
					</p>
					{location.scheduleNote ? (
						<p className="flex items-center gap-1 text-xs font-medium text-accent">
							<Clock className="size-3 shrink-0" aria-hidden="true" />
							<span className="line-clamp-2">{location.scheduleNote}</span>
						</p>
					) : null}
					{(() => {
						const mapsUrl = deriveMapsUrl(location);
						return mapsUrl ? (
							<a
								href={mapsUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1 self-start text-xs font-medium text-accent underline-offset-2 hover:underline"
							>
								<ExternalLink className="size-3" />
								Open in maps
							</a>
						) : null;
					})()}
					{location.notes ? (
						<p className="line-clamp-3 text-xs text-muted-foreground whitespace-pre-line">
							{location.notes}
						</p>
					) : null}
				</div>
			</div>
		</section>
	);
}

/** "+ RM2.00 fee" chip on a paid pickup point — the charge must be visible on
 *  the option itself, before the buyer picks it, not only in the totals. */
function PickupFeeChip({
	fee,
	currency,
}: {
	fee: number | undefined;
	currency: string;
}) {
	if (!fee || fee <= 0) return null;
	return (
		<span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
			+ {formatPrice(fee, currency)} fee
		</span>
	);
}

/** Small kind chip so the buyer knows whether they're going to the seller's
 *  place or an agreed meetup point. */
function PickupKindBadge({ kind }: { kind: PickupKind }) {
	return (
		<span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
			{PICKUP_KIND_HEADING[kind]}
		</span>
	);
}

/**
 * Required radio list when 2+ active pickup locations exist. Buyer must pick
 * one before submission — the submit handler refuses to proceed without a
 * matching id.
 */
export function PickupLocationRadioList({
	locations,
	currency,
	value,
	onChange,
	error,
}: {
	locations: ReadonlyArray<PublicPickupLocation>;
	currency: string;
	value: string;
	onChange: (id: string) => void;
	/** Submit-time "pick one" error — marks the radios so the shared
	 * focus-first-error helper lands here, with the message under the legend. */
	error?: string;
}) {
	// Group by kind, preserving the retailer's sort order within each group.
	// Sub-headings only appear when BOTH kinds exist — a single-kind seller
	// (the legacy 100%-self-collect case) sees a flat list, exactly as before.
	const selfCollect = locations.filter(
		(l) => l.locationType === "self_collect",
	);
	const dropOff = locations.filter((l) => l.locationType === "drop_off");
	const showHeadings = selfCollect.length > 0 && dropOff.length > 0;

	const renderOption = (loc: PublicPickupLocation) => {
		const selected = value === loc._id;
		const mapsUrl = deriveMapsUrl(loc);
		return (
			// Fill, not outline — see PickupSummaryCard. The radio itself is the
			// primary selection affordance; the accent wash just makes the chosen
			// row scannable without drawing another card inside the section's card.
			<label
				key={loc._id}
				className={`flex cursor-pointer items-start gap-3 rounded-xl p-3 transition-colors ${
					selected ? "bg-accent/10" : "bg-muted/50 hover:bg-muted"
				}`}
			>
				<input
					type="radio"
					name="pickupLocationId"
					value={loc._id}
					checked={selected}
					onChange={() => onChange(loc._id)}
					aria-invalid={error ? true : undefined}
					className="mt-1 size-4 shrink-0 accent-accent"
				/>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<span className="flex items-center gap-2">
						<span className="text-sm font-semibold leading-tight">
							{loc.label}
						</span>
						{/* Badge only when headings are off — otherwise the group
						    heading already names the kind. */}
						{showHeadings ? null : <PickupKindBadge kind={loc.locationType} />}
						<PickupFeeChip fee={loc.fee} currency={currency} />
					</span>
					<span className="text-xs text-muted-foreground whitespace-pre-line">
						{loc.address}
					</span>
					{loc.scheduleNote ? (
						<span className="flex items-center gap-1 text-xs font-medium text-accent">
							<Clock className="size-3 shrink-0" aria-hidden="true" />
							<span className="line-clamp-2">{loc.scheduleNote}</span>
						</span>
					) : null}
					{mapsUrl ? (
						<a
							href={mapsUrl}
							target="_blank"
							rel="noopener noreferrer"
							onClick={(e) => e.stopPropagation()}
							className="flex items-center gap-1 self-start text-xs font-medium text-accent underline-offset-2 hover:underline"
						>
							<ExternalLink className="size-3" />
							Open in maps
						</a>
					) : null}
				</div>
			</label>
		);
	};

	return (
		<fieldset className="flex flex-col gap-3">
			{/* `mb-2`, not the fieldset's `gap-3`: a <legend> is rendered by the
			    fieldset itself and is NOT a flex item, so the gap never applies
			    below it and the title sat flush against the first option. */}
			<legend className="mb-2 text-sm font-medium">Choose a pickup point</legend>
			{error ? (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			) : null}
			{showHeadings ? (
				<>
					<PickupGroup
						heading={PICKUP_KIND_HEADING.self_collect}
						locations={selfCollect}
						renderOption={renderOption}
					/>
					<PickupGroup
						heading={PICKUP_KIND_HEADING.drop_off}
						locations={dropOff}
						renderOption={renderOption}
					/>
				</>
			) : (
				<div className="flex flex-col gap-2">{locations.map(renderOption)}</div>
			)}
		</fieldset>
	);
}

function PickupGroup({
	heading,
	locations,
	renderOption,
}: {
	heading: string;
	locations: ReadonlyArray<PublicPickupLocation>;
	renderOption: (loc: PublicPickupLocation) => ReactNode;
}) {
	if (locations.length === 0) return null;
	return (
		<div className="flex flex-col gap-2">
			<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				{heading}
			</p>
			{locations.map(renderOption)}
		</div>
	);
}
