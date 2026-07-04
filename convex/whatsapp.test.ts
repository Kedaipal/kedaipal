/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

/** Resolve an order's buyer tracking token from its shortId (see orders.test.ts). */
async function tk(
	t: ReturnType<typeof setup>,
	shortId: string,
): Promise<string> {
	return await t.run(async (ctx) => {
		const o = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		if (!o) return "__no_such_order__";
		if (o.trackingToken) return o.trackingToken;
		const token = `tok_${shortId}`;
		await ctx.db.patch(o._id, { trackingToken: token });
		return token;
	});
}

const USER = "user_wa_test";

type FetchCall = { url: string; body: unknown };

function installFetchMock(): {
	calls: FetchCall[];
	waCalls: () => FetchCall[];
	restore: () => void;
} {
	const calls: FetchCall[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
		const body = init?.body ? JSON.parse(init.body as string) : null;
		calls.push({ url: String(url), body });
		return new Response("{}", { status: 200 });
	}) as unknown as typeof fetch;
	return {
		calls,
		// Filter to WhatsApp Cloud API (graph.facebook.com) only — retailer-side
		// emails (api.resend.com) are captured by the same fetch mock and would
		// otherwise inflate counts in WA-focused tests.
		waCalls: () => calls.filter((c) => c.url.includes("graph.facebook.com")),
		restore: () => {
			globalThis.fetch = original;
		},
	};
}

async function seedRetailerWithLocale(
	t: ReturnType<typeof convexTest>,
	locale: "en" | "ms",
): Promise<{ retailerId: Id<"retailers">; productId: Id<"products"> }> {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Test Outdoor",
		slug: `outdoor-${locale}`,
	});
	if (locale !== "en") {
		await asUser.mutation(api.retailers.updateSettings, { locale });
	}
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	const productId = await asUser.mutation(api.products.create, {
		retailerId: retailer._id,
		name: "Tent 2P",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		variants: [{ optionValues: [], price: 12000, onHand: 100 }],
	});
	return { retailerId: retailer._id, productId };
}

async function createPendingOrder(
	t: ReturnType<typeof convexTest>,
	retailerId: Id<"retailers">,
	productId: Id<"products">,
): Promise<string> {
	const { shortId } = await t.mutation(api.orders.create, {
		retailerId,
		items: [{ productId, quantity: 1 }],
		currency: "MYR",
		channel: "whatsapp",
		customer: { name: "Ali", waPhone: "60123456789" },
		deliveryAddress: {
			line1: "12 Jln Mawar 3",
			city: "Petaling Jaya",
			state: "Selangor",
			postcode: "47301",
		},
	});
	return shortId;
}

