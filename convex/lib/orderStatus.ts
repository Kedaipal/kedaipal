/**
 * Pure order-status label resolver — no Convex imports — so it can be unit
 * tested in isolation and reused from queries, mutations, and the client mirror
 * (`src/lib/orderStatus.ts`). Keep the two files in lockstep.
 *
 * Phase 1 of per-retailer status customization: a retailer can rename the five
 * visible pipeline stages (EN + MS). Unset keys fall back to the
 * delivery-method preset, then the base default. The canonical `status` union
 * on `orders` / `orderEvents` is NOT touched — this is presentation only.
 * See docs/order-status-customization.md.
 */

export type Locale = "en" | "ms";
export type DeliveryMethod = "delivery" | "self_collect";

/** The six canonical statuses a label can be attached to. */
export type OrderStatus =
	| "pending"
	| "confirmed"
	| "packed"
	| "shipped"
	| "delivered"
	| "cancelled";

/** Statuses a seller can transition an order INTO (drives the action buttons). */
export type TransitionTarget = Exclude<OrderStatus, "pending">;

/** Per-locale override map. Any omitted/blank key falls back to defaults. */
export type StatusLabelMap = Partial<Record<OrderStatus, string | undefined>>;

/** Retailer-stored overrides, mirroring the `messageTemplates` shape. */
export type StatusLabels = Partial<Record<Locale, StatusLabelMap>>;

export const ORDER_STATUS_KEYS: ReadonlyArray<OrderStatus> = [
	"pending",
	"confirmed",
	"packed",
	"shipped",
	"delivered",
	"cancelled",
];

/**
 * Per-label cap. Labels render on tracking-timeline pills and dashboard badges
 * that must stay single-line on a 360px screen, so we bound length at the
 * mutation (not just CSS). Generous enough for "Ready for collection" (20).
 */
export const STATUS_LABEL_MAX_LENGTH = 24;

// Base defaults == the delivery wording. These reproduce today's buyer-facing
// tracking-page copy so an unset retailer sees zero change.
const BASE_DEFAULTS: Record<Locale, Record<OrderStatus, string>> = {
	en: {
		pending: "Order Received",
		confirmed: "Confirmed",
		packed: "Packed",
		shipped: "On the Way",
		delivered: "Delivered",
		cancelled: "Cancelled",
	},
	ms: {
		pending: "Pesanan Diterima",
		confirmed: "Disahkan",
		packed: "Dibungkus",
		shipped: "Dalam Perjalanan",
		delivered: "Telah Dihantar",
		cancelled: "Dibatalkan",
	},
};

// Self-collect preset — only the two stages whose wording differs from delivery.
// Everything else falls through to BASE_DEFAULTS.
const SELF_COLLECT_DEFAULTS: Record<Locale, Partial<Record<OrderStatus, string>>> =
	{
		en: {
			shipped: "Ready for Pickup",
			delivered: "Collected",
		},
		ms: {
			shipped: "Sedia Diambil",
			delivered: "Telah Diambil",
		},
	};

// Buttons are imperative; labels are nouns. Most transitions render as
// "Mark as {label}"; confirm/cancel keep dedicated system verbs so we never put
// a bare noun like "Washing" on an action button.
const MARK_AS_PREFIX: Record<Locale, string> = {
	en: "Mark as ",
	ms: "Tanda sebagai ",
};

const SYSTEM_VERBS: Record<Locale, { confirmed: string; cancelled: string }> = {
	en: { confirmed: "Confirm Order", cancelled: "Cancel Order" },
	ms: { confirmed: "Sahkan Pesanan", cancelled: "Batalkan Pesanan" },
};

export type ResolveOpts = {
	labels?: StatusLabels;
	deliveryMethod?: DeliveryMethod;
	locale?: Locale;
};

/**
 * The default (un-overridden) label for a status — self-collect preset wins over
 * the base/delivery default. Exposed so the settings UI can show it as a
 * placeholder.
 */
export function defaultStatusLabel(
	status: OrderStatus,
	deliveryMethod: DeliveryMethod = "delivery",
	locale: Locale = "en",
): string {
	if (deliveryMethod === "self_collect") {
		const preset = SELF_COLLECT_DEFAULTS[locale][status];
		if (preset) return preset;
	}
	return BASE_DEFAULTS[locale][status];
}

