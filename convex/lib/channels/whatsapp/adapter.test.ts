/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { computeMetaSignature } from "../../whatsappSignature";
import { whatsappAdapter } from "./adapter";

type FetchCall = { url: string; body: Record<string, unknown> };

function installFetchMock(): { calls: FetchCall[]; restore: () => void } {
	const calls: FetchCall[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
		const body = init?.body ? JSON.parse(init.body as string) : {};
		calls.push({ url: String(url), body });
		return new Response("{}", { status: 200 });
	}) as unknown as typeof fetch;
	return {
		calls,
		restore: () => {
			globalThis.fetch = original;
		},
	};
}

beforeEach(() => {
	process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
	process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-id";
});

afterEach(() => {
	vi.restoreAllMocks();
	delete process.env.WHATSAPP_APP_SECRET;
});

describe("whatsappAdapter.send — union → Meta payload mapping", () => {
	test("text → text message", async () => {
		const fetchMock = installFetchMock();
		await whatsappAdapter.send("60123456789", {
			kind: "text",
			body: "hello",
		});
		expect(fetchMock.calls).toHaveLength(1);
		const body = fetchMock.calls[0].body;
		expect(fetchMock.calls[0].url).toContain("test-phone-id/messages");
		expect(body.type).toBe("text");
		expect(body.to).toBe("60123456789");
		expect((body.text as { body: string }).body).toBe("hello");
		fetchMock.restore();
	});

	test("image → image message with caption", async () => {
		const fetchMock = installFetchMock();
		await whatsappAdapter.send("60123456789", {
			kind: "image",
			imageUrl: "https://x.test/qr.png",
			caption: "Scan to pay",
		});
		const body = fetchMock.calls[0].body;
		expect(body.type).toBe("image");
		expect(body.image).toEqual({ link: "https://x.test/qr.png", caption: "Scan to pay" });
		fetchMock.restore();
	});

	test("document → document message with filename + caption", async () => {
		const fetchMock = installFetchMock();
		await whatsappAdapter.send("60123456789", {
			kind: "document",
			documentUrl: "https://x.test/receipt.pdf",
			filename: "Receipt-ORD-ABCD.pdf",
			caption: "Here's your receipt",
		});
		const body = fetchMock.calls[0].body;
		expect(body.type).toBe("document");
		expect(body.document).toEqual({
			link: "https://x.test/receipt.pdf",
			filename: "Receipt-ORD-ABCD.pdf",
			caption: "Here's your receipt",
		});
		fetchMock.restore();
	});

	test("document → omits optional filename/caption when absent", async () => {
		const fetchMock = installFetchMock();
		await whatsappAdapter.send("60123456789", {
			kind: "document",
			documentUrl: "https://x.test/invoice.pdf",
		});
		const body = fetchMock.calls[0].body;
		expect(body.document).toEqual({ link: "https://x.test/invoice.pdf" });
		fetchMock.restore();
	});
});

