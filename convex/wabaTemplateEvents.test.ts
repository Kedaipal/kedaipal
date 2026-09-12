/// <reference types="vite/client" />
/**
 * Template lifecycle webhooks end to end (ClickUp z8r3fddtkh): a signed Meta
 * POST → wabaTemplateEvents row → ops alert on the expensive/broken cases →
 * the admin console's per-template view → the keep-the-newest purge.
 *
 * Fake timers are installed BEFORE each convexTest instance (the
 * whatsapp.test.ts gotcha) so the scheduled alert email is driven explicitly
 * via t.finishAllScheduledFunctions and asserted through the Resend fetch.
 */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { DAY_MS } from "./lib/wabaLimits";
import { computeMetaSignature } from "./lib/whatsappSignature";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const SECRET = "test-app-secret";
const ADMIN = "user_admin_templates";
const NOW = Date.UTC(2026, 8, 20, 4, 0, 0);

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

let prevAdminEnv: string | undefined;
let prevConfirm: string | undefined;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	process.env.WHATSAPP_APP_SECRET = SECRET;
	process.env.RESEND_API_KEY = "test-resend";
	process.env.EMAIL_FROM = "Kedaipal <ops@kedaipal.test>";
	process.env.ADMIN_ALERT_EMAIL = "ops@kedaipal.test";
	prevAdminEnv = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
	prevConfirm = process.env.WHATSAPP_ORDER_CONFIRM_TEMPLATE;
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	delete process.env.WHATSAPP_APP_SECRET;
	delete process.env.ADMIN_ALERT_EMAIL;
	process.env.ADMIN_USER_IDS = prevAdminEnv;
	if (prevConfirm === undefined) delete process.env.WHATSAPP_ORDER_CONFIRM_TEMPLATE;
	else process.env.WHATSAPP_ORDER_CONFIRM_TEMPLATE = prevConfirm;
});

function installFetchMock() {
	const calls: Array<{ url: string; body: unknown }> = [];
	const original = globalThis.fetch;
	globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
		calls.push({
			url: String(url),
			body: init?.body ? JSON.parse(init.body as string) : null,
		});
		return new Response("{}", { status: 200 });
	}) as unknown as typeof fetch;
	return {
		emails: () => calls.filter((c) => c.url.includes("resend.com")),
		restore: () => {
			globalThis.fetch = original;
		},
	};
}

async function postWebhook(
	t: ReturnType<typeof setup>,
	field: string,
	value: Record<string, unknown>,
) {
	const body = JSON.stringify({
		object: "whatsapp_business_account",
		entry: [{ id: "WABA_ID", changes: [{ field, value }] }],
	});
	const signature = await computeMetaSignature(SECRET, body);
	return t.fetch("/webhook/whatsapp", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Hub-Signature-256": signature,
		},
		body,
	});
}

