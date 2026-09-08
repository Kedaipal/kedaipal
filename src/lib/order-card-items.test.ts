import { describe, expect, it } from "vitest";
import {
	ORDER_CARD_MAX_ITEM_LINES,
	summarizeOrderCardItems,
	withLineKeys,
} from "./order-card-items";

const item = (
	name: string,
	price: number,
	quantity: number,
	variant?: string,
) => ({
	name,
	price,
	quantity,
	...(variant ? { variantLabel: variant } : {}),
});

describe("summarizeOrderCardItems", () => {
	it("shows a single item with its line total (price × qty)", () => {
		const s = summarizeOrderCardItems([item("Burnt Cheesecake", 4800, 2)]);
		expect(s.lines).toHaveLength(1);
		expect(s.lines[0].lineTotal).toBe(9600);
		expect(s.moreCount).toBe(0);
		expect(s.moreAmount).toBe(0);
	});

	it("shows all items when at the cap", () => {
		const s = summarizeOrderCardItems([
			item("Pavlova", 6800, 1, "6 inch"),
			item("Burnt Cheesecake", 4800, 2),
		]);
		expect(s.lines).toHaveLength(2);
		expect(s.moreCount).toBe(0);
	});

	it("shows cap+1 items in full — folding would not save a row", () => {
		const s = summarizeOrderCardItems([
			item("Pavlova", 6800, 1),
			item("Burnt Cheesecake", 4800, 2),
			item("Kuih Lapis", 1500, 1),
		]);
		expect(s.lines).toHaveLength(3);
		expect(s.moreCount).toBe(0);
	});

	it("folds beyond cap+1 into one row with the aggregated amount", () => {
		const s = summarizeOrderCardItems([
			item("Pavlova", 6800, 1),
			item("Burnt Cheesecake", 4800, 2),
			item("Kuih Lapis", 1500, 2),
			item("Choc Moist Slice", 900, 1),
		]);
		expect(s.lines).toHaveLength(ORDER_CARD_MAX_ITEM_LINES);
		expect(s.moreCount).toBe(2);
		expect(s.moreAmount).toBe(1500 * 2 + 900);
	});

	it("visible amounts + moreAmount always reconstruct the items subtotal", () => {
		const items = [
			item("A", 1000, 3),
			item("B", 2500, 1),
			item("C", 700, 4),
			item("D", 12000, 2),
			item("E", 50, 9),
		];
		const s = summarizeOrderCardItems(items);
		const shown = s.lines.reduce((sum, l) => sum + l.lineTotal, 0);
		const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
		expect(shown + s.moreAmount).toBe(subtotal);
	});

	it("handles an empty items array (defensive — orders always have ≥1)", () => {
		const s = summarizeOrderCardItems([]);
		expect(s.lines).toHaveLength(0);
		expect(s.moreCount).toBe(0);
	});
});

describe("withLineKeys (PR #262 review — two lines, one variant)", () => {
	const line = (productId: string, variantId?: string) => ({
		productId,
		variantId,
	});

	it("keys an ordinary order on its variant, product when there is none", () => {
		const keys = withLineKeys([line("p1", "v1"), line("p2")]).map((l) => l.key);
		expect(keys).toEqual(["v1", "p2"]);
	});

	it("keeps both lines of a split stay distinct, and pairs each key with its line", () => {
		// The S13 case: weekday + weekend lines share productId AND variantId.
		const items = [line("plot", "v1"), line("plot", "v1")];
		const keyed = withLineKeys(items);
		expect(keyed.map((l) => l.key)).toEqual(["v1", "v1#2"]);
		expect(new Set(keyed.map((l) => l.key)).size).toBe(2);
		expect(keyed[1]?.item).toBe(items[1]);
	});

	it("still keys lines that carry no ids at all", () => {
		const keys = withLineKeys([{}, {}]).map((l) => l.key);
		expect(keys).toEqual(["line", "line#2"]);
	});

	it("counts per identity, so an unrelated line between repeats doesn't reset it", () => {
		const keys = withLineKeys([
			line("a", "v1"),
			line("b", "v2"),
			line("a", "v1"),
			line("a", "v1"),
		]).map((l) => l.key);
		expect(keys).toEqual(["v1", "v2", "v1#2", "v1#3"]);
	});
});
