/// <reference types="vite/client" />
/**
 * HitPay subscription payments (86eyb6z4r): self-serve invoices, the Pay-now
 * mint, tokenised auto-renewal (attach → charge → dunning → reconcile), the
 * gateway settle's idempotency + founding claim, and both webhook branches.
 * Fetch is always stubbed — no test touches the network; the fake-timer
 * rules follow hitpay.test.ts (timers on BEFORE convexTest when scheduled
 * functions will be flushed).
 */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { computeHitpayHmac } from "./lib/hitpay";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const ADMIN = "user_admin";
const BILLING_KEY = "test_billing_key_123";
const BILLING_SALT = "billing_salt_xyz";

let prevAdminEnv: string | undefined;
beforeAll(() => {
	prevAdminEnv = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
});
afterAll(() => {
	process.env.ADMIN_USER_IDS = prevAdminEnv;
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

function stubBillingEnv() {
	vi.stubEnv("HITPAY_BILLING_API_KEY", BILLING_KEY);
	vi.stubEnv("HITPAY_BILLING_SALT", BILLING_SALT);
}

/** A retailer on the default signup trial, with the notify email set (HitPay
 * needs one for saved-method sessions). */
async function seedRetailer(t: ReturnType<typeof setup>, userId: string, slug: string) {
	const asUser = t.withIdentity({ subject: userId, email: `${userId}@x.com` });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: `Store ${slug}`,
		slug,
	});
	return t.run(async (ctx) => {
		const r = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", slug))
			.first();
		if (!r) throw new Error("no retailer");
		await ctx.db.patch(r._id, { notifyEmail: `${userId}@x.com` });
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", r._id))
			.first();
		if (!sub) throw new Error("no sub");
		return { retailerId: r._id, subId: sub._id };
	});
}

/** Flip the sub to a paid, ACTIVE state with a saved method attached. */
async function attachAutoRenew(
	t: ReturnType<typeof setup>,
	subId: Id<"subscriptions">,
	overrides: Record<string, unknown> = {},
) {
	await t.run(async (ctx) => {
		const now = Date.now();
		await ctx.db.patch(subId, {
			status: "active",
			currentPeriodStart: now - 30 * 86400000,
			currentPeriodEnd: now - 1000,
			autoRenewSessionId: "rb_1",
			autoRenew: {
				provider: "hitpay" as const,
				method: "card",
				methodLabel: "Visa ·· 4242",
				attachedAt: now - 30 * 86400000,
				timesCharged: 0,
				...overrides,
			},
		});
	});
}

/** A machine-issued renewal invoice (the shape the cron writes). */
async function seedRenewalInvoice(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	subId: Id<"subscriptions">,
	overrides: Record<string, unknown> = {},
) {
	return t.run(async (ctx) => {
		const now = Date.now();
		return ctx.db.insert("invoices", {
			retailerId,
			subscriptionId: subId,
			invoiceNumber: "INV-REN-1",
			plan: "pro" as const,
			billingCycle: "monthly" as const,
			amount: 14900,
			total: 14900,
			currency: "MYR",
			periodStart: now,
			periodEnd: now + 30 * 86400000,
			dueDate: now + 14 * 86400000,
			status: "pending" as const,
			origin: "auto_renewal" as const,
			createdAt: now,
			...overrides,
		});
	});
}

const getInvoice = (t: ReturnType<typeof setup>, id: Id<"invoices">) =>
	t.run(async (ctx) => ctx.db.get(id));
const getSub = (t: ReturnType<typeof setup>, id: Id<"subscriptions">) =>
	t.run(async (ctx) => ctx.db.get(id));

// ---------------------------------------------------------------------------

describe("billingGatewayAvailable", () => {
	test("off without env credentials, on with them (methods per currency)", async () => {
		const t = setup();
		await seedRetailer(t, "u_cap", "cap-store");
		const asUser = t.withIdentity({ subject: "u_cap" });

		const off = await asUser.query(api.subscriptionPayments.billingGatewayAvailable, {});
		expect(off).toMatchObject({ payNow: false, autoRenew: false });

		stubBillingEnv();
		const on = await asUser.query(api.subscriptionPayments.billingGatewayAvailable, {});
		expect(on).toMatchObject({
			payNow: true,
			autoRenew: true,
			currency: "MYR",
			methods: ["card", "touch_n_go"],
		});
	});
});

