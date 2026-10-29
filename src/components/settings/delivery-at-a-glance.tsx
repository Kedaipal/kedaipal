/**
 * "Delivery at a glance" — the top of Settings → Fulfilment (z8r3fdr5yy, Zaki
 * 30 Oct). One row per kind of order, each saying what the buyer pays and who
 * carries it, so a seller with home delivery, overseas delivery and pickup
 * sees which price and which courier applies to which orders without opening
 * three pages. Every row links to the place that changes it; a row with
 * nothing to price its orders says what's missing and offers the fix.
 *
 * It only SUMMARISES: every value comes from the same rule the page it links
 * to uses (`pricingSummary`, `crossBorderPricingSummary`, the server's lane
 * pause), so the glance and the settings can't disagree.
 */

import { Link } from "@tanstack/react-router";
import { Building2, ChevronRight, Globe, Truck } from "lucide-react";
import type { ReactNode } from "react";
import type { Country } from "../../../convex/lib/country";
import {
	type CrossBorderLane,
	countryName,
	crossBorderPricingSummary,
	type LanePause,
} from "../../../convex/lib/crossBorder";
import type { EasyparcelQuoteBlock } from "../../../convex/lib/easyparcelArming";
import { laneBlockCopy } from "../../lib/overseas-delivery";
import { TONE_PANEL } from "../../lib/tone";
import { cn } from "../../lib/utils";
import { Card, Glance, SectionHeading } from "./settings-primitives";

export type GlanceCouriers = {
	lalamove: boolean;
	delyva: boolean;
	/** Carries this store's HOME parcels (an SG store). */
	easyparcelAtHome: boolean;
	/** Connected and able to quote — carries the overseas lane. */
	easyparcelReady: boolean;
};

export function DeliveryAtAGlance({
	country,
	offerDelivery,
	homePricing,
	couriers,
	destination,
	lane,
	lanePause,
	easyparcelBlock,
	productsAbroad,
	offerSelfCollect,
	activePickupPoints,
	money,
}: {
	country: Country;
	offerDelivery: boolean | undefined;
	/** `pricingSummary` of the home delivery config. */
	homePricing: string;
	couriers: GlanceCouriers;
	destination: Country;
	lane: CrossBorderLane | undefined;
	lanePause: LanePause | null;
	easyparcelBlock: EasyparcelQuoteBlock | null | undefined;
	/** "1 of 2" — undefined while loading. */
	productsAbroad?: { going: number; total: number };
	offerSelfCollect: boolean | undefined;
	activePickupPoints: number;
	money: (minor: number) => string;
}) {
	const home = countryName(country);
	const where = countryName(destination);
	const homeCarriers = [
		couriers.lalamove ? "Lalamove riders" : null,
		couriers.delyva ? "Delyva couriers" : null,
		couriers.easyparcelAtHome ? "EasyParcel couriers" : null,
	].filter((c): c is string => c !== null);

	return (
		<Card>
			<SectionHeading
				title="Delivery at a glance"
				description="What each kind of order costs the buyer, and who carries it."
			/>
			<ul className="flex flex-col divide-y divide-border">
				<Row
					icon={<Truck aria-hidden className="size-4" />}
					title={`Within ${home}`}
					to="/app/settings/delivery-pricing"
					label={`Within ${home}: change delivery pricing`}
					off={offerDelivery === false}
					offCopy="Delivery is off — buyers can only collect."
					pays={homePricing}
					carriedBy={
						homeCarriers.length > 0
							? [...homeCarriers, "or your own courier"]
							: ["You, or any courier you arrange"]
					}
				/>
				<OverseasRow
					destination={destination}
					where={where}
					lane={lane}
					pause={lanePause}
					easyparcelBlock={easyparcelBlock}
					easyparcelReady={couriers.easyparcelReady}
					productsAbroad={productsAbroad}
					money={money}
				/>
				<Row
					icon={<Building2 aria-hidden className="size-4" />}
					title="Pickup"
					to="/app/settings"
					search={{ tab: "fulfilment" }}
					hash="settings-pickup"
					label="Pickup: manage pickup points"
					off={!offerSelfCollect}
					offCopy="Pickup is off."
					pays="Free, or each point's own fee"
					carriedBy={[
						activePickupPoints === 1
							? "1 pickup point"
							: `${activePickupPoints} pickup points`,
					]}
					carriedLabel="Collected at"
				/>
			</ul>
		</Card>
	);
}

