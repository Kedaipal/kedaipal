import { describe, expect, test } from "vitest";
import { LOCALES } from "./locale";
import {
	collapseNote,
	distinctPickupNotes,
	MAX_PICKUP_NOTE_LENGTH,
	orderPickupNotes,
	PICKUP_NOTES_HEADING,
	pickupNoteFits,
} from "./pickupNote";

describe("collapseNote — the stored spelling", () => {
	test("one line stays one line: inner whitespace collapses, edges trim", () => {
		expect(collapseNote("  Side counter.\n\n  Ring the bell.  ")).toBe(
			"Side counter. Ring the bell.",
		);
	});

	test("empty or whitespace-only is unset — one spelling for 'no note'", () => {
		expect(collapseNote(undefined)).toBeUndefined();
		expect(collapseNote("")).toBeUndefined();
		expect(collapseNote(" \n\t ")).toBeUndefined();
	});
});

describe("pickupNoteFits — the cap applies to what is STORED", () => {
	test("exactly the cap fits; one over does not", () => {
		expect(pickupNoteFits("x".repeat(MAX_PICKUP_NOTE_LENGTH))).toBe(true);
		expect(pickupNoteFits("x".repeat(MAX_PICKUP_NOTE_LENGTH + 1))).toBe(false);
	});

	test("padding that collapses back under the cap is fine", () => {
		expect(pickupNoteFits(`${"y".repeat(MAX_PICKUP_NOTE_LENGTH)}      `)).toBe(
			true,
		);
		expect(pickupNoteFits(undefined)).toBe(true);
	});
});

describe("distinctPickupNotes", () => {
	test("trims, drops blanks, removes exact duplicates, keeps cart order", () => {
		expect(
			distinctPickupNotes([
				"Bring an ice bag.",
				undefined,
				"  Bring an ice bag.  ",
				"",
				"Side counter.",
				"Bring an ice bag.",
			]),
		).toEqual(["Bring an ice bag.", "Side counter."]);
	});

	test("nothing to say is an empty list", () => {
		expect(distinctPickupNotes([])).toEqual([]);
		expect(distinctPickupNotes([undefined, " "])).toEqual([]);
	});
});

describe("orderPickupNotes — the one gate", () => {
	const items = [
		{ pickupNote: "Bring an ice bag." },
		{ pickupNote: "Bring an ice bag." },
		{},
	];

	test("a self-collect order shows its distinct notes", () => {
		expect(orderPickupNotes({ deliveryMethod: "self_collect", items })).toEqual([
			"Bring an ice bag.",
		]);
	});

	test("a DELIVERY order never does — notes are frozen on every order, so this gate is the guard", () => {
		expect(orderPickupNotes({ deliveryMethod: "delivery", items })).toEqual([]);
		// A legacy order with no method reads as delivery.
		expect(orderPickupNotes({ items })).toEqual([]);
	});

	test("a counter sale never does — the buyer was standing there", () => {
		expect(
			orderPickupNotes({ deliveryMethod: "self_collect", source: "counter", items }),
		).toEqual([]);
	});

	test("a booking never does", () => {
		expect(orderPickupNotes({ deliveryMethod: "booking", items })).toEqual([]);
	});

	test("returns plain strings — safe to cross a Convex function boundary", () => {
		const out = orderPickupNotes({
			deliveryMethod: "self_collect",
			items: [{}, { pickupNote: undefined }, { pickupNote: "Side counter." }],
		});
		expect(out.every((n) => typeof n === "string")).toBe(true);
	});
});

describe("PICKUP_NOTES_HEADING", () => {
	test("every locale the app speaks has one", () => {
		for (const locale of LOCALES) {
			expect(PICKUP_NOTES_HEADING[locale]?.length).toBeGreaterThan(0);
		}
	});
});