beforeEach(() => {
	// Fake timers prevent scheduled functions (runAfter) from auto-firing
	// during the test. This avoids a convex-test limitation where scheduled
	// internalActions that call ctx.runQuery crash with "Transaction not started".
	vi.useFakeTimers();
	process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
	process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-id";
	process.env.WHATSAPP_VERIFY_TOKEN = "test-verify";
	process.env.RESEND_API_KEY = "test-resend";
	process.env.EMAIL_FROM = "Kedaipal <orders@kedaipal.test>";
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("whatsapp inbound", () => {
	test("matches ORD-XXXX, confirms order, sends EN reply, stamps waPhone", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const shortId = await createPendingOrder(t, retailerId, productId);

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: `Hi, my order ${shortId}`,
		});

		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(order?.status).toBe("confirmed");
		expect(order?.customer.waPhone).toBe("60123456789");
		expect(fetchMock.calls).toHaveLength(1);
		expect(fetchMock.calls[0].url).toContain("test-phone-id/messages");
		const body = fetchMock.calls[0].body as {
			type: string;
			interactive: {
				type: string;
				header: { type: string; image: { link: string } };
				body: { text: string };
				action: { parameters: { display_text: string; url: string } };
			};
			to: string;
		};
		expect(body.to).toBe("60123456789");
		expect(body.type).toBe("interactive");
		expect(body.interactive.type).toBe("cta_url");
		expect(body.interactive.header.image.link).toBe(
			"https://kedaipal.com/logo-2.png",
		);
		expect(body.interactive.action.parameters.display_text).toBe("I've paid");
		expect(body.interactive.action.parameters.url).toContain(
			`/track/${await tk(t, shortId)}`,
		);
		expect(body.interactive.body.text).toContain(shortId);
		expect(body.interactive.body.text).toContain("confirmed");
		// System line: shopper must use the order ID as the bank transfer
		// reference. Hard-coded — even retailer template overrides cannot
		// suppress it.
		expect(body.interactive.body.text).toContain(
			`Use ${shortId} as your transfer reference`,
		);
		fetchMock.restore();
	});

	test("transfer-reference line is locale-aware (ms retailer)", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "ms");
		const shortId = await createPendingOrder(t, retailerId, productId);

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: shortId,
		});
		const body = fetchMock.calls[0].body as {
			type: string;
			interactive: { body: { text: string } };
		};
		expect(body.interactive.body.text).toContain(
			`Gunakan ${shortId} sebagai rujukan pemindahan`,
		);
		fetchMock.restore();
	});

	test("transfer-reference line is appended even when retailer overrides confirm template", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const asUser = t.withIdentity({ subject: USER });
		await asUser.mutation(api.retailers.updateSettings, {
			messageTemplates: {
				en: { confirm: "Custom confirm only — no reference info." },
			},
		});
		const shortId = await createPendingOrder(t, retailerId, productId);
		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: shortId,
		});
		const body = fetchMock.calls[0].body as {
			type: string;
			interactive: { body: { text: string } };
		};
		expect(body.interactive.body.text).toContain("Custom confirm only");
		expect(body.interactive.body.text).toContain(
			`Use ${shortId} as your transfer reference`,
		);
		fetchMock.restore();
	});

	test("uses Bahasa Malaysia copy when retailer locale is ms", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "ms");
		const shortId = await createPendingOrder(t, retailerId, productId);

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: `Pesanan saya ${shortId}`,
		});

		const body = fetchMock.calls[0].body as {
			type: string;
			interactive: { body: { text: string } };
		};
		expect(body.type).toBe("interactive");
		expect(body.interactive.body.text).toContain("Pesanan");
		expect(body.interactive.body.text).toContain("disahkan");
		fetchMock.restore();
	});

	test("idempotent: re-confirming an already-confirmed order does not duplicate event", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const shortId = await createPendingOrder(t, retailerId, productId);

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: shortId,
		});
		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: shortId,
		});

		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		const events = await t.run(async (ctx) =>
			ctx.db
				.query("orderEvents")
				.withIndex("by_order", (q) => q.eq("orderId", order!._id))
				.collect(),
		);
		// pending (initial) + confirmed (first inbound) — no duplicate
		expect(events).toHaveLength(2);
		fetchMock.restore();
	});

	test("unknown text sends fallback reply", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		await seedRetailerWithLocale(t, "en");

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: "hello there",
		});

		const body = fetchMock.calls[0].body as { text: { body: string } };
		expect(body.text.body).toMatch(/browse our catalog/);
		fetchMock.restore();
	});

	test("appends payment instructions to confirm reply when configured", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const asUser = t.withIdentity({ subject: USER });
		await asUser.mutation(api.retailers.updateSettings, {
			paymentInstructions: {
				bankName: "Maybank",
				bankAccountName: "Acme Outdoor",
				bankAccountNumber: "5123-4567",
				note: "Send receipt after transfer.",
			},
		});
		const shortId = await createPendingOrder(t, retailerId, productId);

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: shortId,
		});

		// Only one send (interactive cta_url with image header) — no QR configured.
		expect(fetchMock.calls).toHaveLength(1);
		const body = fetchMock.calls[0].body as {
			type: string;
			interactive: { body: { text: string } };
		};
		expect(body.type).toBe("interactive");
		const text = body.interactive.body.text;
		expect(text).toContain(shortId);
		expect(text).toContain("confirmed");
		expect(text).toContain("💳 Payment details");
		// Legacy single object is synthesized into one bank method; label = bank
		// name, shown as a bold heading (no redundant "Bank:" line).
		expect(text).toContain("*Maybank*");
		expect(text).toContain("Name: Acme Outdoor");
		// Account number on its own line (label above, bare number below).
		expect(text).toContain("Account:");
		expect(text.split("\n")).toContain("5123-4567");
		expect(text).toContain("Send receipt after transfer.");
		fetchMock.restore();
	});

	test("payment block is locale-aware (ms retailer)", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "ms");
		const asUser = t.withIdentity({ subject: USER });
		await asUser.mutation(api.retailers.updateSettings, {
			paymentInstructions: { bankName: "CIMB", bankAccountNumber: "9988" },
		});
		const shortId = await createPendingOrder(t, retailerId, productId);

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: shortId,
		});

		const body = fetchMock.calls[0].body as {
			type: string;
			interactive: { body: { text: string } };
		};
		expect(body.type).toBe("interactive");
		const text = body.interactive.body.text;
		expect(text).toContain("disahkan");
		expect(text).toContain("💳 Maklumat pembayaran");
		expect(text).toContain("*CIMB*");
		expect(text).toContain("Akaun:");
		expect(text.split("\n")).toContain("9988");
		fetchMock.restore();
	});

	test("sends QR image as a follow-up when qrImageStorageId set", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const asUser = t.withIdentity({ subject: USER });

		// Upload a tiny fake image to Convex storage so getUrl resolves.
		const storageId = await t.run(async (ctx) => {
			const blob = new Blob([new Uint8Array([1, 2, 3, 4])], {
				type: "image/png",
			});
			return ctx.storage.store(blob);
		});

		await asUser.mutation(api.retailers.updateSettings, {
			paymentInstructions: {
				qrImageStorageId: storageId,
				note: "Scan to pay via DuitNow.",
			},
		});
		const shortId = await createPendingOrder(t, retailerId, productId);

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: shortId,
		});

		// Two sends: interactive cta_url confirm + image QR follow-up
		expect(fetchMock.calls).toHaveLength(2);
		const confirmBody = fetchMock.calls[0].body as {
			type: string;
			interactive: { body: { text: string } };
		};
		expect(confirmBody.type).toBe("interactive");
		expect(confirmBody.interactive.body.text).toContain(
			"Scan to pay via DuitNow.",
		);

		const qrBody = fetchMock.calls[1].body as {
			type: string;
			image: { link: string; caption?: string };
		};
		expect(qrBody.type).toBe("image");
		expect(qrBody.image.link).toMatch(/^https?:\/\//);
		// Caption is prefixed with the method label (legacy QR → "QR code").
		expect(qrBody.image.caption).toBe("QR code — Scan to pay");
		fetchMock.restore();
	});

	test("no payment instructions → confirm reply unchanged, no extra send", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const shortId = await createPendingOrder(t, retailerId, productId);

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: shortId,
		});

		expect(fetchMock.calls).toHaveLength(1);
		const body = fetchMock.calls[0].body as {
			type: string;
			interactive: { body: { text: string } };
		};
		expect(body.type).toBe("interactive");
		expect(body.interactive.body.text).not.toContain("💳");
		expect(body.interactive.body.text).not.toContain("Payment details");
		fetchMock.restore();
	});

	test("unmatched ORD shortId sends fallback", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		await seedRetailerWithLocale(t, "en");

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: "ORD-ZZZZ please",
		});

		expect(fetchMock.calls).toHaveLength(1);
		fetchMock.restore();
	});
});

