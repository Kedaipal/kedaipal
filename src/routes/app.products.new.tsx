import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { PageHeader } from "../components/dashboard/page-header";
import { ProductForm } from "../components/forms/product-form";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { hasFeature } from "../lib/subscription";

export const Route = createFileRoute("/app/products/new")({
	component: NewProductRoute,
});

function NewProductRoute() {
	const navigate = useNavigate();
	const retailer = useDashboardRetailer();
	const create = useMutation(api.products.create);
	const setProductCategories = useMutation(api.categories.setProductCategories);

	if (!retailer) return null;

	const categoriesLocked =
		!retailer.actingAsAdmin && !hasFeature(retailer.subscription, "categories");

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
				retailerId={retailer._id}
				categoriesLocked={categoriesLocked}
				currency={retailer.currency}
				submitLabel="Create product"
				onSubmit={async (values) => {
					const productId = await create({
						retailerId: retailer._id,
						name: values.name,
						description: values.description,
						currency: retailer.currency,
						imageStorageIds: values.imageStorageIds,
						sortOrder: Date.now(),
						options: values.options,
						hidden: values.hidden,
						variants: values.variants,
					});
					// Junction rows keyed on the fresh id — ordered after create so a
					// category error can never block the core product save.
					if (values.categoryIds.length > 0) {
						await setProductCategories({
							productId,
							categoryIds: values.categoryIds,
						});
					}
					navigate({ to: "/app/products" });
				}}
			/>
		</div>
	);
}
