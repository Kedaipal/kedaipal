/// <reference types="vite/client" />
// EasyParcel on the Open API (z8r3fdcje2) — the OAuth connect through the
// real HTTP routes (state single-use + expiry, code exchange, account/wallet
// import), token refresh + the dead-grant path, the unsigned-webhook nudge,
// status application, the return-URL pin, and the dispatch blocks. Network is
// mocked from the documented samples; pure wire mechanics are covered in
// convex/lib/easyparcel.test.ts.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { allowedReturnTo } from "./easyparcel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER = "user_easyparcel_tests";
const SITE = "https://dev-test.convex.site";
const APP = "http://localhost:3000";

beforeEach(() => {
	vi.stubEnv("EASYPARCEL_CLIENT_ID", "client-id-test");
	vi.stubEnv("EASYPARCEL_CLIENT_SECRET", "client-secret-test");
	vi.stubEnv("CONVEX_SITE_URL", SITE);
	vi.stubEnv("SITE_URL", APP);
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

async function seedRetailer(
	t: ReturnType<typeof setup>,
	country: "SG" | "MY" = "SG",
) {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Kedai SG",
		slug: "kedai-sg-easyparcel",
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	await t.run(async (ctx) => {
		await ctx.db.patch(retailer._id, {
			country,
			currency: country === "SG" ? "SGD" : "MYR",
			waPhone: "6591234567",
		});
	});
	return retailer;
}

async function seedConnection(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	overrides: Partial<Doc<"easyparcelConnections">> = {},
) {
	return t.run(async (ctx) =>
		ctx.db.insert("easyparcelConnections", {
			retailerId,
			enabled: true,
			// Plaintext in tests: no encryption key is set, so encryptSecret
			// and decryptSecret pass through.
			accessToken: "access-live",
			refreshToken: "refresh-live",
			accessExpiresAt: Date.now() + 60 * 60 * 1000,
			accountName: "Kedai SG Pte Ltd",
			balanceMinor: 5000,
			balanceCurrency: "SGD",
			pickupAddress: {
				unit: "#05-11",
				address1: "10 Anson Road",
				city: "Singapore",
				state: "Singapore",
				postcode: "079903",
			},
			connectedAt: Date.now(),
			updatedAt: Date.now(),
			...overrides,
		}),
	);
}

let orderSeq = 0;
async function seedOrder(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	overrides: Partial<Doc<"orders">> = {},
): Promise<{ orderId: Id<"orders">; shortId: string }> {
	orderSeq += 1;
	const shortId = `ORD-E${String(orderSeq).padStart(3, "0")}`;
	const orderId = await t.run(async (ctx) => {
		const now = Date.now();
		return ctx.db.insert("orders", {
			retailerId,
			shortId,
			items: [],
			subtotal: 4500,
			total: 4500,
			currency: "SGD",
			status: "confirmed",
			channel: "whatsapp",
			customer: { name: "Mei Ling", waPhone: "6598765432" },
			deliveryMethod: "delivery",
			deliveryAddress: {
				line1: "Blk 123 Bedok North Ave 3",
				city: "Singapore",
				state: "Singapore",
				postcode: "460123",
			},
			createdAt: now,
			updatedAt: now,
			...overrides,
		});
	});
	return { orderId, shortId };
}

async function seedJob(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	orderId: Id<"orders">,
	overrides: Partial<Doc<"deliveryJobs">> = {},
): Promise<Id<"deliveryJobs">> {
	return t.run(async (ctx) => {
		const now = Date.now();
		return ctx.db.insert("deliveryJobs", {
			orderId,
			retailerId,
			provider: "easyparcel",
			providerOrderId: "ES-2610-AAAAA",
			status: "assigning",
			costActual: 800,
			quotationId: "EP-CS096",
			vehicleType: "EP-CS096",
			serviceName: "Ninja Van",
			createdAt: now,
			updatedAt: now,
			...overrides,
		});
	});
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

const TOKEN_RESPONSE = {
	token_type: "Bearer",
	expires_in: 36000,
	access_token: "access-new",
	refresh_token: "refresh-new",
	refresh_token_expires_in: 31557600,
};

describe("the return-URL pin (open-redirect guard)", () => {
	test("own origin always; localhost only on a localhost dev site", () => {
		expect(allowedReturnTo("http://localhost:3000/app/settings", APP)).toBe(true);
		// A worktree on another port, against a localhost dev deployment.
		expect(allowedReturnTo("http://localhost:3226/app/settings", APP)).toBe(true);
		expect(
			allowedReturnTo("https://kedaipal.com/app/settings", "https://kedaipal.com"),
		).toBe(true);
		// Production never bounces to a localhost, nor anywhere else.
		expect(
			allowedReturnTo("http://localhost:3000/x", "https://kedaipal.com"),
		).toBe(false);
		expect(allowedReturnTo("https://evil.example/x", APP)).toBe(false);
		expect(allowedReturnTo("javascript:alert(1)", APP)).toBe(false);
		expect(allowedReturnTo("not a url", APP)).toBe(false);
		expect(allowedReturnTo("https://kedaipal.com/x", undefined)).toBe(false);
	});
});

describe("connect — start", () => {
	test("mints a single-use state and EasyParcel's sign-in URL", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const result = await t
			.withIdentity({ subject: USER })
			.mutation(api.easyparcel.startConnect, {
				returnTo: `${APP}/app/settings`,
			});
		if (!result.ok) throw new Error(result.message);
		const url = new URL(result.url);
		expect(url.origin + url.pathname).toBe("https://api.easyparcel.com/oauth/login");
		expect(url.searchParams.get("client_id")).toBe("client-id-test");
		expect(url.searchParams.get("redirect_uri")).toBe(
			`${SITE}/oauth/easyparcel/callback`,
		);
		const state = await t.run(async (ctx) =>
			ctx.db
				.query("courierOAuthStates")
				.withIndex("by_nonce", (q) =>
					q.eq("nonce", url.searchParams.get("state") ?? ""),
				)
				.unique(),
		);
		expect(state?.retailerId).toBe(retailer._id);
		expect(state?.provider).toBe("easyparcel");
		expect(state?.consumedAt).toBeUndefined();
		// EasyParcel's own sign-in state lives 30 minutes; ours matches, or a
		// seller who signs up mid-flow comes back to "expired" (test-code F5).
		expect((state?.expiresAt ?? 0) - (state?.createdAt ?? 0)).toBe(
			30 * 60 * 1000,
		);
	});

	test("refuses an unconfigured deployment, an MY store, and a foreign returnTo", async () => {
		const t = setup();
		await seedRetailer(t, "MY");
		const asUser = t.withIdentity({ subject: USER });
		const my = await asUser.mutation(api.easyparcel.startConnect, {
			returnTo: `${APP}/app/settings`,
		});
		expect(my).toMatchObject({ ok: false });
		if (!my.ok) expect(my.message).toMatch(/Delyva/);

		const t2 = setup();
		await seedRetailer(t2, "SG");
		const asUser2 = t2.withIdentity({ subject: USER });
		const evil = await asUser2.mutation(api.easyparcel.startConnect, {
			returnTo: "https://evil.example/steal",
		});
		expect(evil).toEqual({ ok: false, message: "That return address isn't allowed." });

		vi.stubEnv("EASYPARCEL_CLIENT_SECRET", "");
		const unconfigured = await asUser2.mutation(api.easyparcel.startConnect, {
			returnTo: `${APP}/app/settings`,
		});
		expect(unconfigured).toMatchObject({ ok: false });
	});
});

async function startAndGetState(t: ReturnType<typeof setup>): Promise<string> {
	const result = await t
		.withIdentity({ subject: USER })
		.mutation(api.easyparcel.startConnect, {
			returnTo: `${APP}/app/settings/integrations`,
		});
	if (!result.ok) throw new Error(result.message);
	return new URL(result.url).searchParams.get("state") ?? "";
}

function mockEasyparcel(
	handlers: Partial<Record<string, (init: RequestInit) => Response>>,
) {
	const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input instanceof Request ? input.url : input);
		for (const [suffix, handler] of Object.entries(handlers)) {
			if (url.endsWith(suffix) && handler) return handler(init ?? {});
		}
		throw new Error(`unmocked fetch ${url}`);
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

describe("connect — the callback route", () => {
	test("exchanges the code, imports the account, stores encrypted tokens, redirects back", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const state = await startAndGetState(t);
		const fetchMock = mockEasyparcel({
			"/oauth/token": (init) => {
				const body = new URLSearchParams(String(init.body));
				expect(body.get("grant_type")).toBe("authorization_code");
				expect(body.get("code")).toBe("auth-code-1");
				expect((init.headers as Record<string, string>).Authorization).toBe(
					`Basic ${btoa("client-id-test:client-secret-test")}`,
				);
				return json(TOKEN_RESPONSE);
			},
			"/account/get_account_information": () =>
				json({
					status_code: 200,
					data: {
						account: { name: "Kedai SG Pte Ltd", account_type: "Business" },
						address: {
							pickup_address: {
								address1: "10 Anson Road",
								postcode: "079903",
								city: "Singapore",
								province_code: "SG-01",
								country_code: "SG",
							},
						},
					},
				}),
			"/wallet": () =>
				json({ status_code: 200, data: { wallet: [{ balance: 120.5, currency: "SGD" }] } }),
		});

		const res = await t.fetch(
			`/oauth/easyparcel/callback?code=auth-code-1&state=${state}`,
			{ method: "GET" },
		);
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe(`${APP}/app/settings/integrations`);
		expect(fetchMock).toHaveBeenCalled();

		const conn = await t.run(async (ctx) =>
			ctx.db
				.query("easyparcelConnections")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
				.unique(),
		);
		expect(conn).toMatchObject({
			enabled: true,
			accessToken: "access-new",
			refreshToken: "refresh-new",
			accountName: "Kedai SG Pte Ltd",
			balanceMinor: 12050,
			balanceCurrency: "SGD",
			// Imported as a prefill — SG city/state normalised to our literal.
			pickupAddress: {
				address1: "10 Anson Road",
				city: "Singapore",
				state: "Singapore",
				postcode: "079903",
			},
		});
		const settings = await t
			.withIdentity({ subject: USER })
			.query(api.easyparcel.getSettings, {});
		expect(settings.connected).toBe(true);
		expect(settings.lastAttempt?.outcome).toBe("connected");
	});

	// One EasyParcel login lists BOTH a seller's Malaysian and Singapore
	// accounts at sign-in (28 Oct /test-code). Picking the wrong row must not
	// connect an account that quotes and pays in the wrong currency.
	const otherCountryAccount = (name: string, currency: string) => ({
		"/oauth/token": () => json(TOKEN_RESPONSE),
		"/account/get_account_information": () =>
			json({ status_code: 200, data: { account: { name, account_type: "Business" } } }),
		"/wallet": () =>
			json({ status_code: 200, data: { wallet: [{ balance: 100, currency }] } }),
	});

	test("a LIVE account from the other country is refused, naming the fix", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const state = await startAndGetState(t);
		mockEasyparcel(otherCountryAccount("Zaki Sapuan", "MYR"));
		const res = await t.fetch(
			`/oauth/easyparcel/callback?code=auth-code-1&state=${state}`,
			{ method: "GET" },
		);
		expect(res.status).toBe(302);
		const conn = await t.run(async (ctx) =>
			ctx.db
				.query("easyparcelConnections")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
				.unique(),
		);
		expect(conn).toBeNull();
		const settings = await t
			.withIdentity({ subject: USER })
			.query(api.easyparcel.getSettings, {});
		expect(settings.lastAttempt).toMatchObject({ outcome: "failed" });
		expect(settings.lastAttempt?.message).toMatch(
			/your Malaysia EasyParcel account.*pick your Singapore account/,
		);
	});

	test("…but EasyParcel's one-per-login SANDBOX connects whatever its country", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const state = await startAndGetState(t);
		mockEasyparcel(otherCountryAccount("Zaki Sapuan null Sandbox Account", "MYR"));
		await t.fetch(`/oauth/easyparcel/callback?code=auth-code-1&state=${state}`, {
			method: "GET",
		});
		const conn = await t.run(async (ctx) =>
			ctx.db
				.query("easyparcelConnections")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
				.unique(),
		);
		expect(conn).toMatchObject({ environment: "sandbox", balanceCurrency: "MYR" });
	});

	test("a state redeems ONCE — a replayed callback never reaches the token exchange", async () => {
		const t = setup();
		await seedRetailer(t);
		const state = await startAndGetState(t);
		const fetchMock = mockEasyparcel({
			"/oauth/token": () => json(TOKEN_RESPONSE),
			"/account/get_account_information": () => json({ status_code: 200, data: {} }),
			"/wallet": () => json({ status_code: 200, data: { wallet: [] } }),
		});
		await t.fetch(`/oauth/easyparcel/callback?code=c1&state=${state}`, { method: "GET" });
		const calls = fetchMock.mock.calls.length;
		const replay = await t.fetch(`/oauth/easyparcel/callback?code=c2&state=${state}`, {
			method: "GET",
		});
		expect(replay.status).toBe(302);
		expect(fetchMock.mock.calls.length).toBe(calls);
		// An unknown state bounces to the settings page, untouched.
		const forged = await t.fetch(`/oauth/easyparcel/callback?code=c3&state=forged`, {
			method: "GET",
		});
		expect(forged.headers.get("Location")).toBe(`${APP}/app/settings?tab=integrations`);
	});

	test("declining at EasyParcel records 'denied' and connects nothing", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const state = await startAndGetState(t);
		await t.fetch(`/oauth/easyparcel/callback?error=access_denied&state=${state}`, {
			method: "GET",
		});
		const settings = await t
			.withIdentity({ subject: USER })
			.query(api.easyparcel.getSettings, {});
		expect(settings.connected).toBe(false);
		expect(settings.lastAttempt?.outcome).toBe("denied");
		expect(settings.lastAttempt?.message).toMatch(/Allow/);
		void retailer;
	});

	test("an expired state records 'expired' and never exchanges the code", async () => {
		const t = setup();
		await seedRetailer(t);
		const state = await startAndGetState(t);
		await t.run(async (ctx) => {
			const row = await ctx.db
				.query("courierOAuthStates")
				.withIndex("by_nonce", (q) => q.eq("nonce", state))
				.unique();
			if (row) await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
		});
		const fetchMock = mockEasyparcel({});
		await t.fetch(`/oauth/easyparcel/callback?code=c&state=${state}`, { method: "GET" });
		expect(fetchMock).not.toHaveBeenCalled();
		const settings = await t
			.withIdentity({ subject: USER })
			.query(api.easyparcel.getSettings, {});
		expect(settings.lastAttempt?.outcome).toBe("expired");
	});

	test("a reconnect keeps the seller's own pickup address and switch", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await seedConnection(t, retailer._id, {
			enabled: false,
			revokedAt: Date.now(),
		});
		const state = await startAndGetState(t);
		mockEasyparcel({
			"/oauth/token": () => json(TOKEN_RESPONSE),
			"/account/get_account_information": () =>
				json({
					status_code: 200,
					data: {
						address: {
							pickup_address: {
								address1: "Somewhere Else",
								postcode: "123456",
								city: "Singapore",
								country_code: "SG",
							},
						},
					},
				}),
			"/wallet": () => json({ status_code: 200, data: { wallet: [] } }),
		});
		await t.fetch(`/oauth/easyparcel/callback?code=c&state=${state}`, { method: "GET" });
		const conn = await t.run(async (ctx) =>
			ctx.db
				.query("easyparcelConnections")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
				.unique(),
		);
		expect(conn?.revokedAt).toBeUndefined(); // a fresh grant clears the dead one
		expect(conn?.enabled).toBe(false); // the seller's pause survives
		expect(conn?.pickupAddress?.address1).toBe("10 Anson Road"); // theirs wins
	});
});