/**
 * Resolve the noun label for a status. Precedence:
 *   retailer override (this locale) → delivery-method preset → base default.
 * Blank/whitespace overrides are treated as unset. The override is read from the
 * requested locale only, so a retailer who filled just EN never shows EN labels
 * to an MS buyer — MS falls through to MS defaults.
 */
export function resolveStatusLabel(
	status: OrderStatus,
	opts: ResolveOpts = {},
): string {
	const locale = opts.locale ?? "en";
	const deliveryMethod = opts.deliveryMethod ?? "delivery";
	const override = opts.labels?.[locale]?.[status]?.trim();
	if (override) return override;
	return defaultStatusLabel(status, deliveryMethod, locale);
}

/**
 * Resolve the imperative button copy for a transition. `confirmed`/`cancelled`
 * keep their system verbs; every other target renders as "Mark as {label}",
 * folding in any retailer-renamed stage. Never returns a bare noun.
 */
export function resolveTransitionLabel(
	target: TransitionTarget,
	opts: ResolveOpts = {},
): string {
	const locale = opts.locale ?? "en";
	if (target === "confirmed") return SYSTEM_VERBS[locale].confirmed;
	if (target === "cancelled") return SYSTEM_VERBS[locale].cancelled;
	return MARK_AS_PREFIX[locale] + resolveStatusLabel(target, opts);
}

// ===========================================================================
// Phase 2 — anchored, buyer-visible custom stages
//
// Layer 2 of the two-layer model: a seller defines an ordered list of stages,
// each pinned to ONE canonical anchor. `orders.currentStageId` points at the
// seller's stage; the canonical `orders.status` is DERIVED from the stage's
// anchor (= stage.anchor). The canonical 5-state machine + every gate it drives
// (mockup, carrier-URL, cancel/stock, payment) is untouched — see
// docs/order-status-customization.md. Pure, mirrored in src/lib/orderStatus.ts.
// ===========================================================================

// Stages span the confirmed→delivered band only. `pending` (auto on checkout)
// and `cancelled` (terminal action) are SYSTEM-managed, never seller stages
// (DECISION 3). Array index = monotonic ordinal used for the non-decreasing rule.
export type StageAnchor = "confirmed" | "packed" | "shipped" | "delivered";

export const STAGE_ANCHORS: readonly StageAnchor[] = [
	"confirmed",
	"packed",
	"shipped",
	"delivered",
];

/** Monotonic ordinal of an anchor (confirmed=0 … delivered=3); -1 if invalid. */
export function anchorOrdinal(anchor: StageAnchor): number {
	return STAGE_ANCHORS.indexOf(anchor);
}

/**
 * Friendly "counts as →" labels for the settings anchor dropdown (DECISION 1),
 * so sellers reason in plain milestones, not internal status literals.
 */
export const ANCHOR_UI_LABELS: Record<StageAnchor, string> = {
	confirmed: "Accepted",
	packed: "In production",
	shipped: "Ready",
	delivered: "Done",
};

// Label: `en` required, `ms` optional (falls back to `en` for an MS buyer so a
// seller can fill one language). Description: both optional (buyer-visible).
export type StageLabel = { en: string; ms?: string };
export type StageText = { en?: string; ms?: string };

export type OrderStage = {
	id: string;
	anchor: StageAnchor;
	label: StageLabel;
	description?: StageText;
	notify: boolean;
	sortOrder: number;
};

export const MAX_ORDER_STAGES = 20; // DECISION 5
// Interim cap on how many stages may ping the buyer on WhatsApp, so a seller
// can't rack up messaging cost by enabling notify on many stages. Revisit with
// the WABA rate-limit / tier-cost work.
export const MAX_NOTIFY_STAGES = 5;
// Stage labels render on the same timeline pills as Phase-1 labels, so share the
// single-line cap. Descriptions are a sentence or two of buyer-visible context.
export const STAGE_LABEL_MAX_LENGTH = STATUS_LABEL_MAX_LENGTH;
export const STAGE_DESCRIPTION_MAX_LENGTH = 280;

/** Stable id for a synthesized default stage (not persisted). */
export function defaultStageId(anchor: StageAnchor): string {
	return `default:${anchor}`;
}

/**
 * The 5-default-stages-from-Phase-1 path, but rendered as Layer-2 stages: one
 * stage per band anchor, label resolved through the Phase-1 resolver (so a
 * retailer's `statusLabels` relabel + the delivery/self_collect presets carry
 * straight in). This is THE general model — a retailer who never configures
 * stages flows through the exact same stage code as one who does (no legacy
 * branch). `notify: true` because every default stage is an anchor milestone
 * (DECISION 2).
 */
