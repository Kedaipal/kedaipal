import { useQuery } from "convex/react";
import {
	ChefHat,
	ChevronLeft,
	EyeOff,
	PackageCheck,
	Plus,
	Store,
	X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	convexErrorMessage,
	normalizePriceInput,
	parsePriceInput,
} from "../../lib/format";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { CategoryPicker } from "./category-picker";
import type {
	ProductFormInitialValues,
	ProductFormSubmitValues,
} from "./product-form";
import { type ProductImage, ProductImagesField } from "./product-images-field";
import { AXIS_PRESETS, PriceInput, StockInput } from "./variant-editor";

// Mirrors the server cap in convex/lib/variant.ts (one axis in the wizard, so
// values are capped directly).
const MAX_WIZARD_VALUES = 50;

/**
 * Draft state for the 5-step create wizard. Answers to plain-language
 * questions; `buildWizardSubmitValues` derives the real product config from
 * them — the wizard never exposes variants/SKUs/axes vocabulary.
 * See docs/product-setup-wizard.md.
 */
export type WizardState = {
	name: string;
	description: string;
	images: ProductImage[];
	/** Step 2 — "Does the buyer pick anything?" null until answered. */
	hasChoices: boolean | null;
	/** The single option axis the wizard supports (e.g. "Size"). */
	axisName: string;
	axisValues: string[];
	/** Major-unit price strings, keyed by choice value; SINGLE_KEY for one-item. */
	prices: Record<string, string>;
	/** Step 4 — "How do you prepare orders?" null until answered. */
	madeToOrder: boolean | null;
	/** Integer stock strings, keyed like `prices`. Only read when From stock. */
	stocks: Record<string, string>;
	/** Optional seller item codes, keyed like `prices`. Revealed on the price
	 * step behind "+ Add your own item codes (SKU)". */
	skus: Record<string, string>;
	/** Review step — hidden = off the public storefront, still counter-sellable
	 * (docs/hidden-products.md). Default visible. */
	hidden: boolean;
	/** Review step — category membership (only offered when the store has
	 * categories). Same submit path as the full form. */
	categoryIds: Id<"categories">[];
	/** Review "More options" — mockup approval on every choice. Only offered
	 * (and only applied) for made-to-order products. */
	requiresProof: boolean;
	/** Review "More options" — the optional custom / made-to-order line
	 * (docs/custom-option.md). Null = not offered. */
	customLine: { label: string; price: string; prompt: string } | null;
};

/** Key into prices/stocks for the one-item (no choices) branch. */
const SINGLE_KEY = "";

export function emptyWizardState(): WizardState {
	return {
		name: "",
		description: "",
		images: [],
		hasChoices: null,
		axisName: "",
		axisValues: [],
		prices: {},
		madeToOrder: null,
		stocks: {},
		skus: {},
		hidden: false,
		categoryIds: [],
		requiresProof: false,
		customLine: null,
	};
}

export type WizardIssue = { field: string; message: string };

/** The keys a state's price/stock maps are read at (choice values, or the
 * single implicit item). */
function priceKeys(state: WizardState): string[] {
	return state.hasChoices ? state.axisValues : [SINGLE_KEY];
}

/**
 * Per-step validation, pure for tests. Steps 2/4 are additionally gated
 * structurally (Continue disabled until the question is answered).
 */
export function wizardStepIssues(
	state: WizardState,
	step: number,
): WizardIssue[] {
	const issues: WizardIssue[] = [];
	if (step === 1) {
		if (state.name.trim().length === 0) {
			issues.push({ field: "name", message: "Give your product a name." });
		}
	}
	if (step === 2 && state.hasChoices) {
		if (state.axisName.trim().length === 0) {
			issues.push({
				field: "axisName",
				message: "What do buyers choose by? Tap a suggestion or type your own.",
			});
		}
		if (state.axisValues.length === 0) {
			issues.push({
				field: "axisValues",
				message: "Add at least one choice (e.g. Small).",
			});
		}
		if (state.axisValues.length > MAX_WIZARD_VALUES) {
			issues.push({
				field: "axisValues",
				message: `Keep it to ${MAX_WIZARD_VALUES} choices or fewer.`,
			});
		}
	}
	if (step === 3) {
		for (const key of priceKeys(state)) {
			const raw = (state.prices[key] ?? "").trim();
			if (parsePriceInput(raw) === null) {
				issues.push({
					field: `price:${key}`,
					message:
						raw.length === 0
							? "Enter a price (e.g. 12 or 12.50)."
							: "Not a valid price — numbers only (e.g. 12 or 12.50).",
				});
			}
		}
	}
	if (step === 4 && state.madeToOrder === false) {
		for (const key of priceKeys(state)) {
			if (!/^\d+$/.test((state.stocks[key] ?? "").trim())) {
				issues.push({
					field: `stock:${key}`,
					message: "Enter how many you have (0 is fine).",
				});
			}
		}
	}
	if (step === 5 && state.customLine) {
		const raw = state.customLine.price.trim();
		if (raw.length > 0 && parsePriceInput(raw) === null) {
			issues.push({
				field: "customPrice",
				message:
					"Not a valid price — enter a number, or leave blank for price on quote.",
			});
		}
	}
	return issues;
}

