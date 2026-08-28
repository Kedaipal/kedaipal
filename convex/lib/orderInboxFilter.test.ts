import { describe, expect, test } from "vitest";
import { todayMytMidnight } from "./fulfilmentDate";
import {
	buildInboxPredicate,
	compareInboxOrder,
	type FilterableOrder,
	sortInboxOrders,
} from "./orderInboxFilter";

function order(overrides: Partial<FilterableOrder> = {}): FilterableOrder {
	return {
		status: "pending",
		createdAt: 1_000,
		shortId: "ORD-0001",
		customer: { name: "Aisha", waPhone: "+60123456789" },
		items: [{ name: "Vanilla Cake", variantLabel: "1kg" }],
		...overrides,
	};
}

describe("buildInboxPredicate — bucket", () => {
	test("'new' matches only pending", () => {
		const p = buildInboxPredicate({ bucket: "new" });
		expect(p(order({ status: "pending" }))).toBe(true);
		expect(p(order({ status: "confirmed" }))).toBe(false);
	});
	test("'in_progress' spans confirmed/packed/shipped", () => {
		const p = buildInboxPredicate({ bucket: "in_progress" });
		expect(p(order({ status: "packed" }))).toBe(true);
		expect(p(order({ status: "delivered" }))).toBe(false);
	});
	test("'all' matches every status", () => {
		const p = buildInboxPredicate({ bucket: "all" });
		expect(p(order({ status: "cancelled" }))).toBe(true);
	});
});

describe("buildInboxPredicate — payment", () => {
	test("undefined paymentStatus reads as unpaid", () => {
		const p = buildInboxPredicate({ bucket: "all", paymentStatuses: ["unpaid"] });
		expect(p(order({ paymentStatus: undefined }))).toBe(true);
		expect(p(order({ paymentStatus: "received" }))).toBe(false);
	});
	test("method filter and 'unspecified' OR together", () => {
		const p = buildInboxPredicate({
			bucket: "all",
			paymentMethods: ["duitnow"],
			methodUnspecified: true,
		});
		expect(p(order({ paymentMethod: "duitnow" }))).toBe(true);
		expect(p(order({ paymentMethod: undefined }))).toBe(true);
		expect(p(order({ paymentMethod: "cash" }))).toBe(false);
	});
});

describe("buildInboxPredicate — dates", () => {
	test("createdAt range is inclusive", () => {
		const p = buildInboxPredicate({ bucket: "all", dateFrom: 100, dateTo: 200 });
		expect(p(order({ createdAt: 100 }))).toBe(true);
		expect(p(order({ createdAt: 200 }))).toBe(true);
		expect(p(order({ createdAt: 99 }))).toBe(false);
		expect(p(order({ createdAt: 201 }))).toBe(false);
	});
	test("fulfilmentWindow 'today' matches a today-dated order, not a far-future one", () => {
		const p = buildInboxPredicate({ bucket: "all", fulfilmentWindow: "today" });
		expect(p(order({ fulfilmentDate: todayMytMidnight() }))).toBe(true);
		expect(
			p(order({ fulfilmentDate: todayMytMidnight() + 40 * 86_400_000 })),
		).toBe(false);
		// Dateless orders never match a fulfilment window.
		expect(p(order({ fulfilmentDate: undefined }))).toBe(false);
	});
});

describe("buildInboxPredicate — search", () => {
	test("matches order id, name, item, and trailing phone digits", () => {
		const byId = buildInboxPredicate({ bucket: "all", searchText: "ORD-0001" });
		expect(byId(order())).toBe(true);
		const byName = buildInboxPredicate({ bucket: "all", searchText: "aish" });
		expect(byName(order())).toBe(true);
		const byItem = buildInboxPredicate({ bucket: "all", searchText: "vanilla" });
		expect(byItem(order())).toBe(true);
		const byPhone = buildInboxPredicate({ bucket: "all", searchText: "6789" });
		expect(byPhone(order())).toBe(true);
		const miss = buildInboxPredicate({ bucket: "all", searchText: "zzzz" });
		expect(miss(order())).toBe(false);
	});
});

describe("buildInboxPredicate — mockupPending", () => {
	test("matches only orders awaiting the seller's mockup action", () => {
		const p = buildInboxPredicate({ bucket: "all", mockupPending: true });
		expect(p(order({ mockupStatus: "pending" }))).toBe(true);
		expect(p(order({ mockupStatus: "changes_requested" }))).toBe(true);
		expect(p(order({ mockupStatus: "approved" }))).toBe(false);
		expect(p(order({ mockupStatus: undefined }))).toBe(false);
	});
});

