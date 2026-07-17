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
