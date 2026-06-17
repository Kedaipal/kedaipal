import { describe, expect, test } from "vitest";
import { composeCustomerNote } from "./order-note";

describe("composeCustomerNote", () => {
	test("returns undefined when there are no notes", () => {
		expect(
			composeCustomerNote([{ name: "Cake", optionLabel: "Large" }], undefined),
		).toBeUndefined();
		expect(composeCustomerNote([], "   ")).toBeUndefined();
	});

	test("labels a per-item custom note by item + option", () => {
		expect(
			composeCustomerNote(
				[{ name: "Cake", optionLabel: "Custom", note: "unicorn, size 8" }],
				undefined,
			),
		).toBe("Cake (Custom): unicorn, size 8");
	});

	test("puts item notes ahead of the general note", () => {
		expect(
			composeCustomerNote(
				[
					{ name: "Cake", optionLabel: "Custom", note: "unicorn theme" },
					{ name: "Cookies" },
				],
				"deliver after 5pm",
			),
		).toBe("Cake (Custom): unicorn theme\ndeliver after 5pm");
	});

	test("composes multiple custom lines, each labelled", () => {
		expect(
			composeCustomerNote(
				[
					{ name: "Cake", optionLabel: "Bespoke", note: "two tiers" },
					{ name: "Hamper", optionLabel: "Custom", note: "halal only" },
				],
				undefined,
			),
		).toBe("Cake (Bespoke): two tiers\nHamper (Custom): halal only");
	});

	test("falls back to the item name when there's no option label", () => {
		expect(
			composeCustomerNote([{ name: "Cake", note: "extra sweet" }], undefined),
		).toBe("Cake: extra sweet");
	});
});
