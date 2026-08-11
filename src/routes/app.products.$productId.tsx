import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import {
	Archive,
	ArchiveRestore,
	ArrowLeft,
	Eye,
	Info,
	Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
	PageHeader,
	PageHeaderSkeleton,
} from "../components/dashboard/page-header";
import {
	ProductForm,
	type ProductFormDraft,
} from "../components/forms/product-form";
import { ProductDetailSheet } from "../components/storefront/product-detail-sheet";
import { Button } from "../components/ui/button";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../components/ui/dialog";
import { Skeleton } from "../components/ui/skeleton";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { convexErrorMessage } from "../lib/format";
import { draftPreviewOverlay } from "../lib/product-preview";
import { type ProductStatus, productStatus } from "../lib/product-status";
import { hasFeature } from "../lib/subscription";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/app/products/$productId")({
	component: EditProductRoute,
});

/**
 * The product's honest one-word state — Live / Sold out / Hidden / Archived —
 * derived by `productStatus`. Replaces the old `active ? "Live" : "Archived"`
 * chip that kept saying "Live" for hidden and sold-out products. The `title`
 * carries the one-line explanation on hover/long-press.
 */
function StatusChip({ status }: { status: ProductStatus }) {
	return (
		<span
			title={status.detail}
			className={cn(
				"flex shrink-0 items-center gap-1.5 text-[13px] font-semibold",
				status.tone === "live" && "text-accent-emphasis",
				status.tone === "warn" && "text-amber-700 dark:text-amber-400",
				status.tone === "muted" && "text-muted-foreground",
			)}
		>
			<span
				className={cn(
					"inline-block size-2 rounded-full",
					status.tone === "live" && "bg-accent",
					status.tone === "warn" && "bg-amber-500",
					status.tone === "muted" && "bg-muted-foreground/50",
				)}
				aria-hidden="true"
			/>
			{status.label}
		</span>
	);
}

function ProductDetailSkeleton() {
	return (
		<div className="flex flex-col gap-4 lg:max-w-2xl">
			<PageHeaderSkeleton hasBack hasSubtitle hasActions />
			{/* Mobile back + title */}
			<div className="flex flex-col gap-2 lg:hidden">
				<Skeleton className="h-4 w-20 rounded" />
				<Skeleton className="h-7 w-36 rounded" />
			</div>
			{/* Image grid */}
			<div className="grid grid-cols-3 gap-2">
				<Skeleton className="aspect-square w-full rounded-xl" />
				<Skeleton className="aspect-square w-full rounded-xl" />
				<Skeleton className="aspect-square w-full rounded-xl" />
			</div>
			{/* Name field */}
			<div className="flex flex-col gap-2">
				<Skeleton className="h-3 w-12 rounded" />
				<Skeleton className="h-11 w-full rounded-xl" />
			</div>
			{/* Description field */}
			<div className="flex flex-col gap-2">
				<Skeleton className="h-3 w-20 rounded" />
				<Skeleton className="h-24 w-full rounded-xl" />
			</div>
			{/* Price + Stock fields */}
			<div className="flex gap-3">
				<div className="flex flex-1 flex-col gap-2">
					<Skeleton className="h-3 w-10 rounded" />
					<Skeleton className="h-11 w-full rounded-xl" />
				</div>
				<div className="flex flex-1 flex-col gap-2">
					<Skeleton className="h-3 w-10 rounded" />
					<Skeleton className="h-11 w-full rounded-xl" />
				</div>
			</div>
			{/* SKU field */}
			<div className="flex flex-col gap-2">
				<Skeleton className="h-3 w-10 rounded" />
				<Skeleton className="h-11 w-full rounded-xl" />
			</div>
			<Skeleton className="h-12 w-full rounded-md" />
		</div>
	);
}

