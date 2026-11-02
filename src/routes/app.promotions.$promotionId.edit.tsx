import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { promotionIsOpen } from "../../convex/lib/promotions";
import {
	FlowSkeleton,
	PromotionEnded,
	PromotionFlow,
	PromotionGone,
} from "../components/promotions/promotion-flow";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { usePromotionGate } from "../hooks/usePromotionGate";
import { overridesFromCurrent } from "../lib/promotion-flow";

/** Edit terms (`z8r3fducfd`) — terms + review of the products already in it,
 * starting from the prices the storefront shows now. */
export const Route = createFileRoute("/app/promotions/$promotionId/edit")({
	component: EditPromotionRoute,
});

function EditPromotionRoute() {
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
	const members = detail.products.map((p) => ({
		_id: p.productId,
		name: p.name,
		isBooking: p.isBooking,
		isEvent: p.isEvent,
		variants: p.variants,
	}));
	return (
		<PromotionFlow
			mode="edit"
			retailerId={retailer._id}
			currency={retailer.currency}
			catalog={catalog}
			blockedReason={blockedReason}
			promotion={detail.promotion}
			members={members}
			seedPrices={overridesFromCurrent(members)}
		/>
	);
}
