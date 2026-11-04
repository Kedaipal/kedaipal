// The admin seller directory (docs/admin-console.md). Redesigned in z8r3fdh37c
// from a five-fact card list into a findable, copyable book, and paginated on
// 4 Nov 2026: the list is a cursor-paginated Convex read
// (`adminSellers.listSellersPage`) that infinite-scrolls through the whole
// book, with search, the Status filter and the sort applied SERVER-side; the
// counts on the Status menu come from their own query over the book. Filter,
// sort and search ride the URL so a filtered view is a link an admin can paste
// to another admin.
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useConvex, usePaginatedQuery } from "convex/react";
import {
	ArrowUpDown,
	Download,
	ListFilter,
	Search,
	ShieldCheck,
	ShieldX,
	Store,
	TriangleAlert,
	UserPlus,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { AdminSellerRow } from "../../convex/admin";
import { ADMIN_COUNT_SCAN_LIMIT } from "../../convex/lib/adminDirectory";
import { csvDate } from "../../convex/lib/orderCsv";
import type { EnterpriseContractTemplate } from "../components/admin/enterprise-contract-form";
import { SellerCard } from "../components/admin/seller-card";
import { SellerSheet } from "../components/admin/seller-sheet";
import { SellerTable } from "../components/admin/seller-table";
import { PageHeader } from "../components/dashboard/page-header";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
	LoadMoreSentinel,
	type LoadMoreStatus,
} from "../components/ui/load-more-sentinel";
import { OptionMenu } from "../components/ui/option-menu";
import { Skeleton } from "../components/ui/skeleton";
import { useDebounce } from "../hooks/useDebounce";
import { useIsDesktop } from "../hooks/useIsDesktop";
import {
	ATTENTION_FILTERS,
	DEFAULT_SELLER_SORT,
	isSellerFilter,
	isSellerSort,
	SELLER_FILTER_GROUPS,
	SELLER_FILTER_LABEL,
	SELLER_SORTS,
	type SellerBucketCounts,
	type SellerFilter,
	type SellerSort,
	sellerFilterEmptyNoun,
	sellersToCsv,
} from "../lib/admin-seller-view";
import { downloadCsv } from "../lib/download";
import { searchText } from "../lib/search-params";
import { storefrontOrigin } from "../lib/storefront-url";
import { cn } from "../lib/utils";

/** Rows per page the client asks for. The server may hand back fewer when a
 * filter or search is on (it filters a wider raw window); the sentinel simply
 * asks again. */
export const PAGE_SIZE = 25;
/** The CSV walks the book in bigger strides — nothing renders in between. */
const EXPORT_PAGE_SIZE = 100;
/** URL updates per keystroke (so the link is always right); the query waits
 * for the typing to pause, because every new query arg resets the list. */
const SEARCH_DEBOUNCE_MS = 250;

/** The directory's URL state. Defaults are omitted from the URL so the plain
 * route stays `/app/admin/sellers`. */
export interface SellersSearch {
	status?: Exclude<SellerFilter, "all">;
	sort?: Exclude<SellerSort, "founding">;
	q?: string;
}

export const Route = createFileRoute("/app/admin/sellers")({
	// Every key is returned, `undefined` when absent or invalid: an omitted key
	// lets the raw parsed value through, and `?q=9981` parses as a NUMBER that
	// crashed the page on `q.trim()` (z8r3fdtk87, src/lib/search-params.ts).
	validateSearch: (search: Record<string, unknown>): SellersSearch => ({
		status:
			isSellerFilter(search.status) && search.status !== "all"
				? search.status
				: undefined,
		sort:
			isSellerSort(search.sort) && search.sort !== "founding"
				? search.sort
				: undefined,
		q: searchText(search.q),
	}),
	component: AdminSellersRoute,
});

