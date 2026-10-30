/**
 * Courier wallets (86eye9xd4 6A; every provider since z8r3fdrgxc +
 * z8r3fdx34j) — the balance each connected courier's own account reports, so
 * the dashboard warns BEFORE a booking fails on an empty wallet instead of
 * after. What a balance means lives in convex/lib/courierWallet.ts; this
 * module stores it and serves it. See `courierWallets` in schema.ts for why
 * this is its own table and why Lalamove needs the key fingerprint.
 *
 * Writes, all through `recordObservation` (the one writer):
 *  - Lalamove: the verified WALLET_BALANCE_CHANGED webhook (http.ts) and an
 *    insufficient-balance booking refusal (no amount: the wallet goes `short`).
 *  - EasyParcel: every GET /wallet — connect, the settings refresh, each
 *    dispatch quote.
 *  - Delyva: an insufficient-credit refusal, whose message carries the balance.
 * Row lifecycle: `syncLalamoveWallet` follows the Lalamove key;
 * `clearCourierWallet` runs on a Delyva/EasyParcel (re)connect to a different
 * account and on every disconnect; a country switch clears them all.
 */
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalAction,
	internalMutation,
	internalQuery,
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server";
import { requireRetailerAccess } from "./lib/auth";
import { COUNTRY_CURRENCY, type Country, DEFAULT_COUNTRY } from "./lib/country";
import {
	delyvaBookingArmed,
	easyparcelBookingArmed,
	lalamoveBookingArmed,
} from "./lib/courierBooking";
import {
	COURIER_PROVIDER_IDS,
	type CourierProviderId,
	courierBookingAllowed,
	courierProviderValidator,
} from "./lib/courierProviders";
import {
	type CourierWalletView,
	defaultLowAlertMinor,
	keyFingerprint,
	LOW_ALERT_MAX_MINOR,
	LOW_ALERT_MIN_MINOR,
	lowWalletNotice,
	parseDelyvaRefusal,
	WALLET_PROVIDERS,
	type WalletSnapshot,
	walletMoney,
	walletState,
	withConnectionSnapshot,
} from "./lib/courierWallet";
import { renderLowWalletEmail } from "./lib/courierWalletEmailCopy";
import { decryptSecret } from "./lib/credentialCrypto";
import { resolveDelyvaCredentials } from "./lib/delyva";
import { sendEmail } from "./lib/email";
import { loadEasyparcelArming } from "./lib/easyparcelArming";
import { pickLocale } from "./lib/locale";
import { assertSubscriptionActive } from "./subscriptions";

type Db = QueryCtx["db"];

async function walletRow(
	db: Db,
	retailerId: Id<"retailers">,
	provider: CourierProviderId,
): Promise<Doc<"courierWallets"> | null> {
	return db
		.query("courierWallets")
		.withIndex("by_retailer_provider", (q) =>
			q.eq("retailerId", retailerId).eq("provider", provider),
		)
		.unique();
}

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
	const existing = await walletRow(ctx.db, retailerId, "lalamove");
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
		// The seller's alert line is a store preference, not the account's —
		// it survives a key rotation.
		lowAlertMinor: existing?.lowAlertMinor,
		updatedAt: Date.now(),
	};
	if (existing) await ctx.db.replace(existing._id, row);
	else await ctx.db.insert("courierWallets", row);
}

/** Forget a provider's wallet: a disconnect, or a connect to a different
 * account — no stale balance may outlive the account it described. */
export async function clearCourierWallet(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
	provider: Exclude<CourierProviderId, "lalamove">,
): Promise<void> {
	const existing = await walletRow(ctx.db, retailerId, provider);
	if (existing) await ctx.db.delete(existing._id);
}

/**
 * A country switch (countrySetup checklist): every wallet belonged to the old
 * country's accounts. Lalamove keeps its row but loses the balance — the key
 * (and so the fingerprint) is still saved, and its next event repopulates it.
 */
