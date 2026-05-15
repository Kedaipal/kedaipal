import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ChevronRight, ShoppingBag } from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { Skeleton } from "../components/ui/skeleton";
import { formatPrice } from "../lib/format";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/app/orders/")({
	component: OrdersRoute,
});

const STATUSES = [
	"all",
	"pending",
	"confirmed",
	"packed",
	"shipped",
	"delivered",
	"cancelled",
] as const;
type StatusFilter = (typeof STATUSES)[number];

type OrderStatus = Exclude<StatusFilter, "all">;

function relativeTime(ms: number): string {
	const diff = Date.now() - ms;
	const mins = Math.floor(diff / 60_000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	return `${days}d ago`;
}

function OrdersRoute() {
	const [filter, setFilter] = useState<StatusFilter>("all");
	const retailer = useQuery(api.retailers.getMyRetailer);

	const result = useQuery(
		api.orders.listByRetailer,
		retailer
			? {
					retailerId: retailer._id,
					status: filter === "all" ? undefined : filter,
					paginationOpts: { numItems: 50, cursor: null },
				}
			: "skip",
	);

	const counts = useQuery(
		api.orders.countActionable,
		retailer ? { retailerId: retailer._id } : "skip",
	);

	if (!retailer) return null;

	return (
		<div className="flex flex-col gap-5">
			<div className="flex items-center justify-between">
				<h2 className="text-xl font-bold">Orders</h2>
				{result && result.page.length > 0 && (
					<span className="text-sm text-muted-foreground">
						{result.page.length} order{result.page.length === 1 ? "" : "s"}
					</span>
				)}
			</div>

			<div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:px-0 lg:flex-wrap lg:overflow-visible">
				{STATUSES.map((s) => {
					const badge =
						s === "pending" && counts?.pending
							? counts.pending
							: s === "confirmed" && counts?.confirmed
								? counts.confirmed
								: null;
					return (
						<button
							key={s}
							type="button"
							onClick={() => setFilter(s)}
							className={cn(
								"flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm capitalize transition-colors",
								filter === s
									? "border-foreground bg-foreground text-background"
									: "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground",
							)}
						>
							{s}
							{badge !== null ? (
								<span
									className={cn(
										"flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none",
										filter === s
											? "bg-background text-foreground"
											: s === "pending"
												? "bg-orange-500 text-white"
												: "bg-blue-500 text-white",
									)}
								>
									{badge > 99 ? "99+" : badge}
								</span>
							) : null}
						</button>
					);
				})}
			</div>

			{result === undefined ? (
				<OrderListSkeleton />
			) : result.page.length === 0 ? (
				<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
					<div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
						<ShoppingBag className="size-5 text-muted-foreground" />
					</div>
					<div>
						<p className="font-medium">No orders yet</p>
						<p className="mt-1 text-sm text-muted-foreground">
							When shoppers checkout via WhatsApp, orders will appear here.
						</p>
					</div>
				</div>
			) : (
				<ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3">
					{result.page.map((o) => (
						<li key={o._id}>
							<Link
								to="/app/orders/$shortId"
								params={{ shortId: o.shortId }}
								className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-all hover:border-ring hover:shadow-sm"
							>
								<div className="flex min-w-0 flex-1 flex-col gap-1.5">
									<div className="flex items-center gap-2">
										<span className="font-mono text-sm font-semibold">
											#{o.shortId}
										</span>
										<StatusBadge status={o.status as OrderStatus} />
									</div>
									<div className="flex items-center gap-2 text-sm text-muted-foreground">
										<span className="min-w-0 truncate">
											{o.customer.name ?? "Anonymous"}
											{" · "}
											{o.items.length} item{o.items.length === 1 ? "" : "s"}
										</span>
									</div>
									<div className="flex items-center justify-between">
										<span className="text-[11px] text-muted-foreground">
											{relativeTime(o._creationTime)}
										</span>
										<span className="text-sm font-semibold tabular-nums">
											{formatPrice(o.total, o.currency)}
										</span>
									</div>
								</div>
								<ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
							</Link>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

const STATUS_STYLES: Record<OrderStatus, string> = {
	pending:
		"bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
	confirmed: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
	packed: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
	shipped:
		"bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
	delivered:
		"bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
	cancelled: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

function OrderListSkeleton() {
	return (
		<ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3">
			{[0, 1, 2, 3].map((n) => (
				<li
					key={n}
					className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
				>
					<div className="flex flex-1 flex-col gap-2">
						<div className="flex items-center gap-2">
							<Skeleton className="h-4 w-20 rounded" />
							<Skeleton className="h-5 w-16 rounded-full" />
						</div>
						<Skeleton className="h-3 w-36 rounded" />
						<div className="flex items-center justify-between">
							<Skeleton className="h-3 w-14 rounded" />
							<Skeleton className="h-4 w-16 rounded" />
						</div>
					</div>
					<Skeleton className="h-4 w-4 rounded" />
				</li>
			))}
		</ul>
	);
}

export function StatusBadge({ status }: { status: OrderStatus }) {
	return (
		<span
			className={cn(
				"rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize",
				STATUS_STYLES[status],
			)}
		>
			{status}
		</span>
	);
}
