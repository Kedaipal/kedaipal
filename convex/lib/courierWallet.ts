/**
 * Courier wallets — the pure half (86eye9xd4 6A, then z8r3fdrgxc +
 * z8r3fdx34j). Every courier Kedaipal books through is BYO and PREPAID: the
 * seller's own wallet at the provider pays each booking, and Kedaipal never
 * holds or tops up that money. This module owns what a wallet balance MEANS —
 * its state, whether it can cover a booking, where the seller tops it up —
 * so every surface (dispatch cards, Settings → Integrations, Home, the
 * Deliveries page, the low-balance email) reads one answer.
 *
 * The seam: each provider reports its balance a different way, and the
 * `model` in WALLET_PROVIDERS names which —
 *  - `push`    Lalamove: a WALLET_BALANCE_CHANGED webhook on every top-up and
 *              deduction; there is no endpoint to ask.
 *  - `pull`    EasyParcel: GET /wallet, any time.
 *  - `refusal` Delyva: no balance endpoint; the one place the number appears
 *              is an insufficient-credit refusal ("Bal: 0, Price: 5.00").
 * All three land in `courierWallets` through one writer
 * (`courierWallets.recordObservation`), so a new provider plugs in by adding
 * a row here and calling that writer — no surface changes.
 *
 * Naming rule: always "<Provider> wallet" / "Courier wallets". Never
 * "credits" — Kedaipal Credits own that word.
 */

import type { Country } from "./country";
import type { CourierProviderId } from "./courierProviders";

/** SHA-256 hex of a PLAINTEXT API key. Lalamove sends its key in the clear in
 * every webhook body, so this is an index, not a secret — the store's own API
 * secret still has to verify the event. */
export async function keyFingerprint(apiKey: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(apiKey.trim()),
	);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Read a WALLET_BALANCE_CHANGED event's balance into minor units. Lalamove
 * sends `{ balance: { currency, amount } }` with the amount as a decimal
 * string; anything else reads as null (the event is acked and dropped rather
 * than storing a number we had to guess at).
 */
export function parseWalletBalance(
	data: unknown,
): { balance: number; currency: string } | null {
	const balance = (data as { balance?: unknown } | null)?.balance as
		| { amount?: unknown; currency?: unknown }
		| undefined;
	if (!balance || typeof balance.currency !== "string") return null;
	const amount =
		typeof balance.amount === "number"
			? balance.amount
			: typeof balance.amount === "string"
				? Number(balance.amount)
				: Number.NaN;
	if (!Number.isFinite(amount)) return null;
	return {
		balance: Math.round(amount * 100),
		currency: balance.currency.toUpperCase(),
	};
}

/**
 * Delyva's insufficient-credit refusal is the only place its balance appears:
 * `"Payment failed, You don't have enough credit balance. Bal: 0, Price: 5.00"`.
 * Both numbers are major units; anything that doesn't carry BOTH reads as null
 * (a refusal with no number still records that the wallet came up short).
 */
export function parseDelyvaRefusal(
	message: string | undefined,
): { balanceMinor: number; priceMinor: number } | null {
	if (!message) return null;
	const match = /Bal:\s*(-?[\d,]+(?:\.\d+)?)\s*,\s*Price:\s*([\d,]+(?:\.\d+)?)/i.exec(
		message,
	);
	if (!match) return null;
	const balance = Number(match[1].replaceAll(",", ""));
	const price = Number(match[2].replaceAll(",", ""));
	if (!Number.isFinite(balance) || !Number.isFinite(price)) return null;
	return {
		balanceMinor: Math.round(balance * 100),
		priceMinor: Math.round(price * 100),
	};
}

/**
 * The default "low alert" line per wallet currency (z8r3fdrgxc decision 1):
 * RM 30 / S$ 15 — about three rider trips. The seller changes it per provider
 * on the Courier wallets section ("Low alert at RM 30"); `lowAlertMinor` on
 * the row overrides this.
 */
export const DEFAULT_LOW_ALERT_MINOR: Record<string, number> = {
	MYR: 3000,
	SGD: 1500,
};

export function defaultLowAlertMinor(currency: string): number {
	return DEFAULT_LOW_ALERT_MINOR[currency.toUpperCase()] ?? 3000;
}

/** Bounds on a seller-set low alert: zero switches the alert off in all but
 * name, so the floor is one unit; the ceiling keeps a typo from turning every
 * healthy wallet amber. */
export const LOW_ALERT_MIN_MINOR = 100;
export const LOW_ALERT_MAX_MINOR = 100_000;

/** A balance older than this reads as STALE (greyed, "updated 2 days ago"):
 * bookings made outside Kedaipal spend the same wallet. */
