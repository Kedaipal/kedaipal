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
