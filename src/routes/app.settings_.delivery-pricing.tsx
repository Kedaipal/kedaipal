import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { AreaGate } from "../components/app/area-gate";
import {
	PageHeader,
	PageHeaderSkeleton,
} from "../components/dashboard/page-header";
import { DeliveryPricing } from "../components/settings/delivery-pricing";
import { Glance } from "../components/settings/settings-primitives";
import { Skeleton } from "../components/ui/skeleton";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { pricingSummary } from "../lib/delivery-modes";
import { formatPrice } from "../lib/format";

/**
 * Settings → Fulfilment → Delivery pricing (86eye9xd4, 3A). Its own page
 * because five modes, two of them page-sized forms, had outgrown a card
 * inside a card inside a tab. `settings_` keeps it inside the dashboard shell
 * without nesting it under the Settings tab page; the Fulfilment tab's
 * Delivery card links here and every back affordance returns there.
 */
export const Route = createFileRoute("/app/settings_/delivery-pricing")({
	component: DeliveryPricingRoute,
});

function DeliveryPricingRoute() {
	const retailer = useDashboardRetailer();

	if (!retailer) {
		return (
			<div className="flex flex-col gap-6">
				<PageHeaderSkeleton hasBack hasSubtitle={false} />
				<div className="flex flex-col gap-6 xl:grid xl:grid-cols-2">
					<Skeleton className="h-96 w-full rounded-2xl" />
					<Skeleton className="h-72 w-full rounded-2xl" />
				</div>
			</div>
		);
	}

	const summary = pricingSummary(retailer.deliveryConfig, (sen) =>
		formatPrice(sen, retailer.currency),
	);

	return (
		<div className="flex max-w-6xl flex-col gap-6">
			<PageHeader
				title="Delivery pricing"
				back={{
					to: "/app/settings",
					search: { tab: "fulfilment" },
					label: "Fulfilment",
				}}
				actions={<Glance>{summary}</Glance>}
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
					Delivery pricing
				</h1>
				<Glance className="max-w-[45%]">{summary}</Glance>
			</div>
			<AreaGate area="fulfilment">
				<DeliveryPricing
					// Remount when the saved config / keys change shape so the drafts
					// re-seed from the server after a save.
					key={`${retailer.deliveryConfig?.mode ?? "free"}:${retailer.businessAddress?.label ?? ""}:${retailer.deliveryBooking?.apiKeyHint ?? ""}`}
					retailerId={retailer._id}
					country={retailer.country}
					currency={retailer.currency}
					config={retailer.deliveryConfig}
					businessAddress={retailer.businessAddress}
					deliveryBooking={retailer.deliveryBooking}
					subscription={retailer.subscription}
				/>
			</AreaGate>
		</div>
	);
}
