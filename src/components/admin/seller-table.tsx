// The seller directory's desktop shape (z8r3fdh37c): one row per store with
// the contact, status, plan and expiry facts side by side, every contact
// copyable in place. Rendered only at `lg+` (useIsDesktop); phones get
// SellerCard. Both read the same view-model, so a fact reads identically here
// and on a card.
import type { AdminSellerRow } from "../../../convex/admin";
import {
	sellerBucket,
	sellerExpiry,
	sellerPlanLabel,
	sellerSeatsLabel,
	sellerRail,
	sellerReason,
} from "../../lib/admin-seller-view";
import { cn } from "../../lib/utils";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../ui/table";
import {
	ContactLine,
	ExpiryText,
	FoundingPill,
	StatusPill,
	ViaPill,
} from "./seller-cells";
import { SellerManageMenu } from "./seller-manage-menu";

export function SellerTable({
	sellers,
	purgeEnabled,
	onViewDetails,
	now,
}: {
	sellers: readonly AdminSellerRow[];
	purgeEnabled: boolean;
	onViewDetails: (seller: AdminSellerRow) => void;
	now: number;
}) {
	return (
		// `table-fixed` so the column widths below are honoured and long
		// cells truncate inside them — an auto layout let the contact column
		// push Expires and Manage off the right edge at 1440px, let alone on
		// a 13" laptop (design-system.md, desktop density trap 3).
		<Table
			className="table-fixed"
			wrapperClassName="rounded-2xl border border-border bg-card"
		>
			<TableHeader>
				<TableRow className="bg-muted/40 hover:bg-muted/40">
					<TableHead className="w-[22%] pl-4">Store</TableHead>
					<TableHead className="w-[25%]">Owner contact</TableHead>
					<TableHead className="w-[13%]">Status</TableHead>
					<TableHead className="w-[11%]">Plan</TableHead>
					<TableHead className="w-[8%]">Seats</TableHead>
					<TableHead className="w-[16%]">Expires / renews</TableHead>
					<TableHead className="w-[112px] pr-4 text-right">
						<span className="sr-only">Actions</span>
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{sellers.map((seller) => (
					<SellerTableRow
						key={seller._id}
						seller={seller}
						purgeEnabled={purgeEnabled}
						onViewDetails={onViewDetails}
						now={now}
					/>
				))}
			</TableBody>
		</Table>
	);
}

function SellerTableRow({
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
	const expiry = sellerExpiry(seller, now);
	return (
		<TableRow
			data-seller={seller.slug}
			className={cn("align-middle", seller.purging && "opacity-60")}
		>
			<TableCell className="py-3 pl-4">
				<div className="flex min-w-0 flex-col gap-0.5">
					<div className="flex min-w-0 items-center gap-2">
						{/* The name opens the read-only sheet — never act-as, so a
						    mis-click costs nothing (owner decision, 20 Sep 2026). */}
						<button
							type="button"
							onClick={() => onViewDetails(seller)}
							className="truncate rounded text-left text-[15px] font-semibold hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
						>
							{seller.storeName}
						</button>
						{seller.foundingMemberRank !== undefined ? (
							<FoundingPill rank={seller.foundingMemberRank} />
						) : null}
					</div>
					<div className="flex min-w-0 items-center gap-2">
						<span className="truncate font-mono text-xs text-muted-foreground">
							/{seller.slug}
						</span>
						<ViaPill seller={seller} />
					</div>
				</div>
			</TableCell>
			<TableCell className="py-2">
				<div className="flex min-w-0 flex-col">
					<ContactLine kind="email" value={seller.ownerEmail} compact />
					<ContactLine kind="whatsapp" value={seller.waPhone} compact />
				</div>
			</TableCell>
			<TableCell className="py-3">
				<div className="flex min-w-0 flex-col items-start gap-1">
					<StatusPill bucket={bucket} />
					{reason ? (
						<span
							className="max-w-full truncate text-[11px] text-muted-foreground"
							title={reason}
						>
							{reason}
						</span>
					) : null}
				</div>
			</TableCell>
			<TableCell className="py-3">
				<div className="flex min-w-0 flex-col gap-0.5">
					<span className="text-sm font-semibold">
						{sellerPlanLabel(seller)}
					</span>
					<span
						className="truncate text-[11px] text-muted-foreground"
						title={sellerRail(seller)}
					>
						{sellerRail(seller)}
					</span>
				</div>
			</TableCell>
			<TableCell className="py-3">
				<span className="text-sm">{sellerSeatsLabel(seller)}</span>
			</TableCell>
			<TableCell className="py-3">
				<ExpiryText expiry={expiry} />
			</TableCell>
			<TableCell className="py-2 pr-4">
				<div className="flex justify-end">
					<SellerManageMenu
						seller={seller}
						purgeEnabled={purgeEnabled}
						onViewDetails={onViewDetails}
						className="h-9 px-3"
					/>
				</div>
			</TableCell>
		</TableRow>
	);
}