function AdminSellersRoute() {
	// Client gate is cosmetic — every read below is `requireAdmin` server-side.
	const isAdmin = useQuery(convexQuery(api.billing.amIAdmin, {})).data;
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });

	if (isAdmin === undefined) {
		return (
			<div className="flex flex-col gap-4">
				<Skeleton className="h-7 w-40" />
				<Skeleton className="h-24 w-full rounded-2xl" />
				<Skeleton className="h-24 w-full rounded-2xl" />
			</div>
		);
	}
	if (!isAdmin) {
		return (
			<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
				<ShieldX className="size-8 text-muted-foreground" />
				<p className="font-medium">Not authorized</p>
				<p className="max-w-xs text-sm text-muted-foreground">
					This area is for Kedaipal admins only.
				</p>
			</div>
		);
	}

	return (
		<AdminSellersContent
			search={search}
			onSearchChange={(next) =>
				navigate({ search: next, replace: true, resetScroll: false })
			}
		/>
	);
}

/** Exported for the route test, which drives it with a stateful wrapper in
 * place of the router. Owns every read; `SellerDirectory` below is pure. */
export function AdminSellersContent({
	search,
	onSearchChange,
}: {
	search: SellersSearch;
	onSearchChange: (next: SellersSearch) => void;
}) {
	const filter: SellerFilter = search.status ?? "all";
	const sort: SellerSort = search.sort ?? DEFAULT_SELLER_SORT;
	const q = (search.q ?? "").trim();
	const debouncedQ = useDebounce(q, SEARCH_DEBOUNCE_MS);
	// Native `convex/react`: the TanStack adapter has no pagination wrapper
	// (docs/frontend-caching.md). Every other read here goes through it.
	const paged = usePaginatedQuery(
		api.adminSellers.listSellersPage,
		{ sort, filter, q: debouncedQ },
		{ initialNumItems: PAGE_SIZE },
	);
	const bucketCounts = useQuery(
		convexQuery(api.adminSellers.countSellerBuckets, {}),
	).data;
	// Dev deployments only (z8r3fdbmc9) — the server re-checks, this just keeps
	// a control that would always refuse off the prod screen entirely.
	const purgeEnabled =
		useQuery(convexQuery(api.admin.devStorePurgeEnabled, {})).data === true;
	const [detailId, setDetailId] = useState<Id<"retailers"> | null>(null);
	// Mounted only while a sheet is open: the "start from another contract"
	// picker used to read the loaded list, which was the whole book at 500
	// rows and is whatever has scrolled past now.
	const contractTemplates =
		useQuery(
			convexQuery(
				api.enterprise.listContractTemplates,
				detailId ? { exclude: detailId } : "skip",
			),
		).data ?? [];

	const convex = useConvex();
	const [exporting, setExporting] = useState<number | null>(null);
	const now = Date.now();
	// The CSV walks EVERY page of the current filter + search, not the rows
	// that happen to be loaded — "export what I'm looking at" meant the whole
	// filtered book when the page held 500 rows, and still does.
	const exportCsv = useCallback(async () => {
		setExporting(0);
		try {
			const rows: AdminSellerRow[] = [];
			let cursor: string | null = null;
			for (;;) {
				const res: Awaited<
					ReturnType<
						typeof convex.query<typeof api.adminSellers.listSellersPage>
					>
				> = await convex.query(api.adminSellers.listSellersPage, {
					sort,
					filter,
					q: debouncedQ,
					paginationOpts: { numItems: EXPORT_PAGE_SIZE, cursor },
				});
				rows.push(...res.page);
				setExporting(rows.length);
				if (res.isDone) break;
				cursor = res.continueCursor;
			}
			downloadCsv(
				`kedaipal-sellers-${csvDate(now)}.csv`,
				sellersToCsv(rows, storefrontOrigin(), now),
			);
		} finally {
			setExporting(null);
		}
	}, [convex, sort, filter, debouncedQ, now]);

	return (
		<SellerDirectory
			rows={paged.results}
			status={paged.status}
			onLoadMore={() => paged.loadMore(PAGE_SIZE)}
			counts={bucketCounts?.counts}
			countsCapped={bucketCounts?.capped === true}
			searchPending={q !== debouncedQ}
			purgeEnabled={purgeEnabled}
			search={search}
			onSearchChange={onSearchChange}
			detailId={detailId}
			onDetailChange={setDetailId}
			contractTemplates={contractTemplates}
			onExport={exportCsv}
			exporting={exporting}
			now={now}
		/>
	);
}

/** The directory with its data in hand — everything below the reads. Split
 * from the fetch so it can be rendered against fixtures (the design pass
 * behind Clerk) and driven by the route test without a router. */