describe("subscribeSelf", () => {
	test("creates the pending invoice at list price (origin self_serve)", async () => {
		const t = setup();
		const { retailerId } = await seedRetailer(t, "u_self", "self-store");
		const { invoiceId } = await t
			.withIdentity({ subject: "u_self" })
			.mutation(api.invoices.subscribeSelf, {
				plan: "pro",
				billingCycle: "monthly",
			});
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice).toMatchObject({
			retailerId,
			status: "pending",
			origin: "self_serve",
			plan: "pro",
			total: 14900,
			currency: "MYR",
		});
		expect(invoice?.foundingDiscount).toBeUndefined();
	});

	test("annual bills 10 months' price; founding intent keeps the promised 30%", async () => {
		const t = setup();
		const { subId } = await seedRetailer(t, "u_ann", "ann-store");
		await t.run(async (ctx) => ctx.db.patch(subId, { foundingIntent: true }));
		const { invoiceId } = await t
			.withIdentity({ subject: "u_ann" })
			.mutation(api.invoices.subscribeSelf, {
				plan: "pro",
				billingCycle: "annual",
			});
		const invoice = await getInvoice(t, invoiceId);
		// Founding Pro monthly 10400 × 10 months.
		expect(invoice?.total).toBe(104000);
		expect(invoice?.foundingDiscount).toBe(45000);
	});

	test("a founding member lapsed >3 months bills at LIST price — and is told why (86eyb6z4r follow-up)", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_flap", "flap-store");
		// A claimed founding member (rank stamped, intent never cleared) whose
		// paid period ended 4 months ago.
		await t.run(async (ctx) => {
			await ctx.db.patch(retailerId, {
				isFoundingMember: true,
				foundingMemberRank: 3,
			});
			await ctx.db.patch(subId, {
				status: "past_due" as const,
				foundingIntent: true,
				currentPeriodEnd: Date.now() - 120 * 86400000,
			});
		});
		const asUser = t.withIdentity({ subject: "u_flap" });
		// The picker's server-resolved flags say: no founding price, and here's why.
		const gateway = await asUser.query(
			api.subscriptionPayments.billingGatewayAvailable,
			{},
		);
		expect(gateway).toMatchObject({
			foundingPricing: false,
			foundingPricingLapsed: true,
		});
		const { invoiceId } = await asUser.mutation(api.invoices.subscribeSelf, {
			plan: "pro",
			billingCycle: "monthly",
		});
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.total).toBe(14900); // list, not 10400
		expect(invoice?.foundingDiscount).toBeUndefined();
	});

	test("a founding member inside the 3-month window still renews at the founding price", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_fok", "fok-store");
		await t.run(async (ctx) => {
			await ctx.db.patch(retailerId, {
				isFoundingMember: true,
				foundingMemberRank: 4,
			});
			await ctx.db.patch(subId, {
				status: "past_due" as const,
				foundingIntent: true,
				currentPeriodEnd: Date.now() - 30 * 86400000,
			});
		});
		const asUser = t.withIdentity({ subject: "u_fok" });
		const gateway = await asUser.query(
			api.subscriptionPayments.billingGatewayAvailable,
			{},
		);
		expect(gateway).toMatchObject({
			foundingPricing: true,
			foundingPricingLapsed: false,
		});
		const { invoiceId } = await asUser.mutation(api.invoices.subscribeSelf, {
			plan: "pro",
			billingCycle: "monthly",
		});
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.total).toBe(10400);
		expect(invoice?.foundingDiscount).toBe(4500);
	});

	test("refuses a second pending invoice, comped accounts, and active subs", async () => {
		const t = setup();
		const { subId } = await seedRetailer(t, "u_guard", "guard-store");
		const asUser = t.withIdentity({ subject: "u_guard" });
		await asUser.mutation(api.invoices.subscribeSelf, {
			plan: "starter",
			billingCycle: "monthly",
		});
		await expect(
			asUser.mutation(api.invoices.subscribeSelf, {
				plan: "pro",
				billingCycle: "monthly",
			}),
		).rejects.toThrow(/already have a pending invoice/);

		await t.run(async (ctx) => {
			const pending = await ctx.db
				.query("invoices")
				.withIndex("by_status", (q) => q.eq("status", "pending"))
				.first();
			if (pending) await ctx.db.patch(pending._id, { status: "void" as const });
			await ctx.db.patch(subId, { comped: true });
		});
		await expect(
			asUser.mutation(api.invoices.subscribeSelf, {
				plan: "pro",
				billingCycle: "monthly",
			}),
		).rejects.toThrow(/on the house/);

		await t.run(async (ctx) =>
			ctx.db.patch(subId, { comped: false, status: "active" as const }),
		);
		await expect(
			asUser.mutation(api.invoices.subscribeSelf, {
				plan: "pro",
				billingCycle: "monthly",
			}),
		).rejects.toThrow(/already on an active plan/);
	});
});

