/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { syntheticGaClientId } from "./lib/ga4";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER = "user_analytics_test";

async function seedRetailer(t: ReturnType<typeof setup>) {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Analytics Store",
		slug: "analytics-store",
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

type FetchCall = { url: string; body: unknown };

function installFetchMock(opts: { fail?: boolean } = {}): {
	calls: FetchCall[];
	restore: () => void;
} {
	const calls: FetchCall[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
		calls.push({
			url: String(url),
			body: init?.body ? JSON.parse(init.body as string) : null,
		});
		if (opts.fail) throw new Error("network down");
		return new Response("", { status: 204 });
	}) as unknown as typeof fetch;
	return {
		calls,
		restore: () => {
			globalThis.fetch = original;
		},
	};
}

beforeEach(() => {
	process.env.GA4_MEASUREMENT_ID = "G-TEST123";
	process.env.GA4_MP_API_SECRET = "secret-abc";
});

afterEach(() => {
	delete process.env.GA4_MEASUREMENT_ID;
	delete process.env.GA4_MP_API_SECRET;
	vi.restoreAllMocks();
});

describe("ga4Events.sendKeyEvent", () => {
	test("POSTs the event to the MP endpoint with ids in the query and src in params", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const fetchMock = installFetchMock();

		await t.action(internal.ga4Events.sendKeyEvent, {
			event: "first_order",
			retailerId: retailer._id,
			gaClientId: "123.456",
			src: "tiktok",
		});

		expect(fetchMock.calls).toHaveLength(1);
		const call = fetchMock.calls[0];
		expect(call.url).toContain("https://www.google-analytics.com/mp/collect");
		expect(call.url).toContain("measurement_id=G-TEST123");
		expect(call.url).toContain("api_secret=secret-abc");
		expect(call.body).toEqual({
			client_id: "123.456",
			events: [
				{
					name: "first_order",
					params: { engagement_time_msec: 1, src: "tiktok" },
				},
			],
		});
		fetchMock.restore();
	});

	test("falls back to a synthetic client id derived from the retailer id", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const fetchMock = installFetchMock();

		await t.action(internal.ga4Events.sendKeyEvent, {
			event: "first_order",
			retailerId: retailer._id,
		});

		const body = fetchMock.calls[0].body as { client_id: string };
		expect(body.client_id).toBe(syntheticGaClientId(retailer._id));
		fetchMock.restore();
	});

	test("forwards extra params (subscribe_paid revenue shape)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const fetchMock = installFetchMock();

		await t.action(internal.ga4Events.sendKeyEvent, {
			event: "subscribe_paid",
			retailerId: retailer._id,
			gaClientId: "9.9",
			params: {
				plan: "pro",
				cycle: "monthly",
				first_time: true,
				value: 149,
				currency: "MYR",
			},
		});

		const body = fetchMock.calls[0].body as {
			events: Array<{ name: string; params: Record<string, unknown> }>;
		};
		expect(body.events[0].name).toBe("subscribe_paid");
		expect(body.events[0].params).toMatchObject({
			plan: "pro",
			cycle: "monthly",
			first_time: true,
			value: 149,
			currency: "MYR",
		});
		fetchMock.restore();
	});

	test("no-ops (no fetch) when the env vars are unset", async () => {
		delete process.env.GA4_MEASUREMENT_ID;
		delete process.env.GA4_MP_API_SECRET;
		const t = setup();
		const retailer = await seedRetailer(t);
		const fetchMock = installFetchMock();

		await t.action(internal.ga4Events.sendKeyEvent, {
			event: "first_order",
			retailerId: retailer._id,
		});

		expect(fetchMock.calls).toHaveLength(0);
		fetchMock.restore();
	});

	test("never throws when the network fails — analytics must not break callers", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const fetchMock = installFetchMock({ fail: true });
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(
			t.action(internal.ga4Events.sendKeyEvent, {
				event: "first_order",
				retailerId: retailer._id,
			}),
		).resolves.toBeNull();
		expect(errorSpy).toHaveBeenCalled();
		fetchMock.restore();
	});
});
