import { describe, expect, test } from "vitest";
import { AWB_DEFAULTS, type AwbConfig } from "../awbConfig";
import {
	addressLines,
	type AwbBatchItem,
	awbSortKey,
	compareAwbItems,
	formatParcelWeight,
	isReadyToShipForLabel,
	labelSkipReason,
	type OrderForAwb,
	orderToAwbLabelData,
	type RetailerForAwb,
	sortAwbItems,
} from "./awb";

const retailer: RetailerForAwb = {
	storeName: "Wagyu Walid",
	waPhone: "60123456789",
	businessAddress: { label: "12, Jalan Kenanga 3, 40400 Shah Alam, Selangor" },
};

const myAddress = {
	line1: "B-12-3, Residensi Suria",
	line2: "Jalan Puchong Perdana 5/2",
	city: "Puchong",
	state: "Selangor",
	postcode: "47100",
	notes: "Gate code 1234",
};

const sgAddress = {
	line1: "Blk 123 Ang Mo Kio Ave 4, #05-678",
	city: "Singapore",
	state: "Singapore",
	postcode: "560123",
};

function order(overrides: Partial<OrderForAwb> = {}): OrderForAwb {
	return {
		shortId: "ORD-1234",
		createdAt: Date.UTC(2026, 7, 18),
		status: "packed",
		paymentStatus: "received",
		deliveryAddress: myAddress,
		customer: { name: "Nur Aisyah", waPhone: "601159399791" },
		items: [
			{ name: "Ribeye", variantLabel: "500g", quantity: 2 },
			{ name: "Short rib", quantity: 1 },
		],
		total: 12800,
		currency: "MYR",
		fulfilmentDate: Date.UTC(2026, 7, 21),
		fulfilmentTimeMinutes: 15 * 60 + 30,
		...overrides,
	};
}

function label(o: OrderForAwb, config: Partial<AwbConfig> = {}) {
	return orderToAwbLabelData({
		order: o,
		retailer,
		config: { ...AWB_DEFAULTS, ...config },
	});
}

describe("labelSkipReason", () => {
	test("a live order with a delivery address can be labelled", () => {
		expect(labelSkipReason(order())).toBeNull();
	});

	test("no delivery address (pickup / most counter sales) is skipped", () => {
		expect(labelSkipReason(order({ deliveryAddress: undefined }))).toBe(
			"no_address",
		);
	});

	test("cancelled is skipped, and named ahead of a missing address", () => {
		expect(labelSkipReason(order({ status: "cancelled" }))).toBe("cancelled");
		expect(
			labelSkipReason({ status: "cancelled", deliveryAddress: undefined }),
		).toBe("cancelled");
	});
});

describe("isReadyToShipForLabel", () => {
	test("packed + paid + parcel delivery is ready", () => {
		expect(isReadyToShipForLabel(order())).toBe(true);
	});

	test.each([
		["not packed yet", { status: "confirmed" }],
		["already sent", { status: "shipped" }],
		["cancelled", { status: "cancelled" }],
		["unpaid", { paymentStatus: "unpaid" }],
		["payment only claimed", { paymentStatus: "claimed" }],
		["self-collect", { deliveryMethod: "self_collect", deliveryAddress: undefined }],
		["no address", { deliveryAddress: undefined }],
		// A collection rider travels buyer → seller, so "packed" there is work in
		// progress, not a parcel waiting on a courier.
		["a collection order", { deliveryDirection: "collection" }],
	])("%s is not ready", (_why, overrides) => {
		expect(isReadyToShipForLabel(order(overrides as Partial<OrderForAwb>))).toBe(
			false,
		);
	});

	test("a legacy order with no deliveryMethod reads as delivery", () => {
		expect(isReadyToShipForLabel(order({ deliveryMethod: undefined }))).toBe(
			true,
		);
	});
});

describe("addressLines", () => {
	test("MY: street, postcode + city, then the state", () => {
		expect(addressLines(myAddress)).toEqual([
			"B-12-3, Residensi Suria",
			"Jalan Puchong Perdana 5/2",
			"47100 Puchong",
			"Selangor",
		]);
	});

	test("SG: never prints 'Singapore, Singapore'", () => {
		expect(addressLines(sgAddress)).toEqual([
			"Blk 123 Ang Mo Kio Ave 4, #05-678",
			"560123 Singapore",
		]);
	});
});

