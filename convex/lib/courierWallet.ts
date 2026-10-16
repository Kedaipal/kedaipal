/**
 * Courier wallet helpers (86eye9xd4, 6A) — pure, shared by the settings save,
 * the webhook route and the backfill. See `courierWallets` in schema.ts.
 */

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
 * Below this, the dashboard warns BEFORE a booking fails on an empty wallet:
 * 20.00 in the wallet's currency — about two rider trips in Klang Valley or
 * Singapore.
 */
export const LOW_WALLET_MINOR = 2000;

export function walletIsLow(balance: number | undefined): boolean {
	return balance !== undefined && balance < LOW_WALLET_MINOR;
}
