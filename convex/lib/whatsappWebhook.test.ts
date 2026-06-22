/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { extractInboundMessages } from "./whatsappWebhook";

function payload(value: unknown): unknown {
	return { entry: [{ changes: [{ value }] }] };
}

describe("extractInboundMessages", () => {
	test("extracts from and text body of text messages", () => {
		const out = extractInboundMessages(
			payload({
				messages: [
					{ from: "60123456789", type: "text", text: { body: "ORD-AB12" } },
				],
			}),
		);
		expect(out).toEqual([
			{ from: "60123456789", text: "ORD-AB12", profileName: undefined },
		]);
	});

	test("attaches the contact pushname matched by wa_id", () => {
		const out = extractInboundMessages(
			payload({
				contacts: [{ wa_id: "60123456789", profile: { name: "Aisha Cakes" } }],
				messages: [
					{ from: "60123456789", type: "text", text: { body: "hi" } },
				],
			}),
		);
		expect(out[0].profileName).toBe("Aisha Cakes");
	});

	test("leaves profileName undefined when no matching contact", () => {
		const out = extractInboundMessages(
			payload({
				contacts: [{ wa_id: "60999999999", profile: { name: "Someone Else" } }],
				messages: [
					{ from: "60123456789", type: "text", text: { body: "hi" } },
				],
			}),
		);
		expect(out[0].profileName).toBeUndefined();
	});

	test("ignores non-text messages", () => {
		const out = extractInboundMessages(
			payload({
				messages: [
					{ from: "60123456789", type: "image", image: { id: "x" } },
				],
			}),
		);
		expect(out).toEqual([]);
	});

	test("returns empty array for malformed payloads", () => {
		expect(extractInboundMessages(null)).toEqual([]);
		expect(extractInboundMessages({})).toEqual([]);
		expect(extractInboundMessages({ entry: "nope" })).toEqual([]);
	});
});
