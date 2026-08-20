import { describe, expect, it } from "vitest";
import {
	checkoutFormSchemaFor,
	strictAddressSchemaFor,
	waPhoneCheckoutSchema,
} from "./schemas";

// Built from convex/lib/slug.ts's own patterns + normalizer, then requires the
// country's MOBILE shape — the checkout gate for the WABA confirmation push
// (86eyf1rck; per-country since SG-lite 86eynw28q). The server re-validates on
// create with the same country arm.
describe("waPhoneCheckoutSchema.MY", () => {
	it("normalizes local formats to the inbound (60…) form", () => {
		expect(waPhoneCheckoutSchema.MY.parse("0123456789")).toBe("60123456789");
		expect(waPhoneCheckoutSchema.MY.parse("012-345 6789")).toBe("60123456789");
		expect(waPhoneCheckoutSchema.MY.parse("+60 12-345 6789")).toBe(
			"60123456789",
		);
		expect(waPhoneCheckoutSchema.MY.parse("60123456789")).toBe("60123456789");
	});

	it("accepts 011-series numbers (one digit longer)", () => {
		expect(waPhoneCheckoutSchema.MY.parse("011-2345 6789")).toBe(
			"601123456789",
		);
	});

	// The field renders a "+60" prefix badge (86eyfq04j), so a buyer who reads
	// it and types only the rest must be accepted — otherwise the badge tells
	// them to do the one thing the validator rejects.
	it("accepts a bare national number typed after the +60 badge", () => {
		expect(waPhoneCheckoutSchema.MY.parse("123456789")).toBe("60123456789");
		expect(waPhoneCheckoutSchema.MY.parse("12-345 6789")).toBe("60123456789");
		expect(waPhoneCheckoutSchema.MY.parse("1123456789")).toBe("601123456789");
	});

	it("rejects non-mobile and non-MY numbers with the checkout copy", () => {
		for (const bad of [
			"12345", // junk
			"03-1234 5678", // MY landline (603…)
			"6512345678", // SG number
			"441234567890", // UK number
			"not a phone",
			"",
		]) {
			const result = waPhoneCheckoutSchema.MY.safeParse(bad);
			expect(result.success, `expected ${JSON.stringify(bad)} to fail`).toBe(
				false,
			);
			if (!result.success) {
				expect(result.error.issues[0].message).toContain(
					"Malaysian mobile number",
				);
			}
		}
	});
});

// Country-keyed address arms (SG-lite, 86eynw29u). MY must stay byte-identical
// to the pre-SG schema; SG swaps in a 6-digit postal code and drops the
// state/city requirements (those fields never render — submit stamps both as
// "Singapore").
describe("strictAddressSchemaFor", () => {
	const myAddress = {
		line1: "12 Jln Mawar 3",
		line2: "",
		city: "Petaling Jaya",
		state: "Selangor",
		postcode: "47301",
		notes: "",
		mapsUrl: "",
	};
	const sgAddress = {
		line1: "12 Bedok North Ave 3",
		line2: "",
		city: "",
		state: "",
		postcode: "238859",
		notes: "",
		mapsUrl: "",
	};

	it("MY accepts the classic shape and rejects SG shapes", () => {
		expect(strictAddressSchemaFor("MY").safeParse(myAddress).success).toBe(
			true,
		);
		expect(
			strictAddressSchemaFor("MY").safeParse({
				...myAddress,
				postcode: "238859",
			}).success,
		).toBe(false);
		expect(
			strictAddressSchemaFor("MY").safeParse({
				...myAddress,
				state: "Singapore",
			}).success,
		).toBe(false);
		// State stays required — an empty pick still fails.
		expect(
			strictAddressSchemaFor("MY").safeParse({ ...myAddress, state: "" })
				.success,
		).toBe(false);
	});

	it("SG accepts a 6-digit postal code with no state or city typed", () => {
		expect(strictAddressSchemaFor("SG").safeParse(sgAddress).success).toBe(
			true,
		);
	});

	it("SG rejects a 5-digit postcode with its own copy", () => {
		const result = strictAddressSchemaFor("SG").safeParse({
			...sgAddress,
			postcode: "47301",
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toContain("6 digits");
		}
	});

	it("shared field rules bind both arms (line1 length)", () => {
		for (const country of ["MY", "SG"] as const) {
			expect(
				strictAddressSchemaFor(country).safeParse({
					...(country === "MY" ? myAddress : sgAddress),
					line1: "ab",
				}).success,
			).toBe(false);
		}
	});
});

describe("checkoutFormSchemaFor — the address arm follows the country", () => {
	// The phone arm is country-keyed too (no cross-accept), so each country's
	// form carries a phone its own arm accepts — these tests isolate the
	// ADDRESS arm.
	const formFor = (country: "MY" | "SG") => ({
		name: "Tan Wei Ming",
		waPhone: country === "MY" ? "0123456789" : "9123 4567",
		deliveryMethod: "delivery" as const,
		address: {
			line1: "12 Bedok North Ave 3",
			line2: "",
			city: "",
			state: "",
			postcode: "238859",
			notes: "",
			mapsUrl: "",
			latitude: "",
			longitude: "",
			placeId: "",
		},
		pickupLocationId: "",
		fulfilmentDate: "2026-08-21",
		fulfilmentTime: "10:00",
		note: "",
	});

	it("the SG schema passes an SG address that the MY schema rejects", () => {
		expect(checkoutFormSchemaFor("SG").safeParse(formFor("SG")).success).toBe(
			true,
		);
		expect(checkoutFormSchemaFor("MY").safeParse(formFor("MY")).success).toBe(
			false,
		);
	});

	it("pickup orders skip the address arm in both countries", () => {
		for (const country of ["MY", "SG"] as const) {
			const pickup = {
				...formFor(country),
				deliveryMethod: "self_collect" as const,
			};
			pickup.address = { ...pickup.address, postcode: "" };
			expect(checkoutFormSchemaFor(country).safeParse(pickup).success).toBe(
				true,
			);
		}
	});
});

describe("waPhoneCheckoutSchema.SG (86eynw28q)", () => {
	it("normalizes local formats to the inbound (65…) form", () => {
		expect(waPhoneCheckoutSchema.SG.parse("9123 4567")).toBe("6591234567");
		expect(waPhoneCheckoutSchema.SG.parse("81234567")).toBe("6581234567");
		expect(waPhoneCheckoutSchema.SG.parse("+65 9123 4567")).toBe("6591234567");
		expect(waPhoneCheckoutSchema.SG.parse("6591234567")).toBe("6591234567");
	});

	it("rejects non-mobile and non-SG numbers with the SG copy", () => {
		for (const bad of [
			"9123", // junk
			"61234567", // 8 digits but not an 8/9 mobile range
			"60123456789", // MY number — no cross-accept between the arms
			"012-345 6789", // MY local form
			"not a phone",
			"",
		]) {
			const result = waPhoneCheckoutSchema.SG.safeParse(bad);
			expect(result.success, `expected ${JSON.stringify(bad)} to fail`).toBe(
				false,
			);
			if (!result.success) {
				expect(result.error.issues[0].message).toContain(
					"Singapore mobile number",
				);
			}
		}
	});
});
