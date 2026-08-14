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

describe("POST /webhook/whatsapp — outbound statuses (86eyf1rck)", () => {
	test("a signed failed-status event stamps the matching confirmation push", async () => {
		const t = setup();
		// Seed an order whose confirmation push is believed sent.
		const orderId = await t.run(async (ctx) => {
			const retailerId = await ctx.db.insert("retailers", {
				userId: "u1",
				storeName: "S",
				slug: "s",
				currency: "MYR",
				channel: "whatsapp",
				createdAt: 1,
				updatedAt: 1,
			});
			return await ctx.db.insert("orders", {
				retailerId,
				shortId: "ORD-TEST",
				items: [],
				subtotal: 0,
				total: 0,
				currency: "MYR",
				status: "confirmed",
				channel: "whatsapp",
				customer: { name: "Ali", waPhone: "60123456789" },
				confirmationPushStatus: "sent",
				confirmationPushAt: 1,
				confirmationPushWamid: "wamid.HTTP1",
				createdAt: 1,
				updatedAt: 1,
			});
		});

		const body = JSON.stringify({
			object: "whatsapp_business_account",
			entry: [
				{
					id: "1",
					changes: [
						{
							value: {
								statuses: [
									{
										id: "wamid.HTTP1",
										status: "failed",
										recipient_id: "60123456789",
										errors: [{ code: 131026, title: "Undeliverable" }],
									},
								],
							},
						},
					],
				},
			],
		});
		const signature = await computeMetaSignature(SECRET, body);
		const res = await t.fetch("/webhook/whatsapp", {
			method: "POST",
			headers: { "x-hub-signature-256": signature },
			body,
		});
		expect(res.status).toBe(200);
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.confirmationPushStatus).toBe("failed");
	});
});
