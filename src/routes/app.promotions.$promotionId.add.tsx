import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DEFAULT_CURRENCY } from "../../convex/lib/currency";
import { promotionIsOpen } from "../../convex/lib/promotions";
import {
	FlowSkeleton,
	PromotionEnded,
	PromotionFlow,
	PromotionGone,
} from "../components/promotions/promotion-flow";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { usePromotionGate } from "../hooks/usePromotionGate";

/** Add products to a running promotion (`z8r3fducfd`) — the same picker,
 * then a review on the promotion's existing terms. */
export const Route = createFileRoute("/app/promotions/$promotionId/add")({
	component: AddProductsRoute,
});

function AddProductsRoute() {
	const { promotionId } = Route.useParams();
	const retailer = useDashboardRetailer();
	const blockedReason = usePromotionGate();
	const detail = useQuery(
		convexQuery(api.promotions.get, {
			promotionId: promotionId as Id<"promotions">,
		}),
	).data;
	const catalog = useQuery(
		convexQuery(
			api.promotions.pickerCatalog,
			retailer
				? {
						retailerId: retailer._id,
						promotionId: promotionId as Id<"promotions">,
					}
				: "skip",
		),
	).data;

	if (!retailer) return null;
	if (detail === undefined || catalog === undefined) return <FlowSkeleton />;
	if (detail === null) return <PromotionGone />;
	if (!promotionIsOpen(detail.promotion, Date.now()))
		return (
			<PromotionEnded
				promotionId={detail.promotion._id}
				label={detail.promotion.label}
			/>
		);
	return (
		<PromotionFlow
			mode="add"
			retailerId={retailer._id}
			currency={retailer.currency ?? DEFAULT_CURRENCY}
			catalog={catalog}
			blockedReason={blockedReason}
			promotion={detail.promotion}
		/>
	);
}
