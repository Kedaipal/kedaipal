import { describe, expect, it } from "vitest";
import {
	checkoutFormSchemaFor,
	myWaPhoneCheckoutSchema,
	strictAddressSchemaFor,
} from "./schemas";

// Mirrors convex/lib/slug.ts assertValidMyWaPhone's normalization, then
// requires a Malaysian MOBILE shape — the checkout gate for the WABA
// confirmation push (86eyf1rck). The server re-validates on create.
describe("myWaPhoneCheckoutSchema", () => {
	it("normalizes local formats to the inbound (60…) form", () => {
		expect(myWaPhoneCheckoutSchema.parse("0123456789")).toBe("60123456789");
		expect(myWaPhoneCheckoutSchema.parse("012-345 6789")).toBe("60123456789");
		expect(myWaPhoneCheckoutSchema.parse("+60 12-345 6789")).toBe(
			"60123456789",
		);
		expect(myWaPhoneCheckoutSchema.parse("60123456789")).toBe("60123456789");
	});

	it("accepts 011-series numbers (one digit longer)", () => {
		expect(myWaPhoneCheckoutSchema.parse("011-2345 6789")).toBe("601123456789");
	});

	// The field renders a "+60" prefix badge (86eyfq04j), so a buyer who reads
	// it and types only the rest must be accepted — otherwise the badge tells
	// them to do the one thing the validator rejects.
	it("accepts a bare national number typed after the +60 badge", () => {
		expect(myWaPhoneCheckoutSchema.parse("123456789")).toBe("60123456789");
		expect(myWaPhoneCheckoutSchema.parse("12-345 6789")).toBe("60123456789");
		expect(myWaPhoneCheckoutSchema.parse("1123456789")).toBe("601123456789");
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
			const result = myWaPhoneCheckoutSchema.safeParse(bad);
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
	const baseForm = {
		name: "Tan Wei Ming",
		waPhone: "0123456789",
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
	};

	it("the SG schema passes an SG address that the MY schema rejects", () => {
		expect(checkoutFormSchemaFor("SG").safeParse(baseForm).success).toBe(true);
		expect(checkoutFormSchemaFor("MY").safeParse(baseForm).success).toBe(
			false,
		);
	});

	it("pickup orders skip the address arm in both countries", () => {
		const pickup = {
			...baseForm,
			deliveryMethod: "self_collect" as const,
			address: { ...baseForm.address, postcode: "" },
		};
		expect(checkoutFormSchemaFor("MY").safeParse(pickup).success).toBe(true);
		expect(checkoutFormSchemaFor("SG").safeParse(pickup).success).toBe(true);
	});
});
