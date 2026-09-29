/// <reference types="vite/client" />
// Kedaipal Credits T2 (z8r3fdf8ht, docs/credits.md#top-up-packs-t2): top-up
// packs on Kedaipal's own HitPay account — opening a checkout (currency,
// eligibility, permissions, act-as, credentials), settling it EXACTLY once
// (webhook, duplicates, wrong amount / currency, late payment), the 24h
// expiry and its last look at HitPay, the return reconcile, receipts, GA4 and
// the account-deletion cascade. Fetch is always stubbed — a fake HitPay that
// routes by method + path; no test touches the network.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { debitCreditForOrder } from "./credits";
import { CREDIT_PURCHASE_TTL_MS } from "./lib/creditPurchases";
import { computeHitpayHmac } from "./lib/hitpay";
import { addMonthsMyt } from "./lib/usagePeriod";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}
type T = ReturnType<typeof setup>;

const OWNER = "user_topup_owner";
const MEMBER = "user_topup_member";
const ADMIN = "user_topup_admin";
const BILLING_KEY = "test_billing_key_123";
const BILLING_SALT = "billing_salt_xyz";
const DAY = 24 * 60 * 60 * 1000;
/** Noon MYT on 10 Oct 2026 — mid-month, far from any credit period boundary. */
const OCT_10 = Date.parse("2026-10-10T12:00:00+08:00");

beforeEach(() => {
	// Fake timers BEFORE the convexTest instance (scheduled actions that run
	// queries crash otherwise — the whatsapp.test.ts gotcha).
	vi.useFakeTimers();
	vi.setSystemTime(OCT_10);
	vi.stubEnv("ADMIN_USER_IDS", ADMIN);
	vi.stubEnv("HITPAY_BILLING_API_KEY", BILLING_KEY);
	vi.stubEnv("HITPAY_BILLING_SALT", BILLING_SALT);
	vi.stubEnv("CONVEX_SITE_URL", "https://site.example");
	vi.stubEnv("SITE_URL", "https://app.example");
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// A fake HitPay (and a sink for everything else that fetches)
// ---------------------------------------------------------------------------

type HitpayPayment = {
	id: string;
	status: string;
	amount: string;
	currency: string;
	payment_type?: string;
};

type FetchCall = { url: string; method: string; body: string };

function installFetch(opts: { failCreate?: boolean; failLookup?: boolean } = {}) {
	const state = {
		calls: [] as FetchCall[],
		/** Payments HitPay reports per request id (the status API). */
		payments: new Map<string, HitpayPayment[]>(),
		failLookup: opts.failLookup === true,
		seq: 0,
	};
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: unknown, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? "GET";
			const body = typeof init?.body === "string" ? init.body : "";
			state.calls.push({ url, method, body });
			if (url.endsWith("/payment-requests") && method === "POST") {
				if (opts.failCreate) return new Response("nope", { status: 500 });
				state.seq += 1;
				const id = `req_topup_${state.seq}`;
				return Response.json({ id, url: `https://pay.example/${id}` });
			}
			const match = /\/payment-requests\/([^/?]+)$/.exec(url);
			if (match && method === "GET") {
				if (state.failLookup) return new Response("down", { status: 503 });
				return Response.json({
					id: match[1],
					payments: state.payments.get(match[1]) ?? [],
				});
			}
			if (match && method === "DELETE") return Response.json({});
			// Resend, GA4 — whatever else fetches.
			return new Response("{}", { status: 200 });
		}),
	);
	return state;
}

const hitpayCalls = (state: { calls: FetchCall[] }, method: string) =>
	state.calls.filter(
		(c) => c.url.includes("hit-pay.com") && c.method === method,
	);

/** Run every job due within a millisecond, and whatever those schedule —
 * never jumping to the far-future ones (a 24h expiry). */
const flushSoon = (t: T) =>
	t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function makeStore(
	t: T,
	opts: {
		userId?: string;
		status?: Doc<"subscriptions">["status"];
		comped?: boolean;
		plan?: Doc<"subscriptions">["plan"];
		country?: "MY" | "SG";
		lastPaidCurrency?: "MYR" | "SGD";
		pendingInvoice?: string;
	} = {},
) {
	const userId = opts.userId ?? OWNER;
	const slug = `tu-${userId.replace(/[^a-z0-9]/g, "")}`;
	await t
		.withIdentity({ subject: userId })
		.mutation(api.retailers.createRetailer, { storeName: `Store ${slug}`, slug });
	return t.run(async (ctx) => {
		const r = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", slug))
			.first();
		const sub = r
			? await ctx.db
					.query("subscriptions")
					.withIndex("by_retailer", (q) => q.eq("retailerId", r._id))
					.first()
			: null;
		if (!r || !sub) throw new Error("seed failed");
		const now = Date.now();
		await ctx.db.patch(r._id, {
			notifyEmail: `${userId}@store.example`,
			country: opts.country ?? "MY",
		});
		await ctx.db.patch(sub._id, {
			status: opts.status ?? "active",
			plan: opts.plan ?? "pro",
			comped: opts.comped,
			currentPeriodStart: now - 5 * DAY,
			currentPeriodEnd: now + 25 * DAY,
		});
		const invoice = (status: "paid" | "pending", number: string, currency: string) =>
			ctx.db.insert("invoices", {
				retailerId: r._id,
				subscriptionId: sub._id,
				invoiceNumber: number,
				plan: "pro" as const,
				billingCycle: "monthly" as const,
				amount: 14900,
				total: 14900,
				currency,
				periodStart: now - 5 * DAY,
				periodEnd: now + 25 * DAY,
				dueDate: now - DAY,
				status,
				...(status === "paid" ? { markedPaidAt: now - 5 * DAY } : {}),
				createdAt: now - 6 * DAY,
			});
		if (opts.lastPaidCurrency)
			await invoice("paid", "INV-PAID-1", opts.lastPaidCurrency);
		if (opts.pendingInvoice)
			await invoice("pending", opts.pendingInvoice, "MYR");
		return { retailerId: r._id, subId: sub._id };
	});
}

