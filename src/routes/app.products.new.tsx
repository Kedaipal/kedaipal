import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { PageHeader } from "../components/dashboard/page-header";
import {
	ProductForm,
	type ProductFormDraft,
	type ProductFormInitialValues,
	type ProductFormSubmitValues,
} from "../components/forms/product-form";
import {
	formDraftToWizardState,
	ProductWizard,
	type WizardState,
} from "../components/forms/product-wizard";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { hasFeature } from "../lib/subscription";

/**
 * New product = the 5-step wizard by default; `?form=full` renders the same
 * restructured form the edit page uses. The switch is two-directional and
 * value-preserving: wizard → full carries the whole draft
 * (`wizardToFormInitialValues` / step-1 basics), full → wizard reverse-derives
 * a WizardState from the form's as-typed draft (`formDraftToWizardState`) —
 * anything the wizard can't represent is confirmed before it's dropped.
 * Drafts ride in memory only; a refresh starts the chosen view blank.
 * See docs/product-setup-wizard.md.
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
	// Wizard → full form: the draft the wizard built (full handoff or step-1
	// basics), seeding the form's initial values.
	const [wizardDraft, setWizardDraft] = useState<ProductFormInitialValues>();
	// Full form → wizard: the restored WizardState derived from the form draft.
	const [wizardReturn, setWizardReturn] = useState<WizardState>();
	// Live getter for the full form's as-typed state (assigned by ProductForm
	// every render, read only on the switch-back click).
	const formDraftRef = useRef<(() => ProductFormDraft) | null>(null);

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
			minNoticeDays: values.minNoticeDays,
			minQuantity: values.minQuantity,
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

	function openFullForm(initialValues: ProductFormInitialValues) {
		setWizardDraft(initialValues);
		navigate({ to: "/app/products/new", search: { form: "full" }, replace: true });
	}

	function switchBackToWizard() {
		const draft = formDraftRef.current?.();
		if (!draft) {
			navigate({ to: "/app/products/new", search: {}, replace: true });
			return;
		}
		const { state, lost } = formDraftToWizardState(draft);
		// Only interrupt when something genuinely can't make the trip.
		if (
			lost.length > 0 &&
			!window.confirm(
				`The guided setup can't carry over:\n\n• ${lost.join("\n• ")}\n\nEverything else keeps its value. Switch anyway?`,
			)
		) {
			return;
		}
		setWizardReturn(state);
		navigate({ to: "/app/products/new", search: {}, replace: true });
	}

	// Wizard path (default) — it owns its own header/back/progress chrome.
	if (form !== "full") {
		return (
			<div className="flex flex-col gap-4 lg:max-w-2xl">
				<ProductWizard
					retailerId={retailer._id}
					categoriesLocked={categoriesLocked}
					currency={retailer.currency}
					initialState={wizardReturn}
					onSubmit={handleCreate}
					onSkipToFullForm={openFullForm}
					onOpenFullForm={openFullForm}
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

			{/* Way back to the guided setup — value-preserving (the form's draft is
			    reverse-derived into wizard answers; a confirm only appears when
			    something can't make the trip). */}
			<button
				type="button"
				onClick={switchBackToWizard}
				className="self-start text-sm font-semibold text-accent-emphasis hover:underline"
			>
				← Prefer the guided setup? Switch back
			</button>

			<ProductForm
				retailerId={retailer._id}
				categoriesLocked={categoriesLocked}
				initialValues={wizardDraft}
				mode="create"
				draftRef={formDraftRef}
				currency={retailer.currency}
				submitLabel="Create product"
				onSubmit={handleCreate}
			/>
		</div>
	);
}
