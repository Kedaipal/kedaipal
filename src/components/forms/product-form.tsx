import { convexQuery } from "@convex-dev/react-query";
import { useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	AlertCircle,
	BadgeCheck,
	CalendarClock,
	CalendarDays,
	Camera,
	CheckCircle2,
	ChefHat,
	ClipboardList,
	Eye,
	EyeOff,
	Hourglass,
	Info,
	Layers3,
	MapPin,
	MessageSquareText,
	PackageCheck,
	Save,
	ShieldCheck,
	Store,
	Tag,
	Zap,
} from "lucide-react";
import {
	type FormEvent,
	type MutableRefObject,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type {
	BuyerQuestion,
	BuyerQuestionInput,
} from "../../../convex/lib/buyerQuestions";
import type { CreditLockErrorData } from "../../../convex/lib/credits";
import {
	MAX_NOTICE_DAYS,
	MAX_PREP_MINUTES,
	parsePrepMinutesText,
} from "../../../convex/lib/fulfilmentDate";
import { MIN_QUANTITY_MAX } from "../../../convex/lib/minOrderRules";
import {
	MAX_PICKUP_NOTE_LENGTH,
	pickupNoteFits,
} from "../../../convex/lib/pickupNote";
import { isEventPassed } from "../../../convex/lib/productEvent";
import {
	DEFAULT_WEEKEND_DAYS,
	MAX_CAPACITY_PER_NIGHT,
	type PackageUnit,
	type ProductKind,
	packageUnitMax,
} from "../../../convex/lib/productKind";
import {
	MAX_VARIANTS_PER_PRODUCT,
	overCapMessage,
} from "../../../convex/lib/variant";
import { usePhotoAutosave } from "../../hooks/usePhotoAutosave";
import { bookingSpanCounted, bookingSpanNoun } from "../../lib/booking-dates";
import {
	type FixHighlight,
	highlightRingClass,
	revealAnchorWhenMounted,
} from "../../lib/country-setup-copy";
import {
	convexErrorMessage,
	creditLockErrorOf,
	currencySymbol,
	parsePriceInput,
} from "../../lib/format";
import { asPackageUnit } from "../../lib/package-unit";
import { isDraftDirty, type UnsavedState } from "../../lib/product-form-dirty";
import { PRODUCT_WEIGHT_MAX } from "../../lib/product-import";
import {
	describeProduct,
	isSecurityDepositInRange,
	maxSkipsDraftIssue,
	maxSkipsFromDraft,
	securityDepositRangeMessage,
	weekendRateConsequence,
} from "../../lib/product-summary";
import { productDetailsSchema } from "../../lib/schemas";
import {
	type ProductSpotlightKey,
	SPOTLIGHT_ANCHOR,
} from "../../lib/spotlight";
import { cn } from "../../lib/utils";
import { cartesian, variantLabel } from "../../lib/variant";
import { ProBadge } from "../app/pro-gate";
import { CreditLockCta, SaveLockNote } from "../credits/credit-lock-cta";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Markdown } from "../ui/markdown";
import {
	QuestionGroup,
	QuestionRow,
	type QuestionTone,
} from "../ui/question-row";
import { Textarea } from "../ui/textarea";
import { ToggleSwitch } from "../ui/toggle-switch";
import {
	type BuyerQuestionsDraft,
	BuyerQuestionsEditor,
	questionsDraftFrom,
	questionsDraftValid,
	questionsSubmitValue,
} from "./buyer-questions-card";

/**
 * Prep-time shortcuts. The field is MINUTES because that is what the floor
 * arithmetic needs, but a seller thinks "about two hours" — nobody should
 * have to work out that four hours is 240. Tapping a live preset clears it,
 * so the row is a toggle rather than a one-way door, and typing 45 by hand
 * still works: these SET the field, they do not replace it.
 *
 * Exported so the wizard renders the identical row — two spellings of the
 * same control is how one app starts looking like two.
 */
export const PREP_PRESETS = [
	{ minutes: 30, label: "30 min" },
	{ minutes: 60, label: "1 hour" },
	{ minutes: 120, label: "2 hours" },
	{ minutes: 240, label: "4 hours" },
] as const;

import { NOTE_LINK_HINT } from "../../lib/linkify";
import { CUSTOM_LINE_COPY } from "./advanced-option-copy";
import { CategoryPicker } from "./category-picker";
import {
	EMPTY_EVENT_DRAFT,
	type EventDraft,
	EventFields,
	type EventSubmitValue,
	eventDraftFrom,
	eventDraftValid,
	eventSubmitValue,
} from "./event-fields";
import { submitThenFocusError } from "./focus-error";
import { useAppForm } from "./form";
import { PackageDayCounting, type StoreSchedule } from "./package-day-counting";
import {
	type Answer,
	bookingNoticeAnswer,
	buyerQuestionsAnswer,
	customOrdersAnswer,
	depositAnswer,
	eventAnswer,
	instantBookAnswer,
	invalidSalePrices,
	mockupAnswer,
	orderRulesAnswer,
	pickupNoteAnswer,
	promoAnswer,
	weekendRateAnswer,
	whereAnswer,
} from "./product-answers";
import {
	failedPhotosLabel,
	MAX_IMAGES,
	type PhotoUploadState,
	type ProductImage,
	ProductImagesField,
} from "./product-images-field";
import {
	EMPTY_PROMO_DRAFT,
	type PromoDraft,
	PromoFields,
	type PromoRow,
	type PromoSubmitValue,
	promoDraftFrom,
	promoDraftValid,
	promoSubmitValue,
} from "./promo-fields";
import {
	type CustomLineDraft,
	CustomLineFields,
	isMadeToOrderOnly,
	type LiveVariantStock,
	MockupApprovalFields,
	reconcileForSubmit,
	VariantEditor,
	type VariantEditorState,
	type VariantIssue,
	type VariantRow,
} from "./variant-editor";
import { WeekdayPicker } from "./weekday-picker";

export interface ProductFormSubmitValues {
	name: string;
	description?: string;
	// Storefront visibility. true = hidden from the public store (still sellable
	// at the counter). See docs/hidden-products.md.
	hidden: boolean;
	// Product kind (86eyj70z1). Set at create by the wizard; immutable after —
	// the edit route never sends it to `products.update` (which has no kind arg).
	kind?: ProductKind;
	// Booking-kind config — travels with kind at create; capacity, deposit,
	// package length and instant-book stay editable. securityDeposit in sen;
	// 0 clears (server normalizes). capacityPerNight undefined = unlimited.
	booking?: {
		capacityPerNight?: number;
		securityDeposit?: number;
		packageLength?: number;
		packageUnit?: PackageUnit;
		autoAccept?: boolean;
		/** "Only days you're open" (z8r3fdhpm7) — sent only with a day
		 * package; absent clears it. */
		skipsClosedDays?: boolean;
		/** "Up to N skips per package" (z8r3fdh3ay); 0 clears. */
		maxSkips?: number;
		/** Weekend per-night rate (sen; S13) + the nights it covers. 0 clears
		 * (server normalizes); omitted whenever a package length is set. */
		weekendPrice?: number;
		weekendDays?: number[];
	};
	// Per-product fulfilment-notice override (days). undefined = no override —
	// the store-level setting rules. Checkout takes the max across the cart.
	minNoticeDays?: number;
	// Per-product prep window (minutes). undefined = none; the caller sends 0
	// to clear on edit, matching minQuantity. Floors the fulfilment TIME the
	// way minNoticeDays floors the DATE.
	prepMinutes?: number;
	// One line the buyer reads before collecting. "" clears on edit.
	pickupNote?: string;
	// Minimum order quantity (summed across variants). undefined = no minimum;
	// the caller sends 0 to clear on edit. See convex/lib/minOrderRules.ts.
	minQuantity?: number;
	// Buyer questions (`z8r3fdkjek`). Always an array — `[]` clears on edit.
	buyerQuestions: BuyerQuestionInput[];
	// Fixed event date (`z8r3fdff9u`). `null` CLEARS a stored event (the toggle
	// turned off); an object sets/replaces it. Never `undefined` from this form
	// — that spelling means "no change", which would strand a cleared event.
	event: EventSubmitValue;
	/** Promotion config (z8r3fdcw72). `null` CLEARS a stored promotion —
	 * `undefined` would mean "no change" and strand one the seller just
	 * switched off, the same trap `event` documents above. So `undefined` is
	 * sent in exactly ONE case: a product inside a bulk promotion
	 * (z8r3fducfd), whose config belongs to the promotion and is never this
	 * form's to change — `products.update` refuses it outright. */
	promo: PromoSubmitValue | undefined;
	// FULL category membership (the picker's staged selection) — the caller
	// diffs it via categories.setProductCategories. See docs/product-categories.md.
	categoryIds: Id<"categories">[];
	imageStorageIds: string[];
	options: { name: string; values: string[] }[];
	variants: {
		optionValues: string[];
		sku?: string;
		price: number;
		/** Sale price in minor units (z8r3fdcw72); absent = not on promotion. */
		promoPrice?: number;
		onHand: number;
		active: boolean;
		blockWhenOutOfStock: boolean;
		requiresProof: boolean;
		// Parcel weight in grams (86eyeea1n). Both builders (full form + wizard)
		// route through buildSubmitVariants, which always sends a number — blank
		// input = explicit 0 = unset — so clearing the field really clears the
		// stored weight (`undefined` would hit the server's preserve-on-update
		// path). Optional in the type only because the CUSTOM line entry omits
		// it (its weight is unknowable by design; server defaults 0).
		parcelWeightG?: number;
		imageStorageIds: string[];
		// The custom / made-to-order line is submitted as a flagged entry in this
		// same array (server splits matrix vs custom). See docs/custom-option.md.
		isCustom?: boolean;
		customLabel?: string;
		customPrompt?: string;
	}[];
}

/** Seed shape for the form — also produced by the wizard's open-in-full-editor
 * handoff (`wizardToFormInitialValues`). */
export type ProductFormInitialValues = NonNullable<
	ProductFormProps["initialValues"]
>;

/**
 * The form's live, as-typed state — strings kept raw (blank price stays
 * blank). Read through the `draftRef` getter by the create route's
 * "switch back to guided setup" CTA, which reverse-derives a WizardState from
 * it (`formDraftToWizardState`) so no typed value is lost on the way back.
 */
export type ProductFormDraft = {
	name: string;
	description: string;
	hidden: boolean;
	/** Stored kind (physical default) — round-trips to the wizard's card. */
	kind: ProductKind;
	/** Booking capacity, as typed (only meaningful when kind === "booking").
	 * Blank = unlimited. */
	capacityPerNight: string;
	/** Package length in days, as typed; blank = free check-in/check-out. */
	packageLength?: string;
	packageUnit?: PackageUnit;
	/** Instant book — skip the approval step. */
	autoAccept?: boolean;
	/** "Only days you're open" on a day package (z8r3fdhpm7). */
	skipsClosedDays?: boolean;
	/** "Skips per package" as typed (z8r3fdh3ay); blank = no limit. */
	maxSkips?: string;
	/** Booking security deposit (RM, as typed; blank/absent = none). Optional
	 * so pre-S5 draft literals (tests, stored handoffs) stay valid. */
	securityDeposit?: string;
	/** Weekend per-night rate (RM, as typed; blank/absent = one rate) + the
	 * nights it covers (S13). */
	weekendPrice?: string;
	weekendDays?: number[];
	categoryIds: Id<"categories">[];
	images: ProductImage[];
	editor: VariantEditorState;
	minQuantity: string;
	minNoticeDays: string;
	prepMinutes: string;
	pickupNote: string;
	/** Event block, as typed. Optional so pre-event draft literals (tests,
	 * stored wizard handoffs) stay valid. */
	event?: EventDraft;
	/** Promotion block, as typed. Optional for the same reason `event` is:
	 * draft literals written before promotions must stay valid. */
	promoDraft?: PromoDraft;
	/** Buyer questions, as typed (`z8r3fdkjek`). Optional for the same reason. */
	buyerQuestions?: BuyerQuestionsDraft;
};

