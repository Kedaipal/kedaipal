/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { normalizeMyState, parseGoogleAddress } from "./google-address";

describe("normalizeMyState", () => {
	test("maps Federal Territory variants for Kuala Lumpur", () => {
		expect(normalizeMyState("Wilayah Persekutuan Kuala Lumpur")).toBe(
			"WP Kuala Lumpur",
		);
		expect(normalizeMyState("Federal Territory of Kuala Lumpur")).toBe(
			"WP Kuala Lumpur",
		);
		expect(normalizeMyState("WP Kuala Lumpur")).toBe("WP Kuala Lumpur");
		expect(normalizeMyState("Kuala Lumpur")).toBe("WP Kuala Lumpur");
	});

	test("maps Federal Territory variants for Labuan and Putrajaya", () => {
		expect(normalizeMyState("Wilayah Persekutuan Labuan")).toBe("WP Labuan");
		expect(normalizeMyState("Labuan")).toBe("WP Labuan");
		expect(normalizeMyState("Wilayah Persekutuan Putrajaya")).toBe(
			"WP Putrajaya",
		);
		expect(normalizeMyState("Putrajaya")).toBe("WP Putrajaya");
	});

	test("maps alternate spellings of Penang and Melaka", () => {
		expect(normalizeMyState("Penang")).toBe("Pulau Pinang");
		expect(normalizeMyState("Pulau Pinang")).toBe("Pulau Pinang");
		expect(normalizeMyState("Malacca")).toBe("Melaka");
		expect(normalizeMyState("Melaka")).toBe("Melaka");
	});

	test("matches the remaining states case-insensitively", () => {
		expect(normalizeMyState("Selangor")).toBe("Selangor");
		expect(normalizeMyState("selangor")).toBe("Selangor");
		expect(normalizeMyState("JOHOR")).toBe("Johor");
		expect(normalizeMyState("Negeri Sembilan")).toBe("Negeri Sembilan");
		expect(normalizeMyState("Pahang")).toBe("Pahang");
	});

	test("returns undefined for unknown or non-Malaysian values", () => {
		expect(normalizeMyState("Singapore")).toBeUndefined();
		expect(normalizeMyState("Bangkok")).toBeUndefined();
		expect(normalizeMyState("")).toBeUndefined();
	});
});

describe("parseGoogleAddress", () => {
	test("composes line1 from street_number + route", () => {
		const result = parseGoogleAddress(
			[
				{ types: ["street_number"], longText: "12", shortText: "12" },
				{
					types: ["route"],
					longText: "Jalan Tun Razak",
					shortText: "Jalan Tun Razak",
				},
				{
					types: ["locality", "political"],
					longText: "Kuala Lumpur",
					shortText: "Kuala Lumpur",
				},
				{
					types: ["administrative_area_level_1", "political"],
					longText: "Wilayah Persekutuan Kuala Lumpur",
					shortText: "WP",
				},
				{ types: ["postal_code"], longText: "50400", shortText: "50400" },
			],
			"12 Jalan Tun Razak, 50400 Kuala Lumpur, Malaysia",
		);
		expect(result.line1).toBe("12 Jalan Tun Razak");
		expect(result.city).toBe("Kuala Lumpur");
		expect(result.state).toBe("WP Kuala Lumpur");
		expect(result.postcode).toBe("50400");
	});

	test("uses route alone when street_number missing", () => {
		const result = parseGoogleAddress(
			[
				{ types: ["route"], longText: "Jalan Ampang", shortText: "Jalan Ampang" },
				{
					types: ["locality"],
					longText: "Kuala Lumpur",
					shortText: "Kuala Lumpur",
				},
			],
			"Jalan Ampang, Kuala Lumpur",
		);
		expect(result.line1).toBe("Jalan Ampang");
	});

	test("falls back to the first comma chunk for named buildings (no street)", () => {
		const result = parseGoogleAddress(
			[
				{
					types: ["locality"],
					longText: "Kuala Lumpur",
					shortText: "Kuala Lumpur",
				},
			],
			"Suria KLCC, Kuala Lumpur City Centre, 50088 Kuala Lumpur",
		);
		expect(result.line1).toBe("Suria KLCC");
	});

	test("falls through to postal_town when locality is absent", () => {
		const result = parseGoogleAddress(
			[
				{ types: ["route"], longText: "Some Road", shortText: "Some Road" },
				{
					types: ["postal_town"],
					longText: "Shah Alam",
					shortText: "Shah Alam",
				},
				{
					types: ["administrative_area_level_1"],
					longText: "Selangor",
					shortText: "Selangor",
				},
			],
			"Some Road, Shah Alam, Selangor",
		);
		expect(result.city).toBe("Shah Alam");
		expect(result.state).toBe("Selangor");
	});

	test("leaves state empty when Google returns an unrecognised territory", () => {
		const result = parseGoogleAddress(
			[
				{
					types: ["administrative_area_level_1"],
					longText: "Atlantis Province",
					shortText: "AP",
				},
			],
			"Atlantis Province",
		);
		expect(result.state).toBe("");
	});
});