describe("whatsapp confirm — custom item defers the payment ask", () => {
	// Seed a made-to-order product (requiresProof) and an order for it. The
	// order is created with mockupStatus "pending", so the mockup gate is closed.
	async function seedCustomOrder(
		t: ReturnType<typeof convexTest>,
		locale: "en" | "ms" = "en",
	): Promise<{ shortId: string; orderId: Id<"orders"> }> {
		const asUser = t.withIdentity({ subject: USER });
		await asUser.mutation(api.retailers.createRetailer, {
			storeName: "Cake Studio",
			slug: `cake-${locale}`,
		});
		if (locale !== "en") {
			await asUser.mutation(api.retailers.updateSettings, { locale });
		}
		await asUser.mutation(api.retailers.updateSettings, {
			paymentInstructions: { bankName: "Maybank", bankAccountNumber: "5123-4567" },
		});
		const retailer = await asUser.query(api.retailers.getMyRetailer);
		if (!retailer) throw new Error("seed failed");
		const productId = await asUser.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Custom Birthday Cake",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			requiresProof: true,
			variants: [{ optionValues: [], price: 0, onHand: 0 }],
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Ali", waPhone: "60123456789" },
			deliveryAddress: {
				line1: "12 Jln Mawar 3",
				city: "Petaling Jaya",
				state: "Selangor",
				postcode: "47301",
			},
		});
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		return { shortId, orderId: order!._id };
	}

	test("custom order → branded image confirm, no 'I've paid' button or payment block", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { shortId } = await seedCustomOrder(t);

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: shortId,
		});

		// Exactly one WA message: a branded image (logo header) with a caption —
		// no QR follow-up, no interactive CTA, no payment details yet.
		expect(fetchMock.waCalls()).toHaveLength(1);
		const body = fetchMock.waCalls()[0].body as {
			type: string;
			image?: { link: string; caption?: string };
		};
		expect(body.type).toBe("image");
		expect(body.image?.link).toBe("https://kedaipal.com/logo-2.png");
		const caption = body.image?.caption ?? "";
		expect(caption).toContain(shortId);
		expect(caption).toContain("design to approve");
		expect(caption).not.toContain("I've paid");
		expect(caption).not.toContain("transfer reference");
		expect(caption).not.toContain("Maybank");
		fetchMock.restore();
	});

	test("notifyPaymentDue (approved) sends the deferred 'I've paid' prompt", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { orderId, shortId } = await seedCustomOrder(t);

		await t.action(internal.whatsapp.notifyPaymentDue, {
			orderId,
			reason: "approved",
		});

		expect(fetchMock.waCalls().length).toBeGreaterThanOrEqual(1);
		const body = fetchMock.waCalls()[0].body as {
			type: string;
			interactive: {
				type: string;
				body: { text: string };
				action: { parameters: { display_text: string; url: string } };
			};
		};
		expect(body.type).toBe("interactive");
		expect(body.interactive.type).toBe("cta_url");
		expect(body.interactive.action.parameters.display_text).toBe("I've paid");
		expect(body.interactive.action.parameters.url).toContain(`/track/${await tk(t, shortId)}`);
		expect(body.interactive.body.text).toContain("approved");
		expect(body.interactive.body.text).toContain(
			`Use ${shortId} as your transfer reference`,
		);
		expect(body.interactive.body.text).toContain("Maybank");
		fetchMock.restore();
	});

	test("notifyPaymentDue (waived) sends the payment prompt with the waiver intro", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { orderId, shortId } = await seedCustomOrder(t);

		await t.action(internal.whatsapp.notifyPaymentDue, {
			orderId,
			reason: "waived",
		});

		const body = fetchMock.waCalls()[0].body as {
			interactive: {
				body: { text: string };
				action: { parameters: { display_text: string } };
			};
		};
		expect(body.interactive.action.parameters.display_text).toBe("I've paid");
		expect(body.interactive.body.text).toContain(
			`payment details for your order ${shortId}`,
		);
		fetchMock.restore();
	});

	test("notifyPaymentDue (declined) sends the payment prompt for the remainder", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { orderId, shortId } = await seedCustomOrder(t);

		await t.action(internal.whatsapp.notifyPaymentDue, {
			orderId,
			reason: "declined",
		});

		const body = fetchMock.waCalls()[0].body as {
			interactive: {
				body: { text: string };
				action: { parameters: { display_text: string } };
			};
		};
		expect(body.interactive.action.parameters.display_text).toBe("I've paid");
		expect(body.interactive.body.text).toContain("custom item was removed");
		expect(body.interactive.body.text).toContain(shortId);
		fetchMock.restore();
	});
});

