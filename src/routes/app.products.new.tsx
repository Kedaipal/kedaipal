import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { PageHeader } from "../components/dashboard/page-header";
import { ProductForm } from "../components/forms/product-form";

export const Route = createFileRoute("/app/products/new")({
	component: NewProductRoute,
});

function NewProductRoute() {
	const navigate = useNavigate();
	const retailer = useQuery(api.retailers.getMyRetailer);
	const create = useMutation(api.products.create);

	if (!retailer) return null;

	return (
		<div className="flex flex-col gap-4 lg:max-w-2xl">
			<PageHeader
				title="New product"
				back={{ to: "/app/products", label: "Products" }}
			/>
			<div className="flex items-center gap-2 lg:hidden">
				<Link
					to="/app/products"
					className="text-sm text-muted-foreground hover:text-foreground"
				>
					← Products
				</Link>
			</div>
			<h2 className="text-xl font-bold lg:hidden">New product</h2>

			<ProductForm
				currency={retailer.currency}
				submitLabel="Create product"
				onSubmit={async (values) => {
					await create({
						retailerId: retailer._id,
						name: values.name,
						description: values.description,
						currency: retailer.currency,
						imageStorageIds: values.imageStorageIds,
						sortOrder: Date.now(),
						options: values.options,
						blockWhenOutOfStock: values.blockWhenOutOfStock,
						requiresProof: values.requiresProof,
						variants: values.variants,
					});
					navigate({ to: "/app/products" });
				}}
			/>
		</div>
	);
}
