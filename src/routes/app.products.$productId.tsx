import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
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
			<div className="flex items-center gap-2 lg:hidden">
				<Link
					to="/app/products"
					className="text-sm text-muted-foreground hover:text-foreground"
				>
					← Products
				</Link>
			</div>
			<h2 className="text-xl font-bold lg:hidden">Edit product</h2>

			<ProductForm
				key={product._id}
				currency={product.currency}
				initialValues={{
					name: product.name,
					description: product.description,
					blockWhenOutOfStock: product.blockWhenOutOfStock,
					imageStorageIds: product.imageStorageIds,
					imageUrls: product.imageUrls,
					options: product.options ?? [],
					variants: product.variants.map((vr) => ({
						optionValues: vr.optionValues,
						sku: vr.sku,
						price: vr.price,
						onHand: vr.onHand,
						active: vr.active,
						imageStorageIds: vr.imageStorageIds,
						imageUrls: vr.imageUrls,
					})),
				}}
				submitLabel="Save changes"
				onSubmit={async (values) => {
					// Product-level fields, then the option axes + variant grid. Two
					// mutations: `update` never touches variants; `saveVariantGrid`
					// reconciles them (preserving variant ids for matched combos).
					await update({
						productId: product._id,
						name: values.name,
						description: values.description ?? null,
						imageStorageIds: values.imageStorageIds,
						blockWhenOutOfStock: values.blockWhenOutOfStock,
					});
					await saveVariantGrid({
						productId: product._id,
						options: values.options,
						variants: values.variants,
					});
					navigate({ to: "/app/products" });
				}}
			/>

			{product.active ? (
				<Button
					variant="secondary"
					className="h-11 lg:hidden"
					onClick={async () => {
						await archive({ productId: product._id });
						navigate({ to: "/app/products" });
					}}
				>
					Archive product
				</Button>
			) : (
				<Button
					variant="secondary"
					className="h-11 lg:hidden"
					onClick={async () => {
						await update({ productId: product._id, active: true });
					}}
				>
					Restore product
				</Button>
			)}
		</div>
	);
}