describe("mintInvoicePaymentRequest", () => {
	test("stores the request id + url; second run is a no-op; no env → no fetch", async () => {
		const t = setup();
		const { retailerId, subId } = await seedRetailer(t, "u_mint", "mint-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);

		const fetchMock = vi.fn(async () =>
			Response.json({ id: "req_inv_1", url: "https://pay.example/req_inv_1" }),
		);
		vi.stubGlobal("fetch", fetchMock);

		// No credentials → nothing happens, nothing fetched.
		await t.action(internal.subscriptionPayments.mintInvoicePaymentRequest, {
			invoiceId,
		});
		expect(fetchMock).not.toHaveBeenCalled();

		stubBillingEnv();
		await t.action(internal.subscriptionPayments.mintInvoicePaymentRequest, {
			invoiceId,
		});
		const minted = await getInvoice(t, invoiceId);
		expect(minted?.gatewayRequestId).toBe("req_inv_1");
		expect(minted?.gatewayPayment).toEqual({
			provider: "hitpay",
			url: "https://pay.example/req_inv_1",
		});

		// Idempotent — the stored request is kept, no second mint.
		await t.action(internal.subscriptionPayments.mintInvoicePaymentRequest, {
			invoiceId,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test("a failed mint leaves the invoice on the manual rail (never blocks)", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_mfail", "mfail-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("nope", { status: 500 })),
		);
		await t.action(internal.subscriptionPayments.mintInvoicePaymentRequest, {
			invoiceId,
		});
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.status).toBe("pending");
		expect(invoice?.gatewayRequestId).toBeUndefined();
	});
});

describe("startAutoRenewSetup", () => {
	test("mints a save-payment-method session and stores it on the sub", async () => {
		const t = setup();
		stubBillingEnv();
		const { subId } = await seedRetailer(t, "u_setup", "setup-store");
		const fetchMock = vi.fn(async (_url: unknown, _init?: { body?: unknown }) =>
			Response.json({ id: "rb_new", url: "https://auth.example/rb_new" }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const { url } = await t
			.withIdentity({ subject: "u_setup", email: "u_setup@x.com" })
			.action(api.subscriptionPayments.startAutoRenewSetup, {});
		expect(url).toBe("https://auth.example/rb_new");
		const sub = await getSub(t, subId);
		expect(sub?.autoRenewSessionId).toBe("rb_new");
		expect(sub?.autoRenewSetup?.url).toBe("https://auth.example/rb_new");

		const body = String(fetchMock.mock.calls[0]?.[1]?.body ?? "");
		expect(body).toContain("save_payment_method=true");
		expect(body).toContain("times_to_be_charged=100");

		// A fresh unfinished session is RESUMED, not re-minted.
		const again = await t
			.withIdentity({ subject: "u_setup", email: "u_setup@x.com" })
			.action(api.subscriptionPayments.startAutoRenewSetup, {});
		expect(again.url).toBe("https://auth.example/rb_new");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test("degrades to card-only when the full method list is rejected (422)", async () => {
		const t = setup();
		stubBillingEnv();
		await seedRetailer(t, "u_422", "s422-store");
		const fetchMock = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
			const body = String(init?.body ?? "");
			if (body.includes("touch_n_go")) {
				return new Response(JSON.stringify({ message: "method not enabled" }), {
					status: 422,
				});
			}
			return Response.json({ id: "rb_card", url: "https://auth.example/rb_card" });
		});
		vi.stubGlobal("fetch", fetchMock);
		const { url } = await t
			.withIdentity({ subject: "u_422", email: "u_422@x.com" })
			.action(api.subscriptionPayments.startAutoRenewSetup, {});
		expect(url).toBe("https://auth.example/rb_card");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	test("without gateway credentials the action refuses with seller-facing copy", async () => {
		const t = setup();
		await seedRetailer(t, "u_nocreds", "nocreds-store");
		await expect(
			t
				.withIdentity({ subject: "u_nocreds", email: "u_nocreds@x.com" })
				.action(api.subscriptionPayments.startAutoRenewSetup, {}),
		).rejects.toThrow(/isn't available right now/);
	});
});

describe("chargeDueRenewal", () => {
	test("success: settles through the markPaid path + advances the counters", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_chg", "chg-store");
		await attachAutoRenew(t, subId);
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					payment_id: "pay_ok_1",
					recurring_billing_id: "rb_1",
					amount: 149,
					currency: "myr",
					status: "succeeded",
				}),
			),
		);

		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });

		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.status).toBe("paid");
		expect(invoice?.paymentMethod).toBe("hitpay_card");
		expect(invoice?.markedPaidBy).toBe("pay_ok_1");

		const sub = await getSub(t, subId);
		expect(sub?.status).toBe("active");
		expect(sub?.currentPeriodEnd).toBeGreaterThan(Date.now());
		expect(sub?.autoRenew?.timesCharged).toBe(1);
		expect(sub?.autoRenew?.lastChargeAt).toBeTypeOf("number");
		expect(sub?.autoRenew?.failedAttempts).toBeUndefined();
		expect(sub?.autoRenew?.pendingChargeInvoiceId).toBeUndefined();
	});

	test("decline: invoice stays pending, dunning state set, retry scheduled", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_dec", "dec-store");
		await attachAutoRenew(t, subId);
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({ payment_id: "pay_x", status: "failed" }),
			),
		);

		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });

		expect((await getInvoice(t, invoiceId))?.status).toBe("pending");
		const sub = await getSub(t, subId);
		expect(sub?.autoRenew?.failedAttempts).toBe(1);
		expect(sub?.autoRenew?.nextRetryAt).toBe(Date.now() + 2 * 86400000);
		expect(sub?.autoRenew?.lastChargeError).toContain("failed");
		// The sub is NOT locked by a decline — grace runs on the invoice dueDate.
		expect(sub?.status).toBe("active");
	});

	test("third decline exhausts dunning: no further retry is scheduled", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_exh", "exh-store");
		await attachAutoRenew(t, subId, { failedAttempts: 2 });
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("card declined", { status: 402 })),
		);
		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });
		const sub = await getSub(t, subId);
		expect(sub?.autoRenew?.failedAttempts).toBe(3);
		expect(sub?.autoRenew?.nextRetryAt).toBeUndefined();
	});

	test("network failure = outcome unknown: attempt NOT counted, reconcile-retry queued", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_net", "net-store");
		await attachAutoRenew(t, subId);
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("socket hang up");
			}),
		);
		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });
		const sub = await getSub(t, subId);
		expect(sub?.autoRenew?.failedAttempts).toBeUndefined();
		expect(sub?.autoRenew?.nextRetryAt).toBe(Date.now() + 86400000);
		// The attempt stamp survives so the next run reconciles first.
		expect(sub?.autoRenew?.lastChargeAttemptAt).toBeTypeOf("number");
		expect(sub?.autoRenew?.pendingChargeInvoiceId).toBe(invoiceId);
	});

	test("outcome-unknown reconcile: HitPay already took the money → settle, never re-charge", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_rec", "rec-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		await attachAutoRenew(t, subId, {
			lastChargeAttemptAt: Date.now() - 60_000,
			pendingChargeInvoiceId: invoiceId,
			timesCharged: 0,
		});
		const fetchMock = vi.fn(async (url: unknown) => {
			// Only the session GET is allowed; a POST /charge here would be the bug.
			expect(String(url)).not.toContain("/charge/");
			return Response.json({ status: "active", times_charged: 1 });
		});
		vi.stubGlobal("fetch", fetchMock);

		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.status).toBe("paid");
		expect(invoice?.markedPaidBy).toBe("reconciled:rb_1:1");
	});

	test("no-ops when the invoice settled meanwhile or auto-renew was turned off", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_noop", "noop-store");
		await attachAutoRenew(t, subId);
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId, {
			status: "paid" as const,
		});
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await t.action(internal.subscriptionPayments.chargeDueRenewal, { invoiceId });
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe("internalSettleFromGateway", () => {
	test("duplicate payment id no-ops; a different late payment stamps the audit", async () => {
		const t = setup();
		const { retailerId, subId } = await seedRetailer(t, "u_dup", "dup-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);

		const first = await t.mutation(internal.invoices.internalSettleFromGateway, {
			invoiceId,
			paymentId: "pay_1",
			amountSen: 14900,
			currency: "MYR",
			methodCode: "card",
		});
		expect(first.applied).toBe(true);

		const dupe = await t.mutation(internal.invoices.internalSettleFromGateway, {
			invoiceId,
			paymentId: "pay_1",
			amountSen: 14900,
			currency: "MYR",
		});
		expect(dupe).toEqual({ applied: false, reason: "duplicate" });
		expect((await getInvoice(t, invoiceId))?.gatewayIssue).toBeUndefined();

		const late = await t.mutation(internal.invoices.internalSettleFromGateway, {
			invoiceId,
			paymentId: "pay_2_other",
			amountSen: 14900,
			currency: "MYR",
		});
		expect(late).toEqual({ applied: false, reason: "late_payment" });
		expect((await getInvoice(t, invoiceId))?.gatewayIssue?.kind).toBe(
			"late_payment",
		);
	});

	test("amount/currency mismatch stamps the issue and settles NOTHING", async () => {
		const t = setup();
		const { retailerId, subId } = await seedRetailer(t, "u_mis", "mis-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);
		const result = await t.mutation(internal.invoices.internalSettleFromGateway, {
			invoiceId,
			paymentId: "pay_wrong",
			amountSen: 9900,
			currency: "MYR",
		});
		expect(result).toEqual({ applied: false, reason: "amount_mismatch" });
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.status).toBe("pending");
		expect(invoice?.gatewayIssue).toMatchObject({
			kind: "amount_mismatch",
			paymentId: "pay_wrong",
			amountSen: 9900,
		});
	});

	test("a founding invoice settled via the gateway claims the rank — no fork", async () => {
		const t = setup();
		const { retailerId, subId } = await seedRetailer(t, "u_rank", "rank-store");
		await t.run(async (ctx) => ctx.db.patch(subId, { foundingIntent: true }));
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId, {
			origin: "self_serve" as const,
			foundingDiscount: 4500,
			total: 10400,
		});
		const result = await t.mutation(internal.invoices.internalSettleFromGateway, {
			invoiceId,
			paymentId: "pay_f1",
			amountSen: 10400,
			currency: "MYR",
			methodCode: "touch_n_go",
		});
		expect(result.applied).toBe(true);
		const founding = await t.run(async (ctx) =>
			ctx.db
				.query("foundingMembers")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first(),
		);
		expect(founding?.rank).toBe(1);
		expect(founding?.paidAt).toBeTypeOf("number");
		const retailer = await t.run(async (ctx) => ctx.db.get(retailerId));
		expect(retailer?.isFoundingMember).toBe(true);
		expect((await getInvoice(t, invoiceId))?.paymentMethod).toBe(
			"hitpay_touch_n_go",
		);
	});
});