describe("whatsapp outbound on status change", () => {
	test("notifyStatusChange sends localized message for each status", async () => {
		const cases: Array<{
			locale: "en" | "ms";
			status: "packed" | "shipped" | "delivered" | "cancelled";
			expect: RegExp;
		}> = [
			{ locale: "en", status: "packed", expect: /packed/ },
			{ locale: "en", status: "shipped", expect: /on the way/ },
			{ locale: "en", status: "delivered", expect: /delivered/ },
			{ locale: "en", status: "cancelled", expect: /cancelled/ },
			{ locale: "ms", status: "packed", expect: /dibungkus/ },
			{ locale: "ms", status: "shipped", expect: /perjalanan/ },
			{ locale: "ms", status: "delivered", expect: /sampai/ },
			{ locale: "ms", status: "cancelled", expect: /dibatalkan/ },
		];

		for (const c of cases) {
			const t = setup();
			const fetchMock = installFetchMock();
			const { retailerId, productId } = await seedRetailerWithLocale(
				t,
				c.locale,
			);
			const shortId = await createPendingOrder(t, retailerId, productId);
			// Confirm via inbound to populate waPhone
			await t.action(internal.whatsapp.handleInbound, {
				fromPhone: "60123456789",
				text: shortId,
			});
			fetchMock.calls.length = 0;

			// Patch the order's status directly, then invoke the action.
			// This avoids the scheduler so the test stays deterministic.
			const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
			await t.run(async (ctx) => {
				await ctx.db.patch(order!._id, { status: c.status });
			});
			await t.action(internal.whatsapp.notifyStatusChange, {
				orderId: order!._id,
			});

			const sent = fetchMock.calls.find((call) => {
				const body = call.body as { text?: { body?: string } };
				return body?.text?.body && c.expect.test(body.text.body);
			});
			expect(sent, `${c.locale}/${c.status}`).toBeDefined();
			fetchMock.restore();
		}
	});

	test("uses retailer custom template override with variable interpolation", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const asUser = t.withIdentity({ subject: USER });
		await asUser.mutation(api.retailers.updateSettings, {
			messageTemplates: {
				en: {
					confirm: "Yo {shortId}! Thanks from {storeName} 🙌",
					packed: "Custom packed {shortId}",
				},
			},
		});
		const shortId = await createPendingOrder(t, retailerId, productId);
		

		// Confirm via inbound — should use custom confirm template, with the
		// non-overridable transfer-reference line appended below it.
		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: shortId,
		});
		const confirmBody = fetchMock.calls[0].body as {
			type: string;
			interactive: { body: { text: string } };
		};
		expect(confirmBody.type).toBe("interactive");
		expect(confirmBody.interactive.body.text).toBe(
			`Yo ${shortId}! Thanks from Test Outdoor 🙌\n\nUse ${shortId} as your transfer reference so we can match it.`,
		);
		fetchMock.calls.length = 0;

		// Packed via direct status patch — should use custom packed template
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		await t.run(async (ctx) => {
			await ctx.db.patch(order!._id, { status: "packed" });
		});
		await t.action(internal.whatsapp.notifyStatusChange, {
			orderId: order!._id,
		});
		const packedBody = (fetchMock.calls[0].body as { text: { body: string } })
			.text.body;
		expect(packedBody).toBe(`Custom packed ${shortId}`);
		fetchMock.restore();
	});

	test("missing override key falls back to default catalog", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const asUser = t.withIdentity({ subject: USER });
		await asUser.mutation(api.retailers.updateSettings, {
			messageTemplates: { en: { confirm: "Custom confirm {shortId}" } },
		});
		const shortId = await createPendingOrder(t, retailerId, productId);
		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: shortId,
		});
		fetchMock.calls.length = 0;

		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		await t.run(async (ctx) => {
			await ctx.db.patch(order!._id, { status: "shipped" });
		});
		await t.action(internal.whatsapp.notifyStatusChange, {
			orderId: order!._id,
		});
		const body = (fetchMock.calls[0].body as { text: { body: string } }).text
			.body;
		// shipped not overridden → default
		expect(body).toMatch(/on the way/);
		fetchMock.restore();
	});

	test("empty string override is treated as reset", async () => {
		const t = setup();
		const asUser = t.withIdentity({ subject: USER });
		await seedRetailerWithLocale(t, "en");
		await asUser.mutation(api.retailers.updateSettings, {
			messageTemplates: { en: { confirm: "" } },
		});
		const r = await asUser.query(api.retailers.getMyRetailer);
		expect(r?.messageTemplates?.en?.confirm).toBeUndefined();
	});

	test("rejects template longer than 1000 chars", async () => {
		const t = setup();
		const asUser = t.withIdentity({ subject: USER });
		await seedRetailerWithLocale(t, "en");
		await expect(
			asUser.mutation(api.retailers.updateSettings, {
				messageTemplates: { en: { confirm: "x".repeat(1001) } },
			}),
		).rejects.toThrow(/exceeds 1000/);
	});

	test("status change with no customer waPhone is a no-op (no send)", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		// Insert directly to bypass the mutation's required-waPhone validation —
		// simulates a legacy/imported order missing a phone.
		const orderId = await t.run(async (ctx) => {
			const now = Date.now();
			return ctx.db.insert("orders", {
				retailerId,
				shortId: "ORD-TEST",
				items: [
					{ productId, name: "Tent 2P", price: 12000, quantity: 1 },
				],
				subtotal: 12000,
				total: 12000,
				currency: "MYR",
				status: "packed",
				channel: "whatsapp",
				customer: {},
				createdAt: now,
				updatedAt: now,
			});
		});
		await t.action(internal.whatsapp.notifyStatusChange, { orderId });
		expect(fetchMock.calls).toHaveLength(0);
		fetchMock.restore();
	});
});

