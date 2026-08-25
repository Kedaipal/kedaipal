import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isEncrypted } from "./credentialCrypto";

// base64 of exactly 32 bytes — computed so the length can't be wrong.
const KEY = btoa("0123456789abcdef0123456789abcdef");
const OTHER_KEY = btoa("fedcba9876543210fedcba9876543210");

beforeEach(() => {
	process.env.CREDENTIALS_ENCRYPTION_KEY = KEY;
});

afterEach(() => {
	delete process.env.CREDENTIALS_ENCRYPTION_KEY;
});

describe("credentialCrypto", () => {
	it("round-trips a secret", async () => {
		const stored = await encryptSecret("test_abc123def456");
		expect(isEncrypted(stored)).toBe(true);
		expect(stored).not.toContain("test_abc123def456");
		expect(await decryptSecret(stored)).toBe("test_abc123def456");
	});

	it("uses a fresh IV per call — same plaintext, different ciphertext", async () => {
		const a = await encryptSecret("sk_byo_secret");
		const b = await encryptSecret("sk_byo_secret");
		expect(a).not.toBe(b);
		expect(await decryptSecret(a)).toBe("sk_byo_secret");
		expect(await decryptSecret(b)).toBe("sk_byo_secret");
	});

	it("encrypt is idempotent on already-encrypted input", async () => {
		const once = await encryptSecret("pk_test_key");
		const twice = await encryptSecret(once);
		expect(twice).toBe(once);
	});

	it("decrypt passes legacy plaintext through untouched", async () => {
		expect(await decryptSecret("pk_test_plainkey")).toBe("pk_test_plainkey");
	});

	it("encrypt with the key unset stores plaintext (today's behaviour)", async () => {
		delete process.env.CREDENTIALS_ENCRYPTION_KEY;
		expect(await encryptSecret("test_key")).toBe("test_key");
	});

	it("decrypt of ciphertext fails closed when the key is unset", async () => {
		const stored = await encryptSecret("secret");
		delete process.env.CREDENTIALS_ENCRYPTION_KEY;
		await expect(decryptSecret(stored)).rejects.toThrow(
			/CREDENTIALS_ENCRYPTION_KEY is not set/,
		);
	});

	it("decrypt of ciphertext fails closed under the wrong key", async () => {
		const stored = await encryptSecret("secret");
		process.env.CREDENTIALS_ENCRYPTION_KEY = OTHER_KEY;
		await expect(decryptSecret(stored)).rejects.toThrow(
			/does not match the key/,
		);
	});

	it("tampered ciphertext fails authentication", async () => {
		const stored = await encryptSecret("secret");
		const flipped = stored.slice(0, -2) + (stored.endsWith("A") ? "B" : "A");
		await expect(decryptSecret(flipped)).rejects.toThrow();
	});

	it("rejects a malformed env key loudly instead of storing plaintext", async () => {
		process.env.CREDENTIALS_ENCRYPTION_KEY = "too-short";
		await expect(encryptSecret("secret")).rejects.toThrow(
			/32 bytes|not valid base64/,
		);
	});
});
