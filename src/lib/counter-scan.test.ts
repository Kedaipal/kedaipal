import { describe, expect, it } from "vitest";
import { newWalkInSince, walkInSessionIds } from "./counter-scan";

type S = { sessionId: string; origin: "cashier" | "store_qr" };

const qr = (id: string): S => ({ sessionId: id, origin: "store_qr" });
const cashier = (id: string): S => ({ sessionId: id, origin: "cashier" });

describe("walkInSessionIds", () => {
	it("collects only store_qr sessions", () => {
		const ids = walkInSessionIds([qr("a"), cashier("b"), qr("c")]);
		expect([...ids].sort()).toEqual(["a", "c"]);
	});

	it("is empty for an empty or all-cashier list", () => {
		expect(walkInSessionIds([]).size).toBe(0);
		expect(walkInSessionIds([cashier("a"), cashier("b")]).size).toBe(0);
	});
});

describe("newWalkInSince", () => {
	it("returns the walk-in that appeared after the baseline", () => {
		const baseline = walkInSessionIds([qr("a")]);
		// New scan sorts to the front (most-recently-active first).
		expect(newWalkInSince([qr("new"), qr("a")], baseline)).toBe("new");
	});

	it("returns null when nothing new arrived", () => {
		const baseline = walkInSessionIds([qr("a"), qr("b")]);
		expect(newWalkInSince([qr("b"), qr("a")], baseline)).toBeNull();
	});

	it("ignores a new cashier (manual/anonymous) session — those self-navigate", () => {
		const baseline = walkInSessionIds([qr("a")]);
		expect(newWalkInSince([cashier("manual"), qr("a")], baseline)).toBeNull();
	});

	it("returns the first (newest) when several are new", () => {
		const baseline = new Set<string>();
		expect(newWalkInSince([qr("second"), qr("first")], baseline)).toBe(
			"second",
		);
	});

	it("treats an empty baseline as: any walk-in is new", () => {
		expect(newWalkInSince([qr("a")], new Set())).toBe("a");
	});
});
