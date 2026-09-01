import { describe, expect, test } from "vitest";
import { todayMytMidnight } from "./fulfilmentDate";
import { BUCKET_LEAVES } from "./orderBuckets";
import {
	buildInboxPredicate,
	compareInboxOrder,
	type FilterableOrder,
	narrowsTheInbox,
	sortInboxOrders,
} from "./orderInboxFilter";

function order(overrides: Partial<FilterableOrder> = {}): FilterableOrder {
	return {
		status: "pending",
		createdAt: 1_000,
		shortId: "ORD-0001",
		customer: { name: "Aisha", waPhone: "+60123456789" },
		items: [{ name: "Vanilla Cake", variantLabel: "1kg", quantity: 1 }],
		subtotal: 12500,
		total: 12500,
		currency: "MYR",
		...overrides,
	};
}

describe("buildInboxPredicate — bucket", () => {
	test("'new' matches only pending", () => {
		const p = buildInboxPredicate({ statuses: [...BUCKET_LEAVES.new] });
		expect(p(order({ status: "pending" }))).toBe(true);
		expect(p(order({ status: "confirmed" }))).toBe(false);
	});
	test("'in_progress' spans confirmed/packed/shipped", () => {
		const p = buildInboxPredicate({ statuses: [...BUCKET_LEAVES.in_progress] });
		expect(p(order({ status: "packed" }))).toBe(true);
		expect(p(order({ status: "delivered" }))).toBe(false);
	});
	test("'all' matches every status", () => {
		const p = buildInboxPredicate({});
		expect(p(order({ status: "cancelled" }))).toBe(true);
	});
});

