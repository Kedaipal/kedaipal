import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { PageHeader } from "../components/dashboard/page-header";
import {
	ProductForm,
	type ProductFormDraft,
	type ProductFormSubmitValues,
} from "../components/forms/product-form";
import {
	formDraftToWizardState,
	ProductWizard,
	type wizardHandoff,
	type WizardState,
} from "../components/forms/product-wizard";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { hasFeature } from "../lib/subscription";

/**
 * New product = the 5-step wizard by default; `?form=full` renders the same
 * restructured form the edit page uses. Both views edit the SAME
 * `VariantEditorState` substrate, so switching is lossless in both directions
 * (`wizardHandoff` / `formDraftToWizardState`) — no capability gap, nothing
 * to confirm. Drafts ride in memory only; a refresh starts the chosen view
 * blank. See docs/product-setup-wizard.md.
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
	// Wizard → full form: the wizard's whole draft — basics as initialValues
	// plus the SHARED editor substrate passed through as-is (lossless).
	const [wizardDraft, setWizardDraft] =
		useState<ReturnType<typeof wizardHandoff>>();
	// Full form → wizard: the restored WizardState derived from the form draft.
	const [wizardReturn, setWizardReturn] = useState<WizardState>();
	// Live getter for the full form's as-typed state (assigned by ProductForm
	// every render, read only on the switch-back click).
	const formDraftRef = useRef<(() => ProductFormDraft) | null>(null);
	// Set once the product row exists — makes a post-create failure (categories)
	// retryable without minting a second product.
	const createdProductId = useRef<Id<"products"> | null>(null);

	if (!retailer) return null;

	const categoriesLocked =
		!retailer.actingAsAdmin && !hasFeature(retailer.subscription, "categories");

	async function handleCreate(values: ProductFormSubmitValues) {
		if (!retailer) return;
		// The two writes aren't atomic: if categories fail (plan gate, rate
		// limit) the product already exists and the seller sees the error with
		// Publish re-enabled. Remember the id so a retry ATTACHES CATEGORIES to
		// that product instead of creating a duplicate.
		const productId =
			createdProductId.current ??
			(await create({
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
			}));
		createdProductId.current = productId;
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

	function openFullForm(handoff: ReturnType<typeof wizardHandoff>) {
		setWizardDraft(handoff);
		navigate({ to: "/app/products/new", search: { form: "full" }, replace: true });
	}

	function switchBackToWizard() {
		// Both views edit the same VariantEditorState, so the trip is lossless —
		// no confirm needed, nothing can be dropped.
		const draft = formDraftRef.current?.();
		if (draft) setWizardReturn(formDraftToWizardState(draft));
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

			{/* Way back to the guided setup — lossless (same draft substrate). */}
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
				initialValues={wizardDraft?.initialValues}
				initialEditor={wizardDraft?.initialEditor}
				mode="create"
				draftRef={formDraftRef}
				currency={retailer.currency}
				submitLabel="Create product"
				onSubmit={handleCreate}
			/>
		</div>
	);
}
