import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { countryName, laneCountriesFor } from "../../convex/lib/crossBorder";
import { AreaGate } from "../components/app/area-gate";
import {
	PageHeader,
	PageHeaderSkeleton,
} from "../components/dashboard/page-header";
import { OverseasDelivery } from "../components/settings/overseas-delivery";
import { Skeleton } from "../components/ui/skeleton";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";

/**
 * Settings → Fulfilment → Delivery to Singapore / Malaysia (z8r3fdr5yy). Its
 * own page, the Delivery-pricing posture: the Fulfilment tab's Delivery card
 * carries a summary row that links here, and every back affordance returns
 * there.
 */
export const Route = createFileRoute("/app/settings_/overseas-delivery")({
	component: OverseasDeliveryRoute,
});

function OverseasDeliveryRoute() {
	const retailer = useDashboardRetailer();
	if (!retailer) {
		return (
			<div className="flex flex-col gap-6">
				<PageHeaderSkeleton hasBack hasSubtitle={false} />
				<Skeleton className="h-72 w-full rounded-2xl" />
			</div>
		);
	}
	const title = `Delivery to ${countryName(laneCountriesFor(retailer.country)[0])}`;
	return (
		<div className="flex max-w-6xl flex-col gap-6">
			<PageHeader
				title={title}
				back={{
					to: "/app/settings",
					search: { tab: "fulfilment" },
					label: "Fulfilment",
				}}
			/>
			<div className="flex items-center gap-3 lg:hidden">
				<Link
					to="/app/settings"
					search={{ tab: "fulfilment" }}
					aria-label="Back to Fulfilment"
					className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted"
				>
					<ArrowLeft className="size-5" />
				</Link>
				<h1 className="min-w-0 flex-1 truncate font-heading text-lg font-extrabold leading-tight">
					{title}
				</h1>
			</div>
			<AreaGate area="fulfilment">
				<OverseasDelivery
					// Re-seed the price draft after a save changes what's stored.
					key={JSON.stringify(retailer.crossBorderLanes ?? null)}
					retailerId={retailer._id}
					storeCountry={retailer.country}
					currency={retailer.currency}
					subscription={retailer.subscription}
					offerDelivery={retailer.offerDelivery}
					deliveryConfig={retailer.deliveryConfig}
					lanes={retailer.crossBorderLanes}
				/>
			</AreaGate>
		</div>
	);
}