export async function resetWalletsForCountrySwitch(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
): Promise<void> {
	for (const provider of COURIER_PROVIDER_IDS) {
		const existing = await walletRow(ctx.db, retailerId, provider);
		if (!existing) continue;
		// A custom alert line was in the old currency, so it goes too.
		if (provider === "lalamove" && existing.keyFingerprint) {
			await ctx.db.replace(existing._id, {
				retailerId,
				provider,
				keyFingerprint: existing.keyFingerprint,
				updatedAt: Date.now(),
			});
		} else {
			await ctx.db.delete(existing._id);
		}
	}
}

// ---------------------------------------------------------------------------
// The one writer
// ---------------------------------------------------------------------------

/** A balance the provider stated, or a refusal that named no balance. */
export type WalletObservationInput = {
	retailerId: Id<"retailers">;
	provider: CourierProviderId;
	/** When the provider made the observation (ms). */
	at: number;
} & (
	| {
			kind: "balance";
			balanceMinor: number;
			currency: string;
			source: "webhook" | "pull" | "refusal";
	  }
	| { kind: "refused"; priceMinor?: number }
);

const observationArgs = {
	retailerId: v.id("retailers"),
	provider: courierProviderValidator,
	at: v.number(),
	observation: v.union(
		v.object({
			kind: v.literal("balance"),
			balanceMinor: v.number(),
			currency: v.string(),
			source: v.union(
				v.literal("webhook"),
				v.literal("pull"),
				v.literal("refusal"),
			),
		}),
		v.object({
			kind: v.literal("refused"),
			priceMinor: v.optional(v.number()),
		}),
	),
};

/**
 * Record what a provider said about a wallet. MONOTONIC: an observation older
 * than the one it would replace is dropped, so a late webhook never
 * overwrites a newer pull. A Lalamove observation needs the row its key
 * stamped (no key, no wallet to describe); the others create theirs.
 * Afterwards, decides the once-per-crossing low-balance email.
 */
export async function recordObservation(
	ctx: MutationCtx,
	input: WalletObservationInput,
): Promise<void> {
	const { retailerId, provider, at } = input;
	const existing = await walletRow(ctx.db, retailerId, provider);
	if (!existing && provider === "lalamove") return;

	let patch: Partial<Doc<"courierWallets">>;
	if (input.kind === "balance") {
		if (existing?.balanceAt !== undefined && at < existing.balanceAt) return;
		patch = {
			balance: input.balanceMinor,
			currency: input.currency.toUpperCase(),
			balanceAt: at,
			source: input.source,
		};
	} else {
		if (existing?.refusedAt !== undefined && at < existing.refusedAt) return;
		if (existing?.balanceAt !== undefined && at < existing.balanceAt) return;
		patch = { refusedAt: at, refusedPriceMinor: input.priceMinor };
	}

	const now = Date.now();
	let rowId: Id<"courierWallets">;
	if (existing) {
		rowId = existing._id;
		await ctx.db.patch(rowId, { ...patch, updatedAt: now });
	} else {
		rowId = await ctx.db.insert("courierWallets", {
			retailerId,
			provider,
			...patch,
			updatedAt: now,
		});
	}

	await evaluateLowNotice(ctx, rowId);
}

/**
 * Decide the once-per-crossing low-balance email for one wallet row, after
 * anything that can move it across its line: a new observation, or the seller
 * changing the line itself. Only an ARMED, non-test wallet emails.
 */
async function evaluateLowNotice(
	ctx: MutationCtx,
	rowId: Id<"courierWallets">,
): Promise<void> {
	const row = await ctx.db.get(rowId);
	if (!row) return;
	const retailer = await ctx.db.get(row.retailerId);
	if (!retailer) return;
	const facts = await providerFacts(ctx, retailer);
	const decision = lowWalletNotice({
		state: walletState(row.provider, row),
		notifiedAt: row.lowNotifiedAt,
		isTest: facts[row.provider].isTest,
	});
	if (decision === "rearm") {
		await ctx.db.patch(rowId, { lowNotifiedAt: undefined });
	} else if (decision === "notify" && facts[row.provider].armed) {
		await ctx.db.patch(rowId, { lowNotifiedAt: Date.now() });
		await ctx.scheduler.runAfter(0, internal.courierWallets.notifyLowWallet, {
			retailerId: row.retailerId,
			provider: row.provider,
		});
	}
}