describe("whatsappAdapter.send — CTA degrade matrix", () => {
	test("https url + image → interactive cta_url with image header", async () => {
		const fetchMock = installFetchMock();
		await whatsappAdapter.send("60123456789", {
			kind: "cta",
			body: "Order confirmed",
			buttonText: "I've paid",
			url: "https://kedaipal.com/track/ORD-ABCD",
			imageUrl: "https://kedaipal.com/logo-2.png",
		});
		const body = fetchMock.calls[0].body;
		expect(body.type).toBe("interactive");
		const interactive = body.interactive as {
			type: string;
			header: { image: { link: string } };
			action: { parameters: { display_text: string; url: string } };
		};
		expect(interactive.type).toBe("cta_url");
		expect(interactive.header.image.link).toBe("https://kedaipal.com/logo-2.png");
		expect(interactive.action.parameters.display_text).toBe("I've paid");
		fetchMock.restore();
	});

	test("https url, no image → interactive cta_url without header", async () => {
		const fetchMock = installFetchMock();
		await whatsappAdapter.send("60123456789", {
			kind: "cta",
			body: "Order confirmed",
			buttonText: "I've paid",
			url: "https://kedaipal.com/track/ORD-ABCD",
		});
		const body = fetchMock.calls[0].body;
		expect(body.type).toBe("interactive");
		expect((body.interactive as { header?: unknown }).header).toBeUndefined();
		fetchMock.restore();
	});

	// Dev affordance: a LOCAL http:// URL (localhost / loopback / private-LAN) is
	// upgraded to https:// so Meta renders the button while developing. The body
	// text keeps the original http link; only the button URL is upgraded.
	test("local dev http url + image → interactive cta_url with https-upgraded button url", async () => {
		const fetchMock = installFetchMock();
		await whatsappAdapter.send("60123456789", {
			kind: "cta",
			body: "Order confirmed",
			buttonText: "Make payment",
			url: "http://localhost:3000/track/ORD-ABCD",
			imageUrl: "https://kedaipal.com/logo-2.png",
		});
		const body = fetchMock.calls[0].body;
		expect(body.type).toBe("interactive");
		const interactive = body.interactive as {
			type: string;
			action: { parameters: { display_text: string; url: string } };
		};
		expect(interactive.type).toBe("cta_url");
		expect(interactive.action.parameters.display_text).toBe("Make payment");
		// http://localhost… upgraded to https://localhost… for the button.
		expect(interactive.action.parameters.url).toBe(
			"https://localhost:3000/track/ORD-ABCD",
		);
		fetchMock.restore();
	});

	test("local dev http url on a private-LAN host → https-upgraded button", async () => {
		const fetchMock = installFetchMock();
		await whatsappAdapter.send("60123456789", {
			kind: "cta",
			body: "Order confirmed",
			buttonText: "Make payment",
			url: "http://192.168.1.5:3000/track/ORD-ABCD",
		});
		const body = fetchMock.calls[0].body;
		expect(body.type).toBe("interactive");
		expect(
			(body.interactive as { action: { parameters: { url: string } } }).action
				.parameters.url,
		).toBe("https://192.168.1.5:3000/track/ORD-ABCD");
		fetchMock.restore();
	});

	// Safety net: a PUBLIC (non-local) http URL is never silently rewritten —
	// e.g. a misconfigured prod APP_URL still degrades rather than shipping a
	// broken/insecure button.
	test("non-local http url + image → degrades to image with body as caption", async () => {
		const fetchMock = installFetchMock();
		await whatsappAdapter.send("60123456789", {
			kind: "cta",
			body: "Order confirmed",
			buttonText: "Make payment",
			url: "http://not-secure.example.com/track/ORD-ABCD",
			imageUrl: "https://kedaipal.com/logo-2.png",
		});
		const body = fetchMock.calls[0].body;
		expect(body.type).toBe("image");
		expect(body.image).toEqual({
			link: "https://kedaipal.com/logo-2.png",
			caption: "Order confirmed",
		});
		fetchMock.restore();
	});

	test("non-local http url, no image → degrades to text", async () => {
		const fetchMock = installFetchMock();
		await whatsappAdapter.send("60123456789", {
			kind: "cta",
			body: "Order confirmed",
			buttonText: "Make payment",
			url: "http://not-secure.example.com/track/ORD-ABCD",
		});
		const body = fetchMock.calls[0].body;
		expect(body.type).toBe("text");
		expect((body.text as { body: string }).body).toBe("Order confirmed");
		fetchMock.restore();
	});
});

describe("whatsappAdapter.parseInbound", () => {
	test("maps Meta text webhook to InboundEnvelope[]", () => {
		const raw = JSON.stringify({
			entry: [
				{
					changes: [
						{
							value: {
								contacts: [{ wa_id: "60123456789", profile: { name: "Ali" } }],
								messages: [
									{ from: "60123456789", type: "text", text: { body: "ORD-ABCD" } },
								],
							},
						},
					],
				},
			],
		});
		const out = whatsappAdapter.parseInbound(raw, new Headers());
		expect(out).toEqual([
			{
				channel: "whatsapp",
				channelUserId: "60123456789",
				text: "ORD-ABCD",
				profileName: "Ali",
			},
		]);
	});

	test("malformed JSON yields no envelopes (route can ack)", () => {
		expect(whatsappAdapter.parseInbound("not json", new Headers())).toEqual([]);
	});
});

describe("whatsappAdapter.verifySignature", () => {
	const SECRET = "test-app-secret";
	const BODY = JSON.stringify({ entry: [] });

	test("false when WHATSAPP_APP_SECRET is unset", async () => {
		const sig = await computeMetaSignature(SECRET, BODY);
		const ok = await whatsappAdapter.verifySignature(
			BODY,
			new Headers({ "x-hub-signature-256": sig }),
		);
		expect(ok).toBe(false);
	});

	test("true for a correctly-signed body", async () => {
		process.env.WHATSAPP_APP_SECRET = SECRET;
		const sig = await computeMetaSignature(SECRET, BODY);
		const ok = await whatsappAdapter.verifySignature(
			BODY,
			new Headers({ "x-hub-signature-256": sig }),
		);
		expect(ok).toBe(true);
	});

	test("false for a wrong signature", async () => {
		process.env.WHATSAPP_APP_SECRET = SECRET;
		const ok = await whatsappAdapter.verifySignature(
			BODY,
			new Headers({ "x-hub-signature-256": "sha256=deadbeef" }),
		);
		expect(ok).toBe(false);
	});
});