/**
 * Map the answered wizard onto the same submit payload the full form produces —
 * the create mutation path is identical, no wizard-specific backend. Assumes
 * every step validated (call `wizardStepIssues` first).
 */
export function buildWizardSubmitValues(
	state: WizardState,
): ProductFormSubmitValues {
	const trackStock = state.madeToOrder === false;
	// Mockup approval is only offered (and only applied) for made-to-order
	// products — flipping back to From stock at review quietly drops it.
	const requiresProof = state.madeToOrder === true && state.requiresProof;
	const variants: ProductFormSubmitValues["variants"] = priceKeys(state).map(
		(key) => {
			const price = parsePriceInput((state.prices[key] ?? "").trim());
			const stockRaw = (state.stocks[key] ?? "").trim();
			return {
				optionValues: key === SINGLE_KEY ? [] : [key],
				sku: (state.skus[key] ?? "").trim() || undefined,
				price: price !== null ? Math.round(price * 100) : 0,
				onHand: /^\d+$/.test(stockRaw) ? Number.parseInt(stockRaw, 10) : 0,
				active: true,
				blockWhenOutOfStock: trackStock,
				requiresProof,
				imageStorageIds: [],
			};
		},
	);
	// The custom line rides as a flagged entry, mirroring the full form's
	// buildSubmitVariants (blank price = "Price on quote").
	if (state.customLine) {
		const raw = state.customLine.price.trim();
		const parsed = raw.length > 0 ? parsePriceInput(raw) : null;
		variants.push({
			optionValues: [],
			price: parsed !== null ? Math.round(parsed * 100) : 0,
			onHand: 0,
			active: true,
			blockWhenOutOfStock: false,
			requiresProof: true,
			imageStorageIds: [],
			isCustom: true,
			customLabel: state.customLine.label.trim() || undefined,
			customPrompt: state.customLine.prompt.trim() || undefined,
		});
	}
	return {
		name: state.name.trim(),
		description:
			state.description.trim().length > 0 ? state.description.trim() : undefined,
		hidden: state.hidden,
		categoryIds: state.categoryIds,
		imageStorageIds: state.images.map((i) => i.id),
		options: state.hasChoices
			? [{ name: state.axisName.trim(), values: state.axisValues }]
			: [],
		variants,
	};
}

/**
 * Hand the wizard draft to the full form (`?form=full`) with everything the
 * seller entered — the consistency escape hatch: anything the wizard doesn't
 * surface (second axis, per-choice photos…) is one tap away WITHOUT retyping.
 * Image preview URLs ride along so the photos stay visible.
 */
export function wizardToFormInitialValues(
	state: WizardState,
): ProductFormInitialValues {
	const values = buildWizardSubmitValues(state);
	return {
		name: values.name,
		description: values.description,
		hidden: values.hidden,
		categoryIds: values.categoryIds,
		imageStorageIds: values.imageStorageIds,
		imageUrls: state.images.map((i) => i.url),
		options: values.options,
		variants: values.variants,
	};
}

/** Compact "RM 12" / "RM 12–28" label for the review preview. */
export function wizardPriceLabel(state: WizardState, currency: string): string {
	const parsed = priceKeys(state)
		.map((key) => parsePriceInput((state.prices[key] ?? "").trim()))
		.filter((p): p is number => p !== null);
	if (parsed.length === 0) return "";
	const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
	const min = Math.min(...parsed);
	const max = Math.max(...parsed);
	return min === max
		? `${currency} ${fmt(min)}`
		: `${currency} ${fmt(min)}–${fmt(max)}`;
}

