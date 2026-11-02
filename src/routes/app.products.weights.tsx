import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { NeedsAccessNote } from "../components/app/owner-only-note";
import { ViewOnlyNote } from "../components/app/view-only-note";
import { PageHeader } from "../components/dashboard/page-header";
import { ParcelWeightsFill } from "../components/products/parcel-weights-fill";
import { Skeleton } from "../components/ui/skeleton";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { useAreaLock } from "../hooks/useStoreLock";

export const Route = createFileRoute("/app/products/weights")({
	component: ParcelWeightsRoute,
});

/**
 * Products → Parcel weights (23 Oct 2026): the bulk weight fill. Under
 * Products because a weight is catalogue data — the Settings pages that
 * NEED it (delivery pricing, courier booking) link here, they don't host it.
 */
function ParcelWeightsRoute() {
	const retailer = useDashboardRetailer();
	const lock = useAreaLock("products");
	const missing = useQuery(
		convexQuery(
			api.products.missingParcelWeights,
			retailer ? { retailerId: retailer._id } : "skip",
		),
	).data;
	if (!retailer) return null;

	const subtitle =
		missing === undefined
			? undefined
			: missing.count === 0
				? "Every product is weighed"
				: `${missing.choiceCount} choice${missing.choiceCount === 1 ? "" : "s"} across ${missing.count} product${missing.count === 1 ? "" : "s"} ${missing.count === 1 ? "has" : "have"} no weight`;

	return (
		<div className="flex flex-col gap-4 lg:gap-5 lg:max-w-2xl">
			<PageHeader
				title="Parcel weights"
				subtitle={subtitle ?? "Loading…"}
				back={{ to: "/app/products", label: "Products" }}
			/>
			<div className="flex items-center gap-3 lg:hidden">
				<Link
					to="/app/products"
					aria-label="Back to products"
					className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted"
				>
					<ArrowLeft className="size-5" />
				</Link>
				<div className="flex min-w-0 flex-col">
					<h2 className="font-heading text-[22px] font-extrabold leading-tight tracking-tight">
						Parcel weights
					</h2>
					{subtitle === undefined ? (
						<Skeleton className="h-3 w-40 rounded" />
					) : (
						<p className="text-[13px] text-muted-foreground">{subtitle}</p>
					)}
				</div>
			</div>

			<ViewOnlyNote />
			<NeedsAccessNote area="products" />

			<ParcelWeightsFill
				retailerId={retailer._id}
				reason={retailer.weightPricing ?? null}
				readOnly={lock.readOnly}
				readOnlyReason={lock.reason}
			/>
		</div>
	);
}
