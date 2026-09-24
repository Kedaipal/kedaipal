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

/**
 * The order FLOW KINDS — one entry per fulfilment story the status pipeline
 * can tell (`z8r3fdff9u` made this a registry). "delivery" / "self_collect"
 * are stored on `orders.deliveryMethod`; "booking" is too (a booking order is
 * born with it); "event" is DERIVED — an RSVP is stored `self_collect` (it is
 * collected at the venue) and carries the frozen `orders.eventRsvp` marker
 * instead. Derive with `orderFlowKind`, never by re-reading products.
 *
 * Adding a kind = one entry in `FLOW_PRESETS` (labels, skipped anchors,
 * whether seller-configured stages apply) — nothing else forks.
 */
export type OrderFlowKind = "delivery" | "self_collect" | "booking" | "event";

/** Historical name — the stage resolvers grew out of the delivery-method
 * presets, and ~20 call sites annotate with it. Same union. */
export type DeliveryMethod = OrderFlowKind;

/** The flow kind of one order row. Order matters: an RSVP is stored
 * `self_collect`, so the event marker outranks the delivery method. */
export function orderFlowKind(order: {
	deliveryMethod?: string;
	eventRsvp?: boolean;
}): OrderFlowKind {
	if (order.eventRsvp) return "event";
	if (order.deliveryMethod === "booking") return "booking";
	if (order.deliveryMethod === "self_collect") return "self_collect";
	return "delivery";
}

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

// Event RSVP preset (`z8r3fdff9u`) — a guest RSVPs, then turns up. Only the
// terminal stage needs its own word: "Delivered"/"Collected" imply goods
// changing hands, and what actually happens is the guest walking in. ZH uses
// the event sign-in word (已签到), not the lodging check-in (已入住).
const EVENT_DEFAULTS: Record<Locale, Partial<Record<OrderStatus, string>>> = {
	en: {
		delivered: "Checked In",
	},
	ms: {
		delivered: "Daftar Masuk",
	},
	zh: {
		delivered: "已签到",
	},
};

/** What one flow kind does to the shared pipeline. THE place a new kind
 * registers itself — every resolver below reads from here. */
type FlowPreset = {
	/** Label overrides on the base (delivery) wording, per locale. */
	labels: Record<Locale, Partial<Record<OrderStatus, string>>>;
	/** Anchors this kind's SYNTHESIZED default pipeline leaves out — a stay is
	 * never "Packed", an RSVP is never "Packed" or "Ready for Pickup".
	 *
	 * This is the SEED for the defaults, not a prohibition (`z8r3fdh3w1`).
	 * Stages are configured per kind now, so a campsite that deliberately adds
	 * a "Site prepared" step anchored to `packed` gets it. What bulk actions
	 * refuse is an anchor no stage in THAT order's resolved list carries —
	 * see `hasAnchor`. */
	skippedAnchors: readonly StageAnchor[];
	/** LEGACY — deleted at the narrow (`z8r3fdh3w1`). Whether the retailer's
	 * pre-`orderFlows` GLOBAL `statusLabels` renames and flat `orderStages`
	 * list may speak for this kind. True for exactly the pair those fields
	 * could ever have meant: `delivery` + `self_collect`, the only kinds the
	 * seller could see when they wrote them.
	 *
	 * This one flag is the bug fix. Before it, a store that renamed Confirmed
	 * to "Ok go" saw "Ok go" on its campsite bookings, because the rename
	 * outranked every kind's own vocabulary and no screen could clear it. */
	takesLegacyLabels: boolean;
};

const NO_OVERRIDES: Record<Locale, Partial<Record<OrderStatus, string>>> = {
	en: {},
	ms: {},
	zh: {},
};