describe("whatsapp payment received", () => {
	test("notifyPaymentReceived sends localized message to customer (en)", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const shortId = await createPendingOrder(t, retailerId, productId);
		// Run an inbound to confirm + populate waPhone, then clear the mock.
		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: shortId,
		});
		fetchMock.calls.length = 0;

		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		await t.action(internal.whatsapp.notifyPaymentReceived, {
			orderId: order!._id,
		});

		const sent = fetchMock.calls.find((call) => {
			const body = call.body as { text?: { body?: string } };
			return body?.text?.body?.includes("Payment received");
		});
		expect(sent).toBeDefined();
		const body = sent!.body as { to: string; text: { body: string } };
		expect(body.to).toBe("60123456789");
		expect(body.text.body).toContain(shortId);
		fetchMock.restore();
	});

	test("notifyPaymentReceived uses Bahasa Malaysia for ms retailer", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "ms");
		const shortId = await createPendingOrder(t, retailerId, productId);
		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: shortId,
		});
		fetchMock.calls.length = 0;

		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		await t.action(internal.whatsapp.notifyPaymentReceived, {
			orderId: order!._id,
		});

		const sent = fetchMock.calls.find((call) => {
			const body = call.body as { text?: { body?: string } };
			return body?.text?.body?.includes("Pembayaran diterima");
		});
		expect(sent).toBeDefined();
		fetchMock.restore();
	});

	test("notifyPaymentReceived skips when customer has no waPhone", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const orderId = await t.run(async (ctx) => {
			const now = Date.now();
			return ctx.db.insert("orders", {
				retailerId,
				shortId: "ORD-NOPH",
				items: [
					{ productId, name: "Tent 2P", price: 12000, quantity: 1 },
				],
				subtotal: 12000,
				total: 12000,
				currency: "MYR",
				status: "pending",
				channel: "whatsapp",
				customer: {},
				createdAt: now,
				updatedAt: now,
			});
		});
		await t.action(internal.whatsapp.notifyPaymentReceived, { orderId });
		expect(fetchMock.calls).toHaveLength(0);
		fetchMock.restore();
	});
});

describe("whatsapp confirm — single message (no follow-up location pin)", () => {
	async function seedSelfCollectRetailer(t: ReturnType<typeof convexTest>) {
		const asUser = t.withIdentity({ subject: USER });
		await asUser.mutation(api.retailers.createRetailer, {
			storeName: "Pin Test Store",
			slug: "pin-test",
		});
		await asUser.mutation(api.retailers.updateSettings, {
			offerSelfCollect: true,
		});
		const retailer = await asUser.query(api.retailers.getMyRetailer);
		if (!retailer) throw new Error("seed failed");
		const productId = await asUser.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Kuih Tepung",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [{ optionValues: [], price: 1000, onHand: 50 }],
		});
		return { retailerId: retailer._id, productId, asUser };
	}

	test("self-collect order with coords → confirm body includes the derived maps URL, no separate location message is sent", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId, asUser } = await seedSelfCollectRetailer(t);
		const { pickupLocationId } = await asUser.mutation(
			api.pickupLocations.create,
			{
				retailerId,
				label: "Main Store",
				address: "12 Jln Tun Razak, 50400 KL",
				latitude: 3.158,
				longitude: 101.712,
				placeId: "ChIJ_pickup",
			},
		);
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Ali", waPhone: "60123456789" },
			deliveryMethod: "self_collect",
			pickupLocationId,
		});

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: `Hi, my order ${shortId}`,
		});

		// No `type: "location"` send anywhere — that infrastructure is gone.
		const locationCalls = fetchMock
			.waCalls()
			.filter(
				(c) => (c.body as { type?: string } | null)?.type === "location",
			);
		expect(locationCalls).toHaveLength(0);

		// The pickup block (with maps URL) lands inside the confirm CTA body.
		const ctaCall = fetchMock
			.waCalls()
			.find(
				(c) => (c.body as { type?: string } | null)?.type === "interactive",
			);
		expect(ctaCall).toBeDefined();
		const body = (
			ctaCall?.body as {
				interactive: { body: { text: string } };
			}
		).interactive.body.text;
		expect(body).toContain("Self-collect details");
		expect(body).toContain("Main Store");
		expect(body).toContain(
			"https://www.google.com/maps/place/?q=place_id:ChIJ_pickup",
		);
		fetchMock.restore();
	});

	test("delivery order: no location pin sent (confirm body is unchanged for delivery)", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Ali", waPhone: "60123456789" },
			deliveryAddress: {
				line1: "12 Jln Mawar 3",
				city: "Petaling Jaya",
				state: "Selangor",
				postcode: "47301",
				latitude: 3.1,
				longitude: 101.6,
				placeId: "ChIJ_delivery",
			},
		});

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: `Hi, my order ${shortId}`,
		});

		const locationCalls = fetchMock
			.waCalls()
			.filter(
				(c) => (c.body as { type?: string } | null)?.type === "location",
			);
		expect(locationCalls).toHaveLength(0);
		fetchMock.restore();
	});
});