describe("buildInboxPredicate — payment", () => {
	test("undefined paymentStatus reads as unpaid", () => {
		const p = buildInboxPredicate({ paymentStatuses: ["unpaid"] });
		expect(p(order({ paymentStatus: undefined }))).toBe(true);
		expect(p(order({ paymentStatus: "received" }))).toBe(false);
	});
	test("method filter and 'unspecified' OR together", () => {
		const p = buildInboxPredicate({
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
		const p = buildInboxPredicate({ dateFrom: 100, dateTo: 200 });
		expect(p(order({ createdAt: 100 }))).toBe(true);
		expect(p(order({ createdAt: 200 }))).toBe(true);
		expect(p(order({ createdAt: 99 }))).toBe(false);
		expect(p(order({ createdAt: 201 }))).toBe(false);
	});
	test("fulfilmentWindow 'today' matches a today-dated order, not a far-future one", () => {
		const p = buildInboxPredicate({ fulfilmentWindow: "today" });
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
		const byId = buildInboxPredicate({ searchText: "ORD-0001" });
		expect(byId(order())).toBe(true);
		const byName = buildInboxPredicate({ searchText: "aish" });
		expect(byName(order())).toBe(true);
		const byItem = buildInboxPredicate({ searchText: "vanilla" });
		expect(byItem(order())).toBe(true);
		const byPhone = buildInboxPredicate({ searchText: "6789" });
		expect(byPhone(order())).toBe(true);
		const miss = buildInboxPredicate({ searchText: "zzzz" });
		expect(miss(order())).toBe(false);
	});
});

describe("buildInboxPredicate — mockupPending", () => {
	test("matches only orders awaiting the seller's mockup action", () => {
		const p = buildInboxPredicate({ mockupPending: true });
		expect(p(order({ mockupStatus: "pending" }))).toBe(true);
		expect(p(order({ mockupStatus: "changes_requested" }))).toBe(true);
		expect(p(order({ mockupStatus: "approved" }))).toBe(false);
		expect(p(order({ mockupStatus: undefined }))).toBe(false);
	});
});

describe("buildInboxPredicate — the status set is MULTI (86eyrtz74)", () => {
	test("undefined / empty means every bucket", () => {
		for (const args of [{}, { statuses: [] }]) {
			const p = buildInboxPredicate(args);
			expect(p(order({ status: "pending" }))).toBe(true);
			expect(p(order({ status: "cancelled" }))).toBe(true);
		}
	});

	test("two buckets' leaves OR together — 'everything closed' in one view", () => {
		// The ask that widened this: Completed + Cancelled at once, which the
		// old single-value chip could never show.
		const p = buildInboxPredicate({ statuses: [
			...BUCKET_LEAVES.completed,
			...BUCKET_LEAVES.cancelled,
		] });
		expect(p(order({ status: "delivered" }))).toBe(true);
		expect(p(order({ status: "cancelled" }))).toBe(true);
		expect(p(order({ status: "packed" }))).toBe(false);
		expect(p(order({ status: "pending" }))).toBe(false);
	});
});

describe("buildInboxPredicate — statuses (86eyrtz74)", () => {
	test("undefined / empty means no status filtering", () => {
		for (const args of [
			{},
			{ statuses: [] },
		]) {
			const p = buildInboxPredicate(args);
			expect(p(order({ status: "packed" }))).toBe(true);
			expect(p(order({ status: "cancelled" }))).toBe(true);
		}
	});

	test("several statuses OR together — the thing one bucket cannot express", () => {
		// "Out of my hands but not delivered" spans two statuses inside one
		// bucket, which is why the panel selects at leaf grain and not just by
		// group.
		const p = buildInboxPredicate({
			statuses: ["packed", "shipped"],
		});
		expect(p(order({ status: "packed" }))).toBe(true);
		expect(p(order({ status: "shipped" }))).toBe(true);
		expect(p(order({ status: "confirmed" }))).toBe(false);
		expect(p(order({ status: "delivered" }))).toBe(false);
	});

	test("a group's leaves plus a leaf from another group is a UNION, never an intersection", () => {
		// The 1-Sep rule. These used to be two ANDed fields — a chip row writing
		// `buckets` and a panel writing `statuses` — so "In progress" + "Collected"
		// matched NOTHING while both controls sat lit on screen. One set now, so it
		// means what a seller reading two lit chips assumes it means.
		const p = buildInboxPredicate({
			statuses: [...BUCKET_LEAVES.in_progress, "delivered"],
		});
		expect(p(order({ status: "packed" }))).toBe(true);
		expect(p(order({ status: "delivered" }))).toBe(true);
		expect(p(order({ status: "cancelled" }))).toBe(false);
	});

	test("the unseen half of `confirmed` filters as New, not as In progress", () => {
		// The reason leaves exist at all: this order's `status` is `confirmed`,
		// but the inbox shows it under New, so New must match it and In progress
		// must not. Reading `o.status` here is what made the two surfaces disagree.
		const unseen = order({
			status: "confirmed",
			confirmationPushStatus: "sent",
		});
		expect(buildInboxPredicate({ statuses: [...BUCKET_LEAVES.new] })(unseen)).toBe(
			true,
		);
		expect(
			buildInboxPredicate({ statuses: [...BUCKET_LEAVES.in_progress] })(unseen),
		).toBe(false);

		// Once opened it swaps sides, with no change to `status`.
		const opened = order({
			status: "confirmed",
			confirmationPushStatus: "sent",
			seenAt: 5,
		});
		expect(buildInboxPredicate({ statuses: [...BUCKET_LEAVES.new] })(opened)).toBe(
			false,
		);
		expect(
			buildInboxPredicate({ statuses: [...BUCKET_LEAVES.in_progress] })(opened),
		).toBe(true);
	});
});

describe("buildInboxPredicate — categories (86eyrtz74)", () => {
	const cake = order({
		items: [{ name: "Kek Lapis", quantity: 1, categoryNames: ["Cakes"] }],
	});
	const mixed = order({
		items: [
			{ name: "Kek Lapis", quantity: 1, categoryNames: ["Cakes"] },
			{ name: "Teh Ais", quantity: 1, categoryNames: ["Drinks"] },
		],
	});
	const uncategorised = order({
		items: [{ name: "Custom", quantity: 1, categoryNames: [] }],
	});
	const legacy = order({ items: [{ name: "Old order", quantity: 1 }] });

	test("undefined / empty means no category filtering", () => {
		for (const args of [
			{},
			{ categories: [] },
		]) {
			const p = buildInboxPredicate(args);
			expect(p(cake)).toBe(true);
			expect(p(legacy)).toBe(true);
		}
	});

	test("ANY line matching is enough — a mixed order is in both categories", () => {
		// "Show me the cake orders" has to include the ticket with a cake and a
		// drink on it, or the filter under-reports the seller's actual work.
		expect(buildInboxPredicate({ categories: ["Cakes"] })(mixed)).toBe(true);
		expect(buildInboxPredicate({ categories: ["Drinks"] })(mixed)).toBe(true);
	});

	test("several categories OR together", () => {
		const p = buildInboxPredicate({
			categories: ["Drinks", "Pastry"],
		});
		expect(p(mixed)).toBe(true);
		expect(p(cake)).toBe(false);
	});

	test("selecting every category WITHOUT the uncategorized arm still drops them", () => {
		// The bug (PR #235 review): `availableCategories` is tallied only from
		// orders that HAVE categories, so "select all" could never reach an
		// uncategorized order — while the panel claimed nothing was filtered.
		const p = buildInboxPredicate({ categories: ["Cakes", "Drinks"] });
		expect(p(mixed)).toBe(true);
		expect(p(uncategorised)).toBe(false);
		expect(p(legacy)).toBe(false);
	});

	test("categoriesUnspecified keeps the uncategorized ones", () => {
		const p = buildInboxPredicate({ categoriesUnspecified: true });
		expect(p(uncategorised)).toBe(true);
		// Absent (predates the field) reads the same as recorded-empty — both are
		// blank on screen, so both are "uncategorized" to a seller.
		expect(p(legacy)).toBe(true);
		expect(p(cake)).toBe(false);
	});

	test("every category PLUS uncategorized matches everything — the honest select-all", () => {
		const p = buildInboxPredicate({
			categories: ["Cakes", "Drinks"],
			categoriesUnspecified: true,
		});
		for (const o of [cake, mixed, uncategorised, legacy]) {
			expect(p(o)).toBe(true);
		}
	});

	test("uncategorized alone is a filter, not a no-op", () => {
		const p = buildInboxPredicate({ categoriesUnspecified: true });
		expect(p(mixed)).toBe(false);
	});

	test("orders with no recorded categories never match a named one", () => {
		const p = buildInboxPredicate({ categories: ["Cakes"] });
		expect(p(uncategorised)).toBe(false);
		// Pre-freeze orders that were never backfilled: absent, not empty.
		expect(p(legacy)).toBe(false);
	});
});

describe("buildInboxPredicate — source", () => {
	test("no source filter matches every checkout surface", () => {
		const p = buildInboxPredicate({});
		expect(p(order({ source: "storefront" }))).toBe(true);
		expect(p(order({ source: "counter" }))).toBe(true);
		expect(p(order({ source: undefined }))).toBe(true);
	});
	test("counter matches only counter orders", () => {
		const p = buildInboxPredicate({ sources: ["counter"] });
		expect(p(order({ source: "counter" }))).toBe(true);
		expect(p(order({ source: "storefront" }))).toBe(false);
		// Legacy orders have no stamped source — they are NOT counter sales.
		expect(p(order({ source: undefined }))).toBe(false);
	});
	test("storefront matches storefront AND legacy (undefined ⇒ storefront)", () => {
		const p = buildInboxPredicate({ sources: ["storefront"] });
		expect(p(order({ source: "storefront" }))).toBe(true);
		expect(p(order({ source: undefined }))).toBe(true);
		expect(p(order({ source: "counter" }))).toBe(false);
	});
	test("several surfaces OR together — the reason it became multi-select", () => {
		// "Everything that isn't a walk-in" is a real question, and one value
		// could never ask it.
		const p = buildInboxPredicate({
			sources: ["storefront", "claim"],
		});
		expect(p(order({ source: "storefront" }))).toBe(true);
		expect(p(order({ source: "claim" }))).toBe(true);
		expect(p(order({ source: "counter" }))).toBe(false);
	});
	test("an empty list means no filtering, not 'match nothing'", () => {
		const p = buildInboxPredicate({ sources: [] });
		expect(p(order({ source: "counter" }))).toBe(true);
	});
});

describe("buildInboxPredicate — attributionSources (86eyq0eq9)", () => {
	const tiktok = order({ attributionSource: "tiktok" });
	const instagram = order({ attributionSource: "instagram" });
	const untagged = order({ source: "storefront" });
	const counter = order({ source: "counter" });

	test("undefined / empty means no attribution filtering", () => {
		for (const args of [
			{},
			{ attributionSources: [] },
		]) {
			const p = buildInboxPredicate(args);
			expect([tiktok, instagram, untagged, counter].every(p)).toBe(true);
		}
	});

	test("one origin keeps only that origin", () => {
		const p = buildInboxPredicate({
			attributionSources: ["tiktok"],
		});
		expect(p(tiktok)).toBe(true);
		expect(p(instagram)).toBe(false);
		expect(p(untagged)).toBe(false);
		expect(p(counter)).toBe(false);
	});

	test("several origins OR together (the multi-select)", () => {
		const p = buildInboxPredicate({
			attributionSources: ["tiktok", "instagram"],
		});
		expect(p(tiktok)).toBe(true);
		expect(p(instagram)).toBe(true);
		expect(p(untagged)).toBe(false);
	});

	test("'direct' matches untagged storefront AND legacy sourceless orders", () => {
		const p = buildInboxPredicate({
			attributionSources: ["direct"],
		});
		expect(p(untagged)).toBe(true);
		expect(p(order({}))).toBe(true); // legacy: no source, no tag
		expect(p(counter)).toBe(false);
		expect(p(tiktok)).toBe(false);
	});

	test("'counter' matches counter orders, which are never stamped", () => {
		const p = buildInboxPredicate({
			attributionSources: ["counter"],
		});
		expect(p(counter)).toBe(true);
		expect(p(untagged)).toBe(false);
	});

	test("ANDs with the other filters rather than replacing them", () => {
		const p = buildInboxPredicate({
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
			sources: ["counter"],
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

	test("the default mode keeps a pinned order that fails the status set", () => {
		const p = buildInboxPredicate({ statuses: [...BUCKET_LEAVES.new], pinMode: "top" });
		expect(p(pinned)).toBe(true);
	});

	test("a pin outranks EVERY other filter at once, not just the status set", () => {
		const p = buildInboxPredicate({
			statuses: [...BUCKET_LEAVES.new],
			paymentStatuses: ["unpaid"],
			paymentMethods: ["cash"],
			sources: ["counter"],
			categories: ["Nothing Matches This"],
			attributionSources: ["tiktok"],
			dateFrom: 9_000_000,
			dateTo: 9_100_000,
			fulfilmentWindow: "today",
			mockupPending: true,
			searchText: "nothing-matches-this",
			pinMode: "top",
		});
		expect(p(pinned)).toBe(true);
	});

	test("mode off filters a pinned order like any other", () => {
		expect(
			buildInboxPredicate({ statuses: [...BUCKET_LEAVES.new], pinMode: "off" })(pinned),
		).toBe(false);
		// …and the default is NOT off: an absent mode is "top" (the product
		// default), which is why every production caller reaches this through
		// `toInboxFilterArgs` — that sets the mode explicitly, so a pre-"only"
		// client sending no `showPinned` still gets its old "off" behaviour
		// rather than silently gaining pin privilege.
		expect(buildInboxPredicate({ statuses: [...BUCKET_LEAVES.new] })(pinned)).toBe(true);
	});

	test("turning the toggle off does NOT hide a pin that legitimately matches", () => {
		// The toggle removes the pin's privilege; it is not a "hide my pins"
		// switch. A pinned order inside the filter is still in the filter.
		const matching = order({ status: "pending", pinnedAt: 5_000 });
		expect(
			buildInboxPredicate({ statuses: [...BUCKET_LEAVES.new], pinMode: "off" })(matching),
		).toBe(true);
	});

	test("keeping pins on top does not smuggle in UNpinned orders", () => {
		const p = buildInboxPredicate({ statuses: [...BUCKET_LEAVES.new], pinMode: "top" });
		expect(p(order({ status: "delivered" }))).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// `pinMode: "only"` — the seller's pinned-only inbox (owner call, 1 Sep),
// reached by tapping the Pinned chip a second time. It deliberately ANDs with
// the rest of the filters rather than short-circuiting them, so the lit status
// chips keep meaning what they say — these tests pin exactly that.
// ---------------------------------------------------------------------------

describe('buildInboxPredicate - pinMode "only"', () => {
	test("keeps pinned orders and drops everything else", () => {
		const p = buildInboxPredicate({ pinMode: "only" });
		expect(p(order({ status: "delivered", pinnedAt: 5_000 }))).toBe(true);
		expect(p(order({ status: "pending" }))).toBe(false);
		expect(p(order({ status: "confirmed" }))).toBe(false);
	});

	test("still ANDs with the rest - a lit status chip must not become a lie", () => {
		const p = buildInboxPredicate({ pinMode: "only", statuses: [...BUCKET_LEAVES.new] });
		expect(p(order({ status: "pending", pinnedAt: 1 }))).toBe(true);
		// Pinned, but not in the selected bucket: the chip says New, so a
		// Completed order must not appear under it.
		expect(p(order({ status: "delivered", pinnedAt: 1 }))).toBe(false);
	});

	test('"top" is the default, so an absent mode keeps pins on top', () => {
		const pinned = order({ status: "delivered", pinnedAt: 5_000 });
		expect(buildInboxPredicate({ statuses: [...BUCKET_LEAVES.new] })(pinned)).toBe(true);
	});

	test("pinning is all-tier in every mode, so none of them gates", () => {
		expect(narrowsTheInbox({ pinMode: "only" })).toBe(false);
		expect(narrowsTheInbox({ pinMode: "off" })).toBe(false);
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

describe("buildInboxPredicate — search spans every column (86eyrtz74)", () => {
	// Search used to cover order #, customer name, phone and item names only —
	// so "find the order with tracking 630002864925" or "the one going to
	// Puchong" simply didn't work. It now runs over the same column registry the
	// table renders and the CSV writes.
	const rich = order({
		shortId: "ORD-7788",
		customer: { name: "Nurul Ain", waPhone: "+60123456789" },
		items: [{ name: "Kek Lapis", variantLabel: "1kg", quantity: 2 }],
		deliveryAddress: {
			line1: "12 Jalan Kenari 5",
			city: "Puchong",
			state: "Selangor",
			postcode: "47100",
			notes: "Gate code 1234",
		},
		courierName: "J&T Express",
		trackingNo: "630002864925",
		paymentReference: "MBB-88213",
		customerNote: "no onions please",
		attributionSource: "tiktok",
		pickupSnapshot: { label: "Setapak stall", address: "3 Jalan Genting" },
		cancelledReason: "Buyer changed mind",
	});
	const hits = (term: string) =>
		buildInboxPredicate({ searchText: term })(rich);

	test("finds by the fields it always could", () => {
		expect(hits("ORD-7788")).toBe(true);
		expect(hits("nurul")).toBe(true);
		expect(hits("kek lapis")).toBe(true);
	});

	test("finds by tracking number, courier and payment reference", () => {
		expect(hits("630002864925")).toBe(true);
		expect(hits("j&t")).toBe(true);
		expect(hits("MBB-88213")).toBe(true);
	});

	test("finds by any part of the delivery address", () => {
		expect(hits("jalan kenari")).toBe(true);
		expect(hits("puchong")).toBe(true);
		expect(hits("47100")).toBe(true);
		expect(hits("gate code")).toBe(true);
	});

	test("finds by pickup outlet, note, origin and cancel reason", () => {
		expect(hits("setapak")).toBe(true);
		expect(hits("no onions")).toBe(true);
		expect(hits("tiktok")).toBe(true);
		expect(hits("changed mind")).toBe(true);
	});

	test("is case-insensitive and still rejects a genuine miss", () => {
		expect(hits("PUCHONG")).toBe(true);
		expect(hits("kuala lumpur")).toBe(false);
	});

	test("phone still matches on TRAILING digits, which substring can't do", () => {
		// "123456789" has to find "+60123456789" however the seller typed it.
		expect(hits("123456789")).toBe(true);
		expect(hits("60123456789")).toBe(true);
	});

	test("an order with none of those fields is unaffected", () => {
		const plain = order({ shortId: "ORD-0002" });
		expect(
			buildInboxPredicate({ searchText: "puchong" })(plain),
		).toBe(false);
		expect(
			buildInboxPredicate({ searchText: "ORD-0002" })(plain),
		).toBe(true);
	});

	test("search still ANDs with the other filters, never ORs", () => {
		expect(
			buildInboxPredicate({
				statuses: [...BUCKET_LEAVES.completed],
				searchText: "puchong",
			})(rich),
		).toBe(false);
	});
});

describe("search matches both the stored value and the on-screen wording", () => {
	// A seller typing "storefront" is reading the Order type column; one typing
	// "received" may be reading an old export or a colleague's note. Neither
	// guess should come back empty (86eyrtz74).
	const o = order({ source: "storefront", paymentStatus: "received" });

	test("finds an order by the word the column shows", () => {
		expect(buildInboxPredicate({ searchText: "storefront" })(o)).toBe(true);
		expect(buildInboxPredicate({ searchText: "paid" })(o)).toBe(true);
	});

	test("finds it by the value the CSV writes", () => {
		expect(buildInboxPredicate({ searchText: "received" })(o)).toBe(true);
	});

	test("still misses what the order genuinely is not", () => {
		expect(buildInboxPredicate({ searchText: "counter" })(o)).toBe(false);
	});
});

describe("buildInboxPredicate — booking period (S8)", () => {
	const NOW = Date.UTC(2026, 8, 15, 6, 30);
	const today = todayMytMidnight(NOW);
	const DAY = 86_400_000;
	const booking = (from: number, to: number, extra: Partial<FilterableOrder> = {}) =>
		order({
			status: "confirmed",
			deliveryMethod: "booking",
			bookingCheckIn: today + from * DAY,
			bookingCheckOut: today + to * DAY,
			...extra,
		});

	test("keeps only active bookings, and never a plain product order", () => {
		const p = buildInboxPredicate({ bookingPeriods: ["active"] }, NOW);
		expect(p(booking(-2, 3))).toBe(true);
		expect(p(booking(2, 5))).toBe(false); // upcoming
		expect(p(booking(-9, -2))).toBe(false); // ended
		// The trap: a product order has no span, so "Active" must exclude it —
		// otherwise the chip would keep the whole product inbox.
		expect(p(order({ status: "confirmed" }))).toBe(false);
	});

	test("ANDs with the other dimensions rather than replacing them", () => {
		// The reason this is a chip and not a bucket: an active booking is also
		// `in_progress`, so the two compose.
		const p = buildInboxPredicate(
			{ bookingPeriods: ["active"], paymentStatuses: ["unpaid"] },
			NOW,
		);
		expect(p(booking(-1, 4, { paymentStatus: "unpaid" }))).toBe(true);
		expect(p(booking(-1, 4, { paymentStatus: "received" }))).toBe(false);
		const withBucket = buildInboxPredicate(
			{ bookingPeriods: ["active"], statuses: [...BUCKET_LEAVES.in_progress] },
			NOW,
		);
		expect(withBucket(booking(-1, 4))).toBe(true);
	});

	test("an empty period list filters nothing", () => {
		const p = buildInboxPredicate({ bookingPeriods: [] }, NOW);
		expect(p(order({ status: "confirmed" }))).toBe(true);
	});

	test("a pinned order still outranks the period filter", () => {
		// Pin privilege short-circuits every rule; a new one must not be the
		// exception that quietly breaks it.
		const p = buildInboxPredicate(
			{ bookingPeriods: ["active"], pinMode: "top" },
			NOW,
		);
		expect(p(order({ status: "confirmed", pinnedAt: 1 }))).toBe(true);
	});
});

describe("narrowsTheInbox — the Pro gate", () => {
	test("booking periods do NOT trip it; every other filter does", () => {
		// Booking is all-tier (S4 put the seller calendar outside this same
		// gate). A store with a free calendar that must pay to ask "who is here
		// right now" would be incoherent.
		expect(narrowsTheInbox({ bookingPeriods: ["active"] })).toBe(false);
		expect(narrowsTheInbox({ paymentStatuses: ["unpaid"] })).toBe(true);
		expect(narrowsTheInbox({})).toBe(false);
	});
});