describe("POST /webhook/hitpay — V2 event branch (Kedaipal's account)", () => {
	async function signEvent(body: string): Promise<string> {
		const encoder = new TextEncoder();
		const key = await crypto.subtle.importKey(
			"raw",
			encoder.encode(BILLING_SALT),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
		const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
		return [...new Uint8Array(sig)]
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	}

	test("charge.created settles the pending renewal (webhook-only path)", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_ev", "ev-store");
		await attachAutoRenew(t, subId);
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId);

		const body = JSON.stringify({
			id: "pay_ev_1",
			channel: "recurrent",
			status: "succeeded",
			amount: 149,
			currency: "myr",
			recurring_billing_id: "rb_1",
			payment_provider: { charge: { method: "card" } },
		});
		const res = await t.fetch("/webhook/hitpay", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Hitpay-Signature": await signEvent(body),
				"Hitpay-Event-Object": "charge",
				"Hitpay-Event-Type": "created",
			},
			body,
		});
		expect(res.status).toBe(200);
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.status).toBe("paid");
		expect(invoice?.markedPaidBy).toBe("pay_ev_1");
	});

	test("method_attached arms the sub; forged signatures 401; missing salt 500", async () => {
		const t = setup();
		stubBillingEnv();
		const { subId } = await seedRetailer(t, "u_att", "att-store");
		await t.run(async (ctx) =>
			ctx.db.patch(subId, {
				autoRenewSessionId: "rb_att",
				autoRenewSetup: { url: "https://auth.example/rb_att", createdAt: Date.now() },
			}),
		);
		const body = JSON.stringify({
			id: "rb_att",
			cycle: "save_card",
			status: "active",
			payment_method: "touch_n_go",
		});
		const ok = await t.fetch("/webhook/hitpay", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Hitpay-Signature": await signEvent(body),
				"Hitpay-Event-Object": "recurring_billing",
				"Hitpay-Event-Type": "method_attached",
			},
			body,
		});
		expect(ok.status).toBe(200);
		const sub = await getSub(t, subId);
		expect(sub?.autoRenew?.method).toBe("touch_n_go");
		expect(sub?.autoRenewSetup).toBeUndefined();

		const forged = await t.fetch("/webhook/hitpay", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Hitpay-Signature": "deadbeef",
			},
			body,
		});
		expect(forged.status).toBe(401);

		vi.unstubAllEnvs();
		const noSalt = await t.fetch("/webhook/hitpay", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Hitpay-Signature": await signEvent(body),
			},
			body,
		});
		expect(noSalt.status).toBe(500);
	});
});

