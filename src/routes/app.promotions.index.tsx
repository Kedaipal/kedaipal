import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { NeedsAccessNote } from "../components/app/owner-only-note";
import { ViewOnlyNote } from "../components/app/view-only-note";
import { PageHeader } from "../components/dashboard/page-header";
import { PromotionsPanel } from "../components/promotions/promotions-panel";
import { VouchersPanel } from "../components/vouchers/vouchers-panel";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { usePermission } from "../hooks/usePermission";
import { useAreaLock } from "../hooks/useStoreLock";
import { hasFeature } from "../lib/subscription";
import { cn } from "../lib/utils";

/**
 * Promotions (`z8r3fducfd`) — everything a seller takes off a price, in one
 * place: bulk SALE PRICES (many products on one promotion) and VOUCHER CODES
 * (single-use codes for one buyer). The two answer the same question — "what
 * am I offering off?" — so they share a home rather than two nav entries; the
 * voucher ticket built its page to move here.
 *
 * The tabs follow the seller's grants: a promotion writes product prices (the
 * `products` area) and a voucher is its own area, so a teammate sees exactly
 * the tabs their role can read — and the page never shows an empty tab with
 * a permission error where a tab could simply not be.
 */

type Tab = "sale" | "vouchers";

export const Route = createFileRoute("/app/promotions/")({
	validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
		tab: search.tab === "vouchers" ? "vouchers" : undefined,
	}),
	component: PromotionsRoute,
});

const TAB_LABEL: Record<Tab, string> = {
	sale: "Sale prices",
	vouchers: "Voucher codes",
};

function PromotionsRoute() {
	const retailer = useDashboardRetailer();
	const navigate = useNavigate({ from: "/app/promotions/" });
	const { tab: requested } = Route.useSearch();
	const products = usePermission("products");
	const vouchers = usePermission("vouchers");
	const areaLock = useAreaLock("products");

	if (!retailer) return null;

	const tabs: Tab[] = [
		...(products.canRead ? (["sale"] as const) : []),
		...(vouchers.canRead ? (["vouchers"] as const) : []),
	];
	const tab: Tab | undefined =
		requested && tabs.includes(requested) ? requested : tabs[0];

	const promoLocked =
		!retailer.actingAsAdmin && !hasFeature(retailer.subscription, "promo");
	// One reason, in the house priority (`useAreaLock` decides subscription vs
	// grant; the Pro gate speaks only when nothing else locks).
	const newBlockedReason = areaLock.readOnly
		? areaLock.reason
		: promoLocked
			? "Promotions are part of the Pro plan. Upgrade in Settings → Billing to put products on sale — anything you set before keeps its history here."
			: null;

	return (
		<div className="flex flex-col gap-5 lg:gap-6">
			<PageHeader title="Promotions" subtitle="Sale prices and voucher codes" />
			<div className="flex flex-col lg:hidden">
				<h1 className="font-heading text-[26px] font-extrabold leading-tight tracking-tight">
					Promotions
				</h1>
				<p className="text-[13px] text-muted-foreground">
					Sale prices and voucher codes
				</p>
			</div>

			{tab === undefined ? (
				<NeedsAccessNote area="products" level="read" />
			) : (
				<>
					{tabs.length > 1 ? (
						<div
							role="tablist"
							aria-label="Promotions"
							className="grid grid-cols-2 rounded-xl bg-muted p-1 lg:max-w-sm"
						>
							{tabs.map((t) => (
								<button
									key={t}
									type="button"
									role="tab"
									aria-selected={tab === t}
									onClick={() =>
										navigate({
											search: {
												tab: t === "vouchers" ? "vouchers" : undefined,
											},
											replace: true,
										})
									}
									className={cn(
										"tap-target rounded-lg text-sm font-semibold transition-colors",
										tab === t
											? "bg-background text-foreground shadow-sm"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									{TAB_LABEL[t]}
								</button>
							))}
						</div>
					) : null}

					{tab === "sale" ? (
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
						<VouchersPanel />
					)}
				</>
			)}
		</div>
	);
}
