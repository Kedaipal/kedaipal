import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useConvex, useMutation, useQuery } from "convex/react";
import {
	AlertCircle,
	CalendarDays,
	Check,
	ChevronRight,
	Download,
	Loader2,
	Package,
	Search,
	ShoppingBag,
	Truck,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { FulfilmentWindow } from "../../convex/lib/fulfilmentDate";
import { INBOX_BUCKETS, type OrderBucket } from "../../convex/lib/orderBuckets";
import {
	isOrderPaymentMethod,
	type OrderPaymentMethod,
} from "../../convex/lib/paymentMethod";
import { ProFeatureTease } from "../components/app/pro-gate";
import { FulfilmentDateBadge } from "../components/dashboard/fulfilment-date-badge";
import {
	type BulkAction,
	OrderBulkBar,
} from "../components/dashboard/order-bulk-bar";
import {
	OrderFilters,
	type OrderFilterValue,
	type PaymentStatus,
} from "../components/dashboard/order-filters";
import { OrderTimeBadge } from "../components/dashboard/order-time-badge";
import { PageHeader } from "../components/dashboard/page-header";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { useDebounce } from "../hooks/useDebounce";
import { downloadCsv } from "../lib/download";
import { convexErrorMessage, formatPrice } from "../lib/format";
import {
	type DeliveryMethod,
	resolveAnchorLabel,
	resolveCurrentStage,
	resolveStages,
	type StatusLabels,
	stageLabel,
} from "../lib/orderStatus";
import { hasFeature } from "../lib/subscription";
import { cn } from "../lib/utils";

type InboxBucket = OrderBucket | "all";
const BUCKET_KEYS: InboxBucket[] = ["all", ...INBOX_BUCKETS.map((b) => b.key)];

function isPaymentStatus(x: unknown): x is PaymentStatus {
	return x === "unpaid" || x === "claimed" || x === "received";
}

// All optional (defaults applied in the component) so links elsewhere can target
// `/app/orders` without specifying search, and defaults stay out of the URL.
type InboxSearch = {
	bucket?: InboxBucket;
	q?: string;
	pay?: PaymentStatus[];
	method?: OrderPaymentMethod[];
	/** Match orders with no recorded payment method. */
	munspec?: boolean;
	from?: number;
	to?: number;
	/** Cross-cutting "needs mockup" toggle. */
	mockup?: boolean;
	/** Fulfilment-date urgency chip (Today / Tomorrow / This week). */
	fwin?: FulfilmentWindow;
};

const FULFILMENT_WINDOWS: { value: FulfilmentWindow; label: string }[] = [
	{ value: "today", label: "Today" },
	{ value: "tomorrow", label: "Tomorrow" },
	{ value: "this_week", label: "This week" },
];
function isFulfilmentWindow(x: unknown): x is FulfilmentWindow {
	return x === "today" || x === "tomorrow" || x === "this_week";
}

export const Route = createFileRoute("/app/orders/")({
	// URL is the source of truth for the view (refresh + share preserve it).
	validateSearch: (search: Record<string, unknown>): InboxSearch => {
		const rawBucket = search.bucket as InboxBucket;
		// undefined ≡ "all" — keeps the default out of the URL.
		const bucket =
			BUCKET_KEYS.includes(rawBucket) && rawBucket !== "all"
				? rawBucket
				: undefined;
		const payRaw = search.pay;
		const payArr = Array.isArray(payRaw)
			? payRaw
			: payRaw != null
				? [payRaw]
				: [];
		const pay = payArr.filter(isPaymentStatus);
		const methodRaw = search.method;
		const methodArr = Array.isArray(methodRaw)
			? methodRaw
			: methodRaw != null
				? [methodRaw]
				: [];
		const method = methodArr.filter(
			(x): x is OrderPaymentMethod =>
				typeof x === "string" && isOrderPaymentMethod(x),
		);
		const q =
			typeof search.q === "string" && search.q.length > 0
				? search.q
				: undefined;
		return {
			bucket,
			q,
			pay: pay.length > 0 ? pay : undefined,
			method: method.length > 0 ? method : undefined,
			munspec:
				search.munspec === true || search.munspec === "true" ? true : undefined,
			from: typeof search.from === "number" ? search.from : undefined,
			to: typeof search.to === "number" ? search.to : undefined,
			mockup:
				search.mockup === true || search.mockup === "true" ? true : undefined,
			fwin: isFulfilmentWindow(search.fwin) ? search.fwin : undefined,
		};
	},
	component: OrdersRoute,
});

type OrderStatus =
	| "pending"
	| "confirmed"
	| "packed"
	| "shipped"
	| "delivered"
	| "cancelled";

const PAGE_SIZE = 50;

function OrdersRoute() {
	const {
		bucket = "all",
		q = "",
		pay = [],
		method = [],
		munspec = false,
		from,
		to,
		mockup = false,
		fwin,
	} = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const retailer = useDashboardRetailer();
	const convex = useConvex();

	const bulkUpdateStatus = useMutation(api.orders.bulkUpdateStatus);
	const [exporting, setExporting] = useState(false);

	const [searchInput, setSearchInput] = useState(q);
	const debounced = useDebounce(searchInput.trim(), 250);
	const [limit, setLimit] = useState(PAGE_SIZE);

	// Multi-select (bulk actions). Checkboxes are always shown; tapping the card
	// still opens the order. Selection clears whenever the view changes (different
	// result set) — see the reset effect below.
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [bulkBusy, setBulkBusy] = useState(false);

	const payKey = pay.join(",");
	const methodKey = method.join(",");
	// Mirror the debounced search into the URL (shareable / survives refresh).
	useEffect(() => {
		navigate({
			search: (prev) => ({ ...prev, q: debounced || undefined }),
			replace: true,
		});
	}, [debounced, navigate]);
	// Any change to the view (bucket / search / filters) resets the page size and
	// clears any selection (the result set is different now).
	// biome-ignore lint/correctness/useExhaustiveDependencies: these are intentional reset triggers, not values read in the body.
	useEffect(() => {
		setLimit(PAGE_SIZE);
		setSelected(new Set());
	}, [bucket, debounced, payKey, methodKey, munspec, from, to, mockup, fwin]);

	// Order Inbox plan gate (Pro+). Starter keeps the plain list + order detail
	// + status updates (the all-tier "Order pipeline"); buckets/search/filters/
	// bulk/export are the gated inbox surfaces — hidden below, and any stale URL
	// filters are ignored so the query only ever sends default args (the server
	// enforces the same line in searchOrders). Admin act-as sees through it.
	const inboxEnabled =
		!retailer ||
		retailer.actingAsAdmin === true ||
		hasFeature(retailer.subscription, "orderInbox");

	const result = useQuery(
		api.orders.searchOrders,
		retailer
			? inboxEnabled
				? {
						retailerId: retailer._id,
						bucket,
						paymentStatuses: pay.length > 0 ? pay : undefined,
						paymentMethods: method.length > 0 ? method : undefined,
						methodUnspecified: munspec || undefined,
						dateFrom: from,
						dateTo: to,
						mockupPending: mockup || undefined,
						fulfilmentWindow: fwin,
						searchText: debounced || undefined,
						limit,
					}
				: { retailerId: retailer._id, bucket: "all", limit }
			: "skip",
	);
	const countsRef = useRef<NonNullable<typeof result>["counts"] | null>(null);

	if (!retailer) return <OrdersInboxSkeleton />;

	const labels = retailer.statusLabels as StatusLabels | undefined;
	const retailerMethod: DeliveryMethod = retailer.offerSelfCollect
		? "self_collect"
		: "delivery";
	const stages = resolveStages({
		orderStages: retailer.orderStages,
		labels,
		deliveryMethod: retailerMethod,
	});

	const loading = result === undefined;
	const orders = result?.orders ?? [];
	// Bucket counts are independent of the active filters, so retain the last
	// known set across refetches — otherwise the chips + "Needs mockup" toggle
	// would flicker out every time a filter changes (the query reloads).
	if (result?.counts) countsRef.current = result.counts;
	const counts = result?.counts ?? countsRef.current ?? undefined;
	const total = result?.total ?? 0;
	const allCount = counts
		? counts.new + counts.in_progress + counts.completed + counts.cancelled
		: undefined;
	const now = Date.now();
	const searching = inboxEnabled && debounced.length > 0;
	const filtersActive =
		inboxEnabled &&
		(pay.length > 0 ||
			method.length > 0 ||
			munspec ||
			from != null ||
			to != null ||
			mockup ||
			fwin != null);

	function setBucket(next: InboxBucket) {
		navigate({
			search: (prev) => ({
				...prev,
				bucket: next === "all" ? undefined : next,
			}),
		});
	}

	function setFwin(next: FulfilmentWindow) {
		// Toggle: tapping the active chip clears it.
		navigate({
			search: (prev) => ({ ...prev, fwin: fwin === next ? undefined : next }),
		});
	}

	function setFilters(next: OrderFilterValue) {
		navigate({
			search: (prev) => ({
				...prev,
				pay: next.payment.length > 0 ? next.payment : undefined,
				method: next.method.length > 0 ? next.method : undefined,
				munspec: next.methodUnspecified ? true : undefined,
				from: next.from,
				to: next.to,
				mockup: next.mockup ? true : undefined,
			}),
		});
	}

	const bucketCount = (key: InboxBucket): number | undefined => {
		if (!counts) return undefined;
		if (key === "all") return allCount;
		return counts[key];
	};

	// --- Bulk multi-select ---------------------------------------------------
	const visibleIds = orders.map((o) => o._id);
	const allSelected =
		visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

	function toggleSelect(id: string) {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}
	function selectAllOnPage() {
		setSelected(allSelected ? new Set() : new Set(visibleIds));
	}
	function clearSelection() {
		setSelected(new Set());
	}

	// Bulk targets — the canonical forward transitions, resolved to the retailer's
	// labels (matching the row badges). "Cancel" is destructive.
	const bulkActions: BulkAction[] = [
		"confirmed",
		"packed",
		"shipped",
		"delivered",
	]
		.map((s) => ({
			status: s as BulkAction["status"],
			label: resolveAnchorLabel(s as OrderStatus, {
				stages,
				labels,
				deliveryMethod: retailerMethod,
				locale: "en",
			}),
		}))
		.concat([
			{ status: "cancelled", label: "Cancel orders", destructive: true },
		] as BulkAction[]);

	async function applyBulk(status: BulkAction["status"]) {
		const ids = [...selected] as Id<"orders">[];
		if (ids.length === 0) return;
		setBulkBusy(true);
		try {
			const res = await bulkUpdateStatus({ orderIds: ids, status });
			toast.success(
				res.skipped > 0
					? `Updated ${res.updated} · skipped ${res.skipped}`
					: `Updated ${res.updated} order${res.updated === 1 ? "" : "s"}`,
			);
			clearSelection();
		} catch (err) {
			toast.error(convexErrorMessage(err));
			// Rethrow so the destructive confirm dialog stays open for a retry; the
			// toast above is the user-facing message (ConfirmDialog swallows this).
			throw err;
		} finally {
			setBulkBusy(false);
		}
	}

	// Export to CSV for bookkeeping. Exports the ticked selection when any rows
	// are selected; otherwise everything matching the active filter (NOT just the
	// loaded page) — the server applies the same predicate as the inbox.
	async function handleExport() {
		if (!retailer) return;
		const selectedIds = [...selected] as Id<"orders">[];
		setExporting(true);
		try {
			const { csv, count, capped } = await convex.action(
				api.orders.exportOrders,
				{
					retailerId: retailer._id,
					bucket,
					paymentStatuses: pay.length > 0 ? pay : undefined,
					paymentMethods: method.length > 0 ? method : undefined,
					methodUnspecified: munspec || undefined,
					dateFrom: from,
					dateTo: to,
					mockupPending: mockup || undefined,
					fulfilmentWindow: fwin,
					searchText: debounced || undefined,
					orderIds: selectedIds.length > 0 ? selectedIds : undefined,
				},
			);
			if (count === 0) {
				toast.message("No orders to export for the current view.");
				return;
			}
			const stamp = new Date().toISOString().slice(0, 10);
			downloadCsv(`orders-${stamp}.csv`, csv);
			if (capped) {
				// The scan hit its safety cap before exhausting matches — the export
				// is the newest slice, not the complete set.
				toast.warning(
					`Exported the latest ${count} orders. Some older orders may be missing — narrow the date range for a complete export.`,
				);
			} else {
				toast.success(`Exported ${count} order${count === 1 ? "" : "s"}`);
			}
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setExporting(false);
		}
	}

	return (
		<div className="flex flex-col gap-4 lg:gap-5">
			<PageHeader
				title="Orders"
				subtitle={
					loading ? "Loading…" : `${total} order${total === 1 ? "" : "s"}`
				}
				actions={
					inboxEnabled ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={handleExport}
							disabled={exporting}
						>
							{exporting ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Download className="size-4" />
							)}
							{selected.size > 0 ? `Export ${selected.size}` : "Export CSV"}
						</Button>
					) : undefined
				}
			/>
			<div className="flex items-center justify-between lg:hidden">
				<div>
					<h2 className="text-xl font-bold">Orders</h2>
					<p className="text-sm text-muted-foreground">
						{loading ? "Loading…" : `${total} total`}
					</p>
				</div>
				{inboxEnabled ? (
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={handleExport}
						disabled={exporting}
					>
						{exporting ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Download className="size-4" />
						)}
						{selected.size > 0 ? `Export ${selected.size}` : "Export CSV"}
					</Button>
				) : null}
			</div>

			{/* Starter: the inbox controls are a Pro feature — say so where they'd
			    be, instead of leaving a silent gap. The order list below still works. */}
			{!inboxEnabled ? (
				<ProFeatureTease message="Buckets, search, filters, bulk actions and CSV export are on Pro — find any order in seconds." />
			) : null}

			{inboxEnabled ? (
				<OrderInboxOverview
					counts={counts}
					allCount={allCount}
					loading={loading}
				/>
			) : null}

			{inboxEnabled ? (
				<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm lg:p-4">
					<div className="grid gap-3 lg:grid-cols-[minmax(18rem,1fr)_auto] lg:items-center">
						<div className="relative">
							<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								value={searchInput}
								onChange={(e) => setSearchInput(e.target.value)}
								placeholder="Search order #, name, phone or item"
								className="h-11 rounded-xl pl-9 pr-9"
								inputMode="search"
							/>
							{searchInput ? (
								<button
									type="button"
									onClick={() => setSearchInput("")}
									className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
									aria-label="Clear search"
								>
									<X className="size-4" />
								</button>
							) : null}
						</div>

						<OrderFilters
							value={{
								payment: pay,
								method,
								methodUnspecified: munspec,
								from,
								to,
								mockup,
							}}
							onChange={setFilters}
							mockupCount={counts?.mockupPending}
						/>
					</div>

					<div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
						{BUCKET_KEYS.map((key) => {
							const label =
								key === "all"
									? "All"
									: (INBOX_BUCKETS.find((b) => b.key === key)?.label ?? key);
							const count = bucketCount(key);
							const active = bucket === key;
							return (
								<button
									key={key}
									type="button"
									onClick={() => setBucket(key)}
									className={cn(
										"flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-3.5 text-sm font-medium transition-colors",
										active
											? "border-accent bg-accent text-accent-foreground"
											: "border-border bg-background text-muted-foreground hover:border-accent/40 hover:text-foreground",
									)}
								>
									{label}
									{count ? (
										<span
											className={cn(
												"flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none",
												active
													? "bg-white/25 text-accent-foreground"
													: key === "new"
														? "bg-orange-500 text-white"
														: "bg-muted text-muted-foreground",
											)}
										>
											{count > 99 ? "99+" : count}
										</span>
									) : null}
								</button>
							);
						})}
					</div>

					{/* Fulfilment-date urgency chips — a primary axis for F&B sellers
				    ("what's due today?"), so they sit inline above the advanced
				    filters, not buried in the filter sheet. */}
					<div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
						<span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
							Due
						</span>
						{FULFILMENT_WINDOWS.map((w) => {
							const active = fwin === w.value;
							return (
								<button
									key={w.value}
									type="button"
									aria-pressed={active}
									onClick={() => setFwin(w.value)}
									className={cn(
										"inline-flex h-10 items-center gap-1.5 rounded-xl border px-3.5 text-sm font-medium transition-colors",
										active
											? "border-accent bg-accent text-accent-foreground"
											: "border-border bg-background text-muted-foreground hover:border-accent/40 hover:text-foreground",
									)}
								>
									<CalendarDays className="size-3.5" aria-hidden="true" />
									{w.label}
								</button>
							);
						})}
					</div>
				</section>
			) : null}

			{/* Selection toolbar — appears once at least one order is ticked. */}
			{selected.size > 0 ? (
				<div className="flex items-center justify-end gap-2">
					<Button
						variant="outline"
						size="sm"
						className="h-8"
						onClick={selectAllOnPage}
					>
						{allSelected ? "Clear all" : "Select all"}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="h-8"
						onClick={clearSelection}
					>
						Done
					</Button>
				</div>
			) : null}

			{loading ? (
				<OrderList.Skeleton />
			) : orders.length === 0 ? (
				<EmptyOrders
					bucket={bucket}
					searching={searching}
					filtersActive={filtersActive}
					mockup={mockup}
				/>
			) : (
				<>
					<ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3">
						{orders.map((o) => {
							const isSel = selected.has(o._id);
							const rowInner = (
								<div className="flex min-w-0 flex-1 flex-col gap-1.5">
									<div className="flex flex-wrap items-center gap-2">
										<span className="font-mono text-sm font-semibold">
											#{o.shortId}
										</span>
										<StatusBadge
											status={o.status as OrderStatus}
											label={(() => {
												const cs = resolveCurrentStage(
													{
														status: o.status,
														currentStageId: o.currentStageId,
													},
													stages,
												);
												return cs
													? stageLabel(cs, "en")
													: resolveAnchorLabel(o.status as OrderStatus, {
															stages,
															labels,
															deliveryMethod: (o.deliveryMethod ??
																"delivery") as DeliveryMethod,
															locale: "en",
														});
											})()}
										/>
										<OrderTimeBadge order={o} now={now} />
										<DeliveryMethodBadge
											method={o.deliveryMethod ?? "delivery"}
										/>
										{o.fulfilmentDate !== undefined ? (
											<FulfilmentDateBadge epoch={o.fulfilmentDate} now={now} />
										) : null}
										{o.mockupStatus === "pending" ||
										o.mockupStatus === "changes_requested" ? (
											<span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
												Mockup pending
											</span>
										) : null}
									</div>
									<div className="flex items-center justify-between gap-2">
										<span className="min-w-0 truncate text-sm text-muted-foreground">
											{o.customer.name ?? "Anonymous"}
											{" · "}
											{o.items.length} item{o.items.length === 1 ? "" : "s"}
										</span>
										<span className="shrink-0 text-sm font-semibold tabular-nums">
											{formatPrice(o.total, o.currency)}
										</span>
									</div>
								</div>
							);
							return (
								<li key={o._id}>
									{/* Always-visible checkbox (its own click target) sits beside
									    the card, which stays a normal link to the order. */}
									<div
										className={cn(
											"group flex items-center gap-3 rounded-2xl border bg-card p-4 transition-all",
											isSel
												? "border-accent ring-1 ring-accent"
												: "border-border hover:border-ring hover:shadow-sm",
										)}
									>
										{/* Multi-select is a bulk-action (inbox) surface — Pro+. */}
										{inboxEnabled ? (
											<button
												type="button"
												aria-pressed={isSel}
												aria-label={`Select order ${o.shortId}`}
												onClick={() => toggleSelect(o._id)}
												className={cn(
													"flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
													isSel
														? "border-accent bg-accent text-accent-foreground"
														: "border-border bg-background hover:border-accent",
												)}
											>
												{isSel ? <Check className="size-3.5" /> : null}
											</button>
										) : null}
										<Link
											to="/app/orders/$shortId"
											params={{ shortId: o.shortId }}
											className="flex min-w-0 flex-1 items-center gap-3"
										>
											{rowInner}
											<ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
										</Link>
									</div>
								</li>
							);
						})}
					</ul>

					{orders.length < total ? (
						<button
							type="button"
							onClick={() => setLimit((n) => n + PAGE_SIZE)}
							className="mx-auto flex h-10 items-center rounded-full border border-border px-5 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
						>
							Load more ({total - orders.length} more)
						</button>
					) : null}
					{selected.size > 0 ? (
						<div className="h-20" aria-hidden="true" />
					) : null}
				</>
			)}

			{selected.size > 0 ? (
				<OrderBulkBar
					count={selected.size}
					actions={bulkActions}
					onApply={applyBulk}
					onClear={clearSelection}
					busy={bulkBusy}
				/>
			) : null}
		</div>
	);
}