describe("tokens — refresh ahead of expiry, and the dead grant", () => {
	test("an expired access token is refreshed before the quote, and the new pair stored", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await seedConnection(t, retailer._id, { accessExpiresAt: Date.now() - 1000 });
		const { shortId } = await seedOrder(t, retailer._id);
		const seen: string[] = [];
		mockEasyparcel({
			"/oauth/token": (init) => {
				const body = new URLSearchParams(String(init.body));
				expect(body.get("grant_type")).toBe("refresh_token");
				expect(body.get("refresh_token")).toBe("refresh-live");
				seen.push("token");
				return json(TOKEN_RESPONSE);
			},
			"/shipment/quotations": (init) => {
				expect((init.headers as Record<string, string>).Authorization).toBe(
					"Bearer access-new",
				);
				seen.push("quote");
				return json({ status_code: 200, data: [{ status: "success", quotations: [] }] });
			},
			"/wallet": () => json({ status_code: 200, data: { wallet: [{ balance: 50, currency: "SGD" }] } }),
		});
		const result = await t
			.withIdentity({ subject: USER })
			.action(api.easyparcel.prepareBooking, {
				shortId,
				box: "small",
				weightKgOverride: 1,
			});
		expect(result.ok).toBe(true);
		expect(seen[0]).toBe("token");
		const conn = await t.run(async (ctx) =>
			ctx.db
				.query("easyparcelConnections")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
				.unique(),
		);
		expect(conn?.accessToken).toBe("access-new");
		expect(conn?.refreshToken).toBe("refresh-new");
	});

	test("a refused refresh marks the grant dead and dispatch asks for a reconnect", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await seedConnection(t, retailer._id, { accessExpiresAt: Date.now() - 1000 });
		const { shortId } = await seedOrder(t, retailer._id);
		mockEasyparcel({
			"/oauth/token": () => json({ error: "invalid_grant" }, 400),
		});
		const asUser = t.withIdentity({ subject: USER });
		const result = await asUser.action(api.easyparcel.prepareBooking, {
			shortId,
			box: "small",
			weightKgOverride: 1,
		});
		expect(result).toMatchObject({ ok: false, reason: "reconnect_needed" });
		const state = await asUser.query(api.easyparcel.getDispatchState, { shortId });
		expect(state?.blockReason).toBe("reconnect_needed");
		const settings = await asUser.query(api.easyparcel.getSettings, {});
		expect(settings.needsReconnect).toBe(true);
	});
});

