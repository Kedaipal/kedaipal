import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
	FlowSkeleton,
	PromotionFlow,
} from "../components/promotions/promotion-flow";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { usePromotionGate } from "../hooks/usePromotionGate";

/**
 * New promotion (`z8r3fducfd`) — pick products → set the discount → review.
 * `?from=<id>` is "Run again" on an ended promotion: same name, extras and
 * products, fresh dates.
 */
export const Route = createFileRoute("/app/promotions/new")({
	validateSearch: (search: Record<string, unknown>): { from?: string } => ({
		from: typeof search.from === "string" ? search.from : undefined,
	}),
	component: NewPromotionRoute,
});

function NewPromotionRoute() {
	const retailer = useDashboardRetailer();
	const { from } = Route.useSearch();
	const blockedReason = usePromotionGate();
	const catalog = useQuery(
		convexQuery(
			api.promotions.pickerCatalog,
			retailer ? { retailerId: retailer._id } : "skip",
		),
	).data;
	const source = useQuery(
		convexQuery(
			api.promotions.get,
			from ? { promotionId: from as Id<"promotions"> } : "skip",
		),
	).data;

	if (!retailer) return null;
	if (catalog === undefined || (from && source === undefined))
		return <FlowSkeleton />;

	return (
		<PromotionFlow
			mode="create"
			retailerId={retailer._id}
			currency={retailer.currency}
			catalog={catalog}
			blockedReason={blockedReason}
			promotion={source?.promotion}
			members={source?.products.map((p) => ({
				_id: p.productId,
				name: p.name,
				isBooking: p.isBooking,
				isEvent: p.isEvent,
				variants: p.variants,
			}))}
		/>
	);
}
