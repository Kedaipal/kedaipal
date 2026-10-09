import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Plus, Ticket } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { DEFAULT_CURRENCY } from "../../convex/lib/currency";
import type { VoucherStatus } from "../../convex/lib/vouchers";
import { NeedsAccessNote } from "../components/app/owner-only-note";
import { PageHeader } from "../components/dashboard/page-header";
import { Button } from "../components/ui/button";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { FilterChip, FilterChipRow } from "../components/ui/filter-chip";
import { IssueVoucherDialog } from "../components/vouchers/issue-voucher-dialog";
import {
	VoucherList,
	VoucherListSkeleton,
	type VoucherRowView,
} from "../components/vouchers/voucher-list";
import {
	type ShareableVoucher,
	VoucherShareSheet,
} from "../components/vouchers/voucher-share-sheet";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { usePermission } from "../hooks/usePermission";
import { isStoreReadOnly, isVoucherIssuingLocked } from "../lib/subscription";

/**
 * Vouchers (`z8r3fdr617`) — the seller's issue-and-track surface.
 *
 * Its own nav entry, between Customers and Insights: the list reads "who my
 * buyers are → what I've offered them → how it's going". It is not a settings
 * tab (nothing here is configuration — these are live promises with money
 * attached) and not a tab under Products (a voucher is not a product).
 *
 * The route is NOT plan-walled, unlike Customers and Insights. Issuing is the
 * Pro capability; the LIST is not, because a store that drops to Starter still
 * has outstanding codes it has to honour and must be able to see and void
 * them. So the gate lands on one button, with its reason beside it.
 */

export const Route = createFileRoute("/app/vouchers/")({
	component: VouchersRoute,
});

const FILTERS: Array<{ key: VoucherStatus | "all"; label: string }> = [
	{ key: "active", label: "Active" },
	{ key: "redeemed", label: "Used" },
	{ key: "expired", label: "Expired" },
	{ key: "voided", label: "Voided" },
	{ key: "all", label: "All" },
];