describe("webhooks — an unsigned nudge, never a source of truth", () => {
	test("a known shipment schedules a re-read; nothing in the body is applied", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { orderId } = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId);
		const res = await t.fetch("/webhook/easyparcel", {
			method: "POST",
			body: JSON.stringify({
				topic: "shipment.status.update",
				shipment_number: "ES-2610-AAAAA",
				// A forged "delivered" — must NOT move anything by itself.
				shipment_status_code: 5,
			}),
		});
		expect(res.status).toBe(200);
		const { job, order, scheduled } = await t.run(async (ctx) => ({
			job: await ctx.db.get(jobId),
			order: await ctx.db.get(orderId),
			scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
		}));
		expect(job?.status).toBe("assigning");
		expect(order?.status).toBe("confirmed");
		expect(scheduled.some((s) => s.name.includes("easyparcel") && s.name.includes("syncJob"))).toBe(true);
	});

	test("unknown shipments and garbage bodies are a quiet 200", async () => {
		const t = setup();
		await seedRetailer(t);
		for (const body of [
			JSON.stringify({ shipment_number: "ES-9999-NOPE0" }),
			"not json",
			JSON.stringify({ topic: "x" }),
		]) {
			const res = await t.fetch("/webhook/easyparcel", { method: "POST", body });
			expect(res.status).toBe(200);
		}
		const scheduled = await t.run(async (ctx) =>
			ctx.db.system.query("_scheduled_functions").collect(),
		);
		expect(scheduled.filter((s) => s.name.includes("syncJob"))).toHaveLength(0);
	});

	test("the hub's save-time probe gets a 200 on GET too", async () => {
		const t = setup();
		const res = await t.fetch("/webhook/easyparcel", { method: "GET" });
		expect(res.status).toBe(200);
	});
});