describe("formatParcelWeight", () => {
	test("under a kilo stays grams; above reads in kilos", () => {
		expect(formatParcelWeight(850)).toBe("850 g");
		expect(formatParcelWeight(1200)).toBe("1.20 kg");
		expect(formatParcelWeight(1000)).toBe("1.00 kg");
	});

	test("an unknown or zero weight is no weight at all", () => {
		expect(formatParcelWeight(0)).toBeUndefined();
		expect(formatParcelWeight(Number.NaN)).toBeUndefined();
	});
});

describe("orderToAwbLabelData", () => {
	test("standard delivery: store sends, buyer receives", () => {
		const l = label(order());
		expect(l.sender.heading).toBe("From");
		expect(l.sender.name).toBe("Wagyu Walid");
		expect(l.recipient.heading).toBe("Deliver to");
		expect(l.recipient.name).toBe("Nur Aisyah");
		expect(l.recipient.phone).toBe("+60 1159399791");
		expect(l.recipient.notes).toBe("Gate code 1234");
		expect(l.fulfilmentLabel).toContain("Deliver on");
	});

	test("a collection order swaps the parties and the headings", () => {
		const l = label(order({ deliveryDirection: "collection" }));
		expect(l.sender.heading).toBe("Collect from");
		expect(l.sender.name).toBe("Nur Aisyah");
		expect(l.recipient.heading).toBe("Return to");
		expect(l.recipient.name).toBe("Wagyu Walid");
		expect(l.fulfilmentLabel).toContain("Collect on");
	});

	test("an unpaid order prints the amount to collect", () => {
		expect(label(order({ paymentStatus: "unpaid" })).payment).toEqual({
			kind: "cod",
			amount: 12800,
		});
	});

	test("a settled order prints PAID, never a COD figure (no double payment)", () => {
		expect(label(order()).payment).toEqual({ kind: "paid" });
	});

	test("a claimed-but-unconfirmed payment still counts as to-collect", () => {
		expect(label(order({ paymentStatus: "claimed" })).payment).toEqual({
			kind: "cod",
			amount: 12800,
		});
	});

	test("an unsettled delivery charge means the total isn't final yet", () => {
		expect(
			label(order({ paymentStatus: "unpaid", deliveryFeePending: true })).payment,
		).toEqual({ kind: "cod_pending" });
	});

	test("the payment strip can be turned off entirely", () => {
		expect(label(order(), { showCod: false }).payment).toBeUndefined();
		expect(
			label(order({ paymentStatus: "unpaid" }), { showCod: false }).payment,
		).toBeUndefined();
	});

	test("weight prints only when the whole cart could be weighed", () => {
		const withWeight = orderToAwbLabelData({
			order: order(),
			retailer,
			config: AWB_DEFAULTS,
			weightGrams: 1200,
		});
		expect(withWeight.weightLabel).toBe("1.20 kg");
		// No grams resolved (a custom line, or a variant with no parcel weight).
		expect(label(order()).weightLabel).toBeUndefined();
	});

	test("weight can be turned off even when it is known", () => {
		expect(
			orderToAwbLabelData({
				order: order(),
				retailer,
				config: { ...AWB_DEFAULTS, showWeight: false },
				weightGrams: 1200,
			}).weightLabel,
		).toBeUndefined();
	});

	test("contents are off by default and name the variant when on", () => {
		expect(label(order()).items).toBeUndefined();
		expect(label(order(), { showItems: true }).items).toEqual([
			{ name: "Ribeye (500g)", quantity: 2 },
			{ name: "Short rib", quantity: 1 },
		]);
		// Units are counted whether or not the list prints.
		expect(label(order()).totalUnits).toBe(3);
	});

	test("the order note obeys its toggle", () => {
		const withNote = order({ customerNote: "Leave at guardhouse" });
		expect(label(withNote).note).toBe("Leave at guardhouse");
		expect(label(withNote, { showNote: false }).note).toBeUndefined();
	});

	test("an unnamed buyer falls back to a phone a courier can call", () => {
		expect(label(order({ customer: { waPhone: "60115939791" } })).recipient.name).toBe(
			"+60 115939791",
		);
		expect(label(order({ customer: {} })).recipient.name).toBe("Customer");
	});

	test("no courier or tracking number yet — the label still builds", () => {
		const l = label(order());
		expect(l.courierName).toBeUndefined();
		expect(l.trackingNo).toBeUndefined();
		expect(l.recipient.lines.length).toBeGreaterThan(0);
	});

	test("a dateless order simply has no fulfilment line", () => {
		expect(label(order({ fulfilmentDate: undefined })).fulfilmentLabel).toBeUndefined();
	});

	test("carries the order's own currency, not the platform's", () => {
		expect(
			label(order({ currency: "SGD", paymentStatus: "unpaid" })).currency,
		).toBe("SGD");
	});
});

