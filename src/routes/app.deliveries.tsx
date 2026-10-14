import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import { resolveAwbConfig } from "../../convex/lib/awbConfig";
import {
	PageHeader,
	PageHeaderSkeleton,
} from "../components/dashboard/page-header";
import {
	DeliveriesView,
	monthGlance,
	WalletGlance,
} from "../components/deliveries/deliveries-view";
import { Glance } from "../components/settings/settings-primitives";
import { Skeleton } from "../components/ui/skeleton";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { describeAwbPaper } from "../lib/awb-labels";

/**
 * Deliveries (86eye9xd4, 6A) — where delivery is CHECKED, as Settings is
 * where it is configured: the courier wallet, bookings made through Kedaipal,
 * and the parcels a seller ships by hand. Its own nav entry right after
 * Orders (and in the phone's More panel), because it is daily-loop work about
 * orders already placed — not a setting and not a report. Read access is the
 * Orders area's, guarded at the route (`RouteAreaGuard`).
 */
export const Route = createFileRoute("/app/deliveries")({
	component: DeliveriesRoute,
});

function DeliveriesRoute() {
	const retailer = useDashboardRetailer();
	const overview = useQuery(
		convexQuery(
			api.deliveries.overview,
			retailer ? { retailerId: retailer._id } : "skip",
		),
	).data;

	if (!retailer || overview === undefined) {
		return (
			<div className="flex max-w-5xl flex-col gap-6">
				<PageHeaderSkeleton hasSubtitle />
				<Skeleton className="h-48 w-full rounded-2xl" />
				<Skeleton className="h-72 w-full rounded-2xl" />
			</div>
		);
	}

	return (
		<div className="flex max-w-5xl flex-col gap-6">
			<PageHeader
				title="Deliveries"
				subtitle="Parcels to send, couriers on the road, and what delivery cost you this month."
				actions={
					overview.booksCouriers || overview.wallet ? (
						<div className="flex flex-wrap items-center justify-end gap-2">
							{overview.booksCouriers ? (
								<Glance tone="grey">{monthGlance(overview)}</Glance>
							) : null}
							<WalletGlance wallet={overview.wallet} />
						</div>
					) : null
				}
			/>
			<DeliveriesView
				overview={overview}
				retailerId={retailer._id}
				paperLabel={describeAwbPaper(
					resolveAwbConfig(retailer.awbConfig).paperSize,
				)}
			/>
		</div>
	);
}
