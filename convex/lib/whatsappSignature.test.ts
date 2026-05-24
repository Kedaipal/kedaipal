/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import {
	computeMetaSignature,
	verifyMetaSignature,
} from "./whatsappSignature";

const SECRET = "test-app-secret";
const BODY = JSON.stringify({ entry: [{ id: "1", changes: [] }] });

describe("computeMetaSignature", () => {
	test("produces a sha256= prefixed 64-char hex digest", async () => {
		const sig = await computeMetaSignature(SECRET, BODY);
		expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
	});

	test("is deterministic for the same secret + body", async () => {
		const a = await computeMetaSignature(SECRET, BODY);
		const b = await computeMetaSignature(SECRET, BODY);
		expect(a).toBe(b);
	});
});

describe("verifyMetaSignature", () => {
	test("accepts a correctly signed body", async () => {
		const signatureHeader = await computeMetaSignature(SECRET, BODY);
		expect(
			await verifyMetaSignature({
				body: BODY,
				signatureHeader,
				appSecret: SECRET,
			}),
		).toBe(true);
	});

	test("rejects when signed with a different secret", async () => {
		const signatureHeader = await computeMetaSignature("wrong-secret", BODY);
		expect(
			await verifyMetaSignature({
				body: BODY,
				signatureHeader,
				appSecret: SECRET,
			}),
		).toBe(false);
	});

	test("rejects when the body was tampered with", async () => {
		const signatureHeader = await computeMetaSignature(SECRET, BODY);
		expect(
			await verifyMetaSignature({
				body: `${BODY} `,
				signatureHeader,
				appSecret: SECRET,
			}),
		).toBe(false);
	});

	test("rejects a missing signature header", async () => {
		expect(
			await verifyMetaSignature({
				body: BODY,
				signatureHeader: null,
				appSecret: SECRET,
			}),
		).toBe(false);
	});

	test("rejects an empty app secret", async () => {
		const signatureHeader = await computeMetaSignature(SECRET, BODY);
		expect(
			await verifyMetaSignature({
				body: BODY,
				signatureHeader,
				appSecret: "",
			}),
		).toBe(false);
	});

	test("accepts a valid signature regardless of hex case", async () => {
		const signatureHeader = (await computeMetaSignature(SECRET, BODY)).toUpperCase();
		expect(
			await verifyMetaSignature({
				body: BODY,
				signatureHeader,
				appSecret: SECRET,
			}),
		).toBe(true);
	});

	test("rejects a signature of the wrong shape", async () => {
		expect(
			await verifyMetaSignature({
				body: BODY,
				signatureHeader: "sha256=deadbeef",
				appSecret: SECRET,
			}),
		).toBe(false);
	});
});
