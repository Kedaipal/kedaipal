import { describe, expect, it } from "vitest";
import { pausedCopy } from "./seasonal-break";

/**
 * The buyer's "not taking orders" banner (`z8r3fdudf7`) words each reason its
 * own way, and its line IS the server's refusal sentence — so a buyer whose
 * stale tab tries anyway reads the same thing the page already told them.
 */
describe("pausedCopy", () => {
	it("a hold keeps the seasonal wording", () => {
		expect(pausedCopy("Kek", { by: "hold" }).title).toBe("On a seasonal break");
	});

	it("the seller's pause carries their note", () => {
		expect(pausedCopy("Kek", { by: "seller", note: "Back Monday" })).toEqual({
			title: "Not taking orders right now",
			body: "Kek isn't taking orders right now — Back Monday",
		});
	});

	it("Kedaipal's pause reads like a seller's with no note — never why", () => {
		const copy = pausedCopy("Kek", { by: "admin", note: "Unpaid sponsorship" });
		expect(copy.title).toBe("Not taking orders right now");
		expect(copy.body).not.toMatch(/sponsorship/i);
	});
});