/** `recordObservation` for actions (webhook route, provider calls). */
export const record = internalMutation({
	args: observationArgs,
	handler: async (ctx, { retailerId, provider, at, observation }) => {
		await recordObservation(ctx, {
			retailerId,
			provider,
			at,
			...observation,
		});
	},
});

/**
 * Delyva's insufficient-credit refusal, the one place its balance appears
 * ("Bal: 0, Price: 5.00" — major units, in the account's currency, which is
 * the store's: Delyva serves one country per account). A refusal that names
 * no number still records that the wallet came up short.
 */
export const recordDelyvaRefusal = internalMutation({
	args: { retailerId: v.id("retailers"), message: v.optional(v.string()) },
	handler: async (ctx, { retailerId, message }) => {
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) return;
		const parsed = parseDelyvaRefusal(message);
		const at = Date.now();
		await recordObservation(
			ctx,
			parsed
				? {
						retailerId,
						provider: "delyva",
						at,
						kind: "balance",
						balanceMinor: parsed.balanceMinor,
						currency: COUNTRY_CURRENCY[retailer.country ?? DEFAULT_COUNTRY],
						source: "refusal",
					}
				: {
						retailerId,
						provider: "delyva",
						at,
						kind: "refused",
					},
		);
	},
});

/** Every Lalamove wallet a webhook's sender key could belong to, with the
 * secret that verifies it. Usually one; two stores sharing an account is
 * legal (and so is one wallet behind both). */
export const getWalletContext = internalQuery({
	args: { fingerprint: v.string() },
	handler: async (
		ctx,
		{ fingerprint },
	): Promise<Array<{ retailerId: Id<"retailers">; apiSecret: string }>> => {
		const wallets = await ctx.db
			.query("courierWallets")
			.withIndex("by_fingerprint", (q) => q.eq("keyFingerprint", fingerprint))
			.take(10);
		const out: Array<{ retailerId: Id<"retailers">; apiSecret: string }> = [];
		for (const wallet of wallets) {
			const retailer = await ctx.db.get(wallet.retailerId);
			const secret = retailer?.deliveryBooking?.apiSecret?.trim();
			if (secret) out.push({ retailerId: wallet.retailerId, apiSecret: secret });
		}
		return out;
	},
});

/**
 * The seller's "low alert" line for one courier wallet (null = back to the
 * currency default). A store preference about money held at the courier, so
 * it sits with the courier accounts: `integrations` write. Re-evaluates the
 * low email at once — raising the line over today's balance is a crossing.
 */
export const setLowAlert = mutation({
	args: {
		retailerId: v.id("retailers"),
		provider: courierProviderValidator,
		lowAlertMinor: v.union(v.number(), v.null()),
	},
	handler: async (ctx, { retailerId, provider, lowAlertMinor }) => {
		const access = await requireRetailerAccess(ctx, retailerId, {
			area: "integrations",
			level: "write",
		});
		const { retailer } = access;
		// A lapsed store is view-only, settings included (sellerLockCoverage).
		if (!access.actingAsAdmin) await assertSubscriptionActive(ctx, retailerId);
		if (
			lowAlertMinor !== null &&
			(!Number.isInteger(lowAlertMinor) ||
				lowAlertMinor < LOW_ALERT_MIN_MINOR ||
				lowAlertMinor > LOW_ALERT_MAX_MINOR)
		) {
			throw new ConvexError(
				`Pick a low alert between ${LOW_ALERT_MIN_MINOR / 100} and ${LOW_ALERT_MAX_MINOR / 100}.`,
			);
		}
		const view = (await readCourierWallets(ctx, retailer)).find(
			(w) => w.provider === provider,
		);
		if (!view) throw new ConvexError("Connect this courier account first.");
		const existing = await walletRow(ctx.db, retailerId, provider);
		const value = lowAlertMinor ?? undefined;
		let rowId: Id<"courierWallets">;
		if (existing) {
			rowId = existing._id;
			await ctx.db.patch(rowId, { lowAlertMinor: value, updatedAt: Date.now() });
		} else if (provider === "lalamove") {
			// A Lalamove row exists from the moment its key is saved; without
			// one, its events can't attribute either — nothing to set yet.
			throw new ConvexError("Lalamove hasn't reported this wallet yet.");
		} else {
			rowId = await ctx.db.insert("courierWallets", {
				retailerId,
				provider,
				lowAlertMinor: value,
				updatedAt: Date.now(),
			});
		}
		await evaluateLowNotice(ctx, rowId);
	},
});

