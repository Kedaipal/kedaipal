import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { PageHeader } from "../components/dashboard/page-header";
import {
	ProductForm,
	type ProductFormSubmitValues,
} from "../components/forms/product-form";
import { ProductWizard } from "../components/forms/product-wizard";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { hasFeature } from "../lib/subscription";

/**
 * New product = the 5-step wizard by default; `?form=full` is the escape hatch
 * for power sellers (the wizard's "Skip — use the full form" link) and renders
 * the same restructured form the edit page uses. See
 * docs/product-setup-wizard.md.
 */
export const Route = createFileRoute("/app/products/new")({
	validateSearch: (search: Record<string, unknown>): { form?: "full" } =>
		search.form === "full" ? { form: "full" } : {},
	component: NewProductRoute,
});

function NewProductRoute() {
	const navigate = useNavigate();
	const { form } = Route.useSearch();
	const retailer = useDashboardRetailer();
	const create = useMutation(api.products.create);
	const setProductCategories = useMutation(api.categories.setProductCategories);

	if (!retailer) return null;

	const categoriesLocked =
		!retailer.actingAsAdmin && !hasFeature(retailer.subscription, "categories");

	async function handleCreate(values: ProductFormSubmitValues) {
		if (!retailer) return;
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
	}

	// Wizard path (default) — it owns its own header/back/progress chrome.
	if (form !== "full") {
		return (
			<div className="flex flex-col gap-4 lg:max-w-2xl">
				<ProductWizard
					currency={retailer.currency}
					onSubmit={handleCreate}
					onSkipToFullForm={() =>
						navigate({
							to: "/app/products/new",
							search: { form: "full" },
							replace: true,
						})
					}
					onExit={() => navigate({ to: "/app/products" })}
				/>
			</div>
		);
	}

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
				onSubmit={handleCreate}
			/>
		</div>
	);
}
