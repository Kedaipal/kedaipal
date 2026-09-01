/**
 * Order-status label resolver for the client (storefront tracking page +
 * dashboard).
 *
 * IMPORTANT: Keep in sync with `convex/lib/orderStatus.ts`. Both files must stay
 * identical in logic — they exist separately because Convex functions bundle
 * from the `convex/` directory and the frontend bundles from `src/`. (Same
 * convention as `convex/lib/customer.ts` ↔ `src/lib/customer.ts`.)
 *
 * Phase 1 of per-retailer status customization: a retailer can rename the five
 * visible pipeline stages (EN + MS). Unset keys fall back to the
 * delivery-method preset, then the base default. The canonical `status` union
 * on `orders` / `orderEvents` is NOT touched — this is presentation only.
 * See docs/order-status-customization.md.
 */

import { LOCALES, type Locale } from "../../convex/lib/locale";

export type { Locale } from "../../convex/lib/locale";

export type DeliveryMethod = "delivery" | "self_collect" | "booking";

/** The six canonical statuses a label can be attached to. */
export type OrderStatus =
	| "pending"
	// Booking kind's request state (86eyj70z1) — mirrored from the convex twin.
	| "booking_requested"
	| "confirmed"
	| "packed"
	| "shipped"
	| "delivered"
	| "cancelled";

/** Statuses a seller can transition an order INTO (drives the action buttons).
 * `booking_requested` is excluded like `pending` — approve/decline are its
 * only exits, never the stepper. */
export type TransitionTarget = Exclude<
	OrderStatus,
	"pending" | "booking_requested"
>;

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
		booking_requested: "Awaiting Approval",
		confirmed: "Confirmed",
		packed: "Packed",
		shipped: "On the Way",
		delivered: "Delivered",
		cancelled: "Cancelled",
	},
	ms: {
		pending: "Pesanan Diterima",
		booking_requested: "Menunggu Kelulusan",
		confirmed: "Disahkan",
		packed: "Dibungkus",
		shipped: "Dalam Perjalanan",
		delivered: "Telah Dihantar",
		cancelled: "Dibatalkan",
	},
	zh: {
		pending: "订单已收到",
		booking_requested: "等待批准",
		confirmed: "已确认",
		packed: "已打包",
		shipped: "配送中",
		delivered: "已送达",
		cancelled: "已取消",
	},
};

// Self-collect preset — only the two stages whose wording differs from delivery.
// Everything else falls through to BASE_DEFAULTS.
const SELF_COLLECT_DEFAULTS: Record<
	Locale,
	Partial<Record<OrderStatus, string>>
> = {
	en: {
		shipped: "Ready for Pickup",
		delivered: "Collected",
	},
	ms: {
		shipped: "Sedia Diambil",
		delivered: "Telah Diambil",
	},
	zh: {
		shipped: "可以自取",
		delivered: "已领取",
	},
};

// Booking preset — a stay's lifecycle in stay words. Only the two stages whose
// delivery wording would lie ("On the Way"/"Delivered" for a campsite stay);
// packed is skipped by the booking stepper entirely (S3).
const BOOKING_DEFAULTS: Record<Locale, Partial<Record<OrderStatus, string>>> = {
	en: {
		shipped: "Checked In",
		delivered: "Checked Out",
	},
	ms: {
		shipped: "Daftar Masuk",
		delivered: "Daftar Keluar",
	},
	zh: {
		shipped: "已入住",
		delivered: "已退房",
	},
};

// Booking PACKAGE preset (S7) — a fixed-length membership, not a stay. A gym
// member doesn't check in on day 1 and check out on day 30: the period starts
// and ends, and they walk in twenty times in between. "Mark as Checked Out" on
// a monthly membership is simply the wrong verb. "Active" is also the word S8
// uses for the inbox bucket these orders land in, so the two line up.
const BOOKING_PACKAGE_DEFAULTS: Record<
	Locale,
	Partial<Record<OrderStatus, string>>
> = {
	en: {
		shipped: "Active",
		delivered: "Ended",
	},
	ms: {
		shipped: "Aktif",
		delivered: "Tamat",
	},
	zh: {
		shipped: "生效中",
		delivered: "已结束",
	},
};

// Buttons are imperative; labels are nouns. Most transitions render as
// "Mark as {label}"; confirm/cancel keep dedicated system verbs so we never put
// a bare noun like "Washing" on an action button.
const MARK_AS_PREFIX: Record<Locale, string> = {
	en: "Mark as ",
	ms: "Tanda sebagai ",
	zh: "标记为 ",
};

