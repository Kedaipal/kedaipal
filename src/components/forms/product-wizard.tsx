import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import {
	CalendarRange,
	ChefHat,
	ChevronLeft,
	EyeOff,
	Package,
	PackageCheck,
	Plus,
	Sparkles,
	Store,
	UtensilsCrossed,
	Wrench,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MAX_NOTICE_DAYS } from "../../../convex/lib/fulfilmentDate";
import { MIN_QUANTITY_MAX } from "../../../convex/lib/minOrderRules";
import {
	MAX_CAPACITY_PER_NIGHT,
	type ProductKind,
} from "../../../convex/lib/productKind";
import {
	convexErrorMessage,
	normalizePriceInput,
	parsePriceInput,
} from "../../lib/format";
import { cn } from "../../lib/utils";
import { cartesian, type OptionAxis, variantLabel } from "../../lib/variant";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { CUSTOM_LINE_COPY, MOCKUP_APPROVAL_COPY } from "./advanced-option-copy";
import { CategoryPicker } from "./category-picker";
import {
	buildSubmitVariants,
	collectOptionIssues,
	type ProductFormDraft,
	type ProductFormInitialValues,
	type ProductFormSubmitValues,
} from "./product-form";
import { type ProductImage, ProductImagesField } from "./product-images-field";
import {
	AXIS_PRESETS,
	type CustomLineDraft,
	emptyRow,
	FulfilmentToggle,
	emptyCustomLine,
	isMadeToOrderOnly,
	PriceInput,
	rebuildRows,
	reconcileForSubmit,
	StockInput,
	type VariantEditorState,
	type VariantRow,
} from "./variant-editor";
import { VariantImageCell } from "./variant-image-cell";

// Mirrors the server caps in convex/lib/variant.ts.
const MAX_AXES = 2;
const MAX_VARIANTS = 50;

/**
 * Draft state for the 5-step create wizard. The selling configuration lives
 * in `editor` — the SAME `VariantEditorState` the full form edits — so the
 * wizard and the full form are two skins over one draft substrate: switching
 * between them is lossless by construction, and every capability (second
 * choice, per-choice photos/SKUs/on-off, mixed fulfilment, custom line with
 * photo) exists in both. See docs/product-setup-wizard.md.
 */
/**
 * Step 2's answer — what kind of thing this product is.
 *
 * - `single` — one name, one price.
 * - `choices` — option axes; the buyer picks a size/flavour/weight.
 * - `made_to_order` — nothing to pick and nothing priced up front: the buyer
 *   describes what they want, the seller quotes it and gets a mockup approved
 *   before making it. Sells through ONE implicit variant carrying
 *   `requiresProof: true`, `blockWhenOutOfStock: false` and (usually) price 0,
 *   which the storefront already renders as "Price on quote" — so this is a new
 *   ROUTE to a shape the catalog has always supported (`docs/custom-option.md`
 *   even prescribes it), not a new data model. No schema or server change.
 *
 * ONE field, not a `hasChoices` boolean plus a parallel `madeToOrder` one: two
 * flags encoding a single answer is the second-source-of-truth bug this wizard
 * has already been bitten by (86eyex5vk). And like that fix, every render and
 * validation read goes through the EDITOR where it can — `showAxes` /
 * `madeToOrder` below — so this field can never contradict the payload.
 */
export type ProductShape = "single" | "choices" | "made_to_order";

/**
 * Step 0's card — "What are you selling?" (86eyj70z1 decision 5). FOUR cards
 * but only THREE stored kinds: Food is a router that lands as `physical` and
 * re-words the preparation question, never a stored value. The card is
 * tracked (not just the derived kind) so the Food card stays lit for a food
 * seller instead of silently jumping to "Physical goods".
 */
export type KindCard = "food" | "physical" | "service" | "booking";

/** Card → stored kind. Food is the router: it stores as physical. */
export function kindFromCard(card: KindCard): ProductKind {
	return card === "food" ? "physical" : card;
}

/** Stored kind → the card to light. `physical` lights "Physical goods" —
 * the food identity is a wizard-session affordance, not stored (locked). */
export function cardFromKind(kind: ProductKind): KindCard {
	return kind;
}

export type WizardState = {
	name: string;
	description: string;
	images: ProductImage[];
	/** Step 0 — "What are you selling?" null until answered (pre-answered when
	 * the store's `storeType` is set — see `emptyWizardState`). */
	kindCard: KindCard | null;
	/** Booking kind only — per-night capacity, as typed. Prefilled "1". */
	capacityPerNight: string;
	/** Booking kind only — refundable security deposit (RM, as typed; blank =
	 * none). Collected with the payment, returned after check-out (S5). */
	securityDeposit: string;
	/** Step 2 — "What kind of product is it?" null until answered. */
	shape: ProductShape | null;
	/** The shared draft substrate (options + rows + custom line). */
	editor: VariantEditorState;
	/** Step 4 — set once "How do you prepare orders?" has been engaged with
	 * (the actual flags live per-row on `editor.rows`). */
	fulfilmentAnswered: boolean;
	/** Review step — hidden = off the public storefront, still counter-sellable
	 * (docs/hidden-products.md). Default visible. */
	hidden: boolean;
	/** Review step — category membership (only offered when the store has
	 * categories). Same submit path as the full form. */
	categoryIds: Id<"categories">[];
	/** Review "More options" — order rules, as typed (blank = no rule). */
	minQuantity: string;
	minNoticeDays: string;
};

export function emptyWizardState(defaultKind?: ProductKind): WizardState {
	// A set storeType pre-answers the kind card — the step still SHOWS (never a
	// silently skipped question), ringed with a "Your store type" badge, and one
	// tap picks something else. A booking default also seeds the booking row
	// shape (capacity governs availability, stock never blocks).
	const kindCard = defaultKind ? cardFromKind(defaultKind) : null;
	return {
		name: "",
		description: "",
		images: [],
		kindCard,
		capacityPerNight: "1",
		securityDeposit: "",
		shape: null,
		editor: {
			options: [],
			rows: [
				defaultKind === "booking"
					? { ...emptyRow([]), blockWhenOutOfStock: false }
					: emptyRow([]),
			],
			customLine: null,
		},
		fulfilmentAnswered: defaultKind === "booking",
		hidden: false,
		categoryIds: [],
		minQuantity: "",
		minNoticeDays: "",
	};
}

/** The stored kind this draft will submit — physical until step 0 says
 * otherwise. Booking is the one kind that changes the walked route. */
export function wizardKind(state: WizardState): ProductKind {
	return state.kindCard ? kindFromCard(state.kindCard) : "physical";
}

export type WizardIssue = { field: string; message: string };

/**
 * **The one shape derivation.** `state.shape` is the step-2 affordance; the
 * EDITOR is the source of truth, and where they disagree the editor wins —
 * the posture `86eyex5vk` established for axes, extended to all three answers.
 *
 * Every read — validation, the step sequence, which card is lit, the review
 * rows — goes through this. Splitting it (`state.shape` in one place, a derived
 * flag in another) is what let the mockup-approval checkbox flip a draft into
 * the made-to-order shape while step 2 still showed nothing selected and the
 * "no choices, no stock" explainer rendered underneath (PR #160 review).
 *
 * Pure + exported for tests.
 */
export function effectiveShape(state: WizardState): ProductShape | null {
	// Axes present ⇒ the buyer picks, whatever the answer says.
	if (state.shape === "choices" || state.editor.options.length > 0) {
		return "choices";
	}
	if (state.shape === "made_to_order" || isMadeToOrderOnly(state.editor)) {
		return "made_to_order";
	}
	return state.shape;
}

/**
 * The steps this product actually has to answer. Step 0 (kind) leads every
 * route (86eyj70z1: kind-first). A BOOKING listing skips **Choices** (one
 * implicit variant — a plot has no size matrix) and **Preparation**
 * (request-to-book IS the preparation; capacity, not stock, governs
 * availability) — its step 3 renders as price-per-night + capacity. A
 * made-to-order product skips **Preparation** and keeps Price, where the
 * amount becomes optional. Step IDs stay stable (0,1,2,3,4,5) so every
 * `step === n` render branch is untouched; only the ORDER walked through them
 * changes. Takes the EFFECTIVE shape, never `state.shape` — otherwise the
 * walked route can disagree with the screen. Pure + exported for tests.
 */
export function wizardSteps(
	shape: ProductShape | null,
	kind: ProductKind = "physical",
): number[] {
	if (kind === "booking") return [0, 1, 3, 5];
	return shape === "made_to_order" ? [0, 1, 2, 3, 5] : [0, 1, 2, 3, 4, 5];
}

/** Stable key for a row's price/stock/sku inputs: its variant label ("" for
 * the single implicit item). */
function rowKey(row: VariantRow): string {
	return variantLabel(row.optionValues);
}

/**
 * A server SKU rejection names the offending code (`SKU "BRN-S" is already
 * used…` / `Duplicate SKU "BRN-S" within this product`). Match it back to the
 * row that owns it so the wizard can land the seller on that exact input.
 * Pure + exported for tests.
 */
