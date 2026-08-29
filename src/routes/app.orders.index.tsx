import { convexQuery } from "@convex-dev/react-query";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";
import { useConvex, useMutation } from "convex/react";
import {
	ArrowUpDown,
	CalendarDays,
	Check,
	ChevronDown,
	ChevronRight,
	Download,
	LayoutGrid,
	ListChecks,
	Loader2,
	Pin,
	Rows3,
	Search,
	ShoppingBag,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { sanitizeAttributionSource } from "../../convex/lib/attribution";
import { resolveAwbConfig } from "../../convex/lib/awbConfig";
import type { FulfilmentWindow } from "../../convex/lib/fulfilmentDate";
import {
	formatStatusAge,
	INBOX_BUCKETS,
	type OrderBucket,
} from "../../convex/lib/orderBuckets";
import { ORDER_COLUMNS, type OrderColumnKey } from "../../convex/lib/orderCsv";
import {
	type InboxSort,
	sortInboxOrders,
} from "../../convex/lib/orderInboxFilter";
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
	buildOrderColumnFilters,
	METHOD_UNSPECIFIED,
	type OrderColumnFilterState,
} from "../components/dashboard/order-column-filters";
import { OrderColumnPicker } from "../components/dashboard/order-column-picker";
import {
	OrderFilters,
	type OrderFilterValue,
	type OrderSource,
	type PaymentStatus,
} from "../components/dashboard/order-filters";
import { OrderTable } from "../components/dashboard/order-table";
import { PageHeader } from "../components/dashboard/page-header";
import { PrintLabelsDialog } from "../components/dashboard/print-labels-dialog";
import { ReadyToShipStrip } from "../components/dashboard/ready-to-ship-strip";
import { StatusBadge } from "../components/dashboard/status-badge";
import { Button } from "../components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { FilterChip, FilterChipRow } from "../components/ui/filter-chip";
import { Input } from "../components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "../components/ui/popover";
import { Skeleton } from "../components/ui/skeleton";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { useDebounce } from "../hooks/useDebounce";
import {
	type InboxView,
	resolveInboxView,
	useInboxView,
} from "../hooks/useInboxView";
import { useOrderColumns } from "../hooks/useOrderColumns";
import { canHardDeleteOrders } from "../lib/admin-actions";
import { MASK_PII } from "../lib/analytics-privacy";
import { describeAwbPaper } from "../lib/awb-labels";
import { orderCustomerLabel } from "../lib/customer";
import { downloadCsv } from "../lib/download";
import {
	convexErrorMessage,
	formatOrderTimestamp,
	formatPrice,
} from "../lib/format";
import { summarizeOrderCardItems } from "../lib/order-card-items";
import {
	type DeliveryMethod,
	displayStatusLabel,
	ORDER_STATUS_KEYS,
	type OrderStatus,
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
	/** Workflow buckets to keep — MULTI since 86eyrtz74, repeated in the URL
	 * like `pay`/`st`. Absent = every bucket ("All"). A single value still
	 * parses (`?bucket=new` — every deep link and old bookmark), it just lands
	 * in a one-element list. */
	bucket?: OrderBucket[];
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
	/** Checkout surfaces to keep (online / counter / claim link). MULTI since
	 * 86eyrtz74 — "everything that isn't a walk-in" is a real question that one
	 * value can't ask. A legacy singular `?source=` is still read and folded in,
	 * so old bookmarks keep working. */
	sources?: OrderSource[];
	/** Exact order statuses to keep (86eyrtz74) — repeated in the URL like
	 * `pay`/`method`. A separate, finer dimension from `bucket`: the bucket is
	 * the coarse stage you navigate by, this is the precise one you question. */
	st?: OrderStatus[];
	/** Frozen line categories to keep (86eyrtz74). Free-form seller names. */
	cat?: string[];
	/** Keep orders with NO frozen categories (PR #235 review) — the twin of
	 * `munspec`. Without it, selecting every category silently drops them. */
	catunspec?: boolean;
	/** Marketing origins to keep (86eyq0eq9) — `attributionBucket` keys. Repeated
	 * in the URL (`?asrc=tiktok&asrc=direct`) so a filtered inbox is shareable
	 * and survives refresh, same as `pay`/`method`. */
	asrc?: string[];
	/** List order. Default "recent" is kept out of the URL; only "due" is stored. */
	sort?: InboxSort;
	/** Card list vs table (86eyrtz74), both available at every width.
	 *
	 * The one search param that does NOT follow the "defaults stay out of the
	 * URL" convention: BOTH values are written, because absent now means "use the
	 * view I was last in" (`useInboxView`), not "cards". Writing only "table"
	 * would leave a seller who prefers the table with no way to send — or to
	 * pin — a cards link. A named view always wins over the remembered one, so a
	 * shared link opens the layout it was sent in. */
	view?: InboxView;
	/** Table view's per-column sort: the column key, and `tdesc` for direction
	 * (86eyrtz74). In the URL — unlike column layout, which is a 36-toggle
	 * preference and lives in localStorage — because "these orders, sorted by
	 * total" is a view worth sharing, the same reason `bucket` and `sort` are
	 * here. Ignored in cards view, which keeps the `sort` popover. */
	tsort?: string;
	tdesc?: boolean;
	/** Pin privilege OFF (86eyrtz74). Inverted on purpose: keeping pins visible
	 * is the default, so only the non-default reaches the URL — the same rule
	 * `sort` and `bucket` follow. */
	nopin?: boolean;
};

function isFulfilmentWindow(x: unknown): x is FulfilmentWindow {
	return x === "today" || x === "tomorrow" || x === "this_week";
}

function isOrderSource(x: unknown): x is OrderSource {
	return x === "storefront" || x === "counter" || x === "claim";
}

function isOrderStatusKey(x: unknown): x is OrderStatus {
	return ORDER_STATUS_KEYS.includes(x as OrderStatus);
}

