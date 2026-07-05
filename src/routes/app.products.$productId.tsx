import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Archive, ArchiveRestore, ArrowLeft } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
	PageHeader,
	PageHeaderSkeleton,
} from "../components/dashboard/page-header";
import { ProductForm } from "../components/forms/product-form";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";

export const Route = createFileRoute("/app/products/$productId")({
	component: EditProductRoute,
});

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
	const product = useQuery(api.products.get, {
		productId: productId as Id<"products">,
	});
	const update = useMutation(api.products.update);
	const saveVariantGrid = useMutation(api.products.saveVariantGrid);
	const archive = useMutation(api.products.archive);

	if (product === undefined) {
		return <ProductDetailSkeleton />;
	}
	if (product === null) {
		return <p className="text-sm text-destructive">Product not found.</p>;
	}

	return (
		<div className="flex flex-col gap-4 lg:max-w-2xl">
			<PageHeader
				title="Edit product"
				subtitle={product.name}
				back={{ to: "/app/products", label: "Products" }}
				actions={
					product.active ? (
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
					)
				}
			/>
			{/* Mobile header — back button, title, live/archived indicator (mirrors
			    the archive state so it's visible from the top of a long form). */}
			<div className="flex items-center gap-3 lg:hidden">
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
				{product.active ? (
					<span className="flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-accent-emphasis">
						<span
							className="inline-block size-2 rounded-full bg-accent"
							aria-hidden="true"
						/>
						Live
					</span>
				) : (
					<span className="shrink-0 text-[13px] font-semibold text-muted-foreground">
						Archived
					</span>
				)}
			</div>

			<ProductForm
				key={product._id}
				currency={product.currency}
				initialValues={{
					name: product.name,
					description: product.description,
					hidden: product.hidden,
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
					product.active ? (
						<Button
							type="button"
							variant="outline"
							size="icon"
							className="size-12 shrink-0 rounded-xl bg-background text-destructive hover:bg-destructive/10 hover:text-destructive"
							aria-label="Archive product"
							onClick={async () => {
								await archive({ productId: product._id });
								navigate({ to: "/app/products" });
							}}
						>
							<Archive className="size-5" />
						</Button>
					) : (
						<Button
							type="button"
							variant="outline"
							size="icon"
							className="size-12 shrink-0 rounded-xl bg-background"
							aria-label="Restore product"
							onClick={async () => {
								await update({ productId: product._id, active: true });
							}}
						>
							<ArchiveRestore className="size-5" />
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
						imageStorageIds: values.imageStorageIds,
					});
					await saveVariantGrid({
						productId: product._id,
						options: values.options,
						variants: values.variants,
					});
					navigate({ to: "/app/products" });
				}}
			/>
		</div>
	);
}
