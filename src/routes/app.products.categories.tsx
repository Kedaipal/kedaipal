import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArchiveRestore, ArrowLeft, FolderOpen, Pencil } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
	ProBadge,
	ProFeatureTease,
	ProFeatureWall,
} from "../components/app/pro-gate";
import { CategoryEditDialog } from "../components/dashboard/category-edit-dialog";
import { PageHeader } from "../components/dashboard/page-header";
import { Button } from "../components/ui/button";
import { CopyButton } from "../components/ui/copy-button";
import { Skeleton } from "../components/ui/skeleton";
import { SortableList } from "../components/ui/sortable-list";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { convexErrorMessage } from "../lib/format";
import { reorderByIds } from "../lib/reorder";
import { storefrontUrl } from "../lib/storefront-url";
import { hasFeature } from "../lib/subscription";

type CategoryRow = FunctionReturnType<
	typeof api.categories.listForRetailer
>[number];

export const Route = createFileRoute("/app/products/categories")({
	component: CategoriesRoute,
});

/**
 * Mobile back arrow → Products. Desktop uses the PageHeader `back` prop; the
 * mobile header is separate (PageHeader is desktop-only), so it needs its own
 * back affordance to match every other nested `/app` screen. Mirrors the
 * product-editor back button.
 */
function MobileBackLink() {
	return (
		<Link
			to="/app/products"
			aria-label="Back to products"
			className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted lg:hidden"
		>
			<ArrowLeft className="size-5" />
		</Link>
	);
}

/**
 * Category management — lives under Products (categories are catalog
 * structure). List + drag-reorder the active categories, archive/restore,
 * create/edit via CategoryEditDialog. Building structure is Pro-gated; the
 * escape hatches (archive/restore) stay live on every tier so a downgraded
 * seller can always take categories off their storefront.
 */