export function synthesizeDefaultStages(opts: {
	labels?: StatusLabels;
	deliveryMethod?: DeliveryMethod;
}): OrderStage[] {
	return STAGE_ANCHORS.map((anchor, i) => ({
		id: defaultStageId(anchor),
		anchor,
		label: {
			en: resolveStatusLabel(anchor, {
				labels: opts.labels,
				deliveryMethod: opts.deliveryMethod,
				locale: "en",
			}),
			ms: resolveStatusLabel(anchor, {
				labels: opts.labels,
				deliveryMethod: opts.deliveryMethod,
				locale: "ms",
			}),
		},
		notify: true,
		sortOrder: i,
	}));
}

/**
 * The retailer's effective ordered stage list: their configured `orderStages`
 * if any, otherwise the synthesized defaults. Always sorted by `sortOrder`.
 */
export function resolveStages(opts: {
	orderStages?: OrderStage[];
	labels?: StatusLabels;
	deliveryMethod?: DeliveryMethod;
}): OrderStage[] {
	if (opts.orderStages && opts.orderStages.length > 0) {
		return [...opts.orderStages].sort((a, b) => a.sortOrder - b.sortOrder);
	}
	return synthesizeDefaultStages(opts);
}

/** Localized stage label — MS falls back to EN when the seller left MS blank. */
export function stageLabel(stage: OrderStage, locale: Locale = "en"): string {
	if (locale === "ms") {
		const ms = stage.label.ms?.trim();
		if (ms) return ms;
	}
	return stage.label.en;
}

/** Localized stage description, or undefined when none set for either locale. */
export function stageDescription(
	stage: OrderStage,
	locale: Locale = "en",
): string | undefined {
	const d = stage.description;
	if (!d) return undefined;
	const primary = (locale === "ms" ? d.ms : d.en)?.trim();
	if (primary) return primary;
	const fallback = (locale === "ms" ? d.en : d.ms)?.trim();
	return fallback || undefined;
}

/**
 * The stage an order is currently at. Prefers the stored `currentStageId`; for
 * orders that predate stages (or a stage that was later deleted) it derives from
 * the canonical status — the FIRST stage with the matching anchor. Returns
 * undefined for `pending` (not yet in the band) and `cancelled` (terminal,
 * rendered separately).
 */
export function resolveCurrentStage(
	order: { status: OrderStatus; currentStageId?: string },
	stages: OrderStage[],
): OrderStage | undefined {
	if (order.currentStageId) {
		const found = stages.find((s) => s.id === order.currentStageId);
		if (found) return found;
	}
	if (order.status === "pending" || order.status === "cancelled") {
		return undefined;
	}
	return stages.find((s) => s.anchor === order.status);
}

/** Canonical status a stage resolves to (Layer 2 → Layer 1). */
export function stageStatus(stage: OrderStage): OrderStatus {
	return stage.anchor;
}

/**
 * Collect every config problem with a proposed stage list, as buyer-readable
 * messages. Empty array = valid. Pure so the settings UI can show inline errors
 * with the same rules the mutation enforces. (Empty input is "valid" here —
 * callers treat an empty list as "use defaults", handled before validation.)
 */
