/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { PUSH_MAX_ATTEMPTS } from "./lib/confirmationPush";
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
		expect(body.interactive.action.parameters.display_text).toBe("Make payment");
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

	test("payment CTA points to the order page — never raw bank details (86ey98ju1)", async () => {
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

		// Exactly one send — no QR/bank follow-ups any more.
		expect(fetchMock.calls).toHaveLength(1);
		const body = fetchMock.calls[0].body as {
			type: string;
			interactive: { body: { text: string } };
		};
		expect(body.type).toBe("interactive");
		const text = body.interactive.body.text;
		expect(text).toContain(shortId);
		expect(text).toContain("confirmed");
		// The confirm intro carries the order-page link once — no separate
		// "💳 Payment details" block is appended (no duplicate link).
		expect(text).toContain("Progress & payment are on your order page");
		expect(text).not.toContain("💳 Payment details");
		expect(text).not.toContain("See how to pay and confirm your payment on your order page");
		// The tracking link appears exactly once in the body.
		expect(text.match(/\/track\//g)?.length).toBe(1);
		// The raw bank details are NEVER in chat.
		expect(text).not.toContain("Maybank");
		expect(text).not.toContain("Acme Outdoor");
		expect(text).not.toContain("5123-4567");
		expect(text).not.toContain("Account:");
		fetchMock.restore();
	});

	test("confirm reply is locale-aware (ms retailer), no bank details", async () => {
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
		// BM confirm intro carries the order-page link; no separate CTA block.
		expect(text).toContain("Status & pembayaran ada di halaman pesanan anda");
		expect(text).not.toContain("💳 Maklumat pembayaran");
		expect(text.match(/\/track\//g)?.length).toBe(1);
		expect(text).not.toContain("CIMB");
		expect(text).not.toContain("9988");
		fetchMock.restore();
	});

	test("a configured QR method sends NO image follow-up, just the linked confirm (86ey98ju1)", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const asUser = t.withIdentity({ subject: USER });

		// Upload a tiny fake image to Convex storage so getUrl would resolve.
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

		// Exactly ONE send — the QR image is no longer pushed to the chat.
		expect(fetchMock.calls).toHaveLength(1);
		const confirmBody = fetchMock.calls[0].body as {
			type: string;
			interactive: { body: { text: string } };
		};
		expect(confirmBody.type).toBe("interactive");
		// The confirm carries the order-page link (no separate CTA block), and the
		// QR is not re-sent as a chat image.
		expect(confirmBody.interactive.body.text).toContain("Progress & payment are on your order page");
		expect(confirmBody.interactive.body.text).not.toContain("💳 Payment details");
		expect(confirmBody.interactive.body.text.match(/\/track\//g)?.length).toBe(1);
		// No image message sent.
		expect(fetchMock.calls.some((c) => (c.body as { type?: string }).type === "image")).toBe(
			false,
		);
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
		expect(caption).toContain("design for you to approve");
		expect(caption).not.toContain("I've paid");
		expect(caption).not.toContain("transfer reference");
		expect(caption).not.toContain("Maybank");
		fetchMock.restore();
	});



});

describe("seller message-template overrides", () => {
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

});

describe("whatsapp inbound — Counter Checkout store QR routing", () => {
	test("KPS-<token> starts a walk-in session + replies with the pairing code", async () => {
		const t = setup();
		const { retailerId } = await seedRetailerWithLocale(t, "en");
		const { token } = await t
			.withIdentity({ subject: USER })
			.mutation(api.counterCheckout.ensureCounterQrToken, {});
		const fetchMock = installFetchMock();

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: `KPS-${token}`,
			profileName: "Aiman",
		});

		const rows = await t.run(async (ctx) =>
			ctx.db
				.query("counterCheckoutSessions")
				.withIndex("by_retailer_status", (q) =>
					q.eq("retailerId", retailerId).eq("status", "buyer_identified"),
				)
				.collect(),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].waPhone).toBe("60123456789");

		const reply =
			(fetchMock.waCalls()[0].body as { text?: { body: string } }).text?.body ??
			"";
		expect(reply).toContain("connected to");
		// The buyer's pairing code is in the reply (bolded), so they can show it.
		expect(reply).toContain(`*${rows[0].pairingCode}*`);
		fetchMock.restore();
	});

	test("the reply is localized to the store's locale (ms)", async () => {
		const t = setup();
		await seedRetailerWithLocale(t, "ms");
		const { token } = await t
			.withIdentity({ subject: USER })
			.mutation(api.counterCheckout.ensureCounterQrToken, {});
		const fetchMock = installFetchMock();

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: `KPS-${token}`,
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

	test("paid-in-person → ONE confirmation text, no PDF document (86eyd63r8)", async () => {
		const t = setup();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const shortId = await createPendingOrder(t, retailerId, productId);
		// Settle it (as counter 'paid now' does).
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

		// A counter walk-in gets one message like everyone else — the receipt PDF
		// (previously auto-attached here) now lives on the Done screen + the
		// buyer's order page instead.
		expect(wa).toHaveLength(1);
		expect((wa[0].body as { type?: string }).type).not.toBe("document");
		// The buyer was told it's paid — no payment ask.
		expect(waText(wa[0].body)).toMatch(/paid/i);
		fetchMock.restore();
	});

	test("pay-later → ONE payment ask, no invoice PDF, never raw bank details (86ey98ju1/86eyd63r8)", async () => {
		const t = setup();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		// Give the store a bank method. The order-create message points the buyer to
		// their order page ("How to pay") — the raw account number is never in chat.
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

		// ONE message (86eyd63r8): the payment ask. The invoice PDF is no longer
		// WhatsApp'd — it's downloadable from the Done screen + the order page,
		// which the message links to.
		expect(wa).toHaveLength(1);
		expect(
			wa.some((c) => (c.body as { type?: string })?.type === "document"),
		).toBe(false);
		// The order-create text message: intro carries the order-page link once,
		// with no separate "💳 Payment details" block (no duplicate link).
		const orderMsg = waText(
			(wa.find((c) => (c.body as { type?: string })?.type === "interactive") ??
				wa.find((c) => (c.body as { type?: string })?.type === "text"))?.body,
		);
		expect(orderMsg).toContain(shortId); // "Use ORD-XXXX as your transfer reference"
		expect(orderMsg).not.toContain("💳 Payment details");
		expect(orderMsg.match(/\/track\//g)?.length).toBe(1);
		// The raw account number is never sent in chat.
		const combined = wa.map((c) => waText(c.body)).join("\n");
		expect(combined).not.toContain("1234567890");
		fetchMock.restore();
	});
});

describe("counter checkout — store QR scan (86ey5neg6 / 86ey98ju1)", () => {
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

	test("a KPS-<token> poster scan starts a walk-in session and acks, WITHOUT pushing bank details (86ey98ju1)", async () => {
		const t = setup();
		const { retailerId } = await seedRetailerWithLocale(t, "en");
		await t.run((ctx) =>
			ctx.db.patch(retailerId, { paymentMethods: [bankMethod()] }),
		);
		const { token } = await t
			.withIdentity({ subject: USER })
			.mutation(api.counterCheckout.ensureCounterQrToken, {});
		const fetchMock = installFetchMock();

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: `Hi! I'd like to order.\n\nStore ref: KPS-${token}`,
			profileName: "Aiman",
		});
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		// A bound walk-in session now exists on the seller's list.
		const rows = await t.run(async (ctx) =>
			ctx.db
				.query("counterCheckoutSessions")
				.withIndex("by_retailer_status", (q) =>
					q.eq("retailerId", retailerId).eq("status", "buyer_identified"),
				)
				.collect(),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].origin).toBe("store_qr");

		const bodies = fetchMock.waCalls().map((c) => waText(c.body));
		expect(bodies[0]).toContain("connected to"); // storeQrConnected ack
		expect(bodies[0]).toContain("kedaipal.com/privacy"); // PDPA notice at collection
		// Only the ack is sent — no bank details are pushed at scan any more.
		expect(fetchMock.waCalls()).toHaveLength(1);
		expect(bodies.join("\n")).not.toContain("1234567890");
		fetchMock.restore();
	});

	test("an unknown/rotated KPS token gets a generic reply, no session, no store leak", async () => {
		const t = setup();
		await seedRetailerWithLocale(t, "en");
		const fetchMock = installFetchMock();

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: "KPS-Zz99Yy88Xx77Ww66Vv55Uu44",
		});
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const body = waText(fetchMock.waCalls()[0]?.body);
		expect(body).not.toContain("connected to");
		expect(body).not.toContain("Test Outdoor");
		fetchMock.restore();
	});
});

