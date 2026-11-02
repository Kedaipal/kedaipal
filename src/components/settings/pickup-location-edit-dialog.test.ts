import { describe, expect, it } from "vitest";
import { PICKUP_UNIT_HELP } from "./pickup-location-edit-dialog";

describe("pickup unit hint (z8r3fdff8r)", () => {
	it("names only the surfaces that actually print the unit", () => {
		// The WhatsApp confirmation is a Meta template (order number, store,
		// total, a button to the order page) and carries no address. This hint
		// promised the unit there twice; a seller relying on it would stop
		// telling buyers the unit themselves.
		expect(PICKUP_UNIT_HELP).not.toMatch(/whatsapp|message|reminder/i);
		expect(PICKUP_UNIT_HELP).toMatch(/at checkout and on their order page/);
	});
});
