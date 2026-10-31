import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	formatSharedUses,
	formatVoucherMoment,
	SHARED_USES_LISTED,
} from "../../../convex/lib/vouchers";
import { formatPrice, formatRelativeTime } from "../../lib/format";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { Skeleton } from "../ui/skeleton";

/** The shared code the dialog is listing uses for — the row's own fields. */
export interface UsesDialogVoucher {
	id: Id<"vouchers">;
	code: string;
	currency: string;
	maxRedemptions?: number;
	redeemedCount?: number;
	endsAt?: number;
}

/**
 * "Who used SALE345" (`z8r3fducfm`) — the orders that spent a SHARED code,
 * newest first, each linking to its order page.
 *
 * A dialog rather than an inline expansion because the list is a READ of
 * order data and loads on demand: expanding thirty rows inline would fire
 * thirty queries for a question the seller asks of one code at a time. Gated
 * orders are already absent from the server's answer (`forSeller`), so a
 * count that exceeds the rows shown is said plainly rather than left as a
 * puzzle. A very large code lists only its latest `SHARED_USES_LISTED` uses,
 * and says so — the count-minus-rows sentence would otherwise blame credits
 * for thousands of orders that are simply further down.
 */
export function VoucherUsesDialog({
	voucher,
	onClose,
}: {
	voucher: UsesDialogVoucher | null;
	onClose: () => void;
}) {
	const uses = useQuery(
		convexQuery(
			api.vouchers.listRedemptions,
			voucher ? { voucherId: voucher.id } : "skip",
		),
	).data;
	const rows = uses?.orders;

	return (
		<Dialog open={voucher !== null} onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="sm:max-w-md">
				{voucher ? (
					<>
						<DialogHeader>
							<DialogTitle className="flex items-center gap-2">
								<Users className="size-4 text-muted-foreground" aria-hidden />
								Orders that used{" "}
								<code className="font-mono tracking-wider">{voucher.code}</code>
							</DialogTitle>
							<DialogDescription>
								{formatSharedUses(voucher)}
								{voucher.endsAt
									? ` · ends ${formatVoucherMoment(voucher.endsAt)}`
									: ""}
							</DialogDescription>
						</DialogHeader>

						{rows === undefined ? (
							<ul className="flex flex-col gap-2">
								{[0, 1, 2].map((n) => (
									<li
										key={n}
										className="flex items-center justify-between gap-3"
									>
										<Skeleton className="h-4 w-28 rounded" />
										<Skeleton className="h-4 w-16 rounded" />
									</li>
								))}
							</ul>
						) : rows.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								{(voucher.redeemedCount ?? 0) > 0
									? // The count says uses exist, the list is empty: every one
										// of them is a waiting order you can't see yet (credits),
										// or has since been deleted.
										"These orders are waiting on credits, so they're not shown here yet."
									: "No orders have used this code yet."}
							</p>
						) : (
							<ul className="flex flex-col divide-y divide-border/70">
								{rows.map((row) => (
									<li
										key={row.shortId}
										className="flex items-center justify-between gap-3 py-2.5"
									>
										<div className="flex min-w-0 flex-col">
											<Link
												to="/app/orders/$shortId"
												params={{ shortId: row.shortId }}
												className="tap-target flex items-center font-semibold text-accent-emphasis hover:underline"
											>
												{row.shortId}
											</Link>
											<span className="text-xs text-muted-foreground">
												{formatRelativeTime(row.redeemedAt)}
											</span>
										</div>
										<span className="shrink-0 text-sm font-semibold">
											{formatPrice(row.total, voucher.currency)}
										</span>
									</li>
								))}
								{uses?.limited ? (
									<li className="pt-2.5 text-xs text-muted-foreground">
										Showing the latest {SHARED_USES_LISTED} orders.
									</li>
								) : rows.length < (voucher.redeemedCount ?? 0) ? (
									<li className="pt-2.5 text-xs text-muted-foreground">
										{(voucher.redeemedCount ?? 0) - rows.length} more{" "}
										{(voucher.redeemedCount ?? 0) - rows.length === 1
											? "order is"
											: "orders are"}{" "}
										waiting on credits and not shown yet.
									</li>
								) : null}
							</ul>
						)}
					</>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