/**
 * At-a-glance indicator of how the customer is receiving the order. Sits next
 * to the status badge in each order row so the seller can spot pickup orders
 * (which need a different ops flow — notify store manager, prepare for
 * collection) without opening the detail page.
 */
function DeliveryMethodBadge({
	method,
}: {
	method: "delivery" | "self_collect";
}) {
	const isPickup = method === "self_collect";
	const Icon = isPickup ? Package : Truck;
	return (
		<span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
			<Icon className="size-3" aria-hidden="true" />
			{isPickup ? "Pickup" : "Delivery"}
		</span>
	);
}

function OrderInboxOverview({
	counts,
	allCount,
	loading,
}: {
	counts:
		| {
				new: number;
				in_progress: number;
				completed: number;
				cancelled: number;
				mockupPending: number;
		  }
		| undefined;
	allCount: number | undefined;
	loading: boolean;
}) {
	const stats = [
		{
			label: "New",
			value: counts?.new,
			icon: <AlertCircle className="size-4" />,
			className: "text-orange-700 bg-orange-50 border-orange-200",
		},
		{
			label: "In progress",
			value: counts?.in_progress,
			icon: <Package className="size-4" />,
			className: "text-blue-700 bg-blue-50 border-blue-200",
		},
		{
			label: "Done",
			value: counts?.completed,
			icon: <Check className="size-4" />,
			className: "text-emerald-700 bg-emerald-50 border-emerald-200",
		},
		{
			label: "All orders",
			value: allCount,
			icon: <ShoppingBag className="size-4" />,
			className: "text-foreground bg-muted/50 border-border",
		},
	];

	return (
		<div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
			{stats.map((stat) => (
				<div
					key={stat.label}
					className={cn(
						"flex items-center gap-3 rounded-2xl border px-3 py-3",
						stat.className,
					)}
				>
					<div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/70">
						{stat.icon}
					</div>
					<div className="min-w-0">
						<p className="text-xs font-medium opacity-75">{stat.label}</p>
						<p className="font-mono text-lg font-bold leading-tight">
							{loading || stat.value == null ? "..." : stat.value}
						</p>
					</div>
				</div>
			))}
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

const OrderList = {
	Skeleton() {
		return (
			<ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3">
				{[0, 1, 2, 3, 4].map((n) => (
					<li
						key={n}
						className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
					>
						<div className="flex min-w-0 flex-1 flex-col gap-1.5">
							<div className="flex items-center gap-2">
								<Skeleton className="h-4 w-16 rounded" />
								<Skeleton className="h-4 w-16 rounded-full" />
							</div>
							<div className="flex items-center justify-between">
								<Skeleton className="h-3.5 w-40 rounded" />
								<Skeleton className="h-4 w-16 rounded" />
							</div>
						</div>
						<Skeleton className="size-4 shrink-0 rounded" />
					</li>
				))}
			</ul>
		);
	},
};

function OrdersInboxSkeleton() {
	return (
		<div className="flex flex-col gap-4 lg:gap-5">
			<Skeleton className="h-7 w-28" />
			<Skeleton className="h-11 w-full rounded-xl" />
			<div className="flex gap-2">
				{[64, 88, 96, 80].map((w) => (
					<Skeleton key={w} className="h-9 rounded-full" style={{ width: w }} />
				))}
			</div>
			<OrderList.Skeleton />
		</div>
	);
}

export function StatusBadge({
	status,
	label,
}: {
	status: OrderStatus;
	/**
	 * Resolved display text. Defaults to the raw status (capitalized) when
	 * omitted; pass a resolved label from `resolveStatusLabel` to honour a
	 * retailer's custom stage names. Custom labels keep their own casing, so the
	 * `capitalize` class is only applied to the raw-status fallback.
	 */
	label?: string;
}) {
	return (
		<span
			className={cn(
				"rounded-full px-2 py-0.5 text-[11px] font-semibold",
				label ? "" : "capitalize",
				STATUS_STYLES[status],
			)}
		>
			{label ?? status}
		</span>
	);
}

function EmptyOrders({
	bucket,
	searching,
	filtersActive,
	mockup,
}: {
	bucket: InboxBucket;
	searching: boolean;
	filtersActive: boolean;
	mockup: boolean;
}) {
	const { title, body } = emptyCopy(bucket, searching, filtersActive, mockup);
	return (
		<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
			<div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
				<ShoppingBag className="size-5 text-muted-foreground" />
			</div>
			<div>
				<p className="font-medium">{title}</p>
				<p className="mt-1 max-w-xs text-sm text-muted-foreground">{body}</p>
			</div>
		</div>
	);
}

function emptyCopy(
	bucket: InboxBucket,
	searching: boolean,
	filtersActive: boolean,
	mockup: boolean,
): { title: string; body: string } {
	if (searching)
		return {
			title: "No matches",
			body: "No orders match your search. Try an order #, name, phone, or item.",
		};
	if (mockup)
		return {
			title: "No orders need a mockup",
			body: "You're all caught up — nothing is waiting on a design right now.",
		};
	if (filtersActive)
		return {
			title: "No orders match your filters",
			body: "Adjust or clear the payment / date filters to see more.",
		};
	switch (bucket) {
		case "new":
			return {
				title: "No new orders",
				body: "You're all caught up 🎉 New WhatsApp orders land here first.",
			};
		case "in_progress":
			return {
				title: "Nothing in progress",
				body: "Orders you've confirmed, packed, or shipped will show here.",
			};
		case "completed":
			return {
				title: "No completed orders yet",
				body: "Delivered orders move here once you mark them done.",
			};
		case "cancelled":
			return {
				title: "No cancelled orders",
				body: "Nothing cancelled — good.",
			};
		default:
			return {
				title: "No orders yet",
				body: "When shoppers checkout via WhatsApp, orders will appear here.",
			};
	}
}