async function addMember(
	t: T,
	retailerId: Id<"retailers">,
	credits: "read" | "write" | undefined,
	userId = MEMBER,
) {
	await t.run((ctx) =>
		ctx.db.insert("retailerMembers", {
			retailerId,
			userId,
			email: `${userId}@team.example`,
			displayName: "Aisyah",
			status: "active",
			permissions: credits ? { credits } : { orders: "write" },
			invitedBy: OWNER,
			invitedAt: Date.now(),
			acceptedAt: Date.now(),
		}),
	);
}

const as = (t: T, userId: string) =>
	t.withIdentity({ subject: userId, email: `${userId}@identity.example` });

const buy = (
	t: T,
	userId: string,
	packId = "p50",
	retailerId?: Id<"retailers">,
) =>
	as(t, userId).action(api.creditPurchases.createTopUp, {
		packId,
		...(retailerId ? { retailerId } : {}),
	});

const getPurchase = (t: T, id: Id<"creditPurchases">) =>
	t.run((ctx) => ctx.db.get(id));

const lotsOf = (t: T, retailerId: Id<"retailers">) =>
	t.run((ctx) =>
		ctx.db
			.query("creditLots")
			.withIndex("by_retailer_open_expiry", (q) => q.eq("retailerId", retailerId))
			.collect(),
	);

const purchaseLedger = (t: T, retailerId: Id<"retailers">) =>
	t.run(async (ctx) =>
		(
			await ctx.db
				.query("creditLedger")
				.withIndex("by_retailer_created", (q) => q.eq("retailerId", retailerId))
				.collect()
		).filter((r) => r.type === "purchase"),
	);

const purchasedBalance = async (t: T, retailerId: Id<"retailers">) =>
	(
		await t.run((ctx) =>
			ctx.db
				.query("creditAccounts")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first(),
		)
	)?.purchasedBalance ?? 0;

/** Deliver a signed v1 completion callback, the way HitPay does. */
async function webhook(
	t: T,
	fields: {
		requestId: string;
		paymentId: string;
		amount: string;
		currency: string;
		status?: string;
	},
	salt = BILLING_SALT,
) {
	const form: Record<string, string> = {
		payment_id: fields.paymentId,
		payment_request_id: fields.requestId,
		amount: fields.amount,
		currency: fields.currency,
		status: fields.status ?? "completed",
		reference_number: "CRD-IGNORED",
	};
	const hmac = await computeHitpayHmac(form, salt);
	return t.fetch("/webhook/hitpay", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ ...form, hmac }).toString(),
	});
}

/** A purchase opened AND paid through the webhook. */
async function buyAndPay(
	t: T,
	fetchState: ReturnType<typeof installFetch>,
	userId = OWNER,
	packId = "p50",
) {
	const { purchaseId } = await buy(t, userId, packId);
	const purchase = await getPurchase(t, purchaseId);
	if (!purchase?.gatewayRequestId) throw new Error("no request");
	const paymentId = `pay_${purchase.gatewayRequestId}`;
	const amount = (purchase.amountMinor / 100).toFixed(2);
	fetchState.payments.set(purchase.gatewayRequestId, [
		{
			id: paymentId,
			status: "succeeded",
			amount,
			currency: purchase.currency,
			payment_type: "touch_n_go",
		},
	]);
	const res = await webhook(t, {
		requestId: purchase.gatewayRequestId,
		paymentId,
		amount,
		currency: purchase.currency,
	});
	expect(res.status).toBe(200);
	return { purchaseId, requestId: purchase.gatewayRequestId, paymentId, amount };
}

// ---------------------------------------------------------------------------
// Opening a checkout
// ---------------------------------------------------------------------------