export const STALE_WALLET_MS = 24 * 60 * 60 * 1000;

/** "RM 12.40" / "S$ 12.40" — server-side copy (emails); the dashboard uses
 * `formatPrice`, which renders the same symbols. */
export function walletMoney(minor: number, currency: string): string {
	const symbol =
		currency === "MYR" ? "RM" : currency === "SGD" ? "S$" : currency;
	return `${symbol} ${(minor / 100).toFixed(2)}`;
}

/** A pulled balance this recent is trusted enough to REFUSE a booking on;
 * anything older (or pushed, or seen in a refusal) only warns — the provider
 * is the final judge of what its wallet can pay. */
export const FRESH_WALLET_MS = 5 * 60 * 1000;

export type WalletModel = "push" | "pull" | "refusal";
export type WalletSource = "webhook" | "pull" | "refusal";

type CountryUrls = Record<Country, string | null>;

export type WalletProvider = {
	name: string;
	model: WalletModel;
	/** Where the seller tops up: the provider's own web app. */
	appUrl: CountryUrls;
	/** The provider's own top-up guide, when it publishes one. */
	guideUrl: CountryUrls;
};

/**
 * One row per provider. None of the three publishes a top-up API or a deep
 * top-up URL (checked 29 Oct 2026), so the hand-off is the provider's web app
 * plus its own help article — never a page Kedaipal pretends to own. A
 * `Record` so a new provider id can't compile without its row.
 */
export const WALLET_PROVIDERS: Record<CourierProviderId, WalletProvider> = {
	lalamove: {
		name: "Lalamove",
		model: "push",
		appUrl: { MY: "https://web.lalamove.com", SG: "https://web.lalamove.com" },
		guideUrl: {
			MY: "https://www.lalamove.com/en-my/blog/how-to-top-up-lalamove-wallet",
			SG: "https://www.lalamove.com/en-sg/blog/how-to-use-the-lalamove-wallet",
		},
	},
	delyva: {
		name: "Delyva",
		model: "refusal",
		appUrl: { MY: "https://my.delyva.app", SG: null },
		guideUrl: { MY: null, SG: null },
	},
	easyparcel: {
		name: "EasyParcel",
		model: "pull",
		// The bare app root redirects to the MALAYSIAN site whatever the
		// account (test-code, 30 Oct 2026) — each country names its own.
		appUrl: {
			MY: "https://app.easyparcel.com/my/en/",
			SG: "https://app.easyparcel.com/sg/en/",
		},
		guideUrl: {
			MY: null,
			SG: "https://helpcentre-sg.easyparcel.com/support/solutions/articles/9000224683-how-to-add-or-top-up-credit-to-my-account-on-easyparcel-",
		},
	},
};

/**
 * What a wallet's latest observation says, before test-ness is applied:
 *  - `ok` / `low` / `empty` — a balance is known (≤ 0 is empty).
 *  - `short`      — the provider refused a booking for lack of funds AFTER the
 *                   last balance it reported, and the refusal named no amount
 *                   (Lalamove). Never rendered as RM 0: we know it's short, not
 *                   by how much.
 *  - `unreported` — nothing seen yet (Lalamove sends nothing until money
 *                   moves; EasyParcel before its first read).
 *  - `unshared`   — a refusal-model provider with nothing seen yet: Delyva
 *                   doesn't share the balance, which is a different sentence
 *                   from "not yet".
 */
export type WalletState =
	| "ok"
	| "low"
	| "empty"
	| "short"
	| "unreported"
	| "unshared";

/** The stored observation, as `courierWallets` holds it. */
export type WalletObservation = {
	balance?: number;
	currency?: string;
	balanceAt?: number;
	refusedAt?: number;
	lowAlertMinor?: number;
};

export function walletState(
	provider: CourierProviderId,
	obs: WalletObservation | null,
): WalletState {
	const refusedLater =
		obs?.refusedAt !== undefined &&
		(obs.balanceAt === undefined || obs.refusedAt > obs.balanceAt);
	if (refusedLater) return "short";
	if (obs?.balance === undefined)
		return WALLET_PROVIDERS[provider].model === "refusal"
			? "unshared"
			: "unreported";
	if (obs.balance <= 0) return "empty";
	const line =
		obs.lowAlertMinor ?? defaultLowAlertMinor(obs.currency ?? "MYR");
	if (obs.balance < line) return "low";
	return "ok";
}

/** States that need the seller to top up — what Home, the Deliveries banner
 * and the email react to. */
export function walletNeedsTopUp(state: WalletState): boolean {
	return state === "low" || state === "empty" || state === "short";
}

