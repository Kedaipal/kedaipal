import { describe, expect, it } from "vitest";
import { MYT_OFFSET_MS } from "./fulfilmentDate";
import {
	POPULAR_MIN_ORDERS,
	POPULAR_TOP_CANDIDATES,
	popularSince,
	rankPopularProducts,
} from "./popularProducts";

const order = (
	status: string,
	...items: Array<[string, number]>
): { status: string; items: { productId: string; quantity: number }[] } => ({
	status,
	items: items.map(([productId, quantity]) => ({ productId, quantity })),
});

describe("rankPopularProducts", () => {
	it("ranks by distinct orders, not units — a bulk buyer can't fake a bestseller", () => {
		const ranked = rankPopularProducts([
			// "bulk": one customer, 40 units in a single order.
			order("confirmed", ["bulk", 40]),
			order("confirmed", ["bulk", 1]),
			// "cake": three customers, one each.
			order("confirmed", ["cake", 1]),
			order("confirmed", ["cake", 1]),
			order("delivered", ["cake", 1]),
		]);
		expect(ranked).toEqual(["cake", "bulk"]);
	});

	it("counts a product once per order even across multiple lines (variants)", () => {
		// Two lines of the same product in one order = 1 order, 3 units.
		const ranked = rankPopularProducts([
			order("confirmed", ["cake", 2], ["cake", 1]),
			order("confirmed", ["cake", 1]),
			// "pie" also has 2 orders but fewer units — quantity is the tiebreak.
			order("confirmed", ["pie", 1]),
			order("confirmed", ["pie", 1]),
		]);
		expect(ranked).toEqual(["cake", "pie"]);
	});

	it("ignores pending and cancelled orders — only revenue statuses count", () => {
		const ranked = rankPopularProducts([
			order("pending", ["cake", 1]),
			order("pending", ["cake", 1]),
			order("cancelled", ["cake", 1]),
			order("confirmed", ["pie", 1]),
			order("packed", ["pie", 1]),
		]);
		expect(ranked).toEqual(["pie"]);
	});

	it(`hides products below ${POPULAR_MIN_ORDERS} orders — one order is an anecdote`, () => {
		expect(rankPopularProducts([order("confirmed", ["cake", 5])])).toEqual([]);
	});

	it("returns at most the candidate cap, ids only", () => {
		const orders = Array.from({ length: POPULAR_TOP_CANDIDATES + 3 }, (_, i) => [
			order("confirmed", [`p${i}`, 1]),
			order("confirmed", [`p${i}`, 1]),
		]).flat();
		const ranked = rankPopularProducts(orders);
		expect(ranked).toHaveLength(POPULAR_TOP_CANDIDATES);
		for (const entry of ranked) expect(typeof entry).toBe("string");
	});

	it("breaks full ties deterministically (stable across query re-runs)", () => {
		const orders = [
			order("confirmed", ["b", 1]),
			order("confirmed", ["b", 1]),
			order("confirmed", ["a", 1]),
			order("confirmed", ["a", 1]),
		];
		expect(rankPopularProducts(orders)).toEqual(
			rankPopularProducts([...orders].reverse()),
		);
	});
});

describe("popularSince", () => {
	it("is an MYT midnight 7 days back — the day-aligned cache anchor", () => {
		const since = popularSince();
		expect((since + MYT_OFFSET_MS) % (24 * 60 * 60 * 1000)).toBe(0);
		const daysBack = (Date.now() - since) / (24 * 60 * 60 * 1000);
		expect(daysBack).toBeGreaterThanOrEqual(7);
		expect(daysBack).toBeLessThan(8);
	});
});
