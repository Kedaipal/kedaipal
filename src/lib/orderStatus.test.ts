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

// --- Phase 2: anchored custom stages ---------------------------------------
import {
	anchorOrdinal,
	assertValidOrderStages,
	collectStageConfigErrors,
	defaultStageId,
	MAX_ORDER_STAGES,
	type OrderStage,
	resolveCurrentStage,
	resolveStages,
	stageDescription,
	stageLabel,
	synthesizeDefaultStages,
} from "./orderStatus";

function stage(over: Partial<OrderStage> & Pick<OrderStage, "id" | "anchor" | "sortOrder">): OrderStage {
	return { label: { en: "X" }, notify: false, ...over };
}

describe("synthesizeDefaultStages", () => {
	test("produces the 4 band anchors in order, all notifying", () => {
		const s = synthesizeDefaultStages({});
		expect(s.map((x) => x.anchor)).toEqual([
			"confirmed",
			"packed",
			"shipped",
			"delivered",
		]);
		expect(s.every((x) => x.notify)).toBe(true);
		expect(s.map((x) => x.id)).toEqual([
			"default:confirmed",
			"default:packed",
			"default:shipped",
			"default:delivered",
		]);
	});

	test("labels honour statusLabels override + self_collect preset, both locales", () => {
		const s = synthesizeDefaultStages({
			labels: { en: { shipped: "Out for delivery" } },
			deliveryMethod: "self_collect",
		});
		const shipped = s.find((x) => x.anchor === "shipped");
		// EN override wins; MS unset → MS self_collect preset.
		expect(shipped?.label.en).toBe("Out for delivery");
		expect(shipped?.label.ms).toBe("Sedia Diambil");
		const delivered = s.find((x) => x.anchor === "delivered");
		expect(delivered?.label.en).toBe("Collected");
	});
});

describe("resolveStages", () => {
	test("configured stages win and are sorted by sortOrder", () => {
		const configured = [
			stage({ id: "b", anchor: "packed", sortOrder: 1 }),
			stage({ id: "a", anchor: "confirmed", sortOrder: 0 }),
		];
		const r = resolveStages({ orderStages: configured });
		expect(r.map((x) => x.id)).toEqual(["a", "b"]);
	});

	test("falls back to synthesized defaults when none configured", () => {
		expect(resolveStages({ orderStages: [] }).map((x) => x.id)).toEqual([
			defaultStageId("confirmed"),
			defaultStageId("packed"),
			defaultStageId("shipped"),
			defaultStageId("delivered"),
		]);
	});
});

describe("resolveCurrentStage", () => {
	const stages = synthesizeDefaultStages({});

	test("uses currentStageId when present", () => {
		const s = resolveCurrentStage(
			{ status: "packed", currentStageId: "default:shipped" },
			stages,
		);
		expect(s?.id).toBe("default:shipped");
	});

	test("derives from canonical status when no/!found stage id", () => {
		expect(
			resolveCurrentStage({ status: "packed" }, stages)?.anchor,
		).toBe("packed");
		// stale id → derive from status
		expect(
			resolveCurrentStage(
				{ status: "shipped", currentStageId: "deleted-id" },
				stages,
			)?.anchor,
		).toBe("shipped");
	});

	test("derive picks the FIRST stage of a shared anchor", () => {
		const custom = [
			stage({ id: "clean", anchor: "packed", sortOrder: 0, label: { en: "Cleaning" } }),
			stage({ id: "dry", anchor: "packed", sortOrder: 1, label: { en: "Drying" } }),
		];
		expect(resolveCurrentStage({ status: "packed" }, custom)?.id).toBe("clean");
	});

	test("pending and cancelled resolve to no stage", () => {
		expect(resolveCurrentStage({ status: "pending" }, stages)).toBeUndefined();
		expect(resolveCurrentStage({ status: "cancelled" }, stages)).toBeUndefined();
	});
});

describe("stageLabel / stageDescription", () => {
	const s = stage({
		id: "x",
		anchor: "packed",
		sortOrder: 0,
		label: { en: "Sewing" },
		description: { en: "Usually 2 days" },
	});
	test("MS falls back to EN when MS blank", () => {
		expect(stageLabel(s, "ms")).toBe("Sewing");
		expect(stageDescription(s, "ms")).toBe("Usually 2 days");
	});
	test("MS used when present", () => {
		const t = stage({ id: "y", anchor: "packed", sortOrder: 0, label: { en: "Sewing", ms: "Menjahit" } });
		expect(stageLabel(t, "ms")).toBe("Menjahit");
	});
	test("no description → undefined", () => {
		const t = stage({ id: "z", anchor: "packed", sortOrder: 0 });
		expect(stageDescription(t, "en")).toBeUndefined();
	});
});