// ---------------------------------------------------------------------------
// The read model
// ---------------------------------------------------------------------------

type ProviderFacts = Record<
	CourierProviderId,
	{
		connected: boolean;
		armed: boolean;
		isTest: boolean | null;
		/** A balance the provider's connection row already holds. */
		snapshot: WalletSnapshot | null;
	}
>;

/** Which providers this store has an account with, which are booking, and
 * which are test accounts — read from each provider's own connection. */
async function providerFacts(
	ctx: { db: Db },
	retailer: Doc<"retailers">,
): Promise<ProviderFacts> {
	const country: Country = retailer.country ?? DEFAULT_COUNTRY;
	const easyparcel = await loadEasyparcelArming(
		ctx as QueryCtx,
		retailer._id,
	);
	const epConn = easyparcel.connected
		? await ctx.db
				.query("easyparcelConnections")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
				.unique()
		: null;
	const booking = retailer.deliveryBooking;
	const delyva = retailer.delyva;
	const courierRetailer = { ...retailer, easyparcel };
	return {
		lalamove: {
			connected:
				Boolean(booking?.apiKey?.trim()) &&
				courierBookingAllowed("lalamove", country),
			armed: lalamoveBookingArmed(courierRetailer),
			isTest:
				booking?.env === "sandbox"
					? true
					: booking?.env === "production"
						? false
						: null,
			snapshot: null,
		},
		delyva: {
			connected:
				resolveDelyvaCredentials(delyva) !== null &&
				courierBookingAllowed("delyva", country),
			armed: delyvaBookingArmed(courierRetailer),
			isTest: delyva?.isDemo ?? null,
			snapshot: null,
		},
		easyparcel: {
			connected:
				easyparcel.connected && courierBookingAllowed("easyparcel", country),
			armed: easyparcelBookingArmed(courierRetailer),
			isTest:
				epConn?.environment === "sandbox"
					? true
					: epConn?.environment === "live"
						? false
						: null,
			snapshot:
				epConn?.balanceMinor !== undefined &&
				epConn.balanceCheckedAt !== undefined
					? {
							balance: epConn.balanceMinor,
							currency: epConn.balanceCurrency ?? COUNTRY_CURRENCY[country],
							at: epConn.balanceCheckedAt,
						}
					: null,
		},
	};
}

/**
 * One view per CONNECTED courier account, in registry order. A connected
 * account with nothing reported yet is still listed (`unreported` /
 * `unshared`) — that state has its own sentence and never renders as RM 0.
 */
export async function readCourierWallets(
	ctx: { db: Db },
	retailer: Doc<"retailers">,
): Promise<CourierWalletView[]> {
	const facts = await providerFacts(ctx, retailer);
	const storeCurrency = COUNTRY_CURRENCY[retailer.country ?? DEFAULT_COUNTRY];
	const out: CourierWalletView[] = [];
	for (const provider of COURIER_PROVIDER_IDS) {
		const fact = facts[provider];
		if (!fact.connected) continue;
		const row = await walletRow(ctx.db, retailer._id, provider);
		const obs = withConnectionSnapshot(row, fact.snapshot);
		const state = walletState(provider, obs);
		out.push({
			provider,
			armed: fact.armed,
			isTest: fact.isTest,
			state,
			balanceMinor: obs?.balance ?? null,
			currency: obs?.currency ?? storeCurrency,
			at: obs?.balanceAt ?? null,
			lowAlertMinor:
				row?.lowAlertMinor ??
				defaultLowAlertMinor(obs?.currency ?? storeCurrency),
			lowAlertCustom: row?.lowAlertMinor !== undefined,
			source: obs?.balance !== undefined ? (obs.source ?? "webhook") : null,
			refusedAt: state === "short" ? (row?.refusedAt ?? null) : null,
			refusedPriceMinor:
				state === "short" ? (row?.refusedPriceMinor ?? null) : null,
		});
	}
	return out;
}

