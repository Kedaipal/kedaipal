/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import type { FunctionArgs } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { resetWalletsForCountrySwitch } from "./courierWallets";
import { keyFingerprint, parseWalletBalance } from "./lib/courierWallet";
import { computeLalamoveWebhookSignature } from "./lib/lalamoveSignature";
import schema from "./schema";

/**
 * Courier wallets (86eye9xd4, 6A): the Lalamove balance arrives only on a
 * WALLET_BALANCE_CHANGED webhook that names no order, so the saved key's
 * fingerprint attributes it and the store's own secret verifies it.
 */

const modules = import.meta.glob("./**/*.ts");
const USER = "user_wallet_tests";
const KEY = "pk_test_wallet_a";
const SECRET = "sk_test_wallet_a";

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

async function seedKeyedStore(t: ReturnType<typeof setup>) {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Wallet Store",
		slug: "wallet-store",
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	await asUser.mutation(api.retailers.updateSettings, {
		deliveryBooking: {
			enabled: false,
			vehicleType: "MOTORCYCLE",
			apiKey: KEY,
			apiSecret: SECRET,
		},
	});
	return { asUser, retailerId: retailer._id };
}

async function walletEvent(
	t: ReturnType<typeof setup>,
	opts: { amount: string; timestamp: number; secret?: string; apiKey?: string },
) {
	const data = { balance: { currency: "MYR", amount: opts.amount } };
	const signature = await computeLalamoveWebhookSignature({
		secret: opts.secret ?? SECRET,
		timestamp: opts.timestamp,
		path: "/webhook/lalamove",
		data,
	});
	return t.fetch("/webhook/lalamove", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			apiKey: opts.apiKey ?? KEY,
			timestamp: opts.timestamp,
			signature,
			eventId: "evt-1",
			eventType: "WALLET_BALANCE_CHANGED",
			eventVersion: "v3",
			data,
		}),
	});
}

const wallet = (t: ReturnType<typeof setup>, retailerId: never) =>
	t.withIdentity({ subject: USER }).query(api.courierWallets.lalamoveWallet, {
		retailerId,
	});

describe("parseWalletBalance", () => {
	test("reads Lalamove's decimal string into minor units", () => {
		expect(
			parseWalletBalance({ balance: { currency: "myr", amount: "12.40" } }),
		).toEqual({ balance: 1240, currency: "MYR" });
	});
	test("refuses to guess at anything else", () => {
		expect(parseWalletBalance({ balance: { amount: "1" } })).toBeNull();
		expect(
			parseWalletBalance({ balance: { currency: "MYR", amount: "lots" } }),
		).toBeNull();
		expect(parseWalletBalance(null)).toBeNull();
	});
});

describe("courierWallets — the key's fingerprint follows the key", () => {
	test("saving a key stamps it; a new key starts unknown; clearing removes it", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedKeyedStore(t);
		const rows = () => t.run((ctx) => ctx.db.query("courierWallets").collect());
		expect((await rows())[0]?.keyFingerprint).toBe(await keyFingerprint(KEY));

		await t.run(async (ctx) => {
			const row = (await ctx.db.query("courierWallets").collect())[0];
			if (row) await ctx.db.patch(row._id, { balance: 500, currency: "MYR", balanceAt: 1 });
		});
		await asUser.mutation(api.retailers.updateSettings, {
			deliveryBooking: { vehicleType: "CAR" },
		});
		expect((await rows())[0]?.balance).toBe(500);

		await asUser.mutation(api.retailers.updateSettings, {
			deliveryBooking: {
				vehicleType: "CAR",
				apiKey: "pk_test_other",
				apiSecret: "sk_test_other",
			},
		});
		const replaced = (await rows())[0];
		expect(replaced?.keyFingerprint).toBe(await keyFingerprint("pk_test_other"));
		// A different account: its balance is unknown until it reports one.
		expect(replaced?.balance).toBeUndefined();

		await asUser.mutation(api.retailers.updateSettings, {
			deliveryBooking: null,
		});
		expect(await rows()).toHaveLength(0);
		expect(await wallet(t, retailerId as never)).toBeNull();
	});
});