interface ProductFormProps {
	/** Owning retailer — feeds the category picker's list query. */
	retailerId: Id<"retailers">;
	/** Client mirror of the `categories` plan gate: when true, the picker only
	 * allows deselection (server enforces the same add-gated rule). */
	categoriesLocked: boolean;
	/** Client mirror of the `events` plan gate (`z8r3fdff9u`): when true the
	 * "This is an event" toggle disables with the Pro hint. Server enforces it. */
	eventsLocked: boolean;
	/** Client mirror of the `promo` plan gate (z8r3fdcw72): when true the
	 * "Run a promotion" toggle disables with the Pro hint. Server enforces it,
	 * and CLEARING is never gated so a downgraded seller is not trapped. */
	promoLocked: boolean;
	/** The bulk promotion this product belongs to (z8r3fducfd), if any. The
	 * Promotion card then says so and links to it, and edits only this
	 * product's sale prices — the window, label and flash extras are the
	 * promotion's. */
	groupedPromotion?: {
		promotionId: string;
		label?: string;
		percentOff: number;
		startsAt?: number;
		endsAt?: number;
	} | null;
	/** The store's credit balance, for the "this sale can take more orders
	 * than you have credits" nudge. Undefined = don't show it. */
	creditBalance?: number;
	/** Live (non-cancelled) RSVPs on this product — locks the date + the toggle
	 * once > 0, matching the server's refusal. Undefined on create. */
	eventRsvpCount?: number;
	initialValues?: {
		name?: string;
		description?: string;
		hidden?: boolean;
		/** Product kind — routes the form's vocabulary + which cards render.
		 * Absent = physical (legacy). Immutable in the form (create sets it via
		 * the wizard; edit displays it in the summary strip only). */
		kind?: ProductKind;
		/** Booking capacity as a string draft ("5") — wizard handoff + edit seed.
		 * Blank = unlimited. */
		capacityPerNight?: string;
		/** Package length in days as a string draft ("30"); blank = free range. */
		packageLength?: string;
		packageUnit?: PackageUnit;
		autoAccept?: boolean;
		skipsClosedDays?: boolean;
		/** "Skips per package" draft (z8r3fdh3ay); blank = no limit. */
		maxSkips?: string;
		/** Booking security deposit as a major-unit string draft ("100") — wizard
		 * handoff + edit seed. Blank/undefined = none. */
		securityDeposit?: string;
		/** Weekend per-night rate as a major-unit string draft + its nights (S13). */
		weekendPrice?: string;
		weekendDays?: number[];
		minNoticeDays?: number;
		prepMinutes?: number;
		pickupNote?: string;
		minQuantity?: number;
		/** Stored event config (`z8r3fdff9u`) — seeds the toggle + three inputs. */
		event?: {
			date: number;
			timeMinutes?: number;
			seats?: number;
			endDate?: number;
		};
		/** Event block as an already-built draft — the wizard handoff's spelling,
		 * which must survive a round-trip with half-typed values intact. Wins
		 * over `event` when both are present. */
		eventDraft?: EventDraft;
		/** The Promotion card's in-progress draft, so a wizard handoff and a
		 * round-trip back never lose a half-typed sale (z8r3fdcw72). */
		promoDraft?: PromoDraft;
		/** Stored buyer questions (`z8r3fdkjek`). */
		buyerQuestions?: BuyerQuestion[];
		/** Questions as a draft — the wizard handoff's spelling; wins over
		 * `buyerQuestions` (the `eventDraft` rule). */
		buyerQuestionsDraft?: BuyerQuestionsDraft;
		categoryIds?: Id<"categories">[];
		// Deprecated product-level defaults — used only to seed per-variant flags
		// for legacy products whose variants predate the per-variant columns.
		blockWhenOutOfStock?: boolean;
		requiresProof?: boolean;
		imageStorageIds?: string[];
		imageUrls?: string[];
		promo?: {
			label?: string;
			startsAt?: number;
			endsAt?: number;
			unitCap?: number;
			maxPerOrder?: number;
			payWithinMinutes?: number;
		};
		options?: { name: string; values: string[] }[];
		variants?: {
			optionValues: string[];
			sku?: string;
			price: number;
			/** Stored sale price in minor units (z8r3fdcw72). */
			promoPrice?: number;
			onHand: number;
			active?: boolean;
			blockWhenOutOfStock?: boolean;
			requiresProof?: boolean;
			parcelWeightG?: number;
			imageStorageIds?: string[];
			imageUrls?: string[];
			isCustom?: boolean;
			customLabel?: string;
			customPrompt?: string;
		}[];
	};
	/** The retailer's ISO code (`MYR`, `SGD`). Labels wear `currencySymbol`
	 * of it; the summary helpers take the code itself. */
	currency: string;
	submitLabel: string;
	onSubmit: (values: ProductFormSubmitValues) => Promise<void>;
	/** The store prices delivery by weight/zone (86eyeea1n) — promotes the
	 * variant parcel-weight inputs out of Advanced (see VariantEditor). */
	weightMode?: boolean;
	/** The store's opening hours + closed dates (z8r3fdhpm7) — the "How are
	 * the days counted?" example is built from them. */
	storeSchedule?: StoreSchedule;
	/** The store actually offers self-collect (`retailers.offerSelfCollect`).
	 * The pickup note is written FOR a collecting buyer, so on a
	 * delivery-only store the input would invite a seller to write something
	 * nobody will ever read — it degrades to a one-line hint pointing at the
	 * setting that turns it on, rather than vanishing without explanation. */
	offerSelfCollect?: boolean;
	/** Saved variants + their LIVE stock counts — edit mode only (86eypn8ye).
	 * Their stock renders read-only with an Adjust button, because the product
	 * save no longer writes `onHand`. Absent on create, where every row is new
	 * and its stock IS set by this form. */
	liveStock?: LiveVariantStock[];
	/**
	 * Optional secondary control rendered beside Save in the sticky action bar
	 * (e.g. the edit page's archive icon) — rare actions ride along without
	 * competing with the primary save.
	 */
	stickyAction?: ReactNode;
	/**
	 * Set while this seller can't save products right now — the store is
	 * view-only, out of credits (Credits T3), or they're a teammate with view
	 * on products. Save greys out wearing `label` ("Save changes — out of
	 * credits") and `reason` sits just above it. The fields stay editable, so
	 * an edit already under way survives until saving is possible again.
	 */
	saveLock?: { reason: string; label: string };
	/**
	 * "create" keeps the readiness checklist even when `initialValues` are
	 * present (the wizard handoff seeds a CREATE, not an edit). Defaults by
	 * `initialValues` presence: seeded = edit.
	 */
	mode?: "create" | "edit";
	/** Getter for the live draft — assigned every render so the create route
	 * can read the as-typed state when switching back to the wizard. */
	draftRef?: MutableRefObject<(() => ProductFormDraft) | null>;
	/**
	 * Direct editor-state seed — the wizard handoff passes its OWN editor
	 * substrate here (both views edit the same VariantEditorState), so the
	 * switch is lossless string-for-string. Overrides the `initialValues`
	 * variants/options derivation when present.
	 */
	initialEditor?: VariantEditorState;
	/**
	 * A What's-new note's deep link (`?spot=`, src/lib/spotlight.ts): scroll
	 * to the card that key names and ring it in the brand mint. The edit
	 * route validates the key; the form only has to find the card. A key
	 * whose card isn't rendered (a weekend-rate spotlight on a physical
	 * product) is a no-op — nothing to ring, so nothing rings.
	 */
	spotlight?: ProductSpotlightKey;
	/**
	 * Saves the product's photos the moment they change — edit mode only
	 * (z8r3fdtk82), since a product that doesn't exist yet has nowhere to save
	 * them. Absent, or while `saveLock` is set, photos are part of the draft
	 * like every other field.
	 */
	onImagesAutosave?: (imageStorageIds: string[]) => Promise<void>;
	/**
	 * Reports what leaving right now would lose (z8r3fdtk82), so the route can
	 * guard navigation with `UnsavedChangesGuard`. The form stays
	 * router-agnostic: blocking a navigation is the route's call.
	 */
	onUnsavedChange?: (state: UnsavedState) => void;
	/**
	 * The form opens holding work that isn't saved anywhere yet: a wizard
	 * draft handed to the full form. It counts as unsaved from the first
	 * render, because the baseline it would be compared against is that same
	 * draft.
	 */
	startsDirty?: boolean;
}

/** Seed the editor state from existing variants, or a single empty default row. */
function initialEditorState(
	initial: ProductFormProps["initialValues"],
): VariantEditorState {
	const options = initial?.options ?? [];
	const variants = initial?.variants;
	if (variants && variants.length > 0) {
		// Editing: preserve each variant's resolved flag exactly. The `?? product
		// ?? false` chain mirrors the old runtime (an unset flag meant made-to-order),
		// so opening a legacy product never silently flips it to hard-block.
		const blockFallback = initial?.blockWhenOutOfStock ?? false;
		const proofFallback = initial?.requiresProof ?? false;
		// The custom line lives outside the grid — pull it out so it doesn't become
		// a grid row, and seed the dedicated custom editor from it.
		const customVariant = variants.find((vr) => vr.isCustom);
		const rows: VariantRow[] = variants
			.filter((vr) => !vr.isCustom)
			.map((vr) => ({
				optionValues: vr.optionValues,
				sku: vr.sku ?? "",
				price: (vr.price / 100).toFixed(2),
				promoPrice:
					vr.promoPrice !== undefined && vr.promoPrice > 0
						? (vr.promoPrice / 100).toFixed(2)
						: "",
				stock: String(vr.onHand),
				active: vr.active ?? true,
				blockWhenOutOfStock: vr.blockWhenOutOfStock ?? blockFallback,
				requiresProof: vr.requiresProof ?? proofFallback,
				// 0 = unset — shown blank, not "0", so the field reads as empty
				// rather than "weighs nothing".
				parcelWeightG:
					vr.parcelWeightG && vr.parcelWeightG > 0
						? String(vr.parcelWeightG)
						: "",
				imageStorageIds: vr.imageStorageIds ?? [],
				imageUrl: vr.imageUrls?.[0],
			}));
		const customLine: CustomLineDraft | null = customVariant
			? {
					label: customVariant.customLabel ?? "",
					// price 0 = "Price on quote" → show as blank in the editor.
					price:
						customVariant.price === 0
							? ""
							: (customVariant.price / 100).toFixed(2),
					prompt: customVariant.customPrompt ?? "",
					imageStorageIds: customVariant.imageStorageIds ?? [],
					imageUrl: customVariant.imageUrls?.[0],
				}
			: null;
		return { options, rows, customLine };
	}
	// Brand-new product: default the starting row to hard-block (the common case —
	// a real stock item). Made-to-order is an explicit per-row opt-out. No custom
	// line until the seller opts in.
	return {
		options: [],
		rows: [
			{
				optionValues: [],
				sku: "",
				price: "",
				stock: "",
				active: true,
				blockWhenOutOfStock: true,
				requiresProof: false,
				parcelWeightG: "",
				imageStorageIds: [],
			},
		],
		customLine: null,
	};
}

const INT_RE = /^\d+$/;

type SubmitVariant = ProductFormSubmitValues["variants"][number];

/**
 * Validate the option axes: every axis needs a name and at least one value.
 * Pure + exported for tests; issues are addressed to the exact axis input so
 * the editor marks it inline (no generic banner).
 */
export function collectOptionIssues(
	options: { name: string; values: string[] }[],
): VariantIssue[] {
	const issues: VariantIssue[] = [];
	// Over the cap the grid is the problem, and it is fixed by removing VALUES —
	// so the breach is reported here, on the axis, and (because option issues are
	// collected before row issues) it is the one the focus-first-error helper
	// lands on. Before this, a seller who widened an axis past the cap met a pile
	// of "Enter a price" errors on the rows the widening had just generated, and
	// nothing said the grid was over the limit until the server refused the save
	// (z8r3fdjgvd).
	const total = cartesian(options).length;
	if (total > MAX_VARIANTS_PER_PRODUCT) {
		issues.push({
			where: "option",
			index: 0,
			field: "values",
			message: overCapMessage(total),
		});
	}
	options.forEach((axis, index) => {
		if (axis.name.trim().length === 0) {
			issues.push({
				where: "option",
				index,
				field: "name",
				message: "Give this option a name (e.g. Size).",
			});
		}
		if (axis.values.length === 0) {
			issues.push({
				where: "option",
				index,
				field: "values",
				message: "Add at least one value (e.g. Small).",
			});
		}
	});
	return issues;
}