describe("storefront confirmation push (86eyf1rck)", () => {
	const TEMPLATE = "order_confirmation_utility";

	/** Fetch mock whose graph responses echo a wamid (like the real Cloud API). */
	function installWamidFetchMock(wamid: string) {
		const calls: FetchCall[] = [];
		const original = globalThis.fetch;
		globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
			const body = init?.body ? JSON.parse(init.body as string) : null;
			calls.push({ url: String(url), body });
			if (String(url).includes("graph.facebook.com")) {
				return new Response(JSON.stringify({ messages: [{ id: wamid }] }), {
					status: 200,
				});
			}
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;
		return {
			calls,
			waCalls: () => calls.filter((c) => c.url.includes("graph.facebook.com")),
			restore: () => {
				globalThis.fetch = original;
			},
		};
	}

	afterEach(() => {
		delete process.env.WHATSAPP_ORDER_CONFIRM_TEMPLATE;
	});

	async function orderIdOf(t: ReturnType<typeof setup>, shortId: string) {
		return await t.run(async (ctx) => {
			const o = await ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
				.first();
			if (!o) throw new Error("order missing");
			return o._id;
		});
	}

	test("sends the template (ms language for ms store) and stamps sent + wamid", async () => {
		process.env.WHATSAPP_ORDER_CONFIRM_TEMPLATE = TEMPLATE;
		const t = setup();
		const fetchMock = installWamidFetchMock("wamid.PUSH1");
		const { retailerId, productId } = await seedRetailerWithLocale(t, "ms");
		const shortId = await createPendingOrder(t, retailerId, productId);
		const orderId = await orderIdOf(t, shortId);

		await t.action(internal.whatsapp.notifyStorefrontOrderCreated, { orderId });

		const wa = fetchMock.waCalls();
		expect(wa).toHaveLength(1);
		const body = wa[0].body as {
			type: string;
			to: string;
			template: {
				name: string;
				language: { code: string };
				components: Array<{
					type: string;
					parameters: Array<{ text: string }>;
				}>;
			};
		};
		expect(body.type).toBe("template");
		expect(body.to).toBe("60123456789");
		expect(body.template.name).toBe(TEMPLATE);
		expect(body.template.language.code).toBe("ms");
		// Body params in order: shortId, storeName, formatted amount.
		expect(body.template.components[0].parameters.map((p) => p.text)).toEqual([
			shortId,
			"Test Outdoor",
			"MYR 120.00",
		]);
		// Button param is the tracking TOKEN (never the shortId).
		expect(body.template.components[1].parameters[0].text).toBe(
			await tk(t, shortId),
		);

		// Read from the DB: the wamid is Meta's internal message id and is
		// deliberately stripped from the unauthenticated buyer read.
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.confirmationPushStatus).toBe("sent");
		expect(order?.confirmationPushWamid).toBe("wamid.PUSH1");
		expect(order?.confirmationPushAt).toBeTypeOf("number");
		const buyerView = await t.query(api.orders.get, {
			token: await tk(t, shortId),
		});
		expect(buyerView?.confirmationPushStatus).toBe("sent");
		expect(buyerView?.confirmationPushWamid).toBeUndefined();
		fetchMock.restore();
	});

	/** Stub graph.facebook.com with a fixed failure response. */
	function installFailingFetch(status: number, body: string) {
		const original = globalThis.fetch;
		globalThis.fetch = vi.fn(async (url: unknown) => {
			if (String(url).includes("graph.facebook.com")) {
				return new Response(body, { status });
			}
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;
		return () => {
			globalThis.fetch = original;
		};
	}

	test("a transient 5xx is retried, so the buyer is never told to send it themselves", async () => {
		process.env.WHATSAPP_ORDER_CONFIRM_TEMPLATE = TEMPLATE;
		const t = setup();
		const restore = installFailingFetch(500, "boom");
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const shortId = await createPendingOrder(t, retailerId, productId);
		const orderId = await orderIdOf(t, shortId);

		await t.action(internal.whatsapp.notifyStorefrontOrderCreated, { orderId });

		// Still in flight — NOT stamped failed, so no recovery card is shown.
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(order?.confirmationPushStatus).toBe("sending");
		expect(order?.confirmationPushFailureKind).toBeUndefined();
		restore();
	});

	test("the last attempt of a transient failure gives up as a system fault (never blames the number)", async () => {
		process.env.WHATSAPP_ORDER_CONFIRM_TEMPLATE = TEMPLATE;
		const t = setup();
		const restore = installFailingFetch(503, "unavailable");
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const shortId = await createPendingOrder(t, retailerId, productId);
		const orderId = await orderIdOf(t, shortId);

		await t.action(internal.whatsapp.notifyStorefrontOrderCreated, {
			orderId,
			attempt: PUSH_MAX_ATTEMPTS,
		});

		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(order?.confirmationPushStatus).toBe("failed");
		expect(order?.confirmationPushFailureKind).toBe("system");
		restore();
	});

	test("an unreachable number fails immediately on attempt 1 and is attributed to the number", async () => {
		process.env.WHATSAPP_ORDER_CONFIRM_TEMPLATE = TEMPLATE;
		const t = setup();
		const restore = installFailingFetch(
			400,
			JSON.stringify({
				error: { code: 131026, message: "(#131026) Message undeliverable" },
			}),
		);
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const shortId = await createPendingOrder(t, retailerId, productId);
		const orderId = await orderIdOf(t, shortId);

		await t.action(internal.whatsapp.notifyStorefrontOrderCreated, { orderId });

		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(order?.confirmationPushStatus).toBe("failed");
		expect(order?.confirmationPushFailureKind).toBe("unreachable");
		restore();
	});

	test("a template misconfiguration is OUR fault, not the buyer's number", async () => {
		process.env.WHATSAPP_ORDER_CONFIRM_TEMPLATE = TEMPLATE;
		const t = setup();
		const restore = installFailingFetch(
			400,
			JSON.stringify({
				error: { code: 132001, message: "template does not exist" },
			}),
		);
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const shortId = await createPendingOrder(t, retailerId, productId);
		const orderId = await orderIdOf(t, shortId);

		await t.action(internal.whatsapp.notifyStorefrontOrderCreated, { orderId });

		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(order?.confirmationPushStatus).toBe("failed");
		expect(order?.confirmationPushFailureKind).toBe("system");
		restore();
	});

	test("an in-flight retry stops once the buyer has already been reached", async () => {
		process.env.WHATSAPP_ORDER_CONFIRM_TEMPLATE = TEMPLATE;
		const t = setup();
		const fetchMock = installWamidFetchMock("wamid.SHOULDNOTSEND");
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const shortId = await createPendingOrder(t, retailerId, productId);
		const orderId = await orderIdOf(t, shortId);
		// Buyer reached us another way (manual send) while attempts were queued.
		await t.run(async (ctx) => {
			await ctx.db.patch(orderId, { confirmationPushStatus: "recovered" });
		});

		await t.action(internal.whatsapp.notifyStorefrontOrderCreated, {
			orderId,
			attempt: 2,
		});

		expect(fetchMock.waCalls()).toHaveLength(0);
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.confirmationPushStatus).toBe("recovered");
		fetchMock.restore();
	});

	test("no-ops (no send, no stamp) when the template env is unset", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const shortId = await createPendingOrder(t, retailerId, productId);
		const orderId = await orderIdOf(t, shortId);

		await t.action(internal.whatsapp.notifyStorefrontOrderCreated, { orderId });

		expect(fetchMock.waCalls()).toHaveLength(0);
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(order?.confirmationPushStatus).toBeUndefined();
		fetchMock.restore();
	});

	test("failed push + inbound ORD from a DIFFERENT phone re-stamps the number, relinks the customer and marks recovered", async () => {
		process.env.WHATSAPP_ORDER_CONFIRM_TEMPLATE = TEMPLATE;
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		// Buyer typos their number at checkout → linked to the wrong customer.
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Ali", waPhone: "60129999999" },
			deliveryAddress: {
				line1: "12 Jln Mawar 3",
				city: "Petaling Jaya",
				state: "Selangor",
				postcode: "47301",
			},
		});
		// Push path was active → order committed as confirmed at create.
		const orderId = await orderIdOf(t, shortId);
		const preRecovery = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(preRecovery?.status).toBe("confirmed");
		const staleCustomerId = preRecovery?.customerId;
		expect(staleCustomerId).toBeDefined();
		await t.mutation(internal.orders.recordConfirmationPush, {
			orderId,
			status: "failed",
		});

		// The buyer sends the order message manually from their REAL WhatsApp.
		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: `Hi, my order ${shortId}`,
		});

		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.customer.waPhone).toBe("60123456789");
		expect(order?.confirmationPushStatus).toBe("recovered");
		expect(order?.customerId).toBeDefined();
		expect(order?.customerId).not.toBe(staleCustomerId);
		// The typo'd number's customer record no longer counts this order.
		const stale = await t.run(async (ctx) => ctx.db.get(staleCustomerId!));
		expect(stale?.orderCount).toBe(0);
		expect(stale?.totalSpent).toBe(0);
		const real = await t.run(async (ctx) => ctx.db.get(order!.customerId!));
		expect(real?.waPhone).toBe("60123456789");
		expect(real?.orderCount).toBe(1);
		expect(real?.totalSpent).toBe(12000);
		fetchMock.restore();
	});

	test("a healthy (push sent) order's number is NOT overwritten by a different sender", async () => {
		process.env.WHATSAPP_ORDER_CONFIRM_TEMPLATE = TEMPLATE;
		const t = setup();
		const fetchMock = installWamidFetchMock("wamid.OK9");
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const shortId = await createPendingOrder(t, retailerId, productId);
		const orderId = await orderIdOf(t, shortId);
		await t.action(internal.whatsapp.notifyStorefrontOrderCreated, { orderId });

		// A friend forwards the order message from THEIR phone.
		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60175555555",
			text: shortId,
		});

		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.customer.waPhone).toBe("60123456789");
		expect(order?.confirmationPushStatus).toBe("sent");
		fetchMock.restore();
	});

	test("statuses webhook failed event flips sent → failed via wamid; recovered never regresses", async () => {
		process.env.WHATSAPP_ORDER_CONFIRM_TEMPLATE = TEMPLATE;
		const t = setup();
		const fetchMock = installWamidFetchMock("wamid.FLIP1");
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const shortId = await createPendingOrder(t, retailerId, productId);
		const orderId = await orderIdOf(t, shortId);
		await t.action(internal.whatsapp.notifyStorefrontOrderCreated, { orderId });

		// Unknown wamid → no-op.
		await t.mutation(internal.orders.markConfirmationPushFailed, {
			wamid: "wamid.UNKNOWN",
		});
		expect(
			(await t.run(async (ctx) => ctx.db.get(orderId)))?.confirmationPushStatus,
		).toBe("sent");

		// The real failure event lands.
		await t.mutation(internal.orders.markConfirmationPushFailed, {
			wamid: "wamid.FLIP1",
			errorDetail: "131026: Message undeliverable",
		});
		expect(
			(await t.run(async (ctx) => ctx.db.get(orderId)))?.confirmationPushStatus,
		).toBe("failed");

		// Buyer recovers via manual send; a late replayed webhook must not regress.
		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: "60123456789",
			text: shortId,
		});
		await t.mutation(internal.orders.markConfirmationPushFailed, {
			wamid: "wamid.FLIP1",
		});
		expect(
			(await t.run(async (ctx) => ctx.db.get(orderId)))?.confirmationPushStatus,
		).toBe("recovered");
		fetchMock.restore();
	});
});