// The page can only draw Latin-1 (see ./latin1). Every fallback in the builder
// therefore has to be chosen on the CLAMPED string — these pin that, because
// the failure mode is silent: a label that looks plausible and cannot be
// delivered. Singapore, where this stack is headed, writes names in Chinese as
// a matter of course.
describe("orderToAwbLabelData — text the page cannot draw", () => {
	const cjkCustomer = { name: "陈大文", waPhone: "6587836127" };

	test("a Chinese name prints the phone instead of a blank line", () => {
		const l = label(order({ customer: cjkCustomer }));
		expect(l.recipient.name).toBe("+65 87836127");
		// …and only once: the phone line underneath would be the same digits.
		expect(l.recipient.phone).toBeUndefined();
	});

	test("a printable name keeps its phone line", () => {
		const l = label(order());
		expect(l.recipient.name).toBe("Nur Aisyah");
		expect(l.recipient.phone).toBe("+60 1159399791");
	});

	test("no name AND no printable phone still names the block", () => {
		expect(label(order({ customer: { name: "陈大文" } })).recipient.name).toBe(
			"Customer",
		);
	});

	test("a Chinese address never prints orphaned house numbers alone", () => {
		const l = label(
			order({
				customer: cjkCustomer,
				deliveryAddress: {
					line1: "新加坡乌节路238号",
					line2: "第12层",
					city: "新加坡",
					state: "Singapore",
					postcode: "238877",
				},
			}),
		);
		// Whatever survived may still be printed — a house number is worth having
		// — but never on its own authority.
		expect(l.recipient.warning).toBe("! Address incomplete - check the order");
		expect(l.recipient.name).toBe("+65 87836127");
	});

	test("a partly-Chinese address keeps what it can and still warns", () => {
		const l = label(
			order({
				deliveryAddress: {
					line1: "Blk 123 Ang Mo Kio Ave 4, #05-678",
					line2: "红山镇",
					city: "Singapore",
					state: "Singapore",
					postcode: "560123",
				},
			}),
		);
		expect(l.recipient.lines).toEqual([
			"Blk 123 Ang Mo Kio Ave 4, #05-678",
			"560123 Singapore",
		]);
		expect(l.recipient.warning).toBe("! Address incomplete - check the order");
	});

	test("an address that prints in full carries no warning", () => {
		expect(label(order()).recipient.warning).toBeUndefined();
		expect(label(order()).sender.warning).toBeUndefined();
	});

	test("a curly apostrophe is folded, not lost — and never warns", () => {
		const l = label(
			order({
				deliveryAddress: { ...myAddress, line1: "12 Jalan O’Brien" },
			}),
		);
		expect(l.recipient.lines[0]).toBe("12 Jalan O'Brien");
		expect(l.recipient.warning).toBeUndefined();
	});

	test("a two-line delivery note is joined with a space, no false alarm", () => {
		// The address textarea is rows={2} and sanitizeAddress keeps inner
		// newlines — exactly the note a buyer writes. A clean English note must
		// never print the incomplete-address warning (false alarms are how the
		// real CJK warning gets ignored), and the joined words must keep a space.
		const l = label(
			order({
				deliveryAddress: { ...myAddress, notes: "Ring bell\nGate 4321" },
			}),
		);
		expect(l.recipient.notes).toBe("Ring bell Gate 4321");
		expect(l.recipient.warning).toBeUndefined();
	});

	test("losing the gate code counts — it is addressing information", () => {
		const l = label(
			order({ deliveryAddress: { ...myAddress, notes: "门禁密码 1234" } }),
		);
		expect(l.recipient.notes).toBe("1234");
		expect(l.recipient.warning).toBe("! Address incomplete - check the order");
	});

	test("the store's own unprintable address warns about Settings", () => {
		const l = orderToAwbLabelData({
			order: order(),
			retailer: {
				storeName: "🎂",
				waPhone: "60123456789",
				businessAddress: { label: "吉隆坡孟沙区" },
			},
			config: AWB_DEFAULTS,
		});
		// An emoji-only store name would have drawn as nothing at the top of the
		// label; the neutral fallback has to fire.
		expect(l.storeName).toBe("Store");
		expect(l.sender.name).toBe("Store");
		expect(l.sender.lines).toEqual([]);
		expect(l.sender.warning).toBe("! Return address incomplete - check Settings");
	});

	test("a Chinese product name never prints as a bare quantity", () => {
		const l = label(
			order({
				items: [
					{ name: "肥牛", variantLabel: "大", quantity: 2 },
					{ name: "Short rib", variantLabel: "1kg", quantity: 1 },
				],
			}),
			{ showItems: true },
		);
		// The packing list is a hint, not addressing: what survives is printed,
		// and what doesn't leaves a neutral word rather than "2 x" or "肥牛 ()".
		expect(l.items).toEqual([
			{ name: "Item", quantity: 2 },
			{ name: "Short rib (1kg)", quantity: 1 },
		]);
	});

	test("an unprintable note or courier drops out instead of printing empty", () => {
		const l = label(
			order({ customerNote: "请放在门口", courierName: "顺丰", trackingNo: "SF123456" }),
		);
		expect(l.note).toBeUndefined();
		expect(l.courierName).toBeUndefined();
		expect(l.trackingNo).toBe("SF123456");
	});
});

