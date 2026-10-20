/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
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
			at: 1_000,
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
