// Lalamove keys: checked before they're stored, and removable (z8r3fdy5ht).
//
// The 28 Oct finding: an EasyParcel OAuth client ID + secret pasted into the
// Lalamove card was stored and badged "Live", and the card had no way to
// remove it. These pin the lock (shape refused on save), the probe
// (`lalamove.verifyKeys`), and every refusal Disconnect can give.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const USER = "user_lalamove_keys";

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}
const asUser = (t: ReturnType<typeof setup>) =>
	t.withIdentity({ subject: USER });

const KEYED = {
	enabled: true,
	vehicleType: "CAR" as const,
	promptBookOnPacked: true,
	deliveryDirection: "collection" as const,
	apiKey: "pk_test_stored",
	apiSecret: "sk_test_stored",
	apiKeyHint: "ored",
	env: "sandbox" as const,
	webhookRegisteredAt: 1,
};

async function seedStore(
	t: ReturnType<typeof setup>,
	patch: Partial<Doc<"retailers">> = {},
): Promise<Id<"retailers">> {
	await asUser(t).mutation(api.retailers.createRetailer, {
		storeName: "Kuih Corner",
		slug: "kuih-corner-keys",
	});
	const retailer = await asUser(t).query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	await t.run(async (ctx) => {
		await ctx.db.patch(retailer._id, {
			businessAddress: { label: "HQ", latitude: 3.139, longitude: 101.687 },
			...patch,
		});
	});
	return retailer._id;
}

async function seedJob(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	status: Doc<"deliveryJobs">["status"],
	shortId = "ORD-RIDE",
) {
	await t.run(async (ctx) => {
		const now = Date.now();
		const orderId = await ctx.db.insert("orders", {
			retailerId,
			shortId,
			items: [],
			subtotal: 5000,
			total: 5000,
			currency: "MYR",
			status: "shipped",
			channel: "whatsapp",
			customer: { name: "Aisha", waPhone: "60123456789" },
			deliveryMethod: "delivery",
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("deliveryJobs", {
			orderId,
			retailerId,
			provider: "lalamove",
			providerOrderId: `LLM-${shortId}`,
			status,
			costActual: 1350,
			quotationId: "quot-1",
			vehicleType: "MOTORCYCLE",
			createdAt: now,
			updatedAt: now,
		});
	});
}

const stored = (t: ReturnType<typeof setup>, id: Id<"retailers">) =>
	t.run(async (ctx) => (await ctx.db.get(id))?.deliveryBooking);

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("a NEW paste must look like a Lalamove pair — the server lock", () => {
	test("an EasyParcel client ID is refused, naming what a Lalamove key looks like", async () => {
		const t = setup();
		await seedStore(t);
		await expect(
			asUser(t).mutation(api.retailers.updateSettings, {
				deliveryBooking: {
					enabled: false,
					vehicleType: "MOTORCYCLE",
					apiKey: "1467ee4f-978c-45bb-9cf2-a3f73bd900e1",
					apiSecret: "d0a7408b9e0c4f",
				},
			}),
		).rejects.toThrow(/isn't a Lalamove API key/);
	});

	test("a live key with a sandbox secret is refused", async () => {
		const t = setup();
		await seedStore(t);
		await expect(
			asUser(t).mutation(api.retailers.updateSettings, {
				deliveryBooking: {
					enabled: false,
					vehicleType: "MOTORCYCLE",
					apiKey: "pk_prod_abc",
					apiSecret: "sk_test_abc",
				},
			}),
		).rejects.toThrow(/live key but the secret is a sandbox one/);
	});

	test("stored keys are never re-judged: a save that leaves them alone passes", async () => {
		const t = setup();
		// A legacy row whose key predates the rule.
		const id = await seedStore(t, {
			deliveryBooking: { ...KEYED, apiKey: "legacy-key", apiSecret: "x" },
		});
		await asUser(t).mutation(api.retailers.updateSettings, {
			deliveryBooking: { enabled: false, vehicleType: "MOTORCYCLE" },
		});
		expect((await stored(t, id))?.apiKey).toBe("legacy-key");
	});
});

describe("lalamove.verifyKeys — Lalamove itself vouches for the pair", () => {
	test("a refused shape never reaches Lalamove", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const t = setup();
		await seedStore(t);
		const result = await asUser(t).action(api.lalamove.verifyKeys, {
			apiKey: "1467ee4f-978c-45bb-9cf2-a3f73bd900e1",
			apiSecret: "secret",
		});
		expect(result).toMatchObject({ ok: false });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("a pair Lalamove accepts reads ok, probed on the sandbox host for test keys", async () => {
		const fetchMock = vi.fn(
			async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const t = setup();
		await seedStore(t);
		const result = await asUser(t).action(api.lalamove.verifyKeys, {
			apiKey: " pk_test_good ",
			apiSecret: "sk_test_good",
		});
		expect(result).toEqual({ ok: true, env: "sandbox" });
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("https://rest.sandbox.lalamove.com/v3/cities");
		expect(init.method).toBe("GET");
		// The store's market rides the request — a key for the other country
		// is refused here, not at the first quote.
		expect((init.headers as Record<string, string>).Market).toBe("MY");
	});

	test("Lalamove's 401 is a verdict, naming the store's country", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("ERR_UNAUTHORIZED", { status: 401 })),
		);
		const t = setup();
		await seedStore(t);
		const result = await asUser(t).action(api.lalamove.verifyKeys, {
			apiKey: "pk_prod_wrong",
			apiSecret: "sk_prod_wrong",
		});
		expect(result).toEqual({
			ok: false,
			message: expect.stringMatching(
				/didn't accept this key and secret for Malaysia/,
			),
		});
	});

	test("an unreachable Lalamove fails CLOSED — try again, never a pass", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("upstream", { status: 503 })),
		);
		const t = setup();
		await seedStore(t);
		const result = await asUser(t).action(api.lalamove.verifyKeys, {
			apiKey: "pk_prod_maybe",
			apiSecret: "sk_prod_maybe",
		});
		expect(result).toEqual({
			ok: false,
			message: expect.stringMatching(/Couldn't reach Lalamove.*nothing was saved/),
		});
	});

	test("someone else can't use a store's probe", async () => {
		vi.stubGlobal("fetch", vi.fn());
		const t = setup();
		const id = await seedStore(t);
		await expect(
			t
				.withIdentity({ subject: "user_stranger" })
				.action(api.lalamove.verifyKeys, {
					retailerId: id,
					apiKey: "pk_prod_x",
					apiSecret: "sk_prod_x",
				}),
		).rejects.toThrow();
	});
});

