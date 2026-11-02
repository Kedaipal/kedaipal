import { describe, expect, test } from "vitest";
import { sha256Hex } from "./sha256";

// FIPS 180-4 test vectors — this implementation exists because invite-token
// hashing must run inside MUTATIONS (crypto.subtle is actions-only here), so
// its correctness is pinned to the standard, not to itself.
describe("sha256Hex", () => {
	test("empty string", () => {
		expect(sha256Hex("")).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
	});

	test("abc", () => {
		expect(sha256Hex("abc")).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});

	test("448-bit two-block message", () => {
		expect(
			sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
		).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
	});

	test("64-byte input (exactly one block before padding)", () => {
		expect(sha256Hex("a".repeat(64))).toBe(
			"ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb",
		);
	});

	test("token-shaped input is stable + 64 hex chars", () => {
		const digest = sha256Hex("f".repeat(64));
		expect(digest).toMatch(/^[0-9a-f]{64}$/);
		expect(sha256Hex("f".repeat(64))).toBe(digest);
	});
});
