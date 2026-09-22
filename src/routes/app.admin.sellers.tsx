// The admin seller directory (docs/admin-console.md). Redesigned in z8r3fdh37c
// from a five-fact card list into a findable, copyable book: search by name,
// slug, email or phone; filter by status bucket; sort by founding rank,
// expiry, age or name; and every contact and billing fact readable on the row
// and copyable in the detail sheet. Filter, sort and search ride the URL so a
// filtered view is a link an admin can paste to another admin.
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowUpDown,
	Check,
	Download,
	Search,
	ShieldCheck,
	ShieldX,
	Store,
	UserPlus,
} from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { AdminSellerRow } from "../../convex/admin";
import { csvDate } from "../../convex/lib/orderCsv";
import { SellerCard } from "../components/admin/seller-card";
import { SellerSheet } from "../components/admin/seller-sheet";
import { SellerTable } from "../components/admin/seller-table";
import { PageHeader } from "../components/dashboard/page-header";
import { Button } from "../components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { FilterChip, FilterChipRow } from "../components/ui/filter-chip";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { useIsDesktop } from "../hooks/useIsDesktop";
import {
	countSellerBuckets,
	filterSellers,
	isSellerFilter,
	isSellerSort,
	SELLER_FILTER_LABEL,
	SELLER_FILTERS,
	SELLER_SORTS,
	type SellerFilter,
	type SellerSort,
	sellersToCsv,
	sortSellers,
} from "../lib/admin-seller-view";
import { downloadCsv } from "../lib/download";
import { storefrontOrigin } from "../lib/storefront-url";

/** The directory's URL state. Defaults are omitted from the URL so the plain
 * route stays `/app/admin/sellers`. */
export interface SellersSearch {
	status?: Exclude<SellerFilter, "all">;
	sort?: Exclude<SellerSort, "founding">;
	q?: string;
}

export const Route = createFileRoute("/app/admin/sellers")({
	validateSearch: (search: Record<string, unknown>): SellersSearch => ({
		...(isSellerFilter(search.status) && search.status !== "all"
			? { status: search.status }
			: {}),
		...(isSellerSort(search.sort) && search.sort !== "founding"
			? { sort: search.sort }
			: {}),
		...(typeof search.q === "string" && search.q.trim().length > 0
			? { q: search.q }
			: {}),
	}),
	component: AdminSellersRoute,
});