export function SellerDirectory({
	rows,
	status,
	onLoadMore,
	counts,
	countsCapped,
	searchPending = false,
	purgeEnabled,
	search,
	onSearchChange,
	detailId,
	onDetailChange,
	contractTemplates,
	onExport,
	exporting = null,
	now,
}: {
	/** The pages loaded so far, in server order. */
	rows: readonly AdminSellerRow[];
	status: LoadMoreStatus;
	onLoadMore: () => void;
	/** Over the whole book; `undefined` while counting. */
	counts: SellerBucketCounts | undefined;
	/** The count scan stopped at `ADMIN_COUNT_SCAN_LIMIT` stores. */
	countsCapped: boolean;
	/** Typed but not yet sent (the debounce window). */
	searchPending?: boolean;
	purgeEnabled: boolean;
	search: SellersSearch;
	onSearchChange: (next: SellersSearch) => void;
	detailId: Id<"retailers"> | null;
	onDetailChange: (id: Id<"retailers"> | null) => void;
	contractTemplates: EnterpriseContractTemplate[];
	onExport: () => void;
	/** Rows gathered so far by a running export; `null` when idle. */
	exporting?: number | null;
	now: number;
}) {
	const isDesktop = useIsDesktop();
	const filter: SellerFilter = search.status ?? "all";
	const sort: SellerSort = search.sort ?? DEFAULT_SELLER_SORT;
	const q = search.q ?? "";
	const needle = q.trim();
	const filtered = filter !== "all" || needle.length > 0;

	// Stale-while-loading: a new filter, sort or search resets the paginated
	// list to its first page, and blanking a full table to three skeletons on
	// every keystroke reads as the page breaking. The last rows stay on
	// screen, dimmed and inert, until the new first page lands. The very
	// first load has nothing to keep and shows the skeletons.
	const lastRows = useRef<readonly AdminSellerRow[]>([]);
	if (rows.length > 0) lastRows.current = rows;
	const reloading =
		status === "LoadingFirstPage" && lastRows.current.length > 0;
	const shown = reloading ? lastRows.current : rows;
	const firstLoad = status === "LoadingFirstPage" && !reloading;
	const empty = status === "Exhausted" && rows.length === 0;
	const detailSeller = shown.find((s) => s._id === detailId) ?? null;

	function setFilter(next: SellerFilter) {
		onSearchChange({ ...search, status: next === "all" ? undefined : next });
	}
	function setSort(next: SellerSort) {
		onSearchChange({
			...search,
			sort: next === DEFAULT_SELLER_SORT ? undefined : next,
		});
	}
	function setQuery(next: string) {
		onSearchChange({ ...search, q: next.trim() ? next : undefined });
	}
	function clearAll() {
		onSearchChange({ ...search, status: undefined, q: undefined });
	}

	const statusGroups = [
		{
			options: [
				{
					value: "all" as SellerFilter,
					label: SELLER_FILTER_LABEL.all,
					count: counts?.all,
				},
			],
		},
		...SELLER_FILTER_GROUPS.map((group) => ({
			heading: group.heading,
			options: group.filters.map((f) => ({
				value: f as SellerFilter,
				label: SELLER_FILTER_LABEL[f],
				count: counts?.[f],
				countTone: ATTENTION_FILTERS.has(f)
					? ("attention" as const)
					: ("muted" as const),
			})),
		})),
	];
	const sortGroups = [
		{ options: SELLER_SORTS.map((s) => ({ value: s.key, label: s.label })) },
	];

	const total = counts?.[filter];
	const noun = sellerFilterEmptyNoun(filter);
	const countLine = needle
		? searchPending || status === "LoadingFirstPage"
			? "Searching…"
			: `${rows.length}${status === "Exhausted" ? "" : "+"} ${rows.length === 1 && status === "Exhausted" ? "match" : "matches"}`
		: total === undefined
			? "Counting…"
			: `${total.toLocaleString("en-MY")} ${total === 1 ? noun.replace(/s$/, "") : noun}${countsCapped ? ` · counted over the newest ${ADMIN_COUNT_SCAN_LIMIT.toLocaleString("en-MY")}` : ""}`;

	const exhaustedLabel = needle
		? `End of results for “${needle}”`
		: filter === "all"
			? `That’s every seller${total !== undefined ? ` · ${total.toLocaleString("en-MY")}` : ""}`
			: `That’s every ${noun}${total !== undefined ? ` · ${total.toLocaleString("en-MY")}` : ""}`;

	const exportDisabledReason =
		exporting !== null
			? `Exporting… ${exporting} so far`
			: firstLoad
				? "Still loading"
				: empty
					? "Nothing to export — no rows match"
					: undefined;

	const headerActions = (
		<>
			<Button
				variant="outline"
				onClick={onExport}
				disabled={exportDisabledReason !== undefined}
				isLoading={exporting !== null}
				title={
					exportDisabledReason ??
					"Every row that matches the current filter and search — all pages"
				}
				className="h-10 rounded-xl px-4"
			>
				<Download data-icon="inline-start" aria-hidden="true" />
				Export CSV
			</Button>
			{/* The invite form lives on Billing (it needs the founding-spot count
			    and the invoice picker beside it); this is the door from the page
			    where an admin actually looks for a seller. */}
			<Button asChild className="h-10 rounded-xl px-4">
				<Link to="/app/admin/billing" hash="onboard">
					<UserPlus data-icon="inline-start" aria-hidden="true" />
					Invite seller
				</Link>
			</Button>
		</>
	);

	const loadingSlot = (
		<>
			<Skeleton className="h-[72px] w-full rounded-2xl" />
			<Skeleton className="h-[72px] w-full rounded-2xl" />
			<p className="px-1 text-xs text-muted-foreground">
				Loading the next {PAGE_SIZE} sellers…
			</p>
		</>
	);

	return (
		<div className="flex flex-col gap-5">
			<PageHeader
				title="Sellers"
				subtitle="Every store on Kedaipal — contact them, see where their billing stands, or open their dashboard."
				actions={headerActions}
			/>
			<section className="flex items-start justify-between gap-3 lg:hidden">
				<div className="flex min-w-0 flex-col gap-1">
					<h2 className="text-xl font-bold">Sellers</h2>
					<p className="text-sm text-muted-foreground">
						Contact, billing state and the door to every store.
					</p>
				</div>
				<Button
					asChild
					size="icon-lg"
					className="tap-target shrink-0 rounded-xl"
					aria-label="Invite seller"
				>
					<Link to="/app/admin/billing" hash="onboard">
						<UserPlus aria-hidden="true" />
					</Link>
				</Button>
			</section>

			<p className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-[13px] text-foreground/80">
				<ShieldCheck
					className="mt-0.5 size-4 shrink-0 text-accent-emphasis"
					aria-hidden="true"
				/>
				<span>
					<strong className="font-semibold">Open store</strong> enters act-as
					mode: you operate it as the seller and every change is logged to your
					admin account.
				</span>
			</p>

			<div className="flex flex-col gap-3 lg:flex-row lg:items-center">
				<div className="relative min-w-0 flex-1 lg:max-w-sm">
					<Search
						className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
						aria-hidden="true"
					/>
					<label htmlFor="seller-search" className="sr-only">
						Search sellers
					</label>
					<Input
						id="seller-search"
						variant="field"
						type="search"
						value={q}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search name, slug, email or phone"
						className="pl-10 lg:min-h-10"
					/>
				</div>
				<div className="flex items-center gap-2">
					<OptionMenu<SellerFilter>
						label="Status"
						value={filter}
						defaultValue="all"
						groups={statusGroups}
						onChange={setFilter}
						icon={<ListFilter />}
						countNoun="seller"
						note={
							countsCapped
								? `Counts cover the newest ${ADMIN_COUNT_SCAN_LIMIT.toLocaleString("en-MY")} stores; the list itself reaches every store.`
								: "Admin and comped stores sit in their own rows, never under a billing status."
						}
						className="min-w-0 flex-1 lg:flex-none"
					/>
					<OptionMenu<SellerSort>
						label="Sort"
						value={sort}
						groups={sortGroups}
						onChange={setSort}
						icon={<ArrowUpDown />}
						note="Who lapses next? The Past due and Trialing filters answer that; the list pages by cursor, so it sorts only on what's indexed."
						className="min-w-0 flex-1 lg:flex-none"
					/>
				</div>
				<span
					className="text-[13px] text-muted-foreground lg:ml-auto"
					aria-live="polite"
				>
					{countLine}
				</span>
			</div>

			{countsCapped ? (
				<p className="flex items-start gap-2 rounded-xl border border-amber-500/45 bg-amber-100/60 px-3 py-2.5 text-[13px] text-amber-900 dark:border-amber-400/40 dark:bg-amber-950/40 dark:text-amber-200">
					<TriangleAlert
						className="mt-0.5 size-4 shrink-0"
						aria-hidden="true"
					/>
					<span>
						<strong className="font-semibold">
							Counts cover the newest{" "}
							{ADMIN_COUNT_SCAN_LIMIT.toLocaleString("en-MY")} stores.
						</strong>{" "}
						The list still reaches every store as you scroll; only the numbers
						on the Status menu stop there.
					</span>
				</p>
			) : null}

			{firstLoad ? (
				<div className="flex flex-col gap-2" aria-busy="true">
					<Skeleton className="h-[72px] w-full rounded-2xl" />
					<Skeleton className="h-[72px] w-full rounded-2xl" />
					<Skeleton className="h-[72px] w-full rounded-2xl" />
				</div>
			) : empty ? (
				<div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
					<Store className="size-7 text-muted-foreground" aria-hidden="true" />
					<p className="font-medium">
						{counts?.all === 0
							? "No sellers yet"
							: filter !== "all"
								? `No ${noun}${needle ? ` match “${needle}”` : ""}`
								: `No sellers match “${needle}”`}
					</p>
					<p className="max-w-xs text-sm text-muted-foreground">
						{counts?.all === 0
							? "Stores appear here once a seller finishes onboarding."
							: filter === "wants_enterprise"
								? "Nobody's waiting. Sellers land here when they tap “Talk to Arif” in the app, and leave when a contract lands or you dismiss the ask."
								: filter === "untagged_payers" && !needle
									? "Every paying store has a channel. New payers land here until you tag how they arrived."
									: filter !== "all"
										? "They may be in another status — clear the filter to search every store."
										: "Try the store name, its slug, the owner's email or their phone. Every store was checked, not just the ones on screen."}
					</p>
					{filtered ? (
						<Button
							variant="outline"
							onClick={clearAll}
							className="mt-2 h-10 rounded-xl px-4"
						>
							Clear search and filters
						</Button>
					) : null}
				</div>
			) : (
				<div className="flex flex-col gap-3">
					{reloading ? (
						<div
							role="progressbar"
							aria-label="Loading sellers"
							className="h-0.5 overflow-hidden rounded-full bg-accent/20"
						>
							<div className="h-full w-2/5 animate-pulse rounded-full bg-accent" />
						</div>
					) : null}
					<div
						aria-busy={reloading || undefined}
						className={cn(
							"flex flex-col gap-3 transition-opacity",
							reloading && "pointer-events-none opacity-60",
						)}
					>
						{isDesktop ? (
							<SellerTable
								sellers={shown}
								purgeEnabled={purgeEnabled}
								onViewDetails={(s) => onDetailChange(s._id)}
								now={now}
							/>
						) : (
							<ul className="flex flex-col gap-2">
								{shown.map((s) => (
									<SellerCard
										key={s._id}
										seller={s}
										purgeEnabled={purgeEnabled}
										onViewDetails={(row) => onDetailChange(row._id)}
										now={now}
									/>
								))}
							</ul>
						)}
					</div>
					{reloading ? null : (
						<LoadMoreSentinel
							status={status}
							onLoadMore={onLoadMore}
							loadingSlot={loadingSlot}
							loadMoreLabel="Load more"
							loadMoreHint={`Scroll or press to load the next ${PAGE_SIZE}`}
							exhaustedLabel={exhaustedLabel}
						/>
					)}
				</div>
			)}

			<SellerSheet
				seller={detailSeller}
				contractTemplates={contractTemplates}
				open={detailId !== null}
				onOpenChange={(open) => {
					if (!open) onDetailChange(null);
				}}
				purgeEnabled={purgeEnabled}
				now={now}
			/>
		</div>
	);
}