describe("POST /webhook/lalamove — WALLET_BALANCE_CHANGED", () => {
	test("a signed event from the store's key lands as its balance", async () => {
		const t = setup();
		const { retailerId } = await seedKeyedStore(t);
		const res = await walletEvent(t, { amount: "12.40", timestamp: 1_000 });
		expect(res.status).toBe(200);
		expect(await wallet(t, retailerId as never)).toEqual({
			balance: 1240,
			currency: "MYR",
			// Lalamove's envelope timestamp arrives in SECONDS here; it is
			// stored in ms like every other event (z8r3fdrgxc), or "updated …
			// ago" would read 1970 and lose every newer-wins comparison.
			at: 1_000_000,
			low: true,
		});
	});

	test("an older event never overwrites a newer balance", async () => {
		const t = setup();
		const { retailerId } = await seedKeyedStore(t);
		await walletEvent(t, { amount: "84.50", timestamp: 2_000 });
		await walletEvent(t, { amount: "3.00", timestamp: 1_000 });
		expect((await wallet(t, retailerId as never))?.balance).toBe(8450);
	});

	test("a forged signature is acked and dropped", async () => {
		const t = setup();
		const { retailerId } = await seedKeyedStore(t);
		const res = await walletEvent(t, {
			amount: "999.00",
			timestamp: 1_000,
			secret: "not-the-secret",
		});
		expect(res.status).toBe(200);
		expect(await wallet(t, retailerId as never)).toBeNull();
	});

	test("an unknown key is acked and touches nothing", async () => {
		const t = setup();
		const { retailerId } = await seedKeyedStore(t);
		const res = await walletEvent(t, {
			amount: "50.00",
			timestamp: 1_000,
			apiKey: "pk_test_stranger",
		});
		expect(res.status).toBe(200);
		expect(await wallet(t, retailerId as never)).toBeNull();
	});
});

describe("backfillFingerprints", () => {
	test("stamps a key saved before the table existed, once", async () => {
		const t = setup();
		const { retailerId } = await seedKeyedStore(t);
		await t.run(async (ctx) => {
			for (const row of await ctx.db.query("courierWallets").collect())
				await ctx.db.delete(row._id);
		});
		const first = await t.action(internal.courierWallets.backfillFingerprints, {});
		expect(first.stamped).toBe(1);
		const again = await t.action(internal.courierWallets.backfillFingerprints, {});
		expect(again.stamped).toBe(0);
		const rows = await t.run((ctx) => ctx.db.query("courierWallets").collect());
		expect(rows).toMatchObject([
			{ retailerId, keyFingerprint: await keyFingerprint(KEY) },
		]);
	});
});

// ---------------------------------------------------------------------------
// The seam (z8r3fdrgxc + z8r3fdx34j): one writer, one read model
// ---------------------------------------------------------------------------

const list = (t: ReturnType<typeof setup>, retailerId: Id<"retailers">) =>
	t.withIdentity({ subject: USER }).query(api.courierWallets.list, {
		retailerId,
	});

/** A keyed store whose Lalamove booking is ARMED on a LIVE key — the only
 * kind of wallet that emails. */
async function seedArmedStore(t: ReturnType<typeof setup>) {
	const seeded = await seedKeyedStore(t);
	await t.run(async (ctx) => {
		const retailer = await ctx.db.get(seeded.retailerId);
		if (!retailer?.deliveryBooking) throw new Error("seed");
		await ctx.db.patch(seeded.retailerId, {
			deliveryBooking: {
				...retailer.deliveryBooking,
				enabled: true,
				env: "production",
			},
		});
	});
	return seeded;
}

async function connectDelyva(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	isDemo = false,
) {
	await t.run(async (ctx) => {
		await ctx.db.patch(retailerId, {
			delyva: {
				enabled: true,
				apiKey: "dx-test-key",
				apiSecret: "dx-test-secret",
				apiKeyHint: "-key",
				customerId: 128399,
				isDemo,
			},
		});
	});
}

