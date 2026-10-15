import { describe, expect, it } from "vitest";
import {
	type FlowProduct,
	matchesSearch,
	overridesFromCurrent,
	pickerSections,
	reviewBlockedReason,
	reviewLinesFor,
	saleLineCount,
	summariseReview,
	timeLeft,
	windowLine,
} from "./promotion-flow";

/**
 * The bulk promotion flow's rules (`z8r3fducfd`). What the review shows and
 * what Save sends are the same computation, so a line the seller saw as
 * "RM 14.40" can never be sent as something else.
 */

const cake: FlowProduct = {
	_id: "p1",
	name: "Cake",
	isBooking: false,
	isEvent: false,
	variants: [
		{ _id: "v1", label: "Small", price: 2000 },
		{ _id: "v2", label: "Large", price: 3000 },
		{ _id: "v3", label: "Custom", price: 0 },
		{ _id: "v4", label: "Crumb", price: 5 },
	],
};

describe("reviewLinesFor", () => {
	it("prices every line by the shared 5-sen rule, and names the ones that can't go on sale", () => {
		const lines = reviewLinesFor(cake, 20, {});
		expect(lines.map((l) => (l.kind === "sale" ? l.input : l.reason))).toEqual([
			"16.00",
			"24.00",
			"Not on sale · priced by quote",
			"Not on sale · too small to discount",
		]);
	});

	it("a typed price wins, and is marked as edited", () => {
		const [small] = reviewLinesFor(cake, 20, { v1: "15.00" });
		expect(small.kind === "sale" && small.sen).toBe(1500);
		expect(small.kind === "sale" && small.edited).toBe(true);
	});

	it("a typed price at or above list says why, beneath the field", () => {
		const [small] = reviewLinesFor(cake, 20, { v1: "20.00" });
		expect(small.kind === "sale" && small.issue).toBe(
			"Must be below the normal price.",
		);
		expect(small.kind === "sale" && small.sen).toBeNull();
	});

	it("a blank line is a choice, not an error — it stays at full price", () => {
		const [small] = reviewLinesFor(cake, 20, { v1: "" });
		expect(small.kind === "sale" && small.issue).toBeUndefined();
		expect(small.kind === "sale" && small.sen).toBeNull();
	});
});

describe("summariseReview — what Save sends", () => {
	it("sends only the sale lines, and counts the rest", () => {
		const s = summariseReview([cake], 20, { v2: "" });
		expect(s.members).toEqual([
			{ productId: "p1", prices: [{ variantId: "v1", promoPrice: 1600 }] },
		]);
		expect(s).toMatchObject({ onSale: 1, total: 4, blank: 1, invalid: 0 });
	});

	it("Save says why it's off — never a silent no-op", () => {
		expect(
			reviewBlockedReason(summariseReview([cake], 20, { v1: "abc" })),
		).toMatch(/can't be saved as typed/);
		expect(
			reviewBlockedReason(summariseReview([cake], 20, { v1: "", v2: "" })),
		).toMatch(/Nothing is on sale yet/);
		expect(reviewBlockedReason(summariseReview([cake], 20, {}))).toBeNull();
	});
});

describe("overridesFromCurrent — an edit starts from what's live", () => {
	it("seeds each line with its current sale price, and blank where there is none", () => {
		const live: FlowProduct = {
			...cake,
			variants: [
				{ _id: "v1", label: "Small", price: 2000, promoPrice: 1500 },
				{ _id: "v2", label: "Large", price: 3000 },
			],
		};
		expect(overridesFromCurrent([live])).toEqual({ v1: "15.00", v2: "" });
	});
});

describe("pickerSections", () => {
	const products = [
		{ _id: "a", categoryIds: ["kuih"] },
		{ _id: "b", categoryIds: ["kuih", "cakes"] },
		{ _id: "c", categoryIds: [] },
	];
	it("follows the seller's category order, lists a two-category product in both, and keeps the rest", () => {
		const sections = pickerSections(products, [
			{ _id: "cakes", name: "Cakes" },
			{ _id: "kuih", name: "Kuih" },
		]);
		expect(sections.map((s) => [s.name, s.productIds])).toEqual([
			["Cakes", ["b"]],
			["Kuih", ["a", "b"]],
			["Other products", ["c"]],
		]);
	});

	it("a store with no categories gets one honest group", () => {
		expect(pickerSections(products, [])[0].name).toBe("All products");
	});

	it("an empty category isn't a group", () => {
		expect(
			pickerSections(products, [{ _id: "empty", name: "Empty" }]).some(
				(s) => s.name === "Empty",
			),
		).toBe(false);
	});
});

describe("display helpers", () => {
	it("matchesSearch reads the name and the item code", () => {
		expect(matchesSearch({ name: "Kuih lapis", sku: "KL-10" }, "kl-1")).toBe(
			true,
		);
		expect(matchesSearch({ name: "Kuih lapis" }, "LAPIS")).toBe(true);
		expect(matchesSearch({ name: "Kuih lapis" }, "cake")).toBe(false);
	});

	it("timeLeft uses the house grain", () => {
		expect(timeLeft(102 * 60_000)).toBe("1h 42m");
		expect(timeLeft((3 * 24 + 4) * 3_600_000)).toBe("3d 4h");
		expect(timeLeft(-5)).toBe("0m");
	});

	it("windowLine says an open-ended sale runs until it's ended", () => {
		expect(windowLine({}, "live", 0)).toMatch(/until you end it/);
	});

	it("saleLineCount counts priced lines only", () => {
		expect(
			saleLineCount([
				{ _id: "1", label: "", price: 1000, promoPrice: 800 },
				{ _id: "2", label: "", price: 1000 },
				{ _id: "3", label: "", price: 0 },
			]),
		).toEqual({ onSale: 1, priced: 2 });
	});
});
