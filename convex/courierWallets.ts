/**
 * Courier wallets (86eye9xd4, 6A) — the Lalamove balance a seller's own
 * account reports, so the dashboard can warn before a booking fails on an
 * empty wallet instead of after. See `courierWallets` in schema.ts for why the
 * key FINGERPRINT is the join and why this is its own table.
 *
 * Writes: `syncLalamoveWallet` (called by `retailers.updateSettings` whenever
 * a key is typed or cleared), `recordBalance` (the verified webhook) and the
 * one-off `backfillFingerprints` for keys saved before this table existed.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	internalAction,
	internalMutation,
	internalQuery,
	type MutationCtx,
	type QueryCtx,
	query,
} from "./_generated/server";
import { requireRetailerAccess } from "./lib/auth";
import { decryptSecret } from "./lib/credentialCrypto";
import { keyFingerprint, walletIsLow } from "./lib/courierWallet";

/**
 * Keep the store's Lalamove wallet row in step with its key: a typed key
 * (re)stamps the fingerprint — a DIFFERENT key is a different account, so its
 * balance starts unknown — and a cleared key removes the row.
 */
export async function syncLalamoveWallet(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
	plaintextKey: string | null,
): Promise<void> {
	const existing = await ctx.db
		.query("courierWallets")
		.withIndex("by_retailer_provider", (q) =>
			q.eq("retailerId", retailerId).eq("provider", "lalamove"),
		)
		.unique();
	if (!plaintextKey?.trim()) {
		if (existing) await ctx.db.delete(existing._id);
		return;
	}
	const fingerprint = await keyFingerprint(plaintextKey);
	if (existing?.keyFingerprint === fingerprint) return;
	const row = {
		retailerId,
		provider: "lalamove" as const,
		keyFingerprint: fingerprint,
		balance: undefined,
		currency: undefined,
		balanceAt: undefined,
		updatedAt: Date.now(),
	};
	if (existing) await ctx.db.replace(existing._id, row);
	else await ctx.db.insert("courierWallets", row);
}

/** Every wallet a webhook's sender key could belong to, with the secret that
 * verifies it. Usually one; two stores sharing an account is legal. */
export const getWalletContext = internalQuery({
	args: { fingerprint: v.string() },
	handler: async (
		ctx,
		{ fingerprint },
	): Promise<Array<{ walletId: Id<"courierWallets">; apiSecret: string }>> => {
		const wallets = await ctx.db
			.query("courierWallets")
			.withIndex("by_fingerprint", (q) => q.eq("keyFingerprint", fingerprint))
			.take(10);
		const out: Array<{ walletId: Id<"courierWallets">; apiSecret: string }> =
			[];
		for (const wallet of wallets) {
			const retailer = await ctx.db.get(wallet.retailerId);
			const secret = retailer?.deliveryBooking?.apiSecret?.trim();
			if (secret) out.push({ walletId: wallet._id, apiSecret: secret });
		}
		return out;
	},
});

/** Store a verified balance — never older than the one already held. */
export const recordBalance = internalMutation({
	args: {
		walletId: v.id("courierWallets"),
		balance: v.number(),
		currency: v.string(),
		at: v.number(),
	},
	handler: async (ctx, { walletId, balance, currency, at }) => {
		const wallet = await ctx.db.get(walletId);
		if (!wallet) return;
		if (wallet.balanceAt !== undefined && at < wallet.balanceAt) return;
		await ctx.db.patch(walletId, {
			balance,
			currency,
			balanceAt: at,
			updatedAt: Date.now(),
		});
	},
});

export type WalletView = {
	balance: number;
	currency: string;
	at: number;
	low: boolean;
} | null;

/** The store's Lalamove balance, once one has been reported. */
export async function readLalamoveWallet(
	ctx: { db: QueryCtx["db"] },
	retailerId: Id<"retailers">,
): Promise<WalletView> {
	const wallet = await ctx.db
		.query("courierWallets")
		.withIndex("by_retailer_provider", (q) =>
			q.eq("retailerId", retailerId).eq("provider", "lalamove"),
		)
		.unique();
	if (
		!wallet ||
		wallet.balance === undefined ||
		!wallet.currency ||
		wallet.balanceAt === undefined
	)
		return null;
	return {
		balance: wallet.balance,
		currency: wallet.currency,
		at: wallet.balanceAt,
		low: walletIsLow(wallet.balance),
	};
}

/** The balance beside the API key in Settings → Integrations — proof the key
 * works, shown once. */
export const lalamoveWallet = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<WalletView> => {
		await requireRetailerAccess(ctx, retailerId, {
			area: "integrations",
			level: "read",
		});
		return readLalamoveWallet(ctx, retailerId);
	},
});

// ---------------------------------------------------------------------------
// Backfill — keys saved before this table existed (operator step, once)
// ---------------------------------------------------------------------------

const BACKFILL_PAGE = 100;

export const keysNeedingFingerprint = internalQuery({
	args: { cursor: v.union(v.string(), v.null()) },
	handler: async (ctx, { cursor }) => {
		const page = await ctx.db
			.query("retailers")
			.paginate({ numItems: BACKFILL_PAGE, cursor });
		const rows: Array<{ retailerId: Id<"retailers">; apiKey: string }> = [];
		for (const retailer of page.page) {
			const apiKey = retailer.deliveryBooking?.apiKey?.trim();
			if (!apiKey) continue;
			const wallet = await ctx.db
				.query("courierWallets")
				.withIndex("by_retailer_provider", (q) =>
					q.eq("retailerId", retailer._id).eq("provider", "lalamove"),
				)
				.unique();
			if (!wallet) rows.push({ retailerId: retailer._id, apiKey });
		}
		return { rows, isDone: page.isDone, continueCursor: page.continueCursor };
	},
});

export const setWalletFingerprint = internalMutation({
	args: { retailerId: v.id("retailers"), plaintextKey: v.string() },
	handler: async (ctx, { retailerId, plaintextKey }) => {
		await syncLalamoveWallet(ctx, retailerId, plaintextKey);
	},
});

/**
 * Stamp a fingerprint for every store whose Lalamove key predates this table,
 * so its wallet events attribute. Idempotent (stores that already have a row
 * are skipped) and self-continuing. Keys are decrypted here, in an action —
 * the only place the plaintext exists.
 *
 * Run: `npx convex run courierWallets:backfillFingerprints`
 */
export const backfillFingerprints = internalAction({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, { cursor }): Promise<{ stamped: number }> => {
		const page = await ctx.runQuery(
			internal.courierWallets.keysNeedingFingerprint,
			{ cursor: cursor ?? null },
		);
		let stamped = 0;
		for (const row of page.rows) {
			await ctx.runMutation(internal.courierWallets.setWalletFingerprint, {
				retailerId: row.retailerId,
				plaintextKey: await decryptSecret(row.apiKey),
			});
			stamped++;
		}
		if (!page.isDone) {
			await ctx.scheduler.runAfter(
				0,
				internal.courierWallets.backfillFingerprints,
				{ cursor: page.continueCursor },
			);
		}
		return { stamped };
	},
});