function AdminSellersRoute() {
	// Client gate is cosmetic — `listSellersForAdmin` is `requireAdmin` server-side.
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
 * place of the router. */
export function AdminSellersContent({
	search,
	onSearchChange,
}: {
	search: SellersSearch;
	onSearchChange: (next: SellersSearch) => void;
}) {
	const sellers = useQuery(convexQuery(api.admin.listSellersForAdmin, {})).data;
	// Dev deployments only (z8r3fdbmc9) — the server re-checks, this just keeps
	// a control that would always refuse off the prod screen entirely.
	const purgeEnabled =
		useQuery(convexQuery(api.admin.devStorePurgeEnabled, {})).data === true;
	return (
		<SellerDirectory
			sellers={sellers}
			purgeEnabled={purgeEnabled}
			search={search}
			onSearchChange={onSearchChange}
		/>
	);
}

/** The directory with its data in hand — everything below the query. Split
 * from the fetch so it can be rendered against fixtures (the design pass
 * behind Clerk) and driven by the route test without a router. */
export function SellerDirectory({
	sellers,
	purgeEnabled,
	search,
	onSearchChange,
}: {
	/** `undefined` while loading. */
	sellers: readonly AdminSellerRow[] | undefined;
	purgeEnabled: boolean;
	search: SellersSearch;
	onSearchChange: (next: SellersSearch) => void;
}) {
	const isDesktop = useIsDesktop();
	const [detailId, setDetailId] = useState<AdminSellerRow["_id"] | null>(null);

	const filter: SellerFilter = search.status ?? "all";
	const sort: SellerSort = search.sort ?? "founding";
	const q = search.q ?? "";
	// One clock per render so every row's "in N days" agrees.
	const now = Date.now();

	const all = sellers ?? [];
	const counts = countSellerBuckets(all);
	const visible = sortSellers(filterSellers(all, filter, q), sort, now);
	const detailSeller = all.find((s) => s._id === detailId) ?? null;
	const filtered = filter !== "all" || q.trim().length > 0;

	function setFilter(next: SellerFilter) {
		onSearchChange({
			...search,
			status: next === "all" ? undefined : next,
		});
	}
	function setSort(next: SellerSort) {
		onSearchChange({
			...search,
			sort: next === "founding" ? undefined : next,
		});
	}
	function setQuery(next: string) {
		onSearchChange({ ...search, q: next.trim() ? next : undefined });
	}
	function clearAll() {
		onSearchChange({ ...search, status: undefined, q: undefined });
	}
	function exportCsv() {
		downloadCsv(
			`kedaipal-sellers-${csvDate(now)}.csv`,
			sellersToCsv(visible, storefrontOrigin(), now),
		);
	}

	const sortLabel =
		SELLER_SORTS.find((s) => s.key === sort)?.label ?? "Founding rank";
	const exportDisabledReason =
		sellers === undefined
			? "Still loading"
			: visible.length === 0
				? "Nothing to export — no rows match"
				: undefined;

	const headerActions = (
		<>
			<Button
				variant="outline"
				onClick={exportCsv}
				disabled={exportDisabledReason !== undefined}
				title={exportDisabledReason}
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
				<div className="flex items-center justify-between gap-3">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="outline"
								className="h-11 rounded-xl px-3.5 lg:h-10"
								aria-label={`Sort: ${sortLabel}`}
							>
								<ArrowUpDown data-icon="inline-start" aria-hidden="true" />
								<span className="text-muted-foreground">Sort</span>
								<span>{sortLabel}</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" className="w-60">
							{SELLER_SORTS.map((s) => (
								<DropdownMenuItem
									key={s.key}
									onSelect={() => setSort(s.key)}
									aria-checked={s.key === sort}
									role="menuitemradio"
								>
									<Check
										className={s.key === sort ? "size-4" : "size-4 opacity-0"}
										aria-hidden="true"
									/>
									{s.label}
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
					<span
						className="text-[13px] text-muted-foreground lg:ml-auto"
						aria-live="polite"
					>
						{sellers === undefined
							? "Loading…"
							: `Showing ${visible.length} of ${all.length}`}
					</span>
				</div>
			</div>

			<FilterChipRow>
				{SELLER_FILTERS.filter((f) => f !== "none" || counts.none > 0).map(
					(f) => (
						<FilterChip
							key={f}
							selected={filter === f}
							count={counts[f]}
							countTone={
								f === "past_due" && counts[f] > 0 ? "attention" : "muted"
							}
							onClick={() => setFilter(f)}
						>
							{SELLER_FILTER_LABEL[f]}
						</FilterChip>
					),
				)}
			</FilterChipRow>

			{sellers === undefined ? (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-[72px] w-full rounded-2xl" />
					<Skeleton className="h-[72px] w-full rounded-2xl" />
					<Skeleton className="h-[72px] w-full rounded-2xl" />
				</div>
			) : visible.length === 0 ? (
				<div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
					<Store className="size-7 text-muted-foreground" aria-hidden="true" />
					<p className="font-medium">
						{all.length === 0
							? "No sellers yet"
							: filter !== "all"
								? `No ${SELLER_FILTER_LABEL[filter].toLowerCase()} sellers${q.trim() ? ` match “${q.trim()}”` : ""}`
								: `No sellers match “${q.trim()}”`}
					</p>
					<p className="max-w-xs text-sm text-muted-foreground">
						{all.length === 0
							? "Stores appear here once a seller finishes onboarding."
							: filter !== "all"
								? "They may be in another status — clear the filter to search every store."
								: "Try the store name, its slug, the owner's email or their phone."}
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
			) : isDesktop ? (
				<SellerTable
					sellers={visible}
					purgeEnabled={purgeEnabled}
					onViewDetails={(s) => setDetailId(s._id)}
					now={now}
				/>
			) : (
				<ul className="flex flex-col gap-2">
					{visible.map((s) => (
						<SellerCard
							key={s._id}
							seller={s}
							purgeEnabled={purgeEnabled}
							onViewDetails={(row) => setDetailId(row._id)}
							now={now}
						/>
					))}
				</ul>
			)}

			<SellerSheet
				seller={detailSeller}
				open={detailId !== null}
				onOpenChange={(open) => {
					if (!open) setDetailId(null);
				}}
				purgeEnabled={purgeEnabled}
				now={now}
			/>
		</div>
	);
}
