// The seller directory's phone shape (z8r3fdh37c): the same facts as a table
// row, stacked, with 44px copy targets and a full-width Manage door. Rendered
// under `lg` (useIsDesktop); desktop gets SellerTable.
import type { AdminSellerRow } from "../../../convex/admin";
import {
	sellerBucket,
	sellerExpiry,
	sellerPlanLabel,
	sellerRail,
	sellerReason,
} from "../../lib/admin-seller-view";
import { cn } from "../../lib/utils";
import {
	ContactLine,
	ExpiryText,
	FoundingPill,
	StatusPill,
	ViaPill,
} from "./seller-cells";
import { SellerManageMenu } from "./seller-manage-menu";

export function SellerCard({
	seller,
	purgeEnabled,
	onViewDetails,
	now,
}: {
	seller: AdminSellerRow;
	purgeEnabled: boolean;
	onViewDetails: (seller: AdminSellerRow) => void;
	now: number;
}) {
	const bucket = sellerBucket(seller);
	const reason = sellerReason(seller);
	const rail = sellerRail(seller);
	return (
		<li
			data-seller={seller.slug}
			className={cn(
				"flex flex-col gap-3 rounded-2xl border border-border bg-card p-4",
				seller.purging && "opacity-60",
			)}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="flex min-w-0 flex-col gap-0.5">
					<div className="flex min-w-0 items-center gap-2">
						<button
							type="button"
							onClick={() => onViewDetails(seller)}
							className="truncate rounded text-left text-base font-semibold focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
						>
							{seller.storeName}
						</button>
						{seller.foundingMemberRank !== undefined ? (
							<FoundingPill rank={seller.foundingMemberRank} />
						) : null}
					</div>
					<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
						<span className="truncate font-mono text-xs text-muted-foreground">
							/{seller.slug}
						</span>
						<ViaPill seller={seller} />
					</div>
				</div>
				<StatusPill bucket={bucket} />
			</div>

			<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
				<span className="font-semibold">{sellerPlanLabel(seller)}</span>
				{rail ? <span className="text-muted-foreground">{rail}</span> : null}
				{reason ? (
					<span className="basis-full text-xs text-muted-foreground">
						{reason}
					</span>
				) : null}
			</div>

			<ExpiryText
				expiry={sellerExpiry(seller, now)}
				className="flex-row items-baseline gap-2"
			/>

			<div className="flex flex-col divide-y divide-border/60 border-t border-border/60">
				<ContactLine kind="email" value={seller.ownerEmail} />
				<ContactLine kind="whatsapp" value={seller.waPhone} />
			</div>

			<SellerManageMenu
				seller={seller}
				purgeEnabled={purgeEnabled}
				onViewDetails={onViewDetails}
				className="w-full"
			/>
		</li>
	);
}
