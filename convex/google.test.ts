/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER = "user_google_test";

type FetchCall = { url: string; init?: RequestInit };

/**
 * Install a fetch mock that responds with the JSON body the caller queues
 * via `queueResponse`. Returns the captured calls + the queue so tests can
 * assert what was sent and stage responses in sequence.
 */
function installFetchMock(): {
	calls: FetchCall[];
	queueResponse: (body: unknown, status?: number) => void;
	restore: () => void;
} {
	const calls: FetchCall[] = [];
	const queue: Array<{ body: unknown; status: number }> = [];
	const original = globalThis.fetch;
	globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
		calls.push({ url: String(url), init });
		const next = queue.shift() ?? { body: {}, status: 200 };
		return new Response(JSON.stringify(next.body), { status: next.status });
	}) as unknown as typeof fetch;
	return {
		calls,
		queueResponse: (body, status = 200) => queue.push({ body, status }),
		restore: () => {
			globalThis.fetch = original;
		},
	};
}

async function seedRetailerId(
	t: ReturnType<typeof convexTest>,
): Promise<Id<"retailers">> {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Google Test Store",
		slug: "google-test-store",
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer._id;
}

beforeEach(() => {
	process.env.GOOGLE_MAPS_API_KEY = "test-google-key";
});

afterEach(() => {
	vi.restoreAllMocks();
	process.env.GOOGLE_MAPS_API_KEY = "";
});

describe("google.autocompleteAddress", () => {
	test("returns empty predictions when input shorter than 2 chars", async () => {
		const t = setup();
		const retailerId = await seedRetailerId(t);
		const mock = installFetchMock();
		try {
			const result = await t.action(api.google.autocompleteAddress, {
				input: " a ",
				sessionToken: "tok-1",
				retailerId,
			});
			expect(result.predictions).toEqual([]);
			expect(mock.calls).toHaveLength(0); // never hit Google
		} finally {
			mock.restore();
		}
	});

	test("normalizes Google's suggestions payload into the lean predictions shape", async () => {
		const t = setup();
		const retailerId = await seedRetailerId(t);
		const mock = installFetchMock();
		mock.queueResponse({
			suggestions: [
				{
					placePrediction: {
						placeId: "ChIJ_abc",
						structuredFormat: {
							mainText: { text: "Suria KLCC" },
							secondaryText: { text: "Kuala Lumpur, Malaysia" },
						},
					},
				},
				{
					placePrediction: {
						placeId: "ChIJ_xyz",
						structuredFormat: {
							mainText: { text: "Pavilion KL" },
							// secondaryText omitted to verify fallback
						},
					},
				},
				// One garbage entry without placeId — must be filtered out
				{ placePrediction: { structuredFormat: { mainText: { text: "?" } } } },
			],
		});
		try {
			const result = await t.action(api.google.autocompleteAddress, {
				input: "klcc",
				sessionToken: "tok-2",
				retailerId,
			});
			expect(result.predictions).toEqual([
				{
					placeId: "ChIJ_abc",
					primaryText: "Suria KLCC",
					secondaryText: "Kuala Lumpur, Malaysia",
				},
				{
					placeId: "ChIJ_xyz",
					primaryText: "Pavilion KL",
					secondaryText: "",
				},
			]);
		} finally {
			mock.restore();
		}
	});

	test("forwards api key + session token + MY region to Google", async () => {
		const t = setup();
		const retailerId = await seedRetailerId(t);
		const mock = installFetchMock();
		mock.queueResponse({ suggestions: [] });
		try {
			await t.action(api.google.autocompleteAddress, {
				input: "klcc",
				sessionToken: "session-fixed",
				retailerId,
			});
			expect(mock.calls).toHaveLength(1);
			const call = mock.calls[0];
			expect(call.url).toContain("places.googleapis.com/v1/places:autocomplete");
			const headers = call.init?.headers as Record<string, string> | undefined;
			expect(headers?.["X-Goog-Api-Key"]).toBe("test-google-key");
			const sent = JSON.parse(call.init?.body as string);
			expect(sent.input).toBe("klcc");
			expect(sent.sessionToken).toBe("session-fixed");
			expect(sent.includedRegionCodes).toEqual(["my"]);
		} finally {
			mock.restore();
		}
	});

	test("throws a sanitized error on non-2xx", async () => {
		const t = setup();
		const retailerId = await seedRetailerId(t);
		const mock = installFetchMock();
		mock.queueResponse({ error: "bad key" }, 403);
		try {
			await expect(
				t.action(api.google.autocompleteAddress, {
					input: "klcc",
					sessionToken: "tok-err",
					retailerId,
				}),
			).rejects.toThrow(/Address lookup is unavailable/);
		} finally {
			mock.restore();
		}
	});

	test("refuses unauthenticated call with no retailerId (no scoping for rate limit)", async () => {
		const t = setup();
		const mock = installFetchMock();
		try {
			await expect(
				t.action(api.google.autocompleteAddress, {
					input: "klcc",
					sessionToken: "tok-unscoped",
				}),
			).rejects.toThrow(/Missing rate-limit context/);
			expect(mock.calls).toHaveLength(0);
		} finally {
			mock.restore();
		}
	});

	test("fails when GOOGLE_MAPS_API_KEY is unset", async () => {
		const t = setup();
		const retailerId = await seedRetailerId(t);
		process.env.GOOGLE_MAPS_API_KEY = "";
		const mock = installFetchMock();
		try {
			await expect(
				t.action(api.google.autocompleteAddress, {
					input: "klcc",
					sessionToken: "tok-nokey",
					retailerId,
				}),
			).rejects.toThrow(/Google Maps is not configured/);
		} finally {
			mock.restore();
		}
	});
});