const SYSTEM_VERBS: Record<Locale, { confirmed: string; cancelled: string }> = {
	en: { confirmed: "Confirm Order", cancelled: "Cancel Order" },
	ms: { confirmed: "Sahkan Pesanan", cancelled: "Batalkan Pesanan" },
	zh: { confirmed: "确认订单", cancelled: "取消订单" },
};

export type ResolveOpts = {
	labels?: StatusLabels;
	deliveryMethod?: DeliveryMethod;
	locale?: Locale;
	/** Booking orders only — this one is a fixed-length PACKAGE (S7), so its
	 * milestones read "Active / Ended" rather than "Checked In / Checked Out".
	 * Comes off `orders.bookingPackaged`. */
	bookingPackaged?: boolean;
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
	bookingPackaged = false,
): string {
	if (deliveryMethod === "self_collect") {
		const preset = SELF_COLLECT_DEFAULTS[locale][status];
		if (preset) return preset;
	}
	if (deliveryMethod === "booking") {
		const preset = (
			bookingPackaged ? BOOKING_PACKAGE_DEFAULTS : BOOKING_DEFAULTS
		)[locale][status];
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
	return defaultStatusLabel(
		status,
		deliveryMethod,
		locale,
		opts.bookingPackaged,
	);
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

// Label: `en` required, `ms`/`zh` optional (fall back to `en` for a buyer whose
// locale the seller left blank so a seller can fill just one language).
// Description: all three optional (buyer-visible).
export type StageLabel = { en: string; ms?: string; zh?: string };
export type StageText = { en?: string; ms?: string; zh?: string };

export type OrderStage = {
	id: string;
	anchor: StageAnchor;
	label: StageLabel;
	description?: StageText;
	sortOrder: number;
};

export const MAX_ORDER_STAGES = 20; // DECISION 5
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
 * branch).
 */
export function synthesizeDefaultStages(opts: {
	labels?: StatusLabels;
	deliveryMethod?: DeliveryMethod;
	bookingPackaged?: boolean;
}): OrderStage[] {
	// A booking's default flow is Confirmed → Checked In → Checked Out (or
	// Confirmed → Active → Ended for a fixed-length package) — "Packed" is
	// meaningless either way, so the synthesized route skips that anchor. This is
	// now THE route for every booking: `resolveStages` never hands one a
	// seller's configured stages.
	const anchors =
		opts.deliveryMethod === "booking"
			? STAGE_ANCHORS.filter((anchor) => anchor !== "packed")
			: STAGE_ANCHORS;
	return anchors.map((anchor, i) => ({
		id: defaultStageId(anchor),
		anchor,
		label: {
			en: resolveStatusLabel(anchor, {
				labels: opts.labels,
				deliveryMethod: opts.deliveryMethod,
				bookingPackaged: opts.bookingPackaged,
				locale: "en",
			}),
			ms: resolveStatusLabel(anchor, {
				labels: opts.labels,
				deliveryMethod: opts.deliveryMethod,
				bookingPackaged: opts.bookingPackaged,
				locale: "ms",
			}),
		},
		sortOrder: i,
	}));
}

/**
 * The retailer's effective ordered stage list: their configured `orderStages`
 * if any, otherwise the synthesized defaults. Always sorted by `sortOrder`.
 *
 * **Bookings never take configured stages.** Custom stages describe how a
 * seller PREPARES something — "Baking → Decorating → Ready" — which is exactly
 * why made-to-order keeps them. A stay or a membership isn't prepared; it is
 * booked, occupied and finished, and the booking route already has the right
 * three milestones. Without this gate the short-circuit below fired for every
 * order the moment a seller configured anything, so a campsite booking
 * inherited "Packed" from a cake shop's flow and the booking-aware branch in
 * `synthesizeDefaultStages` became unreachable for exactly the sellers who had
 * touched the setting. Surfaced to the seller in the Order stages settings
 * card, so the exemption isn't silent.
 */
export function resolveStages(opts: {
	orderStages?: OrderStage[];
	labels?: StatusLabels;
	deliveryMethod?: DeliveryMethod;
	bookingPackaged?: boolean;
}): OrderStage[] {
	if (
		opts.deliveryMethod !== "booking" &&
		opts.orderStages &&
		opts.orderStages.length > 0
	) {
		return [...opts.orderStages].sort((a, b) => a.sortOrder - b.sortOrder);
	}
	return synthesizeDefaultStages(opts);
}

/**
 * Localized stage label — a non-EN locale left blank by the seller falls back
 * to EN (the one required field). Exhaustive over `LOCALES`, so a 4th locale
 * needs no change here.
 */
export function stageLabel(stage: OrderStage, locale: Locale = "en"): string {
	if (locale !== "en") {
		const localized = stage.label[locale]?.trim();
		if (localized) return localized;
	}
	return stage.label.en;
}

/**
 * Localized stage description, or undefined when none set in any locale.
 * Fallback order is [requested locale, …every other locale] — e.g. a ZH buyer
 * sees a ZH-only description if set, else falls through to EN, then MS. This
 * generalizes the original EN⇄MS fallback pair to `LOCALES` so a future
 * locale needs no change here.
 */
export function stageDescription(
	stage: OrderStage,
	locale: Locale = "en",
): string | undefined {
	const d = stage.description;
	if (!d) return undefined;
	const order: Locale[] = [locale, ...LOCALES.filter((l) => l !== locale)];
	for (const l of order) {
		const value = d[l]?.trim();
		if (value) return value;
	}
	return undefined;
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
		// Trust the stored stage only if it hasn't fallen BEHIND the canonical
		// status. Transitions that bypass the stepper — the Lalamove webhook,
		// payment auto-confirm — advance `status` without moving `currentStageId`,
		// leaving the stored stage stale (e.g. status `delivered`, stage still
		// `packed`). When that happens the status wins. Custom stages sharing the
		// current anchor are still honoured (equal ordinal). `pending`/`cancelled`
		// aren't anchors → anchorOrdinal is -1, so the stored stage is kept,
		// preserving prior behaviour for those.
		if (
			found &&
			anchorOrdinal(found.anchor) >= anchorOrdinal(order.status as StageAnchor)
		) {
			return found;
		}
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
			errors.push(
				`Label "${en}" exceeds ${STAGE_LABEL_MAX_LENGTH} characters.`,
			);
		}
		if ((s.label.ms?.trim().length ?? 0) > STAGE_LABEL_MAX_LENGTH) {
			errors.push(
				`A Bahasa Malaysia label exceeds ${STAGE_LABEL_MAX_LENGTH} characters.`,
			);
		}
		if ((s.label.zh?.trim().length ?? 0) > STAGE_LABEL_MAX_LENGTH) {
			errors.push(`A 中文 label exceeds ${STAGE_LABEL_MAX_LENGTH} characters.`);
		}
		for (const key of LOCALES) {
			if (
				(s.description?.[key]?.trim().length ?? 0) >
				STAGE_DESCRIPTION_MAX_LENGTH
			) {
				errors.push(
					`A stage description exceeds ${STAGE_DESCRIPTION_MAX_LENGTH} characters.`,
				);
			}
		}
	}
	// Boundary milestones are singular: exactly one "Accepted" (confirmed) and one
	// "Done" (delivered). Multi-stage granularity lives in the middle band; these
	// two are natural single moments (and keep the dashboard advance logic
	// clean).
	if (stages.filter((s) => s.anchor === "confirmed").length > 1) {
		errors.push(`Only one "${ANCHOR_UI_LABELS.confirmed}" stage is allowed.`);
	}
	if (stages.filter((s) => s.anchor === "delivered").length > 1) {
		errors.push(`Only one "${ANCHOR_UI_LABELS.delivered}" stage is allowed.`);
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

/**
 * Seller-facing display override for a resolved status label. A Counter Checkout
 * sale (`source === "counter"`) completes at the counter — there was no delivery
 * or collection step — so its terminal `delivered` status reads "Completed",
 * never "Delivered"/"Collected" (which imply a fulfilment leg that never
 * happened, and confuse a walk-in seller). Presentation only: the canonical
 * `delivered` status is unchanged. Returns `resolved` untouched for every other
 * order. See ClickUp 86ey8r734. NOTE: keep in sync with convex/lib/orderStatus.ts.
 */
const COUNTER_COMPLETED_LABEL: Record<Locale, string> = {
	en: "Completed",
	ms: "Selesai",
	zh: "已完成",
};

export function displayStatusLabel(
	order: { status: OrderStatus; source?: string },
	resolved: string,
	locale: Locale = "en",
): string {
	if (order.source === "counter" && order.status === "delivered") {
		return COUNTER_COMPLETED_LABEL[locale];
	}
	return resolved;
}