describe("seller WhatsApp order alerts (86eyhw9zy)", () => {
	const NEW_ORDER_TEMPLATE = "seller_new_order_utility";
	const CLAIM_TEMPLATE = "seller_payment_claim_utility";
	const RECEIVED_TEMPLATE = "seller_payment_received_utility";
	const SELLER_PHONE = "60198765432";

	afterEach(() => {
		delete process.env.WHATSAPP_SELLER_NEW_ORDER_TEMPLATE;
		delete process.env.WHATSAPP_SELLER_PAYMENT_CLAIM_TEMPLATE;
		delete process.env.WHATSAPP_SELLER_PAYMENT_RECEIVED_TEMPLATE;
	});

	async function orderIdOf(t: ReturnType<typeof setup>, shortId: string) {
		return await t.run(async (ctx) => {
			const o = await ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
				.first();
			if (!o) throw new Error("order missing");
			return o._id;
		});
	}

	/** Flip the seeded retailer's alert config on directly — the settings
	 * mutation's own validation/gating has its own suite in retailers.test.ts. */
	async function enableAlerts(
		t: ReturnType<typeof setup>,
		retailerId: Id<"retailers">,
	) {
		await t.run(async (ctx) => {
			await ctx.db.patch(retailerId, {
				notifyWaPhone: SELLER_PHONE,
				orderWaAlerts: true,
			});
		});
	}

	test("new-order alert sends the template to the seller's number with shortId/buyer/total/date + app deep-link param", async () => {
		process.env.WHATSAPP_SELLER_NEW_ORDER_TEMPLATE = NEW_ORDER_TEMPLATE;
		const t = setup();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "ms");
		await enableAlerts(t, retailerId);
		const fetchMock = installFetchMock();
		const shortId = await createPendingOrder(t, retailerId, productId);
		const orderId = await orderIdOf(t, shortId);

		await t.action(internal.whatsapp.notifySellerNewOrder, { orderId });

		const wa = fetchMock.waCalls();
		expect(wa).toHaveLength(1);
		const body = wa[0].body as {
			to: string;
			type: string;
			template: {
				name: string;
				language: { code: string };
				components: Array<{
					type: string;
					sub_type?: string;
					parameters: Array<{ text: string }>;
				}>;
			};
		};
		expect(body.to).toBe(SELLER_PHONE);
		expect(body.type).toBe("template");
		expect(body.template.name).toBe(NEW_ORDER_TEMPLATE);
		// Seller alerts follow the STORE's locale, exactly like the retailer's
		// email alerts (renderRetailerEmail) — a BM store gets the ms variant.
		expect(body.template.language.code).toBe("ms");
		const bodyComponent = body.template.components.find(
			(c) => c.type === "body",
		);
		const params = bodyComponent?.parameters.map((p) => p.text);
		expect(params?.[0]).toBe(shortId);
		expect(params?.[1]).toBe("Ali");
		expect(params?.[2]).toBe("MYR 120.00");
		// createPendingOrder sets no fulfilment date → the non-empty placeholder.
		expect(params?.[3]).toBe("—");
		const button = body.template.components.find((c) => c.type === "button");
		expect(button?.sub_type).toBe("url");
		// The /app deep link rides the shortId (seller is authenticated) — never
		// the buyer's capability token.
		expect(button?.parameters[0]?.text).toBe(shortId);
		fetchMock.restore();
	});

	test("buyer names are whitespace-collapsed before entering template params (Meta rejects newlines/tabs/4+ spaces)", async () => {
		process.env.WHATSAPP_SELLER_NEW_ORDER_TEMPLATE = NEW_ORDER_TEMPLATE;
		const t = setup();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		await enableAlerts(t, retailerId);
		const fetchMock = installFetchMock();
		const shortId = await createPendingOrder(t, retailerId, productId);
		const orderId = await orderIdOf(t, shortId);
		// A name pasted from a spreadsheet/contacts app — interior tab + newline
		// + a run of spaces survive sanitizeCustomerName (it only trims ends).
		await t.run(async (ctx) => {
			const o = await ctx.db.get(orderId);
			await ctx.db.patch(orderId, {
				customer: { ...o!.customer, name: "Ali\tBaba\n    Jr" },
			});
		});
		await t.action(internal.whatsapp.notifySellerNewOrder, { orderId });
		const body = fetchMock.waCalls()[0].body as {
			template: {
				components: Array<{ type: string; parameters: Array<{ text: string }> }>;
			};
		};
		const params = body.template.components
			.find((c) => c.type === "body")
			?.parameters.map((p) => p.text);
		expect(params?.[1]).toBe("Ali Baba Jr");

		// Whitespace-only degenerates to the placeholder, never an empty param
		// (Meta rejects those too).
		await t.run(async (ctx) => {
			const o = await ctx.db.get(orderId);
			await ctx.db.patch(orderId, {
				customer: { ...o!.customer, name: "\t\n " },
			});
		});
		await t.action(internal.whatsapp.notifySellerNewOrder, { orderId });
		const body2 = fetchMock.waCalls()[1].body as {
			template: {
				components: Array<{ type: string; parameters: Array<{ text: string }> }>;
			};
		};
		expect(
			body2.template.components
				.find((c) => c.type === "body")
				?.parameters.map((p) => p.text)?.[1],
		).toBe("Anonymous");
		fetchMock.restore();
	});

	test("an EN store gets the en variant; a zh store rides en until zh templates are approved", async () => {
		process.env.WHATSAPP_SELLER_NEW_ORDER_TEMPLATE = NEW_ORDER_TEMPLATE;
		const t = setup();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		await enableAlerts(t, retailerId);
		const fetchMock = installFetchMock();
		const shortId = await createPendingOrder(t, retailerId, productId);
		const orderId = await orderIdOf(t, shortId);

		await t.action(internal.whatsapp.notifySellerNewOrder, { orderId });
		expect(
			(fetchMock.waCalls()[0].body as { template: { language: { code: string } } })
				.template.language.code,
		).toBe("en");

		// zh: the copy catalog is zh-complete but no zh TEMPLATE is approved, so
		// the send must fall back to en rather than name a language Meta rejects.
		await t.run(async (ctx) => {
			await ctx.db.patch(retailerId, { locale: "zh" });
		});
		await t.action(internal.whatsapp.notifySellerNewOrder, { orderId });
		expect(
			(fetchMock.waCalls()[1].body as { template: { language: { code: string } } })
				.template.language.code,
		).toBe("en");
		fetchMock.restore();
	});

	test("no send when the template env is unset, the toggle is off, or the number is missing", async () => {
		const t = setup();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		await enableAlerts(t, retailerId);
		const fetchMock = installFetchMock();
		const shortId = await createPendingOrder(t, retailerId, productId);
		const orderId = await orderIdOf(t, shortId);

		// Env unset — feature inactive even though the retailer opted in.
		await t.action(internal.whatsapp.notifySellerNewOrder, { orderId });
		expect(fetchMock.waCalls()).toHaveLength(0);

		// Toggle off.
		process.env.WHATSAPP_SELLER_NEW_ORDER_TEMPLATE = NEW_ORDER_TEMPLATE;
		await t.run(async (ctx) => {
			await ctx.db.patch(retailerId, { orderWaAlerts: false });
		});
		await t.action(internal.whatsapp.notifySellerNewOrder, { orderId });
		expect(fetchMock.waCalls()).toHaveLength(0);

		// Toggle on but no number.
		await t.run(async (ctx) => {
			await ctx.db.patch(retailerId, {
				orderWaAlerts: true,
				notifyWaPhone: undefined,
			});
		});
		await t.action(internal.whatsapp.notifySellerNewOrder, { orderId });
		expect(fetchMock.waCalls()).toHaveLength(0);
		fetchMock.restore();
	});

	test("counter orders and cancelled orders never alert", async () => {
		process.env.WHATSAPP_SELLER_NEW_ORDER_TEMPLATE = NEW_ORDER_TEMPLATE;
		const t = setup();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		await enableAlerts(t, retailerId);
		const fetchMock = installFetchMock();
		const shortId = await createPendingOrder(t, retailerId, productId);
		const orderId = await orderIdOf(t, shortId);

		await t.run(async (ctx) => {
			await ctx.db.patch(orderId, { source: "counter" });
		});
		await t.action(internal.whatsapp.notifySellerNewOrder, { orderId });
		expect(fetchMock.waCalls()).toHaveLength(0);

		await t.run(async (ctx) => {
			await ctx.db.patch(orderId, { source: "storefront", status: "cancelled" });
		});
		await t.action(internal.whatsapp.notifySellerNewOrder, { orderId });
		expect(fetchMock.waCalls()).toHaveLength(0);
		fetchMock.restore();
	});

	test("payment-claim alert sends buyer/shortId/total — counter orders INCLUDED (claims land when nobody's at the counter)", async () => {
		process.env.WHATSAPP_SELLER_PAYMENT_CLAIM_TEMPLATE = CLAIM_TEMPLATE;
		const t = setup();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "ms");
		await enableAlerts(t, retailerId);
		const fetchMock = installFetchMock();
		const shortId = await createPendingOrder(t, retailerId, productId);
		const orderId = await orderIdOf(t, shortId);
		// A counter pay-later order still alerts on claim.
		await t.run(async (ctx) => {
			await ctx.db.patch(orderId, { source: "counter" });
		});

		await t.action(internal.whatsapp.notifySellerPaymentClaim, { orderId });

		const wa = fetchMock.waCalls();
		expect(wa).toHaveLength(1);
		const body = wa[0].body as {
			to: string;
			template: {
				name: string;
				language: { code: string };
				components: Array<{ type: string; parameters: Array<{ text: string }> }>;
			};
		};
		expect(body.to).toBe(SELLER_PHONE);
		expect(body.template.name).toBe(CLAIM_TEMPLATE);
		// Both seller alerts localize — not just the new-order one.
		expect(body.template.language.code).toBe("ms");
		const params = body.template.components
			.find((c) => c.type === "body")
			?.parameters.map((p) => p.text);
		expect(params).toEqual(["Ali", shortId, "MYR 120.00"]);
		fetchMock.restore();
	});

	test("payment-received alert is its OWN template — a settled payment must not read like a claim", async () => {
		process.env.WHATSAPP_SELLER_PAYMENT_RECEIVED_TEMPLATE = RECEIVED_TEMPLATE;
		process.env.WHATSAPP_SELLER_PAYMENT_CLAIM_TEMPLATE = CLAIM_TEMPLATE;
		const t = setup();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "ms");
		await enableAlerts(t, retailerId);
		const fetchMock = installFetchMock();
		const shortId = await createPendingOrder(t, retailerId, productId);
		const orderId = await orderIdOf(t, shortId);

		await t.action(internal.whatsapp.notifySellerPaymentReceived, { orderId });

		const wa = fetchMock.waCalls();
		expect(wa).toHaveLength(1);
		const body = wa[0].body as {
			to: string;
			template: {
				name: string;
				language: { code: string };
				components: Array<{ type: string; parameters: Array<{ text: string }> }>;
			};
		};
		expect(body.to).toBe(SELLER_PHONE);
		// The load-bearing assertion: NOT the claim template. A claim asks the
		// seller to go check their bank; a settled HitPay charge already
		// auto-confirmed the order and needs nothing from them.
		expect(body.template.name).toBe(RECEIVED_TEMPLATE);
		expect(body.template.name).not.toBe(CLAIM_TEMPLATE);
		expect(body.template.language.code).toBe("ms");
		// Params match the claim alert's three exactly, so the two stay
		// interchangeable at the call site.
		const params = body.template.components
			.find((c) => c.type === "body")
			?.parameters.map((p) => p.text);
		expect(params).toEqual(["Ali", shortId, "MYR 120.00"]);
		fetchMock.restore();
	});

	test("payment-received alert still fires on a cancelled order — money that moved is the urgent case", async () => {
		// Deliberately unlike the claim alert, which skips cancelled orders. A
		// claim on a dead order is noise; a real payment landing on one needs the
		// seller to go refund it.
		process.env.WHATSAPP_SELLER_PAYMENT_RECEIVED_TEMPLATE = RECEIVED_TEMPLATE;
		const t = setup();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		await enableAlerts(t, retailerId);
		const fetchMock = installFetchMock();
		const shortId = await createPendingOrder(t, retailerId, productId);
		const orderId = await orderIdOf(t, shortId);
		await t.run(async (ctx) => {
			await ctx.db.patch(orderId, { status: "cancelled" });
		});

		await t.action(internal.whatsapp.notifySellerPaymentReceived, { orderId });
		expect(fetchMock.waCalls()).toHaveLength(1);

		// The claim alert, on the same order, stays silent.
		process.env.WHATSAPP_SELLER_PAYMENT_CLAIM_TEMPLATE = CLAIM_TEMPLATE;
		await t.action(internal.whatsapp.notifySellerPaymentClaim, { orderId });
		expect(fetchMock.waCalls()).toHaveLength(1);
		fetchMock.restore();
	});

	test("payment-received: template unset or alerts off sends nothing and forces no email (the email decides for itself)", async () => {
		const t = setup();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		await enableAlerts(t, retailerId);
		const fetchMock = installFetchMock();
		const shortId = await createPendingOrder(t, retailerId, productId);
		const orderId = await orderIdOf(t, shortId);

		// Env unset.
		await t.action(internal.whatsapp.notifySellerPaymentReceived, { orderId });
		expect(fetchMock.waCalls()).toHaveLength(0);

		// Toggle off.
		process.env.WHATSAPP_SELLER_PAYMENT_RECEIVED_TEMPLATE = RECEIVED_TEMPLATE;
		await t.run(async (ctx) => {
			await ctx.db.patch(retailerId, { orderWaAlerts: false });
		});
		await t.action(internal.whatsapp.notifySellerPaymentReceived, { orderId });
		expect(fetchMock.waCalls()).toHaveLength(0);

		// Neither case force-schedules the email: `notifyPaymentReceived` shares
		// the same reach predicate, so it has already decided not to suppress
		// itself. Forcing here would send the seller two.
		const forced = await t.run(async (ctx) =>
			(await ctx.db.system.query("_scheduled_functions").collect()).filter(
				(j) => j.name.includes("notifyPaymentReceived"),
			),
		);
		expect(forced).toHaveLength(0);
		fetchMock.restore();
	});

	test("claimPayment schedules the seller claim alert", async () => {
		const t = setup();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		const shortId = await createPendingOrder(t, retailerId, productId);
		await t.mutation(api.orders.claimPayment, {
			token: await tk(t, shortId),
			reference: "MBB1234",
		});
		const jobs = await t.run((ctx) =>
			ctx.db.system.query("_scheduled_functions").collect(),
		);
		expect(
			jobs.filter((j) => j.name.includes("notifySellerPaymentClaim")),
		).toHaveLength(1);
	});

	test("orders.create schedules the seller new-order alert", async () => {
		const t = setup();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		await createPendingOrder(t, retailerId, productId);
		const jobs = await t.run((ctx) =>
			ctx.db.system.query("_scheduled_functions").collect(),
		);
		expect(
			jobs.filter((j) => j.name.includes("notifySellerNewOrder")),
		).toHaveLength(1);
	});

	test("a STOP'd seller number is suppressed by the gateway — utility_template alerts are gated, never transactional", async () => {
		process.env.WHATSAPP_SELLER_NEW_ORDER_TEMPLATE = NEW_ORDER_TEMPLATE;
		const t = setup();
		const { retailerId, productId } = await seedRetailerWithLocale(t, "en");
		await enableAlerts(t, retailerId);
		await t.run(async (ctx) => {
			await ctx.db.insert("optOuts", {
				waPhone: SELLER_PHONE,
				source: "stop_keyword",
				createdAt: Date.now(),
			});
		});
		const fetchMock = installFetchMock();
		const shortId = await createPendingOrder(t, retailerId, productId);
		const orderId = await orderIdOf(t, shortId);

		await t.action(internal.whatsapp.notifySellerNewOrder, { orderId });

		expect(fetchMock.waCalls()).toHaveLength(0);
		const log = await t.run(async (ctx) =>
			ctx.db.query("outboundMessageLog").collect(),
		);
		const blocked = log.find((row) => row.status === "blocked_optout");
		expect(blocked).toBeDefined();
		expect(blocked?.category).toBe("utility_template");
		expect(blocked?.templateName).toBe(NEW_ORDER_TEMPLATE);
		fetchMock.restore();
	});
});
