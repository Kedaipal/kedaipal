import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { countryName, laneCountriesFor } from "../../convex/lib/crossBorder";
import { NeedsAccessNote } from "../components/app/owner-only-note";
import { ViewOnlyNote } from "../components/app/view-only-note";
import { PageHeader } from "../components/dashboard/page-header";
import { OverseasProducts } from "../components/products/overseas-products";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { useAreaLock } from "../hooks/useStoreLock";

export const Route = createFileRoute("/app/products/overseas")({
	// Every key returned (z8r3fdtk87 — an omitted one leaks its raw value).
	validateSearch: (search: Record<string, unknown>): { first?: true } => ({
		first: search.first === true || search.first === "true" ? true : undefined,
	}),
	component: OverseasProductsRoute,
});

/**
 * Products → Overseas (z8r3fdr5yy): which products can go to the other
 * country. Under Products because it is catalogue data — the overseas
 * delivery settings page links here (and lands here once, right after the
 * switch is turned on), it doesn't host it.
 */
function OverseasProductsRoute() {
	const retailer = useDashboardRetailer();
	const lock = useAreaLock("products");
	const { first } = Route.useSearch();
	const navigate = useNavigate();
	if (!retailer) return null;
	const destination = laneCountriesFor(retailer.country)[0];
	const title = `Delivery to ${countryName(destination)}`;
	const subtitle = "Choose which products can go overseas";
	const backTo = () => void navigate({ to: "/app/settings/overseas-delivery" });

	return (
		<div className="flex flex-col gap-4 lg:max-w-2xl lg:gap-5">
			<PageHeader
				title={title}
				subtitle={subtitle}
				back={{
					to: "/app/settings/overseas-delivery",
					label: "Overseas delivery",
				}}
			/>
			<div className="flex items-center gap-3 lg:hidden">
				<Link
					to="/app/settings/overseas-delivery"
					aria-label="Back to overseas delivery"
					className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted"
				>
					<ArrowLeft className="size-5" />
				</Link>
				<div className="flex min-w-0 flex-col">
					<h2 className="font-heading text-[22px] font-extrabold leading-tight tracking-tight">
						{title}
					</h2>
					<p className="text-[13px] text-muted-foreground">{subtitle}</p>
				</div>
			</div>

			<ViewOnlyNote />
			<NeedsAccessNote area="products" />

			<OverseasProducts
				retailerId={retailer._id}
				storeCountry={retailer.country}
				destination={destination}
				first={first === true}
				// The lane is saved but held until this step is confirmed
				// (Zaki, 30 Oct) — confirming turns delivery abroad on.
				turnsOnLane={
					retailer.crossBorderLanes?.some((l) => l.awaitingProducts) === true
				}
				readOnly={lock.readOnly}
				readOnlyReason={lock.reason}
				onDone={backTo}
			/>
		</div>
	);
}