describe("POST /webhook/whatsapp — template lifecycle events", () => {
	test("UTILITY → MARKETING is persisted AND pages ops (the 6.1× trap)", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		try {
			const res = await postWebhook(t, "template_category_update", {
				message_template_id: 1,
				message_template_name: "order_confirmation_utility",
				message_template_language: "en",
				previous_category: "UTILITY",
				new_category: "MARKETING",
			});
			expect(res.status).toBe(200);

			const rows = await t.run((ctx) =>
				ctx.db.query("wabaTemplateEvents").collect(),
			);
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				kind: "category",
				templateName: "order_confirmation_utility",
				language: "en",
				previousCategory: "UTILITY",
				newCategory: "MARKETING",
				alerted: true,
			});

			await t.finishAllScheduledFunctions(vi.runAllTimers);
			const emails = fetchMock.emails();
			expect(emails).toHaveLength(1);
			const email = emails[0].body as { to: unknown; subject: string; text: string };
			expect(email.subject).toBe("[Kedaipal] WhatsApp template alert");
			expect(email.text).toContain("order_confirmation_utility (en) category UTILITY → MARKETING");
			expect(email.text).toContain("appeal");
		} finally {
			fetchMock.restore();
		}
	});

	test("APPROVED is persisted but nobody is paged", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		try {
			await postWebhook(t, "message_template_status_update", {
				event: "APPROVED",
				message_template_id: 2,
				message_template_name: "payment_reminder_utility",
				message_template_language: "ms",
			});
			const rows = await t.run((ctx) =>
				ctx.db.query("wabaTemplateEvents").collect(),
			);
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				kind: "status",
				event: "APPROVED",
				alerted: false,
			});
			await t.finishAllScheduledFunctions(vi.runAllTimers);
			expect(fetchMock.emails()).toEqual([]);
		} finally {
			fetchMock.restore();
		}
	});

	test("PAUSED pages ops with the send-fails consequence", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		try {
			await postWebhook(t, "message_template_status_update", {
				event: "PAUSED",
				message_template_name: "seller_new_order_utility",
				message_template_language: "en",
				reason: "LOW_QUALITY",
			});
			await t.finishAllScheduledFunctions(vi.runAllTimers);
			const emails = fetchMock.emails();
			expect(emails).toHaveLength(1);
			const email = emails[0].body as { text: string };
			expect(email.text).toContain("status → PAUSED — LOW_QUALITY");
			expect(email.text).toContain("fails outright");
		} finally {
			fetchMock.restore();
		}
	});

	test("a health event in the same payload still records as before", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		try {
			const body = JSON.stringify({
				object: "whatsapp_business_account",
				entry: [
					{
						id: "WABA_ID",
						changes: [
							{
								field: "phone_number_quality_update",
								value: { event: "FLAGGED", current_limit: "TIER_1K" },
							},
							{
								field: "message_template_quality_update",
								value: {
									previous_quality_score: "GREEN",
									new_quality_score: "RED",
									name: "claim_link_utility",
									language: "en",
								},
							},
						],
					},
				],
			});
			const signature = await computeMetaSignature(SECRET, body);
			const res = await t.fetch("/webhook/whatsapp", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Hub-Signature-256": signature,
				},
				body,
			});
			expect(res.status).toBe(200);
			const [health, templates] = await t.run((ctx) =>
				Promise.all([
					ctx.db.query("wabaHealth").collect(),
					ctx.db.query("wabaTemplateEvents").collect(),
				]),
			);
			expect(health).toHaveLength(1);
			expect(health[0].qualityRating).toBe("LOW");
			expect(templates).toHaveLength(1);
			expect(templates[0]).toMatchObject({
				kind: "quality",
				newQuality: "RED",
				alerted: true,
			});
		} finally {
			fetchMock.restore();
		}
	});
});