describe("buildInboxPredicate — source", () => {
	test("no source filter matches every checkout surface", () => {
		const p = buildInboxPredicate({ bucket: "all" });
		expect(p(order({ source: "storefront" }))).toBe(true);
		expect(p(order({ source: "counter" }))).toBe(true);
		expect(p(order({ source: undefined }))).toBe(true);
	});
	test("counter matches only counter orders", () => {
		const p = buildInboxPredicate({ bucket: "all", source: "counter" });
		expect(p(order({ source: "counter" }))).toBe(true);
		expect(p(order({ source: "storefront" }))).toBe(false);
		// Legacy orders have no stamped source — they are NOT counter sales.
		expect(p(order({ source: undefined }))).toBe(false);
	});
	test("storefront matches storefront AND legacy (undefined ⇒ storefront)", () => {
		const p = buildInboxPredicate({ bucket: "all", source: "storefront" });
		expect(p(order({ source: "storefront" }))).toBe(true);
		expect(p(order({ source: undefined }))).toBe(true);
		expect(p(order({ source: "counter" }))).toBe(false);
	});
});

describe("buildInboxPredicate — attributionSources (86eyq0eq9)", () => {
	const tiktok = order({ attributionSource: "tiktok" });
	const instagram = order({ attributionSource: "instagram" });
	const untagged = order({ source: "storefront" });
	const counter = order({ source: "counter" });

	test("undefined / empty means no attribution filtering", () => {
		for (const args of [
			{ bucket: "all" as const },
			{ bucket: "all" as const, attributionSources: [] },
		]) {
			const p = buildInboxPredicate(args);
			expect([tiktok, instagram, untagged, counter].every(p)).toBe(true);
		}
	});

	test("one origin keeps only that origin", () => {
		const p = buildInboxPredicate({
			bucket: "all",
			attributionSources: ["tiktok"],
		});
		expect(p(tiktok)).toBe(true);
		expect(p(instagram)).toBe(false);
		expect(p(untagged)).toBe(false);
		expect(p(counter)).toBe(false);
	});

	test("several origins OR together (the multi-select)", () => {
		const p = buildInboxPredicate({
			bucket: "all",
			attributionSources: ["tiktok", "instagram"],
		});
		expect(p(tiktok)).toBe(true);
		expect(p(instagram)).toBe(true);
		expect(p(untagged)).toBe(false);
	});

	test("'direct' matches untagged storefront AND legacy sourceless orders", () => {
		const p = buildInboxPredicate({
			bucket: "all",
			attributionSources: ["direct"],
		});
		expect(p(untagged)).toBe(true);
		expect(p(order({}))).toBe(true); // legacy: no source, no tag
		expect(p(counter)).toBe(false);
		expect(p(tiktok)).toBe(false);
	});

	test("'counter' matches counter orders, which are never stamped", () => {
		const p = buildInboxPredicate({
			bucket: "all",
			attributionSources: ["counter"],
		});
		expect(p(counter)).toBe(true);
		expect(p(untagged)).toBe(false);
	});

	test("ANDs with the other filters rather than replacing them", () => {
		const p = buildInboxPredicate({
			bucket: "all",
			attributionSources: ["tiktok"],
			paymentStatuses: ["received"],
		});
		expect(p(order({ attributionSource: "tiktok", paymentStatus: "received" }))).toBe(true);
		// Right origin, wrong payment state → excluded.
		expect(p(order({ attributionSource: "tiktok", paymentStatus: "unpaid" }))).toBe(false);
	});

	test("is a separate dimension from the checkout-surface `source` filter", () => {
		// A counter-surface order carrying a tag is reachable by BOTH filters, and
		// the two must intersect, not collide.
		const tagged = order({ source: "counter", attributionSource: "tiktok" });
		const p = buildInboxPredicate({
			bucket: "all",
			source: "counter",
			attributionSources: ["tiktok"],
		});
		expect(p(tagged)).toBe(true);
		expect(p(counter)).toBe(false); // counter surface, but bucket is "counter" not "tiktok"
	});
});

describe("compareInboxOrder", () => {
	test("soonest fulfilment date first; dateless sinks to the bottom", () => {
		expect(compareInboxOrder({ fulfilmentDate: 10 }, { fulfilmentDate: 20 })).toBeLessThan(0);
		expect(compareInboxOrder({ fulfilmentDate: undefined }, { fulfilmentDate: 20 })).toBe(1);
		expect(compareInboxOrder({ fulfilmentDate: 10 }, { fulfilmentDate: undefined })).toBe(-1);
		expect(compareInboxOrder({ fulfilmentDate: undefined }, { fulfilmentDate: undefined })).toBe(0);
	});
});

describe("sortInboxOrders", () => {
	// Input is always newest-created first (the scan order); ids encode that.
	const scanOrder = [
		{ id: "d", fulfilmentDate: 30 }, // newest
		{ id: "c", fulfilmentDate: undefined },
		{ id: "b", fulfilmentDate: 10 },
		{ id: "a", fulfilmentDate: 20 }, // oldest
	];

	test("'recent' keeps the newest-first scan order untouched", () => {
		expect(sortInboxOrders(scanOrder, "recent").map((o) => o.id)).toEqual([
			"d",
			"c",
			"b",
			"a",
		]);
	});

	test("'due' sorts by fulfilment date ascending, dateless last", () => {
		expect(sortInboxOrders(scanOrder, "due").map((o) => o.id)).toEqual([
			"b", // 10
			"a", // 20
			"d", // 30
			"c", // dateless → bottom
		]);
	});

	test("never mutates the input array", () => {
		const input = [...scanOrder];
		sortInboxOrders(input, "due");
		expect(input.map((o) => o.id)).toEqual(["d", "c", "b", "a"]);
	});
});