describe("Disconnect — deliveryBooking: null", () => {
	test("removes the keys and what they taught us; keeps the rider preferences", async () => {
		const t = setup();
		const id = await seedStore(t, { deliveryBooking: KEYED });
		await asUser(t).mutation(api.retailers.updateSettings, {
			deliveryBooking: null,
		});
		expect(await stored(t, id)).toEqual({
			enabled: false,
			vehicleType: "CAR",
			promptBookOnPacked: true,
			deliveryDirection: "collection",
		});
		const summary = (await asUser(t).query(api.retailers.getMyRetailer))
			?.deliveryBooking;
		expect(summary?.hasCredentials).toBe(false);
		expect(summary?.apiKeyHint).toBeUndefined();
	});

	test("refused while Lalamove quotes the delivery charge", async () => {
		const t = setup();
		await seedStore(t, {
			deliveryBooking: KEYED,
			deliveryConfig: { mode: "lalamove", onUnquotable: "arrange" },
		});
		await expect(
			asUser(t).mutation(api.retailers.updateSettings, {
				deliveryBooking: null,
			}),
		).rejects.toThrow(/Lalamove is quoting your delivery charge/);
	});

	test("refused when Lalamove is the only live bidder", async () => {
		const t = setup();
		await seedStore(t, {
			deliveryBooking: KEYED,
			deliveryConfig: { mode: "live", onUnquotable: "block" },
		});
		await expect(
			asUser(t).mutation(api.retailers.updateSettings, {
				deliveryBooking: null,
			}),
		).rejects.toThrow(/only courier pricing your live delivery charge/);
	});

	test("…but allowed when Delyva also bids on the live charge", async () => {
		const t = setup();
		const id = await seedStore(t, {
			deliveryBooking: KEYED,
			deliveryConfig: { mode: "live", onUnquotable: "block" },
			delyva: {
				enabled: true,
				apiKey: "dx-key",
				apiSecret: "dx-secret",
				apiKeyHint: "-key",
				customerId: 128399,
				defaultItemType: "PARCEL",
				pickupAddress: {
					address1: "12 Jalan Ampang",
					city: "Kuala Lumpur",
					state: "Kuala Lumpur",
					postcode: "50450",
				},
			},
		});
		await asUser(t).mutation(api.retailers.updateSettings, {
			deliveryBooking: null,
		});
		expect((await stored(t, id))?.apiKey).toBeUndefined();
	});

	test("switching the charge in the SAME call is honoured", async () => {
		const t = setup();
		const id = await seedStore(t, {
			deliveryBooking: KEYED,
			deliveryConfig: { mode: "lalamove", onUnquotable: "arrange" },
		});
		await asUser(t).mutation(api.retailers.updateSettings, {
			deliveryConfig: null,
			deliveryBooking: null,
		});
		expect((await stored(t, id))?.apiKey).toBeUndefined();
	});

	test("refused while a rider is out, naming the order", async () => {
		const t = setup();
		const id = await seedStore(t, { deliveryBooking: KEYED });
		await seedJob(t, id, "picked_up", "ORD-OUT1");
		await expect(
			asUser(t).mutation(api.retailers.updateSettings, {
				deliveryBooking: null,
			}),
		).rejects.toThrow(/rider is still out on ORD-OUT1/);
	});

	test("a finished trip doesn't hold it", async () => {
		const t = setup();
		const id = await seedStore(t, { deliveryBooking: KEYED });
		await seedJob(t, id, "completed");
		await asUser(t).mutation(api.retailers.updateSettings, {
			deliveryBooking: null,
		});
		expect((await stored(t, id))?.apiKey).toBeUndefined();
	});

	test("a scheduled booking buried under 51 finished trips still holds it (PR #427 review)", async () => {
		// Lalamove accepts `scheduleAt` up to 30 days out, so an `assigning`
		// job can be the store's OLDEST while dozens finish after it. A
		// "newest N" window over `by_retailer` let this one slip past; the
		// `by_retailer_status` read can't.
		const t = setup();
		const id = await seedStore(t, { deliveryBooking: KEYED });
		await seedJob(t, id, "assigning", "ORD-SCHED");
		for (let i = 0; i < 51; i++) {
			await seedJob(t, id, "completed", `ORD-DONE${i}`);
		}
		await expect(
			asUser(t).mutation(api.retailers.updateSettings, {
				deliveryBooking: null,
			}),
		).rejects.toThrow(/rider is still out on ORD-SCHED/);
		expect(await asUser(t).query(api.lalamove.getDisconnectState, {})).toEqual(
			expect.objectContaining({ reason: "rider_out", shortIds: ["ORD-SCHED"] }),
		);
	});

	test("never plan-gated: a Starter store can still remove its keys", async () => {
		const t = setup();
		const id = await seedStore(t, { deliveryBooking: KEYED });
		await t.run(async (ctx) => {
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", id))
				.first();
			if (sub)
				await ctx.db.patch(sub._id, { plan: "starter", status: "active" });
		});
		await asUser(t).mutation(api.retailers.updateSettings, {
			deliveryBooking: null,
		});
		expect((await stored(t, id))?.apiKey).toBeUndefined();
	});
});

