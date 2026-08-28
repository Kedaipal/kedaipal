import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useConvex, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
	ChevronRight,
	Download,
	EyeOff,
	FileSpreadsheet,
	FolderOpen,
	Search,
	Upload,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
	productCapBlockReason,
	productCapState,
} from "../../convex/lib/productCap";
import { ProBadge } from "../components/app/pro-gate";
import { PageHeader } from "../components/dashboard/page-header";
import { AppImage } from "../components/ui/app-image";
import { Button } from "../components/ui/button";
import { FilterChip, FilterChipRow } from "../components/ui/filter-chip";
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
import { storefrontUrl } from "../lib/storefront-url";
import { hasFeature } from "../lib/subscription";
import { hasStartingPrice } from "../lib/variant";

type StatusFilter = "all" | "active" | "archived";

type ProductListItem = FunctionReturnType<typeof api.products.listAll>[number];

export const Route = createFileRoute("/app/products/")({
	component: ProductsRoute,
});

/**
 * Import / Export menu — an occasional bulk action (first-time import; periodic
 * export), so it collapses to ONE icon button in the header (a labelled
 * "Import / Export ▾" competed with "+ New" for attention). Self-contained
 * (owns its popover state) so it can render in both the desktop header and the
 * mobile header without sharing state.
 */
