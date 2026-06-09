/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import {
	deriveMapsUrl,
	googleMapsNavUrl,
	normalizeMyState,
	parseGoogleAddress,
	wazeNavUrl,
} from "./google-address";

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

describe("deriveMapsUrl", () => {
	test("prefers the seller-pasted mapsUrl when set", () => {
		expect(
			deriveMapsUrl({
				mapsUrl: "https://maps.app.goo.gl/abc",
				placeId: "ChIJ_abc",
				latitude: 3.158,
				longitude: 101.712,
			}),
		).toBe("https://maps.app.goo.gl/abc");
	});

	test("uses placeId form when no mapsUrl — opens place by name in Google Maps", () => {
		expect(
			deriveMapsUrl({
				placeId: "ChIJ_abc",
				latitude: 3.158,
				longitude: 101.712,
			}),
		).toBe("https://www.google.com/maps/place/?q=place_id:ChIJ_abc");
	});

	test("falls back to a lat/lng search URL when no mapsUrl and no placeId", () => {
		expect(
			deriveMapsUrl({
				latitude: 3.158,
				longitude: 101.712,
			}),
		).toBe("https://www.google.com/maps/search/?api=1&query=3.158,101.712");
	});

	test("treats an empty mapsUrl/placeId as absent and falls through", () => {
		expect(
			deriveMapsUrl({
				mapsUrl: "   ",
				placeId: "  ",
				latitude: 3.158,
				longitude: 101.712,
			}),
		).toBe("https://www.google.com/maps/search/?api=1&query=3.158,101.712");
	});

	test("returns undefined when nothing usable is present", () => {
		expect(deriveMapsUrl({})).toBeUndefined();
	});

	test("returns undefined when only one of lat/lng is set and no placeId", () => {
		expect(deriveMapsUrl({ latitude: 3.158 })).toBeUndefined();
		expect(deriveMapsUrl({ longitude: 101.712 })).toBeUndefined();
	});

	test("placeId alone is enough even without coordinates", () => {
		expect(
			deriveMapsUrl({
				placeId: "ChIJ_abc",
			}),
		).toBe("https://www.google.com/maps/place/?q=place_id:ChIJ_abc");
	});
});

describe("googleMapsNavUrl", () => {
	test("prefers placeId over coords (opens the named place, not a lat/lng pin)", () => {
		expect(
			googleMapsNavUrl({
				placeId: "ChIJ_abc",
				latitude: 3.158,
				longitude: 101.712,
			}),
		).toBe("https://www.google.com/maps/place/?q=place_id:ChIJ_abc");
	});

	test("ignores a pasted mapsUrl — this is specifically the Google target", () => {
		// @ts-expect-error mapsUrl isn't part of the nav-helper input by design.
		const url = googleMapsNavUrl({ mapsUrl: "https://waze.com/ul?ll=1,2", placeId: "ChIJ_abc" });
		expect(url).toBe("https://www.google.com/maps/place/?q=place_id:ChIJ_abc");
	});

	test("falls back to a lat/lng search URL without a placeId", () => {
		expect(googleMapsNavUrl({ latitude: 3.158, longitude: 101.712 })).toBe(
			"https://www.google.com/maps/search/?api=1&query=3.158,101.712",
		);
	});

	test("undefined when neither placeId nor full coords present", () => {
		expect(googleMapsNavUrl({})).toBeUndefined();
		expect(googleMapsNavUrl({ latitude: 3.158 })).toBeUndefined();
		expect(googleMapsNavUrl({ placeId: "   " })).toBeUndefined();
	});
});

describe("wazeNavUrl", () => {
	test("navigates by coordinates", () => {
		expect(wazeNavUrl({ latitude: 3.158, longitude: 101.712 })).toBe(
			"https://waze.com/ul?ll=3.158,101.712&navigate=yes",
		);
	});

	test("undefined without coords (Waze has no placeId concept)", () => {
		expect(wazeNavUrl({})).toBeUndefined();
		expect(wazeNavUrl({ latitude: 3.158 })).toBeUndefined();
		// @ts-expect-error placeId isn't a Waze input.
		expect(wazeNavUrl({ placeId: "ChIJ_abc" })).toBeUndefined();
	});
});