const STEP_TITLES: Record<number, { title: string; sub: string }> = {
	1: { title: "Name it", sub: "Step 1 of 5" },
	2: { title: "Choices", sub: "Step 2 of 5" },
	3: { title: "Price", sub: "Step 3 of 5" },
	4: { title: "Preparing orders", sub: "Step 4 of 5" },
	5: { title: "Review", sub: "Step 5 of 5" },
};
const TOTAL_STEPS = 5;

function IssueText({ message }: { message: string | undefined }) {
	if (!message) return null;
	return (
		<span role="alert" className="text-xs font-normal text-destructive">
			{message}
		</span>
	);
}

/** Big answer card for the two branching questions. */
function AnswerCard({
	selected,
	icon,
	title,
	description,
	onClick,
}: {
	selected: boolean;
	icon: ReactNode;
	title: string;
	description: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={selected}
			onClick={onClick}
			className={cn(
				"flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors",
				selected
					? "border-accent bg-accent/10"
					: "border-border hover:border-accent/60",
			)}
		>
			<span className="mt-0.5 text-accent-emphasis">{icon}</span>
			<span className="min-w-0">
				<span className="block text-sm font-semibold">{title}</span>
				<span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
					{description}
				</span>
			</span>
		</button>
	);
}

export function ProductWizard({
	retailerId,
	categoriesLocked,
	currency,
	onSubmit,
	onSkipToFullForm,
	onOpenFullForm,
	onExit,
}: {
	/** Owning retailer — feeds the review step's category picker. */
	retailerId: Id<"retailers">;
	/** Client mirror of the `categories` plan gate (same as the full form). */
	categoriesLocked: boolean;
	currency: string;
	onSubmit: (values: ProductFormSubmitValues) => Promise<void>;
	/** "Skip — use the full form" on step 1 (power users / bulk sellers). */
	onSkipToFullForm: () => void;
	/** Review-step handoff: open the full form prefilled with the wizard draft
	 * (second axis, per-choice photos etc. without retyping). */
	onOpenFullForm: (initialValues: ProductFormInitialValues) => void;
	/** Back from step 1 / Cancel — leave the wizard entirely. */
	onExit: () => void;
}) {
	const [step, setStep] = useState(1);
	const [state, setStateRaw] = useState<WizardState>(emptyWizardState);
	const [issues, setIssues] = useState<WizardIssue[]>([]);
	const [uploading, setUploading] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [serverError, setServerError] = useState<string | null>(null);
	const [showDescription, setShowDescription] = useState(false);
	const [showSkus, setShowSkus] = useState(false);
	const [moreOpen, setMoreOpen] = useState(false);
	const [valueDraft, setValueDraft] = useState("");
	// Categories are only offered on review when the store actually has some —
	// a brand-new seller shouldn't meet a whole new concept mid-wizard.
	const categories = useQuery(api.categories.listForRetailer, { retailerId });
	const hasCategories = (categories?.filter((c) => c.active).length ?? 0) > 0;

	function patch(partial: Partial<WizardState>) {
		setStateRaw((prev) => ({ ...prev, ...partial }));
		setIssues([]);
		setServerError(null);
	}

	const issueFor = (field: string): string | undefined =>
		issues.find((i) => i.field === field)?.message;

	// Structural gate: the branching questions must be answered before Continue
	// makes sense; text-input problems surface on Continue instead (a disabled
	// button with no visible reason would read as broken).
	const structurallyAnswered =
		step === 2 ? state.hasChoices !== null : step === 4 ? state.madeToOrder !== null : true;

	function goNext() {
		const found = wizardStepIssues(state, step);
		if (found.length > 0) {
			setIssues(found);
			return;
		}
		setIssues([]);
		setStep((s) => Math.min(TOTAL_STEPS, s + 1));
	}

	function goBack() {
		if (step === 1) {
			onExit();
			return;
		}
		setIssues([]);
		setStep((s) => s - 1);
	}

	function addChoiceValue() {
		const draft = valueDraft.trim();
		if (!draft) return;
		if (
			state.axisValues.some((v) => v.toLowerCase() === draft.toLowerCase())
		) {
			setValueDraft("");
			return;
		}
		patch({ axisValues: [...state.axisValues, draft] });
		setValueDraft("");
	}

	function removeChoiceValue(value: string) {
		patch({ axisValues: state.axisValues.filter((v) => v !== value) });
	}

	function applyPreset(preset: { name: string; values: string[] }) {
		patch({
			axisName: preset.name,
			// Seed starter values only while the list is untouched — never clobber
			// choices the seller already typed.
			axisValues:
				state.axisValues.length > 0 ? state.axisValues : [...preset.values],
		});
	}

	function fillAllPrices(v: string) {
		const next: Record<string, string> = { ...state.prices };
		for (const key of priceKeys(state)) next[key] = v;
		patch({ prices: next });
	}

	// Anything typed = worth a confirm before discarding.
	const isDirty =
		state.name.trim().length > 0 ||
		state.images.length > 0 ||
		state.axisValues.length > 0 ||
		Object.values(state.prices).some((v) => v.trim().length > 0);

	function cancelWizard() {
		if (
			isDirty &&
			!window.confirm("Discard this product? Nothing has been saved.")
		) {
			return;
		}
		onExit();
	}

	async function publish() {
		// Belt-and-braces: re-validate every step before submitting (review-step
		// edits jump around, so a hole could otherwise slip through).
		for (let s = 1; s <= TOTAL_STEPS; s++) {
			const found = wizardStepIssues(state, s);
			if (found.length > 0) {
				setIssues(found);
				setStep(s);
				// A step-5 issue lives inside the More-options disclosure.
				if (s === TOTAL_STEPS) setMoreOpen(true);
				return;
			}
		}
		setSubmitting(true);
		setServerError(null);
		try {
			await onSubmit(buildWizardSubmitValues(state));
		} catch (err) {
			setServerError(convexErrorMessage(err));
			setSubmitting(false);
		}
	}

	const { title, sub } = STEP_TITLES[step];
	// Const capture so TS narrows it inside the review-step JSX closures.
	const customLine = state.customLine;

	return (
		<div className="flex flex-col gap-4">
			{/* Header: back + step title + progress dots. */}
			<div className="flex items-center gap-3">
				<button
					type="button"
					onClick={goBack}
					aria-label={step === 1 ? "Back to products" : "Previous step"}
					className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted"
				>
					<ChevronLeft className="size-5" />
				</button>
				<div className="min-w-0 flex-1">
					<h2 className="truncate font-heading text-lg font-extrabold leading-tight">
						{title}
					</h2>
					<p className="text-xs text-muted-foreground">{sub}</p>
				</div>
				<div className="flex shrink-0 items-center gap-1.5" aria-hidden>
					{Array.from({ length: TOTAL_STEPS }, (_, i) => (
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length progress dots
							key={i}
							className={cn(
								"h-1.5 rounded-full transition-all",
								i < step ? "w-4 bg-accent" : "w-1.5 bg-border",
							)}
						/>
					))}
				</div>
				{/* Direct exit — no need to press Back through every step. */}
				<button
					type="button"
					onClick={cancelWizard}
					aria-label="Cancel and discard"
					className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<X className="size-5" />
				</button>
			</div>

			<section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm lg:p-5">
				{step === 1 ? (
					<>
						<h3 className="text-xl font-bold leading-tight">
							What are you selling?
						</h3>
						<label className="flex flex-col gap-1.5 text-sm font-medium">
							Name
							<Input
								variant="field"
								placeholder="e.g. Chocolate fudge brownies"
								value={state.name}
								maxLength={120}
								onChange={(e) => patch({ name: e.target.value })}
								isError={!!issueFor("name")}
							/>
							<IssueText message={issueFor("name")} />
						</label>
						<ProductImagesField
							images={state.images}
							onChange={(images) => patch({ images })}
							onUploadingChange={setUploading}
							onError={setServerError}
						/>
						{showDescription ? (
							<label className="flex flex-col gap-1.5 text-sm font-medium">
								Description{" "}
								<span className="font-normal text-muted-foreground">
									(optional)
								</span>
								<textarea
									value={state.description}
									onChange={(e) => patch({ description: e.target.value })}
									rows={3}
									maxLength={1000}
									placeholder="What makes it special? Buyers see this on your storefront."
									className="rounded-xl border border-input bg-background px-3 py-2 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
								/>
							</label>
						) : (
							<button
								type="button"
								onClick={() => setShowDescription(true)}
								className="self-start text-sm font-semibold text-accent-emphasis hover:underline"
							>
								+ Add a description
							</button>
						)}
					</>
				) : null}

				{step === 2 ? (
					<>
						<h3 className="text-xl font-bold leading-tight">
							Does the buyer pick anything?
						</h3>
						<p className="-mt-2 text-sm text-muted-foreground">
							Like a size, flavour or weight. If it's one fixed item, choose the
							first.
						</p>
						<div className="flex flex-col gap-2.5">
							<AnswerCard
								selected={state.hasChoices === false}
								icon={<PackageCheck className="size-5" aria-hidden />}
								title="Just one item"
								description="One name, one price. e.g. Nasi lemak bungkus"
								onClick={() => patch({ hasChoices: false })}
							/>
							<AnswerCard
								selected={state.hasChoices === true}
								icon={<ChefHat className="size-5" aria-hidden />}
								title="Buyer picks a choice"
								description="e.g. Small / Medium / Large, or Pandan / Original"
								onClick={() => patch({ hasChoices: true })}
							/>
						</div>
						{state.hasChoices ? (
							<div className="flex flex-col gap-3 border-t border-border pt-3">
								<div className="flex flex-col gap-1.5">
									<span className="text-sm font-medium">
										What do they choose by?
									</span>
									<div className="flex flex-wrap items-center gap-1.5">
										{AXIS_PRESETS.map((preset) => (
											<button
												key={preset.name}
												type="button"
												onClick={() => applyPreset(preset)}
												className={cn(
													"rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
													state.axisName.toLowerCase() ===
														preset.name.toLowerCase()
														? "border-accent bg-accent/10 text-accent-emphasis"
														: "border-border hover:border-accent",
												)}
											>
												{preset.name}
											</button>
										))}
									</div>
									<Input
										placeholder="Or type your own (e.g. Colour)"
										value={state.axisName}
										onChange={(e) => patch({ axisName: e.target.value })}
										isError={!!issueFor("axisName")}
										className="h-10"
									/>
									<IssueText message={issueFor("axisName")} />
								</div>
								<div className="flex flex-col gap-1.5">
									<span className="text-sm font-medium">
										The choices{" "}
										<span className="font-normal text-muted-foreground">
											(each gets its own price next)
										</span>
									</span>
									<div className="flex flex-wrap items-center gap-1.5">
										{state.axisValues.map((v) => (
											<span
												key={v}
												className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-sm font-medium"
											>
												{v}
												<button
													type="button"
													onClick={() => removeChoiceValue(v)}
													aria-label={`Remove ${v}`}
												>
													<X className="size-3.5" />
												</button>
											</span>
										))}
										<div className="flex items-center gap-1">
											<Input
												placeholder="Add a choice"
												value={valueDraft}
												onChange={(e) => setValueDraft(e.target.value)}
												isError={!!issueFor("axisValues")}
												onKeyDown={(e) => {
													if (e.key === "Enter" || e.key === ",") {
														e.preventDefault();
														addChoiceValue();
													}
												}}
												// Commit on blur too — Android soft keyboards don't
												// fire a reliable Enter keydown.
												onBlur={addChoiceValue}
												className="h-9 w-32"
											/>
											<button
												type="button"
												onClick={addChoiceValue}
												className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:border-accent"
												aria-label="Add choice"
											>
												<Plus className="size-4" />
											</button>
										</div>
									</div>
									<IssueText message={issueFor("axisValues")} />
								</div>
								<p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
									Need two things (e.g. Size × Flavour)? Publish first — you can
									add a second choice under Edit product → Advanced.
								</p>
							</div>
						) : null}
					</>
				) : null}

				{step === 3 ? (
					<>
						<h3 className="text-xl font-bold leading-tight">
							{state.hasChoices ? "Price each choice" : "Set your price"}
						</h3>
						{state.hasChoices && state.axisValues.length > 1 ? (
							<label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
								Same price for all
								<Input
									inputMode="decimal"
									placeholder="0.00"
									className="h-9 w-24"
									onChange={(e) => fillAllPrices(e.target.value)}
									onBlur={(e) => fillAllPrices(normalizePriceInput(e.target.value))}
								/>
							</label>
						) : null}
						<div className="flex flex-col gap-3">
							{priceKeys(state).map((key) => (
								<div key={key} className="flex flex-col gap-1">
									<div className="flex items-center gap-3">
										<span className="min-w-0 flex-1 truncate text-sm font-medium">
											{key === SINGLE_KEY ? state.name.trim() || "This item" : key}
										</span>
										<span className="text-sm text-muted-foreground">
											{currency}
										</span>
										<PriceInput
											value={state.prices[key] ?? ""}
											onChange={(v) =>
												patch({ prices: { ...state.prices, [key]: v } })
											}
											className="h-11 w-28 text-right"
											invalid={!!issueFor(`price:${key}`)}
										/>
									</div>
									{showSkus ? (
										<div className="flex items-center justify-end gap-2">
											<span className="text-xs text-muted-foreground">SKU</span>
											<Input
												placeholder="ITEM-001"
												value={state.skus[key] ?? ""}
												onChange={(e) =>
													patch({
														skus: { ...state.skus, [key]: e.target.value },
													})
												}
												className="h-9 w-40"
												aria-label={`Item code for ${key === SINGLE_KEY ? "this item" : key}`}
											/>
										</div>
									) : null}
									<IssueText message={issueFor(`price:${key}`)} />
								</div>
							))}
						</div>
						{/* Question-first SKU: zero pixels unless the seller uses item
						    codes — no dedicated step for something most sellers skip. */}
						{showSkus ? null : (
							<button
								type="button"
								onClick={() => setShowSkus(true)}
								className="self-start text-sm font-semibold text-accent-emphasis hover:underline"
							>
								+ Add your own item codes (SKU)
							</button>
						)}
					</>
				) : null}

				{step === 4 ? (
					<>
						<h3 className="text-xl font-bold leading-tight">
							How do you prepare orders?
						</h3>
						<div className="flex flex-col gap-2.5">
							<AnswerCard
								selected={state.madeToOrder === true}
								icon={<ChefHat className="size-5" aria-hidden />}
								title="Made to order"
								description="You make each order fresh. Never marked sold out."
								onClick={() => patch({ madeToOrder: true })}
							/>
							<AnswerCard
								selected={state.madeToOrder === false}
								icon={<PackageCheck className="size-5" aria-hidden />}
								title="From stock"
								description="You have ready items. Orders stop when you run out."
								onClick={() => patch({ madeToOrder: false })}
							/>
						</div>
						{state.madeToOrder === true ? (
							<p className="rounded-xl bg-accent/10 px-3 py-2.5 text-sm leading-relaxed text-accent-emphasis">
								Nice — buyers can always order. No stock counting, nothing ever
								shows "sold out". You'll see the day's orders in your inbox.
							</p>
						) : null}
						{state.madeToOrder === false ? (
							<div className="flex flex-col gap-3 border-t border-border pt-3">
								<span className="text-sm font-medium">
									How many do you have right now?
								</span>
								{priceKeys(state).map((key) => (
									<div key={key} className="flex flex-col gap-1">
										<div className="flex items-center gap-3">
											<span className="min-w-0 flex-1 truncate text-sm font-medium">
												{key === SINGLE_KEY ? "In stock" : key}
											</span>
											<StockInput
												value={state.stocks[key] ?? ""}
												onChange={(v) =>
													patch({ stocks: { ...state.stocks, [key]: v } })
												}
												stepper
												className="w-40"
												invalid={!!issueFor(`stock:${key}`)}
											/>
										</div>
										<IssueText message={issueFor(`stock:${key}`)} />
									</div>
								))}
								<p className="text-xs text-muted-foreground">
									When a choice hits 0, buyers see "Sold out" until you restock.
								</p>
							</div>
						) : null}
					</>
				) : null}

				{step === 5 ? (
					<>
						<h3 className="text-xl font-bold leading-tight">
							Ready to publish?
						</h3>
						<p className="-mt-2 text-sm text-muted-foreground">
							This is what buyers will see on your store.
						</p>
						{/* Buyer-eye preview card. */}
						<div className="overflow-hidden rounded-2xl border border-border">
							{state.images[0]?.url ? (
								<img
									src={state.images[0].url}
									alt=""
									className="h-36 w-full object-cover"
								/>
							) : (
								<div className="flex h-24 w-full items-center justify-center bg-muted text-xs text-muted-foreground">
									No photo yet — you can add one later
								</div>
							)}
							<div className="flex flex-col gap-1.5 p-3">
								<span className="text-sm font-bold">
									{state.name.trim() || "Your product"}
								</span>
								{state.hasChoices ? (
									<div className="flex flex-wrap gap-1.5">
										{state.axisValues.map((v) => (
											<span
												key={v}
												className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium"
											>
												{v}
											</span>
										))}
									</div>
								) : null}
								<span className="text-sm font-extrabold text-accent-emphasis">
									{wizardPriceLabel(state, currency)}
								</span>
								{state.madeToOrder ? (
									<span className="self-start rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/50 dark:text-amber-400">
										Made to order
									</span>
								) : null}
							</div>
						</div>
						{/* Summary rows — Edit jumps back to the step, state intact. */}
						<div className="flex flex-col divide-y divide-border rounded-2xl border border-border px-3">
							{[
								{
									label: "Choices",
									value: state.hasChoices
										? `${state.axisValues.length} by ${state.axisName.trim()}`
										: "Just one item",
									step: 2,
								},
								{
									label: "Price",
									value: wizardPriceLabel(state, currency),
									step: 3,
								},
								{
									label: "Preparing",
									value: state.madeToOrder ? "Made to order" : "From stock",
									step: 4,
								},
							].map((row) => (
								<div
									key={row.label}
									className="flex items-center justify-between gap-3 py-2.5 text-sm"
								>
									<span className="text-muted-foreground">{row.label}</span>
									<span className="min-w-0 flex-1 truncate text-right font-medium">
										{row.value}
									</span>
									<button
										type="button"
										onClick={() => setStep(row.step)}
										className="shrink-0 text-xs font-bold text-accent-emphasis hover:underline"
									>
										Edit
									</button>
								</div>
							))}
						</div>
						{/* Optional publish settings — where the product appears. Kept on
						    review (not their own steps) so the wizard spine stays five
						    questions, but a counter-only or categorised product never
						    needs a create-then-edit round trip. */}
						<div className="flex flex-col gap-3 rounded-2xl border border-border p-3">
							<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
								<div className="min-w-0">
									<span className="text-sm font-semibold">Storefront</span>
									<p className="text-xs leading-relaxed text-muted-foreground">
										{state.hidden
											? "Hidden from your public store — still sellable at the counter."
											: "Shown on your public store and sellable everywhere."}
									</p>
								</div>
								<div className="flex shrink-0 gap-1 self-start rounded-xl bg-muted p-1">
									<button
										type="button"
										aria-pressed={!state.hidden}
										onClick={() => patch({ hidden: false })}
										className={cn(
											"flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors",
											!state.hidden
												? "bg-background text-foreground shadow-sm"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										<Store className="size-4" aria-hidden />
										Visible
									</button>
									<button
										type="button"
										aria-pressed={state.hidden}
										onClick={() => patch({ hidden: true })}
										className={cn(
											"flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors",
											state.hidden
												? "bg-background text-foreground shadow-sm"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										<EyeOff className="size-4" aria-hidden />
										Hidden
									</button>
								</div>
							</div>
							{hasCategories ? (
								<div className="border-t border-border pt-3">
									<CategoryPicker
										retailerId={retailerId}
										selectedIds={state.categoryIds}
										onChange={(categoryIds) => patch({ categoryIds })}
										locked={categoriesLocked}
										embedded
									/>
								</div>
							) : null}
						</div>
						{/* More options — full parity with the edit page's Advanced, so
						    create never needs a create-then-edit round trip. Collapsed:
						    zero pixels for the everyday seller. */}
						<div className="rounded-2xl border border-dashed border-border">
							<button
								type="button"
								onClick={() => setMoreOpen((v) => !v)}
								aria-expanded={moreOpen}
								className="flex w-full items-center justify-between gap-3 p-3 text-left"
							>
								<span className="flex min-w-0 flex-col">
									<span className="text-sm font-semibold">More options</span>
									<span className="truncate text-xs text-muted-foreground">
										{state.madeToOrder
											? "Design approval · custom option · full editor"
											: "Custom option · full editor"}
									</span>
								</span>
								{moreOpen ? (
									<ChevronLeft
										className="size-4 shrink-0 rotate-90 text-muted-foreground"
										aria-hidden
									/>
								) : (
									<ChevronLeft
										className="size-4 shrink-0 -rotate-90 text-muted-foreground"
										aria-hidden
									/>
								)}
							</button>
							{moreOpen ? (
								<div className="flex flex-col gap-4 border-t border-border p-3">
									{/* Mockup approval only makes sense for made-to-order work
									    (and is only applied then — see buildWizardSubmitValues). */}
									{state.madeToOrder ? (
										<label className="flex items-start gap-2.5 text-sm">
											<input
												type="checkbox"
												checked={state.requiresProof}
												onChange={(e) =>
													patch({ requiresProof: e.target.checked })
												}
												className="mt-0.5 size-4 shrink-0"
											/>
											<span>
												<span className="font-medium">
													Require mockup approval before making it
												</span>
												<span className="block text-xs text-muted-foreground">
													The buyer signs off on a photo or mockup before you
													start — e.g. a cake design approved before baking.
												</span>
											</span>
										</label>
									) : null}

									<div className="flex flex-col gap-3">
										<label className="flex items-start gap-2.5 text-sm">
											<input
												type="checkbox"
												checked={state.customLine !== null}
												onChange={(e) =>
													patch({
														customLine: e.target.checked
															? { label: "", price: "", prompt: "" }
															: null,
													})
												}
												className="mt-0.5 size-4 shrink-0"
											/>
											<span>
												<span className="font-medium">
													Also offer a custom / made-to-order option
												</span>
												<span className="block text-xs text-muted-foreground">
													A separate “Custom” line buyers can request — you
													approve a mockup (and any quote) before they pay.
												</span>
											</span>
										</label>
										{customLine ? (
											<div className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3">
												<label className="flex flex-col gap-1 text-sm font-medium">
													Option name
													<Input
														value={customLine.label}
														onChange={(e) =>
															patch({
																customLine: {
																	...customLine,
																	label: e.target.value,
																},
															})
														}
														placeholder="Custom"
														maxLength={40}
													/>
												</label>
												<label className="flex flex-col gap-1 text-sm font-medium">
													Starting price ({currency}){" "}
													<span className="font-normal text-muted-foreground">
														(optional — blank shows “Price on quote”)
													</span>
													<PriceInput
														value={customLine.price}
														onChange={(v) =>
															patch({
																customLine: { ...customLine, price: v },
															})
														}
														invalid={!!issueFor("customPrice")}
													/>
													<IssueText message={issueFor("customPrice")} />
												</label>
												<label className="flex flex-col gap-1 text-sm font-medium">
													What should the buyer tell you?{" "}
													<span className="font-normal text-muted-foreground">
														(optional)
													</span>
													<textarea
														value={customLine.prompt}
														onChange={(e) =>
															patch({
																customLine: {
																	...customLine,
																	prompt: e.target.value,
																},
															})
														}
														rows={2}
														maxLength={280}
														placeholder="e.g. Tell us your design, flavour, size & date needed"
														className="rounded-xl border border-input bg-background px-3 py-2 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
													/>
												</label>
											</div>
										) : null}
									</div>

									{/* Everything else (second choice, per-choice photos…) —
									    hand the draft to the full editor, nothing retyped. */}
									<div className="flex flex-col gap-1.5 border-t border-border pt-3">
										<Button
											type="button"
											variant="outline"
											onClick={() => onOpenFullForm(wizardToFormInitialValues(state))}
										>
											Open in the full editor
										</Button>
										<p className="text-center text-xs text-muted-foreground">
											For a second choice (e.g. Size × Flavour), per-choice
											photos and everything else — everything you've entered
											comes along.
										</p>
									</div>
								</div>
							) : null}
						</div>
					</>
				) : null}

				{serverError ? (
					<p
						role="alert"
						className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive"
					>
						{serverError}
					</p>
				) : null}
			</section>

			{/* Sticky CTA — Continue/Publish must never scroll away (mobile rule). */}
			<div className="sticky bottom-20 z-10 flex flex-col gap-2 lg:static">
				{step < TOTAL_STEPS ? (
					<Button
						type="button"
						onClick={goNext}
						disabled={!structurallyAnswered || uploading}
						className="h-12 w-full shadow-lg shadow-accent/20 lg:shadow-none"
					>
						{uploading ? "Uploading…" : "Continue"}
					</Button>
				) : (
					<Button
						type="button"
						onClick={publish}
						disabled={submitting}
						className="h-12 w-full shadow-lg shadow-accent/20 lg:shadow-none"
					>
						{submitting ? "Publishing…" : "Publish product"}
					</Button>
				)}
				{step === 1 ? (
					<button
						type="button"
						onClick={onSkipToFullForm}
						className="self-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
					>
						Know the full editor? Skip — use the full form
					</button>
				) : null}
				{step === 2 && !structurallyAnswered ? (
					<p className="text-center text-xs text-muted-foreground">
						Pick one to continue — you can change it any time.
					</p>
				) : null}
				{step === 4 && !structurallyAnswered ? (
					<p className="text-center text-xs text-muted-foreground">
						Pick one to continue — you can change it any time.
					</p>
				) : null}
			</div>
		</div>
	);
}
