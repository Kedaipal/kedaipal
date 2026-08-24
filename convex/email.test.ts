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

const USER = "user_email_test";

type FetchCall = { url: string; body: unknown };

type FetchMockOpts = { failResend?: boolean };

function installFetchMock(opts: FetchMockOpts = {}): {
	calls: FetchCall[];
	resendCalls: () => FetchCall[];
	restore: () => void;
} {
	const calls: FetchCall[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
		const u = String(url);
		const body = init?.body ? JSON.parse(init.body as string) : null;
		calls.push({ url: u, body });
		if (opts.failResend && u.includes("api.resend.com")) {
			return new Response('{"error":"boom"}', { status: 500 });
		}
		return new Response("{}", { status: 200 });
	}) as unknown as typeof fetch;
	return {
		calls,
		resendCalls: () => calls.filter((c) => c.url.includes("api.resend.com")),
		restore: () => {
			globalThis.fetch = original;
		},
	};
}

async function seedRetailerWithEmail(
	t: ReturnType<typeof convexTest>,
	opts: { locale: "en" | "ms"; notifyEmail: string | undefined },
): Promise<{ retailerId: Id<"retailers">; productId: Id<"products"> }> {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Test Outdoor",
		slug: `email-${opts.locale}`,
	});
	const updates: Parameters<typeof asUser.mutation<typeof api.retailers.updateSettings>>[1] = {};
	if (opts.locale !== "en") updates.locale = opts.locale;
	if (opts.notifyEmail !== undefined) updates.notifyEmail = opts.notifyEmail;
	if (Object.keys(updates).length > 0) {
		await asUser.mutation(api.retailers.updateSettings, updates);
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
): Promise<{ shortId: string; orderId: Id<"orders"> }> {
	const { shortId } = await t.mutation(api.orders.create, {
		retailerId,
		items: [{ productId, quantity: 1 }],
		currency: "MYR",
		channel: "whatsapp",
		customer: { name: "Aisha", waPhone: "60123456789" },
		deliveryAddress: {
			line1: "12 Jln Mawar 3",
			city: "Petaling Jaya",
			state: "Selangor",
			postcode: "47301",
		},
	});
	const order = await t.query(api.orders.get, {
		token: await tk(t, shortId),
	});
	if (!order) throw new Error("order not found after create");
	return { shortId, orderId: order._id };
}

beforeEach(() => {
	vi.useFakeTimers();
	process.env.RESEND_API_KEY = "test-resend";
	process.env.EMAIL_FROM = "Kedaipal <orders@kedaipal.test>";
	process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
	process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-id";
	process.env.WHATSAPP_VERIFY_TOKEN = "test-verify";
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("email retailer order alert", () => {
	test("sends newOrder email when status is pending and notifyEmail is set", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithEmail(t, {
			locale: "en",
			notifyEmail: "ops@store.test",
		});
		const { shortId, orderId } = await createPendingOrder(t, retailerId, productId);

		await t.action(internal.email.notifyRetailerOrderAlert, { orderId });

		const sends = fetchMock.resendCalls();
		expect(sends).toHaveLength(1);
		const body = sends[0].body as {
			from: string;
			to: string[];
			subject: string;
			html: string;
			text: string;
		};
		expect(body.to).toEqual(["ops@store.test"]);
		expect(body.from).toContain("Kedaipal");
		expect(body.subject).toContain("New order");
		expect(body.subject).toContain(shortId);
		expect(body.text).toContain(shortId);
		expect(body.html).toContain(shortId);
		fetchMock.restore();
	});

	test("sends orderConfirmed email when order has been confirmed", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithEmail(t, {
			locale: "en",
			notifyEmail: "ops@store.test",
		});
		const { shortId, orderId } = await createPendingOrder(t, retailerId, productId);
		// Flip the order to confirmed without going through the scheduler chain.
		await t.run(async (ctx) => {
			await ctx.db.patch(orderId, { status: "confirmed" });
		});

		await t.action(internal.email.notifyRetailerOrderAlert, { orderId });

		const sends = fetchMock.resendCalls();
		expect(sends).toHaveLength(1);
		const body = sends[0].body as { subject: string };
		expect(body.subject).toContain("confirmed");
		expect(body.subject).toContain(shortId);
		fetchMock.restore();
	});

	test("flags a custom-item order so the seller knows to send a mockup first", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const asUser = t.withIdentity({ subject: USER });
		await asUser.mutation(api.retailers.createRetailer, {
			storeName: "Cake Studio",
			slug: "email-custom",
		});
		await asUser.mutation(api.retailers.updateSettings, {
			notifyEmail: "ops@store.test",
		});
		const retailer = await asUser.query(api.retailers.getMyRetailer);
		if (!retailer) throw new Error("seed failed");
		const productId = await asUser.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Custom Cake",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			requiresProof: true,
			variants: [{ optionValues: [], price: 0, onHand: 0 }],
		});
		const { orderId } = await createPendingOrder(t, retailer._id, productId);

		await t.action(internal.email.notifyRetailerOrderAlert, { orderId });

		const body = fetchMock.resendCalls()[0].body as {
			html: string;
			text: string;
		};
		expect(body.html).toContain("Custom item");
		expect(body.text).toContain("Custom item");
		expect(body.text).toContain("Payment is held");
		fetchMock.restore();
	});

	test("skips silently when notifyEmail is not set", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithEmail(t, {
			locale: "en",
			notifyEmail: undefined,
		});
		const { orderId } = await createPendingOrder(t, retailerId, productId);

		await t.action(internal.email.notifyRetailerOrderAlert, { orderId });

		expect(fetchMock.resendCalls()).toHaveLength(0);
		fetchMock.restore();
	});

	test("uses Bahasa Malaysia subject when retailer locale is ms", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithEmail(t, {
			locale: "ms",
			notifyEmail: "ops@store.test",
		});
		const { orderId } = await createPendingOrder(t, retailerId, productId);

		await t.action(internal.email.notifyRetailerOrderAlert, { orderId });

		const sends = fetchMock.resendCalls();
		expect(sends).toHaveLength(1);
		const body = sends[0].body as { subject: string; text: string };
		expect(body.subject).toContain("Pesanan baru");
		expect(body.text).toContain("Pelanggan");
		fetchMock.restore();
	});

	test("swallows send failures so the action does not throw", async () => {
		const t = setup();
		const fetchMock = installFetchMock({ failResend: true });
		const { retailerId, productId } = await seedRetailerWithEmail(t, {
			locale: "en",
			notifyEmail: "ops@store.test",
		});
		const { orderId } = await createPendingOrder(t, retailerId, productId);

		await expect(
			t.action(internal.email.notifyRetailerOrderAlert, { orderId }),
		).resolves.not.toThrow();

		// Fetch was attempted (failure logged), but no rethrow.
		expect(fetchMock.resendCalls()).toHaveLength(1);
		fetchMock.restore();
	});
});