const record = (
	t: ReturnType<typeof setup>,
	args: FunctionArgs<typeof internal.courierWallets.record>,
) => t.mutation(internal.courierWallets.record, args);

const scheduledLowEmails = (t: ReturnType<typeof setup>) =>
	t.run(async (ctx) =>
		(await ctx.db.system.query("_scheduled_functions").collect()).filter(
			(f) => f.name.includes("notifyLowWallet"),
		),
	);

describe("courierWallets.list — every connected account, never RM 0 for 'unknown'", () => {
	test("a freshly keyed Lalamove account reads 'unreported', with no amount", async () => {
		const t = setup();
		const { retailerId } = await seedKeyedStore(t);
		const [lalamove] = await list(t, retailerId);
		expect(lalamove).toMatchObject({
			provider: "lalamove",
			state: "unreported",
			balanceMinor: null,
			// pk_test key: play money, never a top-up prompt.
			isTest: true,
		});
	});

	test("a connected Delyva account reads 'unshared' until a refusal reveals a number", async () => {
		const t = setup();
		const { retailerId } = await seedKeyedStore(t);
		await connectDelyva(t, retailerId);
		const delyva = (await list(t, retailerId)).find(
			(w) => w.provider === "delyva",
		);
		expect(delyva).toMatchObject({ state: "unshared", balanceMinor: null });
	});

	test("the default low line follows the wallet's currency (RM 30)", async () => {
		const t = setup();
		const { retailerId } = await seedKeyedStore(t);
		const [lalamove] = await list(t, retailerId);
		expect(lalamove?.lowAlertMinor).toBe(3000);
		expect(lalamove?.lowAlertCustom).toBe(false);
	});
});

describe("EasyParcel — a store connected before the wallet table widened", () => {
	afterEach(() => vi.unstubAllEnvs());

	async function seedEasyparcelStore(t: ReturnType<typeof setup>) {
		vi.stubEnv("EASYPARCEL_CLIENT_ID", "client-id-test");
		vi.stubEnv("EASYPARCEL_CLIENT_SECRET", "client-secret-test");
		vi.stubEnv("CONVEX_SITE_URL", "https://site.test");
		const { retailerId } = await seedKeyedStore(t);
		await t.run(async (ctx) => {
			await ctx.db.patch(retailerId, { country: "SG", currency: "SGD" });
			// The connection's own snapshot, as every pull has written it since
			// before `courierWallets` knew about EasyParcel — and no wallet row.
			await ctx.db.insert("easyparcelConnections", {
				retailerId,
				enabled: true,
				environment: "sandbox",
				accessToken: "access",
				refreshToken: "refresh",
				accessExpiresAt: Date.now() + 3_600_000,
				balanceMinor: 1980,
				balanceCurrency: "SGD",
				balanceCheckedAt: 5_000,
				connectedAt: 1,
				updatedAt: 1,
			});
		});
		return retailerId;
	}

	test("reads the balance its connection already holds, as a pull — never '—'", async () => {
		const t = setup();
		const retailerId = await seedEasyparcelStore(t);
		const easyparcel = (await list(t, retailerId)).find(
			(w) => w.provider === "easyparcel",
		);
		expect(easyparcel).toMatchObject({
			state: "ok",
			balanceMinor: 1980,
			currency: "SGD",
			at: 5_000,
			source: "pull",
			isTest: true,
		});
	});

	test("a newer wallet observation outranks the snapshot", async () => {
		const t = setup();
		const retailerId = await seedEasyparcelStore(t);
		await record(t, {
			retailerId,
			provider: "easyparcel",
			at: 9_000,
			observation: {
				kind: "balance",
				balanceMinor: 900,
				currency: "SGD",
				source: "pull",
			},
		});
		const easyparcel = (await list(t, retailerId)).find(
			(w) => w.provider === "easyparcel",
		);
		expect(easyparcel).toMatchObject({ balanceMinor: 900, at: 9_000 });
	});
});