function BulkIoMenu({
	canExport,
	exporting,
	onExport,
}: {
	canExport: boolean;
	exporting: "csv" | "xlsx" | null;
	onExport: (kind: "csv" | "xlsx") => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="icon"
					className="size-11 shrink-0 rounded-xl"
					aria-label={
						exporting ? "Exporting products…" : "Import or export products"
					}
				>
					{/* Spreadsheet glyph, not arrows — an up/down icon reads as "sort"
					    right above a sortable product list. */}
					<FileSpreadsheet className="size-5" />
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

/**
 * Header link to category management — the discoverability surface for the
 * feature (categories live UNDER Products; there's no nav tab). The link works
 * on every tier: a locked (Starter) seller lands on the explain-and-upgrade
 * wall, so the tier boundary is marked without hiding the door.
 *
 * Desktop shows the labelled button; on mobile it collapses to an icon button
 * (matching the Import/Export icon beside it) so the title + three header
 * actions fit a 360px row without the heading overlapping. A locked seller
 * gets an accent dot on the icon in lieu of the full "Pro" chip.
 */
function CategoriesLink({
	locked,
	mobile = false,
}: {
	locked: boolean;
	mobile?: boolean;
}) {
	if (mobile) {
		return (
			<Button
				asChild
				variant="outline"
				size="icon"
				className="relative size-11 shrink-0 rounded-xl"
			>
				<Link
					to="/app/products/categories"
					aria-label={locked ? "Categories (Pro feature)" : "Categories"}
				>
					<FolderOpen className="size-5" aria-hidden />
					{locked ? (
						<span
							aria-hidden
							className="absolute right-1 top-1 size-2 rounded-full bg-accent ring-2 ring-card"
						/>
					) : null}
				</Link>
			</Button>
		);
	}
	return (
		<Button asChild variant="outline" className="h-10">
			<Link to="/app/products/categories">
				<FolderOpen className="size-4" aria-hidden />
				Categories
				{locked ? <ProBadge /> : null}
			</Link>
		</Button>
	);
}

function ProductsRoute() {
	const retailer = useDashboardRetailer();
	// Client mirror of the `categories` plan gate (server is the lock) — only
	// used to badge the Categories link; admin act-as sees through it.
	const categoriesLocked =
		!!retailer &&
		!retailer.actingAsAdmin &&
		!hasFeature(retailer.subscription, "categories");
	const convex = useConvex();
	const products = useQuery(
		convexQuery(
			api.products.listAll,
			retailer ? { retailerId: retailer._id } : "skip",
		),
	).data;
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

	// Product cap. `counts.all` is the right input by construction: `listAll`
	// returns every row, active AND archived, which is exactly what the cap
	// counts. Client mirror of the server gate (server is the lock) — admin
	// act-as is exempt so a white-glove catalog can be stocked past the ceiling.
	const cap = productCapState(counts.all, retailer?.actingAsAdmin === true);
	// null while there's room — one source for the disabled button and its reason.
	const capBlockReason = productCapBlockReason(
		counts.all,
		retailer?.actingAsAdmin === true,
	);
	const countsLine =
		products === undefined
			? "Loading…"
			: `${counts.active} active · ${counts.archived} archived`;
	// The ceiling only appears once it's plausibly relevant (≥80%), so a small
	// catalog is never nagged about a limit it will never reach. An admin-stocked
	// store ABOVE the ceiling shows no ratio — "250 of 200" reads as a bug rather
	// than the bespoke arrangement it is.
	const productsSubtitle =
		products === undefined || cap.overCap || !cap.showCounter
			? countsLine
			: `${countsLine} · ${cap.used} of ${cap.cap} used`;

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
			// Category names for the `categories` column (86eyrtz74). Fetched ONCE,
			// here — not as a `useQuery` subscription. It is a fan-out over the
			// junction table, and the products page is a hot read that runs on
			// every visit; subscribing would have made the hot path pay the
			// fan-out (and re-pay it on every category edit) for data only this
			// button needs, which is the exact cost the query was split out to
			// avoid. Same one-shot pattern the orders route uses for exportOrders.
			const categoryNamesByProduct = await convex.query(
				api.categories.namesByProduct,
				{ retailerId: retailer._id },
			);
			// One row per exportable variant. The first eleven columns stay
			// round-trippable with the import parser; the rest are the catalogue
			// report (86eyrtz74) — see src/lib/product-export.ts.
			const rows: ExportableProduct[] = filtered.map((p) => ({
				handle: p._id,
				name: p.name,
				description: p.description,
				options: p.options ?? [],
				currency: p.currency,
				categories: categoryNamesByProduct[p._id],
				active: p.active,
				hidden: p.hidden,
				hiddenByCategory: p.hiddenByCategory,
				url: `${storefrontUrl(retailer.slug)}/p/${p.slug}`,
				minQuantity: p.minQuantity,
				minNoticeDays: p.minNoticeDays,
				imageCount: p.imageUrls?.length ?? 0,
				variants: p.variants.map((vr) => ({
					optionValues: vr.optionValues,
					sku: vr.sku,
					price: vr.price,
					onHand: vr.onHand,
					parcelWeightG: vr.parcelWeightG,
					active: vr.active,
					reserved: vr.reserved,
					blockWhenOutOfStock: vr.blockWhenOutOfStock,
					requiresProof: vr.requiresProof,
					isCustom: vr.isCustom,
					customLabel: vr.customLabel,
					imageCount: vr.imageUrls?.length,
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
				subtitle={productsSubtitle}
				actions={
					<>
						{BULK_IO_ENABLED ? (
							<BulkIoMenu
								canExport={counts.all > 0}
								exporting={exporting}
								onExport={handleExport}
							/>
						) : null}
						<CategoriesLink locked={categoriesLocked} />
						<NewProductButton
							blockedReason={capBlockReason}
							label="+ New product"
							className="h-10"
						/>
					</>
				}
			/>
			<div className="flex items-center justify-between gap-3 lg:hidden">
				<div className="flex min-w-0 flex-col">
					<h2 className="font-heading text-[22px] font-extrabold leading-tight tracking-tight">
						Products
					</h2>
					{products === undefined ? (
						<Skeleton className="h-3 w-32 rounded" />
					) : (
						<p className="text-[13px] text-muted-foreground">
							{productsSubtitle}
						</p>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{BULK_IO_ENABLED ? (
						<BulkIoMenu
							canExport={counts.all > 0}
							exporting={exporting}
							onExport={handleExport}
						/>
					) : null}
					<CategoriesLink locked={categoriesLocked} mobile />
					<NewProductButton
						blockedReason={capBlockReason}
						label="+ New"
						className="h-11"
					/>
				</div>
			</div>

			{/* At the ceiling the disabled New button needs to say WHY, and the
			    reason isn't guessable: archiving looks like removal but keeps the
			    slot, so only deleting frees one. A `title` tooltip can't carry that
			    on a phone, which is where these sellers work. */}
			{capBlockReason ? (
				<section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-800 dark:bg-amber-950/50">
					<p className="text-sm font-semibold">
						You've reached the {cap.cap}-product limit
					</p>
					<p className="mt-1 text-[13px] leading-snug text-muted-foreground">
						Archived products still count toward it. Delete a product you no
						longer sell to free up a slot — or message us if your shop genuinely
						needs more than {cap.cap}.
					</p>
				</section>
			) : null}

			<div className="relative lg:max-w-md">
				<Search
					className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
					aria-hidden="true"
				/>
				<Input
					type="search"
					value={rawQuery}
					onChange={(e) => setRawQuery(e.target.value)}
					placeholder="Search products"
					className="h-11 w-full rounded-xl border-border bg-card pl-9 pr-10 text-sm"
				/>
				{rawQuery ? (
					<button
						type="button"
						onClick={() => setRawQuery("")}
						className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
						aria-label="Clear search"
					>
						<X className="size-4" aria-hidden="true" />
					</button>
				) : null}
			</div>

			{/* Status filters — the shared FilterChip; the row scrolls edge-to-edge
			    on mobile. Import/Export lives in the header (next to New), not here. */}
			<FilterChipRow>
				{filterOptions.map((opt) => (
					<FilterChip
						key={opt.key}
						selected={status === opt.key}
						onClick={() => setStatus(opt.key)}
						count={products !== undefined ? counts[opt.key] : undefined}
					>
						{opt.label}
					</FilterChip>
				))}
			</FilterChipRow>

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

/**
 * "New product", disabled-with-reason once the store is at the product cap.
 * Rendered at both header breakpoints, so the block lives in one place and the
 * two can't disagree. An `<a>` can't be disabled, so the blocked state renders a
 * real `<button>` rather than a link that would only fail at the server.
 */
function NewProductButton({
	blockedReason,
	label,
	className,
}: {
	blockedReason: string | null;
	label: string;
	className?: string;
}) {
	if (blockedReason)
		return (
			<Button disabled title={blockedReason} className={className}>
				{label}
			</Button>
		);
	return (
		<Button asChild className={className}>
			<Link to="/app/products/new">{label}</Link>
		</Button>
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
	// Mirror the storefront card exactly, so the seller's list never states a
	// price more confidently than the buyer's does: everything quoted reads
	// "Price on quote", and a floor (range, cheaper quote line, or a custom
	// line's starting price) is prefixed "From" (86eyhn4mr).
	const allQuote = p.hasQuotePricing && p.priceTo === 0;
	const showFrom =
		priceVaries || p.hasQuotePricing || hasStartingPrice(p.variants);
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
				<AppImage src={p.imageUrls[0]} alt="" aspect="size-full" />
			</div>
			{/* Fixed three-line shape (name / price · variants / stock word) so
			    every row is the same height — a wrapping meta line was making some
			    cards taller than their neighbours. Lines truncate, never wrap. */}
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate text-[14.5px] font-semibold">{p.name}</span>
				<span className="truncate text-[13px] text-muted-foreground">
					<span className="font-medium text-foreground">
						{allQuote ? (
							"Price on quote"
						) : (
							<>
								{showFrom ? "From " : ""}
								{formatPrice(p.priceFrom, p.currency)}
							</>
						)}
					</span>
					{variantCount > 1 ? ` · ${variantCount} variants` : ""}
				</span>
				{/* Stock state as a colour word — the number a home seller actually
				    protects. Archived rows use the slot for their status instead. */}
				<span className="truncate text-[12.5px] font-semibold">
					{!p.active ? (
						<span className="font-normal text-muted-foreground">Archived</span>
					) : outOfStock ? (
						<span className="text-red-600 dark:text-red-400">Sold out</span>
					) : lowStock ? (
						<span className="text-amber-700 dark:text-amber-400">
							{p.totalOnHand} left
						</span>
					) : (
						<span className="text-accent-emphasis">In stock</span>
					)}
				</span>
			</div>
			<div className="flex shrink-0 flex-col items-end gap-1">
				{p.active && (p.minQuantity ?? 0) >= 2 ? (
					// Minimum-order-quantity rule — flagged on the list so the seller
					// can see at a glance which products carry it. See minOrderRules.
					<span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
						Min {p.minQuantity}
					</span>
				) : null}
				{p.active && (p.hidden || p.hiddenByCategory) ? (
					// Off the public storefront, still sellable at the counter — flagged
					// so the state is never silent. Either the seller's own toggle
					// (`hidden`) or category suppression (`hiddenByCategory`, every one
					// of its categories is hidden). See docs/hidden-products.md +
					// docs/product-categories.md.
					<span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
						<EyeOff className="size-3" aria-hidden />
						{p.hidden ? "Hidden" : "Hidden · category"}
					</span>
				) : null}
				{p.active ? (
					<ChevronRight
						className="size-4 text-muted-foreground/60"
						aria-hidden="true"
					/>
				) : (
					<EyeOff className="size-4 text-muted-foreground/60" aria-hidden />
				)}
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
	// Reconcile on activeKey only, not on the per-render activeIds array.
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on activeKey, activeIds read via closure.
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