describe("adminListTemplates — the per-template live view", () => {
	test("configured templates join their newest status/category/quality; unset env vars show as not configured", async () => {
		const t = setup();
		process.env.WHATSAPP_ORDER_CONFIRM_TEMPLATE = "order_confirmation_utility";
		delete process.env.WHATSAPP_PAYMENT_REMINDER_TEMPLATE;
		await t.run(async (ctx) => {
			const base = {
				templateName: "order_confirmation_utility",
				language: "en",
				alerted: false,
			};
			await ctx.db.insert("wabaTemplateEvents", {
				...base,
				kind: "status",
				event: "APPROVED",
				observedAt: NOW - 30 * DAY_MS,
			});
			await ctx.db.insert("wabaTemplateEvents", {
				...base,
				kind: "category",
				previousCategory: "UTILITY",
				newCategory: "MARKETING",
				alerted: true,
				observedAt: NOW - 2 * DAY_MS,
			});
			await ctx.db.insert("wabaTemplateEvents", {
				...base,
				kind: "quality",
				previousQuality: "GREEN",
				newQuality: "YELLOW",
				alerted: true,
				observedAt: NOW - DAY_MS,
			});
			// A template Meta mentioned that we don't have configured.
			await ctx.db.insert("wabaTemplateEvents", {
				templateName: "some_old_template",
				language: "ms",
				kind: "status",
				event: "DISABLED",
				alerted: true,
				observedAt: NOW - 5 * DAY_MS,
			});
		});

		const asAdmin = t.withIdentity({ subject: ADMIN });
		const result = await asAdmin.query(api.wabaProtection.adminListTemplates, {});
		expect(result.neverReceived).toBe(false);

		const confirm = result.rows.find(
			(r) => r.templateName === "order_confirmation_utility",
		);
		expect(confirm).toBeDefined();
		expect(confirm?.configured).toBe(true);
		expect(confirm?.envVar).toBe("WHATSAPP_ORDER_CONFIRM_TEMPLATE");
		const en = confirm?.languages.find((l) => l.language === "en");
		expect(en).toMatchObject({
			status: "APPROVED",
			category: "MARKETING",
			quality: "YELLOW",
		});
		expect(en?.lastEvent?.summary).toBe("quality GREEN → YELLOW");
		// No ms events → empty state per language, never a crash.
		const ms = confirm?.languages.find((l) => l.language === "ms");
		expect(ms?.status).toBeUndefined();
		expect(ms?.lastEvent).toBeUndefined();

		const unknown = result.rows.find((r) => r.templateName === "some_old_template");
		expect(unknown?.configured).toBe(false);
		expect(unknown?.languages.find((l) => l.language === "ms")?.status).toBe(
			"DISABLED",
		);

		const unsetReminder = result.rows.find(
			(r) => r.envVar === "WHATSAPP_PAYMENT_REMINDER_TEMPLATE",
		);
		expect(unsetReminder).toMatchObject({ configured: false, templateName: "" });

		expect(result.recent[0].summary).toBe("quality GREEN → YELLOW");
		expect(result.recent.map((r) => r.alerted)).toEqual([true, true, true, false]);
	});

	test("with no webhook ever received, neverReceived flags the unsubscribed fields", async () => {
		const t = setup();
		const asAdmin = t.withIdentity({ subject: ADMIN });
		const result = await asAdmin.query(api.wabaProtection.adminListTemplates, {});
		expect(result.neverReceived).toBe(true);
		expect(result.recent).toEqual([]);
	});

	test("non-admins are refused", async () => {
		const t = setup();
		await expect(
			t
				.withIdentity({ subject: "user_not_admin" })
				.query(api.wabaProtection.adminListTemplates, {}),
		).rejects.toThrow(/Not authorized/);
	});
});

describe("wabaTemplateEvents purge — the newest row per template is never deleted", () => {
	test("keeps each template's newest row past the cutoff; purges the rest", async () => {
		const t = setup();
		await t.run(async (ctx) => {
			// Template A: two stale rows — keep only the newer one.
			await ctx.db.insert("wabaTemplateEvents", {
				templateName: "a",
				language: "en",
				kind: "status",
				event: "APPROVED",
				alerted: false,
				observedAt: NOW - 200 * DAY_MS,
			});
			await ctx.db.insert("wabaTemplateEvents", {
				templateName: "a",
				language: "en",
				kind: "category",
				previousCategory: "UTILITY",
				newCategory: "MARKETING",
				alerted: true,
				observedAt: NOW - 150 * DAY_MS,
			});
			// Same template, other language — its own live state.
			await ctx.db.insert("wabaTemplateEvents", {
				templateName: "a",
				language: "ms",
				kind: "status",
				event: "PAUSED",
				alerted: true,
				observedAt: NOW - 120 * DAY_MS,
			});
			// Template B: stale + fresh — the stale one goes.
			await ctx.db.insert("wabaTemplateEvents", {
				templateName: "b",
				language: "en",
				kind: "status",
				event: "APPROVED",
				alerted: false,
				observedAt: NOW - 100 * DAY_MS,
			});
			await ctx.db.insert("wabaTemplateEvents", {
				templateName: "b",
				language: "en",
				kind: "quality",
				newQuality: "GREEN",
				alerted: false,
				observedAt: NOW - DAY_MS,
			});
		});

		await t.mutation(internal.wabaProtection.purgeExpiredWabaTemplateEvents, {});

		const rows = await t.run((ctx) =>
			ctx.db.query("wabaTemplateEvents").collect(),
		);
		const keys = rows
			.map((r) => `${r.templateName}/${r.language}/${r.kind}`)
			.sort();
		expect(keys).toEqual(["a/en/category", "a/ms/status", "b/en/quality"]);
	});
});