describe("recordObservation — the one writer, monotonic on observation time", () => {
	test("a late refusal never hides a newer balance; a newer one marks the wallet short", async () => {
		const t = setup();
		const { retailerId } = await seedKeyedStore(t);
		await record(t, {
			retailerId,
			provider: "lalamove",
			at: 2_000,
			observation: {
				kind: "balance",
				balanceMinor: 8450,
				currency: "MYR",
				source: "webhook",
			},
		});
		await record(t, {
			retailerId,
			provider: "lalamove",
			at: 1_000,
			observation: { kind: "refused" },
		});
		expect((await list(t, retailerId))[0]?.state).toBe("ok");

		await record(t, {
			retailerId,
			provider: "lalamove",
			at: 3_000,
			observation: { kind: "refused" },
		});
		const [after] = await list(t, retailerId);
		expect(after?.state).toBe("short");
		// Short is not RM 0: the last number stays, the refusal is newer.
		expect(after?.balanceMinor).toBe(8450);
		expect(after?.refusedAt).toBe(3_000);
	});

	test("a Lalamove observation without a keyed row is dropped (no key, no wallet)", async () => {
		const t = setup();
		const { retailerId } = await seedKeyedStore(t);
		await t.run(async (ctx) => {
			for (const row of await ctx.db.query("courierWallets").collect())
				await ctx.db.delete(row._id);
		});
		await record(t, {
			retailerId,
			provider: "lalamove",
			at: 1,
			observation: {
				kind: "balance",
				balanceMinor: 1,
				currency: "MYR",
				source: "webhook",
			},
		});
		expect(
			await t.run((ctx) => ctx.db.query("courierWallets").collect()),
		).toHaveLength(0);
	});
});

describe("Delyva — the refusal is the only place its balance appears", () => {
	test("'Bal: 0, Price: 5.00' records an EMPTY wallet, last seen at the refusal", async () => {
		const t = setup();
		const { retailerId } = await seedKeyedStore(t);
		await connectDelyva(t, retailerId);
		await t.mutation(internal.courierWallets.recordDelyvaRefusal, {
			retailerId,
			message:
				"Payment failed, You don't have enough credit balance. Bal: 0, Price: 5.00",
		});
		const delyva = (await list(t, retailerId)).find(
			(w) => w.provider === "delyva",
		);
		expect(delyva).toMatchObject({
			state: "empty",
			balanceMinor: 0,
			currency: "MYR",
			source: "refusal",
		});
	});

	test("a refusal with no number still says the wallet came up short", async () => {
		const t = setup();
		const { retailerId } = await seedKeyedStore(t);
		await connectDelyva(t, retailerId);
		await t.mutation(internal.courierWallets.recordDelyvaRefusal, {
			retailerId,
			message: "Insufficient credit",
		});
		const delyva = (await list(t, retailerId)).find(
			(w) => w.provider === "delyva",
		);
		expect(delyva?.state).toBe("short");
	});

	test("disconnecting forgets the wallet — no stale balance outlives its account", async () => {
		const t = setup();
		const { retailerId } = await seedKeyedStore(t);
		await connectDelyva(t, retailerId);
		await t.mutation(internal.courierWallets.recordDelyvaRefusal, {
			retailerId,
			message: "Bal: 3.10, Price: 5.00",
		});
		await t.mutation(internal.delyva.clearConnection, { retailerId });
		const rows = await t.run((ctx) =>
			ctx.db
				.query("courierWallets")
				.filter((q) => q.eq(q.field("provider"), "delyva"))
				.collect(),
		);
		expect(rows).toHaveLength(0);
	});
});