/** A repeated search param arrives as a value, an array, or nothing. */
function toList(raw: unknown): unknown[] {
	return Array.isArray(raw) ? raw : raw != null ? [raw] : [];
}

export const Route = createFileRoute("/app/orders/")({
	// URL is the source of truth for what the seller is LOOKING AT — bucket,
	// filters, search, sort — so refresh and share both preserve it. The one
	// exception is `view`, the layout: that falls back to a remembered
	// preference when the URL doesn't name one (see InboxSearch.view).
	validateSearch: (search: Record<string, unknown>): InboxSearch => {
		// undefined ≡ "All" — keeps the default out of the URL. The legacy "all"
		// sentinel is simply dropped from the list rather than special-cased.
		const bucket = [
			...new Set(
				toList(search.bucket).filter(
					(x): x is OrderBucket =>
						BUCKET_KEYS.includes(x as InboxBucket) && x !== "all",
				),
			),
		];
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
		// Free-form tags, so there is no allowlist to check against — sanitize
		// with the SAME function that stamped them, which makes a hand-edited or
		// stale URL land on the identical bucket key the order carries.
		const asrcRaw = search.asrc;
		const asrcArr = Array.isArray(asrcRaw)
			? asrcRaw
			: asrcRaw != null
				? [asrcRaw]
				: [];
		const asrc = [
			...new Set(
				asrcArr.flatMap((x) => {
					const clean =
						typeof x === "string" ? sanitizeAttributionSource(x) : undefined;
					return clean ? [clean] : [];
				}),
			),
		];
		const sources = [
			...new Set(
				[...toList(search.sources), ...toList(search.source)].filter(
					isOrderSource,
				),
			),
		];
		const st = [...new Set(toList(search.st).filter(isOrderStatusKey))];
		// Category names are the seller's own words — no allowlist to validate
		// against, so they are only de-duplicated and length-capped. An unknown
		// name simply matches nothing, which is the honest outcome for a stale
		// link to a category that has since been renamed.
		const cat = [
			...new Set(
				toList(search.cat).flatMap((x) =>
					typeof x === "string" && x.length > 0 && x.length <= 120 ? [x] : [],
				),
			),
		];
		const q =
			typeof search.q === "string" && search.q.length > 0
				? search.q
				: undefined;
		return {
			bucket: bucket.length > 0 ? bucket : undefined,
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
			// A pre-widen `?source=counter` folds into the list, so a bookmark or a
			// link shared before this shipped still filters (86eyrtz74).
			sources: sources.length > 0 ? sources : undefined,
			st: st.length > 0 ? st : undefined,
			cat: cat.length > 0 ? cat : undefined,
			catunspec:
				search.catunspec === true || search.catunspec === "true"
					? true
					: undefined,
			asrc: asrc.length > 0 ? asrc : undefined,
			// Only the non-default ("due") is stored; "recent" stays out of the URL.
			sort: search.sort === "due" ? "due" : undefined,
			// Both values survive (see InboxSearch.view) — absent means "the view
			// this seller last used", which is a different thing from "cards".
			view:
				search.view === "table" || search.view === "cards"
					? search.view
					: undefined,
			// Validated against the registry so a hand-edited or stale key can
			// never put the table into an unsortable state.
			tsort:
				typeof search.tsort === "string" &&
				ORDER_COLUMNS.some((c) => c.key === search.tsort)
					? search.tsort
					: undefined,
			tdesc:
				search.tdesc === true || search.tdesc === "true" ? true : undefined,
			nopin:
				search.nopin === true || search.nopin === "true" ? true : undefined,
		};
	},
	component: OrdersRoute,
});

const PAGE_SIZE = 50;

// The inbox sort options. Default is "recent" (kept out of the URL) — see the
// InboxSort docs in convex/lib/orderInboxFilter.ts for why newest-first is the
// default and due-date is the opt-in.
const INBOX_SORTS: {
	value: InboxSort;
	/** Menu-row label. */
	label: string;
	/** Compact label on the trigger button. */
	short: string;
	/** One-line helper under the menu row. */
	hint: string;
}[] = [
	{
		value: "recent",
		label: "Newest first",
		short: "Newest",
		hint: "Most recently received",
	},
	{
		value: "due",
		label: "Due date",
		short: "Due date",
		hint: "Soonest fulfilment first",
	},
];

