// Lalamove webhook signature verification — envelope parsing + the two
// signing-body candidates. See lalamoveSignature.ts header for why two.
import { describe, expect, test } from "vitest";
import {
	computeLalamoveWebhookSignature,
	parseLalamoveWebhookEnvelope,
	verifyLalamoveWebhook,
} from "./lalamoveSignature";

const PATH = "/webhook/lalamove";
const SECRET = "sk_test_webhook_secret";

function makePayload(data: unknown, signature: string, timestamp = 1784384000000) {
	return {
		apiKey: "pk_test_key",
		timestamp,
		signature,
		eventId: "ev-1",
		eventType: "ORDER_STATUS_CHANGED",
		eventVersion: "v3",
		data,
	};
}

describe("parseLalamoveWebhookEnvelope", () => {
	test("parses a well-formed envelope", () => {
		const raw = JSON.stringify(makePayload({ order: { orderId: "1" } }, "sig"));
		const envelope = parseLalamoveWebhookEnvelope(raw);
		expect(envelope?.apiKey).toBe("pk_test_key");
		expect(envelope?.eventType).toBe("ORDER_STATUS_CHANGED");
		expect(envelope?.signature).toBe("sig");
	});

	test("returns null (never throws) on junk", () => {
		expect(parseLalamoveWebhookEnvelope("")).toBeNull();
		expect(parseLalamoveWebhookEnvelope("not json")).toBeNull();
		expect(parseLalamoveWebhookEnvelope("{}")).toBeNull();
		expect(
			parseLalamoveWebhookEnvelope(
				JSON.stringify({ apiKey: "k", signature: "s" }), // missing fields
			),
		).toBeNull();
	});
});

describe("verifyLalamoveWebhook", () => {
	test("accepts the data-variant signature", async () => {
		const data = { order: { orderId: "3243", status: "PICKED_UP" } };
		const timestamp = 1784384000000;
		const signature = await computeLalamoveWebhookSignature({
			secret: SECRET,
			timestamp,
			path: PATH,
			data,
		});
		const rawBody = JSON.stringify(makePayload(data, signature, timestamp));
		const envelope = parseLalamoveWebhookEnvelope(rawBody);
		if (!envelope) throw new Error("envelope parse failed");
		const result = await verifyLalamoveWebhook({
			rawBody,
			envelope,
			path: PATH,
			apiSecret: SECRET,
		});
		expect(result).toEqual({ valid: true, variant: "data" });
	});

	test("accepts the envelope-variant signature (raw body, signature blanked)", async () => {
		const data = { order: { orderId: "9" } };
		const timestamp = 1784384000000;
		// Build the raw body with an EMPTY signature value, sign that exact
		// string, then splice the signature in — mirroring a sender that signs
		// everything except the signature itself.
		const blanked = JSON.stringify(makePayload(data, "", timestamp));
		const { createHmac } = await import("node:crypto");
		const signature = createHmac("sha256", SECRET)
			.update(`${timestamp}\r\nPOST\r\n${PATH}\r\n\r\n${blanked}`)
			.digest("hex");
		const rawBody = blanked.replace('"signature":""', `"signature":"${signature}"`);
		const envelope = parseLalamoveWebhookEnvelope(rawBody);
		if (!envelope) throw new Error("envelope parse failed");
		const result = await verifyLalamoveWebhook({
			rawBody,
			envelope,
			path: PATH,
			apiSecret: SECRET,
		});
		expect(result).toEqual({ valid: true, variant: "envelope" });
	});

	test("rejects a wrong secret, tampered data, and missing secret", async () => {
		const data = { order: { orderId: "3243", status: "PICKED_UP" } };
		const timestamp = 1784384000000;
		const signature = await computeLalamoveWebhookSignature({
			secret: SECRET,
			timestamp,
			path: PATH,
			data,
		});
		const rawBody = JSON.stringify(makePayload(data, signature, timestamp));
		const envelope = parseLalamoveWebhookEnvelope(rawBody);
		if (!envelope) throw new Error("envelope parse failed");

		expect(
			(
				await verifyLalamoveWebhook({
					rawBody,
					envelope,
					path: PATH,
					apiSecret: "sk_wrong",
				})
			).valid,
		).toBe(false);
		expect(
			(
				await verifyLalamoveWebhook({
					rawBody,
					envelope: {
						...envelope,
						data: { order: { orderId: "3243", status: "COMPLETED" } },
					},
					path: PATH,
					apiSecret: SECRET,
				})
			).valid,
		).toBe(false);
		expect(
			(
				await verifyLalamoveWebhook({
					rawBody,
					envelope,
					path: PATH,
					apiSecret: "",
				})
			).valid,
		).toBe(false);
	});

	test("path is part of the signature (cross-endpoint replay fails)", async () => {
		const data = { order: { orderId: "1" } };
		const timestamp = 1784384000000;
		const signature = await computeLalamoveWebhookSignature({
			secret: SECRET,
			timestamp,
			path: "/some/other/path",
			data,
		});
		const rawBody = JSON.stringify(makePayload(data, signature, timestamp));
		const envelope = parseLalamoveWebhookEnvelope(rawBody);
		if (!envelope) throw new Error("envelope parse failed");
		expect(
			(
				await verifyLalamoveWebhook({
					rawBody,
					envelope,
					path: PATH,
					apiSecret: SECRET,
				})
			).valid,
		).toBe(false);
	});
});