export const FLOW_PRESETS: Record<OrderFlowKind, FlowPreset> = {
	delivery: {
		labels: NO_OVERRIDES,
		skippedAnchors: [],
		takesLegacyLabels: true,
	},
	self_collect: {
		labels: SELF_COLLECT_DEFAULTS,
		skippedAnchors: [],
		takesLegacyLabels: true,
	},
	// `bookingPackaged` swaps in BOOKING_PACKAGE_DEFAULTS at resolve time — a
	// modifier on the booking kind, not a fifth kind (a package is still a
	// booking everywhere else: same request flow, same calendar). A seller who
	// customises the booking flow customises it for stays AND packages: one
	// card, one answer, and the settings copy says so.
	booking: {
		labels: BOOKING_DEFAULTS,
		skippedAnchors: ["packed"],
		takesLegacyLabels: false,
	},
	event: {
		labels: EVENT_DEFAULTS,
		skippedAnchors: ["packed", "shipped"],
		takesLegacyLabels: false,
	},
};

/** Display order for the per-kind settings cards + any other kind-grain list.
 * Product flows first (what most stores live in), then the booked kinds. */
export const FLOW_KINDS: readonly OrderFlowKind[] = [
	"delivery",
	"self_collect",
	"booking",
	"event",
];

/** Seller-facing name for a flow kind, and the one-line "what is this" the
 * settings card shows under it. Lives beside the registry so a new kind
 * declares its wording in the same place as its behaviour. */
export const FLOW_KIND_UI: Record<
	OrderFlowKind,
	{ name: string; short: string; blurb: string }