const T1 = Date.parse("2026-10-27T04:00:00.000Z");
const T2 = Date.parse("2026-10-27T05:00:00.000Z");

describe("applyStatusSync — the re-read moves the job and the order", () => {
	test("Collected (3) ships a confirmed order with the AWB + EasyParcel's tracking link", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { orderId } = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId);
		await t.mutation(internal.easyparcel.applyStatusSync, {
			jobId,
			statusCode: 3,
			statusText: "Collected",
			awb: "SGAWB001",
			labelUrl: "https://app.easyparcel.com/label/X?format=A6",
			trackingUrl: "https://app.easyparcel.com/tools/easytrack/details?awb=SGAWB001",
			syncedAt: T1,
		});
		const { order, job } = await t.run(async (ctx) => ({
			order: await ctx.db.get(orderId),
			job: await ctx.db.get(jobId),
		}));
		expect(job?.status).toBe("picked_up");
		expect(job?.labelUrl).toContain("format=A6");
		expect(order?.status).toBe("shipped");
		expect(order?.trackingNo).toBe("SGAWB001");
		expect(order?.carrierTrackingUrl).toContain("easytrack");
	});

	test("Delivered (5) delivers; a repeated read is a no-op", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { orderId } = await seedOrder(t, retailer._id, { status: "shipped" });
		const jobId = await seedJob(t, retailer._id, orderId, {
			status: "picked_up",
			awb: "SGAWB002",
		});
		const read = { jobId, statusCode: 5, syncedAt: T2 };
		await t.mutation(internal.easyparcel.applyStatusSync, read);
		await t.mutation(internal.easyparcel.applyStatusSync, read);
		const { order, events } = await t.run(async (ctx) => ({
			order: await ctx.db.get(orderId),
			events: await ctx.db
				.query("orderEvents")
				.withIndex("by_order", (q) => q.eq("orderId", orderId))
				.collect(),
		}));
		expect(order?.status).toBe("delivered");
		expect(events.filter((e) => e.status === "delivered")).toHaveLength(1);
	});

	test("On Hold (8) states a reason and moves nothing", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { orderId } = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId, { status: "picked_up" });
		await t.mutation(internal.easyparcel.applyStatusSync, {
			jobId,
			statusCode: 8,
			syncedAt: T1,
		});
		const { order, job } = await t.run(async (ctx) => ({
			order: await ctx.db.get(orderId),
			job: await ctx.db.get(jobId),
		}));
		expect(job?.status).toBe("picked_up");
		expect(job?.failureReason).toMatch(/on hold/);
		expect(order?.status).toBe("confirmed");
	});

	test("a seller-cancelled job keeps its own story when a later read disagrees", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { orderId } = await seedOrder(t, retailer._id);
		const jobId = await seedJob(t, retailer._id, orderId);
		await t.mutation(internal.easyparcel.markJobCancelled, { jobId });
		// A late read reports Returned (6) — a different terminal state, so this
		// reaches the guard rather than the no-change branch.
		await t.mutation(internal.easyparcel.applyStatusSync, {
			jobId,
			statusCode: 6,
			syncedAt: T2,
		});
		const job = await t.run(async (ctx) => ctx.db.get(jobId));
		expect(job?.status).toBe("canceled");
		expect(job?.failureReason).toMatch(/Cancelled by you/);
	});

	test("the AWB mirror never overwrites a seller's own tracking entry", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { orderId } = await seedOrder(t, retailer._id, {
			courierName: "NinjaVan",
			trackingNo: "MANUAL-1",
		});
		const jobId = await seedJob(t, retailer._id, orderId);
		await t.mutation(internal.easyparcel.applyStatusSync, {
			jobId,
			statusCode: 7,
			awb: "SGAWB003",
			syncedAt: T1,
		});
		const { order, job } = await t.run(async (ctx) => ({
			order: await ctx.db.get(orderId),
			job: await ctx.db.get(jobId),
		}));
		expect(job?.awb).toBe("SGAWB003");
		expect(order?.trackingNo).toBe("MANUAL-1");
	});
});

