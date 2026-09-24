import { describe, expect, test } from "vitest";
import {
	anchorOrdinal,
	assertValidOrderStages,
	collectStageConfigErrors,
	configuredStages,
	defaultStageId,
	defaultStatusLabel,
	displayStatusLabel,
	FLOW_PRESETS,
	hasAnchor,
	isFlowCustomised,
	MAX_ORDER_STAGES,
	orderFlowKind,
	type OrderStage,
	type OrderStatus,
	resolveCurrentStage,
	type ResolveOpts,
	resolveStages,
	resolveStatusLabel,
	resolveTransitionLabel,
	sameStages,
	STAGE_DESCRIPTION_MAX_LENGTH,
	STAGE_LABEL_MAX_LENGTH,
	stageDescription,
	stageLabel,
	type StatusLabels,
	synthesizeDefaultStages,
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
	// ZH: EN/MS-only overrides never leak to a ZH buyer (86eybjw5n).
	{
		name: "ZH buyer sees ZH default when only EN override set",
		status: "shipped",
		opts: { labels: EN_ONLY, deliveryMethod: "delivery", locale: "zh" },
		expected: "配送中",
	},
	{
		name: "ZH self_collect preset for ZH buyer",
		status: "shipped",
		opts: { deliveryMethod: "self_collect", locale: "zh" },
		expected: "可以自取",
	},
	{
		name: "ZH override for ZH buyer",
		status: "shipped",
		opts: {
			labels: { ...BOTH_LOCALES, zh: { shipped: "门店可取" } },
			locale: "zh",
		},
		expected: "门店可取",
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

function stage(
	over: Partial<OrderStage> & Pick<OrderStage, "id" | "anchor" | "sortOrder">,
): OrderStage {
	return { label: { en: "X" }, ...over };
}

describe("synthesizeDefaultStages", () => {
	test("produces the 4 band anchors in order", () => {
		const s = synthesizeDefaultStages({});
		expect(s.map((x) => x.anchor)).toEqual([
			"confirmed",
			"packed",
			"shipped",
			"delivered",
		]);
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

	test("a BOOKING ignores the LEGACY flat stage list", () => {
		// The bug this pins: the configured-stages short-circuit ran before any
		// booking check, so the moment a seller customised their flow for cakes,
		// every campsite booking inherited it — "Mark as Packed" on a stay — and
		// the booking-aware synthesized route became unreachable for exactly the
		// sellers who had touched the setting.
		//
		// Since z8r3fdh3w1 a booking CAN carry a flow — its OWN, under
		// `orderFlows.booking` (see "a customised booking flow DOES word
		// bookings" below). What it can never do is inherit the flat list,
		// which only ever meant the product kinds.
		const configured = [
			stage({ id: "cfg-a", anchor: "confirmed", sortOrder: 0 }),
			stage({ id: "cfg-b", anchor: "packed", sortOrder: 1 }),
			stage({ id: "cfg-c", anchor: "shipped", sortOrder: 2 }),
		];
		const r = resolveStages({
			orderStages: configured,
			deliveryMethod: "booking",
		});
		expect(r.map((x) => x.id)).toEqual([
			defaultStageId("confirmed"),
			defaultStageId("shipped"),
			defaultStageId("delivered"),
		]);
		// No "Packed" anchor survives — nothing is packed on a stay.
		expect(r.some((x) => x.anchor === "packed")).toBe(false);

		// …while every other method still honours the seller's own flow.
		expect(
			resolveStages({
				orderStages: configured,
				deliveryMethod: "delivery",
			}).map((x) => x.id),
		).toEqual(["cfg-a", "cfg-b", "cfg-c"]);
		expect(
			resolveStages({
				orderStages: configured,
				deliveryMethod: "self_collect",
			}).map((x) => x.id),
		).toEqual(["cfg-a", "cfg-b", "cfg-c"]);
	});

	test("a fixed-length package starts and ends; a stay checks in and out", () => {
		const stay = resolveStages({ deliveryMethod: "booking" });
		expect(stay.find((x) => x.anchor === "shipped")?.label.en).toBe(
			"Checked In",
		);
		expect(stay.find((x) => x.anchor === "delivered")?.label.en).toBe(
			"Checked Out",
		);

		// A gym member doesn't check out of a monthly membership on day 30.
		const pkg = resolveStages({
			deliveryMethod: "booking",
			bookingPackaged: true,
		});
		expect(pkg.find((x) => x.anchor === "shipped")?.label.en).toBe("Active");
		expect(pkg.find((x) => x.anchor === "delivered")?.label.en).toBe("Ended");
		// MS carries too — a seller who never fills a label still gets both.
		expect(pkg.find((x) => x.anchor === "shipped")?.label.ms).toBe("Aktif");

		// The package wording is booking-only: it must not leak into a physical
		// order that happens to carry the flag.
		expect(
			resolveStages({ deliveryMethod: "delivery", bookingPackaged: true }).find(
				(x) => x.anchor === "shipped",
			)?.label.en,
		).toBe("On the Way");
	});

	test("an order stamped with a now-ignored custom stage still renders", () => {
		// No migration ships with the gate, so a booking placed BEFORE it can
		// hold a `currentStageId` that no longer exists in the list. It has to
		// degrade to the synthesized stage for its canonical status, not vanish.
		const stages = resolveStages({
			orderStages: [stage({ id: "cfg-c", anchor: "shipped", sortOrder: 0 })],
			deliveryMethod: "booking",
		});
		const current = resolveCurrentStage(
			{ status: "shipped", currentStageId: "cfg-c" },
			stages,
		);
		expect(current?.id).toBe(defaultStageId("shipped"));
		expect(current?.label.en).toBe("Checked In");
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
		expect(resolveCurrentStage({ status: "packed" }, stages)?.anchor).toBe(
			"packed",
		);
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
			stage({
				id: "clean",
				anchor: "packed",
				sortOrder: 0,
				label: { en: "Cleaning" },
			}),
			stage({
				id: "dry",
				anchor: "packed",
				sortOrder: 1,
				label: { en: "Drying" },
			}),
		];
		expect(resolveCurrentStage({ status: "packed" }, custom)?.id).toBe("clean");
	});

	test("stale stage BEHIND status → status wins (webhook advanced status only)", () => {
		// The Lalamove webhook / payment auto-confirm advance `status` WITHOUT
		// moving `currentStageId`. A stored stage that has fallen behind must never
		// pin the display back — otherwise a delivered order reads "Packed".
		expect(
			resolveCurrentStage(
				{ status: "delivered", currentStageId: "default:packed" },
				stages,
			)?.anchor,
		).toBe("delivered");
		expect(
			resolveCurrentStage(
				{ status: "shipped", currentStageId: "default:packed" },
				stages,
			)?.anchor,
		).toBe("shipped");
	});

	test("custom stage sharing the current anchor is still honoured", () => {
		const custom = [
			stage({
				id: "dispatched",
				anchor: "shipped",
				sortOrder: 0,
				label: { en: "Dispatched" },
			}),
			stage({
				id: "near-you",
				anchor: "shipped",
				sortOrder: 1,
				label: { en: "Near you" },
			}),
		];
		// Status has caught up to shipped; the seller's specific shipped stage
		// stays selected (equal ordinal, not behind).
		expect(
			resolveCurrentStage(
				{ status: "shipped", currentStageId: "near-you" },
				custom,
			)?.id,
		).toBe("near-you");
	});

	test("pending and cancelled resolve to no stage", () => {
		expect(resolveCurrentStage({ status: "pending" }, stages)).toBeUndefined();
		expect(
			resolveCurrentStage({ status: "cancelled" }, stages),
		).toBeUndefined();
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
		const t = stage({
			id: "y",
			anchor: "packed",
			sortOrder: 0,
			label: { en: "Sewing", ms: "Menjahit" },
		});
		expect(stageLabel(t, "ms")).toBe("Menjahit");
	});
	test("ZH falls back to EN when ZH blank, and is used when present", () => {
		expect(stageLabel(s, "zh")).toBe("Sewing");
		const t = stage({
			id: "w",
			anchor: "packed",
			sortOrder: 0,
			label: { en: "Sewing", zh: "缝纫" },
		});
		expect(stageLabel(t, "zh")).toBe("缝纫");
	});
	test("no description → undefined", () => {
		const t = stage({ id: "z", anchor: "packed", sortOrder: 0 });
		expect(stageDescription(t, "en")).toBeUndefined();
	});
	test("stageDescription fallback order is [requested, …rest of LOCALES]", () => {
		expect(stageDescription(s, "zh")).toBe("Usually 2 days");
		const withZh = stage({
			id: "v",
			anchor: "packed",
			sortOrder: 0,
			label: { en: "Sewing" },
			description: { zh: "通常 2 天" },
		});
		expect(stageDescription(withZh, "zh")).toBe("通常 2 天");
		expect(stageDescription(withZh, "en")).toBe("通常 2 天");
	});
});

describe("collectStageConfigErrors", () => {
	test("valid multi-stage-per-anchor config has no errors", () => {
		const ok = [
			stage({
				id: "a",
				anchor: "confirmed",
				sortOrder: 0,
				label: { en: "Accepted" },
			}),
			stage({
				id: "b",
				anchor: "packed",
				sortOrder: 1,
				label: { en: "Cleaning" },
			}),
			stage({
				id: "c",
				anchor: "packed",
				sortOrder: 2,
				label: { en: "Drying" },
			}),
			stage({
				id: "d",
				anchor: "delivered",
				sortOrder: 3,
				label: { en: "Collected" },
			}),
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
			stage({
				id: "dup",
				anchor: "confirmed",
				sortOrder: 0,
				label: { en: "" },
			}),
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

	test("flags an over-long ZH label and ZH description, same as MS", () => {
		const bad = [
			stage({
				id: "a",
				anchor: "packed",
				sortOrder: 0,
				label: { en: "OK", zh: "超".repeat(STAGE_LABEL_MAX_LENGTH + 1) },
				description: { zh: "超".repeat(STAGE_DESCRIPTION_MAX_LENGTH + 1) },
			}),
		];
		const msg = collectStageConfigErrors(bad).join(" ");
		expect(msg).toMatch(/中文 label exceeds/);
		expect(msg).toMatch(/stage description exceeds/);
	});
});

describe("anchorOrdinal", () => {
	test("orders confirmed<packed<shipped<delivered", () => {
		expect(anchorOrdinal("confirmed")).toBe(0);
		expect(anchorOrdinal("delivered")).toBe(3);
	});
});

describe("resolveAnchorLabel", () => {
	const custom = [
		{
			id: "a",
			anchor: "confirmed" as const,
			label: { en: "Accepted" },
			sortOrder: 0,
		},
		{
			id: "b",
			anchor: "packed" as const,
			label: { en: "Sewing" },
			sortOrder: 1,
		},
		{
			id: "c",
			anchor: "packed" as const,
			label: { en: "Pressing" },
			sortOrder: 2,
		},
	];
	test("uses the first stage of the anchor", () => {
		expect(resolveAnchorLabel("packed", { stages: custom })).toBe("Sewing");
	});
	test("pending/cancelled fall back to status label", () => {
		expect(resolveAnchorLabel("pending", { stages: custom })).toBe(
			"Order Received",
		);
		expect(resolveAnchorLabel("cancelled", { stages: custom })).toBe(
			"Cancelled",
		);
	});
	test("anchor with no matching stage falls back to default", () => {
		expect(resolveAnchorLabel("shipped", { stages: custom })).toBe(
			"On the Way",
		);
	});
	test("no stages → Phase-1 default", () => {
		expect(resolveAnchorLabel("delivered", {})).toBe("Delivered");
	});
});

import { resolveAnchorLabel } from "./orderStatus";

describe("collectStageConfigErrors — boundary rules", () => {
	test("rejects two Accepted (confirmed) stages", () => {
		const bad = [
			stage({ id: "a", anchor: "confirmed", sortOrder: 0 }),
			stage({ id: "b", anchor: "confirmed", sortOrder: 1 }),
		];
		expect(collectStageConfigErrors(bad).join(" ")).toMatch(
			/Only one "Accepted"/,
		);
	});
	test("rejects two Done (delivered) stages", () => {
		const bad = [
			stage({ id: "a", anchor: "delivered", sortOrder: 0 }),
			stage({ id: "b", anchor: "delivered", sortOrder: 1 }),
		];
		expect(collectStageConfigErrors(bad).join(" ")).toMatch(/Only one "Done"/);
	});
});

// Counter-checkout "Completed" override — kept identical in
// convex/lib/orderStatus.test.ts so the mirrored resolvers can't drift.
describe("displayStatusLabel — counter completion", () => {
	test("counter + delivered reads 'Completed', never 'Delivered'", () => {
		expect(
			displayStatusLabel(
				{ status: "delivered", source: "counter" },
				"Delivered",
			),
		).toBe("Completed");
		expect(
			displayStatusLabel(
				{ status: "delivered", source: "counter" },
				"Collected",
			),
		).toBe("Completed");
	});
	test("counter + delivered is localized to MS", () => {
		expect(
			displayStatusLabel(
				{ status: "delivered", source: "counter" },
				"Telah Dihantar",
				"ms",
			),
		).toBe("Selesai");
	});
	test("counter + delivered is localized to ZH", () => {
		expect(
			displayStatusLabel(
				{ status: "delivered", source: "counter" },
				"已送达",
				"zh",
			),
		).toBe("已完成");
	});
	test("storefront / legacy delivered keeps the resolved label", () => {
		expect(
			displayStatusLabel(
				{ status: "delivered", source: "storefront" },
				"Delivered",
			),
		).toBe("Delivered");
		expect(displayStatusLabel({ status: "delivered" }, "Collected")).toBe(
			"Collected",
		);
	});
	test("counter but not delivered keeps the resolved label", () => {
		expect(
			displayStatusLabel(
				{ status: "confirmed", source: "counter" },
				"Confirmed",
			),
		).toBe("Confirmed");
	});
});

describe("event flow kind (`z8r3fdff9u`) — the registry's fourth entry", () => {
	test("orderFlowKind: the frozen marker outranks the stored method", () => {
		expect(orderFlowKind({ deliveryMethod: "delivery" })).toBe("delivery");
		expect(orderFlowKind({ deliveryMethod: "self_collect" })).toBe(
			"self_collect",
		);
		expect(orderFlowKind({ deliveryMethod: "booking" })).toBe("booking");
		// An RSVP is STORED self_collect (venue pickup) — the marker decides.
		expect(
			orderFlowKind({ deliveryMethod: "self_collect", eventRsvp: true }),
		).toBe("event");
		expect(orderFlowKind({})).toBe("delivery");
	});

	test("an RSVP's pipeline is Confirmed → Checked In — no Packed, no Ready", () => {
		const stages = synthesizeDefaultStages({ deliveryMethod: "event" });
		expect(stages.map((s) => s.anchor)).toEqual(["confirmed", "delivered"]);
		expect(stages.map((s) => s.label.en)).toEqual(["Confirmed", "Checked In"]);
		expect(stages[1].label.ms).toBe("Daftar Masuk");
	});

	test("events never take the LEGACY flat stage list (the booking rule)", () => {
		const custom: OrderStage[] = [
			{
				id: "s1",
				anchor: "packed",
				label: { en: "Baking" },
				sortOrder: 0,
			},
		];
		const resolved = resolveStages({
			orderStages: custom,
			deliveryMethod: "event",
		});
		// Synthesized event stages, not the cake shop's flow. An event with its
		// own `orderFlows.event` is a different question — and a yes.
		expect(resolved.map((s) => s.anchor)).toEqual(["confirmed", "delivered"]);
		// A delivery order still takes them — the gate is per kind.
		expect(
			resolveStages({ orderStages: custom, deliveryMethod: "delivery" }).map(
				(s) => s.id,
			),
		).toEqual(["s1"]);
	});

	test("a checked-in RSVP sold at the counter reads Checked In, never Completed", () => {
		expect(
			displayStatusLabel(
				{ status: "delivered", source: "counter", eventRsvp: true },
				"Checked In",
			),
		).toBe("Checked In");
		// The counter override itself is untouched for a plain counter sale.
		expect(
			displayStatusLabel(
				{ status: "delivered", source: "counter" },
				"Collected",
			),
		).toBe("Completed");
	});

	test("FLOW_PRESETS carries the bulk-action skip list per kind", () => {
		expect(FLOW_PRESETS.event.skippedAnchors).toEqual(["packed", "shipped"]);
		expect(FLOW_PRESETS.booking.skippedAnchors).toEqual(["packed"]);
		expect(FLOW_PRESETS.delivery.skippedAnchors).toEqual([]);
	});
});

// ===========================================================================
// Per-flow-kind stage configuration (z8r3fdh3w1)
//
// The bug this replaced: ONE global rename map + ONE flat stage list spoke for
// every kind at once, so a store that renamed "Confirmed" to "Ok go" read
// "Ok go" on its campsite bookings, and no screen could see or clear it.
// ===========================================================================

/** A cake shop's flow, as the old flat list would have held it. */
const CAKE_FLOW: OrderStage[] = [
	stage({
		id: "c1",
		anchor: "confirmed",
		sortOrder: 0,
		label: { en: "Order in" },
	}),
	stage({ id: "c2", anchor: "packed", sortOrder: 1, label: { en: "Baking" } }),
	stage({
		id: "c3",
		anchor: "delivered",
		sortOrder: 2,
		label: { en: "Collected" },
	}),
];

/** The rename seen live on dev: IndoMart's "Ok go", plus a Delivered rename. */
const LEGACY_RENAMES: StatusLabels = {
	en: { confirmed: "Ok go", delivered: "Dah siap" },
};

describe("legacy renames are scoped to the kinds that could have meant them", () => {
	test("a global rename still speaks for delivery and pickup (no change on deploy)", () => {
		for (const kind of ["delivery", "self_collect"] as const) {
			expect(
				resolveStatusLabel("confirmed", {
					labels: LEGACY_RENAMES,
					deliveryMethod: kind,
				}),
			).toBe("Ok go");
		}
	});

	test("a global rename NEVER reaches a booking or an event RSVP", () => {
		// The live symptom: booking #ORD-XD7G reading "Ok go" in the order list.
		expect(
			resolveStatusLabel("confirmed", {
				labels: LEGACY_RENAMES,
				deliveryMethod: "booking",
			}),
		).toBe("Confirmed");
		expect(
			resolveStatusLabel("confirmed", {
				labels: LEGACY_RENAMES,
				deliveryMethod: "event",
			}),
		).toBe("Confirmed");
		// A renamed Delivered used to overwrite a stay's "Checked Out" and an
		// RSVP's "Checked In" — the two the ticket called out from the code.
		expect(
			resolveStatusLabel("delivered", {
				labels: LEGACY_RENAMES,
				deliveryMethod: "booking",
			}),
		).toBe("Checked Out");
		expect(
			resolveStatusLabel("delivered", {
				labels: LEGACY_RENAMES,
				deliveryMethod: "event",
			}),
		).toBe("Checked In");
	});

	test("the synthesized stage list carries the same scoping", () => {
		// The stepper, the /track timeline and the inbox chip all read stages,
		// so the leak had to be closed here too, not only on the raw resolver.
		const stay = synthesizeDefaultStages({
			labels: LEGACY_RENAMES,
			deliveryMethod: "booking",
		});
		expect(stay.map((s) => s.label.en)).toEqual([
			"Confirmed",
			"Checked In",
			"Checked Out",
		]);
		const parcel = synthesizeDefaultStages({
			labels: LEGACY_RENAMES,
			deliveryMethod: "delivery",
		});
		expect(parcel[0].label.en).toBe("Ok go");
	});

	test("the registry, not a hardcoded pair, decides who takes legacy labels", () => {
		expect(FLOW_PRESETS.delivery.takesLegacyLabels).toBe(true);
		expect(FLOW_PRESETS.self_collect.takesLegacyLabels).toBe(true);
		expect(FLOW_PRESETS.booking.takesLegacyLabels).toBe(false);
		expect(FLOW_PRESETS.event.takesLegacyLabels).toBe(false);
	});
});

describe("configuredStages — the three-state rule", () => {
	test("key absent falls through to the LEGACY flat list, for its kinds only", () => {
		expect(configuredStages(undefined, CAKE_FLOW, "delivery")).toEqual(
			CAKE_FLOW,
		);
		expect(configuredStages(undefined, CAKE_FLOW, "self_collect")).toEqual(
			CAKE_FLOW,
		);
		// A stay never inherits the cake shop's "Baking".
		expect(configuredStages(undefined, CAKE_FLOW, "booking")).toEqual([]);
		expect(configuredStages(undefined, CAKE_FLOW, "event")).toEqual([]);
	});

	test("an EMPTY array is 'reset to defaults' and BEATS the legacy fallback", () => {
		// Without this, a seller who reset pickup would silently get their old
		// flat list back — a reset button that doesn't reset.
		expect(
			configuredStages({ self_collect: [] }, CAKE_FLOW, "self_collect"),
		).toEqual([]);
		// …and only for the kind they reset.
		expect(
			configuredStages({ self_collect: [] }, CAKE_FLOW, "delivery"),
		).toEqual(CAKE_FLOW);
	});

	test("a kind's own list wins over the legacy one", () => {
		const own = [stage({ id: "d1", anchor: "confirmed", sortOrder: 0 })];
		expect(configuredStages({ delivery: own }, CAKE_FLOW, "delivery")).toEqual(
			own,
		);
	});

	test("isFlowCustomised reads the same rule", () => {
		expect(isFlowCustomised(undefined, CAKE_FLOW, "delivery")).toBe(true);
		expect(isFlowCustomised(undefined, CAKE_FLOW, "booking")).toBe(false);
		expect(isFlowCustomised({ delivery: [] }, CAKE_FLOW, "delivery")).toBe(
			false,
		);
	});
});

describe("one kind's words never reach another", () => {
	const flows = {
		delivery: CAKE_FLOW,
		booking: [
			stage({
				id: "b1",
				anchor: "confirmed",
				sortOrder: 0,
				label: { en: "Booked" },
			}),
			stage({
				id: "b2",
				anchor: "shipped",
				sortOrder: 1,
				label: { en: "Arrived" },
			}),
			stage({
				id: "b3",
				anchor: "delivered",
				sortOrder: 2,
				label: { en: "Departed" },
			}),
		],
	};

	test("a delivery flow words delivery orders and nothing else", () => {
		expect(
			resolveStages({ orderFlows: flows, deliveryMethod: "delivery" }).map(
				(s) => s.label.en,
			),
		).toEqual(["Order in", "Baking", "Collected"]);
		// An RSVP has no flow of its own here → its own preset, not the cake one.
		expect(
			resolveStages({ orderFlows: flows, deliveryMethod: "event" }).map(
				(s) => s.label.en,
			),
		).toEqual(["Confirmed", "Checked In"]);
	});

	test("a customised booking flow DOES word bookings", () => {
		expect(
			resolveStages({ orderFlows: flows, deliveryMethod: "booking" }).map(
				(s) => s.label.en,
			),
		).toEqual(["Booked", "Arrived", "Departed"]);
	});

	test("one booking config covers stays and fixed-length packages alike", () => {
		// On DEFAULTS the two differ — a membership is Active/Ended, not
		// Checked in/out…
		expect(
			resolveStages({ deliveryMethod: "booking", bookingPackaged: true }).map(
				(s) => s.label.en,
			),
		).toEqual(["Confirmed", "Active", "Ended"]);
		// …but once the seller has written their own words, those words are the
		// answer for both. One card, one answer (the settings copy says so).
		expect(
			resolveStages({
				orderFlows: flows,
				deliveryMethod: "booking",
				bookingPackaged: true,
			}).map((s) => s.label.en),
		).toEqual(["Booked", "Arrived", "Departed"]);
	});
});

describe("skippedAnchors seed the defaults — they do not forbid a step", () => {
	test("a booking's DEFAULT pipeline still skips packed", () => {
		expect(
			resolveStages({ deliveryMethod: "booking" }).map((s) => s.anchor),
		).toEqual(["confirmed", "shipped", "delivered"]);
		expect(
			hasAnchor(resolveStages({ deliveryMethod: "booking" }), "packed"),
		).toBe(false);
	});

	test("a campsite that deliberately adds a 'Site prepared' step gets it", () => {
		const prepared = resolveStages({
			orderFlows: {
				booking: [
					stage({ id: "p1", anchor: "confirmed", sortOrder: 0 }),
					stage({
						id: "p2",
						anchor: "packed",
						sortOrder: 1,
						label: { en: "Site prepared" },
					}),
					stage({ id: "p3", anchor: "delivered", sortOrder: 2 }),
				],
			},
			deliveryMethod: "booking",
		});
		// The rule bulk actions ask is the RESOLVED list, so this booking is
		// bulk-movable into "In production" even though the kind's preset skips
		// that anchor.
		expect(hasAnchor(prepared, "packed")).toBe(true);
	});
});

describe("sameStages", () => {
	test("true when two lists say the same thing to a buyer", () => {
		expect(
			sameStages(
				CAKE_FLOW,
				CAKE_FLOW.map((s) => ({ ...s })),
			),
		).toBe(true);
		// sortOrder decides reading order, not array order.
		expect(sameStages(CAKE_FLOW, [...CAKE_FLOW].reverse())).toBe(true);
	});

	test("false on a different word, a different anchor, or a different length", () => {
		expect(
			sameStages(CAKE_FLOW, [
				...CAKE_FLOW.slice(0, 2),
				{ ...CAKE_FLOW[2], label: { en: "Picked up" } },
			]),
		).toBe(false);
		expect(sameStages(CAKE_FLOW, CAKE_FLOW.slice(0, 2))).toBe(false);
	});
});

describe("synthesized defaults are filled in every locale", () => {
	test("zh stage names come from the zh defaults, not the EN fallback", () => {
		const s = synthesizeDefaultStages({ deliveryMethod: "booking" });
		expect(s.map((x) => stageLabel(x, "zh"))).toEqual([
			"已确认",
			"已入住",
			"已退房",
		]);
	});
});
