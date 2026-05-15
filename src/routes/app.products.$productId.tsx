import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ProductForm } from "../components/forms/product-form";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";

export const Route = createFileRoute("/app/products/$productId")({
	component: EditProductRoute,
});

function ProductDetailSkeleton() {
	return (
		<div className="flex flex-col gap-4 lg:max-w-2xl">
			<Skeleton className="h-4 w-20 rounded" />
			<Skeleton className="h-7 w-36 rounded" />
			<div className="flex flex-col gap-4">
				<Skeleton className="aspect-square w-full rounded-2xl" />
				<div className="flex flex-col gap-2">
					<Skeleton className="h-3 w-12 rounded" />
					<Skeleton className="h-11 w-full rounded-xl" />
				</div>
				<div className="flex flex-col gap-2">
					<Skeleton className="h-3 w-16 rounded" />
					<Skeleton className="h-24 w-full rounded-xl" />
				</div>
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
				<Skeleton className="h-11 w-full rounded-xl" />
			</div>
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
	const archive = useMutation(api.products.archive);

	if (product === undefined) {
		return <ProductDetailSkeleton />;
	}
	if (product === null) {
		return <p className="text-sm text-destructive">Product not found.</p>;
	}

	return (
		<div className="flex flex-col gap-4 lg:max-w-2xl">
			<div className="flex items-center gap-2">
				<Link
					to="/app/products"
					className="text-sm text-muted-foreground hover:text-foreground"
				>
					← Products
				</Link>
			</div>
			<h2 className="text-xl font-bold">Edit product</h2>

			<ProductForm
				key={product._id}
				currency={product.currency}
				initialValues={{
					sku: product.sku,
					name: product.name,
					description: product.description,
					price: product.price,
					stock: product.stock,
					imageStorageIds: product.imageStorageIds,
					imageUrls: product.imageUrls,
				}}
				submitLabel="Save changes"
				onSubmit={async (values) => {
					// Passing null clears an existing SKU when the user blanks the field.
					await update({
						productId: product._id,
						sku: values.sku ?? null,
						name: values.name,
						description: values.description,
						price: values.price,
						stock: values.stock,
						imageStorageIds: values.imageStorageIds,
					});
					navigate({ to: "/app/products" });
				}}
			/>

			{product.active ? (
				<Button
					variant="secondary"
					className="h-11"
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
					className="h-11"
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
