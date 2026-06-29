import { describe, expect, it } from "vitest";
import { reorderByIds } from "./reorder";

type Img = { id: string; url: string };

const items: Img[] = [
	{ id: "a", url: "ua" },
	{ id: "b", url: "ub" },
	{ id: "c", url: "uc" },
];

describe("reorderByIds", () => {
	it("reorders items to match the id sequence", () => {
		expect(reorderByIds(items, ["c", "a", "b"], (i) => i.id)).toEqual([
			items[2],
			items[0],
			items[1],
		]);
	});

	it("returns the same objects (preserves identity, not just shape)", () => {
		const out = reorderByIds(items, ["b", "a", "c"], (i) => i.id);
		expect(out[0]).toBe(items[1]);
		expect(out[2]).toBe(items[2]);
	});

	it("is a no-op when the order is unchanged", () => {
		expect(reorderByIds(items, ["a", "b", "c"], (i) => i.id)).toEqual(items);
	});

	it("drops items whose id is absent from orderedIds", () => {
		expect(reorderByIds(items, ["c", "a"], (i) => i.id)).toEqual([
			items[2],
			items[0],
		]);
	});

	it("skips unknown ids without throwing", () => {
		expect(reorderByIds(items, ["a", "zzz", "b"], (i) => i.id)).toEqual([
			items[0],
			items[1],
		]);
	});

	it("handles an empty list", () => {
		expect(reorderByIds([] as Img[], [], (i) => i.id)).toEqual([]);
	});
});
