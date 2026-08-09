import { describe, expect, test } from "vitest";
import {
	assertProductCap,
	fitsWithinProductCap,
	MAX_PRODUCTS_PER_RETAILER as CAP,
	PRODUCT_COUNTER_VISIBLE_AT,
	productCapBlockReason,
	productCapState,
} from "./productCap";

describe("productCapState", () => {
	test("an empty store has the whole cap available", () => {
		const s = productCapState(0);
		expect(s.used).toBe(0);
		expect(s.cap).toBe(CAP);
		expect(s.remaining).toBe(CAP);
		expect(s.atCap).toBe(false);
		expect(s.overCap).toBe(false);
		expect(s.exempt).toBe(false);
	});

	test("one below the cap still has room", () => {
		const s = productCapState(CAP - 1);
		expect(s.remaining).toBe(1);
		expect(s.atCap).toBe(false);
	});

	test("exactly at the cap is blocked — the boundary is inclusive", () => {
		const s = productCapState(CAP);
		expect(s.remaining).toBe(0);
		expect(s.atCap).toBe(true);
		expect(s.overCap).toBe(false);
	});

	test("an admin-stocked store above the cap reports overCap, never a negative remaining", () => {
		const s = productCapState(CAP + 50);
		expect(s.remaining).toBe(0);
		expect(s.overCap).toBe(true);
	});

	test("exempt callers are never at the cap, however full the store is", () => {
		const s = productCapState(CAP + 50, true);
		expect(s.exempt).toBe(true);
		expect(s.atCap).toBe(false);
		// Still honest about the store being over the ceiling — exemption is about
		// what this caller may do, not about pretending the shelf is empty.
		expect(s.overCap).toBe(true);
	});
});

describe("the counter stays hidden until it matters", () => {
	test("a small catalog is never shown a ceiling", () => {
		expect(productCapState(12).showCounter).toBe(false);
		expect(productCapState(PRODUCT_COUNTER_VISIBLE_AT - 1).showCounter).toBe(
			false,
		);
	});

	test("it appears from 80% of the cap", () => {
		expect(PRODUCT_COUNTER_VISIBLE_AT).toBe(Math.floor(CAP * 0.8));
		expect(productCapState(PRODUCT_COUNTER_VISIBLE_AT).showCounter).toBe(true);
		expect(productCapState(CAP).showCounter).toBe(true);
	});
});

describe("productCapBlockReason", () => {
	test("is null while there's room", () => {
		expect(productCapBlockReason(0)).toBeNull();
		expect(productCapBlockReason(CAP - 1)).toBeNull();
	});

	test("explains the block at the cap, and names deletion as the fix", () => {
		const reason = productCapBlockReason(CAP);
		expect(reason).toContain(String(CAP));
		expect(reason).toMatch(/delete/i);
	});

	test("an exempt caller is never blocked", () => {
		expect(productCapBlockReason(CAP, true)).toBeNull();
	});
});

describe("assertProductCap", () => {
	test("allows an add that lands exactly on the cap", () => {
		expect(() => assertProductCap(CAP - 1, 1)).not.toThrow();
	});

	test("rejects the one that would cross it", () => {
		expect(() => assertProductCap(CAP, 1)).toThrow(/limit/i);
	});

	test("a single add is told archived products count, so archiving won't help", () => {
		expect(() => assertProductCap(CAP, 1)).toThrow(/archived/i);
	});

	test("a bulk add names how many actually fit — the sheet-sized case", () => {
		// 10 slots left, 25 offered.
		expect(() => assertProductCap(CAP - 10, 25)).toThrow(/Only 10 of these 25/);
	});

	test("a bulk add with zero room says so plainly rather than 'only 0 fit'", () => {
		expect(() => assertProductCap(CAP, 25)).toThrow(/none of these 25/);
	});

	test("an import that only updates existing products never consumes a slot", () => {
		expect(() => assertProductCap(CAP, 0)).not.toThrow();
	});

	test("exempt callers pass however far past the ceiling they are", () => {
		expect(() => assertProductCap(CAP + 100, 50, true)).not.toThrow();
	});
});

describe("fitsWithinProductCap", () => {
	test("answers the chunked-import question before any write happens", () => {
		expect(fitsWithinProductCap(productCapState(CAP - 10), 10)).toBe(true);
		expect(fitsWithinProductCap(productCapState(CAP - 10), 11)).toBe(false);
	});

	test("an exempt caller fits regardless — remaining alone would say otherwise", () => {
		const s = productCapState(CAP + 50, true);
		expect(s.remaining).toBe(0);
		expect(fitsWithinProductCap(s, 30)).toBe(true);
	});
});
