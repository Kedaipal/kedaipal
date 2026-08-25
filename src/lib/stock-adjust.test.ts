// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
	clampDelta,
	confirmLabel,
	EMPTY_DELTA,
	hasChange,
	liveShift,
	movementLabel,
	nextCount,
	type StockDraft,
	toAdjustment,
} from "./stock-adjust";

const delta = (d: number): StockDraft => ({ mode: "delta", delta: d });
const set = (n: number | null): StockDraft => ({ mode: "set", setTo: n });

describe("the three numbers stay distinct", () => {
	// The whole anti-confusion requirement: the big digits are the RESULT, and
	// the line beside them names the CHANGE. If those two ever say the same
	// thing, a seller reads "30" as "I am adding 30".
	test("a movement's result and its label are different sentences", () => {
		expect(nextCount(20, delta(10))).toBe(30);
		expect(movementLabel(20, delta(10))).toBe("Adding 10");
		expect(confirmLabel(20, delta(10))).toBe("Add 10");

		expect(nextCount(20, delta(-3))).toBe(17);
		expect(movementLabel(20, delta(-3))).toBe("Removing 3");
		expect(confirmLabel(20, delta(-3))).toBe("Remove 3");
	});

	test("an exact count says how far it is from the store's number", () => {
		// Never "Removing 3" here — the seller did not remove anything, they
		// counted, and the two are different claims about what happened.
		expect(movementLabel(20, set(17))).toBe("3 fewer than the store holds");
		expect(movementLabel(20, set(25))).toBe("5 more than the store holds");
		expect(confirmLabel(20, set(17))).toBe("Set to 17");
	});

	test("nothing typed yet reads as nothing, not as zero", () => {
		expect(nextCount(20, set(null))).toBe(null);
		expect(movementLabel(20, set(null))).toBe("Type the count you made");
		expect(hasChange(20, set(null))).toBe(false);
		expect(movementLabel(20, EMPTY_DELTA)).toBe("No change yet");
		expect(confirmLabel(20, EMPTY_DELTA)).toBe("No change");
	});

	test("setting the count it already is changes nothing", () => {
		expect(hasChange(20, set(20))).toBe(false);
		expect(confirmLabel(20, set(20))).toBe("No change");
	});
});

describe("floors", () => {
	test("a movement can't take the count below zero", () => {
		expect(nextCount(5, delta(-999))).toBe(0);
		expect(clampDelta(5, -999)).toBe(-5);
		expect(clampDelta(5, -2)).toBe(-2);
		expect(clampDelta(5, 3)).toBe(3);
	});
});

describe("what gets sent to the server", () => {
	test("a movement sends the delta, never a total", () => {
		// This is the property the whole design rests on: the server adds the
		// movement to whatever it finds, so a sale landing in between is safe.
		expect(toAdjustment("v1", 20, delta(10))).toEqual({
			variantId: "v1",
			delta: 10,
		});
	});

	test("a movement is clamped before it leaves", () => {
		expect(toAdjustment("v1", 5, delta(-40))).toEqual({
			variantId: "v1",
			delta: -5,
		});
	});

	test("an exact count carries what the seller could see", () => {
		// `expectedOnHand` is the consent record — the server refuses the write if
		// reality moved past it, so an unseen sale can't be written away.
		expect(toAdjustment("v1", 18, set(17))).toEqual({
			variantId: "v1",
			setTo: 17,
			expectedOnHand: 18,
		});
	});
});

describe("the count moving while the control is open", () => {
	test("a movement is only informed, never interrupted", () => {
		const shift = liveShift(20, 18, delta(10));
		expect(shift?.tone).toBe("info");
		expect(shift?.message).toContain("2 units sold");
		expect(shift?.message).toContain("still applies");
		// Nothing to re-decide, so nothing is offered.
		expect(shift?.suggestion).toBeUndefined();
	});

	test("an exact count is warned, and handed the arithmetic", () => {
		const shift = liveShift(20, 18, set(17));
		expect(shift?.tone).toBe("warn");
		expect(shift?.message).toContain("holds 18 now, not 20");
		// 17 counted, 2 sold since → 15. Offered, never applied for them: only the
		// seller knows whether they counted before or after those units left.
		expect(shift?.suggestion).toBe(15);
	});

	test("the suggestion floors at zero", () => {
		expect(liveShift(20, 18, set(1))?.suggestion).toBe(0);
	});

	test("stock going UP while open is described as such", () => {
		expect(liveShift(18, 20, delta(5))?.message).toContain(
			"2 units were added",
		);
		expect(liveShift(19, 20, delta(5))?.message).toContain("1 unit was added");
	});

	test("nothing to say when nothing moved", () => {
		expect(liveShift(20, 20, delta(5))).toBe(null);
		expect(liveShift(20, 20, set(17))).toBe(null);
	});
});
