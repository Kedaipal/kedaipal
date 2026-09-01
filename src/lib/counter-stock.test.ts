import { describe, expect, it } from "vitest";
import {
	canAddToCounterCart,
	LOW_STOCK_THRESHOLD,
	maxAddableQty,
	productSoldOut,
	variantStockNote,
} from "./counter-stock";

const tracked = (onHand: number) => ({
	optionValues: ["S"],
	onHand,
	blockWhenOutOfStock: true,
});
const madeToOrder = (onHand = 0) => ({
	optionValues: ["Custom"],
	onHand,
	blockWhenOutOfStock: false,
});

describe("variantStockNote", () => {
	it("calls a tracked zero Sold out, in the danger tone", () => {
		expect(variantStockNote(tracked(0))).toEqual({
			text: "Sold out",
			tone: "danger",
		});
	});

	it("warns while stock is at or below the low threshold", () => {
		expect(variantStockNote(tracked(LOW_STOCK_THRESHOLD))).toEqual({
			text: `Only ${LOW_STOCK_THRESHOLD} left`,
			tone: "warn",
		});
		expect(variantStockNote(tracked(1))?.tone).toBe("warn");
	});

	it("states a healthy count without shouting about it", () => {
		expect(variantStockNote(tracked(LOW_STOCK_THRESHOLD + 1))).toEqual({
			text: `${LOW_STOCK_THRESHOLD + 1} left`,
			tone: "muted",
		});
	});

	// The blank that used to sit here read as missing data, not as "no ceiling".
	it("says made-to-order rather than leaving the line empty", () => {
		expect(variantStockNote(madeToOrder())).toEqual({
			text: "Made to order",
			tone: "muted",
		});
	});

	it("never calls a made-to-order variant sold out, even at zero on-hand", () => {
		expect(variantStockNote(madeToOrder(0))?.tone).not.toBe("danger");
		expect(canAddToCounterCart(madeToOrder(0))).toBe(true);
	});
});

describe("maxAddableQty", () => {
	it("caps a tracked variant at its on-hand count", () => {
		expect(maxAddableQty(tracked(4))).toBe(4);
		expect(maxAddableQty(tracked(0))).toBe(0);
	});

	it("leaves made-to-order uncapped", () => {
		expect(maxAddableQty(madeToOrder(0))).toBeUndefined();
	});

	// Negative on-hand is reachable through manual stock edits; a negative cap
	// would make the stepper's "at max" test nonsense.
	it("floors a negative on-hand at zero", () => {
		expect(maxAddableQty(tracked(-2))).toBe(0);
	});
});

describe("canAddToCounterCart", () => {
	it("refuses a tracked variant at zero", () => {
		expect(canAddToCounterCart(tracked(0))).toBe(false);
	});
	it("allows a tracked variant with stock", () => {
		expect(canAddToCounterCart(tracked(1))).toBe(true);
	});
	it("refuses an inactive variant even with stock", () => {
		expect(canAddToCounterCart({ ...tracked(9), active: false })).toBe(false);
	});
});

describe("productSoldOut", () => {
	it("is true only when no choice is sellable", () => {
		expect(productSoldOut({ variants: [tracked(0), tracked(0)] })).toBe(true);
	});

	it("is false when any choice still has stock", () => {
		expect(productSoldOut({ variants: [tracked(0), tracked(2)] })).toBe(false);
	});

	// The mixed product from docs/custom-option.md: fixed sizes can all run out
	// while the made-to-order line stays orderable forever.
	it("is false when a made-to-order line survives sold-out sizes", () => {
		expect(productSoldOut({ variants: [tracked(0), madeToOrder()] })).toBe(
			false,
		);
	});

	it("is false for a product with no variants at all", () => {
		expect(productSoldOut({ variants: [] })).toBe(false);
	});
});
