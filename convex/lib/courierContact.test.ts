/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { toDomesticContactPhone } from "./courierContact";

describe("toDomesticContactPhone — one contact rule for every courier (z8r3fdh274)", () => {
	test("a number from the booking's own country is a contact, as E.164", () => {
		expect(toDomesticContactPhone("60123456789", "MY")).toBe("+60123456789");
		// Landlines too — a rider can phone one; this is a country check, not a
		// WhatsApp check.
		expect(toDomesticContactPhone("60312345678", "MY")).toBe("+60312345678");
		expect(toDomesticContactPhone("6591234567", "SG")).toBe("+6591234567");
	});

	test("anything from another country is null — the caller's cue to use the store's number", () => {
		expect(toDomesticContactPhone("6591234567", "MY")).toBeNull();
		expect(toDomesticContactPhone("60123456789", "SG")).toBeNull();
		expect(toDomesticContactPhone("447911123456", "MY")).toBeNull();
		expect(toDomesticContactPhone("819012345678", "SG")).toBeNull();
	});

	test("absent or malformed is null, never a half-number", () => {
		expect(toDomesticContactPhone(undefined, "MY")).toBeNull();
		expect(toDomesticContactPhone("", "MY")).toBeNull();
		expect(toDomesticContactPhone("6012", "MY")).toBeNull();
		expect(toDomesticContactPhone("65912345678", "SG")).toBeNull();
	});
});