// ---------------------------------------------------------------------------
// 86eyrtz74 — pinning. Two rules, both deliberate and both counter-intuitive
// enough to need pinning down: a pin OUTRANKS the filter (so the seller can
// filter to something else and still compare against it), and pinning is a
// PARTITION, never a sort option competing with newest/due.
// ---------------------------------------------------------------------------

describe("buildInboxPredicate — pin privilege", () => {
	const pinned = order({ status: "delivered", pinnedAt: 5_000 });

	test("showPinned keeps a pinned order that fails the bucket", () => {
		const p = buildInboxPredicate({ bucket: "new", showPinned: true });
		expect(p(pinned)).toBe(true);
	});

	test("a pin outranks EVERY other filter at once, not just the bucket", () => {
		const p = buildInboxPredicate({
			bucket: "new",
			paymentStatuses: ["unpaid"],
			paymentMethods: ["cash"],
			source: "counter",
			attributionSources: ["tiktok"],
			dateFrom: 9_000_000,
			dateTo: 9_100_000,
			fulfilmentWindow: "today",
			mockupPending: true,
			searchText: "nothing-matches-this",
			showPinned: true,
		});
		expect(p(pinned)).toBe(true);
	});

	test("without showPinned a pinned order is filtered like any other", () => {
		expect(buildInboxPredicate({ bucket: "new" })(pinned)).toBe(false);
		expect(
			buildInboxPredicate({ bucket: "new", showPinned: false })(pinned),
		).toBe(false);
	});

	test("turning the toggle off does NOT hide a pin that legitimately matches", () => {
		// The toggle removes the pin's privilege; it is not a "hide my pins"
		// switch. A pinned order inside the filter is still in the filter.
		const matching = order({ status: "pending", pinnedAt: 5_000 });
		expect(
			buildInboxPredicate({ bucket: "new", showPinned: false })(matching),
		).toBe(true);
	});

	test("showPinned does not smuggle in UNpinned orders", () => {
		const p = buildInboxPredicate({ bucket: "new", showPinned: true });
		expect(p(order({ status: "delivered" }))).toBe(false);
	});
});

describe("sortInboxOrders — pinned partition", () => {
	const rows = [
		{ id: "c", createdAt: 3_000, fulfilmentDate: 30 },
		{ id: "b", createdAt: 2_000, fulfilmentDate: 10, pinnedAt: 100 },
		{ id: "a", createdAt: 1_000, fulfilmentDate: 20, pinnedAt: 200 },
	];

	test("recent: pins lead, most-recently-pinned first", () => {
		expect(sortInboxOrders(rows, "recent").map((o) => o.id)).toEqual([
			"a",
			"b",
			"c",
		]);
	});

	test("due: pins still lead, ordered by due date among themselves", () => {
		// b is due sooner than a, so inside the pinned group b wins — the pinned
		// group obeys the active sort rather than becoming a second list with
		// its own rules.
		expect(sortInboxOrders(rows, "due").map((o) => o.id)).toEqual([
			"b",
			"a",
			"c",
		]);
	});

	test("a pin sorts ahead even when its due date is the furthest out", () => {
		const late = [
			{ id: "soon", fulfilmentDate: 1 },
			{ id: "pinned-late", fulfilmentDate: 999, pinnedAt: 1 },
		];
		expect(sortInboxOrders(late, "due").map((o) => o.id)).toEqual([
			"pinned-late",
			"soon",
		]);
	});

	test("no pins leaves the existing ordering untouched", () => {
		const plain = [
			{ id: "x", fulfilmentDate: 20 },
			{ id: "y", fulfilmentDate: 10 },
		];
		expect(sortInboxOrders(plain, "recent").map((o) => o.id)).toEqual(["x", "y"]);
		expect(sortInboxOrders(plain, "due").map((o) => o.id)).toEqual(["y", "x"]);
	});

	test("never mutates the input", () => {
		const input = [...rows];
		sortInboxOrders(input, "due");
		expect(input.map((o) => o.id)).toEqual(["c", "b", "a"]);
	});

	test("dateless pins still lead, and dateless non-pins still sink", () => {
		const mixed = [
			{ id: "dated", fulfilmentDate: 5 },
			{ id: "dateless" },
			{ id: "dateless-pin", pinnedAt: 1 },
		];
		expect(sortInboxOrders(mixed, "due").map((o) => o.id)).toEqual([
			"dateless-pin",
			"dated",
			"dateless",
		]);
	});
});