describe("whatsapp tracking-link token self-heal", () => {
	// A pre-migration order (no trackingToken yet) must NOT ship a dead
	// `/track/` link — the notify path lazily generates + persists a token via
	// internal.orders.ensureTrackingToken. Guards the regression where the URL
	// silently degraded to `${appUrl}/track/` (empty token).
	async function stripToken(
		t: ReturnType<typeof setup>,
		shortId: string,
	): Promise<void> {
		await t.run(async (ctx) => {
			const o = await ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
				.first();
			if (o) await ctx.db.patch(o._id, { trackingToken: undefined });
		});
	}

	async function tokenOf(
		t: ReturnType<typeof setup>,
		shortId: string,
	): Promise<string | undefined> {
		return await t.run(async (ctx) => {
			const o = await ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
				.first();
			return o?.trackingToken;
		});
	}

	test("confirm reply self-heals a missing token instead of a dead /track/ link", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const shortId = await createPendingOrder(t, retailerId, productId);
		await stripToken(t, shortId);

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: shortId,
		});

		const body = fetchMock.calls[0].body as {
			interactive: { action: { parameters: { url: string } } };
		};
		const url = body.interactive.action.parameters.url;
		// Never the tokenless dead form (`.../track/` or `.../track`).
		expect(url).not.toMatch(/\/track\/?$/);
		expect(url).toMatch(/\/track\/[A-Za-z0-9]{24}$/);
		// Token was persisted on the order (self-heal, not just a one-off URL).
		expect(await tokenOf(t, shortId)).toMatch(/^[A-Za-z0-9]{24}$/);
		fetchMock.restore();
	});

	test("status-update notification self-heals a missing token", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const shortId = await createPendingOrder(t, retailerId, productId);
		// Move to a status that notifies (packed), then strip the token and fire
		// the notify directly.
		const orderId = await t.run(async (ctx) => {
			const o = await ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
				.first();
			if (!o) throw new Error("order missing");
			await ctx.db.patch(o._id, {
				status: "packed",
				customer: { ...o.customer, waPhone: "60123456789" },
				trackingToken: undefined,
			});
			return o._id;
		});

		await t.action(internal.whatsapp.notifyStatusChange, { orderId });

		const url = (
			fetchMock.calls[0].body as { text?: { body: string } }
		).text?.body;
		expect(url).toMatch(/\/track\/[A-Za-z0-9]{24}/);
		expect(await tokenOf(t, shortId)).toMatch(/^[A-Za-z0-9]{24}$/);
		fetchMock.restore();
	});
});

describe("whatsapp inbound — Counter Checkout intent routing", () => {
	test("KP-<token> binds the session and replies to the buyer", async () => {
		const t = setup();
		const { retailerId } = await seedRetailerWithLocale(t, "en");
		const { sessionId, token } = await t
			.withIdentity({ subject: USER })
			.mutation(api.counterCheckout.createCheckoutSession, {});
		const fetchMock = installFetchMock();

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: `KP-${token}`,
			profileName: "Aiman",
		});

		// Session bound live.
		const read = await t
			.withIdentity({ subject: USER })
			.query(api.counterCheckout.getCheckoutSession, { sessionId });
		expect(read?.status).toBe("buyer_identified");
		expect(read?.waPhone).toBe("60123456789");

		// Buyer got a confirmation (not the generic fallback).
		const reply = (
			fetchMock.waCalls()[0].body as { text?: { body: string } }
		).text?.body;
		expect(reply).toContain("connected to");
		void retailerId;
		fetchMock.restore();
	});

	test("an expired KP-<token> tells the buyer the link expired (no bind)", async () => {
		const t = setup();
		await seedRetailerWithLocale(t, "en");
		const { sessionId, token } = await t
			.withIdentity({ subject: USER })
			.mutation(api.counterCheckout.createCheckoutSession, {});
		await t.run((ctx) => ctx.db.patch(sessionId, { expiresAt: Date.now() - 1 }));
		const fetchMock = installFetchMock();

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: `KP-${token}`,
		});

		const reply = (
			fetchMock.waCalls()[0].body as { text?: { body: string } }
		).text?.body;
		expect(reply).toMatch(/expired/i);
		const row = await t.run((ctx) => ctx.db.get(sessionId));
		expect(row?.status).toBe("expired");
		fetchMock.restore();
	});

	test("the bind reply is localized to the store's locale (ms)", async () => {
		const t = setup();
		await seedRetailerWithLocale(t, "ms");
		const { token } = await t
			.withIdentity({ subject: USER })
			.mutation(api.counterCheckout.createCheckoutSession, {});
		const fetchMock = installFetchMock();

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: `KP-${token}`,
			profileName: "Aiman",
		});

		const reply = (
			fetchMock.waCalls()[0].body as { text?: { body: string } }
		).text?.body;
		expect(reply).toContain("disambungkan"); // "connected" in Malay
		fetchMock.restore();
	});
});

