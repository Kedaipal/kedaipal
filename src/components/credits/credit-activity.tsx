import { usePaginatedQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { creditActivityLabel, ordersBalanceLabel } from "../../lib/credits-ui";
import { formatShortDate } from "../../lib/format";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";

const PAGE = 20;

/**
 * Every credit movement, newest first (Credits T3) — so a seller can always
 * answer "why do I have 37 left?": the monthly credits landing, each order,
 * each credit returned, packs, what didn't carry over, what expired. Admin
 * notes never appear here. Paginated (`usePaginatedQuery` stays on
 * convex/react — the adapter has no paginated wrapper).
 */
export function CreditActivity({
	retailer,
}: {
	retailer:
		| { _id: Id<"retailers">; actingAsAdmin?: boolean }
		| null
		| undefined;
}) {
	const actingAsAdmin = retailer?.actingAsAdmin === true;
	const { results, status, loadMore } = usePaginatedQuery(
		api.credits.listActivity,
		retailer
			? { retailerId: actingAsAdmin ? retailer._id : undefined }
			: "skip",
		{ initialNumItems: PAGE },
	);

	return (
		<section
			id="credit-activity"
			className="flex flex-col gap-3 rounded-2xl border border-input bg-background p-5 lg:p-6"
		>
			<div>
				<h2 className="text-sm font-semibold">Credit activity</h2>
				<p className="mt-0.5 text-xs text-muted-foreground">
					Every credit in and out, newest first.
				</p>
			</div>
			{status === "LoadingFirstPage" ? (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</div>
			) : results.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					Nothing yet — your first order will show here.
				</p>
			) : (
				<ul className="divide-y divide-border">
					{results.map((row) => (
						<li
							key={row._id}
							className="flex items-start justify-between gap-3 py-2.5"
						>
							<div className="min-w-0">
								<p className="text-sm">{creditActivityLabel(row)}</p>
								<p className="text-xs text-muted-foreground">
									{formatShortDate(row.createdAt)} ·{" "}
									{ordersBalanceLabel(row.planAfter + row.purchasedAfter)}
								</p>
							</div>
							<span
								className={`shrink-0 text-sm font-medium tabular-nums ${
									row.amount > 0
										? "text-emerald-700 dark:text-emerald-400"
										: "text-muted-foreground"
								}`}
							>
								{row.amount > 0 ? `+${row.amount}` : row.amount}
							</span>
						</li>
					))}
				</ul>
			)}
			{status === "CanLoadMore" || status === "LoadingMore" ? (
				<Button
					variant="outline"
					size="lg"
					className="h-11 w-full sm:h-9 sm:w-fit"
					isLoading={status === "LoadingMore"}
					onClick={() => loadMore(PAGE)}
				>
					Show older
				</Button>
			) : null}
		</section>
	);
}