export function skuConflictTarget(
	message: string,
	rows: VariantRow[],
): { key: string; sku: string } | null {
	const match = /sku "([^"]+)"/i.exec(message);
	if (!match) return null;
	const sku = match[1];
	const row = rows.find(
		(r) => r.sku.trim().toLowerCase() === sku.trim().toLowerCase(),
	);
	return row ? { key: rowKey(row), sku } : null;
}

/**
 * Per-step validation, pure for tests. Delegates the real rules to the SAME
 * validators the full form uses (`collectOptionIssues`,
 * `buildSubmitVariants`) and re-addresses them to wizard fields, so the two
 * views can never disagree about what's valid.
 */
export function wizardStepIssues(
	state: WizardState,
	step: number,
): WizardIssue[] {
	const issues: WizardIssue[] = [];
	const { customLine } = state.editor;
	// Validate the shape that will actually be SUBMITTED (see
	// buildWizardSubmitValues), not the raw editor state — otherwise a rebuilt
	// row's missing price passes the steps and then collapses `variants` to an
	// empty array at submit, which the server rejects as "needs at least one
	// variant". Sanitizing also keeps the axis checks in step with the server,
	// which trims values and drops blank ones.
	//
	// CAVEAT: unlike the full form, the wizard never writes the reconciled grid
	// back into `state.editor` (this function is pure and has no setter). That's
	// safe only while reconcile can't actually rebuild rows here — every wizard
	// option write goes through `setOptions` → `rebuildRows`, so the grid already
	// covers the cartesian. If a path ever breaks that, the step 3/4 issues keyed
	// `price:${rowKey(reconciledRows[i])}` would address rows that aren't
	// rendered, reproducing the unrenderable-issue dead end at a later step. Add
	// the write-back (or reconcile on mount) before introducing such a path.
	// `reconcileForSubmit` also resolves a made-to-order product's blank price to
	// 0 ("Price on quote"), so step 3 doesn't demand an amount this type has by
	// design left open.
	const { options, rows } = reconcileForSubmit(
		state.editor.options,
		state.editor.rows,
	);
	const booking = wizardKind(state) === "booking";
	if (step === 0) {
		if (state.kindCard === null) {
			issues.push({ field: "kind", message: "Pick one to continue." });
		}
	}
	if (step === 1) {
		if (state.name.trim().length === 0) {
			issues.push({
				field: "name",
				message: booking
					? "Give your listing a name."
					: "Give your product a name.",
			});
		}
	}
	// Booking's step 3 owns capacity + notice (its whole pricing card); the
	// per-night price itself rides the shared row validation below.
	if (step === 3 && booking) {
		const cap = Number(state.capacityPerNight.trim());
		if (
			state.capacityPerNight.trim().length === 0 ||
			!Number.isInteger(cap) ||
			cap < 1 ||
			cap > MAX_CAPACITY_PER_NIGHT
		) {
			issues.push({
				field: "capacityPerNight",
				message: `Enter a whole number between 1 and ${MAX_CAPACITY_PER_NIGHT}.`,
			});
		}
		const depositRaw = state.securityDeposit.trim();
		if (depositRaw.length > 0) {
			const dep = parsePriceInput(depositRaw);
			if (dep === null || dep < 0 || dep > 10_000) {
				issues.push({
					field: "securityDeposit",
					message:
						"Enter an amount between RM 0 and RM 10,000, or leave blank.",
				});
			}
		}
		const notice = state.minNoticeDays.trim();
		if (notice.length > 0) {
			const n = Number(notice);
			if (!Number.isInteger(n) || n < 0 || n > MAX_NOTICE_DAYS) {
				issues.push({
					field: "minNoticeDays",
					message: `Enter a whole number of days between 0 and ${MAX_NOTICE_DAYS}, or leave blank.`,
				});
			}
		}
	}
	if (step === 2) {
		// Axes in the editor ARE the answer, so only an editor with none can be
		// "unanswered". Asking again while a grid exists would contradict the
		// screen, which renders the choices block off the same derivation.
		if (effectiveShape(state) === null) {
			issues.push({ field: "shape", message: "Pick one to continue." });
		}
		// Validate whenever axes EXIST, not when the answer says they should.
		// The answer field is a UI affordance; the editor is the source of truth.
		// Gating on the answer meant a wizard whose field had fallen out of sync
		// skipped option validation entirely and submitted an unsavable payload.
		if (options.length > 0) {
			for (const issue of collectOptionIssues(options)) {
				issues.push({
					field:
						issue.index === 0
							? issue.field === "name"
								? "axisName"
								: "axisValues"
							: issue.field === "name"
								? "axis2Name"
								: "axis2Values",
					message: issue.message,
				});
			}
			if (cartesian(options).length > MAX_VARIANTS) {
				issues.push({
					field: "axisValues",
					message: `That's ${cartesian(options).length} combinations — keep it to ${MAX_VARIANTS} or fewer.`,
				});
			}
		}
	}
	// An axis with no values yet keeps the PREVIOUS rows (see rebuildRows) and
	// hides them, so per-row validation waits for a real grid — step 2's own
	// "add at least one value" issue is the actionable one.
	const gridReady = cartesian(options).length > 0;
	// Made to order prices its OWN line at step 3 (it has no matrix), so a bad
	// amount must surface THERE, not on the review step where the input isn't.
	const madeToOrder = isMadeToOrderOnly(state.editor);
	if (step === 3 && madeToOrder) {
		const built = buildSubmitVariants([], customLine);
		if ("issues" in built) {
			for (const issue of built.issues) {
				if (issue.where === "custom") {
					issues.push({ field: "customPrice", message: issue.message });
				}
			}
		}
	}
	if (step === 3 && !madeToOrder && gridReady) {
		const built = buildSubmitVariants(rows, null);
		if ("issues" in built) {
			for (const issue of built.issues) {
				if (issue.where === "row" && issue.field === "price") {
					issues.push({
						field: `price:${rowKey(rows[issue.index])}`,
						message: issue.message,
					});
				}
			}
		}
	}
	if (step === 4) {
		if (!state.fulfilmentAnswered) {
			issues.push({ field: "fulfilment", message: "Pick one to continue." });
		} else if (gridReady) {
			const built = buildSubmitVariants(rows, null);
			if ("issues" in built) {
				for (const issue of built.issues) {
					if (issue.where === "row" && issue.field === "stock") {
						issues.push({
							field: `stock:${rowKey(rows[issue.index])}`,
							message: issue.message,
						});
					}
				}
			}
		}
	}
	if (step === 5) {
		// Made to order already raised this at step 3, where its price input is.
		const built = buildSubmitVariants(rows, madeToOrder ? null : customLine);
		if ("issues" in built) {
			for (const issue of built.issues) {
				if (issue.where === "custom") {
					issues.push({ field: "customPrice", message: issue.message });
				}
			}
		}
		const qty = state.minQuantity.trim();
		if (qty.length > 0) {
			const n = Number(qty);
			if (!Number.isInteger(n) || n < 2 || n > MIN_QUANTITY_MAX) {
				issues.push({
					field: "minQuantity",
					message: `Enter a whole number between 2 and ${MIN_QUANTITY_MAX}, or leave blank.`,
				});
			}
		}
		const notice = state.minNoticeDays.trim();
		if (notice.length > 0) {
			const n = Number(notice);
			if (!Number.isInteger(n) || n < 0 || n > MAX_NOTICE_DAYS) {
				issues.push({
					field: "minNoticeDays",
					message: `Enter a whole number of days between 0 and ${MAX_NOTICE_DAYS}, or leave blank.`,
				});
			}
		}
	}
	return issues;
}

/**
 * Map the answered wizard onto the same submit payload the full form
 * produces — via the SAME `buildSubmitVariants`. Assumes every step
 * validated (call `wizardStepIssues` first).
 */
export function buildWizardSubmitValues(
	state: WizardState,
): ProductFormSubmitValues {
	// Reconcile before building: `options` and `variants` MUST come from the same
	// pair. Deriving the axes from `state.shape` (a second source of truth)
	// instead of the editor let the two disagree — a wizard whose answer had
	// fallen out of sync shipped `options: []` alongside a multi-row grid, and the
	// server rejected it with a count mismatch the seller could not act on.
	const reconciled = reconcileForSubmit(
		state.editor.options,
		state.editor.rows,
	);
	// A made-to-order product reconciles to an EMPTY matrix — its custom line is
	// the whole offer, emitted by `buildSubmitVariants` as the only variant.
	const built = buildSubmitVariants(reconciled.rows, state.editor.customLine);
	const minQty = Number(state.minQuantity.trim());
	const notice = Number(state.minNoticeDays.trim());
	const kind = wizardKind(state);
	const capacity = Number(state.capacityPerNight.trim());
	return {
		name: state.name.trim(),
		description:
			state.description.trim().length > 0
				? state.description.trim()
				: undefined,
		hidden: state.hidden,
		kind,
		// Kind + capacity travel together (the server enforces the same pairing).
		booking:
			kind === "booking" && Number.isInteger(capacity)
				? {
						capacityPerNight: capacity,
						securityDeposit: (() => {
							const dep = parsePriceInput(state.securityDeposit.trim());
							return dep !== null && dep > 0
								? Math.round(dep * 100)
								: undefined;
						})(),
					}
				: undefined,
		// Blank → undefined (no rule); the server normalizes 0/1 to unset.
		// A booking listing never carries a min quantity — one request = one
		// booking; the input isn't offered on that route.
		minQuantity:
			kind !== "booking" &&
			state.minQuantity.trim().length > 0 &&
			Number.isInteger(minQty)
				? minQty
				: undefined,
		minNoticeDays:
			state.minNoticeDays.trim().length > 0 && Number.isInteger(notice)
				? notice
				: undefined,
		categoryIds: state.categoryIds,
		imageStorageIds: state.images.map((i) => i.id),
		options: reconciled.options,
		variants: "variants" in built ? built.variants : [],
	};
}