describe("counter order auto-send (notifyCounterOrderCreated)", () => {
	// Pull any human-readable text out of a WA payload (plain text OR the body of
	// an interactive CTA), so assertions don't care which shape the adapter used.
	function waText(body: unknown): string {
		const b = body as {
			text?: { body?: string };
			interactive?: { body?: { text?: string } };
		};
		return b?.text?.body ?? b?.interactive?.body?.text ?? "";
	}
	async function orderIdOf(t: ReturnType<typeof setup>, shortId: string) {
		return t.run(async (ctx) => {
			const o = await ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
				.first();
			if (!o) throw new Error("order missing");
			return o._id;
		});
	}

	test("paid-in-person → confirmation text + the RECEIPT pdf", async () => {
		const t = setup();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const shortId = await createPendingOrder(t, retailerId, productId);
		// Settle it (as counter 'paid now' does) so the document is a receipt.
		const orderId = await orderIdOf(t, shortId);
		await t.run((ctx) =>
			ctx.db.patch(orderId, {
				paymentStatus: "received",
				paymentReceivedAt: Date.now(),
			}),
		);

		const fetchMock = installFetchMock();
		await t.action(internal.whatsapp.notifyCounterOrderCreated, { orderId });
		const wa = fetchMock.waCalls();

		const doc = wa.find(
			(c) => (c.body as { type?: string })?.type === "document",
		);
		expect(doc).toBeTruthy();
		expect(
			(doc?.body as { document?: { filename?: string } }).document?.filename,
		).toBe(`Receipt-${shortId}.pdf`);
		// The buyer was told it's paid — no payment ask.
		const combined = wa.map((c) => waText(c.body)).join("\n");
		expect(combined).toMatch(/paid/i);
		fetchMock.restore();
	});

	test("pay-later → amount + transfer reference + INVOICE pdf, but NOT the repeated bank/QR block", async () => {
		const t = setup();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		// Give the store a bank method. The buyer already received these details at
		// scan-bind (notifyCounterCheckoutPayment), so the order-create message must
		// NOT repeat them (86ey5kq7p) — it carries the amount + transfer ref instead.
		await t.run((ctx) =>
			ctx.db.patch(retailerId, {
				paymentMethods: [
					{
						type: "bank" as const,
						label: "Maybank",
						bankName: "Maybank",
						bankAccountName: "Test Outdoor",
						bankAccountNumber: "1234567890",
						sortOrder: 0,
					},
				],
			}),
		);
		// Left unpaid (counter 'pay later').
		const shortId = await createPendingOrder(t, retailerId, productId);
		const orderId = await orderIdOf(t, shortId);

		const fetchMock = installFetchMock();
		await t.action(internal.whatsapp.notifyCounterOrderCreated, { orderId });
		const wa = fetchMock.waCalls();

		// Invoice (not receipt) document still sent.
		const doc = wa.find(
			(c) => (c.body as { type?: string })?.type === "document",
		);
		expect(
			(doc?.body as { document?: { filename?: string } }).document?.filename,
		).toBe(`Invoice-${shortId}.pdf`);
		const combined = wa.map((c) => waText(c.body)).join("\n");
		// Transfer reference kept (now we have the shortId), bank block dropped.
		expect(combined).toContain(shortId); // "Use ORD-XXXX as your transfer reference"
		expect(combined).not.toContain("1234567890");
		expect(combined).not.toContain("Payment details");
		fetchMock.restore();
	});
});

