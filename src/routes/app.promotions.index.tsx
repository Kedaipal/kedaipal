import { createFileRoute } from "@tanstack/react-router";
import { NeedsAccessNote } from "../components/app/owner-only-note";
import { ViewOnlyNote } from "../components/app/view-only-note";
import { PageHeader } from "../components/dashboard/page-header";
import { PromotionsPanel } from "../components/promotions/promotions-panel";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { usePermission } from "../hooks/usePermission";
import { usePromotionGate } from "../hooks/usePromotionGate";
import { useAreaLock } from "../hooks/useStoreLock";

/**
 * Promotions (`z8r3fducfd`) — bulk sale prices: many products on one
 * promotion, set, edited and ended as one.
 *
 * Its own nav entry, right after Products, and deliberately NOT merged with
 * Vouchers (Zaki, 14 Oct 2026). The two take money off in different places:
 * a promotion changes a PRODUCT's price before anyone checks out, a voucher
 * is a code one buyer redeems AT checkout. Each has its own create / edit /
 * end, and a seller looking for one should never have to know it's a tab
 * under the other. It sits beside Products because it is catalogue pricing
 * (the `products` permission area), not a buyer-facing offer.
 */
export const Route = createFileRoute("/app/promotions/")({
	component: PromotionsRoute,
});

function PromotionsRoute() {
	const retailer = useDashboardRetailer();
	const { canRead } = usePermission("products");
	const areaLock = useAreaLock("products");
	const newBlockedReason = usePromotionGate();

	if (!retailer) return null;

	return (
		<div className="flex flex-col gap-5 lg:gap-6">
			<PageHeader
				title="Promotions"
				subtitle="Sale prices on many products at once"
			/>
			<div className="flex flex-col lg:hidden">
				<h1 className="font-heading text-[26px] font-extrabold leading-tight tracking-tight">
					Promotions
				</h1>
				<p className="text-[13px] text-muted-foreground">
					Sale prices on many products at once
				</p>
			</div>

			{canRead ? (
				<>
					<ViewOnlyNote />
					<PromotionsPanel
						retailerId={retailer._id}
						newBlockedReason={newBlockedReason}
						// The subscription case is already the house ViewOnlyNote
						// above, with its way back to Billing — never said twice.
						showReasonNote={areaLock.cause !== "subscription"}
					/>
				</>
			) : (
				<NeedsAccessNote area="products" level="read" />
			)}
		</div>
	);
}
