import { hasFeature } from "../lib/subscription";
import { useDashboardRetailer } from "./useDashboardRetailer";
import { useAreaLock } from "./useStoreLock";

/**
 * Why a promotion can't be SET right now, or null (`z8r3fducfd`). One answer
 * for every surface that starts or changes a promotion, in the house
 * priority: the store/grant lock (`useAreaLock`, which already orders
 * subscription before permission), then the Pro gate. Ending and removing
 * are never gated by Pro, so those controls read `useAreaLock` alone.
 */
export function usePromotionGate(): string | null {
	const retailer = useDashboardRetailer();
	const areaLock = useAreaLock("products");
	if (areaLock.readOnly) return areaLock.reason;
	if (
		retailer &&
		!retailer.actingAsAdmin &&
		!hasFeature(retailer.subscription, "promo")
	)
		return "Promotions are part of the Pro plan. Upgrade in Settings → Billing to put products on sale.";
	return null;
}