function EditProductRoute() {
	const { productId } = Route.useParams();
	const navigate = useNavigate();
	const retailer = useDashboardRetailer();
	const product = useQuery(
		convexQuery(api.products.get, { productId: productId as Id<"products"> }),
	).data;
	// Current category membership seeds the form's picker — awaited alongside
	// the product so the form mounts once with complete initial values.
	const categoryIds = useQuery(
		convexQuery(api.categories.getProductCategoryIds, {
			productId: productId as Id<"products">,
		}),
	).data;
	const update = useMutation(api.products.update);
	const saveVariantGrid = useMutation(api.products.saveVariantGrid);
	const setProductCategories = useMutation(api.categories.setProductCategories);
	const archive = useMutation(api.products.archive);
	const deletePermanently = useMutation(api.products.deletePermanently);
	const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
	const [whyCantDeleteOpen, setWhyCantDeleteOpen] = useState(false);
	const [deleting, setDeleting] = useState(false);
	// Buyer-eye preview: mounts the REAL storefront detail sheet in-page (the
	// same bottom sheet buyers get) — no new tab — rendered from the form's
	// LIVE DRAFT so unsaved edits show exactly as buyers would see them after
	// saving. Built once per open (a fresh object identity every render would
	// reset the sheet's selection state).
	const formDraftRef = useRef<(() => ProductFormDraft) | null>(null);
	const [previewProduct, setPreviewProduct] = useState<Record<
		string,
		unknown
	> | null>(null);

	if (product === undefined || categoryIds === undefined || !retailer) {
		return <ProductDetailSkeleton />;
	}
	if (product === null) {
		return <p className="text-sm text-destructive">Product not found.</p>;
	}

	const status = productStatus(product);
	// Stamped the first time this product appeared on any order (and never
	// cleared, not even if that order was cancelled). The server refuses the
	// delete on the same field — this only decides which state the UI shows.
	const hasSold = product.orderedAt !== undefined;

	function openPreview() {
		const draft = formDraftRef.current?.();
		if (!draft) return;
		// Identity fields (_id, retailerId, currency, _creationTime…) come from
		// the saved row; everything the buyer SEES comes from the draft overlay.
		// The cast covers the fabricated preview variant ids — the sheet only
		// uses them as keys and through the stubbed onAdd.
		setPreviewProduct({ ...product, ...draftPreviewOverlay(draft) });
	}

	return (
		<div className="flex flex-col gap-4 lg:max-w-2xl">
			<PageHeader
				title="Edit product"
				subtitle={product.name}
				back={{ to: "/app/products", label: "Products" }}
				actions={
					<>
						<StatusChip status={status} />
						<Button
							variant="outline"
							onClick={openPreview}
							title="See this product exactly as buyers do — including unsaved changes"
						>
							<Eye className="size-4" aria-hidden="true" />
							Preview
						</Button>
						{product.active ? (
							<Button
								variant="secondary"
								onClick={async () => {
									await archive({ productId: product._id });
									navigate({ to: "/app/products" });
								}}
							>
								Archive
							</Button>
						) : (
							<Button
								variant="secondary"
								onClick={async () => {
									await update({ productId: product._id, active: true });
								}}
							>
								Restore
							</Button>
						)}
					</>
				}
			/>
			{/* Mobile header — back button, title, storefront preview + the honest
			    status chip (Live / Sold out / Hidden / Archived), visible from the
			    top of a long form. */}
			<div className="flex items-center gap-2 lg:hidden">
				<Link
					to="/app/products"
					aria-label="Back to products"
					className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted"
				>
					<ArrowLeft className="size-5" />
				</Link>
				<h2 className="min-w-0 flex-1 truncate font-heading text-lg font-extrabold leading-tight">
					Edit product
				</h2>
				<button
					type="button"
					onClick={openPreview}
					aria-label="Preview this product as buyers see it"
					title="See this product exactly as buyers do — including unsaved changes"
					className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted"
				>
					<Eye className="size-5" />
				</button>
				<StatusChip status={status} />
			</div>

			<ProductForm
				key={product._id}
				retailerId={product.retailerId}
				draftRef={formDraftRef}
				categoriesLocked={
					!retailer.actingAsAdmin &&
					!hasFeature(retailer.subscription, "categories")
				}
				currency={product.currency}
				initialValues={{
					name: product.name,
					description: product.description,
					hidden: product.hidden,
					minNoticeDays: product.minNoticeDays,
					minQuantity: product.minQuantity,
					categoryIds,
					imageStorageIds: product.imageStorageIds,
					imageUrls: product.imageUrls,
					options: product.options ?? [],
					variants: product.variants.map((vr) => ({
						optionValues: vr.optionValues,
						sku: vr.sku,
						price: vr.price,
						onHand: vr.onHand,
						active: vr.active,
						// Resolved per-variant server-side (override ?? product default).
						blockWhenOutOfStock: vr.blockWhenOutOfStock,
						requiresProof: vr.requiresProof,
						imageStorageIds: vr.imageStorageIds,
						imageUrls: vr.imageUrls,
						isCustom: vr.isCustom,
						customLabel: vr.customLabel,
						customPrompt: vr.customPrompt,
					})),
				}}
				submitLabel="Save changes"
				stickyAction={
					// Labelled, and NOT tinted red — an icon-only red button here read
					// as "delete", when archive is the reversible, gentle action. The
					// word is the disambiguation; red is reserved for the true
					// destructive CTA below the form.
					product.active ? (
						<Button
							type="button"
							variant="outline"
							className="h-12 shrink-0 gap-2 rounded-xl bg-background px-4"
							onClick={async () => {
								await archive({ productId: product._id });
								navigate({ to: "/app/products" });
							}}
						>
							<Archive className="size-4" />
							Archive
						</Button>
					) : (
						<Button
							type="button"
							variant="outline"
							className="h-12 shrink-0 gap-2 rounded-xl bg-background px-4"
							onClick={async () => {
								await update({ productId: product._id, active: true });
							}}
						>
							<ArchiveRestore className="size-4" />
							Restore
						</Button>
					)
				}
				onSubmit={async (values) => {
					// Product-level scalar fields, then the option axes + variant grid.
					// The hard-block + mockup flags now live per-variant on the grid
					// (`saveVariantGrid`); `update` only handles name/description/images.
					await update({
						productId: product._id,
						name: values.name,
						description: values.description ?? null,
						hidden: values.hidden,
						minNoticeDays: values.minNoticeDays,
						// 0 clears the rule (blank input) — server normalizes to unset.
						minQuantity: values.minQuantity ?? 0,
						imageStorageIds: values.imageStorageIds,
					});
					await saveVariantGrid({
						productId: product._id,
						options: values.options,
						variants: values.variants,
					});
					// Category membership last — a plan-gate error here can't block
					// the core save above. Server diffs, so unchanged = no-op.
					await setProductCategories({
						productId: product._id,
						categoryIds: values.categoryIds,
					});
					navigate({ to: "/app/products" });
				}}
			/>

			{/* Buyer-eye preview of the LIVE draft, composed from the same
			    product-purchase.tsx pieces the buyer's product page uses — so what
			    the seller previews is what the buyer gets. A sheet (not the page)
			    because a draft has no public URL to navigate to and the preview
			    shouldn't eject the seller from the editor. Cart wiring is stubbed:
			    quantity steppers and option pills work, but "Add to cart" just
			    explains it's a preview. */}
			<ProductDetailSheet
				product={previewProduct as never}
				retailerId={product.retailerId}
				cartQuantity={0}
				onClose={() => setPreviewProduct(null)}
				onAdd={() =>
					toast("Just a preview — buyers add to cart here.", {
						id: "product-preview",
					})
				}
			/>

			{/* Permanent delete — the only way to free a slot under the product cap
			    (archiving keeps it). A single quiet row below the form, NOT beside
			    Save/Archive in the sticky bar (a destructive control next to routine
			    ones invites the misclick) and NOT a boxed "danger zone" (a whole
			    section for one button over-announces it). Sold products keep the
			    control visible but blocked — tapping opens the WHY dialog instead of
			    a dead disabled button, because the shared Button's
			    `disabled:pointer-events-none` means a disabled control can't even
			    show a hover tooltip, and a reason you can't reach on a phone is a
			    reason that doesn't exist. The dialog also offers Archive, so the
			    blocked path ends in the right action rather than a shrug. */}
			{hasSold ? (
				<Button
					type="button"
					variant="ghost"
					onClick={() => setWhyCantDeleteOpen(true)}
					className="h-11 self-start gap-2 px-3 text-sm font-medium text-muted-foreground"
				>
					<Trash2 className="size-4" aria-hidden="true" />
					Delete permanently
					<Info className="size-4" aria-hidden="true" />
				</Button>
			) : (
				<Button
					type="button"
					variant="ghost"
					onClick={() => setConfirmDeleteOpen(true)}
					disabled={deleting}
					className="h-11 self-start gap-2 px-3 text-sm font-medium text-destructive hover:bg-destructive/10 hover:text-destructive"
				>
					<Trash2 className="size-4" aria-hidden="true" />
					{deleting ? "Deleting…" : "Delete permanently"}
				</Button>
			)}

			<Dialog open={whyCantDeleteOpen} onOpenChange={setWhyCantDeleteOpen}>
				<DialogContent className="sm:max-w-sm">
					<DialogHeader>
						<DialogTitle>This product can't be deleted</DialogTitle>
						<DialogDescription>
							It has been ordered before, and those orders still reference it —
							deleting it would break their history. Products with order history
							can only be archived: that takes them off your storefront and
							counter, but keeps their records (and their slot toward your
							product limit).
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setWhyCantDeleteOpen(false)}
						>
							Close
						</Button>
						{product.active ? (
							<Button
								onClick={async () => {
									await archive({ productId: product._id });
									navigate({ to: "/app/products" });
								}}
							>
								<Archive className="size-4" />
								Archive instead
							</Button>
						) : null}
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<ConfirmDialog
				open={confirmDeleteOpen}
				onOpenChange={setConfirmDeleteOpen}
				title={`Delete "${product.name}"?`}
				description="This removes the product, its options and its photos for good. It has never been ordered, so no order history is affected. This can't be undone."
				confirmLabel="Delete permanently"
				destructive
				onConfirm={async () => {
					setDeleting(true);
					try {
						await deletePermanently({ productId: product._id });
						toast.success("Product deleted.");
						navigate({ to: "/app/products" });
					} catch (err) {
						toast.error(convexErrorMessage(err));
						throw err; // keeps the dialog open so the seller can retry
					} finally {
						setDeleting(false);
					}
				}}
			/>
		</div>
	);
}