describe("createTopUp — opening a checkout", () => {
	test("an active store's owner opens a pending purchase and gets HitPay's checkout URL", async () => {
		const t = setup();
		const fetchState = installFetch();
		const { retailerId } = await makeStore(t);

		const { url, purchaseId } = await buy(t, OWNER);
		expect(url).toBe("https://pay.example/req_topup_1");

		const purchase = await getPurchase(t, purchaseId);
		expect(purchase).toMatchObject({
			retailerId,
			packId: "p50",
			credits: 50,
			amountMinor: 4500,
			currency: "MYR",
			status: "pending",
			source: "manual",
			createdBy: OWNER,
			gatewayRequestId: "req_topup_1",
			gatewayPayment: { url: "https://pay.example/req_topup_1" },
		});
		expect(purchase?.purchaseNumber).toMatch(/^CRD-202610-[A-Z0-9]{4}$/);

		// Kedaipal's own account (the env key, sandbox host) — never a seller's.
		const [post] = hitpayCalls(fetchState, "POST");
		expect(post.url).toBe("https://api.sandbox.hit-pay.com/v1/payment-requests");
		const body = new URLSearchParams(post.body);
		expect(body.get("amount")).toBe("45.00");
		expect(body.get("currency")).toBe("MYR");
		expect(body.get("expires_after")).toBe("1440 mins");
		expect(body.get("reference_number")).toBe(purchase?.purchaseNumber);
		expect(body.get("redirect_url")).toBe(
			"https://app.example/app/settings?tab=billing&topup=return",
		);
		expect(body.get("webhook")).toBe("https://site.example/webhook/hitpay");
		expect(body.get("email")).toBe(`${OWNER}@store.example`);
		expect(body.get("send_sms")).toBe("false");
		expect(body.get("purpose")).toContain("50-credit pack");

		// Nothing lands until the money does.
		expect(await purchasedBalance(t, retailerId)).toBe(0);
		expect(await lotsOf(t, retailerId)).toHaveLength(0);
	});

	test("an SGD store only ever gets SGD packs, and a MYR pack id is refused", async () => {
		const t = setup();
		installFetch();
		await makeStore(t, { country: "SG" });

		const options = await as(t, OWNER).query(api.creditPurchases.topUpOptions, {});
		expect(options?.currency).toBe("SGD");
		expect(options?.packs.map((p) => p.id)).toEqual(["p50sg", "p200sg"]);
		expect(options?.packs.every((p) => p.currency === "SGD")).toBe(true);

		await expect(buy(t, OWNER, "p50")).rejects.toThrow(/different currency/);
		const { purchaseId } = await buy(t, OWNER, "p50sg");
		expect(await getPurchase(t, purchaseId)).toMatchObject({
			currency: "SGD",
			amountMinor: 2200,
		});
	});

	test("the pack currency follows the BILLING currency — the last paid invoice — not the country", async () => {
		const t = setup();
		installFetch();
		await makeStore(t, { country: "MY", lastPaidCurrency: "SGD" });
		const options = await as(t, OWNER).query(api.creditPurchases.topUpOptions, {});
		expect(options?.currency).toBe("SGD");
		await expect(buy(t, OWNER, "p50")).rejects.toThrow(/different currency/);
	});

	test("a pack that doesn't exist is refused", async () => {
		const t = setup();
		installFetch();
		await makeStore(t);
		await expect(buy(t, OWNER, "p9000")).rejects.toThrow(/isn't on sale/);
	});

	test("active and comped stores can buy; trialing, past_due, on_hold and cancelled are refused with their way out", async () => {
		const t = setup();
		installFetch();
		await makeStore(t, { userId: "u_active", status: "active" });
		await expect(buy(t, "u_active")).resolves.toMatchObject({ url: expect.any(String) });
		await makeStore(t, { userId: "u_comped", status: "trialing", comped: true });
		await expect(buy(t, "u_comped")).resolves.toMatchObject({ url: expect.any(String) });

		const refused: Array<[Doc<"subscriptions">["status"], RegExp]> = [
			["trialing", /Pick a plan first/],
			["past_due", /overdue invoice\. Pay it first/],
			["on_hold", /Off-Season Hold\. Resume it first/],
			["cancelled", /subscription has ended\. Choose a plan first/],
		];
		for (const [status, copy] of refused) {
			const userId = `u_${status}`;
			await makeStore(t, { userId, status });
			await expect(buy(t, userId)).rejects.toThrow(copy);
			const options = await as(t, userId).query(api.creditPurchases.topUpOptions, {});
			expect(options?.refusal).toBe(status);
			expect(options?.refusalMessage).toMatch(copy);
		}
		// Nothing was opened for a refused store.
		const opened = await t.run((ctx) => ctx.db.query("creditPurchases").collect());
		expect(opened).toHaveLength(2);
	});

	test("past due names the invoice to pay — and hands the owner its Pay-now link", async () => {
		const t = setup();
		installFetch();
		const { retailerId } = await makeStore(t, {
			status: "past_due",
			pendingInvoice: "INV-202610-DUE1",
		});
		await t.run(async (ctx) => {
			const inv = await ctx.db
				.query("invoices")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first();
			if (inv)
				await ctx.db.patch(inv._id, {
					gatewayPayment: { provider: "hitpay" as const, url: "https://pay.example/inv" },
				});
		});
		await expect(buy(t, OWNER)).rejects.toThrow(/INV-202610-DUE1 is overdue/);
		const options = await as(t, OWNER).query(api.creditPurchases.topUpOptions, {});
		expect(options?.pendingInvoice).toEqual({
			invoiceNumber: "INV-202610-DUE1",
			payNowUrl: "https://pay.example/inv",
		});
	});

	test("a Kedaipal admin's own store is never billed — refused with its own reason, not 'pick a plan'", async () => {
		const t = setup();
		installFetch();
		await makeStore(t, { userId: ADMIN, status: "trialing" });
		await expect(buy(t, ADMIN)).rejects.toThrow(/admin stores aren't billed/);
		const options = await as(t, ADMIN).query(api.creditPurchases.topUpOptions, {});
		expect(options?.refusal).toBe("admin_store");
	});

	test("credits WRITE decides it: a teammate with the grant buys; read-only and no grant are refused", async () => {
		const t = setup();
		const fetchState = installFetch();
		const { retailerId } = await makeStore(t);

		await addMember(t, retailerId, "write");
		const { purchaseId } = await buy(t, MEMBER);
		const purchase = await getPurchase(t, purchaseId);
		expect(purchase?.createdBy).toBe(MEMBER);
		// HitPay's record carries the TEAMMATE's email — they pay, not the owner.
		const body = new URLSearchParams(hitpayCalls(fetchState, "POST")[0].body);
		expect(body.get("email")).toBe(`${MEMBER}@team.example`);
		expect(
			(await as(t, MEMBER).query(api.creditPurchases.topUpOptions, {}))
				?.buyerIsMember,
		).toBe(true);

		const reader = "user_topup_reader";
		await addMember(t, retailerId, "read", reader);
		await expect(buy(t, reader)).rejects.toThrow(
			/don't have permission to change credits/,
		);
		const readerView = await as(t, reader).query(
			api.creditPurchases.topUpOptions,
			{},
		);
		expect(readerView?.viewOnly).toBe("no_write");

		const stranger = "user_topup_helper";
		await addMember(t, retailerId, undefined, stranger);
		await expect(buy(t, stranger)).rejects.toThrow(
			/don't have permission to change credits/,
		);
		expect(
			await as(t, stranger).query(api.creditPurchases.topUpOptions, {}),
		).toBeNull();
	});

	test("billing is view-only under admin act-as — the admin can't buy for the seller", async () => {
		const t = setup();
		const fetchState = installFetch();
		const { retailerId } = await makeStore(t);
		await expect(buy(t, ADMIN, "p50", retailerId)).rejects.toThrow(/view-only/);
		const view = await as(t, ADMIN).query(api.creditPurchases.topUpOptions, {
			retailerId,
		});
		expect(view?.viewOnly).toBe("acting_as_admin");
		expect(hitpayCalls(fetchState, "POST")).toHaveLength(0);
	});

	test("no billing credentials: the flag is off and createTopUp refuses without calling HitPay", async () => {
		const t = setup();
		const fetchState = installFetch();
		vi.stubEnv("HITPAY_BILLING_API_KEY", "");
		await makeStore(t);
		const options = await as(t, OWNER).query(api.creditPurchases.topUpOptions, {});
		expect(options?.available).toBe(false);
		await expect(buy(t, OWNER)).rejects.toThrow(/isn't available right now/);
		expect(hitpayCalls(fetchState, "POST")).toHaveLength(0);
		expect(await t.run((ctx) => ctx.db.query("creditPurchases").collect())).toHaveLength(0);
	});

	test("a checkout HitPay won't create closes the purchase as failed — nothing sits pending", async () => {
		const t = setup();
		installFetch({ failCreate: true });
		await makeStore(t);
		await expect(buy(t, OWNER)).rejects.toThrow(/nothing was charged/);
		const [purchase] = await t.run((ctx) => ctx.db.query("creditPurchases").collect());
		expect(purchase.status).toBe("failed");
		expect(purchase.gatewayRequestId).toBeUndefined();
	});

	test("a Starter store is told a plan with more orders is cheaper; Pro is not", async () => {
		const t = setup();
		installFetch();
		await makeStore(t, { userId: "u_starter", plan: "starter" });
		expect(
			(await as(t, "u_starter").query(api.creditPurchases.topUpOptions, {}))
				?.upgradeHint,
		).toEqual({ planLabel: "Pro", monthlyCredits: 200 });
		await makeStore(t, { userId: "u_pro", plan: "pro" });
		expect(
			(await as(t, "u_pro").query(api.creditPurchases.topUpOptions, {}))
				?.upgradeHint,
		).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Settling — exactly once
// ---------------------------------------------------------------------------

describe("settling a top-up — the credits land exactly once", () => {
	test("the completion webhook marks it paid and lands 50 purchased credits in a 12-month lot", async () => {
		const t = setup();
		const fetchState = installFetch();
		const { retailerId } = await makeStore(t);
		const { purchaseId } = await buyAndPay(t, fetchState);

		const purchase = await getPurchase(t, purchaseId);
		expect(purchase).toMatchObject({
			status: "paid",
			paidAt: OCT_10,
			gatewayPayment: { paymentId: "pay_req_topup_1" },
		});
		const lots = await lotsOf(t, retailerId);
		expect(lots).toHaveLength(1);
		expect(lots[0]).toMatchObject({
			_id: purchase?.lotId,
			source: "purchase",
			refId: purchaseId,
			credits: 50,
			remaining: 50,
			expiresAt: addMonthsMyt(OCT_10, 12),
		});
		const ledger = await purchaseLedger(t, retailerId);
		expect(ledger).toHaveLength(1);
		expect(ledger[0]).toMatchObject({
			bucket: "purchased",
			amount: 50,
			reason: "purchase",
			refId: purchaseId,
			refLabel: "50-credit pack",
			createdBy: OWNER,
		});
		expect(await purchasedBalance(t, retailerId)).toBe(50);

		// The v1 webhook doesn't name the rail — the finalize step asks HitPay.
		expect(purchase?.paymentMethod).toBe("hitpay");
		await flushSoon(t);
		expect((await getPurchase(t, purchaseId))?.paymentMethod).toBe(
			"hitpay_touch_n_go",
		);
	});

	test("a second delivery of the same payment is a no-op", async () => {
		const t = setup();
		const fetchState = installFetch();
		const { retailerId } = await makeStore(t);
		const paid = await buyAndPay(t, fetchState);
		const again = await webhook(t, {
			requestId: paid.requestId,
			paymentId: paid.paymentId,
			amount: paid.amount,
			currency: "MYR",
		});
		expect(again.status).toBe(200);
		const direct = await t.mutation(internal.creditPurchases.settlePurchase, {
			purchaseId: paid.purchaseId,
			paymentId: paid.paymentId,
			amountSen: 4500,
			currency: "MYR",
		});
		expect(direct).toEqual({ applied: false, reason: "duplicate" });
		expect(await lotsOf(t, retailerId)).toHaveLength(1);
		expect(await purchaseLedger(t, retailerId)).toHaveLength(1);
		expect(await purchasedBalance(t, retailerId)).toBe(50);
		expect((await getPurchase(t, paid.purchaseId))?.gatewayIssue).toBeUndefined();
	});

	test("a payment of the wrong amount is not credited — the issue is stamped once", async () => {
		const t = setup();
		installFetch();
		const { retailerId } = await makeStore(t);
		const { purchaseId } = await buy(t, OWNER);
		const requestId = (await getPurchase(t, purchaseId))?.gatewayRequestId ?? "";
		await webhook(t, { requestId, paymentId: "pay_short", amount: "40.00", currency: "MYR" });
		const first = await getPurchase(t, purchaseId);
		expect(first?.status).toBe("pending");
		expect(first?.gatewayIssue).toMatchObject({
			kind: "amount_mismatch",
			paymentId: "pay_short",
			amountSen: 4000,
		});
		// A repeat never overwrites the first record.
		vi.advanceTimersByTime(60_000);
		await webhook(t, { requestId, paymentId: "pay_short", amount: "40.00", currency: "MYR" });
		expect((await getPurchase(t, purchaseId))?.gatewayIssue?.at).toBe(
			first?.gatewayIssue?.at,
		);
		expect(await lotsOf(t, retailerId)).toHaveLength(0);
		expect(await purchasedBalance(t, retailerId)).toBe(0);
	});

	test("a payment in the wrong currency is not credited", async () => {
		const t = setup();
		installFetch();
		const { retailerId } = await makeStore(t);
		const { purchaseId } = await buy(t, OWNER);
		const requestId = (await getPurchase(t, purchaseId))?.gatewayRequestId ?? "";
		const result = await t.mutation(internal.creditPurchases.settlePurchase, {
			purchaseId,
			paymentId: "pay_sgd",
			amountSen: 4500,
			currency: "SGD",
		});
		expect(result).toEqual({ applied: false, reason: "amount_mismatch" });
		expect((await getPurchase(t, purchaseId))?.gatewayIssue?.kind).toBe(
			"amount_mismatch",
		);
		expect(requestId).not.toBe("");
		expect(await lotsOf(t, retailerId)).toHaveLength(0);
	});

	test("a callback with a bad signature is refused 401 and credits nothing", async () => {
		const t = setup();
		installFetch();
		const { retailerId } = await makeStore(t);
		const { purchaseId } = await buy(t, OWNER);
		const requestId = (await getPurchase(t, purchaseId))?.gatewayRequestId ?? "";
		const res = await webhook(
			t,
			{ requestId, paymentId: "pay_forged", amount: "45.00", currency: "MYR" },
			"not-the-salt",
		);
		expect(res.status).toBe(401);
		expect((await getPurchase(t, purchaseId))?.status).toBe("pending");
		expect(await purchasedBalance(t, retailerId)).toBe(0);
	});

	test("a declined attempt (non-completed status) changes nothing — the checkout stays payable", async () => {
		const t = setup();
		installFetch();
		const { retailerId } = await makeStore(t);
		const { purchaseId } = await buy(t, OWNER);
		const requestId = (await getPurchase(t, purchaseId))?.gatewayRequestId ?? "";
		const res = await webhook(t, {
			requestId,
			paymentId: "pay_declined",
			amount: "45.00",
			currency: "MYR",
			status: "failed",
		});
		expect(res.status).toBe(200);
		expect((await getPurchase(t, purchaseId))?.status).toBe("pending");
		expect(await purchasedBalance(t, retailerId)).toBe(0);
	});

	test("the ledger and the cached balance agree after purchases and orders", async () => {
		const t = setup();
		const fetchState = installFetch();
		const { retailerId } = await makeStore(t);
		await buyAndPay(t, fetchState, OWNER, "p50");
		await buyAndPay(t, fetchState, OWNER, "p200");
		// Spend the plan bucket down and into the purchased lots.
		await t.run(async (ctx) => {
			const account = await ctx.db
				.query("creditAccounts")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first();
			const plan = account?.planBalance ?? 0;
			for (let i = 0; i < plan + 30; i++) {
				const now = Date.now();
				const orderId = await ctx.db.insert("orders", {
					retailerId,
					shortId: `ORD-T${i}`,
					items: [],
					subtotal: 1000,
					total: 1000,
					currency: "MYR",
					status: "pending",
					channel: "whatsapp",
					customer: { name: "Aina" },
					deliveryMethod: "delivery",
					createdAt: now,
					updatedAt: now,
				});
				await debitCreditForOrder(ctx, { retailerId, orderId, now });
			}
		});
		expect(await purchasedBalance(t, retailerId)).toBe(220);
		const audit = await t.mutation(internal.credits.internalRecomputeBalance, {
			retailerId,
		});
		expect(audit.drift).toBe(false);
		expect(audit.ledger.purchased).toBe(220);
		expect(audit.lotsRemaining).toBe(220);
	});
});

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

describe("a checkout expires 24h after it opened", () => {
	test("still unpaid at 24h: expired, no credit, and the HitPay request is deleted", async () => {
		const t = setup();
		const fetchState = installFetch();
		const { retailerId } = await makeStore(t);
		const { purchaseId } = await buy(t, OWNER);

		vi.advanceTimersByTime(CREDIT_PURCHASE_TTL_MS - 1000);
		await flushSoon(t);
		expect((await getPurchase(t, purchaseId))?.status).toBe("pending");

		vi.advanceTimersByTime(1000);
		await flushSoon(t);
		const purchase = await getPurchase(t, purchaseId);
		expect(purchase?.status).toBe("expired");
		expect(purchase?.expiredAt).toBeDefined();
		// It asked HitPay first, then killed the link.
		expect(hitpayCalls(fetchState, "GET").map((c) => c.url)).toEqual([
			"https://api.sandbox.hit-pay.com/v1/payment-requests/req_topup_1",
		]);
		expect(hitpayCalls(fetchState, "DELETE").map((c) => c.url)).toEqual([
			"https://api.sandbox.hit-pay.com/v1/payment-requests/req_topup_1",
		]);
		expect(await lotsOf(t, retailerId)).toHaveLength(0);
		expect(await purchasedBalance(t, retailerId)).toBe(0);
	});

	test("a payment that turns up after it expired is stamped late_payment and never credited", async () => {
		const t = setup();
		installFetch();
		const { retailerId } = await makeStore(t);
		const { purchaseId } = await buy(t, OWNER);
		const requestId = (await getPurchase(t, purchaseId))?.gatewayRequestId ?? "";
		vi.advanceTimersByTime(CREDIT_PURCHASE_TTL_MS);
		await flushSoon(t);
		expect((await getPurchase(t, purchaseId))?.status).toBe("expired");

		const res = await webhook(t, {
			requestId,
			paymentId: "pay_late",
			amount: "45.00",
			currency: "MYR",
		});
		expect(res.status).toBe(200);
		const purchase = await getPurchase(t, purchaseId);
		expect(purchase?.status).toBe("expired");
		expect(purchase?.gatewayIssue).toMatchObject({
			kind: "late_payment",
			paymentId: "pay_late",
		});
		expect(await lotsOf(t, retailerId)).toHaveLength(0);
		expect(await purchasedBalance(t, retailerId)).toBe(0);
		// The ops read finds it for a person to reconcile.
		const issues = await t.query(internal.creditPurchases.internalListIssues, {});
		expect(issues.map((i) => i.purchaseId)).toEqual([purchaseId]);
	});

	test("the expiry never throws money away: a lost webhook's payment is credited at the last look", async () => {
		const t = setup();
		const fetchState = installFetch();
		const { retailerId } = await makeStore(t);
		const { purchaseId } = await buy(t, OWNER);
		fetchState.payments.set("req_topup_1", [
			{ id: "pay_lost", status: "succeeded", amount: "45.00", currency: "MYR", payment_type: "card" },
		]);
		vi.advanceTimersByTime(CREDIT_PURCHASE_TTL_MS);
		await flushSoon(t);
		const purchase = await getPurchase(t, purchaseId);
		expect(purchase?.status).toBe("paid");
		expect(purchase?.paymentMethod).toBe("hitpay_card");
		expect(await purchasedBalance(t, retailerId)).toBe(50);
		expect(hitpayCalls(fetchState, "DELETE")).toHaveLength(0);
	});

	test("when HitPay can't be asked, it looks again instead of expiring — 'couldn't check' is not 'didn't pay'", async () => {
		const t = setup();
		const fetchState = installFetch({ failLookup: true });
		await makeStore(t);
		const { purchaseId } = await buy(t, OWNER);
		vi.advanceTimersByTime(CREDIT_PURCHASE_TTL_MS);
		await flushSoon(t);
		expect((await getPurchase(t, purchaseId))?.status).toBe("pending");

		fetchState.failLookup = false;
		vi.advanceTimersByTime(60 * 60 * 1000);
		await flushSoon(t);
		expect((await getPurchase(t, purchaseId))?.status).toBe("expired");
	});
});

// ---------------------------------------------------------------------------
// Coming back from HitPay
// ---------------------------------------------------------------------------

describe("the return reconcile", () => {
	test("verifyCreditPurchase settles from HitPay's status API when the webhook is late", async () => {
		const t = setup();
		const fetchState = installFetch();
		const { retailerId } = await makeStore(t);
		const { purchaseId } = await buy(t, OWNER);
		expect(
			(await as(t, OWNER).query(api.creditPurchases.latestPurchase, {}))?.status,
		).toBe("pending");

		fetchState.payments.set("req_topup_1", [
			{ id: "pay_ret", status: "succeeded", amount: "45.00", currency: "MYR", payment_type: "card" },
		]);
		const result = await as(t, OWNER).action(
			api.creditPurchases.verifyCreditPurchase,
			{},
		);
		expect(result).toEqual({ settled: true });
		expect(await purchasedBalance(t, retailerId)).toBe(50);
		const latest = await as(t, OWNER).query(api.creditPurchases.latestPurchase, {});
		expect(latest).toMatchObject({
			_id: purchaseId,
			status: "paid",
			paymentMethodLabel: "Card",
		});

		// The webhook arriving afterwards is just a duplicate.
		await webhook(t, { requestId: "req_topup_1", paymentId: "pay_ret", amount: "45.00", currency: "MYR" });
		expect(await purchasedBalance(t, retailerId)).toBe(50);
	});

	test("an abandoned checkout verifies as not settled and stays pending", async () => {
		const t = setup();
		installFetch();
		await makeStore(t);
		const { purchaseId } = await buy(t, OWNER);
		const result = await as(t, OWNER).action(
			api.creditPurchases.verifyCreditPurchase,
			{},
		);
		expect(result).toEqual({ settled: false });
		expect((await getPurchase(t, purchaseId))?.status).toBe("pending");
	});

	test("latestPurchase is the caller's own — a teammate's purchase isn't the owner's return", async () => {
		const t = setup();
		installFetch();
		const { retailerId } = await makeStore(t);
		await addMember(t, retailerId, "write");
		await buy(t, MEMBER);
		expect(
			await as(t, OWNER).query(api.creditPurchases.latestPurchase, {}),
		).toBeNull();
		expect(
			(await as(t, MEMBER).query(api.creditPurchases.latestPurchase, {}))?.status,
		).toBe("pending");
	});
});

// ---------------------------------------------------------------------------
// Receipts, history, analytics
// ---------------------------------------------------------------------------

describe("receipts and history", () => {
	test("a teammate's purchase emails the OWNER a receipt naming them — and the teammate gets their copy", async () => {
		const t = setup();
		vi.stubEnv("RESEND_API_KEY", "re_test");
		vi.stubEnv("EMAIL_FROM", "billing@kedaipal.test");
		const fetchState = installFetch();
		const { retailerId } = await makeStore(t);
		await addMember(t, retailerId, "write");
		await buyAndPay(t, fetchState, MEMBER);
		await flushSoon(t);

		const emails = fetchState.calls
			.filter((c) => c.url === "https://api.resend.com/emails")
			.map((c) => JSON.parse(c.body) as { to: string[]; subject: string; html: string; text: string });
		const toOwner = emails.find((e) => e.to[0] === `${OWNER}@store.example`);
		const toMember = emails.find((e) => e.to[0] === `${MEMBER}@team.example`);
		expect(toOwner?.subject).toContain("Aisyah bought 50 credits");
		expect(toOwner?.html).toContain("paid with their own payment method");
		expect(toOwner?.text).toContain("Bought by: Aisyah");
		expect(toOwner?.text).toContain("Paid with: Touch 'n Go");
		expect(toOwner?.text).toContain("non-refundable and not redeemable for cash");
		expect(toOwner?.text).toContain("Credits valid until: 10 Oct 2027");
		expect(toMember?.subject).toContain("Your receipt: 50 credits");
		expect(emails).toHaveLength(2);
	});

	test("the owner's own purchase emails the store's billing inbox only", async () => {
		const t = setup();
		vi.stubEnv("RESEND_API_KEY", "re_test");
		vi.stubEnv("EMAIL_FROM", "billing@kedaipal.test");
		const fetchState = installFetch();
		await makeStore(t);
		await buyAndPay(t, fetchState);
		await flushSoon(t);
		const emails = fetchState.calls
			.filter((c) => c.url === "https://api.resend.com/emails")
			.map((c) => JSON.parse(c.body) as { to: string[]; subject: string });
		expect(emails).toHaveLength(1);
		expect(emails[0].to).toEqual([`${OWNER}@store.example`]);
		expect(emails[0].subject).toContain("50 credits added");
	});

	test("the receipt PDF is frozen once paid and readable with credits read — never by a stranger", async () => {
		const t = setup();
		const fetchState = installFetch();
		const { retailerId } = await makeStore(t);
		const { purchaseId } = await buyAndPay(t, fetchState);
		await flushSoon(t);
		expect((await getPurchase(t, purchaseId))?.receiptPdfStorageId).toBeDefined();
		expect(
			await as(t, OWNER).query(api.creditPurchases.getReceiptPdfUrl, { purchaseId }),
		).toEqual(expect.any(String));

		await addMember(t, retailerId, "read");
		expect(
			await as(t, MEMBER).query(api.creditPurchases.getReceiptPdfUrl, { purchaseId }),
		).toEqual(expect.any(String));

		await makeStore(t, { userId: "u_other" });
		await expect(
			as(t, "u_other").query(api.creditPurchases.getReceiptPdfUrl, { purchaseId }),
		).rejects.toThrow();
	});

	test("an unpaid purchase never gets a receipt", async () => {
		const t = setup();
		installFetch();
		await makeStore(t);
		const { purchaseId } = await buy(t, OWNER);
		expect(
			await as(t, OWNER).action(api.creditPurchases.getOrCreateReceiptPdfUrl, {
				purchaseId,
			}),
		).toBeNull();
	});

	test("billing history lists PAID top-ups only, newest first, naming a teammate buyer", async () => {
		const t = setup();
		const fetchState = installFetch();
		const { retailerId } = await makeStore(t);
		await addMember(t, retailerId, "write");
		await buyAndPay(t, fetchState, OWNER, "p50");
		vi.advanceTimersByTime(60_000);
		await buyAndPay(t, fetchState, MEMBER, "p200");
		await buy(t, OWNER); // pending — not history
		const history = await as(t, OWNER).query(api.creditPurchases.myPurchases, {});
		expect(history.map((p) => [p.credits, p.boughtBy])).toEqual([
			[200, "Aisyah"],
			[50, null],
		]);

		// Admin act-as reads the SELLER's history (the myInvoices posture).
		const actAs = await as(t, ADMIN).query(api.creditPurchases.myPurchases, {
			retailerId,
		});
		expect(actAs).toHaveLength(2);
	});

	test("a settled top-up sends the credits_topup_paid key event", async () => {
		const t = setup();
		vi.stubEnv("GA4_MEASUREMENT_ID", "G-TEST123");
		vi.stubEnv("GA4_MP_API_SECRET", "secret-abc");
		const fetchState = installFetch();
		await makeStore(t);
		await buyAndPay(t, fetchState);
		await flushSoon(t);
		const events = fetchState.calls
			.filter((c) => c.url.startsWith("https://www.google-analytics.com/mp/collect"))
			.flatMap(
				(c) =>
					(JSON.parse(c.body) as { events: Array<{ name: string; params: Record<string, unknown> }> })
						.events,
			);
		expect(events).toEqual([
			{
				name: "credits_topup_paid",
				params: expect.objectContaining({
					value: 45,
					currency: "MYR",
					pack_id: "p50",
					source: "manual",
				}),
			},
		]);
	});
});

describe("account deletion", () => {
	test("deleting a store closes its open top-up and kills the checkout link — the row is kept", async () => {
		const t = setup();
		const fetchState = installFetch();
		await makeStore(t);
		const { purchaseId } = await buy(t, OWNER);
		await t.mutation(internal.retailers.deleteUser, { userId: OWNER });
		await flushSoon(t);
		const purchase = await getPurchase(t, purchaseId);
		expect(purchase?.status).toBe("expired");
		expect(hitpayCalls(fetchState, "DELETE").map((c) => c.url)).toContain(
			"https://api.sandbox.hit-pay.com/v1/payment-requests/req_topup_1",
		);
	});
});
