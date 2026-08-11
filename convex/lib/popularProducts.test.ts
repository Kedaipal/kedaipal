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

	// Capping is the QUERY's job, and only after it drops products the
	// storefront doesn't list — otherwise an unlisted bestseller eats a slot
	// with nothing to back-fill it. See products.popularProducts.
	it("returns the full ranked list uncapped, ids only", () => {
		const extra = 3;
		const orders = Array.from(
			{ length: POPULAR_TOP_CANDIDATES + extra },
			(_, i) => [
				order("confirmed", [`p${i}`, 1]),
				order("confirmed", [`p${i}`, 1]),
			],
		).flat();
		const ranked = rankPopularProducts(orders);
		expect(ranked).toHaveLength(POPULAR_TOP_CANDIDATES + extra);
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
	const DAY = 24 * 60 * 60 * 1000;

	it("is an MYT midnight 7 days back — the day-aligned cache anchor", () => {
		const since = popularSince();
		expect((since + MYT_OFFSET_MS) % DAY).toBe(0);
		const daysBack = (Date.now() - since) / DAY;
		expect(daysBack).toBeGreaterThanOrEqual(7);
		expect(daysBack).toBeLessThan(8);
	});

	// The window ROLLS with today; it is not a calendar week. If it ever became
	// one, the shelf would empty out every time a new week started — the exact
	// failure mode this pins against.
	it("slides forward one day per day, so the shelf never resets on a weekday", () => {
		const at = (iso: string) => popularSince(new Date(iso).getTime());
		const oct3 = at("2026-10-03T15:00:00+08:00");
		const oct4 = at("2026-10-04T09:00:00+08:00");
		const oct5 = at("2026-10-05T23:59:00+08:00");

		// One day later → window start moves exactly one day later.
		expect(oct4 - oct3).toBe(DAY);
		expect(oct5 - oct4).toBe(DAY);
		// On 3 Oct the window opens on 26 Sep (7 days back), and runs to "now" —
		// the query applies no upper bound.
		expect(new Date(oct3 + MYT_OFFSET_MS).toISOString().slice(0, 10)).toBe(
			"2026-09-26",
		);
		// Time of day never moves the anchor: two buyers on the same MYT date
		// send identical args, which is what keeps the query cached.
		expect(at("2026-10-03T00:05:00+08:00")).toBe(
			at("2026-10-03T23:55:00+08:00"),
		);
	});
});