/**
 * The read model every surface renders. `isTest` = the connected key belongs
 * to the provider's sandbox/demo (play money: never a top-up prompt);
 * `null` = not known yet, rendered as unknown — never as live.
 */
export type CourierWalletView = {
	provider: CourierProviderId;
	/** Booking is switched on and allowed in the store's country. */
	armed: boolean;
	isTest: boolean | null;
	state: WalletState;
	/** Minor units in `currency`, or null when no amount is known. */
	balanceMinor: number | null;
	/** The PROVIDER's currency (an SG account answers in SGD). */
	currency: string;
	/** When the provider reported `balanceMinor`. */
	at: number | null;
	/** Below this the wallet reads `low` — the seller's own line, or the
	 * currency default. */
	lowAlertMinor: number;
	/** The seller set `lowAlertMinor` (vs the default). */
	lowAlertCustom: boolean;
	source: WalletSource | null;
	/** The latest insufficient-funds refusal, if it is newer than the balance. */
	refusedAt: number | null;
	refusedPriceMinor: number | null;
};

/**
 * Can this wallet pay for a booking of `priceMinor`? The ticket's rule:
 * BLOCK only on a fresh PULLED balance that can't cover it (EasyParcel read
 * moments ago); everything else that looks short only WARNS, because a push or
 * refusal number may be stale and the provider is the final judge.
 *  - `covers`  — the known balance pays for it.
 *  - `warn`    — probably can't; book stays enabled, with the reason beside it.
 *  - `block`   — can't, on a balance we just read; Book disables with the reason.
 *  - `unknown` — nothing to judge on, or a balance in another currency
 *                than the price (the Delyva demo quotes in HKD): comparing
 *                RM against HK$ would invent a shortfall, so it says nothing
 *                (test-code, 31 Oct 2026).
 *
 * A TEST wallet is judged the same way: a sandbox refuses a booking its play
 * money can't pay just as a live account does, so a fresh short read must
 * still disable Book (test-code, 30 Oct 2026 — waving it through put the
 * seller one tap from a refusal). Test-ness changes the words, never the
 * verdict (`dispatchWalletLine`).
 */
export type WalletVerdict = "covers" | "warn" | "block" | "unknown";

export function walletVerdict(
	view: Pick<
		CourierWalletView,
		"state" | "balanceMinor" | "at" | "source" | "currency"
	>,
	priceMinor: number,
	now: number,
	priceCurrency: string,
): WalletVerdict {
	// A refusal is the provider's own verdict — no number, no currency to mix.
	if (view.state === "short") return "warn";
	if (view.balanceMinor === null) return "unknown";
	if (priceCurrency !== view.currency) return "unknown";
	if (view.balanceMinor >= priceMinor) return "covers";
	const fresh =
		view.source === "pull" &&
		view.at !== null &&
		now - view.at <= FRESH_WALLET_MS;
	return fresh ? "block" : "warn";
}

/** A balance a provider's own CONNECTION row holds (EasyParcel keeps one on
 * `easyparcelConnections`, written by every pull since before this table). */
export type WalletSnapshot = { balance: number; currency: string; at: number };

/**
 * The observation a view is built from: the wallet row, unless the
 * connection's snapshot is NEWER (or the row has no balance at all). A store
 * connected before `courierWallets` widened has a balance on its connection
 * and none on the row — read alone, the row said "—" for a number we already
 * held (test-code, 30 Oct 2026). Newest-wins, like `recordObservation`, so
 * the two copies can never disagree about which is current; a refusal on the
 * row still outranks an OLDER snapshot through `walletState`.
 */
export function withConnectionSnapshot<
	T extends WalletObservation & { source?: WalletSource },
>(
	row: T | null,
	snapshot: WalletSnapshot | null,
): (WalletObservation & { source?: WalletSource }) | null {
	if (!snapshot) return row;
	if (
		row?.balance !== undefined &&
		row.balanceAt !== undefined &&
		row.balanceAt >= snapshot.at
	)
		return row;
	return {
		...(row ?? {}),
		balance: snapshot.balance,
		currency: snapshot.currency,
		balanceAt: snapshot.at,
		source: "pull",
	};
}

/**
 * The low-balance email fires once per CROSSING into a needs-top-up state,
 * and re-arms once the wallet is healthy again — never once per webhook.
 * Test wallets never email (play money).
 */
export function lowWalletNotice(args: {
	state: WalletState;
	notifiedAt: number | undefined;
	isTest: boolean | null;
}): "notify" | "rearm" | null {
	if (args.state === "ok") return args.notifiedAt !== undefined ? "rearm" : null;
	if (args.isTest === true) return null;
	if (walletNeedsTopUp(args.state) && args.notifiedAt === undefined)
		return "notify";
	return null;
}
