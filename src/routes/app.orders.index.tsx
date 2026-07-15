import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useConvex, useMutation, useQuery } from "convex/react";
import {
	CalendarDays,
	Check,
	ChevronRight,
	Download,
	ListChecks,
	Loader2,
	Search,
	ShoppingBag,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { FulfilmentWindow } from "../../convex/lib/fulfilmentDate";
import {
	formatStatusAge,
	INBOX_BUCKETS,
	type OrderBucket,
} from "../../convex/lib/orderBuckets";
import {
	isOrderPaymentMethod,
	type OrderPaymentMethod,
} from "../../convex/lib/paymentMethod";
import { ProFeatureTease } from "../components/app/pro-gate";
import {
	DeliveryMethodIcon,
	OrderContextBadge,
} from "../components/dashboard/order-badges";
import {
	type BulkAction,
	OrderBulkBar,
} from "../components/dashboard/order-bulk-bar";
import {
	OrderFilters,
	type OrderFilterValue,
	type OrderSource,
	type PaymentStatus,
} from "../components/dashboard/order-filters";
import { PageHeader } from "../components/dashboard/page-header";
import {
	type OrderStatus,
	StatusBadge,
} from "../components/dashboard/status-badge";
import { Button } from "../components/ui/button";
import { FilterChip, FilterChipRow } from "../components/ui/filter-chip";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { useDebounce } from "../hooks/useDebounce";
import { orderCustomerLabel } from "../lib/customer";
import { downloadCsv } from "../lib/download";
import {
	convexErrorMessage,
	formatOrderTimestamp,
	formatPrice,
} from "../lib/format";
import {
	type DeliveryMethod,
	displayStatusLabel,
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
	/** Fulfilment-date urgency window (Today / Tomorrow / This week). */
	fwin?: FulfilmentWindow;
	/** Checkout surface (online vs counter). */
	source?: OrderSource;
};

function isFulfilmentWindow(x: unknown): x is FulfilmentWindow {
	return x === "today" || x === "tomorrow" || x === "this_week";
}

function isOrderSource(x: unknown): x is OrderSource {
	return x === "storefront" || x === "counter";
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
			source: isOrderSource(search.source) ? search.source : undefined,
		};
	},
	component: OrdersRoute,
});

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
		source,
	} = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const retailer = useDashboardRetailer();
	const convex = useConvex();

	const bulkUpdateStatus = useMutation(api.orders.bulkUpdateStatus);
	const bulkDeleteOrders = useMutation(api.orders.bulkDeleteOrders);
	const [exporting, setExporting] = useState(false);

	const [searchInput, setSearchInput] = useState(q);
	const debounced = useDebounce(searchInput.trim(), 250);
	const [limit, setLimit] = useState(PAGE_SIZE);

	// Multi-select (bulk actions). Checkboxes stay hidden until the seller taps the
	// header "Select" button, so the default card keeps its full width for what
	// sellers scan for (name, money). Selection clears whenever the view changes
	// (different result set).
	const [selectMode, setSelectMode] = useState(false);
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
	}, [
		bucket,
		debounced,
		payKey,
		methodKey,
		munspec,
		from,
		to,
		mockup,
		fwin,
		source,
	]);

	// Order Inbox plan gate (Pro+). Starter keeps the plain list + order detail +
	// status updates (the all-tier "Order pipeline"); buckets/search/filters/bulk/
	// export are the gated inbox surfaces — hidden below, and any stale URL filters
	// are ignored so the query only ever sends default args (the server enforces
	// the same line in searchOrders). Admin act-as sees through it.
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
						source,
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
	// known set across refetches — otherwise the chips + due-today banner would
	// flicker out every time a filter changes (the query reloads).
	if (result?.counts) countsRef.current = result.counts;
	const counts = result?.counts ?? countsRef.current ?? undefined;
	const total = result?.total ?? 0;
	const allCount = counts
		? counts.new + counts.in_progress + counts.completed + counts.cancelled
		: undefined;
	const now = Date.now();
	const searching = debounced.length > 0;
	const filtersActive =
		pay.length > 0 ||
		method.length > 0 ||
		munspec ||
		from != null ||
		to != null ||
		mockup ||
		fwin != null ||
		source != null;

	function setBucket(next: InboxBucket) {
		navigate({
			search: (prev) => ({
				...prev,
				bucket: next === "all" ? undefined : next,
			}),
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
				fwin: next.fwin,
				source: next.source,
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
	function exitSelectMode() {
		setSelectMode(false);
		setSelected(new Set());
	}
	function toggleSelectAll() {
		setSelected(allSelected ? new Set() : new Set(visibleIds));
	}

	// Bulk targets — the canonical forward transitions (resolved to the retailer's
	// labels, matching the row badges) then the destructive Cancel, all in one
	// "Update status" dropdown. No primary/overflow split.
	const bulkActions: BulkAction[] = (
		["confirmed", "packed", "shipped", "delivered"] as const
	)
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
			// Clear the selection but STAY in select mode — the bulk bar (and the
			// Radix layers it owns) must not unmount while a popover/confirm dialog
			// may still be closing, or `pointer-events:none` leaks onto the body and
			// freezes the page. The seller can keep selecting or tap X to exit.
			setSelected(new Set());
		} catch (err) {
			toast.error(convexErrorMessage(err));
			// Rethrow so the destructive confirm dialog stays open for a retry; the
			// toast above is the user-facing message (ConfirmDialog swallows this).
			throw err;
		} finally {
			setBulkBusy(false);
		}
	}

	async function applyBulkDelete() {
		const ids = [...selected] as Id<"orders">[];
		if (ids.length === 0) return;
		setBulkBusy(true);
		try {
			const res = await bulkDeleteOrders({ orderIds: ids });
			toast.success(
				`Deleted ${res.deleted} order${res.deleted === 1 ? "" : "s"}`,
			);
			// Stay in select mode (see applyBulk) — clear the selection only.
			setSelected(new Set());
		} catch (err) {
			toast.error(convexErrorMessage(err));
			// Rethrow so the confirm dialog stays open for a retry.
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
					source,
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

	const headerActions = (
		<>
			<Button
				type="button"
				variant={selectMode ? "secondary" : "outline"}
				size="icon"
				className="size-11 rounded-xl"
				aria-pressed={selectMode}
				aria-label={selectMode ? "Exit select mode" : "Select orders"}
				onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
			>
				<ListChecks className="size-5" />
			</Button>
			<Button
				type="button"
				variant="outline"
				size="icon"
				className="size-11 rounded-xl"
				onClick={handleExport}
				disabled={exporting}
				aria-label={
					selected.size > 0
						? `Export ${selected.size} selected orders`
						: "Export CSV"
				}
			>
				{exporting ? (
					<Loader2 className="size-5 animate-spin" />
				) : (
					<Download className="size-5" />
				)}
			</Button>
		</>
	);

	return (
		<div className="flex flex-col gap-4 lg:gap-5">
			<PageHeader
				title="Orders"
				subtitle={
					loading ? "Loading…" : `${total} order${total === 1 ? "" : "s"}`
				}
				actions={inboxEnabled ? headerActions : undefined}
			/>
			<div className="flex items-center justify-between gap-3 lg:hidden">
				<div className="min-w-0">
					<h2 className="font-heading text-[22px] font-extrabold leading-tight tracking-tight">
						Orders
					</h2>
					<p className="text-[13px] text-muted-foreground">
						{loading ? "Loading…" : `${total} order${total === 1 ? "" : "s"}`}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{inboxEnabled ? headerActions : null}
				</div>
			</div>

			{/* Starter: the inbox controls are a Pro feature — say so where they'd
			    be, instead of leaving a silent gap. The order list below still works. */}
			{!inboxEnabled ? (
				<ProFeatureTease message="Buckets, search, filters, bulk actions and CSV export are on Pro — find any order in seconds." />
			) : null}

			{/* One control surface: search + filter trigger on a row, bucket chips
			    below, applied-filter tokens wrap underneath. Everything else lives
			    in the filter sheet or the contextual banner. */}
			{inboxEnabled ? (
				<section className="flex flex-col gap-3">
					<div className="flex flex-wrap items-center gap-2">
						<div className="relative min-w-0 flex-1">
							<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								value={searchInput}
								onChange={(e) => setSearchInput(e.target.value)}
								placeholder="Order #, name, phone, item"
								className="h-11 rounded-xl border-border bg-card pl-9 pr-9"
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
								fwin,
								source,
							}}
							onChange={setFilters}
							mockupCount={counts?.mockupPending}
							resultCount={loading ? undefined : total}
						/>
					</div>

					<FilterChipRow>
						{BUCKET_KEYS.map((key) => {
							const label =
								key === "all"
									? "All"
									: (INBOX_BUCKETS.find((b) => b.key === key)?.label ?? key);
							return (
								<FilterChip
									key={key}
									selected={bucket === key}
									onClick={() => setBucket(key)}
									count={bucketCount(key)}
									countTone={key === "new" ? "attention" : "muted"}
								>
									{label}
								</FilterChip>
							);
						})}
					</FilterChipRow>
				</section>
			) : null}

			{/* Contextual due-today banner — only appears when something is due and
			    the seller isn't already looking at it. Tapping filters the list.
			    Gated with the inbox (a filter shortcut Starter can't act on). */}
			{inboxEnabled &&
			!loading &&
			(counts?.dueToday ?? 0) > 0 &&
			fwin !== "today" ? (
				<button
					type="button"
					onClick={() =>
						navigate({ search: (prev) => ({ ...prev, fwin: "today" }) })
					}
					className="flex items-center gap-2.5 rounded-2xl bg-foreground px-4 py-3 text-left text-background transition-opacity hover:opacity-95"
				>
					<CalendarDays
						className="size-5 shrink-0 text-accent"
						aria-hidden="true"
					/>
					<span className="min-w-0 flex-1 text-sm font-semibold">
						{counts?.dueToday} order{(counts?.dueToday ?? 0) === 1 ? "" : "s"}{" "}
						due <span className="kp-highlight">today</span>
					</span>
					<span className="shrink-0 text-sm font-bold text-accent">Show →</span>
				</button>
			) : null}

			{/* Select-mode hint — the persistent bottom bar carries the actions
			    (count, Select all, Update status, exit). */}
			{selectMode ? (
				<p className="text-sm font-medium text-muted-foreground">
					Tap orders to select, then choose a status below.
				</p>
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
							const statusLabel = (() => {
								const cs = resolveCurrentStage(
									{
										status: o.status,
										currentStageId: o.currentStageId,
									},
									stages,
								);
								const resolved = cs
									? stageLabel(cs, "en")
									: resolveAnchorLabel(o.status as OrderStatus, {
											stages,
											labels,
											deliveryMethod: (o.deliveryMethod ??
												"delivery") as DeliveryMethod,
											locale: "en",
										});
								// Counter sales complete "at the counter", not via delivery —
								// their done state reads "Completed", never "Delivered".
								return displayStatusLabel(
									{ status: o.status as OrderStatus, source: o.source },
									resolved,
								);
							})();
							const placedAt = formatOrderTimestamp(o.createdAt, now);
							const age = formatStatusAge(now - o.createdAt);
							const cardInner = (
								<div className="min-w-0 flex-1">
									{/* Name + money get the hierarchy. */}
									<div className="flex items-center justify-between gap-2.5">
										<span className="min-w-0 truncate text-[15px] font-semibold">
											{orderCustomerLabel(o.customer)}
										</span>
										<span className="shrink-0 text-[15px] font-bold tabular-nums">
											{formatPrice(o.total, o.currency)}
										</span>
									</div>
									<div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-muted-foreground">
										<span className="font-mono">#{o.shortId}</span>
										<span aria-hidden="true">·</span>
										{/* Absolute placed-at datetime + relative age, so the seller
										    reads "when" AND "how long ago" without opening the
										    detail. Item count moved off the card (it's on detail). */}
										<span className="tabular-nums">{placedAt}</span>
										<span>({age === "just now" ? age : `${age} ago`})</span>
									</div>
									<div className="mt-2.5 flex items-center gap-1.5">
										<StatusBadge
											status={o.status as OrderStatus}
											label={statusLabel}
										/>
										<OrderContextBadge order={o} now={now} />
										<span className="ml-auto flex items-center gap-1.5">
											<DeliveryMethodIcon
												method={o.deliveryMethod ?? "delivery"}
											/>
											{!selectMode ? (
												<ChevronRight
													className="size-4.5 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5"
													aria-hidden="true"
												/>
											) : null}
										</span>
									</div>
								</div>
							);
							const cardClass = cn(
								"group flex w-full items-start gap-3 rounded-2xl border bg-card p-3.5 text-left transition-all",
								isSel
									? "border-accent shadow-[0_0_0_3px_hsl(160_84%_39%/0.12)]"
									: "border-border hover:border-ring hover:shadow-sm",
							);
							return (
								<li key={o._id}>
									{selectMode ? (
										<button
											type="button"
											aria-pressed={isSel}
											aria-label={`Select order ${o.shortId}`}
											onClick={() => toggleSelect(o._id)}
											className={cardClass}
										>
											<span
												aria-hidden="true"
												className={cn(
													"mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-lg border transition-colors",
													isSel
														? "border-accent bg-accent text-accent-foreground"
														: "border-border bg-background",
												)}
											>
												{isSel ? <Check className="size-3.5" /> : null}
											</span>
											{cardInner}
										</button>
									) : (
										<Link
											to="/app/orders/$shortId"
											params={{ shortId: o.shortId }}
											className={cardClass}
										>
											{cardInner}
										</Link>
									)}
								</li>
							);
						})}
					</ul>

					{orders.length < total ? (
						<button
							type="button"
							onClick={() => setLimit((n) => n + PAGE_SIZE)}
							className="mx-auto flex h-11 items-center rounded-full border border-border px-5 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
						>
							Load more ({total - orders.length} more)
						</button>
					) : null}
					{selectMode ? <div className="h-24" aria-hidden="true" /> : null}
				</>
			)}

			{/* Mounted for the whole of select mode (not gated on a selection) so
			    the Radix layers it owns close cleanly — see OrderBulkBar. */}
			{selectMode ? (
				<OrderBulkBar
					count={selected.size}
					actions={bulkActions}
					allSelected={allSelected}
					onApply={applyBulk}
					onDelete={applyBulkDelete}
					onToggleSelectAll={toggleSelectAll}
					onExit={exitSelectMode}
					busy={bulkBusy}
				/>
			) : null}
		</div>
	);
}

const OrderList = {
	Skeleton() {
		return (
			<ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3">
				{[0, 1, 2, 3, 4].map((n) => (
					<li
						key={n}
						className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3.5"
					>
						<div className="flex items-center justify-between">
							<Skeleton className="h-4 w-32 rounded" />
							<Skeleton className="h-4 w-16 rounded" />
						</div>
						<Skeleton className="h-3.5 w-40 rounded" />
						<div className="flex items-center gap-1.5">
							<Skeleton className="h-6 w-20 rounded-full" />
							<Skeleton className="h-6 w-24 rounded-full" />
						</div>
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
					<Skeleton
						key={w}
						className="h-10 rounded-full"
						style={{ width: w }}
					/>
				))}
			</div>
			<OrderList.Skeleton />
		</div>
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
			body: "Adjust or clear the filters to see more.",
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
