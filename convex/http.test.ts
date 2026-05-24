/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import schema from "./schema";
import { computeMetaSignature } from "./lib/whatsappSignature";

const modules = import.meta.glob("./**/*.ts");

const SECRET = "test-app-secret";
// A webhook payload with no text messages → no inbound action is dispatched,
// so the route's response reflects only signature handling.
const PAYLOAD = JSON.stringify({
	object: "whatsapp_business_account",
	entry: [{ id: "1", changes: [{ value: { statuses: [] } }] }],
});

function setup() {
	return convexTest(schema, modules);
}

beforeEach(() => {
	process.env.WHATSAPP_APP_SECRET = SECRET;
});

afterEach(() => {
	delete process.env.WHATSAPP_APP_SECRET;
});

describe("POST /webhook/whatsapp signature verification", () => {
	test("rejects a request with no signature header", async () => {
		const t = setup();
		const res = await t.fetch("/webhook/whatsapp", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: PAYLOAD,
		});
		expect(res.status).toBe(401);
	});

	test("rejects a request with an invalid signature", async () => {
		const t = setup();
		const res = await t.fetch("/webhook/whatsapp", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Hub-Signature-256": "sha256=0000",
			},
			body: PAYLOAD,
		});
		expect(res.status).toBe(401);
	});

	test("rejects a request signed with the wrong secret", async () => {
		const t = setup();
		const signature = await computeMetaSignature("attacker-secret", PAYLOAD);
		const res = await t.fetch("/webhook/whatsapp", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Hub-Signature-256": signature,
			},
			body: PAYLOAD,
		});
		expect(res.status).toBe(401);
	});

	test("accepts a correctly signed request", async () => {
		const t = setup();
		const signature = await computeMetaSignature(SECRET, PAYLOAD);
		const res = await t.fetch("/webhook/whatsapp", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Hub-Signature-256": signature,
			},
			body: PAYLOAD,
		});
		expect(res.status).toBe(200);
	});

	test("fails closed (500) when the app secret is not configured", async () => {
		delete process.env.WHATSAPP_APP_SECRET;
		const t = setup();
		const signature = await computeMetaSignature(SECRET, PAYLOAD);
		const res = await t.fetch("/webhook/whatsapp", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Hub-Signature-256": signature,
			},
			body: PAYLOAD,
		});
		expect(res.status).toBe(500);
	});
});