describe("google.getPlaceDetails", () => {
	test("returns normalized place details", async () => {
		const t = setup();
		const retailerId = await seedRetailerId(t);
		const mock = installFetchMock();
		mock.queueResponse({
			formattedAddress: "12 Jalan Tun Razak, 50400 Kuala Lumpur, Malaysia",
			location: { latitude: 3.158, longitude: 101.712 },
			addressComponents: [
				{ types: ["street_number"], longText: "12", shortText: "12" },
				{
					types: ["route"],
					longText: "Jalan Tun Razak",
					shortText: "Jalan Tun Razak",
				},
				{
					types: ["postal_code"],
					longText: "50400",
					shortText: "50400",
				},
				{
					types: ["locality", "political"],
					longText: "Kuala Lumpur",
					shortText: "Kuala Lumpur",
				},
				{
					types: ["administrative_area_level_1", "political"],
					longText: "Wilayah Persekutuan Kuala Lumpur",
					shortText: "WP Kuala Lumpur",
				},
			],
		});
		try {
			const result = await t.action(api.google.getPlaceDetails, {
				placeId: "ChIJ_abc",
				sessionToken: "tok-3",
				retailerId,
			});
			expect(result.formattedAddress).toBe(
				"12 Jalan Tun Razak, 50400 Kuala Lumpur, Malaysia",
			);
			expect(result.latitude).toBeCloseTo(3.158);
			expect(result.longitude).toBeCloseTo(101.712);
			expect(result.addressComponents).toHaveLength(5);
			expect(result.addressComponents[0]).toEqual({
				types: ["street_number"],
				longText: "12",
				shortText: "12",
			});
		} finally {
			mock.restore();
		}
	});

	test("forwards session token + field mask + api key", async () => {
		const t = setup();
		const retailerId = await seedRetailerId(t);
		const mock = installFetchMock();
		mock.queueResponse({
			formattedAddress: "x",
			location: { latitude: 1, longitude: 2 },
			addressComponents: [],
		});
		try {
			await t.action(api.google.getPlaceDetails, {
				placeId: "ChIJ_xyz",
				sessionToken: "session-fixed",
				retailerId,
			});
			expect(mock.calls).toHaveLength(1);
			const call = mock.calls[0];
			expect(call.url).toContain("places.googleapis.com/v1/places/ChIJ_xyz");
			expect(call.url).toContain("sessionToken=session-fixed");
			const headers = call.init?.headers as Record<string, string> | undefined;
			expect(headers?.["X-Goog-Api-Key"]).toBe("test-google-key");
			expect(headers?.["X-Goog-FieldMask"]).toContain("formattedAddress");
			expect(headers?.["X-Goog-FieldMask"]).toContain("location");
			expect(headers?.["X-Goog-FieldMask"]).toContain("addressComponents");
		} finally {
			mock.restore();
		}
	});

	test("throws when the place response is missing coordinates", async () => {
		const t = setup();
		const retailerId = await seedRetailerId(t);
		const mock = installFetchMock();
		mock.queueResponse({
			formattedAddress: "x",
			// no location field
			addressComponents: [],
		});
		try {
			await expect(
				t.action(api.google.getPlaceDetails, {
					placeId: "ChIJ_nocoords",
					sessionToken: "tok-4",
					retailerId,
				}),
			).rejects.toThrow(/didn't return usable coordinates/);
		} finally {
			mock.restore();
		}
	});

	test("throws a sanitized error on non-2xx", async () => {
		const t = setup();
		const retailerId = await seedRetailerId(t);
		const mock = installFetchMock();
		mock.queueResponse({ error: "not found" }, 404);
		try {
			await expect(
				t.action(api.google.getPlaceDetails, {
					placeId: "ChIJ_missing",
					sessionToken: "tok-err",
					retailerId,
				}),
			).rejects.toThrow(/Couldn't load that address/);
		} finally {
			mock.restore();
		}
	});
});