function CategoriesRoute() {
	const retailer = useDashboardRetailer();
	const categories = useQuery(
		api.categories.listForRetailer,
		retailer ? { retailerId: retailer._id } : "skip",
	);

	const [dialog, setDialog] = useState<
		{ open: true; category: CategoryRow | undefined } | { open: false }
	>({ open: false });

	if (!retailer) return null;

	// Plan gate (Pro+). The list stays readable so archive is always reachable;
	// only the structure-building actions lock. Admin act-as sees through it.
	const locked =
		!retailer.actingAsAdmin && !hasFeature(retailer.subscription, "categories");

	const active = categories?.filter((c) => c.active);
	const archived = categories?.filter((c) => !c.active);

	// Locked with nothing built yet → the full wall (the screen has no other job).
	if (locked && categories !== undefined && categories.length === 0) {
		return (
			<div className="flex flex-col gap-5 lg:gap-6">
				<PageHeader
					title="Categories"
					subtitle="Available on Pro"
					back={{ to: "/app/products", label: "Products" }}
				/>
				<div className="flex items-center gap-3 lg:hidden">
					<MobileBackLink />
					<h2 className="text-xl font-bold">Categories</h2>
				</div>
				<ProFeatureWall
					slug={retailer.slug}
					icon={<FolderOpen className="size-5 text-muted-foreground" />}
					title="Group products into categories"
					blurb="Categories are part of the Pro plan. Group your menu — Daily Meals, Event Packages — and buyers browse by tapping a category instead of scrolling one long list."
					bullets={[
						"Category tiles on your storefront, each with its own shareable link",
						"A product can sit in several categories at once",
						"Buyers always keep an “All products” view — nothing gets buried",
					]}
				/>
			</div>
		);
	}

	const newButton = (
		<Button
			className="h-11 lg:h-10"
			disabled={locked}
			onClick={() => setDialog({ open: true, category: undefined })}
		>
			+ New category
			{locked ? <ProBadge className="ml-1.5" /> : null}
		</Button>
	);

	return (
		<div className="flex flex-col gap-4 lg:gap-5">
			<PageHeader
				title="Categories"
				subtitle={
					categories === undefined
						? "Loading…"
						: `${active?.length ?? 0} active · ${archived?.length ?? 0} archived`
				}
				back={{ to: "/app/products", label: "Products" }}
				actions={newButton}
			/>
			<div className="flex items-center justify-between gap-3 lg:hidden">
				<div className="flex min-w-0 items-center gap-3">
					<MobileBackLink />
					<div className="flex min-w-0 flex-col">
						<h2 className="font-heading text-[22px] font-extrabold leading-tight tracking-tight">
							Categories
						</h2>
						{categories === undefined ? (
							<Skeleton className="h-3 w-32 rounded" />
						) : (
							<p className="text-[13px] text-muted-foreground">
								{active?.length ?? 0} active · {archived?.length ?? 0} archived
							</p>
						)}
					</div>
				</div>
				<div className="shrink-0">{newButton}</div>
			</div>

			{locked ? (
				<ProFeatureTease message="Your categories still show on your storefront, but editing the structure is part of the Pro plan. You can archive any category below." />
			) : null}

			{categories === undefined || !active || !archived ? (
				<CategoryListSkeleton />
			) : categories.length === 0 ? (
				<div className="rounded-2xl border border-dashed border-border p-8 text-center">
					<p className="font-medium">No categories yet</p>
					<p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
						Group products — like “Daily Meals” or “Event Packages” — and buyers
						browse your storefront by category instead of one long list. Each
						category gets its own shareable link.
					</p>
					<Button
						className="mt-4 h-11"
						onClick={() => setDialog({ open: true, category: undefined })}
					>
						+ New category
					</Button>
				</div>
			) : (
				<>
					{active.length > 0 ? (
						<ActiveCategoryList
							retailerId={retailer._id}
							storeSlug={retailer.slug}
							categories={active}
							locked={locked}
							onEdit={(category) => setDialog({ open: true, category })}
						/>
					) : (
						<div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
							Every category is archived — restore one below or create a new one
							to bring the category rail back.
						</div>
					)}
					{archived.length > 0 ? (
						<div className="flex flex-col gap-3">
							<p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
								Archived · not shown on storefront
							</p>
							<ul className="flex flex-col gap-2">
								{archived.map((category) => (
									<li key={category._id}>
										<CategoryCard
											category={category}
											storeSlug={retailer.slug}
											locked={locked}
											onEdit={() => setDialog({ open: true, category })}
										/>
									</li>
								))}
							</ul>
						</div>
					) : null}
				</>
			)}

			{dialog.open ? (
				<CategoryEditDialog
					open
					onClose={() => setDialog({ open: false })}
					category={dialog.category}
					retailerId={retailer._id}
					storeSlug={retailer.slug}
				/>
			) : null}
		</div>
	);
}

function ActiveCategoryList({
	retailerId,
	storeSlug,
	categories,
	locked,
	onEdit,
}: {
	retailerId: Id<"retailers">;
	storeSlug: string;
	categories: CategoryRow[];
	locked: boolean;
	onEdit: (category: CategoryRow) => void;
}) {
	const reorder = useMutation(api.categories.reorder);
	const ids = categories.map((c) => c._id);
	const key = ids.join("|");
	const [localOrder, setLocalOrder] = useState<Id<"categories">[]>(ids);
	// Reconcile on the id-set key only, not the per-render array.
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on key, ids read via closure.
	useEffect(() => {
		setLocalOrder(ids);
	}, [key]);

	const ordered = reorderByIds(categories, localOrder, (c) => c._id);

	async function handleReorder(orderedIds: string[]) {
		const prev = localOrder;
		setLocalOrder(orderedIds as Id<"categories">[]); // optimistic
		try {
			await reorder({
				retailerId,
				orderedIds: orderedIds as Id<"categories">[],
			});
		} catch (err) {
			setLocalOrder(prev);
			toast.error(convexErrorMessage(err));
		}
	}

	// Reordering is structure-building (Pro) and needs 2+ rows to mean anything.
	if (locked || categories.length < 2) {
		return (
			<ul className="flex flex-col gap-2">
				{ordered.map((category) => (
					<li key={category._id}>
						<CategoryCard
							category={category}
							storeSlug={storeSlug}
							locked={locked}
							onEdit={() => onEdit(category)}
						/>
					</li>
				))}
			</ul>
		);
	}

	return (
		<SortableList
			items={ordered}
			getId={(c) => c._id}
			onReorder={handleReorder}
			className="flex flex-col gap-2"
			renderItem={(category, handle) => (
				<CategoryCard
					category={category}
					storeSlug={storeSlug}
					locked={locked}
					onEdit={() => onEdit(category)}
					dragHandle={handle}
				/>
			)}
		/>
	);
}