describe("lalamove.getDisconnectState — the same rule, read before the tap", () => {
	test("null without keys, and for a store free to disconnect", async () => {
		const t = setup();
		const id = await seedStore(t);
		expect(await asUser(t).query(api.lalamove.getDisconnectState, {})).toBeNull();
		await t.run(async (ctx) => {
			await ctx.db.patch(id, { deliveryBooking: KEYED });
		});
		expect(await asUser(t).query(api.lalamove.getDisconnectState, {})).toBeNull();
	});

	test("names every order with a rider out, and the pricing reason first", async () => {
		const t = setup();
		const id = await seedStore(t, { deliveryBooking: KEYED });
		await seedJob(t, id, "assigning", "ORD-A1");
		await seedJob(t, id, "ongoing", "ORD-B2");
		const riders = await asUser(t).query(api.lalamove.getDisconnectState, {});
		expect(riders).toMatchObject({ reason: "rider_out" });
		expect(
			riders && "shortIds" in riders ? [...riders.shortIds].sort() : [],
		).toEqual(["ORD-A1", "ORD-B2"]);
		expect(riders?.message).toMatch(/ORD-\w+ and ORD-\w+/);

		await t.run(async (ctx) => {
			await ctx.db.patch(id, {
				deliveryConfig: { mode: "lalamove", onUnquotable: "arrange" },
			});
		});
		expect(
			await asUser(t).query(api.lalamove.getDisconnectState, {}),
		).toMatchObject({ reason: "pricing" });
	});
});