function VouchersRoute() {
	const retailer = useDashboardRetailer();
	const { canRead, canWrite } = usePermission("vouchers");
	const [filter, setFilter] = useState<VoucherStatus | "all">("active");
	const [issuing, setIssuing] = useState(false);
	const [sharing, setSharing] = useState<ShareableVoucher | null>(null);
	const [voiding, setVoiding] = useState<VoucherRowView | null>(null);
	const voidVoucher = useMutation(api.vouchers.voidVoucher);

	const result = useQuery(
		convexQuery(
			api.vouchers.list,
			retailer && canRead
				? {
						retailerId: retailer._id,
						...(filter === "all" ? {} : { status: filter }),
					}
				: "skip",
		),
	).data;

	if (!retailer) return null;

	// No grant at all → the note IS the surface (the query is skipped, so a
	// disabled body would sit over skeletons that never resolve).
	if (!canRead) {
		return (
			<div className="flex flex-col gap-5 lg:gap-6">
				<PageHeader title="Vouchers" />
				<NeedsAccessNote area="vouchers" level="read" />
			</div>
		);
	}

	const currency = retailer.currency ?? DEFAULT_CURRENCY;
	const loading = result === undefined;
	const vouchers = result?.vouchers ?? [];
	const counts = result?.counts;
	const issuingLocked = isVoucherIssuingLocked(retailer);
	const storeReadOnly = isStoreReadOnly(retailer);
	// One reason, resolved in priority order, shown wherever the button is.
	const issueBlockedReason = !canWrite
		? "Ask the store owner for edit access to vouchers."
		: storeReadOnly
			? "Your store is view-only until the subscription is settled."
			: issuingLocked
				? "Issuing vouchers is part of the Pro plan — you can still share and void the codes you've already created."
				: null;

	const subtitle = loading
		? "Loading…"
		: counts
			? `${counts.active} active · ${counts.redeemed} used`
			: undefined;

	async function confirmVoid() {
		if (!voiding) return;
		try {
			await voidVoucher({ voucherId: voiding.id });
			toast.success(`${voiding.code} voided — it won't redeem any more`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Couldn't void it");
		} finally {
			setVoiding(null);
		}
	}

	const issueButton = (
		<Button
			className="tap-target gap-1.5"
			onClick={() => setIssuing(true)}
			disabled={issueBlockedReason !== null}
		>
			<Plus className="size-4" aria-hidden />
			New voucher
		</Button>
	);

	return (
		<div className="flex flex-col gap-5 lg:gap-6">
			<PageHeader title="Vouchers" subtitle={subtitle} actions={issueButton} />
			<div className="flex min-w-0 items-start justify-between gap-3 lg:hidden">
				<div className="flex min-w-0 flex-col">
					<h2 className="font-heading text-[22px] font-extrabold leading-tight tracking-tight">
						Vouchers
					</h2>
					<p className="text-[13px] text-muted-foreground">
						{subtitle ?? "Single-use discount codes"}
					</p>
				</div>
				{issueButton}
			</div>

			{/* The gate's reason, where the seller is clicking — never a silent
			    disabled button. */}
			{issueBlockedReason !== null ? (
				<p className="rounded-xl border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
					{issueBlockedReason}
				</p>
			) : null}

			{/* Filter chips carry their counts, so a chip can show its number
			    while its tab is empty. */}
			<FilterChipRow>
				{FILTERS.map((f) => (
					<FilterChip
						key={f.key}
						selected={filter === f.key}
						onClick={() => setFilter(f.key)}
						count={
							counts
								? f.key === "all"
									? counts.active +
										counts.redeemed +
										counts.expired +
										counts.voided
									: counts[f.key]
								: undefined
						}
					>
						{f.label}
					</FilterChip>
				))}
			</FilterChipRow>

			{loading ? (
				<VoucherListSkeleton />
			) : vouchers.length === 0 ? (
				<EmptyState filter={filter} everIssued={hasAny(counts)} />
			) : (
				<VoucherList
					vouchers={vouchers}
					canWrite={canWrite && !storeReadOnly}
					onShare={(v) => setSharing(v)}
					onVoid={(v) => setVoiding(v)}
				/>
			)}

			<IssueVoucherDialog
				open={issuing}
				onClose={() => setIssuing(false)}
				retailerId={retailer._id}
				currency={currency}
				onIssued={(created) => {
					// A single voucher goes straight to the share sheet — issuing and
					// sending are one errand. A BATCH doesn't: there is no one code to
					// share, and the list is where a run is worked through.
					if (created.length === 1) {
						setFilter("active");
						const row = created[0];
						setSharing({ ...row, currency } as ShareableVoucher);
					} else {
						setFilter("active");
					}
				}}
			/>

			<VoucherShareSheet
				voucher={sharing}
				storeName={retailer.storeName}
				slug={retailer.slug}
				onClose={() => setSharing(null)}
			/>

			<ConfirmDialog
				open={voiding !== null}
				onOpenChange={(o) => !o && setVoiding(null)}
				title={`Void ${voiding?.code ?? ""}?`}
				description="The code stops working straight away. It stays in your list with its history, and anyone you've already sent it to will be told it's no longer valid."
				confirmLabel="Void it"
				destructive
				onConfirm={confirmVoid}
			/>
		</div>
	);
}

function hasAny(counts: Record<VoucherStatus, number> | undefined): boolean {
	if (!counts) return false;
	return counts.active + counts.redeemed + counts.expired + counts.voided > 0;
}

/**
 * Two genuinely different empties. A store with no vouchers at all needs to be
 * told what they're FOR; a filter with no matches needs to be told it's the
 * filter, not the store — otherwise someone whose codes are all spent reads
 * "no vouchers yet" and thinks they lost them.
 */
function EmptyState({
	filter,
	everIssued,
}: {
	filter: VoucherStatus | "all";
	everIssued: boolean;
}) {
	const filtered = everIssued && filter !== "all";
	return (
		<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
			<div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
				<Ticket className="size-5 text-muted-foreground" aria-hidden />
			</div>
			{filtered ? (
				<div>
					<p className="font-medium">No {labelFor(filter)} vouchers</p>
					<p className="mt-1 text-sm text-muted-foreground">
						Your other vouchers are under the different filters above.
					</p>
				</div>
			) : (
				<div className="max-w-sm">
					<p className="font-medium">No vouchers yet</p>
					<p className="mt-1 text-sm text-muted-foreground">
						A voucher is a single-use code you give one buyer — say, to make up
						for a late order, or as a giveaway at a stall. They enter it at
						checkout, or show you its QR at the counter.
					</p>
				</div>
			)}
		</div>
	);
}

function labelFor(filter: VoucherStatus | "all"): string {
	return (
		FILTERS.find((f) => f.key === filter)?.label.toLowerCase() ?? "matching"
	);
}
