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
			"Your WhatsApp number is from outside Malaysia, so the rider will contact Kek Mama instead of you. Kek Mama can still reach you on WhatsApp, and your order page shows every update.",
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
			"Your WhatsApp number is from outside Malaysia, so the rider collecting from you will contact Kek Mama instead of you. Kek Mama can still reach you on WhatsApp, and your order page shows every update.",
		);
	});

	it("names the STORE's country — Singapore for an SG store", () => {
		expect(overseasCourierNote({ ...BASE, storeCountry: "SG" })).toMatch(
			/^Your WhatsApp number is from outside Singapore,/,
		);
	});

	it("Malay stores read Malay, with the Malay country name", () => {
		expect(overseasCourierNote({ ...BASE, locale: "ms" })).toBe(
			"Nombor WhatsApp anda dari luar Malaysia, jadi penghantar akan menghubungi Kek Mama, bukan anda. Kek Mama masih boleh menghubungi anda di WhatsApp, dan halaman pesanan anda menunjukkan setiap kemas kini.",
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

	/** Every rendered variant: both locales × both rider wordings × both store
	 * countries. */
	const everyVariant = () =>
		["en", "ms"].flatMap((locale) =>
			[false, true].flatMap((collectsFromCustomer) =>
				(["MY", "SG"] as const).map(
					(storeCountry) =>
						overseasCourierNote({
							...BASE,
							locale,
							collectsFromCustomer,
							storeCountry,
						}) ?? "",
				),
			),
		);

	it("never tells the buyer their updates might not arrive", () => {
		for (const note of everyVariant()) {
			expect(note).not.toMatch(/may not|might not|won't|tidak akan/i);
		}
	});

	it("never promises a stream of WhatsApp updates — an order sends ONE message", () => {
		// docs/one-message-per-order.md: the confirmation is the only proactive
		// buyer message, and some stores send none. Updates live on the order
		// page; the note may only say the store can still reach them.
		for (const note of everyVariant()) {
			expect(note).not.toBe("");
			expect(note).not.toMatch(/still come|tetap dihantar/i);
			expect(note).not.toMatch(/updates? (?:come|arrive|are sent)/i);
			expect(note).toMatch(/order page|halaman pesanan/);
		}
	});
});