/**
 * Wizard → full form: the editor substrate passes through AS-IS (both views
 * edit the same shape) plus the non-editor basics. Lossless string-for-string.
 */
export function wizardHandoff(state: WizardState): {
	initialValues: ProductFormInitialValues;
	initialEditor: VariantEditorState;
} {
	// Parse EXACTLY as wizardStepIssues validates (Number + isInteger), so a
	// value the wizard rejects can never arrive silently truncated in the form.
	const minQtyRaw = state.minQuantity.trim();
	const noticeRaw = state.minNoticeDays.trim();
	const minQty = minQtyRaw.length > 0 ? Number(minQtyRaw) : Number.NaN;
	const notice = noticeRaw.length > 0 ? Number(noticeRaw) : Number.NaN;
	return {
		initialValues: {
			name: state.name,
			description:
				state.description.trim().length > 0 ? state.description : undefined,
			hidden: state.hidden,
			kind: wizardKind(state),
			capacityPerNight: state.capacityPerNight,
			securityDeposit: state.securityDeposit,
			categoryIds: state.categoryIds,
			imageStorageIds: state.images.map((i) => i.id),
			imageUrls: state.images.map((i) => i.url),
			minQuantity: Number.isInteger(minQty) && minQty > 0 ? minQty : undefined,
			minNoticeDays:
				Number.isInteger(notice) && notice > 0 ? notice : undefined,
		},
		initialEditor: state.editor,
	};
}

/**
 * Full form → wizard: the editor substrate passes straight through, so
 * NOTHING is lost — no confirm, no capability gap. The wizard reopens at the
 * first unanswered step.
 */
export function formDraftToWizardState(draft: ProductFormDraft): WizardState {
	return {
		name: draft.name,
		description: draft.description,
		images: draft.images,
		// The card re-lights from the STORED kind — a food seller's Food tap
		// round-trips as "Physical goods" (same stored kind, wizard-session
		// affordance only; locked in 86eyj70z1).
		kindCard: cardFromKind(draft.kind),
		capacityPerNight: draft.capacityPerNight,
		securityDeposit: draft.securityDeposit ?? "",
		// The form's substrate IS the answer — nothing to re-ask. Axes present =
		// the buyer picks; one never-out-of-stock, mockup-gated row = made to
		// order; anything else = a single item.
		shape:
			draft.editor.options.length > 0
				? "choices"
				: isMadeToOrderOnly(draft.editor)
					? "made_to_order"
					: "single",
		editor: draft.editor,
		// The form always carries concrete per-row flags — treat as answered so
		// the wizard doesn't re-ask what the draft already encodes.
		fulfilmentAnswered: draft.editor.rows.length > 0,
		hidden: draft.hidden,
		categoryIds: draft.categoryIds,
		minQuantity: draft.minQuantity,
		minNoticeDays: draft.minNoticeDays,
	};
}

/**
 * Where a restored wizard should open: the first step that still needs an
 * answer (structural nulls included), else the review step.
 */
export function wizardInitialStep(state: WizardState): number {
	const steps = wizardSteps(effectiveShape(state), wizardKind(state));
	// Every step but the last (Review) — Review is where an answered draft lands.
	for (const s of steps.slice(0, -1)) {
		if (wizardStepIssues(state, s).length > 0) return s;
	}
	return REVIEW_STEP;
}

/** Compact "RM 12" / "RM 12–28" label for the review preview. */
export function wizardPriceLabel(state: WizardState, currency: string): string {
	// A booking listing prices per night — one implicit row, "/night" suffix so
	// the preview says exactly what the storefront will (S2).
	if (wizardKind(state) === "booking") {
		const p = parsePriceInput(state.editor.rows[0]?.price.trim() ?? "");
		if (p === null) return "";
		return `${currency} ${p % 1 === 0 ? String(p) : p.toFixed(2)}/night`;
	}
	// Made to order has no matrix — its price lives on the bespoke line, and is
	// a STARTING price the mockup quote lands on top of, so the preview says
	// exactly what the storefront prints: "From RM 40" (86eyhn4mr).
	if (effectiveShape(state) === "made_to_order") {
		const base = parsePriceInput(state.editor.customLine?.price.trim() ?? "");
		return base && base > 0
			? `From ${currency} ${base % 1 === 0 ? String(base) : base.toFixed(2)}`
			: "Price on quote";
	}
	const parsed = state.editor.rows
		.filter((r) => r.active)
		.map((r) => parsePriceInput(r.price.trim()))
		.filter((p): p is number => p !== null);
	if (parsed.length === 0) return "";
	const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
	const min = Math.min(...parsed);
	const max = Math.max(...parsed);
	return min === max
		? `${currency} ${fmt(min)}`
		: `${currency} ${fmt(min)}–${fmt(max)}`;
}