describe("batch sorting", () => {
	function item(
		overrides: Partial<OrderForAwb>,
	): AwbBatchItem {
		const o = order(overrides);
		return { label: label(o), sort: awbSortKey(o) };
	}

	const early = item({
		shortId: "ORD-0001",
		fulfilmentDate: Date.UTC(2026, 7, 20),
		courierName: "J&T Express",
		status: "confirmed",
	});
	const late = item({
		shortId: "ORD-0002",
		fulfilmentDate: Date.UTC(2026, 7, 25),
		courierName: "Ninja Van",
		status: "packed",
	});
	const dateless = item({ shortId: "ORD-0003", fulfilmentDate: undefined });

	test("fulfilment: soonest first, dateless last", () => {
		const sorted = sortAwbItems([dateless, late, early], "fulfilment");
		expect(sorted.map((i) => i.label.orderShortId)).toEqual([
			"ORD-0001",
			"ORD-0002",
			"ORD-0003",
		]);
	});

	test("courier: alphabetical, with 'no courier yet' last", () => {
		const none = item({ shortId: "ORD-0004", courierName: undefined });
		const sorted = sortAwbItems([none, late, early], "courier");
		expect(sorted.map((i) => i.label.courierName ?? "-")).toEqual([
			"J&T Express",
			"Ninja Van",
			"-",
		]);
	});

	test("status: the pipeline order the seller works through", () => {
		const sorted = sortAwbItems([late, early], "status");
		expect(sorted.map((i) => i.sort.status)).toEqual(["confirmed", "packed"]);
	});

	test("area: state, then town, then postcode", () => {
		const kl = item({
			shortId: "ORD-A",
			deliveryAddress: { ...myAddress, state: "WP Kuala Lumpur", city: "Cheras", postcode: "56000" },
		});
		const sel1 = item({
			shortId: "ORD-B",
			deliveryAddress: { ...myAddress, city: "Puchong", postcode: "47100" },
		});
		const sel2 = item({
			shortId: "ORD-C",
			deliveryAddress: { ...myAddress, city: "Puchong", postcode: "47120" },
		});
		expect(
			sortAwbItems([kl, sel2, sel1], "area").map((i) => i.label.orderShortId),
		).toEqual(["ORD-B", "ORD-C", "ORD-A"]);
	});

	test("SG area sort degrades to postal-sector order (no country branch)", () => {
		// Both city and state are the literal "Singapore", so postcode decides —
		// which in Singapore IS geographic.
		const north = item({
			shortId: "ORD-N",
			deliveryAddress: { ...sgAddress, postcode: "730123" },
		});
		const south = item({
			shortId: "ORD-S",
			deliveryAddress: { ...sgAddress, postcode: "088123" },
		});
		expect(
			sortAwbItems([north, south], "area").map((i) => i.label.orderShortId),
		).toEqual(["ORD-S", "ORD-N"]);
	});

	test("every sort is total — ties fall through to date then order number", () => {
		const a = item({ shortId: "ORD-AAAA" });
		const b = item({ shortId: "ORD-BBBB" });
		expect(compareAwbItems(a, b, "status")).toBeLessThan(0);
		expect(compareAwbItems(b, a, "courier")).toBeGreaterThan(0);
		expect(compareAwbItems(a, a, "area")).toBe(0);
	});

	test("sorting doesn't mutate the input", () => {
		const input = [late, early];
		sortAwbItems(input, "fulfilment");
		expect(input[0].label.orderShortId).toBe("ORD-0002");
	});
});
