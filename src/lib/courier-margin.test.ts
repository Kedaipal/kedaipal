import { describe, expect, it } from "vitest";
import { courierMargin } from "./courier-margin";

/** A courier's price against what the buyer paid for delivery (z8r3fdx34j). */
describe("courierMargin", () => {
	it("says what the seller keeps when the courier is cheaper", () => {
		expect(courierMargin(720, 800, "MYR")).toMatchObject({
			tone: "kept",
			label: "+RM 0.80 kept",
		});
	});
	it("says what comes out of margin when it costs more", () => {
		expect(courierMargin(1140, 800, "MYR")).toMatchObject({
			tone: "loss",
			label: "RM 3.40 from your margin",
		});
	});
	it("an exact match is neither", () => {
		expect(courierMargin(800, 800, "MYR").tone).toBe("even");
	});
});