function OrdersRoute() {
	const {
		bucket: buckets = [],
		q = "",
		pay = [],
		method = [],
		munspec = false,
		asrc = [],
		from,
		to,
		mockup = false,
		fwin,
		sources = [],
		st = [],
		cat = [],
		catunspec = false,
		sort = "recent",
		view: urlView,
		nopin = false,
		tsort,
		tdesc = false,
	} = Route.useSearch();
	// TanStack Table's own sorting shape, derived from the URL so a sorted table
	// survives refresh and can be shared.
	const tableSorting: SortingState = tsort ? [{ id: tsort, desc: tdesc }] : [];
	// Pin privilege is ON unless the seller explicitly turned it off (see the
	// `nopin` search param) — pins outranking the filter is the default because
	// that is the case they pin FOR: park an order on top, filter to something
	// else, compare.
	const showPinned = !nopin;
	const navigate = useNavigate({ from: Route.fullPath });
	const retailer = useDashboardRetailer();
	const convex = useConvex();

	const bulkUpdateStatus = useMutation(api.orders.bulkUpdateStatus);
	const bulkDeleteOrders = useMutation(api.orders.bulkDeleteOrders);
	const setPinned = useMutation(api.orders.setPinned);
	const [pinBusyId, setPinBusyId] = useState<string | null>(null);
	const [exporting, setExporting] = useState(false);
	// Despatch-label print dialog for the ticked selection (86eyp63mp).
	const [printOpen, setPrintOpen] = useState(false);

	const [searchInput, setSearchInput] = useState(q);
	const debounced = useDebounce(searchInput.trim(), 250);
	// How many of the fetched window to render. Pagination is purely client-side:
	// the query returns the whole filtered+sorted window as a stable subscription,
	// so "Load more" just reveals more of it — no re-scan, no re-query. Reset to
	// the first page whenever the view (bucket / search / filters) changes.
	const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
	const [sortOpen, setSortOpen] = useState(false);

	// Multi-select (bulk actions). Checkboxes stay hidden until the seller taps the
	// header "Select" button, so the default card keeps its full width for what
	// sellers scan for (name, money). Selection clears whenever the view changes
	// (different result set).
	const [selectMode, setSelectMode] = useState(false);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [bulkBusy, setBulkBusy] = useState(false);
	// Column visibility for the table view, persisted per store on this device.
	// Keyed on "" while the retailer is still loading so the hook order is stable
	// across the early return below.
	const columnState = useOrderColumns(retailer?._id ?? "");
	// The remembered layout, same storage posture as the columns above. A view
	// named in the URL wins; otherwise the seller resumes where they left off,
	// and cards is only the fallback for someone who has never chosen.
	const { stored: storedView, remember: rememberView } = useInboxView(
		retailer?._id ?? "",
	);
	// Order Inbox plan gate (Pro+). Starter keeps the plain list + order detail +
	// status updates (the all-tier "Order pipeline"); buckets/search/filters/bulk/
	// export are the gated inbox surfaces — hidden below, and any stale URL filters
	// are ignored so the query only ever sends default args (the server enforces
	// the same line in searchOrders). Admin act-as sees through it.
	//
	// Declared HERE, above the view resolution, because the table is one of those
	// gated surfaces: see resolveInboxView for why a gated seller is put back in
	// cards rather than left in a table whose filters do nothing.
	const inboxEnabled =
		!retailer ||
		retailer.actingAsAdmin === true ||
		hasFeature(retailer.subscription, "orderInbox");
	const view = resolveInboxView(urlView, storedView, inboxEnabled);

	const bucketKey = buckets.join(",");
	const payKey = pay.join(",");
	const methodKey = method.join(",");
	const asrcKey = asrc.join(",");
	const sourcesKey = sources.join(",");
	const stKey = st.join(",");
	const catKey = cat.join(",");
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
		setVisibleCount(PAGE_SIZE);
		setSelected(new Set());
	}, [
		bucketKey,
		debounced,
		payKey,
		methodKey,
		asrcKey,
		munspec,
		from,
		to,
		mockup,
		fwin,
		sourcesKey,
		stKey,
		catKey,
		catunspec,
		// Re-sorting is a view change too — jump back to the top of the new order.
		sort,
		// Toggling pin privilege changes which rows are in the set.
		nopin,
	]);

	// Permanent hard delete (single + bulk) is admin-only (Kedaipal support); a
	// plain seller only ever cancels. Same shared gate as order detail — see
	// `canHardDeleteOrders`. The server is the real guard.
	const amIAdmin = useQuery(convexQuery(api.billing.amIAdmin, {})).data;
	const canHardDelete = canHardDeleteOrders({
		actingAsAdmin: retailer?.actingAsAdmin,
		amIAdmin,
	});

	// `placeholderData: keepPreviousData` is load-bearing, not an optimisation.
	//
	// Every filter, search or bucket change rewrites the query ARGS, which makes
	// a new TanStack Query key, which means `data` is `undefined` until the new
	// Convex subscription resolves. Without this the whole list unmounts into a
	// skeleton and remounts on every single click — the seller sees the page
	// "refresh", loses their scroll position, and an open header-filter dropdown
	// is torn down mid-selection, which makes picking a second value impossible.
	//
	// Keeping the previous page means the rows stay put and only their contents
	// change. The trade is one beat of stale rows under an already-active filter
	// chip, which `refreshing` below owns up to.
	const ordersQuery = useQuery({
		...convexQuery(
			api.orders.searchOrders,
			retailer
				? inboxEnabled
					? {
							retailerId: retailer._id,
							buckets: buckets.length > 0 ? buckets : undefined,
							paymentStatuses: pay.length > 0 ? pay : undefined,
							paymentMethods: method.length > 0 ? method : undefined,
							methodUnspecified: munspec || undefined,
							dateFrom: from,
							dateTo: to,
							mockupPending: mockup || undefined,
							fulfilmentWindow: fwin,
							sources: sources.length > 0 ? sources : undefined,
							statuses: st.length > 0 ? st : undefined,
							categories: cat.length > 0 ? cat : undefined,
							categoriesUnspecified: catunspec || undefined,
							attributionSources: asrc.length > 0 ? asrc : undefined,
							searchText: debounced || undefined,
							// Pins keep their privilege in the live inbox AND in the
							// export below — the two must send the same value or the CSV
							// would hold different rows than the screen it came from.
							showPinned: showPinned || undefined,
							// No limit → stable full-window subscription; we paginate below
							// by slicing to `visibleCount`, so "Load more" never re-queries.
						}
					: { retailerId: retailer._id }
				: "skip",
		),
		placeholderData: keepPreviousData,
	});
	const result = ordersQuery.data;
	/** Showing the PREVIOUS result while a new one loads. Drives the quiet
	 * pending state on the list — a spinner or skeleton here would reintroduce
	 * exactly the flash this is here to remove. */
	const refreshing = ordersQuery.isPlaceholderData;

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
	// The query returns the whole filtered window, newest-first. We apply the sort
	// toggle here (client-side, so switching Newest ⇄ Due date is instant — no
	// re-query), then render only the first `visibleCount` and grow that on
	// "Load more". Sorting ≤1,000 rows per render is negligible.
	const orders = result?.orders ?? [];
	const orderedOrders = sortInboxOrders(orders, sort);
	const visibleOrders = orderedOrders.slice(0, visibleCount);
	// The scan hit its ceiling — orders older than the newest 1,000 aren't in the
	// window, so the list and the counts under-report. Surfaced in the footer.
	const capped = result?.capped ?? false;
	// Bucket counts are independent of the active filters. They used to be held
	// in a ref across refetches, because the chips and the due-today banner
	// flickered out every time a filter changed — a hand-rolled fix for one
	// symptom of the query reloading. `keepPreviousData` above cures the cause
	// for the whole page, so the ref is gone rather than left as a second
	// mechanism doing the same job less well.
	const counts = result?.counts;
	const total = result?.total ?? 0;
	const pinnedCount = counts?.pinned ?? 0;
	const selectionHasPinned = visibleOrders.some(
		(o) => selected.has(o._id) && o.pinnedAt !== undefined,
	);

	// Resolve one order's status label (honouring the retailer's custom stage
	// names, and the counter "Completed" wording). Shared by the card and the
	// table so the same order can never read differently in the two views.
	function statusLabelFor(o: {
		status: string;
		currentStageId?: string;
		deliveryMethod?: string;
		source?: string;
	}): string {
		const cs = resolveCurrentStage(
			{ status: o.status as OrderStatus, currentStageId: o.currentStageId },
			stages,
		);
		const resolved = cs
			? stageLabel(cs, "en")
			: resolveAnchorLabel(o.status as OrderStatus, {
					stages,
					labels,
					deliveryMethod: (o.deliveryMethod ?? "delivery") as DeliveryMethod,
					locale: "en",
				});
		// Counter sales complete "at the counter", not via delivery — their done
		// state reads "Completed", never "Delivered".
		return displayStatusLabel(
			{
				status: o.status as OrderStatus,
				source: o.source as "storefront" | "counter" | "claim" | undefined,
			},
			resolved,
		);
	}
	// Header filters (86eyrtz74) — built here because this is where the URL state,
	// the server's facet counts and the retailer's own stage wording all meet;
	// the table itself stays presentational.
	// Header filters (86eyrtz74) — built here because this is where the URL state,
	// the server's facet counts and the retailer's own stage wording all meet;
	// the table itself stays presentational. Deliberately NOT memoised: it would
	// have to sit above the `!retailer` early return to be a legal hook, and
	// rebuilding six short option arrays per render is not worth restructuring
	// the component for.
	const headerFilters = buildOrderColumnFilters({
		state: {
			statuses: st,
			categories: cat,
			categoriesUnspecified: catunspec,
			sources,
			paymentStatuses: pay,
			paymentMethods: munspec ? [...method, METHOD_UNSPECIFIED] : method,
			attributionSources: asrc,
			fulfilmentWindow: fwin,
		},
		facets: result?.facets,
		availableSources: result?.availableSources ?? [],
		availableCategories: result?.availableCategories ?? [],
		country: retailer.country,
		// The same resolver the Status column renders with, so the filter offers
		// the seller's own stage words rather than our internal keys.
		statusLabel: (status) => statusLabelFor({ status }),
		onApply: applyColumnFilter,
	});

	// Table view is available at EVERY width (owner call, 28 Aug). The first
	// build gated it to `lg` and up on the grounds that a wide table can't fit a
	// phone — but a seller away from their desk still wants the scan-many-orders
	// view, and a horizontally scrolling table is a normal mobile pattern. So the
	// table scrolls inside its own container (never the page) and its controls
	// grow to 44px touch targets below `lg`, rather than the view being withheld.
	const tableView = view === "table";
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
		sources.length > 0 ||
		st.length > 0 ||
		cat.length > 0 ||
		catunspec ||
		asrc.length > 0;

	function toggleBucket(next: InboxBucket) {
		navigate({
			// `replace`, like every other multi-select: a set is built one tap at a
			// time, and each push was a history entry plus (via scrollRestoration) a
			// scroll-to-top. The chips stopped being single-shot navigation when
			// they stopped being single-select.
			replace: true,
			search: (prev) => {
				// "All" is the escape hatch, not a member: it clears the set.
				if (next === "all") return { ...prev, bucket: undefined };
				const has = buckets.includes(next);
				const list = has
					? buckets.filter((b) => b !== next)
					: [...buckets, next];
				return { ...prev, bucket: list.length > 0 ? list : undefined };
			},
		});
	}

	function setShowPinned(next: boolean) {
		navigate({
			// Default (on) stays out of the URL; only the opt-out is persisted.
			search: (prev) => ({ ...prev, nopin: next ? undefined : true }),
		});
	}

	function setTableSorting(next: SortingState) {
		const first = next[0];
		navigate({
			// Cleared sort leaves the URL clean; ascending is the default direction
			// so only `desc` is persisted — the `sort`/`bucket` convention.
			search: (prev) => ({
				...prev,
				tsort: first?.id,
				tdesc: first?.desc ? true : undefined,
			}),
		});
	}

	function setView(next: InboxView) {
		// Remembered AND written to the URL: the memory is what survives leaving
		// the page, the URL is what survives sharing it. Both values go in — see
		// InboxSearch.view for why this param breaks the defaults-stay-out rule.
		rememberView(next);
		navigate({ search: (prev) => ({ ...prev, view: next }) });
	}

	function setSort(next: InboxSort) {
		navigate({
			// Default ("recent") stays out of the URL; only "due" is persisted.
			search: (prev) => ({ ...prev, sort: next === "due" ? "due" : undefined }),
		});
	}

	/**
	 * Apply a header-filter change. Every dimension lands in the URL exactly
	 * where the filter panel already puts it, so the two surfaces are one state
	 * rather than two that must be kept in step — and the CSV export, which
	 * re-reads these same params, can't come back with different rows than the
	 * screen it was launched from.
	 */
	function applyColumnFilter(patch: Partial<OrderColumnFilterState>) {
		navigate({
			// REPLACE, not push. Two reasons, both about how filters are actually
			// used: a multi-select is built one tick at a time, so pushing would
			// leave six history entries behind a single act of filtering; and the
			// router has `scrollRestoration`, which has no cached position for a new
			// entry and therefore scrolls to the top on every tick — the list
			// jumping under the seller while a dropdown is open reads as the page
			// reloading. `replace` keeps the entry, so the scroll stays put. Matches
			// the debounced search box, which has always replaced for the same
			// reason — and the bucket chips, which joined it when they went
			// multi-select (86eyrtz74).
			replace: true,
			search: (prev) => {
				const next = { ...prev };
				if (patch.statuses)
					next.st =
						patch.statuses.length > 0
							? (patch.statuses as OrderStatus[])
							: undefined;
				if (patch.categories)
					next.cat = patch.categories.length > 0 ? patch.categories : undefined;
				if ("categoriesUnspecified" in patch)
					next.catunspec = patch.categoriesUnspecified ? true : undefined;
				if (patch.sources)
					next.sources =
						patch.sources.length > 0
							? (patch.sources as OrderSource[])
							: undefined;
				if (patch.paymentStatuses)
					next.pay =
						patch.paymentStatuses.length > 0
							? (patch.paymentStatuses as PaymentStatus[])
							: undefined;
				if (patch.paymentMethods) {
					// Split the picker's "" sentinel back into the boolean the URL and
					// the predicate have always used for "no method recorded".
					const concrete = patch.paymentMethods.filter(
						(m): m is OrderPaymentMethod =>
							m !== METHOD_UNSPECIFIED && isOrderPaymentMethod(m),
					);
					next.method = concrete.length > 0 ? concrete : undefined;
					next.munspec = patch.paymentMethods.includes(METHOD_UNSPECIFIED)
						? true
						: undefined;
				}
				if (patch.attributionSources)
					next.asrc =
						patch.attributionSources.length > 0
							? patch.attributionSources
							: undefined;
				if ("fulfilmentWindow" in patch) next.fwin = patch.fulfilmentWindow;
				return next;
			},
		});
	}

	/** Drop every filter, keeping the bucket, the search term and the view — a
	 * seller who lands on "nothing matches" wants their filters gone, not their
	 * place in the app. */
	function clearAllFilters() {
		navigate({
			replace: true,
			search: (prev) => ({
				...prev,
				pay: undefined,
				method: undefined,
				munspec: undefined,
				from: undefined,
				to: undefined,
				mockup: undefined,
				fwin: undefined,
				sources: undefined,
				st: undefined,
				cat: undefined,
				catunspec: undefined,
				asrc: undefined,
			}),
		});
	}

	function setFilters(next: OrderFilterValue) {
		navigate({
			// Same reasoning as applyColumnFilter: the panel is ticked several times
			// per visit, and each tick was its own history entry and its own scroll
			// jump.
			replace: true,
			search: (prev) => ({
				...prev,
				pay: next.payment.length > 0 ? next.payment : undefined,
				method: next.method.length > 0 ? next.method : undefined,
				munspec: next.methodUnspecified ? true : undefined,
				from: next.from,
				to: next.to,
				mockup: next.mockup ? true : undefined,
				fwin: next.fwin,
				asrc:
					next.attributionSources.length > 0
						? next.attributionSources
						: undefined,
				sources: next.sources.length > 0 ? next.sources : undefined,
				st:
					next.statuses.length > 0
						? (next.statuses as OrderStatus[])
						: undefined,
				cat: next.categories.length > 0 ? next.categories : undefined,
				catunspec: next.categoriesUnspecified ? true : undefined,
			}),
		});
	}

	const bucketCount = (key: InboxBucket): number | undefined => {
		if (!counts) return undefined;
		if (key === "all") return allCount;
		return counts[key];
	};

	// --- Bulk multi-select ---------------------------------------------------
	// "Select all" targets the rows actually on screen (the revealed window), not
	// the un-rendered tail — so the selection always matches what the seller sees.
	const visibleIds = visibleOrders.map((o) => o._id);
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
			// Name the actionable skip reasons — a bare "skipped 2" leaves the
			// seller guessing why their bulk action half-worked.
			const skipReasons = [
				res.skippedAwaitingCollection > 0
					? `${res.skippedAwaitingCollection} still with your customer`
					: null,
				res.skippedRiderManaged > 0
					? `${res.skippedRiderManaged} with a rider on the way`
					: null,
			].filter(Boolean);
			toast.success(
				res.skipped > 0
					? `Updated ${res.updated} · skipped ${res.skipped}${
							skipReasons.length > 0 ? ` (${skipReasons.join(", ")})` : ""
						}`
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

	// Pin / unpin one order (86eyrtz74). `pinned` is the desired end state, not a
	// toggle instruction, so a double-tap can't flip it back.
	async function togglePin(o: { _id: string; pinnedAt?: number }) {
		setPinBusyId(o._id);
		try {
			await setPinned({
				orderId: o._id as Id<"orders">,
				pinned: o.pinnedAt === undefined,
			});
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setPinBusyId(null);
		}
	}

	// Bulk unpin — the escape hatch for a pin set that has grown. Pins never
	// auto-clear (owner decision: a delivered order can still be worth keeping on
	// top), so clearing them has to be cheap; this reuses the selection flow the
	// seller already knows rather than inventing a "Clear all" control.
	async function applyBulkUnpin() {
		const targets = visibleOrders.filter(
			(o) => selected.has(o._id) && o.pinnedAt !== undefined,
		);
		if (targets.length === 0) return;
		setBulkBusy(true);
		try {
			await Promise.all(
				targets.map((o) =>
					setPinned({ orderId: o._id as Id<"orders">, pinned: false }),
				),
			);
			toast.success(
				`Unpinned ${targets.length} order${targets.length === 1 ? "" : "s"}`,
			);
			setSelected(new Set());
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBulkBusy(false);
		}
	}

	// Export to CSV for bookkeeping. Exports the ticked selection when any rows
	// are selected; otherwise everything matching the active filter (NOT just the
	// loaded page) — the server applies the same predicate as the inbox.
	// `onlyVisibleColumns` comes from the table view's export menu: a seller who
	// has curated seven columns usually means those seven. From the cards view
	// there is no column selection to honour, so the caller passes false and the
	// server exports every column.
	async function handleExport(onlyVisibleColumns = false) {
		if (!retailer) return;
		const selectedIds = [...selected] as Id<"orders">[];
		setExporting(true);
		try {
			const { csv, count, capped } = await convex.action(
				api.orders.exportOrders,
				{
					retailerId: retailer._id,
					buckets: buckets.length > 0 ? buckets : undefined,
					paymentStatuses: pay.length > 0 ? pay : undefined,
					paymentMethods: method.length > 0 ? method : undefined,
					methodUnspecified: munspec || undefined,
					dateFrom: from,
					dateTo: to,
					mockupPending: mockup || undefined,
					fulfilmentWindow: fwin,
					sources: sources.length > 0 ? sources : undefined,
					statuses: st.length > 0 ? st : undefined,
					categories: cat.length > 0 ? cat : undefined,
					categoriesUnspecified: catunspec || undefined,
					attributionSources: asrc.length > 0 ? asrc : undefined,
					searchText: debounced || undefined,
					showPinned: showPinned || undefined,
					orderIds: selectedIds.length > 0 ? selectedIds : undefined,
					columnKeys: onlyVisibleColumns ? columnState.visibleKeys : undefined,
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
			{/* View switch, leading the header cluster (86eyrtz74). It sits HERE and
			    not in the search row because Cards/Table, Select and Export are one
			    family — things you do TO the list — while search, sort and filters
			    narrow it. Keeping the two families apart is also what stops the
			    search row running out of width on a phone, which is how this
			    started: five controls in one row squeezed the input to its own
			    padding. A segmented control rather than a dropdown: two options,
			    both worth showing, and the current one reads at a glance. */}
			<div className="flex h-11 shrink-0 items-center rounded-xl border border-border bg-muted/60 p-0.5">
				{(
					[
						{ value: "cards", label: "Cards", Icon: LayoutGrid },
						{ value: "table", label: "Table", Icon: Rows3 },
					] as const
				).map(({ value, label, Icon }) => {
					const active = view === value;
					return (
						<button
							key={value}
							type="button"
							aria-pressed={active}
							aria-label={`${label} view`}
							title={`${label} view`}
							onClick={() => setView(value)}
							className={cn(
								"flex size-10 items-center justify-center rounded-[10px] transition-colors",
								active
									? "bg-background text-foreground shadow-sm"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							<Icon className="size-4.5" aria-hidden="true" />
						</button>
					);
				})}
			</div>
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
			{/* In TABLE view the export becomes a two-item menu: a seller looking
			    at seven curated columns usually means those seven, but a
			    bookkeeper's file usually means all of them, and a dialog on every
			    export would tax a path they hit often. The counts make the choice
			    self-explanatory, so it costs one extra tap and no reading.
			    In CARDS view there is no column selection to honour, so it stays a
			    plain one-tap button that exports everything. */}
			{tableView ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="outline"
							size="icon"
							className="size-11 rounded-xl"
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
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-64">
						<DropdownMenuItem onSelect={() => void handleExport(true)}>
							Export visible columns ({columnState.visibleKeys.length})
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => void handleExport(false)}>
							Export all columns ({ORDER_COLUMNS.length})
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			) : (
				<Button
					type="button"
					variant="outline"
					size="icon"
					className="size-11 rounded-xl"
					onClick={() => void handleExport(false)}
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
			)}
		</>
	);

	return (
		<div className="flex flex-col gap-4 lg:gap-5">
			<PageHeader
				title="Orders"
				subtitle={
					loading
						? "Loading…"
						: refreshing
							? "Updating…"
							: `${total} order${total === 1 ? "" : "s"}`
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

						{/* Sort — the fix for "due orders bury my new ones". Default is
						    Newest first (matches WhatsApp/Shopee); Due date is the opt-in
						    fulfilment-queue view. Applied client-side, so it's instant.
						    HIDDEN in table view: every column header there is its own
						    sort control, and two controls fighting over one ordering is
						    worse than either. This is also what buys back the width the
						    column picker takes. */}
						{tableView ? null : (
							<Popover open={sortOpen} onOpenChange={setSortOpen}>
								<PopoverTrigger asChild>
									<button
										type="button"
										aria-label={`Sort: ${
											INBOX_SORTS.find((s) => s.value === sort)?.label
										}`}
										// Icon-only on the narrowest screens: the label and chevron
										// cost ~70px that the search input needs more. From `sm:`
										// up there is room to name the current sort.
										className="flex h-11 w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-border bg-card text-sm font-medium text-foreground transition-colors hover:border-accent/40 sm:w-auto sm:px-3"
									>
										<ArrowUpDown
											className="size-4.5 text-muted-foreground sm:size-4"
											aria-hidden="true"
										/>
										<span className="hidden whitespace-nowrap sm:inline">
											{INBOX_SORTS.find((s) => s.value === sort)?.short}
										</span>
										<ChevronDown
											className="hidden size-4 text-muted-foreground sm:block"
											aria-hidden="true"
										/>
									</button>
								</PopoverTrigger>
								<PopoverContent align="end" className="w-60 p-1">
									<p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
										Sort by
									</p>
									<div className="flex flex-col">
										{INBOX_SORTS.map((opt) => {
											const active = opt.value === sort;
											return (
												<button
													key={opt.value}
													type="button"
													onClick={() => {
														setSort(opt.value);
														setSortOpen(false);
													}}
													className={cn(
														"flex items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted",
														active && "bg-muted",
													)}
												>
													<Check
														className={cn(
															"size-4 shrink-0 text-accent",
															active ? "opacity-100" : "opacity-0",
														)}
														aria-hidden="true"
													/>
													<span className="min-w-0">
														<span className="block text-sm font-medium">
															{opt.label}
														</span>
														<span className="block text-xs text-muted-foreground">
															{opt.hint}
														</span>
													</span>
												</button>
											);
										})}
									</div>
								</PopoverContent>
							</Popover>
						)}

						<OrderFilters
							value={{
								payment: pay,
								method,
								methodUnspecified: munspec,
								from,
								to,
								mockup,
								fwin,
								sources,
								statuses: st,
								categories: cat,
								categoriesUnspecified: catunspec,
								attributionSources: asrc,
							}}
							onChange={setFilters}
							country={retailer.country}
							availableSources={result?.availableSources}
							availableCategories={result?.availableCategories}
							facets={result?.facets}
							// One resolver for both surfaces, so the panel and the Status
							// column can never call the same state two different things.
							statusLabel={(status) => statusLabelFor({ status })}
							mockupCount={counts?.mockupPending}
							resultCount={loading ? undefined : total}
						/>
					</div>

					{/* The chip row scrolls; the column picker does NOT. It sits
					    outside the scroller and holds the right edge, so a control that
					    only exists in table view can't scroll off a phone and become
					    undiscoverable. It lives here rather than in the search row
					    because it configures the TABLE, not the result set — the same
					    reason the view switch moved up into the header. */}
					<div className="flex items-center gap-2">
						<FilterChipRow className="min-w-0 flex-1">
							{/* Pin privilege, leading the row (86eyrtz74). It is FIRST because
						    it is the seller's OWN urgency marker — the buckets below are
						    the system's opinion, this one is theirs. It appears only once
						    something is pinned: a permanent "Pinned 0" is noise, and the
						    pin control on every row is the surface that teaches the
						    feature. Turning it off doesn't hide pins, it just stops them
						    outranking the filter. */}
							{pinnedCount > 0 ? (
								<FilterChip
									tone="accent"
									selected={showPinned}
									onClick={() => setShowPinned(!showPinned)}
									count={pinnedCount}
									title={
										showPinned
											? "Pinned orders stay on top, even when they don't match your filters. Tap to filter them like any other order."
											: "Pinned orders are being filtered like any other order. Tap to keep them on top."
									}
								>
									<Pin
										className="size-3.5"
										fill={showPinned ? "currentColor" : "none"}
										aria-hidden="true"
									/>
									Pinned
								</FilterChip>
							) : null}
							{BUCKET_KEYS.map((key) => {
								const label =
									key === "all"
										? "All"
										: (INBOX_BUCKETS.find((b) => b.key === key)?.label ?? key);
								return (
									<FilterChip
										key={key}
										// Multi-select (86eyrtz74): each bucket chip toggles
										// membership; "All" is lit only while the set is empty,
										// and tapping it empties the set.
										selected={
											key === "all"
												? buckets.length === 0
												: buckets.includes(key)
										}
										onClick={() => toggleBucket(key)}
										count={bucketCount(key)}
										countTone={key === "new" ? "attention" : "muted"}
									>
										{label}
									</FilterChip>
								);
							})}
						</FilterChipRow>
						{tableView ? (
							<OrderColumnPicker
								isVisible={columnState.isVisible}
								onToggle={columnState.toggle}
								onSetMany={columnState.setManyVisible}
								onReset={columnState.reset}
								visibleCount={columnState.visibleKeys.length}
								isCustomised={columnState.isCustomised}
							/>
						) : null}
					</div>
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
					className="flex items-center gap-2.5 rounded-2xl bg-foreground dark:border dark:border-accent/30 dark:bg-accent/12 px-4 py-3 text-left text-background dark:text-foreground transition-opacity hover:opacity-95"
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

			{/* Despatch queue (86eyp63mp) — below the due-today banner because a
			    deadline outranks a task you can finish whenever you like. Shown
			    even at zero (with a disabled button + the reason): the count is how
			    a seller learns the feature exists. Held back until the counts land,
			    so it never claims an empty queue before it knows. Hidden for
			    pickup-only stores, which have no parcels to label, and it rides the
			    same Order Inbox plan gate as the bulk actions it sits with. */}
			{inboxEnabled &&
			!loading &&
			retailer &&
			(retailer.offerDelivery ?? true) ? (
				<ReadyToShipStrip
					retailerId={retailer._id}
					count={counts?.readyToShip ?? 0}
					paperLabel={describeAwbPaper(
						resolveAwbConfig(retailer.awbConfig).paperSize,
					)}
				/>
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
			) : orders.length === 0 && !tableView ? (
				// Table view keeps its table (and so its header filters) when nothing
				// matches — the empty state renders as a row inside it instead.
				<EmptyOrders
					// The per-bucket copy ("No new orders…") only makes sense for ONE
					// bucket; a multi-set or empty set falls back to the generic line.
					bucket={buckets.length === 1 ? buckets[0] : "all"}
					searching={searching}
					filtersActive={filtersActive}
					mockup={mockup}
				/>
			) : (
				// `aria-busy` while a filter change is in flight: the rows on screen
				// are the previous answer for a beat, and a screen reader should not
				// be told they are the new one. Deliberately NO visual dimming —
				// flashing 50 rows on every click is the problem this whole change
				// exists to remove; the count in the header carries the visible cue
				// instead, because the count is the part that's actually stale.
				<div className="contents" aria-busy={refreshing}>
					{tableView ? (
						<OrderTable
							orders={visibleOrders}
							columns={columnState.columns}
							statusLabelFor={statusLabelFor}
							sorting={tableSorting}
							onSortingChange={setTableSorting}
							onReorderColumns={(keys) =>
								columnState.reorder(keys as OrderColumnKey[])
							}
							columnWidths={columnState.widths}
							onColumnWidthsChange={columnState.setWidths}
							columnFilters={headerFilters}
							onClearFilters={filtersActive ? clearAllFilters : undefined}
							selectMode={selectMode}
							selected={selected}
							onToggleSelect={toggleSelect}
							onTogglePin={togglePin}
							pinBusyId={pinBusyId}
						/>
					) : (
						<ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3">
							{visibleOrders.map((o) => {
								const isSel = selected.has(o._id);
								const statusLabel = statusLabelFor(o);
								const placedAt = formatOrderTimestamp(o.createdAt, now);
								const age = formatStatusAge(now - o.createdAt);
								const itemSummary = summarizeOrderCardItems(o.items);
								const cardInner = (
									<div className="flex min-w-0 flex-1 flex-col">
										{/* Name + money get the hierarchy. */}
										<div className="flex items-center justify-between gap-2.5">
											{/* Mask only the name — items/prices/status are the useful replay signal. */}
											<span
												{...MASK_PII}
												className="min-w-0 truncate text-[15px] font-semibold"
											>
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
										    detail. */}
											<span className="tabular-nums">{placedAt}</span>
											<span>({age === "just now" ? age : `${age} ago`})</span>
										</div>
										{/* What was ordered — qty × product · variant (ClickUp
									    86ey9uny8). Capped rows + "+N more" so big counter orders
									    can't stretch the card; per-line amounts appear from `sm:`
									    up (phones keep the grouped list without the price column;
									    the bold total above is the number that matters there). */}
										<div className="mt-2 flex flex-col gap-1 rounded-xl bg-muted/50 px-2.5 py-2">
											{itemSummary.lines.map((it, i) => (
												<div
													key={it.variantId ?? `${it.productId}-${i}`}
													className="flex items-center justify-between gap-3 text-[13px] leading-5"
												>
													<span className="min-w-0 truncate">
														<span className="tabular-nums text-muted-foreground">
															{it.quantity}&times;
														</span>{" "}
														<span className="font-medium">{it.name}</span>
														{it.variantLabel ? (
															<span className="text-muted-foreground">
																{" "}
																&middot; {it.variantLabel}
															</span>
														) : null}
													</span>
													<span className="hidden shrink-0 text-[12.5px] tabular-nums text-muted-foreground sm:block">
														{formatPrice(it.lineTotal, o.currency)}
													</span>
												</div>
											))}
											{itemSummary.moreCount > 0 ? (
												<div className="flex items-center justify-between gap-3 text-[12px] leading-5 text-muted-foreground">
													<span>
														+{itemSummary.moreCount} more item
														{itemSummary.moreCount === 1 ? "" : "s"}
													</span>
													<span className="hidden shrink-0 text-[12.5px] tabular-nums sm:block">
														{formatPrice(itemSummary.moreAmount, o.currency)}
													</span>
												</div>
											) : null}
										</div>
										{/* mt-auto pins this row to the card bottom, so status +
									    chevron align across a desktop grid row even when the
									    neighbour card has more item lines (grid stretches all
									    cells in a row to the tallest; see cardClass h-full). */}
										<div className="mt-auto flex items-center gap-1.5 pt-2.5">
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
									"group flex h-full w-full gap-3 rounded-2xl border bg-card p-3.5 text-left transition-all",
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
					)}

					{visibleOrders.length < orders.length ? (
						<button
							type="button"
							onClick={() =>
								setVisibleCount((n) => Math.min(n + PAGE_SIZE, orders.length))
							}
							className="mx-auto flex h-11 items-center rounded-full border border-border px-5 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
						>
							Load more ({orders.length - visibleOrders.length} more)
						</button>
					) : null}

					{/* Results footer — honest "X of Y" plus the scan-cap caveat. When
					    capped, Y is drawn from the newest 1,000 orders only (the scan
					    takes newest-by-date THEN filters), so filters/search can't reach
					    past it — export is the full-history path. The "1,000" mirrors
					    MAX_INBOX_SCAN in convex/orders.ts. */}
					<p
						className={cn(
							"text-center text-xs text-muted-foreground",
							// "Showing 0 of 0 orders" under a row that already says
							// "No orders match" is the same fact twice.
							orders.length === 0 && "hidden",
						)}
					>
						{`Showing ${visibleOrders.length} of ${total} ${total === 1 ? "order" : "orders"}`}
						{capped ? (
							<>
								{" "}
								<span className="text-amber-600 dark:text-amber-500">
									— from your most recent 1,000. Older orders aren't listed;
									export to CSV for your full history.
								</span>
							</>
						) : null}
					</p>
					{selectMode ? <div className="h-24" aria-hidden="true" /> : null}
				</div>
			)}

			{/* Mounted for the whole of select mode (not gated on a selection) so
			    the Radix layers it owns close cleanly — see OrderBulkBar. */}
			{selectMode ? (
				<OrderBulkBar
					count={selected.size}
					actions={bulkActions}
					allSelected={allSelected}
					onApply={applyBulk}
					onDelete={canHardDelete ? applyBulkDelete : undefined}
					onUnpin={selectionHasPinned ? applyBulkUnpin : undefined}
					onPrint={retailer ? () => setPrintOpen(true) : undefined}
					onToggleSelectAll={toggleSelectAll}
					onExit={exitSelectMode}
					busy={bulkBusy}
				/>
			) : null}

			{/* Despatch labels for the ticked selection (86eyp63mp). Mounted
			    outside select mode too so the dialog can finish closing after a
			    print clears the selection. */}
			{retailer ? (
				<PrintLabelsDialog
					mode="selection"
					open={printOpen}
					onOpenChange={setPrintOpen}
					retailerId={retailer._id}
					orderIds={[...selected] as Id<"orders">[]}
					paperLabel={describeAwbPaper(
						resolveAwbConfig(retailer.awbConfig).paperSize,
					)}
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
						<Skeleton className="h-9 w-full rounded-xl" />
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