/**
 * Turn the editor's grid rows + optional custom line into the submit payload,
 * validating active variants. Pure (no React/state) so the validation is unit
 * testable. Returns ALL validation issues — each addressed to the exact
 * row/field so the editor can mark that input inline and the shared
 * focus-first-error helper lands on it — or the built variant list.
 *
 * Stock rule: it only gates the save when the variant is tracking stock
 * (`blockWhenOutOfStock`). Made-to-order variants never run out — stock is just
 * a guide — so a blank/omitted value is fine and falls back to 0. Inactive
 * (deactivated) variants are hidden from buyers, so their price/stock never
 * block the save either (blank falls back to 0).
 */
export function buildSubmitVariants(
	rows: VariantRow[],
	customLine: CustomLineDraft | null,
): { issues: VariantIssue[] } | { variants: SubmitVariant[] } {
	const issues: VariantIssue[] = [];
	const variants: SubmitVariant[] = [];
	rows.forEach((row, index) => {
		// Price: any non-negative number; rounded to integer sen (2 dp).
		// parsePriceInput handles comma separators and rejects (rather than
		// silently truncating) anything non-numeric — see src/lib/format.ts.
		const priceNum = parsePriceInput(row.price.trim());
		const priceOk = priceNum !== null;
		const promoRaw = (row.promoPrice ?? "").trim();
		const promoNum = promoRaw.length > 0 ? parsePriceInput(promoRaw) : null;
		const stockOk = INT_RE.test(row.stock.trim());
		// Parcel weight (86eyeea1n): optional whole grams. Blank = 0 = unset —
		// sent explicitly so clearing the field really clears the stored weight
		// (undefined would hit the server's preserve-on-update path). Validated
		// even on inactive rows: a bad value is a typo wherever it sits, and
		// silently zeroing it would un-weigh the row on reactivation.
		const weightStr = row.parcelWeightG.trim();
		const weightOk =
			weightStr.length === 0 ||
			(INT_RE.test(weightStr) &&
				Number.parseInt(weightStr, 10) <= PRODUCT_WEIGHT_MAX);
		if (!weightOk) {
			issues.push({
				where: "row",
				index,
				field: "weight",
				message: INT_RE.test(weightStr)
					? "That's heavier than 1,000 kg — check the number (grams)."
					: "Whole grams only (e.g. 500 for half a kilo).",
			});
		}
		if (row.active) {
			if (!priceOk) {
				issues.push({
					where: "row",
					index,
					field: "price",
					message:
						row.price.trim().length === 0
							? "Enter a price (e.g. 120 or 120.50)."
							: "Not a valid price — numbers only (e.g. 120 or 120.50).",
				});
			}
			// A sale price has to undercut its OWN line's list price — the same
			// rule `assertValidPromoPrice` enforces at the mutation, mirrored
			// here so the seller is told before the round trip.
			if (
				promoRaw.length > 0 &&
				(promoNum === null || !priceOk || promoNum <= 0 || promoNum >= priceNum)
			) {
				issues.push({
					where: "row",
					index,
					field: "promoPrice",
					message:
						promoNum === null
							? "Not a valid sale price — numbers only (e.g. 31.50)."
							: "A sale price has to be below this line's normal price.",
				});
			}
			if (row.blockWhenOutOfStock && !stockOk) {
				issues.push({
					where: "row",
					index,
					field: "stock",
					message: "Enter a whole-number stock (0 is fine).",
				});
			}
		}
		variants.push({
			optionValues: row.optionValues,
			sku: row.sku.trim() || undefined,
			price: priceOk ? Math.round(priceNum * 100) : 0,
			promoPrice:
				promoNum !== null && priceOk && promoNum > 0 && promoNum < priceNum
					? Math.round(promoNum * 100)
					: undefined,
			onHand: stockOk ? Number.parseInt(row.stock, 10) : 0,
			active: row.active,
			blockWhenOutOfStock: row.blockWhenOutOfStock,
			requiresProof: row.requiresProof,
			parcelWeightG:
				weightOk && weightStr.length > 0 ? Number.parseInt(weightStr, 10) : 0,
			imageStorageIds: row.imageStorageIds,
		});
	});

	// Custom line (if enabled) — a flagged entry in the same array. Price is
	// optional: blank = "Price on quote" (0). The server coerces the made-to-
	// order + mockup flags and the default label.
	if (customLine) {
		const priceStr = customLine.price.trim();
		let customPrice = 0;
		if (priceStr.length > 0) {
			const n = parsePriceInput(priceStr);
			if (n === null) {
				issues.push({
					where: "custom",
					index: 0,
					field: "price",
					message:
						"Not a valid price — enter a number, or leave blank for price on quote.",
				});
			} else {
				customPrice = Math.round(n * 100);
			}
		}
		variants.push({
			optionValues: [],
			price: customPrice,
			onHand: 0,
			active: true,
			blockWhenOutOfStock: false,
			requiresProof: true,
			imageStorageIds: customLine.imageStorageIds,
			isCustom: true,
			customLabel: customLine.label.trim() || undefined,
			customPrompt: customLine.prompt.trim() || undefined,
		});
	}

	if (issues.length > 0) return { issues };
	return { variants };
}

function ProductStepCard({
	icon,
	kicker,
	title,
	description,
	children,
	id,
	highlight,
}: {
	icon: ReactNode;
	kicker: string;
	title: string;
	description: string;
	children: ReactNode;
	/** Anchor for a deep link (`SPOTLIGHT_ANCHOR.<key>.anchor`). */
	id?: string;
	/** Ring this card — the What's-new spotlight, same ring the settings cards wear. */
	highlight?: FixHighlight;
}) {
	// `scroll-mt-24` keeps the sticky header off the card once scrolled to;
	// the ring is a box-shadow, so `overflow-hidden` on the section (which
	// clips the header band's corners) leaves it intact.
	return (
		<section
			id={id}
			className={`overflow-hidden rounded-2xl border bg-card shadow-sm scroll-mt-24 ${highlight ? highlightRingClass(highlight) : "border-border"}`}
		>
			<div className="flex gap-3 border-b border-border bg-muted/25 px-4 py-4 lg:px-5">
				<div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background text-accent ring-1 ring-border">
					{icon}
				</div>
				<div className="min-w-0">
					<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
						{kicker}
					</p>
					<h3 className="text-base font-semibold leading-tight">{title}</h3>
					<p className="mt-1 text-sm leading-relaxed text-muted-foreground">
						{description}
					</p>
				</div>
			</div>
			<div className="flex flex-col gap-4 p-4 lg:p-5">{children}</div>
		</section>
	);
}

function ProductReadiness({
	hasName,
	hasPrice,
	imageCount,
}: {
	hasName: boolean;
	hasPrice: boolean;
	imageCount: number;
}) {
	const checks = [
		{ label: "Product name", done: hasName },
		{ label: "Price ready", done: hasPrice },
		{
			label: imageCount > 0 ? `${imageCount} photo added` : "Photo optional",
			done: true,
		},
	];
	return (
		<div className="grid gap-2 rounded-2xl border border-accent/20 bg-accent/5 p-3 sm:grid-cols-3">
			{checks.map((check) => (
				<div
					key={check.label}
					className="flex items-center gap-2 rounded-xl bg-background/80 px-3 py-2 text-sm"
				>
					<CheckCircle2
						className={`size-4 shrink-0 ${
							check.done ? "text-accent" : "text-muted-foreground"
						}`}
					/>
					<span
						className={
							check.done
								? "font-medium text-foreground"
								: "text-muted-foreground"
						}
					>
						{check.label}
					</span>
				</div>
			))}
		</div>
	);
}

/**
 * Edit-mode summary strip — the product's selling setup in plain words
 * ("3 choices by Size · Made to order · RM 12–28"), live-derived from the
 * draft state so the seller confirms what they have before touching anything.
 */
function ProductSummaryStrip({
	name,
	editor,
	currency,
	booking = null,
	event = null,
}: {
	name: string;
	editor: VariantEditorState;
	currency: string;
	/** Fixed event config — leads the strip ("Event · Fri 25 Sep …"). */
	event?: {
		date: number;
		timeMinutes?: number;
		seats?: number;
		endDate?: number;
	} | null;
	/** Booking kind + its capacity draft — flips the strip to booking words. */
	booking?: {
		capacityPerNight: string;
		packageLength?: string;
		packageUnit?: PackageUnit;
		autoAccept?: boolean;
		skipsClosedDays?: boolean;
		maxSkips?: string;
		weekendPrice?: string;
		weekendDays?: readonly number[];
	} | null;
}) {
	const summary = describeProduct(
		{
			event,
			options: editor.options,
			rows: editor.rows,
			customLine: editor.customLine,
			booking,
		},
		currency,
	);
	return (
		<div className="rounded-2xl border border-accent/20 bg-accent/5 px-4 py-3 text-sm leading-relaxed">
			<span className="font-semibold text-accent-emphasis">
				{name.trim() || "This product"}
			</span>{" "}
			— {summary}
		</div>
	);
}

/**
 * Product-level storefront visibility. A first-class status (not a buried
 * toggle) because it changes where the product appears. Hidden products stay
 * fully sellable in counter checkout — surfaced in the helper so the behaviour
 * is never a surprise. See docs/hidden-products.md.
 */
