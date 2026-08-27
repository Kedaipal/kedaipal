/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const KEY = "phc_unit_test_key";
const DISTINCT_ID = "0198f3a1-4b2c-7d3e-8f90-a1b2c3d4e5f6";
const AT = Date.UTC(2026, 7, 27, 4, 30, 0);

/**
 * A stubbed `fetch`. The parameter types are declared rather than inferred so
 * `mock.calls` stays a typed 2-tuple — `vi.fn(async () => …)` infers zero
 * parameters, and every call-site read then fails to compile.
 */
function okFetch() {
	return vi.fn(
		async (_input: string | URL | Request, _init?: RequestInit) =>
			new Response("{}", { status: 200 }),
	);
}

/** The URL the capture action POSTed to. */
function urlOf(fetchMock: ReturnType<typeof okFetch>) {
	return String(fetchMock.mock.calls[0][0]);
}

/** The single JSON body our capture action POSTed. */
function bodyOf(fetchMock: ReturnType<typeof okFetch>) {
	return JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
}

beforeEach(() => {
	vi.stubEnv("POSTHOG_PROJECT_KEY", KEY);
	vi.stubEnv("POSTHOG_HOST", "https://eu.i.posthog.com");
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("posthog.capture", () => {
	test("posts the documented capture payload", async () => {
		const t = convexTest(schema, modules);
		const fetchMock = okFetch();
		vi.stubGlobal("fetch", fetchMock);

		await t.action(internal.posthog.capture, {
			event: "order_created",
			distinctId: DISTINCT_ID,
			properties: { total: 42.5, currency: "MYR", confirmedAtCreate: true },
			timestamp: AT,
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(urlOf(fetchMock)).toBe("https://eu.i.posthog.com/i/v0/e/");
		expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");

		const body = bodyOf(fetchMock);
		expect(body.api_key).toBe(KEY);
		expect(body.event).toBe("order_created");
		expect(body.distinct_id).toBe(DISTINCT_ID);
		expect(body.timestamp).toBe(new Date(AT).toISOString());
		expect(body.properties).toMatchObject({
			total: 42.5,
			currency: "MYR",
			confirmedAtCreate: true,
		});
	});

	// The client boots with person_profiles: "identified_only" so an anonymous
	// shopper never mints a profile. A server event that quietly created one for
	// the same distinct id would defeat that — and put a durable person record
	// behind an id we joined to an order.
	test("keeps buyers person-less unless the caller opts in", async () => {
		const t = convexTest(schema, modules);
		const fetchMock = okFetch();
		vi.stubGlobal("fetch", fetchMock);

		await t.action(internal.posthog.capture, {
			event: "order_created",
			distinctId: DISTINCT_ID,
			properties: {},
			timestamp: AT,
		});

		expect(bodyOf(fetchMock).properties.$process_person_profile).toBe(false);
	});

	test("allows a person profile for an identified subject", async () => {
		const t = convexTest(schema, modules);
		const fetchMock = okFetch();
		vi.stubGlobal("fetch", fetchMock);

		await t.action(internal.posthog.capture, {
			event: "order_created",
			distinctId: DISTINCT_ID,
			properties: {},
			timestamp: AT,
			withPersonProfile: true,
		});

		expect(bodyOf(fetchMock).properties.$process_person_profile).toBe(true);
	});

	// Same env-gated posture as useClarity/useGoogleAnalytics on the client: a
	// deployment without the var configured is analytics-free, not broken.
	test("no-ops when POSTHOG_PROJECT_KEY is unset", async () => {
		vi.stubEnv("POSTHOG_PROJECT_KEY", "");
		const t = convexTest(schema, modules);
		const fetchMock = okFetch();
		vi.stubGlobal("fetch", fetchMock);

		await t.action(internal.posthog.capture, {
			event: "order_created",
			distinctId: DISTINCT_ID,
			properties: {},
			timestamp: AT,
		});

		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("defaults to PostHog US cloud when no host is configured", async () => {
		vi.stubEnv("POSTHOG_HOST", "");
		const t = convexTest(schema, modules);
		const fetchMock = okFetch();
		vi.stubGlobal("fetch", fetchMock);

		await t.action(internal.posthog.capture, {
			event: "order_created",
			distinctId: DISTINCT_ID,
			properties: {},
			timestamp: AT,
		});

		expect(urlOf(fetchMock)).toBe("https://us.i.posthog.com/i/v0/e/");
	});

	test("trims a trailing slash off the configured host", async () => {
		vi.stubEnv("POSTHOG_HOST", "https://ph.kedaipal.com///");
		const t = convexTest(schema, modules);
		const fetchMock = okFetch();
		vi.stubGlobal("fetch", fetchMock);

		await t.action(internal.posthog.capture, {
			event: "order_created",
			distinctId: DISTINCT_ID,
			properties: {},
			timestamp: AT,
		});

		expect(urlOf(fetchMock)).toBe("https://ph.kedaipal.com/i/v0/e/");
	});

	// Analytics is never load-bearing: the order already committed, so a dropped
	// event is a reporting gap, not something a seller or buyer should ever see.
	test("swallows a network failure", async () => {
		const t = convexTest(schema, modules);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("ECONNRESET");
			}),
		);

		await expect(
			t.action(internal.posthog.capture, {
				event: "order_created",
				distinctId: DISTINCT_ID,
				properties: {},
				timestamp: AT,
			}),
		).resolves.toBeNull();
	});

	test("swallows a rejection from PostHog", async () => {
		const t = convexTest(schema, modules);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("bad key", { status: 401 })),
		);

		await expect(
			t.action(internal.posthog.capture, {
				event: "order_created",
				distinctId: DISTINCT_ID,
				properties: {},
				timestamp: AT,
			}),
		).resolves.toBeNull();
	});
});


/* ── end-to-end: orders.create → scheduled capture ─────────────────────────── */

const USER = "user_posthog_e2e";
const BUYER = "60123456789";

function storeSetup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

async function seedStoreAndProduct(
	t: ReturnType<typeof storeSetup>,
	slug: string,
) {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Cake Studio",
		slug,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	const productId = await asUser.mutation(api.products.create, {
		retailerId: retailer._id,
		name: "Tent 2P",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		requiresProof: false,
		variants: [{ optionValues: [], price: 12000, onHand: 100 }],
	});
	return { retailerId: retailer._id, productId };
}

async function placeOrder(
	t: ReturnType<typeof storeSetup>,
	retailerId: Id<"retailers">,
	productId: Id<"products">,
	analyticsDistinctId?: string,
) {
	return await t.mutation(api.orders.create, {
		retailerId,
		items: [{ productId, quantity: 1 }],
		currency: "MYR",
		channel: "whatsapp",
		customer: { name: "Ali", waPhone: BUYER },
		attributionSource: "tiktok",
		analyticsDistinctId,
		deliveryAddress: {
			line1: "12 Jln Mawar 3",
			city: "Petaling Jaya",
			state: "Selangor",
			postcode: "47301",
		},
	});
}

/** Scheduled PostHog capture jobs, with the args they were queued with. */
async function captureJobs(t: ReturnType<typeof storeSetup>) {
	const jobs = await t.run((ctx) =>
		ctx.db.system.query("_scheduled_functions").collect(),
	);
	return jobs.filter((j) => j.name.includes("posthog"));
}

async function storedDistinctId(
	t: ReturnType<typeof storeSetup>,
	shortId: string,
) {
	return await t.run(async (ctx) => {
		const order = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		// Normalised to null on purpose: a t.run() return crosses the Convex value
		// encoding, which turns undefined into null. Asserting on undefined here
		// would fail for a reason that has nothing to do with the field.
		return order?.analyticsDistinctId ?? null;
	});
}

describe("orders.create → PostHog", () => {
	test("schedules order_created with the distinct id and PII-free properties", async () => {
		const t = storeSetup();
		const { retailerId, productId } = await seedStoreAndProduct(t, "cake-ph-1");

		const { shortId } = await placeOrder(t, retailerId, productId, DISTINCT_ID);

		expect(await storedDistinctId(t, shortId)).toBe(DISTINCT_ID);
		const jobs = await captureJobs(t);
		expect(jobs).toHaveLength(1);
		const args = jobs[0].args[0] as {
			event: string;
			distinctId: string;
			properties: Record<string, unknown>;
		};
		expect(args.event).toBe("order_created");
		expect(args.distinctId).toBe(DISTINCT_ID);
		expect(args.properties).toMatchObject({
			retailerId,
			currency: "MYR",
			total: 12000,
			lineCount: 1,
			itemCount: 1,
			attributionSource: "tiktok",
		});
		// The whole point of the scalar-only validator: no buyer PII rides along.
		const serialized = JSON.stringify(args.properties);
		expect(serialized).not.toContain(BUYER);
		expect(serialized).not.toContain("Ali");
		expect(serialized).not.toContain("Jln Mawar");
	});

	// An unattributed event would land on a synthetic person and skew the funnel,
	// so it is dropped rather than sent — and the order still commits normally.
	test("schedules nothing when the buyer carries no distinct id", async () => {
		const t = storeSetup();
		const { retailerId, productId } = await seedStoreAndProduct(t, "cake-ph-2");

		const { shortId } = await placeOrder(t, retailerId, productId);

		expect(await storedDistinctId(t, shortId)).toBeNull();
		expect(await captureJobs(t)).toHaveLength(0);
	});

	// A public mutation never trusts a client string: the same junk the client
	// sanitizer drops must also be dropped server-side.
	test("drops a junk distinct id server-side rather than storing it", async () => {
		const t = storeSetup();
		const { retailerId, productId } = await seedStoreAndProduct(t, "cake-ph-3");

		const { shortId } = await placeOrder(t, retailerId, productId, "undefined");

		expect(await storedDistinctId(t, shortId)).toBeNull();
		expect(await captureJobs(t)).toHaveLength(0);
	});
});
