import { createFileRoute } from "@tanstack/react-router";
import { usePaginatedQuery, useQuery } from "convex/react";
import { Search, Users, X } from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import {
	CustomerList,
	type CustomerSort,
} from "../components/dashboard/customer-list";
import { PageHeader } from "../components/dashboard/page-header";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { useDebounce } from "../hooks/useDebounce";
import { cn } from "../lib/utils";

// NOTE: This feature is Pro-tier (RM149) and above per the pricing plan. Tier
// gating (hide from Starter + upgrade banner) is deferred until subscription
// billing lands — there's no plan field on the retailer yet. See Sprint 1–3.

export const Route = createFileRoute("/app/customers/")({
	component: CustomersRoute,
});

const SORTS: { key: CustomerSort; label: string }[] = [
	{ key: "recency", label: "Recent" },
	{ key: "ltv", label: "Top spenders" },
	{ key: "orderCount", label: "Most orders" },
];

function CustomersRoute() {
	const retailer = useQuery(api.retailers.getMyRetailer);
	const [sort, setSort] = useState<CustomerSort>("recency");
	const [term, setTerm] = useState("");
	const debouncedTerm = useDebounce(term, 250);
	const searching = debouncedTerm.trim().length > 0;
	const currency = retailer?.currency ?? "MYR";

	const listed = usePaginatedQuery(
		api.customers.list,
		retailer && !searching ? { retailerId: retailer._id, sort } : "skip",
		{ initialNumItems: 30 },
	);

	const searchResults = useQuery(
		api.customers.search,
		retailer && searching
			? { retailerId: retailer._id, term: debouncedTerm }
			: "skip",
	);

	if (!retailer) return null;

	const customers = searching ? (searchResults ?? []) : listed.results;
	const loading = searching
		? searchResults === undefined
		: listed.status === "LoadingFirstPage";

	return (
		<div className="flex flex-col gap-5 lg:gap-6">
			<PageHeader
				title="Customers"
				subtitle={
					loading
						? "Loading…"
						: `${customers.length}${
								!searching && listed.status === "CanLoadMore" ? "+" : ""
							} customer${customers.length === 1 ? "" : "s"}`
				}
			/>
			<div className="flex items-center justify-between lg:hidden">
				<h2 className="text-xl font-bold">Customers</h2>
			</div>

			{/* Search */}
			<div className="relative">
				<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					value={term}
					onChange={(e) => setTerm(e.target.value)}
					placeholder="Search by name or phone"
					className="h-11 pl-9 pr-9"
					inputMode="search"
				/>
				{term ? (
					<button
						type="button"
						onClick={() => setTerm("")}
						className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
						aria-label="Clear search"
					>
						<X className="size-4" />
					</button>
				) : null}
			</div>

			{/* Sort (mobile — desktop sorts via table headers) */}
			{!searching ? (
				<div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:hidden">
					{SORTS.map((s) => (
						<button
							key={s.key}
							type="button"
							onClick={() => setSort(s.key)}
							className={cn(
								"flex h-9 shrink-0 items-center rounded-full border px-3.5 text-sm transition-colors",
								sort === s.key
									? "border-foreground bg-foreground text-background"
									: "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground",
							)}
						>
							{s.label}
						</button>
					))}
				</div>
			) : null}

			{loading ? (
				<CustomerListSkeleton />
			) : customers.length === 0 ? (
				<EmptyState searching={searching} term={debouncedTerm} />
			) : (
				<>
					<CustomerList
						customers={customers}
						currency={currency}
						sort={sort}
						onSortChange={setSort}
					/>
					{!searching && listed.status === "CanLoadMore" ? (
						<button
							type="button"
							onClick={() => listed.loadMore(30)}
							className="mx-auto flex h-10 items-center rounded-full border border-border px-5 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
						>
							Load more
						</button>
					) : null}
					{!searching && listed.status === "LoadingMore" ? (
						<p className="text-center text-sm text-muted-foreground">
							Loading…
						</p>
					) : null}
				</>
			)}
		</div>
	);
}

function EmptyState({ searching, term }: { searching: boolean; term: string }) {
	return (
		<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
			<div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
				<Users className="size-5 text-muted-foreground" />
			</div>
			<div>
				{searching ? (
					<>
						<p className="font-medium">No matches</p>
						<p className="mt-1 text-sm text-muted-foreground">
							Nothing found for “{term.trim()}”.
						</p>
					</>
				) : (
					<>
						<p className="font-medium">No customers yet</p>
						<p className="mt-1 text-sm text-muted-foreground">
							Customers appear automatically as orders come in.
						</p>
					</>
				)}
			</div>
		</div>
	);
}

function CustomerListSkeleton() {
	return (
		<ul className="flex flex-col gap-2">
			{[0, 1, 2, 3, 4].map((n) => (
				<li
					key={n}
					className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
				>
					<Skeleton className="size-10 shrink-0 rounded-full" />
					<div className="flex min-w-0 flex-1 flex-col gap-1.5">
						<Skeleton className="h-4 w-32 rounded" />
						<Skeleton className="h-3 w-24 rounded" />
						<Skeleton className="h-3 w-40 rounded" />
					</div>
					<Skeleton className="size-4 shrink-0 rounded" />
				</li>
			))}
		</ul>
	);
}
