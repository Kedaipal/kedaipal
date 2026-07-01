import { describe, expect, test } from "vitest";
import { classifyInbound } from "./inboundIntent";

describe("classifyInbound", () => {
	const token = "Ab12Cd34Ef56Gh78Ij90Kl12"; // 24 url-safe chars

	test("classifies a Counter Checkout bind (KP-<token>)", () => {
		expect(classifyInbound(`KP-${token}`)).toEqual({
			kind: "checkout_bind",
			token,
		});
		// Embedded in the prefilled hello text.
		expect(
			classifyInbound(`Hi! I'm at the counter KP-${token}`),
		).toEqual({ kind: "checkout_bind", token });
		// The actual humanized QR prefill (emoji + newlines around the ref) still
		// extracts the token — see buildCheckoutWaUrl in counterCheckout.ts.
		expect(
			classifyInbound(
				`Hi! 👋 I'd like to check out at the counter.\n\nMy order ref: KP-${token}`,
			),
		).toEqual({ kind: "checkout_bind", token });
	});

	test("classifies an order confirmation (ORD-XXXX)", () => {
		expect(classifyInbound("Hi, my order ORD-A7K9")).toEqual({
			kind: "order_confirm",
			shortId: "ORD-A7K9",
		});
	});

	test("checkout bind takes precedence over an order id in the same message", () => {
		expect(classifyInbound(`ORD-A7K9 KP-${token}`)).toEqual({
			kind: "checkout_bind",
			token,
		});
	});

	test("a short/garbled KP fragment does not match (needs a full 24-char token)", () => {
		expect(classifyInbound("KP-tooshort")).toEqual({ kind: "unknown" });
	});

	test("unknown for ordinary chatter", () => {
		expect(classifyInbound("hello, are you open?")).toEqual({
			kind: "unknown",
		});
	});
});
