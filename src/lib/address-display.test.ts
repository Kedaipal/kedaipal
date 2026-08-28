import { describe, expect, test } from "vitest";
import { displayAddressState } from "./address-display";

describe("displayAddressState (86eynw29u)", () => {
	test("MY addresses keep their state line", () => {
		expect(
			displayAddressState({ city: "Petaling Jaya", state: "Selangor" }),
		).toBe("Selangor");
	});

	test("SG addresses drop it — 'Singapore, Singapore' never prints", () => {
		expect(
			displayAddressState({ city: "Singapore", state: "Singapore" }),
		).toBeUndefined();
		// Case/whitespace variants of the same repetition dedupe too.
		expect(
			displayAddressState({ city: "singapore", state: "Singapore " }),
		).toBeUndefined();
	});

	test("an empty state is display-absent, never an empty line", () => {
		expect(displayAddressState({ city: "Bangi", state: "" })).toBeUndefined();
		expect(displayAddressState({ city: "Bangi", state: "  " })).toBeUndefined();
	});
});
