import { describe, expect, test } from "vitest";
import { classifyInbound } from "./inboundIntent";

describe("classifyInbound", () => {
	const token = "Ab12Cd34Ef56Gh78Ij90Kl12"; // 24 url-safe chars

	test("classifies a store-QR poster scan (KPS-<token>), incl. the humanized prefill", () => {
		expect(classifyInbound(`KPS-${token}`)).toEqual({
			kind: "store_checkout_start",
			token,
		});
		expect(
			classifyInbound(
				`Hi! 👋 I'd like to order at the counter.\n\nStore ref: KPS-${token}`,
			),
		).toEqual({ kind: "store_checkout_start", token });
	});

	test("classifies an order confirmation (ORD-XXXX)", () => {
		expect(classifyInbound("Hi, my order ORD-A7K9")).toEqual({
			kind: "order_confirm",
			shortId: "ORD-A7K9",
		});
	});

	test("a store-QR scan takes precedence over an order id in the same message", () => {
		expect(classifyInbound(`ORD-A7K9 KPS-${token}`)).toEqual({
			kind: "store_checkout_start",
			token,
		});
	});

	test("a short/garbled KPS fragment does not match (needs a full 24-char token)", () => {
		expect(classifyInbound("KPS-tooshort")).toEqual({ kind: "unknown" });
	});

	test("a bare KP- (the removed per-session flow) no longer routes anywhere", () => {
		// The old per-session bind intent is gone; a stray KP- is just chatter.
		expect(classifyInbound(`KP-${token}`)).toEqual({ kind: "unknown" });
	});

	test("unknown for ordinary chatter", () => {
		expect(classifyInbound("hello, are you open?")).toEqual({
			kind: "unknown",
		});
	});
});