export function collectStageConfigErrors(stages: OrderStage[]): string[] {
	const errors: string[] = [];
	if (stages.length > MAX_ORDER_STAGES) {
		errors.push(`At most ${MAX_ORDER_STAGES} stages allowed.`);
	}
	const seenIds = new Set<string>();
	for (const s of stages) {
		if (seenIds.has(s.id)) errors.push(`Duplicate stage id "${s.id}".`);
		seenIds.add(s.id);
		if (anchorOrdinal(s.anchor) < 0) {
			errors.push(`Stage "${s.label.en}" has an invalid anchor.`);
		}
		const en = s.label.en?.trim();
		if (!en) {
			errors.push("Every stage needs an English label.");
		} else if (en.length > STAGE_LABEL_MAX_LENGTH) {
			errors.push(`Label "${en}" exceeds ${STAGE_LABEL_MAX_LENGTH} characters.`);
		}
		if ((s.label.ms?.trim().length ?? 0) > STAGE_LABEL_MAX_LENGTH) {
			errors.push(`A Bahasa Malaysia label exceeds ${STAGE_LABEL_MAX_LENGTH} characters.`);
		}
		for (const key of ["en", "ms"] as const) {
			if ((s.description?.[key]?.trim().length ?? 0) > STAGE_DESCRIPTION_MAX_LENGTH) {
				errors.push(
					`A stage description exceeds ${STAGE_DESCRIPTION_MAX_LENGTH} characters.`,
				);
			}
		}
	}
	// Boundary milestones are singular: exactly one "Accepted" (confirmed) and one
	// "Done" (delivered). Multi-stage granularity lives in the middle band; these
	// two are natural single moments (and keep the dashboard advance + confirm-
	// notify logic clean).
	if (stages.filter((s) => s.anchor === "confirmed").length > 1) {
		errors.push(`Only one "${ANCHOR_UI_LABELS.confirmed}" stage is allowed.`);
	}
	if (stages.filter((s) => s.anchor === "delivered").length > 1) {
		errors.push(`Only one "${ANCHOR_UI_LABELS.delivered}" stage is allowed.`);
	}
	// Cap how many stages may WhatsApp the buyer, to bound messaging cost. Confirmed
	// stages never send (the confirm flow owns that moment), so they don't count.
	if (
		stages.filter((s) => s.notify && s.anchor !== "confirmed").length >
		MAX_NOTIFY_STAGES
	) {
		errors.push(
			`At most ${MAX_NOTIFY_STAGES} stages can notify the buyer on WhatsApp.`,
		);
	}
	// Anchors must be monotonically non-decreasing by sortOrder — you can't place
	// an "In production" stage before an "Accepted" one. Skipping anchors and
	// sharing an anchor are both allowed.
	const sorted = [...stages].sort((a, b) => a.sortOrder - b.sortOrder);
	let prev = -1;
	for (const s of sorted) {
		const ord = anchorOrdinal(s.anchor);
		if (ord >= 0 && ord < prev) {
			errors.push(
				"Stages are out of order — a later stage can't count as an earlier milestone than the one before it.",
			);
			break;
		}
		if (ord >= 0) prev = ord;
	}
	return errors;
}

/** Throwing wrapper for the mutation — raises the first config error. */
export function assertValidOrderStages(stages: OrderStage[]): void {
	const errors = collectStageConfigErrors(stages);
	if (errors.length > 0) throw new Error(errors[0]);
}

/**
 * Decide what buyer notification (if any) an advance into `stage` should fire.
 * `stage.notify` is the single source of truth:
 *  - notify=false → nothing;
 *  - `confirmed` anchor → nothing here (the confirm/payment flow owns buyer
 *    comms at confirmation, same as today — avoids a duplicate);
 *  - anchor CROSSING (canonical status changed) → "canonical": reuse the rich
 *    status copy (messageTemplates-aware), zero regression vs Phase 1;
 *  - move WITHIN an anchor (status unchanged) → "stage": generic stage update.
 * Pure so the routing is unit-tested without sending WhatsApp.
 */
export type StageNotifyPlan = "canonical" | "stage" | "none";

export function stageNotifyPlan(args: {
	notify: boolean;
	targetAnchor: StageAnchor;
	statusChanged: boolean;
}): StageNotifyPlan {
	if (!args.notify) return "none";
	if (args.targetAnchor === "confirmed") return "none";
	return args.statusChanged ? "canonical" : "stage";
}

/**
 * Label for a canonical status as shown on dashboard list buckets (orders-page
 * filter tabs, hero stats, row badges). For an anchor status (confirmed/packed/
 * shipped/delivered) it uses the FIRST configured stage with that anchor, so a
 * seller's renamed stages surface on the dashboard too; otherwise (incl.
 * pending/cancelled, or no matching stage) it falls back to the Phase-1
 * `resolveStatusLabel`. Keeps the list at the canonical-bucket grain while
 * speaking the seller's vocabulary.
 */
export function resolveAnchorLabel(
	status: OrderStatus,
	opts: {
		stages?: OrderStage[];
		labels?: StatusLabels;
		deliveryMethod?: DeliveryMethod;
		locale?: Locale;
	} = {},
): string {
	if (status !== "pending" && status !== "cancelled" && opts.stages) {
		const match = opts.stages.find((s) => s.anchor === status);
		if (match) return stageLabel(match, opts.locale ?? "en");
	}
	return resolveStatusLabel(status, {
		labels: opts.labels,
		deliveryMethod: opts.deliveryMethod,
		locale: opts.locale,
	});
}