> = {
	delivery: {
		name: "Delivery orders",
		short: "delivery",
		blurb: "Orders you send out to the buyer.",
	},
	self_collect: {
		name: "Pickup orders",
		short: "pickup",
		blurb: "Orders the buyer collects from you.",
	},
	booking: {
		name: "Bookings",
		short: "booking",
		blurb: "Stays and fixed-length packages.",
	},
	event: {
		name: "Event RSVPs",
		short: "event RSVP",
		blurb: "Guests who reserved a spot at an event.",
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
	/** The per-kind config, read ONLY to answer "has this kind been answered?".
	 * An entry — including an empty one from "Reset to defaults" — retires the
	 * LEGACY rename map for that kind. Without this, a reset cleared the stage
	 * list and left the rename speaking, so the card read DEFAULT above the
	 * seller's own word and the confirm dialog promised a reset it didn't do. */
	orderFlows?: OrderFlows;
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
	const flowLabels =
		deliveryMethod === "booking" && bookingPackaged
			? BOOKING_PACKAGE_DEFAULTS
			: FLOW_PRESETS[deliveryMethod].labels;
	return flowLabels[locale][status] ?? BASE_DEFAULTS[locale][status];
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
	// LEGACY renames speak only for a kind that (a) could ever have meant them
	// and (b) has not answered for itself yet (`z8r3fdh3w1`). Gating here rather
	// than at the ~8 call sites is the whole point: every surface that resolves
	// a label — inbox chip, stepper, advance CTA, Home, /track, the settings
	// card — is fixed by this one place, and a future call site cannot
	// reintroduce the leak.
	//
	// Condition (b) is what makes "Reset to defaults" true. A reset writes an
	// EMPTY entry, which retires the whole legacy map for that kind rather than
	// only its stage list. Found by testing: the reset flipped the badge to
	// DEFAULT and the toast said so, while the chain still read the seller's
	// "Ok go" — a store could not clear the rename at all.
	if (legacyLabelsApply(opts.orderFlows, deliveryMethod)) {
		const override = opts.labels?.[locale]?.[status]?.trim();
		if (override) return override;
	}
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
 * Per-flow-kind stage configuration — THE home for a seller's own words
 * (`z8r3fdh3w1`). One key per `OrderFlowKind`; a key's value is that kind's
 * ordered stage list.
 *
 * Three states, and the distinction between the last two is load-bearing:
 *   - key ABSENT       — the seller has not answered for this kind. Falls
 *                        through to the LEGACY flat list (delivery/pickup
 *                        only), then to the kind's preset.
 *   - key = `[]`       — "Reset to defaults". An explicit answer, so it BEATS
 *                        the legacy fallback: a seller who resets pickup must
 *                        not silently get their old flat list back.
 *   - key = `[...]`    — this kind's custom flow.
 *
 * Replaces the global `retailers.statusLabels` + flat `retailers.orderStages`
 * pair, which were one set of words for every kind at once. A rename IS a
 * one-stage-per-anchor list (docs/order-status-customization.md), so renames
 * and custom steps are the SAME mechanism here — there is no second rename
 * field to keep in sync, and nothing a seller cannot see and clear.
 */
export type OrderFlows = Partial<Record<OrderFlowKind, OrderStage[]>>;

/**
 * The stage list a kind is CONFIGURED with — empty when it has no answer and
 * should fall through to its preset defaults.
 *
 * The one place the three-state rule above lives. Every resolver goes through
 * it, so "does an empty array mean reset or mean nothing?" is answered once.
 */
export function configuredStages(
	orderFlows: OrderFlows | undefined,
	legacyStages: OrderStage[] | undefined,
	kind: OrderFlowKind = "delivery",
): OrderStage[] {
	const own = orderFlows?.[kind];
	if (own !== undefined) return own;
	// LEGACY (deleted at the narrow): the flat list could only ever have meant
	// the product kinds, so it never speaks for a booking or an RSVP again.
	if (FLOW_PRESETS[kind].takesLegacyLabels && legacyStages) return legacyStages;
	return [];
}

/**
 * Whether the LEGACY global rename map may still speak for a kind.
 *
 * Two conditions, and the second is the one a reset turns off:
 *   1. the kind could ever have meant it (delivery / self_collect only), and
 *   2. the kind has NOT answered for itself — no `orderFlows[kind]` entry.
 *
 * `[]` counts as an answer, so "Reset to defaults" clears the rename too. That
 * covers `pending` and `cancelled`, which are system-managed and cannot be
 * stages: they are the seller's words too, and leaving them behind would keep
 * exactly the unclearable remnant this ticket exists to remove.
 */
export function legacyLabelsApply(
	orderFlows: OrderFlows | undefined,
	kind: OrderFlowKind = "delivery",
): boolean {
	return (
		FLOW_PRESETS[kind].takesLegacyLabels && orderFlows?.[kind] === undefined
	);
}

/** Whether a kind is running the seller's own flow rather than its preset.
 * Drives the Default / Customised state on each settings card. */
export function isFlowCustomised(
	orderFlows: OrderFlows | undefined,
	legacyStages: OrderStage[] | undefined,
	kind: OrderFlowKind = "delivery",
): boolean {
	return configuredStages(orderFlows, legacyStages, kind).length > 0;
}

/** Whether two stage lists say the same thing to a buyer — same anchors, same
 * words, same order. Used to tell a seller "Pickup currently matches delivery"
 * instead of making them read two lists side by side. */
export function sameStages(a: OrderStage[], b: OrderStage[]): boolean {
	if (a.length !== b.length) return false;
	const key = (s: OrderStage) =>
		JSON.stringify([
			s.anchor,
			s.label.en?.trim() ?? "",
			s.label.ms?.trim() ?? "",
			s.label.zh?.trim() ?? "",
			s.description?.en?.trim() ?? "",
			s.description?.ms?.trim() ?? "",
			s.description?.zh?.trim() ?? "",
		]);
	const sa = [...a].sort((x, y) => x.sortOrder - y.sortOrder).map(key);
	const sb = [...b].sort((x, y) => x.sortOrder - y.sortOrder).map(key);
	return sa.every((v, i) => v === sb[i]);
}

/** Whether a resolved stage list can hold an order at this anchor. THE rule
 * bulk actions refuse on: not "does this kind skip the anchor by default", but
 * "is there a stage to land on in the flow THIS order actually runs" — which
 * stays correct now that a seller can add a `packed` step to a booking. */
export function hasAnchor(stages: OrderStage[], anchor: StageAnchor): boolean {
	return stages.some((s) => s.anchor === anchor);
}

/**
 * The preset pipeline for a flow kind, rendered as Layer-2 stages: one stage
 * per anchor the kind uses, label resolved through the Phase-1 resolver (so
 * the delivery / self_collect / booking / event presets carry straight in, and
 * — until the narrow — a LEGACY rename does too, but only for the kinds that
 * take it). This is THE general model: a retailer who never configures stages
 * flows through the exact same stage code as one who does (no legacy branch).
 */
export function synthesizeDefaultStages(opts: {
	labels?: StatusLabels;
	/** Passed through so the legacy-rename gate sees whether this kind has
	 * answered — a reset must synthesize the PRESET, not the old rename. */
	orderFlows?: OrderFlows;
	deliveryMethod?: DeliveryMethod;
	bookingPackaged?: boolean;
}): OrderStage[] {
	// Each flow kind leaves out the anchors that would lie about it — a stay is
	// never "Packed", an RSVP is never "Packed" or "Ready for Pickup"
	// (Confirmed → Checked In is its whole story). Registry-driven, so a new
	// kind declares its skips in FLOW_PRESETS and this code never forks. These
	// are the DEFAULTS only: a seller may add such a step deliberately.
	const skipped =
		FLOW_PRESETS[opts.deliveryMethod ?? "delivery"].skippedAnchors;
	const anchors = STAGE_ANCHORS.filter((anchor) => !skipped.includes(anchor));
	return anchors.map((anchor, i) => ({
		id: defaultStageId(anchor),
		anchor,
		label: {
			en: resolveStatusLabel(anchor, {
				labels: opts.labels,
				orderFlows: opts.orderFlows,
				deliveryMethod: opts.deliveryMethod,
				bookingPackaged: opts.bookingPackaged,
				locale: "en",
			}),
			ms: resolveStatusLabel(anchor, {
				labels: opts.labels,
				orderFlows: opts.orderFlows,
				deliveryMethod: opts.deliveryMethod,
				bookingPackaged: opts.bookingPackaged,
				locale: "ms",
			}),
			// ZH defaults exist in BASE_DEFAULTS/the presets but were never
			// synthesized, so a 中文 store's timeline fell back to the English
			// stage names it had no reason to. Filled here rather than left for
			// `stageLabel`'s EN fallback to paper over.
			zh: resolveStatusLabel(anchor, {
				labels: opts.labels,
				orderFlows: opts.orderFlows,
				deliveryMethod: opts.deliveryMethod,
				bookingPackaged: opts.bookingPackaged,
				locale: "zh",
			}),
		},
		sortOrder: i,
	}));
}

/**
 * The retailer's effective ordered stage list FOR ONE ORDER'S FLOW KIND: that
 * kind's configured stages if it has any, otherwise the kind's synthesized
 * preset. Always sorted by `sortOrder`.
 *
 * Every kind takes custom stages now (`z8r3fdh3w1`). Bookings and RSVPs used
 * to be exempt wholesale, because there was ONE list for the whole store and
 * applying a cake shop's "Baking → Decorating → Ready" to a campsite stay was
 * worse than ignoring it. Per-kind config removes that reason: a campsite that
 * wants "Confirmed → Site prepared → Checked in → Checked out" is describing
 * its own flow, not inheriting someone else's. What no longer happens is one
 * kind's words reaching another.
 */
export function resolveStages(opts: {
	/** Per-kind config — the home for a seller's own words. */
	orderFlows?: OrderFlows;
	/** LEGACY flat list, read only for `delivery`/`self_collect` and only when
	 * `orderFlows` has no answer for the kind. Deleted at the narrow. */
	orderStages?: OrderStage[];
	/** LEGACY global renames, same rule. Deleted at the narrow. */
	labels?: StatusLabels;
	deliveryMethod?: DeliveryMethod;
	bookingPackaged?: boolean;
}): OrderStage[] {
	const configured = configuredStages(
		opts.orderFlows,
		opts.orderStages,
		opts.deliveryMethod ?? "delivery",
	);
	if (configured.length > 0) {
		return [...configured].sort((a, b) => a.sortOrder - b.sortOrder);
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
		/** Same passthrough as everywhere else — the fallback below resolves a
		 * label, so it needs the gate too. */
		orderFlows?: OrderFlows;
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
		orderFlows: opts.orderFlows,
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
	order: { status: OrderStatus; source?: string; eventRsvp?: boolean },
	resolved: string,
	locale: Locale = "en",
): string {
	// A walk-in RSVP is NOT complete at the counter — the guest still attends
	// later, so its terminal state stays the event vocabulary ("Checked In").
	if (
		order.source === "counter" &&
		order.status === "delivered" &&
		!order.eventRsvp
	) {
		return COUNTER_COMPLETED_LABEL[locale];
	}
	return resolved;
}