describe("email payment claimed alert", () => {
	test("sends paymentClaimed email with reference echoed in body", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithEmail(t, {
			locale: "en",
			notifyEmail: "ops@store.test",
		});
		const { shortId, orderId } = await createPendingOrder(
			t,
			retailerId,
			productId,
		);
		await t.mutation(api.orders.claimPayment, {
			token: await tk(t, shortId),
			reference: "TXN-9988",
		});

		await t.action(internal.email.notifyPaymentClaimed, { orderId });

		const sends = fetchMock.resendCalls();
		expect(sends).toHaveLength(1);
		const body = sends[0].body as {
			to: string[];
			subject: string;
			html: string;
			text: string;
		};
		expect(body.to).toEqual(["ops@store.test"]);
		expect(body.subject).toContain("Payment claimed");
		expect(body.subject).toContain(shortId);
		expect(body.text).toContain("TXN-9988");
		expect(body.html).toContain("TXN-9988");
		fetchMock.restore();
	});

	test("paymentClaimed email shows 'not provided' when reference is missing", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithEmail(t, {
			locale: "en",
			notifyEmail: "ops@store.test",
		});
		const { shortId, orderId } = await createPendingOrder(
			t,
			retailerId,
			productId,
		);
		await t.mutation(api.orders.claimPayment, { token: await tk(t, shortId) });

		await t.action(internal.email.notifyPaymentClaimed, { orderId });

		const body = fetchMock.resendCalls()[0].body as {
			text: string;
			html: string;
		};
		expect(body.text).toContain("Reference: not provided");
		expect(body.html).toContain("not provided");
		fetchMock.restore();
	});

	test("paymentClaimed email skips silently when notifyEmail is empty", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithEmail(t, {
			locale: "en",
			notifyEmail: undefined,
		});
		const { shortId, orderId } = await createPendingOrder(
			t,
			retailerId,
			productId,
		);
		await t.mutation(api.orders.claimPayment, { token: await tk(t, shortId) });

		await t.action(internal.email.notifyPaymentClaimed, { orderId });

		expect(fetchMock.resendCalls()).toHaveLength(0);
		fetchMock.restore();
	});

	test("paymentClaimed email uses Bahasa Malaysia subject for ms locale", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithEmail(t, {
			locale: "ms",
			notifyEmail: "ops@store.test",
		});
		const { shortId, orderId } = await createPendingOrder(
			t,
			retailerId,
			productId,
		);
		await t.mutation(api.orders.claimPayment, {
			token: await tk(t, shortId),
			reference: "TXN-9988",
		});

		await t.action(internal.email.notifyPaymentClaimed, { orderId });

		const body = fetchMock.resendCalls()[0].body as {
			subject: string;
			text: string;
		};
		// "Kata dah bayar", not "diterima" — a claim is unverified, and the
		// money-really-landed sibling (paymentReceived) owns "diterima".
		expect(body.subject).toContain("Pelanggan kata dah bayar");
		expect(body.text).toContain("Rujukan: TXN-9988");
		fetchMock.restore();
	});
});