describe("counter checkout — pay-at-bind payment info (86ey5kq7p)", () => {
	function waText(body: unknown): string {
		const b = body as {
			text?: { body?: string };
			interactive?: { body?: { text?: string } };
		};
		return b?.text?.body ?? b?.interactive?.body?.text ?? "";
	}
	function bankMethod() {
		return {
			type: "bank" as const,
			label: "Maybank",
			bankName: "Maybank",
			bankAccountName: "Test Outdoor",
			bankAccountNumber: "1234567890",
			sortOrder: 0,
		};
	}

	test("notifyCounterCheckoutPayment sends the intro + payment methods block", async () => {
		const t = setup();
		const { retailerId } = await seedRetailerWithLocale(t, "en");
		await t.run((ctx) =>
			ctx.db.patch(retailerId, { paymentMethods: [bankMethod()] }),
		);
		const fetchMock = installFetchMock();

		await t.action(internal.whatsapp.notifyCounterCheckoutPayment, {
			retailerId,
			toPhone: "60123456789",
			storeName: "Test Outdoor",
			locale: "en",
		});

		const combined = fetchMock
			.waCalls()
			.map((c) => waText(c.body))
			.join("\n");
		expect(combined).toContain("whenever you're ready"); // intro copy
		expect(combined).toContain("1234567890"); // bank details pushed early
		fetchMock.restore();
	});

	test("notifyCounterCheckoutPayment no-ops when the seller has no payment methods", async () => {
		const t = setup();
		const { retailerId } = await seedRetailerWithLocale(t, "en");
		const fetchMock = installFetchMock();

		await t.action(internal.whatsapp.notifyCounterCheckoutPayment, {
			retailerId,
			toPhone: "60123456789",
			storeName: "Test Outdoor",
			locale: "en",
		});

		expect(fetchMock.waCalls()).toHaveLength(0);
		fetchMock.restore();
	});

	test("the KP-<token> bind schedules the payment info after the ack", async () => {
		const t = setup();
		const { retailerId } = await seedRetailerWithLocale(t, "en");
		await t.run((ctx) =>
			ctx.db.patch(retailerId, { paymentMethods: [bankMethod()] }),
		);
		const { token } = await t
			.withIdentity({ subject: USER })
			.mutation(api.counterCheckout.createCheckoutSession, {});
		const fetchMock = installFetchMock();

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: `KP-${token}`,
			profileName: "Aiman",
		});
		// The payment send is scheduled (runAfter 0) so the ack lands first — flush it.
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const bodies = fetchMock.waCalls().map((c) => waText(c.body));
		// Ack first, payment details second.
		expect(bodies[0]).toContain("connected to");
		expect(bodies.join("\n")).toContain("1234567890");
		fetchMock.restore();
	});
});

describe("drop-off + custom-stage status copy (86ey570am)", () => {
	test("notifyStatusChange uses drop-off wording when the pickup snapshot is drop_off", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const shortId = await createPendingOrder(t, retailerId, productId);
		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: shortId,
		});
		fetchMock.calls.length = 0;

		const order = await t.query(api.orders.get, {
			token: await tk(t, shortId),
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(order!._id, {
				status: "packed",
				deliveryMethod: "self_collect",
				pickupSnapshot: {
					label: "Bearcamp HQ",
					address: "LOT D, 2, JALAN MP54, Sungai Buloh",
					locationType: "drop_off",
				},
			});
		});
		await t.action(internal.whatsapp.notifyStatusChange, {
			orderId: order!._id,
		});
		const body = (fetchMock.waCalls()[0].body as { text: { body: string } })
			.text.body;
		expect(body).toContain("ready for the drop-off point");
		expect(body).not.toContain("ready for pickup");
		fetchMock.restore();
	});

	test("notifyStatusChange uses the custom stage label + description on anchor crossings", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const asUser = t.withIdentity({ subject: USER });
		await asUser.mutation(api.retailers.updateSettings, {
			orderStages: [
				{ anchor: "confirmed", label: { en: "Accepted" }, notify: true },
				{ anchor: "packed", label: { en: "Cleaning" }, notify: true },
				{
					anchor: "shipped",
					label: { en: "Ready for Collection" },
					description: { en: "Please collect within 14 days." },
					notify: true,
				},
				{ anchor: "delivered", label: { en: "Collected" }, notify: true },
			],
		});
		const shortId = await createPendingOrder(t, retailerId, productId);
		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: shortId,
		});
		fetchMock.calls.length = 0;

		const order = await t.query(api.orders.get, {
			token: await tk(t, shortId),
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(order!._id, { status: "shipped" });
		});
		await t.action(internal.whatsapp.notifyStatusChange, {
			orderId: order!._id,
		});
		const body = (fetchMock.waCalls()[0].body as { text: { body: string } })
			.text.body;
		expect(body).toContain(`Order ${shortId} update: Ready for Collection.`);
		expect(body).toContain("Please collect within 14 days.");
		expect(body).not.toContain("on the way");
		fetchMock.restore();
	});

	test("an authored template override still beats the custom stage copy", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const asUser = t.withIdentity({ subject: USER });
		await asUser.mutation(api.retailers.updateSettings, {
			orderStages: [
				{ anchor: "confirmed", label: { en: "Accepted" }, notify: true },
				{ anchor: "packed", label: { en: "Cleaning" }, notify: true },
			],
			messageTemplates: { en: { packed: "Custom packed {shortId}" } },
		});
		const shortId = await createPendingOrder(t, retailerId, productId);
		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: shortId,
		});
		fetchMock.calls.length = 0;

		const order = await t.query(api.orders.get, {
			token: await tk(t, shortId),
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(order!._id, { status: "packed" });
		});
		await t.action(internal.whatsapp.notifyStatusChange, {
			orderId: order!._id,
		});
		const body = (fetchMock.waCalls()[0].body as { text: { body: string } })
			.text.body;
		expect(body).toBe(`Custom packed ${shortId}`);
		fetchMock.restore();
	});

	test("default stages keep the rich canonical copy (zero regression)", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const shortId = await createPendingOrder(t, retailerId, productId);
		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: shortId,
		});
		fetchMock.calls.length = 0;

		const order = await t.query(api.orders.get, {
			token: await tk(t, shortId),
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(order!._id, { status: "shipped" });
		});
		await t.action(internal.whatsapp.notifyStatusChange, {
			orderId: order!._id,
		});
		const body = (fetchMock.waCalls()[0].body as { text: { body: string } })
			.text.body;
		expect(body).toContain("on the way");
		fetchMock.restore();
	});
});
