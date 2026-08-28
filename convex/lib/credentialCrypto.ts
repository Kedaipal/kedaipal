/**
 * Envelope encryption for BYO third-party credentials at rest (86eyn25gk).
 *
 * The HitPay key/salt and Lalamove key/secret move sellers' MONEY — the
 * HitPay key mints payment requests, the salt signs webhooks, the Lalamove
 * pair books paid trips from the seller's wallet. They were stored plaintext
 * on the retailer row ("plain fields per current convention, accepted for
 * v1"), which put every connected seller's payment rails inside the blast
 * radius of any data incident — now a notifiable breach under the PDPA 2024
 * amendments.
 *
 * Format: `enc.v1.<iv-base64>.<ciphertext-base64>` — AES-256-GCM, 12-byte
 * random IV, authenticated (tampering fails decryption loudly).
 *
 * Key: env `CREDENTIALS_ENCRYPTION_KEY` = base64 of 32 random bytes
 * (`openssl rand -base64 32`), set per deployment:
 * `npx convex env set CREDENTIALS_ENCRYPTION_KEY <value>` (+ `--prod`).
 *
 * Deploy-order safety (widen→migrate posture):
 * - `encryptSecret` with the key UNSET returns the plaintext unchanged — a
 *   deployment without the env var behaves exactly like today.
 * - `decryptSecret` passes through values without the `enc.v1.` prefix, so
 *   legacy plaintext rows keep working until the one-shot backfill runs
 *   (`npx convex run credentials:encryptExistingCredentials`).
 * - `decryptSecret` on ciphertext with the key unset or wrong FAILS CLOSED
 *   with an error naming the env var — never silent garbage to a provider.
 *
 * Runtime placement: encrypt/decrypt run in ACTIONS and HTTP ACTIONS only —
 * the runtimes where `crypto.subtle` is proven in this repo (every webhook
 * HMAC). Mutations never touch subtle: `updateSettings` stores what it was
 * given and schedules `internal.credentials.encryptRetailerCredentials`;
 * queries hand ciphertext to actions, which decrypt at the point of use.
 * The sync `isEncrypted` predicate is the only piece queries/mutations need.
 */

const PREFIX = "enc.v1.";

export function isEncrypted(value: string): boolean {
	return value.startsWith(PREFIX);
}

function bytesToB64(bytes: Uint8Array): string {
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/** Null when the env var is unset (encryption off — plaintext era). Throws on
 * a malformed key: a typo'd key must never silently store plaintext. */
function readKeyBytes(): Uint8Array | null {
	const raw = process.env.CREDENTIALS_ENCRYPTION_KEY?.trim();
	if (!raw) return null;
	let bytes: Uint8Array;
	try {
		bytes = b64ToBytes(raw);
	} catch {
		throw new Error(
			"CREDENTIALS_ENCRYPTION_KEY is not valid base64 — generate one with `openssl rand -base64 32`",
		);
	}
	if (bytes.length !== 32) {
		throw new Error(
			"CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes — generate one with `openssl rand -base64 32`",
		);
	}
	return bytes;
}

async function importAesKey(
	rawKey: Uint8Array,
	usage: "encrypt" | "decrypt",
): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		rawKey as unknown as BufferSource,
		{ name: "AES-GCM" },
		false,
		[usage],
	);
}

/** Encrypt a credential for storage. Passthrough when the env key is unset
 * (today's behaviour) or the value is already ciphertext (idempotent). */
export async function encryptSecret(plain: string): Promise<string> {
	if (isEncrypted(plain)) return plain;
	const rawKey = readKeyBytes();
	if (!rawKey) return plain;
	const key = await importAesKey(rawKey, "encrypt");
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv: iv as unknown as BufferSource },
			key,
			new TextEncoder().encode(plain),
		),
	);
	return `${PREFIX}${bytesToB64(iv)}.${bytesToB64(ciphertext)}`;
}

/** Decrypt a stored credential at the point of use. Plaintext (legacy rows,
 * or an encryption-off deployment) passes through untouched. */
export async function decryptSecret(stored: string): Promise<string> {
	if (!isEncrypted(stored)) return stored;
	const rawKey = readKeyBytes();
	if (!rawKey) {
		throw new Error(
			"An encrypted credential exists but CREDENTIALS_ENCRYPTION_KEY is not set on this deployment — set it with `npx convex env set CREDENTIALS_ENCRYPTION_KEY <value>`",
		);
	}
	const [ivPart, ctPart, ...rest] = stored.slice(PREFIX.length).split(".");
	if (!ivPart || !ctPart || rest.length > 0) {
		throw new Error("Malformed encrypted credential");
	}
	const key = await importAesKey(rawKey, "decrypt");
	try {
		const plain = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: b64ToBytes(ivPart) as unknown as BufferSource },
			key,
			b64ToBytes(ctPart) as unknown as BufferSource,
		);
		return new TextDecoder().decode(plain);
	} catch {
		throw new Error(
			"Credential decryption failed — CREDENTIALS_ENCRYPTION_KEY does not match the key these credentials were encrypted with",
		);
	}
}