/**
 * Every connected courier wallet, for the dispatch cards, Home, the
 * Deliveries page and Settings → Integrations. Gated on reading ORDERS (the
 * ticket's decision): whoever books a courier must see whether the wallet can
 * pay for it — the balance is the courier's money, not Kedaipal billing.
 */
export const list = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<CourierWalletView[]> => {
		const { retailer } = await requireRetailerAccess(ctx, retailerId, {
			area: "orders",
			level: "read",
		});
		return readCourierWallets(ctx, retailer);
	},
});

/** The Lalamove balance in the pre-z8r3fdx34j shape. */
export type WalletView = {
	balance: number;
	currency: string;
	at: number;
	low: boolean;
} | null;

/**
 * Kept ONLY for dashboards deployed before z8r3fdx34j, which still call it by
 * this path (Convex function paths must not move under a live client). Every
 * current surface reads `list`. Remove with the next narrow.
 */
export const lalamoveWallet = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<WalletView> => {
		const { retailer } = await requireRetailerAccess(ctx, retailerId, {
			area: "integrations",
			level: "read",
		});
		const view = (await readCourierWallets(ctx, retailer)).find(
			(w) => w.provider === "lalamove",
		);
		if (!view || view.balanceMinor === null || view.at === null) return null;
		return {
			balance: view.balanceMinor,
			currency: view.currency,
			at: view.at,
			low: view.state !== "ok",
		};
	},
});

// ---------------------------------------------------------------------------
// Low-balance email (owner, once per crossing)
// ---------------------------------------------------------------------------

export const getLowWalletEmailContext = internalQuery({
	args: { retailerId: v.id("retailers"), provider: courierProviderValidator },
	handler: async (ctx, { retailerId, provider }) => {
		const retailer = await ctx.db.get(retailerId);
		if (!retailer?.notifyEmail) return null;
		const view = (await readCourierWallets(ctx, retailer)).find(
			(w) => w.provider === provider,
		);
		// Re-read at send time: a top-up that landed in between cancels it.
		if (!view || view.state === "ok" || view.isTest === true) return null;
		return {
			notifyEmail: retailer.notifyEmail,
			locale: pickLocale(retailer.locale),
			storeName: retailer.storeName,
			country: (retailer.country ?? DEFAULT_COUNTRY) as Country,
			view,
		};
	},
});

export const notifyLowWallet = internalAction({
	args: { retailerId: v.id("retailers"), provider: courierProviderValidator },
	handler: async (ctx, { retailerId, provider }): Promise<void> => {
		const meta = await ctx.runQuery(
			internal.courierWallets.getLowWalletEmailContext,
			{ retailerId, provider },
		);
		if (!meta) return;
		const { view } = meta;
		const rendered = renderLowWalletEmail(meta.locale, {
			storeName: meta.storeName,
			providerName: WALLET_PROVIDERS[provider].name,
			state: view.state,
			balanceFormatted:
				view.balanceMinor !== null
					? walletMoney(view.balanceMinor, view.currency)
					: null,
			lowLineFormatted: walletMoney(view.lowAlertMinor, view.currency),
			topUpUrl: WALLET_PROVIDERS[provider].appUrl[meta.country],
			integrationsUrl: `${process.env.SITE_URL ?? "https://kedaipal.com"}/app/settings?tab=integrations`,
		});
		try {
			await sendEmail(
				meta.notifyEmail,
				rendered.subject,
				rendered.html,
				rendered.text,
			);
		} catch (err) {
			console.error(
				`Email lowWallet failed (${provider}): ${err instanceof Error ? err.message : String(err)}`,
			);
		}
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
			const wallet = await walletRow(ctx.db, retailer._id, "lalamove");
			if (!wallet?.keyFingerprint)
				rows.push({ retailerId: retailer._id, apiKey });
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