/** One kind of order: what the buyer pays | who carries it, linking on. */
function Row({
	icon,
	title,
	to,
	search,
	hash,
	label,
	off,
	offCopy,
	pays,
	carriedBy,
	carriedLabel = "Carried by",
	sub,
}: {
	icon: ReactNode;
	title: string;
	to:
		| "/app/settings/delivery-pricing"
		| "/app/settings/overseas-delivery"
		| "/app/settings";
	search?: { tab: "fulfilment" };
	hash?: string;
	label: string;
	off: boolean;
	offCopy: string;
	pays: string;
	carriedBy: string[];
	carriedLabel?: string;
	sub?: string;
}) {
	return (
		<li>
			<Link
				to={to}
				search={search}
				hash={hash}
				aria-label={label}
				className="grid min-h-11 grid-cols-[minmax(0,1fr)_1rem] items-start gap-3 py-3 hover:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_1rem]"
			>
				<span className="flex flex-col gap-0.5">
					<span className="flex items-center gap-1.5 text-sm font-semibold">
						{icon}
						{title}
					</span>
					{sub ? (
						<span className="text-xs text-muted-foreground">{sub}</span>
					) : null}
				</span>
				{off ? (
					<span className="col-start-1 text-sm text-muted-foreground sm:col-span-2 sm:col-start-auto">
						{offCopy}
					</span>
				) : (
					<>
						<Fact label="Buyer pays" lines={[pays]} />
						<Fact label={carriedLabel} lines={carriedBy} />
					</>
				)}
				<ChevronRight
					aria-hidden
					className="col-start-2 row-start-1 mt-0.5 size-4 text-muted-foreground sm:col-start-auto sm:row-start-auto"
				/>
			</Link>
		</li>
	);
}

function Fact({ label, lines }: { label: string; lines: string[] }) {
	return (
		<span className="col-start-1 flex flex-col sm:col-start-auto">
			<span className="text-xs text-muted-foreground">{label}</span>
			{lines.map((line) => (
				<span key={line} className="text-sm">
					{line}
				</span>
			))}
		</span>
	);
}

/**
 * The overseas row has the most states, because it's the one that can't
 * price its orders until the seller chooses how (Zaki, 30 Oct): off → the two
 * ways to price it; held or paused → why, and the fix; on → price and carrier.
 */
function OverseasRow({
	destination,
	where,
	lane,
	pause,
	easyparcelBlock,
	easyparcelReady,
	productsAbroad,
	money,
}: {
	destination: Country;
	where: string;
	lane: CrossBorderLane | undefined;
	pause: LanePause | null;
	easyparcelBlock: EasyparcelQuoteBlock | null | undefined;
	easyparcelReady: boolean;
	productsAbroad?: { going: number; total: number };
	money: (minor: number) => string;
}) {
	if (!lane) {
		return (
			<li className="flex flex-col gap-2 py-3">
				<span className="flex items-center justify-between gap-2">
					<span className="flex items-center gap-1.5 text-sm font-semibold">
						<Globe aria-hidden className="size-4" />
						To {where}
					</span>
					<Glance tone="grey">Off</Glance>
				</span>
				<p className="text-sm text-muted-foreground">
					Buyers in {where} can&apos;t order yet. Choose how orders to {where}{" "}
					are priced, and delivery there turns on once you&apos;ve picked which
					products can go.
				</p>
				<span className="flex flex-wrap gap-2">
					<Link
						to="/app/settings/overseas-delivery"
						search={{ start: "own" }}
						className="inline-flex min-h-11 items-center rounded-lg border border-border px-3.5 text-sm font-medium hover:bg-muted"
					>
						Set your own price
					</Link>
					<Link
						to="/app/settings/overseas-delivery"
						search={{ start: "live" }}
						className="inline-flex min-h-11 items-center rounded-lg border border-border px-3.5 text-sm font-medium hover:bg-muted"
					>
						Use EasyParcel live price
					</Link>
				</span>
			</li>
		);
	}
	const sub = productsAbroad
		? `${productsAbroad.going} of ${productsAbroad.total} products go`
		: undefined;
	return (
		<>
			<Row
				icon={<Globe aria-hidden className="size-4" />}
				title={`To ${where}`}
				sub={sub}
				to="/app/settings/overseas-delivery"
				label={`To ${where}: change overseas delivery`}
				off={false}
				offCopy=""
				pays={crossBorderPricingSummary(lane.pricing, money)}
				carriedBy={
					easyparcelReady
						? ["EasyParcel", "or your own courier"]
						: ["Your own courier"]
				}
			/>
			{pause ? (
				<li className="pb-3">
					<p
						className={cn(
							"rounded-xl border px-3.5 py-2.5 text-sm",
							pause === "awaiting_products"
								? TONE_PANEL.neutral
								: TONE_PANEL.warn,
						)}
					>
						{laneBlockCopy(pause, destination, easyparcelBlock)}
					</p>
				</li>
			) : null}
		</>
	);
}