describe("email payment received alert (86eyd63r8)", () => {
	afterEach(() => {
		delete process.env.WHATSAPP_SELLER_PAYMENT_RECEIVED_TEMPLATE;
	});

	/** Give the store a reachable WhatsApp alert number + toggle. */
	async function armWaAlerts(
		t: ReturnType<typeof convexTest>,
		retailerId: Id<"retailers">,
	) {
		await t.run(async (ctx) => {
			await ctx.db.patch(retailerId, {
				orderWaAlerts: true,
				notifyWaPhone: "60198765432",
			});
		});
	}

	test("asks nothing of the seller — no 'check your bank', unlike a claim", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithEmail(t, {
			locale: "en",
			notifyEmail: "ops@store.test",
		});
		const { shortId, orderId } = await createPendingOrder(
			t,
			retailerId,
			productId,
		);
		await t.run(async (ctx) => {
			await ctx.db.patch(orderId, { paymentReference: "hitpay_abc123" });
		});

		await t.action(internal.email.notifyPaymentReceived, {
			orderId,
			provider: "HitPay",
		});

		const sends = fetchMock.resendCalls();
		expect(sends).toHaveLength(1);
		const body = sends[0].body as {
			to: string[];
			subject: string;
			text: string;
		};
		expect(body.to).toEqual(["ops@store.test"]);
		expect(body.subject).toContain("Payment received");
		expect(body.subject).toContain(shortId);
		expect(body.text).toContain("hitpay_abc123");
		expect(body.text).toContain("nothing to check");
		expect(body.text).toContain("HitPay");
		// The claim email's instruction must NOT appear here — we verified this
		// payment ourselves, so sending them to their bank app invents work.
		expect(body.text).not.toContain("Verify in your bank app");
		fetchMock.restore();
	});

	test("names the gateway the caller passed — same value the WhatsApp {{4}} gets", async () => {
		// Email and WhatsApp must never name different accounts for one payment
		// (the cross-channel rule the locale switch already follows), so this is
		// threaded rather than hardcoded on either side.
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithEmail(t, {
			locale: "en",
			notifyEmail: "ops@store.test",
		});
		const { orderId } = await createPendingOrder(t, retailerId, productId);

		await t.action(internal.email.notifyPaymentReceived, {
			orderId,
			provider: "Billplz",
		});

		const body = fetchMock.resendCalls()[0].body as {
			text: string;
			html: string;
		};
		expect(body.text).toContain("Paid online through Billplz");
		expect(body.text).not.toContain("HitPay");
		expect(body.html).not.toContain("HitPay");
		fetchMock.restore();
	});

	test("stays quiet when the WhatsApp alert will reach them, and speaks when forced", async () => {
		process.env.WHATSAPP_SELLER_PAYMENT_RECEIVED_TEMPLATE =
			"seller_payment_received_utility";
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithEmail(t, {
			locale: "en",
			notifyEmail: "ops@store.test",
		});
		const { orderId } = await createPendingOrder(t, retailerId, productId);
		await armWaAlerts(t, retailerId);

		// WhatsApp is the channel for this event — one notification, not two.
		await t.action(internal.email.notifyPaymentReceived, {
			orderId,
			provider: "HitPay",
		});
		expect(fetchMock.resendCalls()).toHaveLength(0);

		// …until that alert gives up and hands back (`force`), so the seller is
		// never left with zero notification.
		await t.action(internal.email.notifyPaymentReceived, {
			orderId,
			provider: "HitPay",
			force: true,
		});
		expect(fetchMock.resendCalls()).toHaveLength(1);
		fetchMock.restore();
	});

	test("speaks on its own when the WhatsApp alert can't reach them", async () => {
		process.env.WHATSAPP_SELLER_PAYMENT_RECEIVED_TEMPLATE =
			"seller_payment_received_utility";
		const t = setup();
		const fetchMock = installFetchMock();
		const { retailerId, productId } = await seedRetailerWithEmail(t, {
			locale: "en",
			notifyEmail: "ops@store.test",
		});
		const { orderId } = await createPendingOrder(t, retailerId, productId);
		// Toggle never turned on → email is the only channel they have.
		await t.action(internal.email.notifyPaymentReceived, {
			orderId,
			provider: "HitPay",
		});
		expect(fetchMock.resendCalls()).toHaveLength(1);
		fetchMock.restore();
	});
});