// Titles are deliberately short — the header also carries a back button,
// progress dots and cancel, so anything past ~12 characters truncates on a
// narrow phone. The full question is the heading inside each step. The "Step N
// of M" line is computed from the walked sequence, not hard-coded, so a
// made-to-order product doesn't claim five steps and then show four.
const STEP_TITLES: Record<number, string> = {
	0: "Selling",
	1: "Name it",
	2: "Type",
	3: "Price",
	4: "Preparation",
	5: "Review",
};
/** The last step in every sequence — Review. */
const REVIEW_STEP = 5;

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
	defaultKind,
	onSubmit,
	onSkipToFullForm,
	onOpenFullForm,
	onExit,
	initialState,
}: {
	/** Owning retailer — feeds the review step's category picker. */
	retailerId: Id<"retailers">;
	/** Client mirror of the `categories` plan gate (same as the full form). */
	categoriesLocked: boolean;
	currency: string;
	/** The store's `storeType`, when set — pre-answers step 0's kind card
	 * ("Your store type" badge); the seller can still tap another. */
	defaultKind?: ProductKind;
	onSubmit: (values: ProductFormSubmitValues) => Promise<void>;
	/** "Skip — use the full form" on step 1: hands off the whole draft. */
	onSkipToFullForm: (handoff: ReturnType<typeof wizardHandoff>) => void;
	/** Review-step handoff: open the full form on the same draft. */
	onOpenFullForm: (handoff: ReturnType<typeof wizardHandoff>) => void;
	/** Back from step 0 / Cancel — leave the wizard entirely. */
	onExit: () => void;
	/** Restored draft from the full form's "switch back to guided setup" —
	 * the wizard opens at the first unanswered step, every value in place. */
	initialState?: WizardState;
}) {
	const [step, setStep] = useState(() =>
		initialState ? wizardInitialStep(initialState) : 0,
	);
	const [state, setStateRaw] = useState<WizardState>(
		() => initialState ?? emptyWizardState(defaultKind),
	);
	const [issues, setIssues] = useState<WizardIssue[]>([]);
	const [uploading, setUploading] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [serverError, setServerError] = useState<string | null>(null);
	// Restored drafts open their optional reveals when they hold content.
	const [showDescription, setShowDescription] = useState(
		() => (initialState?.description ?? "").trim().length > 0,
	);
	// Step-3 per-choice details (photo · SKU · on/off · approval) — hidden
	// until asked for, auto-open when a restored draft already uses them.
	const [showRowDetails, setShowRowDetails] = useState(() =>
		(initialState?.editor.rows ?? []).some(
			(r) =>
				r.sku.trim().length > 0 ||
				r.imageStorageIds.length > 0 ||
				!r.active ||
				r.requiresProof,
		),
	);
	// Step-4 per-choice fulfilment override — auto-open when already mixed.
	const [varyFulfilment, setVaryFulfilment] = useState(() => {
		const rows = initialState?.editor.rows ?? [];
		return (
			rows.length > 1 &&
			rows.some((r) => r.blockWhenOutOfStock) &&
			rows.some((r) => !r.blockWhenOutOfStock)
		);
	});
	const [moreOpen, setMoreOpen] = useState(
		() =>
			initialState !== undefined &&
			(initialState.editor.customLine !== null ||
				initialState.editor.rows.some((r) => r.requiresProof) ||
				initialState.minQuantity.trim().length > 0 ||
				initialState.minNoticeDays.trim().length > 0),
	);
	// One add-value draft per axis (max 2), mirroring the full editor.
	const [valueDrafts, setValueDrafts] = useState<string[]>(() =>
		(initialState?.editor.options ?? []).map(() => ""),
	);
	// Categories are only offered on review when the store actually has some —
	// a brand-new seller shouldn't meet a whole new concept mid-wizard.
	const categories = useQuery(
		convexQuery(api.categories.listForRetailer, { retailerId }),
	).data;
	const hasCategories = (categories?.filter((c) => c.active).length ?? 0) > 0;

	// Track blob: preview URLs so they're revoked on overwrite/remove/unmount.
	const blobUrls = useRef<Set<string>>(new Set());
	useEffect(
		() => () => {
			for (const u of blobUrls.current) URL.revokeObjectURL(u);
		},
		[],
	);
	function revokeIfBlob(url: string | undefined) {
		if (url?.startsWith("blob:")) {
			URL.revokeObjectURL(url);
			blobUrls.current.delete(url);
		}
	}

	function patch(partial: Partial<WizardState>) {
		setStateRaw((prev) => ({ ...prev, ...partial }));
		setIssues([]);
		setServerError(null);
	}
	function patchEditor(partial: Partial<VariantEditorState>) {
		setStateRaw((prev) => ({
			...prev,
			editor: { ...prev.editor, ...partial },
		}));
		setIssues([]);
		setServerError(null);
	}

	const { options, rows, customLine } = state.editor;
	// ONE shape read for the whole screen — see `effectiveShape`. Every branch
	// below (which card is lit, which steps are walked, which review rows show)
	// reads these two, so the screen can never contradict the payload.
	const shape = effectiveShape(state);
	const kind = wizardKind(state);
	const isBooking = kind === "booking";
	const showAxes = shape === "choices";
	const madeToOrder = shape === "made_to_order";
	const variantCount = cartesian(options).length;
	const allTrack = rows.length > 0 && rows.every((r) => r.blockWhenOutOfStock);
	const allMto = rows.length > 0 && rows.every((r) => !r.blockWhenOutOfStock);
	const anyMto = rows.some((r) => !r.blockWhenOutOfStock);
	const anyTrack = rows.some((r) => r.blockWhenOutOfStock);
	const allProof = rows.length > 0 && rows.every((r) => r.requiresProof);
	const someProof = rows.some((r) => r.requiresProof);

	const issueFor = (field: string): string | undefined =>
		issues.find((i) => i.field === field)?.message;

	// --- Editor manipulation (same semantics as the full editor) -------------
	function setOptions(nextOptions: OptionAxis[]) {
		patchEditor({
			options: nextOptions,
			rows: rebuildRows(nextOptions, rows),
		});
	}
	function setRow(index: number, rowPatch: Partial<VariantRow>) {
		patchEditor({
			rows: rows.map((r, i) => (i === index ? { ...r, ...rowPatch } : r)),
		});
	}
	function bulkFlag(
		field: "blockWhenOutOfStock" | "requiresProof",
		v: boolean,
	) {
		patchEditor({ rows: rows.map((r) => ({ ...r, [field]: v })) });
	}

	function renameAxis(axisIndex: number, name: string) {
		setOptions(options.map((a, i) => (i === axisIndex ? { ...a, name } : a)));
	}
	function addValue(axisIndex: number) {
		const draft = (valueDrafts[axisIndex] ?? "").trim();
		if (!draft) return;
		const axis = options[axisIndex];
		if (!axis) return;
		if (axis.values.some((v) => v.toLowerCase() === draft.toLowerCase())) {
			setValueDrafts((d) => d.map((v, i) => (i === axisIndex ? "" : v)));
			return;
		}
		setOptions(
			options.map((a, i) =>
				i === axisIndex ? { ...a, values: [...a.values, draft] } : a,
			),
		);
		setValueDrafts((d) => d.map((v, i) => (i === axisIndex ? "" : v)));
	}
	function removeValue(axisIndex: number, value: string) {
		setOptions(
			options.map((a, i) =>
				i === axisIndex
					? { ...a, values: a.values.filter((v) => v !== value) }
					: a,
			),
		);
	}
	function applyPresetToAxis(
		axisIndex: number,
		preset: { name: string; values: string[] },
	) {
		const axis = options[axisIndex];
		if (!axis) return;
		// Rename to the preset; seed its starter values only when the axis is
		// still empty (never clobber values the seller already typed).
		setOptions(
			options.map((a, i) =>
				i === axisIndex
					? {
							name: preset.name,
							values: a.values.length > 0 ? a.values : [...preset.values],
						}
					: a,
			),
		);
	}
	function addSecondAxis(preset?: { name: string; values: string[] }) {
		if (options.length >= MAX_AXES) return;
		setOptions([
			...options,
			preset
				? { name: preset.name, values: [...preset.values] }
				: { name: "", values: [] },
		]);
		setValueDrafts((d) => [...d, ""]);
	}
	function removeSecondAxis() {
		setOptions(options.slice(0, 1));
		setValueDrafts((d) => d.slice(0, 1));
	}

	/** True when switching away would throw typed pricing/stock away. */
	function confirmLosingChoices(): boolean {
		const hasTypedData = rows.some(
			(r) => r.price.trim().length > 0 || r.stock.trim().length > 0,
		);
		if (!options.some((a) => a.values.length > 0) || !hasTypedData) return true;
		return window.confirm(
			"Change the product type? Your choices and their prices will be removed.",
		);
	}

	/**
	 * Leaving made-to-order has to CLEAR its flags, not just change the answer.
	 * `madeToOrder` is derived from the rows (`isMadeToOrderOnly`), so a switch
	 * that carried `requiresProof`/`blockWhenOutOfStock` through left the type
	 * still reading as made-to-order: the target card wouldn't light up and the
	 * "no choices, no stock" note stayed on screen. Ordinary rows track stock
	 * and aren't approval-gated — `emptyRow`'s defaults.
	 */
	/** Leaving made-to-order: that type has NO matrix, so the other two need a
	 * real row to build from, and its bespoke line retires with it. The price
	 * carries across so the seller doesn't retype. */
	function rowsLeavingMadeToOrder(): VariantRow[] {
		return [{ ...emptyRow([]), price: customLine?.price ?? "" }];
	}

	function switchToChoices() {
		if (showAxes) return;
		if (options.length === 0) {
			const seed = madeToOrder ? rowsLeavingMadeToOrder() : rows;
			patch({
				shape: "choices",
				// A made-to-order draft has answered nothing about stock; the grid
				// re-asks it at step 4 like any other multi-choice product.
				fulfilmentAnswered: madeToOrder ? false : state.fulfilmentAnswered,
				editor: {
					options: [{ name: "", values: [] }],
					rows: rebuildRows([{ name: "", values: [] }], seed),
					// The bespoke line retires with the type — the choices are the
					// offer now.
					customLine: madeToOrder ? null : state.editor.customLine,
				},
			});
			setValueDrafts([""]);
		} else {
			patch({ shape: "choices" });
		}
	}
	function switchToSingle() {
		if (shape === "single") return;
		if (!confirmLosingChoices()) return;
		// Collapse to one row, carrying the first row's price/stock/flags.
		const donor = madeToOrder
			? rowsLeavingMadeToOrder()[0]
			: (rows[0] ?? emptyRow([]));
		patch({
			shape: "single",
			// Same reason as switchToChoices: "how do you prepare orders?" was
			// never asked, so step 4 must ask it rather than inherit an answer.
			fulfilmentAnswered: madeToOrder ? false : state.fulfilmentAnswered,
			editor: {
				...state.editor,
				options: [],
				customLine: madeToOrder ? null : state.editor.customLine,
				rows: [
					{
						...donor,
						optionValues: [],
						sku: "",
						imageStorageIds: [],
						imageUrl: undefined,
						active: true,
					},
				],
			},
		});
		setValueDrafts([]);
	}
	function switchToMadeToOrder() {
		if (madeToOrder) return;
		if (!confirmLosingChoices()) return;
		const donor = rows[0] ?? emptyRow([]);
		// The type IS the fulfilment answer (made to order, never out of stock,
		// mockup-approved), so step 4 has nothing left to ask — mark it answered
		// and drop it from the sequence.
		//
		// The product becomes ONE bespoke line and no matrix at all: modelling the
		// type as `isCustom` is what gives it the storefront's existing bespoke
		// flow (request box, "Choose" routing, qty-1 cart line) instead of a
		// parallel path. An existing custom line is kept — same offer, and the
		// seller already wrote its prompt.
		patch({
			shape: "made_to_order",
			fulfilmentAnswered: true,
			editor: {
				options: [],
				rows: [],
				customLine: customLine ?? {
					...emptyCustomLine(),
					// Carry what still means something from the row being retired.
					price: donor?.price ?? "",
					imageStorageIds: donor?.imageStorageIds ?? [],
					imageUrl: donor?.imageUrl,
				},
			},
		});
		setValueDrafts([]);
	}

	/**
	 * Step 0's card tap. Food ⟷ Physical is a pure relabel (same stored kind,
	 * same route). Crossing the booking boundary rebuilds the selling substrate:
	 * INTO booking, the product becomes one implicit never-stock-blocked row
	 * (capacity governs availability — S2's module, not the stock counter) with
	 * no axes and no bespoke line, and the Choices/Preparation steps drop out of
	 * the route; OUT of booking, both questions return unanswered. Typed
	 * prices/stock are guarded by the same confirm the shape switchers use.
	 */
	function switchKind(card: KindCard) {
		if (state.kindCard === card) return;
		const nextBooking = kindFromCard(card) === "booking";
		const wasBooking = isBooking;
		if (nextBooking === wasBooking) {
			patch({ kindCard: card });
			return;
		}
		if (!confirmLosingChoices()) return;
		if (nextBooking) {
			patch({
				kindCard: card,
				shape: null,
				fulfilmentAnswered: true,
				editor: {
					options: [],
					customLine: null,
					rows: [
						{
							...(rows[0] ?? emptyRow([])),
							optionValues: [],
							sku: "",
							imageStorageIds: [],
							imageUrl: undefined,
							active: true,
							blockWhenOutOfStock: false,
							requiresProof: false,
						},
					],
				},
			});
		} else {
			// Leaving booking: the per-night price carries onto the fresh row so
			// the seller doesn't retype; shape + preparation are re-asked.
			patch({
				kindCard: card,
				shape: null,
				fulfilmentAnswered: false,
				editor: {
					options: [],
					customLine: null,
					rows: [{ ...emptyRow([]), price: rows[0]?.price ?? "" }],
				},
			});
		}
		setValueDrafts([]);
	}

	// --- Custom line ---------------------------------------------------------
	function patchCustom(partial: Partial<CustomLineDraft>) {
		if (!customLine) return;
		patchEditor({ customLine: { ...customLine, ...partial } });
	}
	function toggleCustom(enabled: boolean) {
		if (enabled) {
			patchEditor({
				customLine: {
					label: "",
					price: "",
					prompt: "",
					imageStorageIds: [],
				},
			});
		} else {
			revokeIfBlob(customLine?.imageUrl);
			patchEditor({ customLine: null });
		}
	}

	// Anything the seller has touched = worth a confirm before discarding.
	const isDirty =
		state.name.trim().length > 0 ||
		state.description.trim().length > 0 ||
		state.images.length > 0 ||
		state.hidden ||
		state.categoryIds.length > 0 ||
		options.some((a) => a.name.trim().length > 0 || a.values.length > 0) ||
		rows.some(
			(r) =>
				r.price.trim().length > 0 ||
				r.stock.trim().length > 0 ||
				r.sku.trim().length > 0 ||
				r.imageStorageIds.length > 0 ||
				!r.active ||
				r.requiresProof,
		) ||
		customLine !== null ||
		state.minQuantity.trim().length > 0 ||
		state.minNoticeDays.trim().length > 0;

	function cancelWizard() {
		if (
			isDirty &&
			!window.confirm("Discard this product? Nothing has been saved.")
		) {
			return;
		}
		onExit();
	}

	// Structural gate: the branching questions must be answered before Continue
	// makes sense; text-input problems surface on Continue instead (a disabled
	// button with no visible reason would read as broken).
	const structurallyAnswered =
		step === 0
			? state.kindCard !== null
			: step === 2
				? shape !== null
				: step === 4
					? state.fulfilmentAnswered
					: true;

	// The steps THIS product walks — booking skips Choices + Preparation,
	// made-to-order skips Preparation. Recomputed per render off the live
	// answer, so changing the kind/type mid-wizard re-plans the remaining route
	// instead of stranding the seller on a dropped step.
	const steps = wizardSteps(shape, kind);
	const stepPos = Math.max(steps.indexOf(step), 0);

	function goNext() {
		const found = wizardStepIssues(state, step);
		if (found.length > 0) {
			setIssues(found);
			return;
		}
		setIssues([]);
		setStep(steps[Math.min(stepPos + 1, steps.length - 1)]);
	}

	function goBack() {
		if (stepPos === 0) {
			onExit();
			return;
		}
		setIssues([]);
		setStep(steps[stepPos - 1]);
	}

	function fillAllPrices(v: string) {
		patchEditor({ rows: rows.map((r) => ({ ...r, price: v })) });
	}

	async function publish() {
		// Belt-and-braces: re-validate every step before submitting (review-step
		// edits jump around, so a hole could otherwise slip through). Walks the
		// product's OWN sequence — a skipped step has no answer to check.
		for (const s of steps) {
			const found = wizardStepIssues(state, s);
			if (found.length > 0) {
				setIssues(found);
				setStep(s);
				// A review-step issue lives inside the More-options disclosure.
				if (s === REVIEW_STEP) setMoreOpen(true);
				return;
			}
		}
		setSubmitting(true);
		setServerError(null);
		try {
			await onSubmit(buildWizardSubmitValues(state));
		} catch (err) {
			const message = convexErrorMessage(err);
			// A rejected SKU names itself in the message — take the seller to the
			// row that owns it with the details open, instead of a generic banner
			// on the review step with no pointer to the offending choice.
			const conflict = skuConflictTarget(message, rows);
			if (conflict) {
				setIssues([{ field: `sku:${conflict.key}`, message }]);
				setShowRowDetails(true);
				setStep(3);
			} else {
				setServerError(message);
			}
			setSubmitting(false);
		}
	}

	const title = STEP_TITLES[step];
	const sub = `Step ${stepPos + 1} of ${steps.length}`;

	/** Axis block: presets + name + value chips (axisIndex 0 or 1). */
	function renderAxis(axisIndex: number) {
		const axis = options[axisIndex];
		if (!axis) return null;
		const nameField = axisIndex === 0 ? "axisName" : "axis2Name";
		const valuesField = axisIndex === 0 ? "axisValues" : "axis2Values";
		return (
			<div className="flex flex-col gap-2">
				<div className="flex flex-wrap items-center gap-1.5">
					{AXIS_PRESETS.map((preset) => {
						const usedElsewhere = options.some(
							(a, i) =>
								i !== axisIndex &&
								a.name.toLowerCase() === preset.name.toLowerCase(),
						);
						return (
							<button
								key={preset.name}
								type="button"
								disabled={usedElsewhere}
								onClick={() => applyPresetToAxis(axisIndex, preset)}
								className={cn(
									"rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40",
									axis.name.toLowerCase() === preset.name.toLowerCase()
										? "border-accent bg-accent/10 text-accent-emphasis"
										: "border-border hover:border-accent",
								)}
							>
								{preset.name}
							</button>
						);
					})}
				</div>
				<Input
					placeholder="Or type your own (e.g. Colour)"
					value={axis.name}
					onChange={(e) => renameAxis(axisIndex, e.target.value)}
					isError={!!issueFor(nameField)}
					className="h-10"
				/>
				<IssueText message={issueFor(nameField)} />
				<div className="flex flex-wrap items-center gap-1.5">
					{axis.values.map((v) => (
						<span
							key={v}
							className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-sm font-medium"
						>
							{v}
							<button
								type="button"
								onClick={() => removeValue(axisIndex, v)}
								aria-label={`Remove ${v}`}
							>
								<X className="size-3.5" />
							</button>
						</span>
					))}
					<div className="flex items-center gap-1">
						<Input
							placeholder="Add a choice"
							value={valueDrafts[axisIndex] ?? ""}
							onChange={(e) =>
								setValueDrafts((d) =>
									d.map((val, i) => (i === axisIndex ? e.target.value : val)),
								)
							}
							isError={!!issueFor(valuesField)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === ",") {
									e.preventDefault();
									addValue(axisIndex);
								}
							}}
							// Commit on blur too — Android soft keyboards don't fire a
							// reliable Enter keydown.
							onBlur={() => addValue(axisIndex)}
							className="h-9 w-32"
						/>
						<button
							type="button"
							onClick={() => addValue(axisIndex)}
							className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:border-accent"
							aria-label="Add choice"
						>
							<Plus className="size-4" />
						</button>
					</div>
				</div>
				<IssueText message={issueFor(valuesField)} />
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			{/* Header: back + step title + progress dots + cancel. Four items on one
			    narrow row, so the gap tightens on mobile and only the CURRENT dot
			    widens — completed steps stay small (still accent-coloured, so
			    progress still reads) instead of eating the title's width. */}
			<div className="flex items-center gap-2 sm:gap-3">
				<button
					type="button"
					onClick={goBack}
					aria-label={stepPos === 0 ? "Back to products" : "Previous step"}
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
					{steps.map((s, i) => (
						<span
							key={s}
							className={cn(
								"h-1.5 rounded-full transition-all",
								i === stepPos
									? "w-4 bg-accent"
									: i < stepPos
										? "w-1.5 bg-accent"
										: "w-1.5 bg-border",
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
				{step === 0 ? (
					<>
						<h3 className="text-xl font-bold leading-tight">
							What are you selling?
						</h3>
						<p className="-mt-2 text-sm text-muted-foreground">
							Picks the words and questions you&apos;ll see — buyers never see
							this.
						</p>
						<div className="flex flex-col gap-2.5">
							{(
								[
									{
										card: "food" as const,
										icon: <UtensilsCrossed className="size-5" aria-hidden />,
										title: "Food",
										description: "Cakes, kuih, frozen, catering",
									},
									{
										card: "physical" as const,
										icon: <Package className="size-5" aria-hidden />,
										title: "Physical goods",
										description: "Gear, packaged items, merchandise",
									},
									{
										card: "service" as const,
										icon: <Wrench className="size-5" aria-hidden />,
										title: "Service",
										description: "Cleaning, wash, repair",
									},
									{
										card: "booking" as const,
										icon: <CalendarRange className="size-5" aria-hidden />,
										title: "Booking",
										description: "Campsite, venue, homestay, rental",
									},
								] satisfies {
									card: KindCard;
									icon: ReactNode;
									title: string;
									description: string;
								}[]
							).map(({ card, icon, title, description }) => (
								<div key={card} className="relative">
									<AnswerCard
										selected={state.kindCard === card}
										icon={icon}
										title={title}
										description={description}
										onClick={() => switchKind(card)}
									/>
									{/* Why this card is pre-ringed — the storeType default. */}
									{defaultKind !== undefined &&
									cardFromKind(defaultKind) === card &&
									state.kindCard === card ? (
										<span className="pointer-events-none absolute right-3 top-3 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent-emphasis">
											Your store type
										</span>
									) : null}
								</div>
							))}
						</div>
						{state.kindCard === "food" ? (
							<p className="rounded-xl bg-accent/5 px-3 py-2 text-xs text-muted-foreground">
								Next you&apos;ll tell us whether it&apos;s{" "}
								<span className="font-medium text-foreground">made fresh</span>{" "}
								when ordered or{" "}
								<span className="font-medium text-foreground">ready stock</span>{" "}
								(frozen or packaged).
							</p>
						) : null}
						{isBooking ? (
							<p className="rounded-xl bg-accent/5 px-3 py-2 text-xs text-muted-foreground">
								Guests pick dates on a calendar and{" "}
								<span className="font-medium text-foreground">
									request to book
								</span>{" "}
								— you approve each booking before anything is paid. No stock to
								set up; you&apos;ll set a price per night and how many spots
								each night holds.
							</p>
						) : null}
						<IssueText message={issueFor("kind")} />
					</>
				) : null}

				{step === 1 ? (
					<>
						<h3 className="text-xl font-bold leading-tight">
							{isBooking
								? "Name this listing"
								: kind === "service"
									? "Name your service"
									: "Name your product"}
						</h3>
						<label className="flex flex-col gap-1.5 text-sm font-medium">
							Name
							<Input
								variant="field"
								placeholder={
									isBooking
										? "e.g. Riverside Standard Plot"
										: kind === "service"
											? "e.g. Tent deep-clean (2-man)"
											: "e.g. Chocolate fudge brownies"
								}
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
							What kind of product is it?
						</h3>
						<p className="-mt-2 text-sm text-muted-foreground">
							This decides what we ask you for next.
						</p>
						<div className="flex flex-col gap-2.5">
							<AnswerCard
								selected={shape === "single"}
								icon={<PackageCheck className="size-5" aria-hidden />}
								title="Just one item"
								description="One name, one price. e.g. Nasi lemak bungkus"
								onClick={switchToSingle}
							/>
							<AnswerCard
								selected={showAxes}
								icon={<ChefHat className="size-5" aria-hidden />}
								title="Buyer picks a choice"
								description="A size, flavour or weight — each with its own price. e.g. Small / Medium / Large"
								onClick={switchToChoices}
							/>
							{/* Third type (86eyfq04j) — the bespoke seller's product. No
							    choices to set up and no price to commit to; the price step
							    that follows is optional. */}
							<AnswerCard
								selected={madeToOrder}
								icon={<Sparkles className="size-5" aria-hidden />}
								title="Made to order"
								description="Buyer tells you what they want; you quote a price and get a mockup approved. e.g. a custom cake"
								onClick={switchToMadeToOrder}
							/>
						</div>
						{madeToOrder ? (
							<p className="rounded-xl bg-accent/5 px-3 py-2 text-xs text-muted-foreground">
								No choices and no stock to set up. We&apos;ll skip straight to
								the price — which you can leave blank so buyers see{" "}
								<span className="font-medium text-foreground">
									&ldquo;Price on quote&rdquo;
								</span>
								.
							</p>
						) : null}
						{showAxes ? (
							<div className="flex flex-col gap-3 border-t border-border pt-3">
								<div className="flex items-center justify-between">
									<span className="text-sm font-medium">
										What do they choose by?
									</span>
									{variantCount > 0 ? (
										<span className="text-xs text-muted-foreground">
											{variantCount} choice{variantCount === 1 ? "" : "s"}
										</span>
									) : null}
								</div>
								{renderAxis(0)}
								{/* Second axis (Size × Flavour) — full parity with the full
								    form, zero pixels until asked for. */}
								{options.length > 1 ? (
									<div className="flex flex-col gap-2 rounded-xl bg-muted/40 p-3">
										<div className="flex items-center justify-between">
											<span className="text-sm font-medium">
												They also choose by
											</span>
											<button
												type="button"
												onClick={removeSecondAxis}
												className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
												aria-label="Remove the second choice"
											>
												<X className="size-4" />
											</button>
										</div>
										{renderAxis(1)}
									</div>
								) : options[0]?.values.length ? (
									<button
										type="button"
										onClick={() => addSecondAxis()}
										className="self-start text-sm font-semibold text-accent-emphasis hover:underline"
									>
										+ They also choose by something else (e.g. Size × Flavour)
									</button>
								) : null}
							</div>
						) : null}
					</>
				) : null}

				{step === 3 && isBooking ? (
					<>
						<h3 className="text-xl font-bold leading-tight">
							Price and capacity
						</h3>
						<label className="flex items-center gap-3 text-sm font-medium">
							<span className="min-w-0 flex-1">Price per night</span>
							<span className="text-sm text-muted-foreground">{currency}</span>
							<PriceInput
								value={rows[0]?.price ?? ""}
								onChange={(v) => setRow(0, { price: v })}
								className="h-11 w-28 text-right"
								invalid={!!issueFor("price:")}
							/>
						</label>
						<IssueText message={issueFor("price:")} />
						<label className="flex flex-col gap-1.5 text-sm font-medium">
							Spots available each night
							<StockInput
								value={state.capacityPerNight}
								onChange={(v) => patch({ capacityPerNight: v })}
								stepper
								className="w-40"
								invalid={!!issueFor("capacityPerNight")}
							/>
							<IssueText message={issueFor("capacityPerNight")} />
							<span className="text-xs font-normal text-muted-foreground">
								How many bookings can share the same night — e.g. 5 identical
								plots = 5. We stop taking requests for a night once they&apos;re
								all booked.
							</span>
						</label>
						<label className="flex flex-col gap-1.5 text-sm font-medium">
							<span>
								Security deposit{" "}
								<span className="font-normal text-muted-foreground">
									(optional)
								</span>
							</span>
							<span className="flex items-center gap-3">
								<span className="text-sm text-muted-foreground">
									{currency}
								</span>
								<PriceInput
									value={state.securityDeposit}
									onChange={(v) => patch({ securityDeposit: v })}
									className="h-11 w-28 text-right"
									invalid={!!issueFor("securityDeposit")}
								/>
							</span>
							<IssueText message={issueFor("securityDeposit")} />
							<span className="text-xs font-normal text-muted-foreground">
								A refundable hold collected with the booking payment and
								returned after check-out. Guests see it before they request.
							</span>
						</label>
						<label className="flex flex-col gap-1 text-sm font-medium">
							Minimum notice{" "}
							<span className="font-normal text-muted-foreground">
								(optional)
							</span>
							<span className="flex items-center gap-1.5">
								<Input
									type="number"
									inputMode="numeric"
									min={0}
									max={MAX_NOTICE_DAYS}
									placeholder="0"
									value={state.minNoticeDays}
									onChange={(e) => patch({ minNoticeDays: e.target.value })}
									isError={!!issueFor("minNoticeDays")}
									className="h-11 w-24 text-center"
								/>
								<span className="text-sm font-normal text-muted-foreground">
									days
								</span>
							</span>
							<IssueText message={issueFor("minNoticeDays")} />
							<span className="text-xs font-normal text-muted-foreground">
								Lead time you need — guests can&apos;t request a check-in sooner
								than this.
							</span>
						</label>
					</>
				) : null}

				{step === 3 && !isBooking ? (
					<>
						<h3 className="text-xl font-bold leading-tight">
							{showAxes
								? "Price each choice"
								: madeToOrder
									? "Do you have a starting price?"
									: "Set your price"}
						</h3>
						{/* Made to order edits its OWN line — the product has no matrix to
						    price. Both fields are optional: a blank price is the storefront's
						    "Price on quote", and the prompt becomes the placeholder in the
						    buyer's request box. */}
						{madeToOrder ? (
							<>
								<p className="-mt-2 text-sm text-muted-foreground">
									Optional. Leave it blank and buyers see &ldquo;Price on
									quote&rdquo; — you set the real price when you send them a
									mockup. Enter an amount and buyers see &ldquo;From{" "}
									{currency} …&rdquo;, so nobody mistakes it for the final
									price.
								</p>
								<label className="flex items-center gap-3 text-sm font-medium">
									<span className="min-w-0 flex-1 truncate">
										{state.name.trim() || "This item"}
									</span>
									<span className="text-sm text-muted-foreground">
										{currency}
									</span>
									<PriceInput
										value={customLine?.price ?? ""}
										onChange={(v) => patchCustom({ price: v })}
										className="h-11 w-28 text-right"
										invalid={!!issueFor("customPrice")}
									/>
								</label>
								<IssueText message={issueFor("customPrice")} />
								<label className="flex flex-col gap-1.5 text-sm font-medium">
									What should the buyer tell you?{" "}
									<span className="font-normal text-muted-foreground">
										(optional)
									</span>
									<textarea
										value={customLine?.prompt ?? ""}
										onChange={(e) => patchCustom({ prompt: e.target.value })}
										rows={2}
										maxLength={280}
										placeholder="e.g. Tell us your design, flavour, size & date needed"
										className="rounded-xl border border-input bg-background px-3 py-2 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
									/>
									<span className="text-xs font-normal text-muted-foreground">
										Becomes the placeholder in the buyer&apos;s request box on
										your storefront.
									</span>
								</label>
							</>
						) : null}
						{!madeToOrder && rows.length > 1 ? (
							<label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
								Same price for all
								<Input
									inputMode="decimal"
									placeholder="0.00"
									className="h-9 w-24"
									onChange={(e) => fillAllPrices(e.target.value)}
									onBlur={(e) =>
										fillAllPrices(normalizePriceInput(e.target.value))
									}
								/>
							</label>
						) : null}
						<div className="flex flex-col gap-3">
							{rows.map((row, i) => {
								const key = rowKey(row);
								return (
									<div
										key={key}
										className={cn(
											"flex flex-col gap-1.5",
											!row.active && "opacity-60",
										)}
									>
										<div className="flex items-center gap-3">
											<span className="min-w-0 flex-1 truncate text-sm font-medium">
												{key === "" ? state.name.trim() || "This item" : key}
												{!row.active ? (
													<span className="ml-2 text-[11px] font-semibold text-muted-foreground">
														Off — hidden from buyers
													</span>
												) : null}
											</span>
											<span className="text-sm text-muted-foreground">
												{currency}
											</span>
											<PriceInput
												value={row.price}
												onChange={(v) => setRow(i, { price: v })}
												className="h-11 w-28 text-right"
												invalid={!!issueFor(`price:${key}`)}
											/>
										</div>
										{showRowDetails ? (
											<div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/40 p-2">
												<VariantImageCell
													imageUrl={row.imageUrl}
													onUploaded={(id, url) => {
														revokeIfBlob(row.imageUrl);
														blobUrls.current.add(url);
														setRow(i, {
															imageStorageIds: [id],
															imageUrl: url,
														});
													}}
													onRemove={() => {
														revokeIfBlob(row.imageUrl);
														setRow(i, {
															imageStorageIds: [],
															imageUrl: undefined,
														});
													}}
													label={`photo for ${key || "this item"}`}
												/>
												<Input
													placeholder="SKU"
													value={row.sku}
													onChange={(e) => setRow(i, { sku: e.target.value })}
													isError={!!issueFor(`sku:${key}`)}
													className="h-9 w-28"
													aria-label={`Item code for ${key || "this item"}`}
												/>
												<label className="flex items-center gap-1.5 text-xs">
													<input
														type="checkbox"
														checked={row.active}
														onChange={(e) =>
															setRow(i, { active: e.target.checked })
														}
														className="size-4"
														aria-label={`${row.active ? "Deactivate" : "Activate"} ${key || "this item"}`}
													/>
													On sale
												</label>
												<label className="flex items-center gap-1.5 text-xs">
													<input
														type="checkbox"
														checked={row.requiresProof}
														onChange={(e) =>
															setRow(i, { requiresProof: e.target.checked })
														}
														className="size-4"
														aria-label={`Require mockup approval for ${key || "this item"}`}
													/>
													Design approval
												</label>
												<IssueText message={issueFor(`sku:${key}`)} />
											</div>
										) : null}
										<IssueText message={issueFor(`price:${key}`)} />
									</div>
								);
							})}
						</div>
						{/* Per-choice extras — parity with the full form's per-choice
						    details, zero pixels unless the seller asks. */}
						{showRowDetails || madeToOrder ? null : (
							<button
								type="button"
								onClick={() => setShowRowDetails(true)}
								className="self-start text-sm font-semibold text-accent-emphasis hover:underline"
							>
								+ Photos, item codes (SKU) & more per{" "}
								{showAxes ? "choice" : "item"}
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
							{/* "Made fresh", not "Made to order" — that names a product TYPE
							    in step 2 now, and two differently-meaning controls with one
							    label is what 86eyfq04j was filed about. */}
							<AnswerCard
								selected={state.fulfilmentAnswered && allMto}
								icon={<ChefHat className="size-5" aria-hidden />}
								title="Made fresh"
								description="You make each order fresh. Never marked sold out."
								onClick={() => {
									bulkFlag("blockWhenOutOfStock", false);
									patch({ fulfilmentAnswered: true });
								}}
							/>
							<AnswerCard
								selected={state.fulfilmentAnswered && allTrack}
								icon={<PackageCheck className="size-5" aria-hidden />}
								title="From stock"
								description="You have ready items. Orders stop when you run out."
								onClick={() => {
									bulkFlag("blockWhenOutOfStock", true);
									patch({ fulfilmentAnswered: true });
								}}
							/>
						</div>
						{state.fulfilmentAnswered && !allTrack && !allMto ? (
							<p className="text-xs text-muted-foreground">
								Currently varies per choice — pick a card to apply one setting
								to all, or adjust each choice below.
							</p>
						) : null}
						{/* Per-choice override — parity with the full form. */}
						{rows.length > 1 ? (
							varyFulfilment ? (
								<div className="flex flex-col gap-2">
									{rows.map((row, i) => (
										<div key={rowKey(row)} className="flex items-center gap-3">
											<span className="min-w-0 flex-1 truncate text-sm font-medium">
												{rowKey(row)}
											</span>
											<div className="w-56 shrink-0">
												<FulfilmentToggle
													value={row.blockWhenOutOfStock}
													onChange={(v) => {
														setRow(i, { blockWhenOutOfStock: v });
														patch({ fulfilmentAnswered: true });
													}}
												/>
											</div>
										</div>
									))}
									<button
										type="button"
										onClick={() => {
											const trackCount = rows.filter(
												(r) => r.blockWhenOutOfStock,
											).length;
											bulkFlag(
												"blockWhenOutOfStock",
												trackCount >= rows.length - trackCount,
											);
											setVaryFulfilment(false);
										}}
										className="self-start text-xs font-semibold text-accent-emphasis hover:underline"
									>
										Use one setting for all choices
									</button>
								</div>
							) : (
								<button
									type="button"
									onClick={() => setVaryFulfilment(true)}
									className="self-start text-xs font-semibold text-accent-emphasis hover:underline"
								>
									Vary per choice
								</button>
							)
						) : null}
						{state.fulfilmentAnswered && allMto ? (
							<p className="rounded-xl bg-accent/10 px-3 py-2.5 text-sm leading-relaxed text-accent-emphasis">
								Nice — buyers can always order. No stock counting, nothing ever
								shows "sold out". You'll see the day's orders in your inbox.
							</p>
						) : null}
						{state.fulfilmentAnswered && anyTrack ? (
							<div className="flex flex-col gap-3 border-t border-border pt-3">
								<span className="text-sm font-medium">
									How many do you have right now?
								</span>
								{rows.map((row, i) => {
									if (!row.blockWhenOutOfStock) return null;
									const key = rowKey(row);
									return (
										<div key={key} className="flex flex-col gap-1">
											<div className="flex items-center gap-3">
												<span className="min-w-0 flex-1 truncate text-sm font-medium">
													{key === "" ? "In stock" : key}
												</span>
												<StockInput
													value={row.stock}
													onChange={(v) => setRow(i, { stock: v })}
													stepper
													className="w-40"
													invalid={!!issueFor(`stock:${key}`)}
												/>
											</div>
											<IssueText message={issueFor(`stock:${key}`)} />
										</div>
									);
								})}
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
								{options.map((axis) =>
									axis.values.length > 0 ? (
										<div key={axis.name} className="flex flex-wrap gap-1.5">
											{axis.values.map((v) => (
												<span
													key={v}
													className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium"
												>
													{v}
												</span>
											))}
										</div>
									) : null,
								)}
								<span className="text-sm font-extrabold text-accent-emphasis">
									{wizardPriceLabel(state, currency)}
								</span>
								{allMto ? (
									<span className="self-start rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/50 dark:text-amber-400">
										{isBooking
											? "Booking — request to book"
											: madeToOrder
												? "Made to order"
												: "Made fresh"}
									</span>
								) : null}
							</div>
						</div>
						{/* Summary rows — Edit jumps back to the step, state intact. */}
						<div className="flex flex-col divide-y divide-border rounded-2xl border border-border px-3">
							{[
								{
									label: "Type",
									value: isBooking
										? "Booking"
										: showAxes
											? `${variantCount} by ${options
													.map((a) => a.name.trim())
													.filter(Boolean)
													.join(" × ")}`
											: madeToOrder
												? "Made to order"
												: "Just one item",
									step: isBooking ? 0 : 2,
								},
								{
									label: "Price",
									value: wizardPriceLabel(state, currency),
									step: 3,
								},
								// Booking reviews its capacity + notice where they were asked
								// (step 3); Preparation is constitutive of made-to-order AND
								// booking (request-to-book), so neither shows a row for a step
								// it doesn't walk.
								...(isBooking
									? [
											{
												label: "Capacity",
												value: `${state.capacityPerNight.trim() || "1"} per night`,
												step: 3,
											},
											...(state.securityDeposit.trim().length > 0
												? [
														{
															label: "Deposit",
															value: `RM ${state.securityDeposit.trim()} (refundable)`,
															step: 3,
														},
													]
												: []),
											...(state.minNoticeDays.trim().length > 0
												? [
														{
															label: "Notice",
															value: `${state.minNoticeDays.trim()} day${state.minNoticeDays.trim() === "1" ? "" : "s"}`,
															step: 3,
														},
													]
												: []),
										]
									: []),
								...(madeToOrder || isBooking
									? []
									: [
											{
												label: "Preparing",
												value: allMto
													? "Made fresh"
													: allTrack
														? "From stock"
														: "Varies per choice",
												step: 4,
											},
										]),
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
						{/* Optional publish settings — where the product appears. */}
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
						{/* More options — same capabilities as the full form's Advanced.
						    Collapsed: zero pixels for the everyday seller. */}
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
										{[
											anyMto && !isBooking ? MOCKUP_APPROVAL_COPY.teaser : null,
											madeToOrder || isBooking ? null : CUSTOM_LINE_COPY.teaser,
											isBooking ? null : "order rules",
											"full editor",
										]
											.filter(Boolean)
											.join(" · ")}
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
									{/* Mockup approval only makes sense for made-to-order work.
									    Product-level here; per-choice variance lives in step 3's
									    per-choice details (parity with the full form).
									    NEVER hidden on a made-to-order product, even though the
									    type implies it: ticking this on a made-fresh single item
									    IS what derives the type, so hiding it here made the
									    checkbox unmount the moment it was used, with no way to
									    untick it (PR #160 review). It stays, checked — and
									    unticking releases the type, which is the way back out. */}
									{anyMto && !isBooking ? (
										<label className="flex items-start gap-2.5 text-sm">
											<input
												type="checkbox"
												checked={allProof}
												ref={(el) => {
													if (el) el.indeterminate = someProof && !allProof;
												}}
												onChange={(e) =>
													bulkFlag("requiresProof", e.target.checked)
												}
												className="mt-0.5 size-4 shrink-0"
											/>
											<span>
												<span className="font-medium">
													{MOCKUP_APPROVAL_COPY.title}
												</span>
												<span className="block text-xs text-muted-foreground">
													{MOCKUP_APPROVAL_COPY.body}
													{someProof && !allProof
														? " Currently on for some choices only — set per choice in the Price step."
														: null}
												</span>
											</span>
										</label>
									) : null}

									{/* Not offered on a made-to-order product: that product
									    already IS this line, so adding one to itself is the same
									    offer twice. Nothing is stranded behind the hidden control
									    — `switchToMadeToOrder` moves the seller's line onto the
									    product rather than leaving a second one in state. Nor on
									    a booking listing — dates, not bespoke requests, are what
									    it sells (switchKind cleared any line). */}
									{madeToOrder || isBooking ? null : (
										<div className="flex flex-col gap-3">
											<label className="flex items-start gap-2.5 text-sm">
												<input
													type="checkbox"
													checked={customLine !== null}
													onChange={(e) => toggleCustom(e.target.checked)}
													className="mt-0.5 size-4 shrink-0"
												/>
												<span>
													<span className="font-medium">
														{CUSTOM_LINE_COPY.title}
													</span>
													<span className="block text-xs text-muted-foreground">
														{CUSTOM_LINE_COPY.body}
													</span>
												</span>
											</label>
											{customLine ? (
												<div className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3">
													<div className="flex items-start gap-3">
														<VariantImageCell
															imageUrl={customLine.imageUrl}
															size="size-14"
															onUploaded={(id, url) => {
																revokeIfBlob(customLine.imageUrl);
																blobUrls.current.add(url);
																patchCustom({
																	imageStorageIds: [id],
																	imageUrl: url,
																});
															}}
															onRemove={() => {
																revokeIfBlob(customLine.imageUrl);
																patchCustom({
																	imageStorageIds: [],
																	imageUrl: undefined,
																});
															}}
															label="custom option photo"
														/>
														<label className="flex flex-1 flex-col gap-1 text-sm font-medium">
															Option name
															<Input
																value={customLine.label}
																onChange={(e) =>
																	patchCustom({ label: e.target.value })
																}
																placeholder="Custom"
																maxLength={40}
															/>
														</label>
													</div>
													<label className="flex flex-col gap-1 text-sm font-medium">
														Starting price ({currency}){" "}
														<span className="font-normal text-muted-foreground">
															(optional — blank shows “Price on quote”)
														</span>
														<PriceInput
															value={customLine.price}
															onChange={(v) => patchCustom({ price: v })}
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
																patchCustom({ prompt: e.target.value })
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
									)}

									{/* Order rules — the same two constraints the full form
									    groups in its "Order rules" card. Blank = no rule. A
									    booking listing shows neither: min quantity is meaningless
									    (one request = one booking) and notice already lives in
									    its Price & capacity step. */}
									{isBooking ? null : (
									<div className="flex flex-col gap-3 border-t border-border pt-3">
										<span className="text-sm font-semibold">Order rules</span>
										<label className="flex flex-col gap-1 text-sm font-medium">
											Minimum order quantity{" "}
											<span className="font-normal text-muted-foreground">
												(optional)
											</span>
											<Input
												type="number"
												inputMode="numeric"
												min={0}
												max={MIN_QUANTITY_MAX}
												placeholder="e.g. 20"
												value={state.minQuantity}
												onChange={(e) => patch({ minQuantity: e.target.value })}
												isError={!!issueFor("minQuantity")}
												className="h-11 w-32"
											/>
											<IssueText message={issueFor("minQuantity")} />
											<span className="text-xs font-normal text-muted-foreground">
												Buyers must order at least this many — choices combined.
												Counter checkout ignores it.
											</span>
										</label>
										<label className="flex flex-col gap-1 text-sm font-medium">
											Minimum notice{" "}
											<span className="font-normal text-muted-foreground">
												(optional)
											</span>
											<span className="flex items-center gap-1.5">
												<Input
													type="number"
													inputMode="numeric"
													min={0}
													max={MAX_NOTICE_DAYS}
													placeholder="0"
													value={state.minNoticeDays}
													onChange={(e) =>
														patch({ minNoticeDays: e.target.value })
													}
													isError={!!issueFor("minNoticeDays")}
													className="h-11 w-24 text-center"
												/>
												<span className="text-sm font-normal text-muted-foreground">
													days
												</span>
											</span>
											<IssueText message={issueFor("minNoticeDays")} />
											<span className="text-xs font-normal text-muted-foreground">
												Lead time you need — buyers can&apos;t pick a delivery
												or pickup date sooner than this.
											</span>
										</label>
									</div>
									)}

									{/* Prefer the big-screen layout? Same draft, other skin. */}
									<div className="flex flex-col gap-1.5 border-t border-border pt-3">
										<Button
											type="button"
											variant="outline"
											onClick={() => onOpenFullForm(wizardHandoff(state))}
										>
											Open in the full editor
										</Button>
										<p className="text-center text-xs text-muted-foreground">
											The same product, one page — everything you've entered
											comes along, and you can switch back any time.
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
				{step !== REVIEW_STEP ? (
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
				{step === 0 ? (
					<button
						type="button"
						onClick={() => onSkipToFullForm(wizardHandoff(state))}
						className="self-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
					>
						Know the full editor? Skip — use the full form
					</button>
				) : null}
				{(step === 0 || step === 2 || step === 4) && !structurallyAnswered ? (
					<p className="text-center text-xs text-muted-foreground">
						Pick one to continue — you can change it any time.
					</p>
				) : null}
			</div>
		</div>
	);
}