describe("one active job per order — across providers", () => {
	test("an active Delyva job blocks an EasyParcel reservation", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { orderId } = await seedOrder(t, retailer._id);
		await seedJob(t, retailer._id, orderId, {
			provider: "delyva",
			providerOrderId: "DLV-9",
			status: "ongoing",
		});
		await expect(
			t.mutation(internal.easyparcel.reserveBooking, {
				orderId,
				retailerId: retailer._id,
				serviceId: "EP-CS096",
				serviceName: "Ninja Van",
			}),
		).rejects.toThrow(/already in progress/);
	});
});

describe("dispatch state — every block names its cause", () => {
	test("SG + live grant + pickup address: the button is live", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await seedConnection(t, retailer._id);
		const { shortId } = await seedOrder(t, retailer._id);
		const state = await t
			.withIdentity({ subject: USER })
			.query(api.easyparcel.getDispatchState, { shortId });
		expect(state?.blockReason).toBeNull();
		expect(state?.bookingEnabled).toBe(true);
		expect(state?.pickupSummary).toBe("#05-11 10 Anson Road, 079903");
	});

	test("a live account from the other country, connected before the check, can't book", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await seedConnection(t, retailer._id, { balanceCurrency: "MYR" });
		const { shortId } = await seedOrder(t, retailer._id);
		const asUser = t.withIdentity({ subject: USER });
		expect(
			(await asUser.query(api.easyparcel.getDispatchState, { shortId }))?.blockReason,
		).toBe("wrong_country");
		// A sandbox from the other country is the testing exemption.
		await t.run(async (ctx) => {
			const conn = await ctx.db
				.query("easyparcelConnections")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
				.unique();
			if (conn) await ctx.db.patch(conn._id, { environment: "sandbox" });
		});
		expect(
			(await asUser.query(api.easyparcel.getDispatchState, { shortId }))?.blockReason,
		).toBeNull();
	});

	test("MY store: overseas orders only (z8r3fdr5yy); unconfigured deployment → not_configured", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, "MY");
		await seedConnection(t, retailer._id);
		const asUser = t.withIdentity({ subject: USER });
		// A domestic MY order stays with Delyva — EasyParcel doesn't carry it.
		const domestic = await seedOrder(t, retailer._id, {
			currency: "MYR",
			deliveryAddress: {
				line1: "1 Jalan Ampang",
				city: "Kuala Lumpur",
				state: "WP Kuala Lumpur",
				postcode: "50450",
				country: "MY",
			},
		});
		expect(
			(
				await asUser.query(api.easyparcel.getDispatchState, {
					shortId: domestic.shortId,
				})
			)?.blockReason,
		).toBe("destination_unsupported");
		// A parcel going to Singapore gets past the destination rule.
		const { shortId } = await seedOrder(t, retailer._id, {
			currency: "MYR",
			deliveryAddress: {
				line1: "Blk 123 Bedok North Ave 3",
				city: "Singapore",
				state: "Singapore",
				postcode: "460123",
				country: "SG",
			},
		});
		expect(
			(await asUser.query(api.easyparcel.getDispatchState, { shortId }))?.blockReason,
		).not.toBe("destination_unsupported");
		vi.stubEnv("EASYPARCEL_CLIENT_ID", "");
		expect(
			(await asUser.query(api.easyparcel.getDispatchState, { shortId }))?.blockReason,
		).toBe("not_configured");
	});

	test("disconnect deletes the grant outright", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await seedConnection(t, retailer._id);
		await t.withIdentity({ subject: USER }).mutation(api.easyparcel.disconnect, {});
		const conn = await t.run(async (ctx) =>
			ctx.db
				.query("easyparcelConnections")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
				.unique(),
		);
		expect(conn).toBeNull();
	});
});
