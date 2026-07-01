import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronDown, Download, Upload } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { PageHeader } from "../components/dashboard/page-header";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "../components/ui/popover";
import { Skeleton } from "../components/ui/skeleton";
import { SortableList } from "../components/ui/sortable-list";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { BULK_IO_ENABLED } from "../lib/feature-flags";
import { convexErrorMessage, formatPrice } from "../lib/format";
import {
	downloadProductsCsv,
	downloadProductsXlsx,
	type ExportableProduct,
} from "../lib/product-export";
import { reorderByIds } from "../lib/reorder";
import { cn } from "../lib/utils";

type StatusFilter = "all" | "active" | "archived";

type ProductListItem = FunctionReturnType<typeof api.products.listAll>[number];

export const Route = createFileRoute("/app/products/")({
	component: ProductsRoute,
});

/**
 * Import / Export menu — an occasional bulk action (first-time import; periodic
 * export), so it lives in the page header next to "+ New", not on the filter row.
 * Self-contained (owns its popover state) so it can render in both the desktop
 * header and the mobile header without sharing state. `iconOnly` shrinks it to an
 * icon button for the tight mobile header.
 */
function BulkIoMenu({
	canExport,
	exporting,
	onExport,
	iconOnly = false,
}: {
	canExport: boolean;
	exporting: "csv" | "xlsx" | null;
	onExport: (kind: "csv" | "xlsx") => void;
	iconOnly?: boolean;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					className={
						iconOnly ? "size-11 shrink-0 p-0" : "h-10 shrink-0 gap-1.5"
					}
					aria-label="Import or export products"
				>
					<Upload className="size-4" />
					{iconOnly ? null : (
						<>
							<span>{exporting ? "Exporting…" : "Import / Export"}</span>
							<ChevronDown className="size-4" />
						</>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-52 p-1">
				<div className="flex flex-col">
					<Link
						to="/app/products/import"
						onClick={() => setOpen(false)}
						className="flex h-10 items-center gap-2 rounded-md px-3 text-sm transition-colors hover:bg-muted"
					>
						<Download className="size-4 text-muted-foreground" aria-hidden />
						Import products
					</Link>
					{canExport ? (
						<>
							<button
								type="button"
								disabled={exporting !== null}
								onClick={() => {
									setOpen(false);
									onExport("csv");
								}}
								className="flex h-10 items-center gap-2 rounded-md px-3 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
							>
								<Upload className="size-4 text-muted-foreground" aria-hidden />
								Export as CSV
							</button>
							<button
								type="button"
								disabled={exporting !== null}
								onClick={() => {
									setOpen(false);
									onExport("xlsx");
								}}
								className="flex h-10 items-center gap-2 rounded-md px-3 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
							>
								<Upload className="size-4 text-muted-foreground" aria-hidden />
								Export as XLSX
							</button>
						</>
					) : null}
				</div>
			</PopoverContent>
		</Popover>
	);
}

function ProductsRoute() {
	const retailer = useDashboardRetailer();
	const products = useQuery(
		api.products.listAll,
		retailer ? { retailerId: retailer._id } : "skip",
	);

	const [rawQuery, setRawQuery] = useState("");
	const [query, setQuery] = useState("");
	const [status, setStatus] = useState<StatusFilter>("all");
	const [exporting, setExporting] = useState<"csv" | "xlsx" | null>(null);

	useEffect(() => {
		const t = setTimeout(() => setQuery(rawQuery), 200);
		return () => clearTimeout(t);
	}, [rawQuery]);

	const counts = useMemo(() => {
		if (!products) return { all: 0, active: 0, archived: 0 };
		let active = 0;
		for (const p of products) if (p.active) active++;
		return {
			all: products.length,
			active,
			archived: products.length - active,
		};
	}, [products]);

	const filtered = useMemo(() => {
		if (!products) return undefined;
		const q = query.trim().toLowerCase();
		return products.filter((p) => {
			if (status === "active" && !p.active) return false;
			if (status === "archived" && p.active) return false;
			if (q && !p.name.toLowerCase().includes(q)) return false;
			return true;
		});
	}, [products, query, status]);

	// Drag-to-reorder is enabled only in the unfiltered "All" view (the list is
	// then the retailer's complete set). Needs 2+ active products — only active
	// ones are draggable; archived sit in a fixed tail.
	const canReorder =
		status === "all" && query.trim() === "" && counts.active >= 2;

	if (!retailer) return null;

	const filterOptions: { key: StatusFilter; label: string }[] = [
		{ key: "all", label: "All" },
		{ key: "active", label: "Active" },
		{ key: "archived", label: "Archived" },
	];

	const clearFilters = () => {
		setRawQuery("");
		setQuery("");
		setStatus("all");
	};

	async function handleExport(kind: "csv" | "xlsx") {
		if (!retailer) return;
		if (!filtered || filtered.length === 0) {
			toast.message("No products match the current filters to export.");
			return;
		}
		setExporting(kind);
		try {
			// One row per active variant, round-trippable with the import parser.
			const rows: ExportableProduct[] = filtered.map((p) => ({
				handle: p._id,
				name: p.name,
				description: p.description,
				options: p.options ?? [],
				variants: p.variants.map((vr) => ({
					optionValues: vr.optionValues,
					sku: vr.sku,
					price: vr.price,
					onHand: vr.onHand,
					parcelWeightG: vr.parcelWeightG,
					active: vr.active,
				})),
			}));
			const fileBase = `kedaipal-${retailer.slug}`;
			if (kind === "csv") downloadProductsCsv(rows, fileBase);
			else await downloadProductsXlsx(rows, fileBase);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setExporting(null);
		}
	}

	return (
		<div className="flex flex-col gap-4 lg:gap-5">
			<PageHeader
				title="Products"
				subtitle={
					products === undefined
						? "Loading…"
						: `${counts.active} active · ${counts.archived} archived`
				}
				actions={
					<>
						{BULK_IO_ENABLED ? (
							<BulkIoMenu
								canExport={counts.all > 0}
								exporting={exporting}
								onExport={handleExport}
							/>
						) : null}
						<Button asChild className="h-10">
							<Link to="/app/products/new">+ New product</Link>
						</Button>
					</>
				}
			/>
			<div className="flex items-center justify-between gap-3 lg:hidden">
				<div className="flex min-w-0 flex-col gap-1">
					<h2 className="text-xl font-bold">Products</h2>
					{products === undefined ? (
						<Skeleton className="h-3 w-32 rounded" />
					) : (
						<p className="text-xs text-muted-foreground">
							{counts.active} active · {counts.archived} archived
						</p>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{BULK_IO_ENABLED ? (
						<BulkIoMenu
							canExport={counts.all > 0}
							exporting={exporting}
							onExport={handleExport}
							iconOnly
						/>
					) : null}
					<Button asChild className="h-11">
						<Link to="/app/products/new">+ New</Link>
					</Button>
				</div>
			</div>

			<div className="relative lg:max-w-md">
				<svg
					className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<circle cx="11" cy="11" r="7" />
					<path d="m20 20-3.5-3.5" />
				</svg>
				<Input
					type="search"
					value={rawQuery}
					onChange={(e) => setRawQuery(e.target.value)}
					placeholder="Search products…"
					className="h-11 w-full rounded-2xl border-border bg-card pl-11 pr-10 text-sm"
				/>
				{rawQuery ? (
					<button
						type="button"
						onClick={() => setRawQuery("")}
						className="absolute right-3 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
						aria-label="Clear search"
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
							className="size-4"
						>
							<path d="M18 6 6 18" />
							<path d="m6 6 12 12" />
						</svg>
					</button>
				) : null}
			</div>

			{/* Status filters — chips only; the page scrolls them edge-to-edge on
			    mobile. Import/Export lives in the header (next to New), not here. */}
			<div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
				{filterOptions.map((opt) => (
					<button
						key={opt.key}
						type="button"
						onClick={() => setStatus(opt.key)}
						className={cn(
							"flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm",
							status === opt.key
								? "border-foreground bg-foreground text-background"
								: "border-border bg-background text-muted-foreground",
						)}
					>
						{opt.label}
						{products !== undefined ? (
							<span
								className={cn(
									"flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none",
									status === opt.key
										? "bg-background text-foreground"
										: "bg-muted text-muted-foreground",
								)}
							>
								{counts[opt.key]}
							</span>
						) : null}
					</button>
				))}
			</div>

			{filtered === undefined ? (
				<ProductListSkeleton />
			) : products && products.length === 0 ? (
				<div className="rounded-2xl border border-dashed border-border p-8 text-center">
					<p className="font-medium">No products yet</p>
					<p className="mt-1 text-sm text-muted-foreground">
						Add your first product to start selling.
					</p>
					<Button asChild className="mt-4 h-11">
						<Link to="/app/products/new">+ New product</Link>
					</Button>
				</div>
			) : filtered.length === 0 ? (
				<div className="rounded-2xl border border-dashed border-border p-8 text-center">
					<p className="font-medium">No products match your filters</p>
					{query ? (
						<p className="mt-1 text-sm text-muted-foreground">
							Nothing found for &ldquo;{query}&rdquo;.
						</p>
					) : null}
					<Button variant="ghost" onClick={clearFilters} className="mt-4 h-10">
						Clear filters
					</Button>
				</div>
			) : canReorder ? (
				<SortableProductGrid retailerId={retailer._id} products={filtered} />
			) : (
				<ul className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-3 xl:grid-cols-3">
					{filtered.map((p) => (
						<li key={p._id}>
							<ProductCard product={p} />
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function ProductCard({
	product: p,
	dragHandle,
}: {
	product: ProductListItem;
	dragHandle?: ReactNode;
}) {
	const blockOOS = p.blockWhenOutOfStock === true;
	const outOfStock = p.active && !p.inStock;
	const lowStock =
		p.active && blockOOS && p.totalOnHand > 0 && p.totalOnHand <= 3;
	const priceVaries = p.priceTo > p.priceFrom;
	const variantCount = p.variants.length;
	// Archived products read greyed wherever they appear (All view, Archived tab,
	// and the reorder tail).
	const dim = p.active ? "" : " opacity-55";

	const link = (
		<Link
			to="/app/products/$productId"
			params={{ productId: p._id }}
			className={
				(dragHandle
					? "flex min-h-16 min-w-0 flex-1 items-center gap-3 py-3 pr-3"
					: "flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-card p-3 transition-colors hover:border-ring hover:bg-accent/5") +
				dim
			}
		>
			<div className="size-16 shrink-0 overflow-hidden rounded-xl bg-muted ring-1 ring-border/60">
				{p.imageUrls[0] ? (
					<img src={p.imageUrls[0]} alt="" className="size-full object-cover" />
				) : null}
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<span className="truncate font-medium">{p.name}</span>
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
					<span className="font-semibold text-foreground">
						{priceVaries ? "from " : ""}
						{formatPrice(p.priceFrom, p.currency)}
					</span>
					<span className="text-muted-foreground">
						{variantCount > 1
							? `· ${variantCount} variants`
							: `· stock ${p.totalOnHand}`}
					</span>
					{outOfStock ? (
						<span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-400">
							Out of stock
						</span>
					) : lowStock ? (
						<span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
							Low stock
						</span>
					) : null}
				</div>
			</div>
			<div className="flex shrink-0 flex-col items-end gap-1">
				{!p.active ? (
					<span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
						Archived
					</span>
				) : null}
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					className="size-4 text-muted-foreground"
					aria-hidden="true"
				>
					<path d="m9 18 6-6-6-6" />
				</svg>
			</div>
		</Link>
	);

	if (!dragHandle) return link;
	return (
		<div className="flex items-center gap-1 rounded-2xl border border-border bg-card pl-1 transition-colors hover:border-ring hover:bg-accent/5">
			{dragHandle}
			{link}
		</div>
	);
}

function SortableProductGrid({
	retailerId,
	products,
}: {
	retailerId: Id<"retailers">;
	products: ProductListItem[];
}) {
	const reorder = useMutation(api.products.reorder);
	// `products` arrives active-first (server `byActiveThenSort`). Only the active
	// products are draggable; archived ones are a fixed, greyed tail.
	const activeProducts = products.filter((p) => p.active);
	const inactiveProducts = products.filter((p) => !p.active);

	const activeIds = activeProducts.map((p) => p._id);
	const activeKey = activeIds.join("|");
	// Optimistic order so a drop updates instantly; the reactive query re-syncs
	// after the mutation. Reconcile only when the active set/order changes.
	const [localOrder, setLocalOrder] = useState<Id<"products">[]>(activeIds);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reconcile on
	// activeKey only, not on the per-render activeIds array.
	useEffect(() => {
		setLocalOrder(activeIds);
	}, [activeKey]);

	const orderedActive = reorderByIds(products, localOrder, (p) => p._id);

	async function handleReorder(orderedActiveIds: string[]) {
		const prev = localOrder;
		const nextActive = orderedActiveIds as Id<"products">[];
		setLocalOrder(nextActive); // optimistic
		// Full set for the mutation: reordered active first, archived kept at the end.
		const full = [...nextActive, ...inactiveProducts.map((p) => p._id)];
		try {
			await reorder({ retailerId, orderedIds: full });
		} catch (err) {
			setLocalOrder(prev); // revert on failure
			toast.error(convexErrorMessage(err));
		}
	}

	const gridClass =
		"grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-3 xl:grid-cols-3";

	return (
		<div className="flex flex-col gap-4">
			<SortableList
				items={orderedActive}
				getId={(prod) => prod._id}
				onReorder={handleReorder}
				strategy="grid"
				className={gridClass}
				renderItem={(prod, handle) => (
					<ProductCard product={prod} dragHandle={handle} />
				)}
			/>
			{inactiveProducts.length > 0 ? (
				<div className="flex flex-col gap-3">
					<p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
						Archived · not shown on storefront
					</p>
					<ul className={gridClass}>
						{inactiveProducts.map((p) => (
							<li key={p._id}>
								<ProductCard product={p} />
							</li>
						))}
					</ul>
				</div>
			) : null}
		</div>
	);
}

function ProductListSkeleton() {
	return (
		<ul className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-3 xl:grid-cols-3">
			{[0, 1, 2, 3, 4, 5].map((n) => (
				<li
					key={n}
					className="flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-card p-3"
				>
					<Skeleton className="size-16 shrink-0 rounded-xl" />
					<div className="flex min-w-0 flex-1 flex-col gap-1.5">
						<Skeleton className="h-4 w-3/5 rounded" />
						<div className="flex items-center gap-2">
							<Skeleton className="h-3.5 w-14 rounded" />
							<Skeleton className="h-3 w-16 rounded" />
						</div>
					</div>
					<Skeleton className="size-4 shrink-0 rounded" />
				</li>
			))}
		</ul>
	);
}