describe("collectStageConfigErrors", () => {
	test("valid multi-stage-per-anchor config has no errors", () => {
		const ok = [
			stage({ id: "a", anchor: "confirmed", sortOrder: 0, label: { en: "Accepted" } }),
			stage({ id: "b", anchor: "packed", sortOrder: 1, label: { en: "Cleaning" } }),
			stage({ id: "c", anchor: "packed", sortOrder: 2, label: { en: "Drying" } }),
			stage({ id: "d", anchor: "delivered", sortOrder: 3, label: { en: "Collected" } }),
		];
		expect(collectStageConfigErrors(ok)).toEqual([]);
	});

	test("flags a backwards anchor (monotonic rule)", () => {
		const bad = [
			stage({ id: "a", anchor: "packed", sortOrder: 0 }),
			stage({ id: "b", anchor: "confirmed", sortOrder: 1 }),
		];
		expect(collectStageConfigErrors(bad).join(" ")).toMatch(/out of order/i);
	});

	test("flags exceeding the stage cap", () => {
		const many = Array.from({ length: MAX_ORDER_STAGES + 1 }, (_, i) =>
			stage({ id: `s${i}`, anchor: "packed", sortOrder: i }),
		);
		expect(collectStageConfigErrors(many).join(" ")).toMatch(
			new RegExp(`At most ${MAX_ORDER_STAGES}`),
		);
	});

	test("flags a missing English label and a duplicate id", () => {
		const bad = [
			stage({ id: "dup", anchor: "confirmed", sortOrder: 0, label: { en: "" } }),
			stage({ id: "dup", anchor: "packed", sortOrder: 1 }),
		];
		const msg = collectStageConfigErrors(bad).join(" ");
		expect(msg).toMatch(/English label/i);
		expect(msg).toMatch(/Duplicate stage id/i);
	});

	test("assertValidOrderStages throws the first error", () => {
		const bad = [
			stage({ id: "a", anchor: "packed", sortOrder: 0 }),
			stage({ id: "b", anchor: "confirmed", sortOrder: 1 }),
		];
		expect(() => assertValidOrderStages(bad)).toThrow(/out of order/i);
	});
});

describe("anchorOrdinal", () => {
	test("orders confirmed<packed<shipped<delivered", () => {
		expect(anchorOrdinal("confirmed")).toBe(0);
		expect(anchorOrdinal("delivered")).toBe(3);
	});
});

describe("stageNotifyPlan", () => {
	test("notify=false → none", () => {
		expect(stageNotifyPlan({ notify: false, targetAnchor: "packed", statusChanged: true })).toBe("none");
	});
	test("confirmed anchor → none (confirm flow owns it)", () => {
		expect(stageNotifyPlan({ notify: true, targetAnchor: "confirmed", statusChanged: true })).toBe("none");
	});
	test("anchor crossing → canonical (rich copy)", () => {
		expect(stageNotifyPlan({ notify: true, targetAnchor: "packed", statusChanged: true })).toBe("canonical");
		expect(stageNotifyPlan({ notify: true, targetAnchor: "delivered", statusChanged: true })).toBe("canonical");
	});
	test("within an anchor → stage (generic update)", () => {
		expect(stageNotifyPlan({ notify: true, targetAnchor: "packed", statusChanged: false })).toBe("stage");
	});
});

import { stageNotifyPlan } from "./orderStatus";

describe("resolveAnchorLabel", () => {
	const custom = [
		{ id: "a", anchor: "confirmed" as const, label: { en: "Accepted" }, notify: true, sortOrder: 0 },
		{ id: "b", anchor: "packed" as const, label: { en: "Sewing" }, notify: false, sortOrder: 1 },
		{ id: "c", anchor: "packed" as const, label: { en: "Pressing" }, notify: false, sortOrder: 2 },
	];
	test("uses the first stage of the anchor", () => {
		expect(resolveAnchorLabel("packed", { stages: custom })).toBe("Sewing");
	});
	test("pending/cancelled fall back to status label", () => {
		expect(resolveAnchorLabel("pending", { stages: custom })).toBe("Order Received");
		expect(resolveAnchorLabel("cancelled", { stages: custom })).toBe("Cancelled");
	});
	test("anchor with no matching stage falls back to default", () => {
		expect(resolveAnchorLabel("shipped", { stages: custom })).toBe("On the Way");
	});
	test("no stages → Phase-1 default", () => {
		expect(resolveAnchorLabel("delivered", {})).toBe("Delivered");
	});
});

import { resolveAnchorLabel } from "./orderStatus";

describe("collectStageConfigErrors — boundary + notify caps", () => {
	test("rejects two Accepted (confirmed) stages", () => {
		const bad = [
			stage({ id: "a", anchor: "confirmed", sortOrder: 0 }),
			stage({ id: "b", anchor: "confirmed", sortOrder: 1 }),
		];
		expect(collectStageConfigErrors(bad).join(" ")).toMatch(/Only one "Accepted"/);
	});
	test("rejects two Done (delivered) stages", () => {
		const bad = [
			stage({ id: "a", anchor: "delivered", sortOrder: 0 }),
			stage({ id: "b", anchor: "delivered", sortOrder: 1 }),
		];
		expect(collectStageConfigErrors(bad).join(" ")).toMatch(/Only one "Done"/);
	});
	test("rejects more than MAX_NOTIFY_STAGES notifying stages", () => {
		const many = Array.from({ length: MAX_NOTIFY_STAGES + 1 }, (_, i) =>
			stage({ id: `p${i}`, anchor: "packed", sortOrder: i, notify: true }),
		);
		expect(collectStageConfigErrors(many).join(" ")).toMatch(/can notify the buyer/);
	});
	test("exactly MAX_NOTIFY_STAGES notifying is fine", () => {
		const ok = Array.from({ length: MAX_NOTIFY_STAGES }, (_, i) =>
			stage({ id: `p${i}`, anchor: "packed", sortOrder: i, notify: true }),
		);
		expect(collectStageConfigErrors(ok).filter((e) => /can notify/.test(e))).toEqual([]);
	});
	test("confirmed notify is not counted toward the cap", () => {
		const stages = [
			stage({ id: "c", anchor: "confirmed", sortOrder: 0, notify: true }),
			...Array.from({ length: MAX_NOTIFY_STAGES }, (_, i) =>
				stage({ id: `p${i}`, anchor: "packed", sortOrder: i + 1, notify: true }),
			),
		];
		expect(collectStageConfigErrors(stages).filter((e) => /can notify/.test(e))).toEqual([]);
	});
});

import { MAX_NOTIFY_STAGES } from "./orderStatus";