describe("POST /webhook/hitpay — v1 invoice completion branch", () => {
	async function signedForm(fields: Record<string, string>): Promise<string> {
		const hmac = await computeHitpayHmac(fields, BILLING_SALT);
		return new URLSearchParams({ ...fields, hmac }).toString();
	}

	test("a completed Pay-now callback settles the invoice with the ENV salt", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_v1", "v1-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId, {
			gatewayRequestId: "req_v1_1",
			gatewayPayment: { provider: "hitpay" as const, url: "https://pay.example/x" },
		});
		const res = await t.fetch("/webhook/hitpay", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: await signedForm({
				payment_id: "pay_v1_1",
				payment_request_id: "req_v1_1",
				amount: "149.00",
				currency: "MYR",
				status: "completed",
				reference_number: "INV-REN-1",
			}),
		});
		expect(res.status).toBe(200);
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.status).toBe("paid");
		expect(invoice?.gatewayPayment?.paymentId).toBe("pay_v1_1");
	});

	test("a bad hmac on an invoice callback is rejected 401", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_v1b", "v1b-store");
		await seedRenewalInvoice(t, retailerId, subId, {
			gatewayRequestId: "req_v1_2",
		});
		const fields = {
			payment_id: "pay_v1_2",
			payment_request_id: "req_v1_2",
			amount: "149.00",
			currency: "MYR",
			status: "completed",
			hmac: "0000",
		};
		const res = await t.fetch("/webhook/hitpay", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams(fields).toString(),
		});
		expect(res.status).toBe(401);
	});
});