function CategoryCard({
	category,
	storeSlug,
	locked,
	onEdit,
	dragHandle,
}: {
	category: CategoryRow;
	storeSlug: string;
	locked: boolean;
	onEdit: () => void;
	dragHandle?: ReactNode;
}) {
	const setActive = useMutation(api.categories.setActive);
	const [toggling, setToggling] = useState(false);
	const deepLink = `${storefrontUrl(storeSlug)}/c/${category.slug}`;

	async function handleToggle() {
		setToggling(true);
		try {
			await setActive({ categoryId: category._id, active: !category.active });
			toast.success(
				category.active
					? "Category archived — its tile is off your storefront."
					: "Category restored.",
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setToggling(false);
		}
	}

	return (
		<div
			className={`flex items-center gap-2 rounded-2xl border border-border bg-card p-2.5 ${category.active ? "" : "opacity-60"}`}
		>
			{dragHandle}
			<div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted ring-1 ring-border/60">
				{category.imageUrl ? (
					<img
						src={category.imageUrl}
						alt=""
						className="size-full object-cover"
					/>
				) : (
					<FolderOpen className="size-5 text-muted-foreground" aria-hidden />
				)}
			</div>
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate text-[14.5px] font-semibold">
					{category.name}
				</span>
				{category.description ? (
					<span className="line-clamp-1 text-[13px] text-muted-foreground">
						{category.description}
					</span>
				) : null}
				<span className="truncate text-[12.5px] text-muted-foreground/80">
					{category.productCount === 0
						? category.active
							? "No products yet — tile hidden until one is added"
							: "No products"
						: `${category.productCount} product${category.productCount === 1 ? "" : "s"}`}
					<span className="text-muted-foreground/60">
						{" "}
						· /c/{category.slug}
					</span>
				</span>
			</div>
			{/* Actions collapse to icon-only on mobile (labels shown ≥lg) so a
			    category name isn't crushed to "Dail…" on a 360px row. Every action
			    keeps an aria-label, so the icon-only state stays accessible. */}
			<div className="flex shrink-0 items-center gap-0.5">
				{category.active ? (
					<CopyButton
						value={deepLink}
						ariaLabel={`Copy link to ${category.name}`}
						successMessage="Category link copied — share it on WhatsApp"
						className="h-10 px-2.5"
						labelClassName="hidden lg:inline"
					/>
				) : null}
				{!locked ? (
					<button
						type="button"
						onClick={onEdit}
						aria-label={`Edit ${category.name}`}
						className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<Pencil className="size-4" aria-hidden />
					</button>
				) : null}
				<button
					type="button"
					onClick={handleToggle}
					disabled={toggling}
					aria-label={
						category.active
							? `Archive ${category.name}`
							: `Restore ${category.name}`
					}
					className="flex h-10 items-center justify-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
				>
					<ArchiveRestore className="size-4" aria-hidden />
					<span className="hidden lg:inline">
						{category.active ? "Archive" : "Restore"}
					</span>
				</button>
			</div>
		</div>
	);
}

function CategoryListSkeleton() {
	return (
		<ul className="flex flex-col gap-2">
			{[0, 1, 2].map((n) => (
				<li
					key={n}
					className="flex items-center gap-3 rounded-2xl border border-border bg-card p-2.5"
				>
					<Skeleton className="size-12 shrink-0 rounded-xl" />
					<div className="flex min-w-0 flex-1 flex-col gap-1.5">
						<Skeleton className="h-4 w-2/5 rounded" />
						<Skeleton className="h-3 w-3/5 rounded" />
					</div>
				</li>
			))}
		</ul>
	);
}