describe("the low-balance email — once per crossing, never per webhook", () => {
	const low = (at: number, balanceMinor = 1240) => ({
		at,
		observation: {
			kind: "balance" as const,
			balanceMinor,
			currency: "MYR",
			source: "webhook" as const,
		},
	});

	test("crossing into low schedules ONE email; staying low adds none; a top-up re-arms it", async () => {
		const t = setup();
		const { retailerId } = await seedArmedStore(t);
		const r = { retailerId, provider: "lalamove" as const };
		await record(t, { ...r, ...low(1) });
		await record(t, { ...r, ...low(2, 900) });
		expect(await scheduledLowEmails(t)).toHaveLength(1);

		// Topped up: healthy again, and the next crossing is news again.
		await record(t, { ...r, ...low(3, 10_000) });
		const [row] = await t.run((ctx) => ctx.db.query("courierWallets").collect());
		expect(row?.lowNotifiedAt).toBeUndefined();
		await record(t, { ...r, ...low(4) });
		expect(await scheduledLowEmails(t)).toHaveLength(2);
	});

	test("a live wallet whose booking is switched OFF stays quiet — nothing is being booked from it", async () => {
		const t = setup();
		const { retailerId } = await seedArmedStore(t);
		await t.run(async (ctx) => {
			const r = await ctx.db.get(retailerId);
			if (!r?.deliveryBooking) throw new Error("seed");
			await ctx.db.patch(retailerId, {
				deliveryBooking: { ...r.deliveryBooking, enabled: false },
			});
		});
		await record(t, { retailerId, provider: "lalamove", ...low(1) });
		expect(await scheduledLowEmails(t)).toHaveLength(0);
	});

	test("a test (sandbox) wallet never emails — it's play money", async () => {
		const t = setup();
		const { retailerId } = await seedKeyedStore(t); // pk_test, not armed
		await record(t, { retailerId, provider: "lalamove", ...low(1) });
		expect(await scheduledLowEmails(t)).toHaveLength(0);
	});
});

describe("setLowAlert — the seller's own line, per wallet", () => {
	test("raising the line over today's balance is a crossing: the wallet reads low and the owner hears once", async () => {
		const t = setup();
		const { retailerId, asUser } = await seedArmedStore(t);
		await record(t, {
			retailerId,
			provider: "lalamove",
			at: 1,
			observation: {
				kind: "balance",
				balanceMinor: 4000,
				currency: "MYR",
				source: "webhook",
			},
		});
		expect((await list(t, retailerId))[0]?.state).toBe("ok");
		await asUser.mutation(api.courierWallets.setLowAlert, {
			retailerId,
			provider: "lalamove",
			lowAlertMinor: 5000,
		});
		const [after] = await list(t, retailerId);
		expect(after).toMatchObject({
			state: "low",
			lowAlertMinor: 5000,
			lowAlertCustom: true,
		});
		expect(await scheduledLowEmails(t)).toHaveLength(1);

		// null = back to the currency default.
		await asUser.mutation(api.courierWallets.setLowAlert, {
			retailerId,
			provider: "lalamove",
			lowAlertMinor: null,
		});
		expect((await list(t, retailerId))[0]?.lowAlertCustom).toBe(false);
	});

	test("refuses a line outside the bounds, and a courier that isn't connected", async () => {
		const t = setup();
		const { retailerId, asUser } = await seedKeyedStore(t);
		await expect(
			asUser.mutation(api.courierWallets.setLowAlert, {
				retailerId,
				provider: "lalamove",
				lowAlertMinor: 0,
			}),
		).rejects.toThrow(/between/);
		await expect(
			asUser.mutation(api.courierWallets.setLowAlert, {
				retailerId,
				provider: "delyva",
				lowAlertMinor: 2000,
			}),
		).rejects.toThrow(/Connect this courier/);
	});
});

describe("a country switch resets every wallet", () => {
	test("Lalamove keeps its key's fingerprint but loses the old balance; others go", async () => {
		const t = setup();
		const { retailerId } = await seedKeyedStore(t);
		await connectDelyva(t, retailerId);
		await record(t, {
			retailerId,
			provider: "lalamove",
			at: 1,
			observation: {
				kind: "balance",
				balanceMinor: 8450,
				currency: "MYR",
				source: "webhook",
			},
		});
		await t.mutation(internal.courierWallets.recordDelyvaRefusal, {
			retailerId,
			message: "Bal: 1.00, Price: 5.00",
		});
		await t.run((ctx) => resetWalletsForCountrySwitch(ctx, retailerId));
		const rows = await t.run((ctx) => ctx.db.query("courierWallets").collect());
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			provider: "lalamove",
			keyFingerprint: await keyFingerprint(KEY),
		});
		expect(rows[0]?.balance).toBeUndefined();
	});
});