describe("cancelAutoRenew", () => {
	test("always clears local state — no autoRenew ⇒ structurally nothing can charge", async () => {
		const t = setup();
		const { subId } = await seedRetailer(t, "u_off", "off-store");
		await attachAutoRenew(t, subId);
		const res = await t
			.withIdentity({ subject: "u_off" })
			.mutation(api.subscriptionPayments.cancelAutoRenew, {});
		expect(res).toEqual({ ok: true });
		const sub = await getSub(t, subId);
		expect(sub?.autoRenew).toBeUndefined();
		expect(sub?.autoRenewSessionId).toBeUndefined();
		expect(sub?.autoRenewSetup).toBeUndefined();
	});
});

describe("verifyInvoicePayment (redirect-return reconcile)", () => {
	test("finds the succeeded payment on the request and settles idempotently", async () => {
		const t = setup();
		stubBillingEnv();
		const { retailerId, subId } = await seedRetailer(t, "u_ver", "ver-store");
		const invoiceId = await seedRenewalInvoice(t, retailerId, subId, {
			gatewayRequestId: "req_ver_1",
			gatewayPayment: { provider: "hitpay" as const, url: "https://pay.example/v" },
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					id: "req_ver_1",
					status: "completed",
					payments: [
						{
							id: "pay_ver_1",
							status: "succeeded",
							amount: "149.00",
							currency: "MYR",
							payment_type: "touch_n_go",
						},
					],
				}),
			),
		);
		const result = await t
			.withIdentity({ subject: "u_ver" })
			.action(api.subscriptionPayments.verifyInvoicePayment, {});
		expect(result.settled).toBe(true);
		const invoice = await getInvoice(t, invoiceId);
		expect(invoice?.status).toBe("paid");
		expect(invoice?.paymentMethod).toBe("hitpay_touch_n_go");
	});
});