function VisibilityControl({
	hidden,
	onChange,
}: {
	hidden: boolean;
	onChange: (hidden: boolean) => void;
}) {
	const options = [
		{
			value: false,
			label: "Visible",
			icon: <Store className="size-4" aria-hidden />,
		},
		{
			value: true,
			label: "Hidden",
			icon: <EyeOff className="size-4" aria-hidden />,
		},
	];
	return (
		<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div className="min-w-0">
				<h4 className="text-sm font-semibold leading-tight">Visibility</h4>
				<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
					{hidden
						? "Hidden from your public store. Still sellable in counter checkout."
						: "Shown on your public store and sellable everywhere."}
				</p>
			</div>
			<div className="flex shrink-0 self-start gap-1 rounded-xl bg-muted p-1 sm:self-auto">
				{options.map((opt) => {
					const selected = opt.value === hidden;
					return (
						<button
							key={opt.label}
							type="button"
							aria-pressed={selected}
							onClick={() => onChange(opt.value)}
							className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors ${
								selected
									? "bg-background text-foreground shadow-sm"
									: "text-muted-foreground hover:text-foreground"
							}`}
						>
							{opt.icon}
							{opt.label}
						</button>
					);
				})}
			</div>
		</div>
	);
}

export function ProductForm({
	retailerId,
	categoriesLocked,
	eventsLocked,
	promoLocked,
	groupedPromotion,
	creditBalance,
	eventRsvpCount,
	initialValues,
	currency,
	submitLabel,
	onSubmit,
	weightMode = false,
	storeSchedule,
	offerSelfCollect = true,
	liveStock,
	stickyAction,
	mode,
	draftRef,
	initialEditor,
	spotlight,
	saveLock,
	onImagesAutosave,
	onUnsavedChange,
	startsDirty = false,
}: ProductFormProps) {
	// Editing an existing product vs creating a new one — the edit page leads
	// with the summary strip; create keeps the readiness checklist. The wizard
	// handoff seeds a create with initialValues, so `mode` wins when given.
	const isEdit = mode ? mode === "edit" : initialValues !== undefined;

	// Deep link to one card (`?spot=`): scroll to it and ring it, instead of
	// dropping the seller at the top of a long form to hunt for it. Same
	// scroll-and-ring as `/app/settings`; the card takes its ring from
	// `ringFor` below. Waits a frame because the card mounts in this commit.
	const spotlightAnchor = spotlight
		? SPOTLIGHT_ANCHOR[spotlight].anchor
		: undefined;
	const ringFor = (anchor: string): FixHighlight | undefined =>
		spotlightAnchor === anchor ? "spotlight" : undefined;
	useEffect(() => {
		if (!spotlightAnchor) return;
		return revealAnchorWhenMounted(spotlightAnchor);
	}, [spotlightAnchor]);

	const [images, setImages] = useState<ProductImage[]>(
		(initialValues?.imageStorageIds ?? []).map((id, i) => ({
			id,
			url: initialValues?.imageUrls?.[i] ?? "",
		})),
	);
	const [photoUploads, setPhotoUploads] = useState<PhotoUploadState>({
		kind: "idle",
	});
	const uploading = photoUploads.kind === "uploading";
	const photosFailed = photoUploads.kind === "failed" ? photoUploads.count : 0;
	const [serverError, setServerError] = useState<string | null>(null);
	// The credit lock's typed refusal, when that's what the save hit — its way
	// back renders under the sentence (Credits T3).
	const [serverLock, setServerLock] = useState<CreditLockErrorData | null>(
		null,
	);
	const [showPreview, setShowPreview] = useState(false);
	const [hidden, setHidden] = useState(initialValues?.hidden ?? false);
	// Kind is IMMUTABLE in the form (86eyj70z1: set at create via the wizard;
	// archive + recreate is the escape hatch) — read once, routes the booking
	// rendering below. Capacity is the one booking knob that stays editable.
	const kind: ProductKind = initialValues?.kind ?? "physical";
	const isBooking = kind === "booking";
	const [capacityDraft, setCapacityDraft] = useState(
		initialValues?.capacityPerNight ?? "1",
	);
	const [depositDraft, setDepositDraft] = useState(
		initialValues?.securityDeposit ?? "",
	);
	const [packageDraft, setPackageDraft] = useState(
		initialValues?.packageLength ?? "",
	);
	const [packageUnit, setPackageUnit] = useState<PackageUnit>(
		initialValues?.packageUnit ?? "month",
	);
	const [autoAccept, setAutoAccept] = useState(
		initialValues?.autoAccept === true,
	);
	// "Only days you're open" (z8r3fdhpm7). Kept while the seller flips the
	// unit about, but only SENT for a day package — the server refuses it on
	// any other shape, so a hidden value never rides along.
	const [skipsClosedDays, setSkipsClosedDays] = useState(
		initialValues?.skipsClosedDays === true,
	);
	// "Skips per package" (z8r3fdh3ay) — sent only with "Only days you're
	// open"; otherwise 0 clears it, so a hidden cap never rides along.
	const [maxSkipsDraft, setMaxSkipsDraft] = useState(
		initialValues?.maxSkips ?? "",
	);
	// Weekend rate (S13) — RM draft + the nights it covers. Defaults to Fri +
	// Sat so a seller who only types the rate gets the campsite norm.
	const [weekendDraft, setWeekendDraft] = useState(
		initialValues?.weekendPrice ?? "",
	);
	const [weekendDays, setWeekendDays] = useState<number[]>(
		initialValues?.weekendDays ?? [...DEFAULT_WEEKEND_DAYS],
	);
	// Draft as a string so the input can be cleared while typing; parsed at
	// submit (blank/0 = no override).
	const [minNoticeDraft, setMinNoticeDraft] = useState(
		initialValues?.minNoticeDays ? String(initialValues.minNoticeDays) : "",
	);
	const [prepDraft, setPrepDraft] = useState(
		initialValues?.prepMinutes ? String(initialValues.prepMinutes) : "",
	);
	const [pickupNoteDraft, setPickupNoteDraft] = useState(
		initialValues?.pickupNote ?? "",
	);
	// Minimum order quantity — blank = no minimum (stored ≥2; see minOrderRules).
	const [minQty, setMinQty] = useState(
		initialValues?.minQuantity ? String(initialValues.minQuantity) : "",
	);
	// EVERY pickup point, hidden ones included — the event's venue selector
	// (round 4). A point hidden from standard orders can still host an event
	// (an RSVP-only location IS a hidden point). Adapter read per the standing
	// rule; skipped entirely for booking listings, which can never be events.
	const pickupRows = useQuery(
		convexQuery(
			api.pickupLocations.listForRetailer,
			isBooking ? "skip" : { retailerId },
		),
	).data;
	const eventVenues = pickupRows?.map((r) => ({
		_id: r._id as string,
		label: r.label,
		isActive: r.isActive,
		// Drives the picker's grouping (z8r3fdm32x).
		eventsOnly: r.eventsOnly,
		// Carried so the picker can say that an event never charges it — see
		// buildEventVenueSnapshot (z8r3fdjgvd).
		fee: r.fee,
	}));
	const [eventDraft, setEventDraft] = useState<EventDraft>(
		() =>
			initialValues?.eventDraft ??
			eventDraftFrom(initialValues?.event) ??
			EMPTY_EVENT_DRAFT,
	);
	const [promoDraft, setPromoDraft] = useState<PromoDraft>(
		() =>
			initialValues?.promoDraft ??
			promoDraftFrom(initialValues?.promo) ??
			EMPTY_PROMO_DRAFT,
	);
	// Flips on the first save attempt: from then on a question row with a
	// problem inside says so on its collapsed line, and the buyer-question
	// editor shows every row's issue rather than only touched ones.
	const [submitAttempted, setSubmitAttempted] = useState(false);
	const [questionsDraft, setQuestionsDraft] = useState<BuyerQuestionsDraft>(
		() =>
			initialValues?.buyerQuestionsDraft ??
			questionsDraftFrom(initialValues?.buyerQuestions),
	);
	const [categoryIds, setCategoryIds] = useState<Id<"categories">[]>(
		initialValues?.categoryIds ?? [],
	);
	// The store's categories, for the "Where does it show?" answer line. The
	// picker inside the row runs the SAME query, so this is one cached read.
	const storeCategories = useQuery(
		convexQuery(api.categories.listForRetailer, { retailerId }),
	).data;
	const [editor, setEditorState] = useState<VariantEditorState>(
		() => initialEditor ?? initialEditorState(initialValues),
	);
	// The custom line as the seller last had it, kept while its question is
	// switched off so switching it back on restores their name, price, prompt
	// and photo — the way the event and promotion rows keep their drafts. It
	// is NOT saved while off: the save sends `editor.customLine`, which is null.
	const parkedCustomLine = useRef<CustomLineDraft | null>(null);
	// Submit-time validation issues, addressed to the exact editor input (see
	// VariantIssue). Any edit clears them — they re-validate on the next save.
	const [editorIssues, setEditorIssues] = useState<VariantIssue[]>([]);
	function setEditor(next: VariantEditorState) {
		setEditorState(next);
		setEditorIssues([]);
	}

	// The Promotion card edits sale prices on the SAME rows the pricing grid
	// owns — one substrate, two writers — so a line added, renamed or removed
	// in the grid can never drift from the promotion. Rows are keyed by their
	// option label, which is what the grid itself keys identity on.
	const promoRows: PromoRow[] = editor.rows.map((row, index) => ({
		key: String(index),
		label: variantLabel(row.optionValues) || "This product",
		price: row.price,
		promoPrice: row.promoPrice ?? "",
	}));
	/** ONE state write for however many rows changed. Per-row writes in a loop
	 * each read `editor` from this render's closure, so N of them collapse to
	 * the last one — "30% off" discounted only the final choice. */
	function setPromoPrices(next: Record<string, string>) {
		setEditor({
			...editor,
			rows: editor.rows.map((row, i) => {
				const value = next[String(i)];
				return value === undefined ? row : { ...row, promoPrice: value };
			}),
		});
	}

	const form = useAppForm({
		defaultValues: {
			name: initialValues?.name ?? "",
			description: initialValues?.description ?? "",
		},
		validators: { onChange: productDetailsSchema },
		onSubmit: async ({ value }) => {
			setServerError(null);
			setServerLock(null);
			const parsed = productDetailsSchema.parse(value);

			// --- Client-side validation of options + the variant grid ----------
			// Issues are addressed to the exact input (marked aria-invalid, message
			// beneath), so the shared focus helper lands on the offending field —
			// never a generic banner the seller has to decode.
			// Reconcile FIRST: seeded state (a stored product, a wizard handoff) or
			// a commit against a stale closure can leave rows that don't describe
			// `options`, which the server rejects with a count mismatch the seller
			// has no field to fix. Rebuilding costs a re-typed price at worst.
			const reconciled = reconcileForSubmit(editor.options, editor.rows);
			if (reconciled.rows !== editor.rows) {
				// Show the seller the grid that's actually about to be saved, so any
				// row issue below points at an input they can see and correct.
				setEditorState({ ...editor, ...reconciled });
			}
			const hasOptions = reconciled.options.length > 0;
			// An axis with no values yet means the rows still describe the
			// PREVIOUS shape (kept on purpose — see rebuildRows) and aren't on
			// screen. Report only the actionable axis problem; row messages would
			// be addressed to inputs the seller can't see.
			const gridReady = cartesian(reconciled.options).length > 0;
			// A made-to-order product reconciles to an EMPTY matrix — its custom
			// line is the whole offer, and `buildSubmitVariants` emits that line
			// as the product's only variant.
			const built = buildSubmitVariants(reconciled.rows, editor.customLine);
			// Over the cap, the blank rows the widening just generated are not what
			// the seller must fix — the axis is. Reporting them alongside would
			// bury the real blocker under dozens of price errors, the same reason
			// `gridReady` gates them above.
			const overCap =
				cartesian(reconciled.options).length > MAX_VARIANTS_PER_PRODUCT;
			const issues = [
				...collectOptionIssues(reconciled.options),
				...(gridReady && !overCap && "issues" in built ? built.issues : []),
			];
			if (issues.length > 0) {
				setEditorIssues(issues);
				return;
			}
			// `issues` empty ⇒ built carries the variants.
			const variants = "variants" in built ? built.variants : [];
			// Min-quantity / capacity input invalid → inline error already on screen.
			// Prep is exempt while the event toggle is on: the field is hidden
			// there, so a stale half-typed value must not block the save.
			if (!minQtyValid || (!eventDraft.on && !prepValid) || !pickupNoteValid)
				return;
			// An event that already has guests may be re-saved on its own past
			// date (the seller fixing a seat cap the morning after) — the same
			// allowance the server makes.
			if (!eventValid) return;
			// Questions are validated by the server's own sanitizer; the card
			// shows its message inline. Never on a booking (always sends []).
			if (!isBooking && !questionsDraftValid(questionsDraft)) return;
			// The Promotion card states its issue inline (and is the
			// `data-form-error` the focus helper scrolls to). Mostly a twin of
			// the server's refusals; "on but nothing on sale" is client-only.
			if (
				!groupedPromotion &&
				!promoDraftValid(promoDraft, Date.now(), editor.rows)
			)
				return;
			if (
				isBooking &&
				(!capacityValid ||
					!depositValid ||
					!packageValid ||
					!weekendValid ||
					!maxSkipsValid)
			)
				return;

			try {
				const minNoticeParsed = Number.parseInt(minNoticeDraft, 10);
				await onSubmit({
					name: parsed.name,
					description: parsed.description,
					hidden,
					kind,
					booking: isBooking
						? {
								// Blank = unlimited; the server keeps it unset.
								capacityPerNight:
									capacityTrimmed.length > 0
										? Number(capacityTrimmed)
										: undefined,
								packageLength:
									packageTrimmed.length > 0 ? Number(packageTrimmed) : 0,
								packageUnit,
								autoAccept,
								skipsClosedDays: countsOpenDays ? true : undefined,
								maxSkips: countsOpenDays ? maxSkipsFromDraft(maxSkipsDraft) : 0,
								// Sen; 0 = clear (the server normalizes 0 → unset).
								securityDeposit:
									depositParsed !== null && depositParsed > 0
										? Math.round(depositParsed * 100)
										: 0,
								// Free-range only: a package has one flat price, so the
								// fields are hidden there and the pair is dropped rather
								// than sent for the server to refuse. 0 clears.
								weekendPrice:
									packageTrimmed.length === 0 &&
									weekendParsed !== null &&
									weekendParsed > 0
										? Math.round(weekendParsed * 100)
										: 0,
								weekendDays:
									packageTrimmed.length === 0 ? weekendDays : undefined,
							}
						: undefined,
					// An EVENT clears both timing rules (the booking posture): guests
					// RSVP to the fixed date, so notice has no date to push and prep
					// has no time to floor — their inputs are hidden, and a hidden
					// field must never keep stale config alive on the row.
					minNoticeDays: eventDraft.on
						? 0
						: Number.isInteger(minNoticeParsed) && minNoticeParsed > 0
							? Math.min(minNoticeParsed, MAX_NOTICE_DAYS)
							: 0,
					// 0 clears on the server (one spelling for "no window"), and a
					// booking listing never carries one — request-to-book IS the
					// preparation, so its input is not rendered.
					prepMinutes: isBooking || eventDraft.on ? 0 : prepParsed,
					// "" clears. Still sent when the store has self-collect OFF —
					// the note is already written and turning collection back on
					// should not find it silently dropped — but never for a
					// booking, whose orders can't carry one.
					pickupNote: isBooking ? "" : pickupNoteDraft,
					// 0 = no minimum (blank input) — the server normalizes 0/1 to unset.
					// A booking listing never carries one (its input isn't rendered).
					minQuantity: isBooking ? 0 : minQtyParsed,
					// `null` when off — the spelling that CLEARS. A booking listing
					// never renders the block, so it always sends null.
					event: isBooking ? null : eventSubmitValue(eventDraft),
					promo: groupedPromotion
						? undefined
						: promoSubmitValue(promoDraft, Date.now(), {
								flashAllowed: !isBooking && !eventDraft.on,
							}),
					buyerQuestions: isBooking ? [] : questionsSubmitValue(questionsDraft),
					categoryIds,
					imageStorageIds: images.map((i) => i.id),
					// Derived from the SAME reconciled pair as `variants` above, so the
					// axes and the grid can never describe different products.
					options: hasOptions ? reconciled.options : [],
					variants,
				});
			} catch (err) {
				setServerError(convexErrorMessage(err));
				setServerLock(creditLockErrorOf(err));
			}
		},
	});

	// Subscribed (not read off `form.state`) so the dirty check below re-runs
	// on every keystroke in the name or description.
	const formValues = useStore(form.store, (s) => s.values);
	function currentDraft(): ProductFormDraft {
		return {
			name: formValues.name,
			description: formValues.description ?? "",
			hidden,
			kind,
			capacityPerNight: capacityDraft,
			securityDeposit: depositDraft,
			packageLength: packageDraft,
			packageUnit,
			autoAccept,
			skipsClosedDays,
			maxSkips: maxSkipsDraft,
			weekendPrice: weekendDraft,
			weekendDays,
			categoryIds,
			images,
			editor,
			minQuantity: minQty,
			minNoticeDays: minNoticeDraft,
			prepMinutes: prepDraft,
			pickupNote: pickupNoteDraft,
			event: eventDraft,
			promoDraft,
			buyerQuestions: questionsDraft,
		};
	}
	const draft = currentDraft();

	// "Unchanged" = the draft the form opened with (z8r3fdtk82). Lazily
	// seeded on the first render, so it holds exactly the state the inputs
	// started from. A photo autosave moves only its images forward, so the
	// photos stop counting as unsaved and every other field still does.
	const baselineRef = useRef<ProductFormDraft | null>(null);
	if (baselineRef.current === null) baselineRef.current = draft;
	const dirty = startsDirty || isDraftDirty(baselineRef.current, draft);

	// Photos save themselves on an existing product, unless saving is locked
	// right now, in which case they wait in the draft like everything else.
	const autosaveOn = onImagesAutosave !== undefined && saveLock === undefined;
	const photoAutosave = usePhotoAutosave({
		save: (ids) => onImagesAutosave?.(ids) ?? Promise.resolve(),
		onSaved: (saved) => {
			if (baselineRef.current)
				baselineRef.current = { ...baselineRef.current, images: saved };
		},
	});
	// The photo list as of the latest change, for an Undo that fires later:
	// it puts back ONE photo into whatever the list is by then, never a stale
	// snapshot that would also undo everything done since.
	const imagesRef = useRef(images);
	imagesRef.current = images;
	// Each removal's Undo toast, so leaving the page takes them with it: an
	// Undo from another page would write a list this form no longer shows.
	const undoToastIds = useRef(new Set<string>());
	useEffect(() => {
		const ids = undoToastIds.current;
		return () => {
			for (const id of ids) toast.dismiss(id);
		};
	}, []);

	function changeImages(next: ProductImage[]) {
		setServerError(null);
		const before = imagesRef.current;
		imagesRef.current = next;
		setImages(next);
		if (!autosaveOn) return;
		photoAutosave.autosave(next);
		// Removing saves at once too, so each removed photo gets its own way
		// back. One shared toast meant a second removal replaced the first's
		// Undo, and that photo could only come back by re-uploading it (PR
		// #371 review).
		before.forEach((photo, index) => {
			if (next.some((i) => i.id === photo.id)) return;
			const id = `product-photo-removed-${photo.id}`;
			undoToastIds.current.add(id);
			toast("Photo removed.", {
				id,
				// Undo is the only way back. The 4s default ran out while a
				// seller was still reaching for it (found in the hands-on test).
				duration: 10_000,
				onAutoClose: () => undoToastIds.current.delete(id),
				onDismiss: () => undoToastIds.current.delete(id),
				action: {
					label: "Undo",
					onClick: () => restorePhoto(photo, index),
				},
			});
		});
	}

	function restorePhoto(photo: ProductImage, index: number) {
		const now = imagesRef.current;
		if (now.some((i) => i.id === photo.id)) return;
		if (now.length >= MAX_IMAGES) {
			toast.error(
				`You already have ${MAX_IMAGES} photos. Remove one to bring this photo back.`,
			);
			return;
		}
		const next = [...now];
		// Back where it was, or last if the list has since got shorter.
		next.splice(Math.min(index, now.length), 0, photo);
		changeImages(next);
	}

	// A photo that didn't upload is still on screen waiting for Retry — leaving
	// would lose it, so it counts as unsaved work (z8r3fdtk85).
	const unsaved: UnsavedState = uploading
		? "uploading"
		: dirty || photosFailed > 0
			? "changes"
			: "none";
	useEffect(() => {
		onUnsavedChange?.(unsaved);
	}, [unsaved, onUnsavedChange]);

	// Keep the draft getter fresh after every commit — the route reads it
	// lazily on the "switch back to guided setup" / Preview click, never during
	// render. Assigned in a layout effect (not the render body) so a discarded
	// concurrent render can't publish its state through the ref.
	useLayoutEffect(() => {
		if (!draftRef) return;
		draftRef.current = () => draft;
		return () => {
			draftRef.current = null;
		};
	});

	function handleSubmit(e: FormEvent) {
		// From the first save attempt on, every question row shows its
		// problem — before it, only rows the seller has touched do.
		setSubmitAttempted(true);
		submitThenFocusError(form, e);
	}

	const hasAnyPrice = editor.rows.some((row) => row.price.trim().length > 0);

	// Booking capacity — required whole number 1..MAX (mirrors the wizard +
	// the server's sanitizeCapacityPerNight, so the form can't accept what the
	// save then refuses).
	const capacityTrimmed = capacityDraft.trim();
	const capacityParsed = Number(capacityTrimmed);
	// Blank capacity = UNLIMITED (S7), a valid choice — not a missing value.
	const capacityValid =
		capacityTrimmed.length === 0 ||
		(Number.isInteger(capacityParsed) &&
			capacityParsed >= 1 &&
			capacityParsed <= MAX_CAPACITY_PER_NIGHT);

	// Package length — blank = the free check-in/check-out range.
	const packageTrimmed = packageDraft.trim();
	const packageParsed = Number(packageTrimmed);
	const packageValid =
		packageTrimmed.length === 0 ||
		(Number.isInteger(packageParsed) &&
			packageParsed >= 1 &&
			packageParsed <= packageUnitMax(packageUnit));
	// Names the span in the price label ("Price per month") while the seller is
	// still typing it. Only a VALID length renames anything — a half-typed or
	// out-of-range value leaves the label on "night" rather than flickering
	// through nonsense like "per 0 months".
	const packageLengthNum =
		packageValid && packageTrimmed.length > 0 ? packageParsed : undefined;
	// "Only days you're open" (z8r3fdhpm7) is a question only a DAY package
	// answers — a month runs by the calendar, a night package is a stay.
	const offersDayCounting =
		packageUnit === "day" && packageLengthNum !== undefined;
	const countsOpenDays = offersDayCounting && skipsClosedDays;
	// Only judged while the field is on screen — a stale typo under a hidden
	// field must not block the save (it's sent as 0, cleared).
	const maxSkipsValid =
		!countsOpenDays || maxSkipsDraftIssue(maxSkipsDraft) === null;

	// Booking security deposit — blank = none; else inside the server's own
	// sanitizeSecurityDeposit ceiling (`isSecurityDepositInRange`, shared with
	// the wizard so the two can't drift).
	const depositTrimmed = depositDraft.trim();
	const depositParsed =
		depositTrimmed.length === 0 ? 0 : parsePriceInput(depositTrimmed);
	const depositValid =
		depositTrimmed.length === 0 || isSecurityDepositInRange(depositParsed);

	// Weekend rate (S13) — blank = one rate; else a price in (0, RM 100,000]
	// with at least one night and never all seven (mirrors
	// sanitizeWeekendRate). Irrelevant on a package, whose fields are hidden.
	const weekendTrimmed = weekendDraft.trim();
	const weekendParsed =
		weekendTrimmed.length === 0 ? null : parsePriceInput(weekendTrimmed);
	const weekendPriceValid =
		weekendTrimmed.length === 0 ||
		(weekendParsed !== null && weekendParsed > 0 && weekendParsed <= 100_000);
	const weekendDaysValid =
		weekendTrimmed.length === 0 ||
		(weekendDays.length >= 1 && weekendDays.length <= 6);
	const weekendValid =
		packageTrimmed.length > 0 || (weekendPriceValid && weekendDaysValid);
	const weekendConsequence = weekendRateConsequence(
		{
			basePrice: editor.rows[0]?.price ?? "",
			weekendPrice: weekendDraft,
			weekendDays,
		},
		currency,
	);

	// Minimum order quantity — blank clears; whole number ≤ MIN_QUANTITY_MAX.
	const minQtyTrimmed = minQty.trim();
	const minQtyParsed = minQtyTrimmed.length === 0 ? 0 : Number(minQtyTrimmed);
	const minQtyValid =
		minQtyTrimmed.length === 0 ||
		(Number.isInteger(minQtyParsed) &&
			minQtyParsed >= 0 &&
			minQtyParsed <= MIN_QUANTITY_MAX);
	// Heads-up when the minimum can't currently be met: every active variant
	// hard-blocks on stock and the combined stock sits below the minimum — buyers
	// would be told "minimum N" yet be unable to reach it until a restock.
	const activeRows = editor.rows.filter((row) => row.active);
	const allHardBlock =
		activeRows.length > 0 && activeRows.every((row) => row.blockWhenOutOfStock);
	const totalStock = activeRows.reduce(
		(sum, row) =>
			sum +
			(INT_RE.test(row.stock.trim()) ? Number.parseInt(row.stock, 10) : 0),
		0,
	);
	// Prep window (z8r3fdff97) — blank = none; else whole minutes in
	// [0, MAX_PREP_MINUTES], digits only — the same parser the spreadsheet
	// import uses. The server's sanitizePrepMinutes is the judge; this exists so
	// the seller is told BEFORE the round trip.
	const prepTrimmed = prepDraft.trim();
	const prepText = parsePrepMinutesText(prepDraft);
	const prepValid = prepText.ok;
	const prepParsed = prepText.ok ? (prepText.minutes ?? 0) : 0;
	// A notice of a day or more removes same-day ordering entirely, and prep
	// only ever moves the clock WITHIN today — so the two together leave the
	// prep value inert. Said out loud rather than enforced: a seller loosening
	// notice back to 0 should find their prep window still there.
	const prepInertUnderNotice =
		prepParsed > 0 && Number.parseInt(minNoticeDraft, 10) > 0;
	const pickupNoteLength = pickupNoteDraft.replace(/\s+/g, " ").trim().length;
	const pickupNoteValid = pickupNoteFits(pickupNoteDraft);

	const minQtyStockShort =
		minQtyValid &&
		minQtyParsed >= 2 &&
		allHardBlock &&
		totalStock < minQtyParsed;

	// An event that already has guests may be re-saved on its own past date
	// (the seller fixing a seat cap the morning after) — the same allowance
	// the server makes.
	const eventValid = eventDraftValid(eventDraft, {
		allowPastDate: (eventRsvpCount ?? 0) > 0,
		requireVenue: (eventVenues?.length ?? 0) > 1,
		noVenue: eventVenues !== undefined && eventVenues.length === 0,
	});
	const noticeParsed = Number.parseInt(minNoticeDraft, 10);
	const noticeDays =
		Number.isInteger(noticeParsed) && noticeParsed > 0 ? noticeParsed : 0;
	// Derived from the rows, never stored — the same read the price card uses.
	const madeToOrder = isMadeToOrderOnly(editor);
	// A past event leaves the storefront by itself (`hiddenFromStorefront`).
	const eventValue = eventDraft.on ? eventSubmitValue(eventDraft) : null;
	const eventPassedNow =
		!isBooking && eventValue !== null && isEventPassed(eventValue);

	/** A question row's collapsed line: its answer, unless a save was refused
	 * for something inside it — then it says so, and `focusFirstInvalidField`
	 * opens the first such row. */
	function rowAnswer(
		derived: Answer,
		invalid: boolean,
	): { answer: string; tone: QuestionTone } {
		return submitAttempted && invalid
			? { answer: "Needs a fix before you can save", tone: "error" }
			: { answer: derived.text, tone: derived.tone };
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-5">
			{/* Lead-in: the edit page confirms what the product IS in words; the
			    create path shows what's still needed. */}
			<form.Subscribe selector={(s) => s.values.name}>
				{(name) =>
					isEdit ? (
						<ProductSummaryStrip
							name={name}
							editor={editor}
							currency={currency}
							event={eventSubmitValue(eventDraft)}
							booking={
								isBooking
									? {
											capacityPerNight: capacityDraft,
											packageLength: packageDraft,
											packageUnit,
											autoAccept,
											skipsClosedDays: countsOpenDays,
											maxSkips: countsOpenDays ? maxSkipsDraft : undefined,
											weekendPrice: weekendDraft,
											weekendDays,
										}
									: null
							}
						/>
					) : (
						<ProductReadiness
							hasName={name.trim().length > 0}
							hasPrice={hasAnyPrice}
							imageCount={images.length}
						/>
					)
				}
			</form.Subscribe>

			<ProductStepCard
				icon={<PackageCheck className="size-5" />}
				kicker="The product"
				title="Product basics"
				description="Start with the name shoppers will recognise, then add a short description only if it helps them decide."
			>
				<form.AppField name="name">
					{(field) => (
						<field.TextField
							label="Name"
							placeholder="e.g. Chocolate fudge brownies"
							required
						/>
					)}
				</form.AppField>
				<div className="flex flex-col gap-1.5">
					<form.AppField name="description">
						{(field) => (
							<field.TextareaField
								label="Description"
								placeholder="Optional. Use **bold**, - bullet lists, and ## headings for specs & what's included."
								description="Formatting supported — buyers see it rendered on your storefront."
								maxLength={1000}
							/>
						)}
					</form.AppField>
					<form.Subscribe selector={(s) => s.values.description ?? ""}>
						{(desc) => {
							const trimmed = desc.trim();
							return (
								<div className="flex flex-col gap-1.5">
									<button
										type="button"
										onClick={() => setShowPreview((v) => !v)}
										disabled={trimmed.length === 0}
										className="inline-flex items-center gap-1.5 self-start text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
									>
										<Eye className="size-3.5" aria-hidden />
										{showPreview ? "Hide preview" : "Preview formatting"}
									</button>
									{showPreview && trimmed.length > 0 ? (
										<div className="rounded-xl border border-border bg-muted/30 p-3">
											<Markdown>{desc}</Markdown>
										</div>
									) : null}
								</div>
							);
						}}
					</form.Subscribe>
				</div>
			</ProductStepCard>

			<ProductStepCard
				icon={<Camera className="size-5" />}
				kicker="The product"
				title="Photos"
				description={
					autosaveOn
						? "Photos save as soon as you add, remove or reorder them, so there's no need to tap Save. The first one is your storefront cover."
						: "Use the first image as the storefront cover. Extra images help shoppers compare angles, flavours, sizes, or packaging."
				}
			>
				<ProductImagesField
					images={images}
					onChange={changeImages}
					onUploadStateChange={setPhotoUploads}
					autosaveStatus={autosaveOn ? photoAutosave.status : undefined}
				/>
			</ProductStepCard>

			{isBooking ? (
				// Booking listing: no variant matrix — one implicit row priced per
				// night, capacity beside it. The kind itself is immutable (set at
				// create; archive + recreate is the escape hatch). What DEFINES the
				// stay stays open here; its optional extras are questions below.
				<ProductStepCard
					icon={<Layers3 className="size-5" />}
					kicker="Selling"
					title="Pricing & capacity"
					description={
						packageTrimmed.length > 0
							? `Guests pick a start date on a calendar — set the flat price per ${bookingSpanNoun(packageLengthNum, packageUnit)} and how many bookings can run at once.`
							: "Guests request dates on a calendar — set the per-night price and how many bookings a night can hold."
					}
				>
					{/* Package length leads: it decides what the price MEANS, so asking
					    for the price first left a monthly membership fee sitting under a
					    "Price per night" label. Same order as the create wizard. */}
					<div className="flex flex-col gap-1.5">
						<label htmlFor="booking-package" className="text-sm font-medium">
							Package length{" "}
							<span className="font-normal text-muted-foreground">
								(optional)
							</span>
						</label>
						<div className="flex items-center gap-2">
							<Input
								id="booking-package"
								type="number"
								inputMode="numeric"
								min={1}
								max={packageUnitMax(packageUnit)}
								placeholder="e.g. 30"
								value={packageDraft}
								onChange={(e) => setPackageDraft(e.target.value)}
								variant="field"
								isError={!packageValid}
								className="w-32"
							/>
							<select
								aria-label="Package length unit"
								value={packageUnit}
								onChange={(e) => setPackageUnit(asPackageUnit(e.target.value))}
								className="h-11 rounded-xl border border-input bg-background px-2 text-sm"
							>
								<option value="month">months</option>
								{/* Same span as days; the word is the seller's trade. */}
								<option value="night">nights</option>
								<option value="day">days</option>
							</select>
						</div>
						{!packageValid ? (
							<p className="text-xs text-destructive">
								Enter a whole number of {packageUnit}s between 1 and{" "}
								{packageUnitMax(packageUnit)}, or leave blank.
							</p>
						) : null}
						<p className="text-xs leading-relaxed text-muted-foreground">
							{packageTrimmed.length > 0
								? packageUnit === "month"
									? `Buyers pick a start date only — a booking starting the 12th runs to the 11th, ${bookingSpanCounted(Number(packageTrimmed), "month")} later, at one flat price.`
									: `Buyers pick a start date only — the booking runs ${bookingSpanCounted(Number(packageTrimmed), packageUnit)} from there, at one flat price.`
								: "Leave blank and buyers pick their own check-in and check-out, priced per night. Set it (e.g. 1 month) to sell a fixed-length package at one flat price."}
						</p>
					</div>
					{/* A DAY package decides what a store closure does to it
					    (z8r3fdhpm7) — asked right under the length it counts. */}
					{offersDayCounting && packageLengthNum !== undefined ? (
						<PackageDayCounting
							packageLength={packageLengthNum}
							skipsClosedDays={skipsClosedDays}
							onChange={setSkipsClosedDays}
							maxSkips={maxSkipsDraft}
							onMaxSkipsChange={setMaxSkipsDraft}
							schedule={storeSchedule}
						/>
					) : null}
					<div className="flex flex-col gap-1.5 border-t border-border pt-4">
						<label htmlFor="booking-price" className="text-sm font-medium">
							Price per {bookingSpanNoun(packageLengthNum, packageUnit)} (
							{currencySymbol(currency)})
						</label>
						<Input
							id="booking-price"
							inputMode="decimal"
							placeholder="0.00"
							value={editor.rows[0]?.price ?? ""}
							onChange={(e) =>
								setEditor({
									...editor,
									rows: editor.rows.map((r, i) =>
										i === 0 ? { ...r, price: e.target.value } : r,
									),
								})
							}
							variant="field"
							isError={editorIssues.some(
								(i) => i.where === "row" && i.field === "price",
							)}
							className="w-40"
						/>
						{editorIssues
							.filter((i) => i.where === "row" && i.field === "price")
							.map((i) => (
								<p key={i.message} className="text-xs text-destructive">
									{i.message}
								</p>
							))}
					</div>
					<div className="flex flex-col gap-1.5 border-t border-border pt-4">
						<label htmlFor="booking-capacity" className="text-sm font-medium">
							{packageTrimmed.length > 0
								? "Spots available at a time"
								: "Spots available each night"}{" "}
							<span className="font-normal text-muted-foreground">
								(leave blank for unlimited)
							</span>
						</label>
						<Input
							id="booking-capacity"
							type="number"
							inputMode="numeric"
							min={1}
							max={MAX_CAPACITY_PER_NIGHT}
							value={capacityDraft}
							onChange={(e) => setCapacityDraft(e.target.value)}
							variant="field"
							isError={!capacityValid}
							className="w-32"
						/>
						{!capacityValid ? (
							<p className="text-xs text-destructive">
								Enter a whole number between 1 and {MAX_CAPACITY_PER_NIGHT}, or
								leave blank for unlimited.
							</p>
						) : null}
						<p className="text-xs leading-relaxed text-muted-foreground">
							{capacityTrimmed.length === 0
								? "Anyone can book any date — nothing ever sells out. Right for a gym or class where there's no daily limit."
								: packageTrimmed.length > 0
									? "How many bookings can run at the same time — e.g. 20 members on a package at once. Bookings stop once they're all taken. Lowering it never cancels bookings you've already accepted."
									: "How many bookings can share the same night — e.g. 5 identical plots = 5. Requests stop once a night is full. Lowering it never cancels bookings you've already accepted."}
						</p>
					</div>
				</ProductStepCard>
			) : (
				<ProductStepCard
					icon={<Layers3 className="size-5" />}
					kicker="Selling"
					title="Pricing & choices"
					description="One price for one item — or let buyers pick a size, flavour or weight, each with its own price."
				>
					<VariantEditor
						value={editor}
						onChange={setEditor}
						currency={currency}
						issues={editorIssues}
						weightMode={weightMode}
						liveStock={liveStock}
						productName={liveStock ? form.state.values.name : undefined}
						stockLocked={saveLock !== undefined}
						capabilitiesOutside
						collapseChoices={isEdit}
					/>

					<Link
						to="/app/settings"
						search={{ tab: "store" }}
						className="inline-flex items-center gap-1.5 self-start rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
					>
						<Info className="size-3.5" aria-hidden />
						Currency is set in Settings
					</Link>
				</ProductStepCard>
			)}

			{/* The optional capabilities, each asked as a question whose collapsed
			    line carries its current answer (z8r3fdv1z2). Grouped by MEANING:
			    what the product is or costs, how it is ordered, where it shows.
			    Every row is collapsed on every visit; the answer says what is on.
			    See docs/product-setup-wizard.md#edit--the-question-first-full-form. */}
			<QuestionGroup
				title="Selling options"
				description="All optional. Tap a question to see or change it."
			>
				{/* Weekend rate leads on a stay: it is a PRICE, the base rate's
				    sibling, and most stays never set it — the test for a row. */}
				{isBooking ? (
					<QuestionRow
						id={SPOTLIGHT_ANCHOR.weekend_rate.anchor}
						highlight={ringFor(SPOTLIGHT_ANCHOR.weekend_rate.anchor)}
						defaultOpen={spotlight === "weekend_rate"}
						icon={<CalendarDays />}
						question="Do weekend nights cost more?"
						{...rowAnswer(
							weekendRateAnswer({
								isPackage: packageTrimmed.length > 0,
								weekendPrice: weekendDraft,
								weekendDays,
								basePrice: editor.rows[0]?.price ?? "",
								currency,
							}),
							!weekendValid,
						)}
					>
						{/* Weekend rate (S13) — a second per-night price on the nights the
					    seller picks. Sits right under the base price because it IS a
					    price; hidden on a package, which has one flat price by
					    definition, with the reason stated in its place. */}
						<div className="flex flex-col gap-1.5">
							{packageTrimmed.length > 0 ? (
								<>
									<span className="text-sm font-medium text-muted-foreground">
										Weekend rate
									</span>
									<p className="text-xs leading-relaxed text-muted-foreground">
										A package has one flat price — clear the package length to
										charge weekend nights differently.
									</p>
								</>
							) : (
								<>
									<label
										htmlFor="booking-weekend"
										className="text-sm font-medium"
									>
										Weekend rate ({currencySymbol(currency)}){" "}
										<span className="font-normal text-muted-foreground">
											(optional)
										</span>
									</label>
									<Input
										id="booking-weekend"
										inputMode="decimal"
										placeholder="0.00"
										value={weekendDraft}
										onChange={(e) => setWeekendDraft(e.target.value)}
										variant="field"
										isError={!weekendPriceValid}
										className="w-40"
									/>
									{!weekendPriceValid ? (
										<p className="text-xs text-destructive">
											Enter an amount above 0 and up to 100,000, or leave blank.
										</p>
									) : null}
									{weekendTrimmed.length > 0 ? (
										<div className="flex flex-col gap-1.5 pt-1">
											<span className="text-xs font-medium">
												Which nights charge this rate?
											</span>
											<WeekdayPicker
												label="Weekend nights"
												value={weekendDays}
												onChange={setWeekendDays}
											/>
										</div>
									) : null}
									<p
										className={`text-xs leading-relaxed ${weekendDaysValid ? "text-muted-foreground" : "text-destructive"}`}
									>
										{weekendConsequence ??
											"Leave blank for one rate every night. Set it to charge more on the nights you pick — Fri and Sat by default. Guests see both rates before they pick dates."}
									</p>
								</>
							)}
						</div>
					</QuestionRow>
				) : null}
				{/* Promotion first among the rest: it is the price's sibling and the
				    row a seller touches most. A booking's nightly rate can go on
				    sale too; only the flash extras can't, which the panel says. */}
				<QuestionRow
					id={SPOTLIGHT_ANCHOR.promo.anchor}
					highlight={ringFor(SPOTLIGHT_ANCHOR.promo.anchor)}
					defaultOpen={spotlight === "promo"}
					icon={<Tag />}
					question="Is it on sale right now?"
					badge={promoLocked && !groupedPromotion ? <ProBadge /> : undefined}
					{...rowAnswer(
						promoAnswer({
							draft: promoDraft,
							rows: editor.rows,
							currency,
							locked: promoLocked,
							grouped: groupedPromotion,
							flashAllowed: !isBooking && !eventDraft.on,
							now: Date.now(),
						}),
						invalidSalePrices(editor.rows) > 0 ||
							(!groupedPromotion &&
								!promoDraftValid(promoDraft, Date.now(), editor.rows)),
					)}
				>
					{groupedPromotion ? (
						<GroupedPromotionNote promotion={groupedPromotion} />
					) : null}
					<PromoFields
						draft={groupedPromotion ? { ...promoDraft, on: true } : promoDraft}
						onChange={setPromoDraft}
						noToggle={groupedPromotion ? true : undefined}
						terms={groupedPromotion ? "none" : "edit"}
						rows={promoRows}
						onPromoPrices={setPromoPrices}
						currency={currency}
						locked={promoLocked}
						flashAllowed={!isBooking && !eventDraft.on}
						flashBlockedReason={
							isBooking
								? "Flash-sale extras don't apply to a booking listing — capacity already caps it. The sale price still does."
								: "Flash-sale extras don't apply to an event — seats already cap it. The sale price still does."
						}
						creditBalance={creditBalance}
						now={Date.now()}
					/>
				</QuestionRow>
				{/* Event mode (`z8r3fdff9u`) changes what the product IS (a date, a
				    venue, a seat count, a listing that retires itself), and it
				    overrides the notice/prep rules asked further down. Never on a
				    booking listing: a stay already takes its own dates. */}
				{isBooking ? null : (
					<QuestionRow
						icon={<CalendarClock />}
						question="Is it a fixed-date event?"
						badge={eventsLocked ? <ProBadge /> : undefined}
						{...rowAnswer(
							eventAnswer({
								draft: eventDraft,
								locked: eventsLocked,
								rsvpCount: eventRsvpCount,
								noVenue: eventVenues !== undefined && eventVenues.length === 0,
								now: Date.now(),
							}),
							!eventValid,
						)}
					>
						<EventFields
							draft={eventDraft}
							onChange={setEventDraft}
							locked={eventsLocked}
							rsvpCount={eventRsvpCount}
							venues={eventVenues}
						/>
					</QuestionRow>
				)}
				{/* Custom orders + mockup approval left the price card's "Advanced"
				    box: they are the capabilities that make a product "a certain
				    kind", and a dashed box under the grid hid them. A made-to-order
				    product already IS both, so neither is asked of it. */}
				{isBooking || madeToOrder ? null : (
					<QuestionRow
						icon={<ChefHat />}
						question="Do you take custom requests on it?"
						{...rowAnswer(
							customOrdersAnswer(editor.customLine, currency),
							editorIssues.some((i) => i.where === "custom"),
						)}
					>
						<div className="flex items-start justify-between gap-4">
							<div className="min-w-0">
								<h4 className="text-sm font-semibold leading-tight">
									Offer custom orders
								</h4>
								<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
									{CUSTOM_LINE_COPY.body}
								</p>
							</div>
							<ToggleSwitch
								on={editor.customLine !== null}
								onChange={(on) => {
									if (!on) parkedCustomLine.current = editor.customLine;
									setEditor({
										...editor,
										customLine: on
											? (parkedCustomLine.current ?? {
													label: "",
													price: "",
													prompt: "",
													imageStorageIds: [],
												})
											: null,
									});
								}}
								label="Offer custom orders on this product"
							/>
						</div>
						{editor.customLine ? (
							<CustomLineFields
								line={editor.customLine}
								onChange={(next) => setEditor({ ...editor, customLine: next })}
								currency={currency}
								priceIssue={
									editorIssues.find(
										(i) => i.where === "custom" && i.field === "price",
									)?.message
								}
							/>
						) : null}
					</QuestionRow>
				)}
				{isBooking || madeToOrder ? null : (
					<QuestionRow
						icon={<BadgeCheck />}
						question="Does the buyer approve a mockup first?"
						{...rowAnswer(mockupAnswer(editor.rows), false)}
					>
						<MockupApprovalFields value={editor} onChange={setEditor} />
					</QuestionRow>
				)}
				{isBooking ? (
					<QuestionRow
						icon={<Zap />}
						question="Confirm bookings instantly?"
						{...rowAnswer(instantBookAnswer(autoAccept), false)}
					>
						{/* Instant book (S7) — skip the approval step. */}
						<div className="flex flex-col gap-1.5">
							<div className="flex items-center justify-between gap-3">
								<span className="text-sm font-medium">Instant book</span>
								<ToggleSwitch
									on={autoAccept}
									onChange={setAutoAccept}
									label="Confirm bookings instantly"
								/>
							</div>
							<p className="text-xs leading-relaxed text-muted-foreground">
								{autoAccept
									? "Bookings are confirmed instantly and the payment request goes out straight away. Turn off to approve each request first."
									: "You approve each request before the buyer pays. Turn on to confirm bookings instantly."}
							</p>
						</div>
					</QuestionRow>
				) : null}
				{isBooking ? (
					<QuestionRow
						icon={<ShieldCheck />}
						question="Take a refundable security deposit?"
						{...rowAnswer(depositAnswer(depositDraft, currency), !depositValid)}
					>
						<div className="flex flex-col gap-1.5">
							<label htmlFor="booking-deposit" className="text-sm font-medium">
								Security deposit ({currencySymbol(currency)}){" "}
								<span className="font-normal text-muted-foreground">
									(optional)
								</span>
							</label>
							<Input
								id="booking-deposit"
								inputMode="decimal"
								placeholder="0.00"
								value={depositDraft}
								onChange={(e) => setDepositDraft(e.target.value)}
								variant="field"
								isError={!depositValid}
								className="w-40"
							/>
							{!depositValid ? (
								<p className="text-xs text-destructive">
									{securityDepositRangeMessage(currency)}
								</p>
							) : null}
							<p className="text-xs leading-relaxed text-muted-foreground">
								A refundable hold collected with the booking payment and
								returned after check-out. Guests see it before they request —
								changing it never affects bookings already placed.
							</p>
						</div>
					</QuestionRow>
				) : null}
			</QuestionGroup>

			{/* How a buyer may order it, and what they are asked or told at
			    checkout. Buyer questions lead (they shape the checkout itself);
			    the limits follow; the pickup note — an instruction, not a limit —
			    is last and its own row (Zaki, 16 Oct). */}
			<QuestionGroup title="At checkout">
				{isBooking ? null : (
					<QuestionRow
						icon={<MessageSquareText />}
						question="Do buyers answer any questions?"
						{...rowAnswer(
							buyerQuestionsAnswer(questionsDraft),
							!questionsDraftValid(questionsDraft),
						)}
					>
						<p className="text-xs leading-relaxed text-muted-foreground">
							Up to 3 questions every buyer of this product answers at checkout.
						</p>
						<BuyerQuestionsEditor
							draft={questionsDraft}
							onChange={setQuestionsDraft}
							revealAll={submitAttempted}
						/>
					</QuestionRow>
				)}
				<QuestionRow
					id={SPOTLIGHT_ANCHOR.prep_time.anchor}
					highlight={ringFor(SPOTLIGHT_ANCHOR.prep_time.anchor)}
					defaultOpen={spotlight === "prep_time"}
					icon={isBooking ? <Hourglass /> : <ClipboardList />}
					question={
						isBooking
							? "How much notice do you need?"
							: "Any rules on how it’s ordered?"
					}
					{...rowAnswer(
						isBooking
							? bookingNoticeAnswer(noticeDays)
							: orderRulesAnswer({
									minQuantity: minQtyValid ? minQtyParsed : 0,
									noticeDays,
									prepMinutes: prepParsed,
									isEvent: eventDraft.on,
									heedsWarning: minQtyStockShort
										? "stock_short"
										: !eventDraft.on && prepInertUnderNotice
											? "prep_inert"
											: null,
								}),
						!minQtyValid || (!isBooking && !eventDraft.on && !prepValid),
					)}
				>
					{/* Minimum order quantity (86ey9unyx) — summed across options, so
				    it's a product-level rule, not a per-variant one. Never rendered
				    for a booking listing (one request = one booking). */}
					<div className={isBooking ? "hidden" : "flex flex-col gap-2"}>
						<div className="flex flex-col gap-1.5">
							<label htmlFor="min-order-qty" className="text-sm font-medium">
								Minimum order quantity{" "}
								<span className="font-normal text-muted-foreground">
									(optional)
								</span>
							</label>
							<Input
								id="min-order-qty"
								type="number"
								inputMode="numeric"
								min={0}
								max={MIN_QUANTITY_MAX}
								placeholder="e.g. 20"
								value={minQty}
								onChange={(e) => setMinQty(e.target.value)}
								variant="field"
								isError={!minQtyValid}
								className="w-32"
							/>
						</div>
						<p className="text-xs leading-relaxed text-muted-foreground">
							Buyers must order at least this many per order — options combined
							(10 + 10 of two flavours meets a minimum of 20). Shown on your
							storefront as &ldquo;Min {minQtyParsed >= 2 ? minQtyParsed : "N"}
							&rdquo;. Counter checkout ignores it. Leave blank for no minimum.
						</p>
						{!minQtyValid ? (
							<p className="text-xs text-destructive">
								Enter a whole number between 2 and {MIN_QUANTITY_MAX}, or leave
								blank.
							</p>
						) : null}
						{minQtyStockShort ? (
							<p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
								Heads up: combined stock is {totalStock}, below the minimum of{" "}
								{minQtyParsed} — buyers can&apos;t reach the minimum until you
								restock.
							</p>
						) : null}
					</div>
					{/* On an EVENT the two timing rules disappear rather than sit greyed
				    out: both are dead for the same reason (guests RSVP to the fixed
				    date — no date for notice to push, no time for prep to floor), so
				    two disabled fields would be two things to wonder about where one
				    sentence answers it. Their stored values are cleared on save, so
				    nothing hidden lives on the row. Min quantity and the pickup note
				    stay — both still bind on an RSVP. */}
					{eventDraft.on && !isBooking ? (
						<p className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
							Minimum notice and prep time don&apos;t apply to an event — guests
							RSVP to the fixed date and time you set above, so there&apos;s
							nothing for either rule to move.
						</p>
					) : null}
					{/* Per-product fulfilment notice (made-to-order lead time). Buyers
				    see the effect as a raised earliest-date floor at checkout, which
				    is why the helper spells the interaction out. On a booking listing
				    it's the card's only control — no divider above it. */}
					{eventDraft.on && !isBooking ? null : (
						<div
							className={
								isBooking
									? "flex flex-col gap-2"
									: "flex flex-col gap-2 border-t border-border pt-4"
							}
						>
							<div className="flex flex-col gap-1.5">
								<label
									htmlFor="min-notice-days"
									className="text-sm font-medium"
								>
									Minimum notice{" "}
									<span className="font-normal text-muted-foreground">
										(optional)
									</span>
								</label>
								<div className="flex items-center gap-1.5">
									<Input
										id="min-notice-days"
										type="number"
										inputMode="numeric"
										min={0}
										max={MAX_NOTICE_DAYS}
										value={minNoticeDraft}
										onChange={(e) => setMinNoticeDraft(e.target.value)}
										placeholder="0"
										variant="field"
										className="w-24 text-center"
									/>
									{/* Notice is measured in DAYS, full stop (`minNoticeDays`,
							    `MAX_NOTICE_DAYS`). A copy-paste had left the PACKAGE LENGTH's
							    unit dropdown sitting in this row — bound to `packageUnit`, so a
							    seller adjusting their notice period silently flipped a 1-month
							    membership into a 1-day pass, and on a normal product met a unit
							    the save path drops on the floor. The wizard was swept for this;
							    THIS form was missed — and it is the copy a seller editing a live
							    product actually meets. */}
									<span className="text-sm text-muted-foreground">days</span>
								</div>
							</div>
							<p className="text-xs leading-relaxed text-muted-foreground">
								{isBooking
									? "Days of lead time a booking needs — guests can't request a check-in sooner than this. Leave 0 to allow same-day requests."
									: "Days of lead time this product needs (custom / made-to-order items). Buyers can't pick a delivery or pickup date sooner than this — it raises your store-level notice when higher, and the strictest item in a cart sets the whole order's earliest date. Leave 0 for no extra notice."}
							</p>
						</div>
					)}
					{/* Prep time — notice's hours-scale sibling, so it sits directly
				    under it rather than anywhere else in the card. A booking
				    listing never shows it: request-to-book IS the preparation,
				    and the seller accepts when they're ready. Hidden on an event
				    alongside notice — see the note above the pair. */}
					{isBooking || eventDraft.on ? null : (
						<div className="flex flex-col gap-2 border-t border-border pt-4">
							<div className="flex flex-col gap-1.5">
								<label htmlFor="prep-minutes" className="text-sm font-medium">
									Prep time{" "}
									<span className="font-normal text-muted-foreground">
										(optional)
									</span>
								</label>
								<div className="flex items-center gap-1.5">
									<Input
										id="prep-minutes"
										type="number"
										inputMode="numeric"
										min={0}
										max={MAX_PREP_MINUTES}
										value={prepDraft}
										onChange={(e) => setPrepDraft(e.target.value)}
										placeholder="0"
										variant="field"
										isError={!prepValid}
										className="w-24 text-center"
									/>
									<span className="text-sm text-muted-foreground">minutes</span>
								</div>
								{/* Presets, because the unit is minutes but sellers think in
							    hours — nobody wants to work out that 4 hours is 240.
							    They SET the field rather than replacing it, so a seller
							    who needs 45 can still type it. */}
								<div className="flex flex-wrap gap-1.5 pt-0.5">
									{PREP_PRESETS.map((preset) => {
										const active = prepTrimmed === String(preset.minutes);
										return (
											<button
												key={preset.minutes}
												type="button"
												aria-pressed={active}
												onClick={() =>
													setPrepDraft(active ? "" : String(preset.minutes))
												}
												className={`h-11 rounded-xl border px-3 text-sm transition-colors ${
													active
														? "border-accent bg-accent/10 font-medium text-accent-emphasis"
														: "border-input text-muted-foreground hover:bg-muted"
												}`}
											>
												{preset.label}
											</button>
										);
									})}
								</div>
							</div>
							<p className="text-xs leading-relaxed text-muted-foreground">
								How long you need to make this once an order comes in. Buyers
								can&apos;t pick a pickup or delivery <em>time</em> sooner than
								this, and the longest prep time in a cart sets the whole order.
								Up to 24 hours — for anything longer, use the notice days above.
								Leave blank if it&apos;s ready to hand over. Counter checkout
								ignores it.
							</p>
							{!prepValid ? (
								<p className="text-xs text-destructive">
									Enter a whole number of minutes between 0 and{" "}
									{MAX_PREP_MINUTES}, or leave blank.
								</p>
							) : null}
							{prepInertUnderNotice ? (
								<p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
									Heads up: the minimum notice above already rules out same-day
									orders, and prep time only moves the clock within a day — so
									this won&apos;t change anything until notice is back to 0.
								</p>
							) : null}
						</div>
					)}
				</QuestionRow>
				{isBooking ? null : (
					<QuestionRow
						icon={<MapPin />}
						question="Anything to know when collecting?"
						{...rowAnswer(
							pickupNoteAnswer(pickupNoteDraft, offerSelfCollect),
							!pickupNoteValid,
						)}
					>
						{/* Pickup note — an INSTRUCTION, not a rule, so it comes after the
				    three limits rather than between them. Hidden on a booking
				    listing: convex/bookings.ts writes those orders with
				    deliveryMethod "booking", never self_collect, so a note set
				    here could never reach a guest. An input that can do nothing
				    is worse than an absent one. */}
						{isBooking ? null : (
							<div className="flex flex-col gap-2">
								<div className="flex flex-col gap-1.5">
									<label htmlFor="pickup-note" className="text-sm font-medium">
										Pickup note{" "}
										<span className="font-normal text-muted-foreground">
											(optional)
										</span>
									</label>
									{offerSelfCollect ? (
										<>
											<Textarea
												id="pickup-note"
												value={pickupNoteDraft}
												onChange={(e) => setPickupNoteDraft(e.target.value)}
												placeholder="e.g. Collect from the side counter — bring an ice bag, these melt in 20 minutes."
												className="min-h-20"
												aria-invalid={!pickupNoteValid}
											/>
											<p
												className={`self-end text-xs tabular-nums ${
													pickupNoteValid
														? "text-muted-foreground"
														: "text-destructive"
												}`}
											>
												{pickupNoteLength}/{MAX_PICKUP_NOTE_LENGTH}
											</p>
										</>
									) : (
										// Disabled-with-reason beats a field that quietly isn't there:
										// the seller learns the note exists AND what switches it on.
										<p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground">
											Pickup notes appear once your store offers self-collect.
											Turn it on in Settings &rarr; Fulfilment and this becomes
											editable.
										</p>
									)}
								</div>
								{offerSelfCollect ? (
									<p className="text-xs leading-relaxed text-muted-foreground">
										One line collecting buyers see on the product page, at
										checkout and on their order page — the page their WhatsApp
										confirmation links to. {NOTE_LINK_HINT} It&apos;s copied
										onto each order as it&apos;s placed, so editing it later
										never rewrites what earlier buyers were told.
									</p>
								) : null}
								{!pickupNoteValid ? (
									<p className="text-xs text-destructive">
										Keep it to {MAX_PICKUP_NOTE_LENGTH} characters or fewer.
									</p>
								) : null}
							</div>
						)}
					</QuestionRow>
				)}
			</QuestionGroup>

			{/* Publishing — where the product appears — comes after what the
			    product IS. */}
			<QuestionGroup title="Publishing">
				<QuestionRow
					icon={<Store />}
					question="Where does it show?"
					{...rowAnswer(
						whereAnswer({
							hidden,
							categoryNames: (storeCategories ?? [])
								.filter((c) => categoryIds.includes(c._id))
								.map((c) => c.name),
							storeHasCategories: (storeCategories?.length ?? 0) > 0,
							eventPassed: eventPassedNow,
							allCategoriesHidden:
								categoryIds.length > 0 &&
								storeCategories !== undefined &&
								categoryIds.every(
									(id) =>
										storeCategories.find((c) => c._id === id)?.hidden === true,
								),
						}),
						false,
					)}
				>
					<VisibilityControl hidden={hidden} onChange={setHidden} />
					<div className="border-t border-border pt-4">
						<CategoryPicker
							retailerId={retailerId}
							selectedIds={categoryIds}
							onChange={setCategoryIds}
							locked={categoriesLocked}
							embedded
						/>
					</div>
				</QuestionRow>
			</QuestionGroup>

			{serverError ? (
				<div
					data-form-error
					role="alert"
					className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive"
				>
					<p>{serverError}</p>
					<CreditLockCta lock={serverLock} />
				</div>
			) : saveLock ? (
				<SaveLockNote reason={saveLock.reason} />
			) : null}

			{/* Sticky action bar — on a long form, save must never scroll away.
			    Rare-but-reversible actions (archive/restore) sit beside it as a
			    labelled outline button — an icon alone here read as "delete". */}
			<form.Subscribe
				selector={(s) => ({
					canSubmit: s.canSubmit,
					isSubmitting: s.isSubmitting,
				})}
			>
				{({ canSubmit, isSubmitting }) => {
					// An existing product with nothing unsaved says so in the button
					// itself (z8r3fdtk82), rather than offering a save that changes
					// nothing. It flips back to Save the moment any field moves, and
					// photos that just autosaved leave it reading "saved".
					const nothingToSave = isEdit && !dirty && !isSubmitting;
					// Photos sitting in "Didn't upload" are not saved and Save can't
					// send them (Retry on the tile can) — so the bar says THAT, not
					// "All changes saved" (z8r3fdtk85 /test-code blocker).
					const photosHeld = photosFailed > 0 && !isSubmitting;
					return (
						<div className="sticky bottom-20 z-10 flex gap-2 lg:static">
							{stickyAction}
							<Button
								type="submit"
								disabled={
									!canSubmit ||
									isSubmitting ||
									uploading ||
									saveLock !== undefined ||
									nothingToSave ||
									photosHeld
								}
								className={cn(
									"h-12 flex-1 shadow-lg shadow-accent/20 lg:shadow-none",
									// The resting state of every edit page, so it is not
									// drawn as a half-transparent disabled button: on a phone
									// the bar is sticky, and the form showed through it.
									(nothingToSave || photosHeld) &&
										!saveLock &&
										"bg-muted text-muted-foreground shadow-none disabled:opacity-100",
								)}
							>
								{photosHeld && !saveLock ? (
									<AlertCircle className="size-4" />
								) : nothingToSave && !saveLock ? (
									<CheckCircle2 className="size-4" />
								) : (
									<Save className="size-4" />
								)}
								{isSubmitting
									? "Saving…"
									: saveLock
										? `${submitLabel} — ${saveLock.label}`
										: photosHeld
											? failedPhotosLabel(photosFailed)
											: nothingToSave
												? "All changes saved"
												: submitLabel}
							</Button>
						</div>
					);
				}}
			</form.Subscribe>
		</form>
	);
}

/** The Promotion card's header for a product inside a bulk promotion
 * (z8r3fducfd): which promotion, its terms, and the way to change them —
 * stated where the seller is looking, so the missing window fields read as
 * "owned elsewhere", never as "gone". */
function GroupedPromotionNote({
	promotion,
}: {
	promotion: NonNullable<ProductFormProps["groupedPromotion"]>;
}) {
	const when = (ms: number) =>
		new Date(ms).toLocaleString("en-MY", {
			weekday: "short",
			day: "numeric",
			month: "short",
			hour: "numeric",
			minute: "2-digit",
		});
	return (
		<div className="mb-4 flex flex-col gap-3">
			<div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/8 p-3">
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="text-sm">
						Part of <b>{promotion.label ?? "a promotion"}</b>
					</span>
					<span className="text-xs font-semibold text-accent-emphasis">
						{promotion.percentOff}% off ·{" "}
						{promotion.startsAt !== undefined && promotion.startsAt > Date.now()
							? `starts ${when(promotion.startsAt)}`
							: promotion.endsAt !== undefined
								? `ends ${when(promotion.endsAt)}`
								: "no end date"}
					</span>
				</div>
				<Link
					to="/app/promotions/$promotionId"
					params={{ promotionId: promotion.promotionId }}
					className="tap-target inline-flex shrink-0 items-center px-1 text-[13px] font-semibold text-accent-emphasis hover:underline"
				>
					Edit promotion
				</Link>
			</div>
			<p className="text-xs text-muted-foreground">
				The dates, name and flash extras belong to the promotion and change
				there for every product in it. The sale prices below are this product's
				own — change one, or clear it to keep that line at its normal price.
			</p>
		</div>
	);
}
