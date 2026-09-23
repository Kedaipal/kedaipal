import { describe, expect, it } from "vitest";
import { overseasCourierNote } from "./overseas-courier-note";

const BASE = {
	booksCouriers: true,
	deliveryMethod: "delivery" as const,
	localNumber: false,
	collectsFromCustomer: false,
	storeCountry: "MY" as const,
	storeName: "Kek Mama",
	locale: "en",
};

describe("overseasCourierNote — only when a courier would be handed the store's number", () => {
	it("a foreign number on a courier-booking delivery gets the note", () => {
		expect(overseasCourierNote(BASE)).toBe(
			"Your WhatsApp number is from outside Malaysia, so the rider will contact Kek Mama instead of you. Order updates still come to your WhatsApp.",
		);
	});

	it("pickup never gets it — no rider is involved", () => {
		expect(
			overseasCourierNote({ ...BASE, deliveryMethod: "self_collect" }),
		).toBeNull();
	});

	it("a store that books no couriers never gets it — the seller delivers", () => {
		expect(overseasCourierNote({ ...BASE, booksCouriers: false })).toBeNull();
	});

	it("a local number gets nothing — the happy path renders unchanged", () => {
		expect(overseasCourierNote({ ...BASE, localNumber: true })).toBeNull();
	});

	it("a collection store says the rider is collecting from the buyer", () => {
		expect(overseasCourierNote({ ...BASE, collectsFromCustomer: true })).toBe(
			"Your WhatsApp number is from outside Malaysia, so the rider collecting from you will contact Kek Mama instead of you. Order updates still come to your WhatsApp.",
		);
	});

	it("names the STORE's country — Singapore for an SG store", () => {
		expect(overseasCourierNote({ ...BASE, storeCountry: "SG" })).toMatch(
			/^Your WhatsApp number is from outside Singapore,/,
		);
	});

	it("Malay stores read Malay, with the Malay country name", () => {
		expect(overseasCourierNote({ ...BASE, locale: "ms" })).toBe(
			"Nombor WhatsApp anda dari luar Malaysia, jadi penghantar akan menghubungi Kek Mama, bukan anda. Kemas kini pesanan tetap dihantar ke WhatsApp anda.",
		);
		expect(
			overseasCourierNote({ ...BASE, locale: "ms", storeCountry: "SG" }),
		).toMatch(/dari luar Singapura,/);
	});

	it("any other locale falls back to English, like every checkout line", () => {
		expect(overseasCourierNote({ ...BASE, locale: "zh" })).toBe(
			overseasCourierNote(BASE),
		);
	});

	it("never tells the buyer their updates might not arrive", () => {
		for (const locale of ["en", "ms"]) {
			for (const collectsFromCustomer of [false, true]) {
				const note =
					overseasCourierNote({ ...BASE, locale, collectsFromCustomer }) ?? "";
				expect(note).not.toMatch(/may not|might not|won't|tidak akan/i);
			}
		}
	});
});
