import { describe, expect, test } from "vitest";
import {
	defaultStatusLabel,
	type OrderStatus,
	resolveStatusLabel,
	type ResolveOpts,
	resolveTransitionLabel,
	type StatusLabels,
	type TransitionTarget,
} from "./orderStatus";

// Shared case table — kept identical in src/lib/orderStatus.test.ts so the two
// mirrored resolvers can never silently drift. Edit both together.
const EN_ONLY: StatusLabels = {
	en: { shipped: "Out for delivery", packed: "  ", delivered: "" },
};
const BOTH_LOCALES: StatusLabels = {
	en: { shipped: "Ready @ store" },
	ms: { shipped: "Sedia di kedai" },
};

type LabelCase = {
	name: string;
	status: OrderStatus;
	opts: ResolveOpts;
	expected: string;
};

const LABEL_CASES: LabelCase[] = [
	// Retailer override wins.
	{
		name: "override wins over preset + base",
		status: "shipped",
		opts: { labels: EN_ONLY, deliveryMethod: "self_collect", locale: "en" },
		expected: "Out for delivery",
	},
	// Delivery-method preset fallback (no override on this key).
	{
		name: "self_collect preset fallback when unset",
		status: "shipped",
		opts: { deliveryMethod: "self_collect", locale: "en" },
		expected: "Ready for Pickup",
	},
	{
		name: "self_collect preset fallback (delivered)",
		status: "delivered",
		opts: { deliveryMethod: "self_collect", locale: "en" },
		expected: "Collected",
	},
	// Base default fallback (delivery method, no override).
	{
		name: "base default for delivery",
		status: "shipped",
		opts: { deliveryMethod: "delivery", locale: "en" },
		expected: "On the Way",
	},
	{
		name: "base default when nothing supplied",
		status: "pending",
		opts: {},
		expected: "Order Received",
	},
	// Empty / whitespace override is treated as unset → falls back.
	{
		name: "blank override falls back to base",
		status: "delivered",
		opts: { labels: EN_ONLY, deliveryMethod: "delivery", locale: "en" },
		expected: "Delivered",
	},
	{
		name: "whitespace override falls back to base",
		status: "packed",
		opts: { labels: EN_ONLY, locale: "en" },
		expected: "Packed",
	},
	// Locale fallback: EN-only labels never leak to an MS buyer.
	{
		name: "MS buyer sees MS default when only EN override set",
		status: "shipped",
		opts: { labels: EN_ONLY, deliveryMethod: "delivery", locale: "ms" },
		expected: "Dalam Perjalanan",
	},
	{
		name: "MS self_collect preset for MS buyer",
		status: "shipped",
		opts: { deliveryMethod: "self_collect", locale: "ms" },
		expected: "Sedia Diambil",
	},
	// Per-locale override picked correctly.
	{
		name: "EN override for EN buyer",
		status: "shipped",
		opts: { labels: BOTH_LOCALES, locale: "en" },
		expected: "Ready @ store",
	},
	{
		name: "MS override for MS buyer",
		status: "shipped",
		opts: { labels: BOTH_LOCALES, locale: "ms" },
		expected: "Sedia di kedai",
	},
];

describe("resolveStatusLabel", () => {
	for (const c of LABEL_CASES) {
		test(c.name, () => {
			expect(resolveStatusLabel(c.status, c.opts)).toBe(c.expected);
		});
	}

	test("defaults to en + delivery when locale/method omitted", () => {
		expect(resolveStatusLabel("shipped")).toBe("On the Way");
	});
});

describe("defaultStatusLabel", () => {
	test("self_collect preset wins over base", () => {
		expect(defaultStatusLabel("shipped", "self_collect", "en")).toBe(
			"Ready for Pickup",
		);
	});
	test("unset self_collect key falls through to base", () => {
		expect(defaultStatusLabel("packed", "self_collect", "en")).toBe("Packed");
	});
});

type TransitionCase = {
	name: string;
	target: TransitionTarget;
	opts: ResolveOpts;
	expected: string;
};

const TRANSITION_CASES: TransitionCase[] = [
	{
		name: "confirmed keeps system verb (not 'Mark as')",
		target: "confirmed",
		opts: { locale: "en" },
		expected: "Confirm Order",
	},
	{
		name: "cancelled keeps system verb",
		target: "cancelled",
		opts: { locale: "en" },
		expected: "Cancel Order",
	},
	{
		name: "packed renders 'Mark as {label}'",
		target: "packed",
		opts: { locale: "en" },
		expected: "Mark as Packed",
	},
	{
		name: "self_collect shipped → Mark as Ready for Pickup",
		target: "shipped",
		opts: { deliveryMethod: "self_collect", locale: "en" },
		expected: "Mark as Ready for Pickup",
	},
	{
		name: "override flows into the button copy",
		target: "shipped",
		opts: { labels: { en: { shipped: "Out for delivery" } }, locale: "en" },
		expected: "Mark as Out for delivery",
	},
	{
		name: "MS confirm verb",
		target: "confirmed",
		opts: { locale: "ms" },
		expected: "Sahkan Pesanan",
	},
	{
		name: "MS 'Mark as' prefix",
		target: "delivered",
		opts: { deliveryMethod: "self_collect", locale: "ms" },
		expected: "Tanda sebagai Telah Diambil",
	},
];

describe("resolveTransitionLabel", () => {
	for (const c of TRANSITION_CASES) {
		test(c.name, () => {
			expect(resolveTransitionLabel(c.target, c.opts)).toBe(c.expected);
		});
	}
});
