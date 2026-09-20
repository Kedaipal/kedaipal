/// <reference types="vite/client" />
// Comp accounts (z8r3fdeub2): an admin-toggled "comp upgrade" for partners /
// sponsors / pilots / internal stores. While on, a store resolves exactly like
// an admin's own store — the highest tier's features, no limits, never billed,
// nothing to subscribe to, change or pause — minus admin access. It has NO end
// date. Turning it off makes the store an EXPIRED seller: `past_due` with no
// invoice — storefront + buyer ordering live, growth-writes locked until it
// picks a plan and pays. See docs/manual-subscription.md.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { isUnlimited } from "./lib/plans";
import schema from "./schema";
import { resolveAccess } from "./subscriptions";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const ADMIN = "user_comp_admin";
const DAY = 24 * 60 * 60 * 1000;
let prevAdminEnv: string | undefined;

beforeEach(() => {
	vi.useFakeTimers();
	prevAdminEnv = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	process.env.ADMIN_USER_IDS = prevAdminEnv;
});

/** A seller with the subscription row `createRetailer` minted (trialing Pro). */
async function seedSeller(
	t: ReturnType<typeof setup>,
	userId: string,
	overrides: Partial<Doc<"subscriptions">> = {},
) {
	const asUser = t.withIdentity({ subject: userId });
	const slug = `comp-${userId.replace(/[^a-z0-9]/g, "")}`;
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: `Store ${slug}`,
		slug,
	});
	const ids = await t.run(async (ctx) => {
		const r = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", slug))
			.first();
		if (!r) throw new Error("no retailer");
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", r._id))
			.first();
		if (!sub) throw new Error("no sub");
		if (Object.keys(overrides).length > 0) {
			await ctx.db.patch(sub._id, overrides);
		}
		return { retailerId: r._id, subId: sub._id, slug };
	});
	return { ...ids, userId, asUser };
}

const getSub = (t: ReturnType<typeof setup>, id: Id<"subscriptions">) =>
	t.run((ctx) => ctx.db.get(id));
const getRetailer = (t: ReturnType<typeof setup>, id: Id<"retailers">) =>
	t.run((ctx) => ctx.db.get(id));
const invoicesFor = (t: ReturnType<typeof setup>, retailerId: Id<"retailers">) =>
	t.run((ctx) =>
		ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.collect(),
	);
const auditFor = (t: ReturnType<typeof setup>, retailerId: Id<"retailers">) =>
	t.run((ctx) =>
		ctx.db
			.query("adminAuditLog")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.collect(),
	);
/** Names + args of every scheduled job — the honest way to see which emails
 * a mutation queued (fake timers never run them). */
const scheduled = (t: ReturnType<typeof setup>) =>
	t.run(async (ctx) =>
		(await ctx.db.system.query("_scheduled_functions").collect()).map((j) => ({
			name: j.name,
			args: j.args[0] as Record<string, unknown>,
		})),
	);
const compEmails = async (t: ReturnType<typeof setup>, key: string) =>
	(await scheduled(t)).filter(
		(j) => j.name.includes("notifyTrialEmail") && j.args.key === key,
	);
const cron = (t: ReturnType<typeof setup>) =>
	t.mutation(internal.subscriptions.internalDailyBillingStatus, {});
const asAdmin = (t: ReturnType<typeof setup>) =>
	t.withIdentity({ subject: ADMIN });

const invoiceRow = (
	retailerId: Id<"retailers">,
	subscriptionId: Id<"subscriptions">,
	overrides: Partial<Doc<"invoices">> = {},
) => ({
	retailerId,
	subscriptionId,
	invoiceNumber: "INV-TEST-0001",
	plan: "pro" as const,
	billingCycle: "monthly" as const,
	amount: 14900,
	total: 14900,
	currency: "MYR",
	periodStart: Date.now() - 15 * DAY,
	periodEnd: Date.now() + 15 * DAY,
	status: "pending" as const,
	dueDate: Date.now() - DAY,
	createdAt: Date.now() - 15 * DAY,
	...overrides,
});

describe("what a comp grants", () => {
	test("resolves EXACTLY like an admin's own store: same features, no limits, never frozen", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_grants", { plan: "starter" });
		await asAdmin(t).mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "partner",
		});
		const sub = (await getSub(t, s.subId)) ?? null;
		const access = resolveAccess(sub);
		expect(access.comped).toBe(true);
		// No limits on anything — orders, seats, broadcasts.
		expect(isUnlimited(access.caps.orderCap)).toBe(true);
		expect(isUnlimited(access.caps.userCap)).toBe(true);
		expect(isUnlimited(access.caps.broadcastQuota)).toBe(true);
		// Every feature on, even though the stored plan is Starter.
		expect(Object.values(access.features).every(Boolean)).toBe(true);
		expect(access.frozen).toBe(false);
		// "Same limit as admin" is structural: one full-access definition.
		const admin = resolveAccess(
			{ ...(sub as Doc<"subscriptions">), comped: false },
			{ adminFullAccess: true },
		);
		expect(access.caps).toEqual(admin.caps);
		expect(access.features).toEqual(admin.features);
		// The stored plan is left alone — it's the post-comp default, not the grant.
		expect((await getSub(t, s.subId))?.plan).toBe("starter");
		// …and the owner payload the dashboard renders agrees.
		const me = await s.asUser.query(api.retailers.getMyRetailer, {});
		expect(isUnlimited(me?.subscription?.caps.orderCap ?? 0)).toBe(true);
		expect(me?.subscription?.caps).toEqual(access.caps);
	});

	test("nothing to subscribe to, change or pause: every self-serve billing write refuses", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_noselfserve");
		await asAdmin(t).mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "sponsor",
		});
		await expect(
			s.asUser.mutation(api.invoices.subscribeSelf, {
				plan: "pro",
				billingCycle: "monthly",
			}),
		).rejects.toThrow(/on the house/i);
		await expect(
			s.asUser.mutation(api.invoices.changePlan, { plan: "starter" }),
		).rejects.toThrow(/on the house/i);
		await expect(
			s.asUser.mutation(api.subscriptions.setSeasonalHold, {
				retailerId: s.retailerId,
				hold: true,
			}),
		).rejects.toThrow(/on the house/i);
		// …and the manual admin path can't bill it either.
		await expect(
			asAdmin(t).mutation(api.invoices.issueInvoice, {
				retailerId: s.retailerId,
				plan: "pro",
				billingCycle: "monthly",
				founding: false,
			}),
		).rejects.toThrow(/on the house/i);
		expect(await invoicesFor(t, s.retailerId)).toHaveLength(0);
	});

	test("AccessState ships the seller-facing slice ONLY — note and grantedBy never leave the server", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_slice");
		await asAdmin(t).mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "sponsor",
			label: "Sponsored by Maybank SME",
			note: "internal deal terms",
		});
		const sub = await getSub(t, s.subId);
		expect(resolveAccess(sub ?? null).comp).toEqual({
			kind: "sponsor",
			label: "Sponsored by Maybank SME",
		});
		const me = await s.asUser.query(api.retailers.getMyRetailer, {});
		expect(me?.subscription?.comp?.label).toBe("Sponsored by Maybank SME");
		expect(JSON.stringify(me)).not.toContain("internal deal terms");
		expect(JSON.stringify(me)).not.toContain(ADMIN);
	});
});

describe("setComp", () => {
	test("grants: comped + stamp, active, every billing clock cleared, audit row written", async () => {
		const t = setup();
		const now = Date.now();
		const s = await seedSeller(t, "u_grant", {
			trialReminderSentAt: 123,
			currentPeriodStart: now - 10 * DAY,
			currentPeriodEnd: now + 20 * DAY,
			periodPaidBy: "plan",
			pendingPlanChange: { plan: "starter", requestedAt: now - DAY },
		});
		await asAdmin(t).mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "sponsor",
			label: "  Sponsored by Maybank SME  ",
			note: "Q4 SME programme",
		});
		const sub = await getSub(t, s.subId);
		expect(sub?.comped).toBe(true);
		expect(sub?.comp).toEqual({
			kind: "sponsor",
			label: "Sponsored by Maybank SME",
			note: "Q4 SME programme",
			grantedBy: ADMIN,
			grantedAt: now,
		});
		expect(sub?.status).toBe("active");
		expect(sub?.trialEndsAt).toBeUndefined();
		expect(sub?.trialReminderSentAt).toBeUndefined();
		expect(sub?.freePeriodEndedAt).toBeUndefined();
		// A comp has no billing period — a leftover paid-through date would read
		// "expires {date}" under a sponsor line.
		expect(sub?.currentPeriodStart).toBeUndefined();
		expect(sub?.currentPeriodEnd).toBeUndefined();
		expect(sub?.periodPaidBy).toBeUndefined();
		expect(sub?.pendingPlanChange).toBeUndefined();
		const audit = await auditFor(t, s.retailerId);
		expect(audit).toHaveLength(1);
		expect(audit[0]).toMatchObject({
			adminUserId: ADMIN,
			action: "subscriptions.setComp",
			targetId: s.retailerId,
		});
	});

	test("non-admins (owner included) are refused; validation: oversized label/note", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_refuse");
		await expect(
			s.asUser.mutation(api.subscriptions.setComp, {
				retailerId: s.retailerId,
				kind: "pilot",
			}),
		).rejects.toThrow(/not authorized/i);
		await expect(
			asAdmin(t).mutation(api.subscriptions.setComp, {
				retailerId: s.retailerId,
				kind: "pilot",
				label: "x".repeat(61),
			}),
		).rejects.toThrow(/label under 60/i);
		await expect(
			asAdmin(t).mutation(api.subscriptions.setComp, {
				retailerId: s.retailerId,
				kind: "pilot",
				note: "x".repeat(501),
			}),
		).rejects.toThrow(/note under 500/i);
		expect((await getSub(t, s.subId))?.comped).not.toBe(true);
	});

	test("an admin's own store is refused — it already runs free via the allowlist", async () => {
		const t = setup();
		const s = await seedSeller(t, ADMIN);
		await expect(
			asAdmin(t).mutation(api.subscriptions.setComp, {
				retailerId: s.retailerId,
				kind: "internal",
			}),
		).rejects.toThrow(/admin store/i);
	});

	test("past_due with an overdue pending invoice: the invoice is voided and the lock lifts in the same beat", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_pastdue", { status: "past_due" });
		await t.run((ctx) =>
			ctx.db.insert("invoices", invoiceRow(s.retailerId, s.subId)),
		);
		await asAdmin(t).mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "partner",
		});
		const sub = await getSub(t, s.subId);
		expect(sub?.status).toBe("active");
		const invoices = await invoicesFor(t, s.retailerId);
		expect(invoices).toHaveLength(1);
		expect(invoices[0].status).toBe("void");
		expect(invoices[0].voidReason).toMatch(/on the house/i);
		expect(resolveAccess(sub ?? null).frozen).toBe(false);
	});

	test("on_hold: the hold is released — ordering reopens, heldAt cleared", async () => {
		const t = setup();
		const heldAt = Date.now() - 5 * DAY;
		const s = await seedSeller(t, "u_hold", { status: "on_hold", heldAt });
		await t.run((ctx) =>
			ctx.db.patch(s.retailerId, { orderingPausedAt: heldAt }),
		);
		await asAdmin(t).mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "partner",
		});
		expect((await getSub(t, s.subId))?.status).toBe("active");
		expect((await getSub(t, s.subId))?.heldAt).toBeUndefined();
		expect(
			(await getRetailer(t, s.retailerId))?.orderingPausedAt,
		).toBeUndefined();
	});

	test("editing a comp that's on changes the details in place — keeps who/when turned it on and the status clock", async () => {
		const t = setup();
		const OTHER_ADMIN = "user_comp_admin_b";
		process.env.ADMIN_USER_IDS = `${ADMIN},${OTHER_ADMIN}`;
		const s = await seedSeller(t, "u_edit");
		await asAdmin(t).mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "pilot",
		});
		const first = await getSub(t, s.subId);
		vi.setSystemTime(Date.now() + 5 * DAY);
		await t
			.withIdentity({ subject: OTHER_ADMIN })
			.mutation(api.subscriptions.setComp, {
				retailerId: s.retailerId,
				kind: "sponsor",
				label: "Sponsored by Bearcamp",
				note: "renewed terms",
			});
		const sub = await getSub(t, s.subId);
		expect(sub?.status).toBe("active");
		expect(sub?.comp).toEqual({
			kind: "sponsor",
			label: "Sponsored by Bearcamp",
			note: "renewed terms",
			// Who first turned it on, and when — not the editor.
			grantedBy: ADMIN,
			grantedAt: first?.comp?.grantedAt,
		});
		// An edit is not a status flip.
		expect(sub?.updatedAt).toBe(first?.updatedAt);
		// Both writes are audited, each to the admin who made it.
		const audit = await auditFor(t, s.retailerId);
		expect(audit.map((a) => a.adminUserId)).toEqual([ADMIN, OTHER_ADMIN]);
	});

	test("a store with NO subscription row gets a comped row minted", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_norow");
		await t.run((ctx) => ctx.db.delete(s.subId));
		await asAdmin(t).mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "internal",
		});
		const sub = await t.run((ctx) =>
			ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", s.retailerId))
				.first(),
		);
		expect(sub?.comped).toBe(true);
		expect(sub?.status).toBe("active");
		expect(sub?.comp?.kind).toBe("internal");
	});
});

describe("revokeComp (turning the comp upgrade off) — the store becomes an expired seller", () => {
	test("past_due with no invoice and no free period, marked comp-ended, audited, seller emailed", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_revoke");
		const admin = asAdmin(t);
		await admin.mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "sponsor",
			label: "Sponsored by X",
		});
		const now = Date.now();
		await admin.mutation(api.subscriptions.revokeComp, {
			retailerId: s.retailerId,
		});
		const sub = await getSub(t, s.subId);
		expect(sub?.comped).toBe(false);
		expect(sub?.comp).toBeUndefined();
		expect(sub?.status).toBe("past_due");
		expect(sub?.compEndedAt).toBe(now);
		// The lock-flip moment the founder report reads.
		expect(sub?.updatedAt).toBe(now);
		// Expired, not a second trial.
		expect(sub?.trialEndsAt).toBeUndefined();
		expect(await invoicesFor(t, s.retailerId)).toHaveLength(0);

		const access = resolveAccess(sub ?? null);
		expect(access.frozen).toBe(true);
		expect(access.compEnded).toEqual({ at: now });

		const audit = await auditFor(t, s.retailerId);
		expect(audit.map((a) => a.action)).toContain("subscriptions.revokeComp");
		const emails = await compEmails(t, "compEnded");
		expect(emails).toHaveLength(1);
		expect(emails[0].args).toMatchObject({
			retailerId: s.retailerId,
			sponsorLabel: "Sponsored by X",
		});
	});

	test("the storefront stays live (buyers still order) while growth-writes are refused with comp-ended copy", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_livelock");
		await asAdmin(t).mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "partner",
		});
		// Created while comped — the product the buyer orders after the revoke.
		const productId = await s.asUser.mutation(api.products.create, {
			retailerId: s.retailerId,
			name: "Kuih Box",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			blockWhenOutOfStock: false,
			requiresProof: false,
			variants: [{ optionValues: [], price: 2500, onHand: 100 }],
		});
		await asAdmin(t).mutation(api.subscriptions.revokeComp, {
			retailerId: s.retailerId,
		});

		// Buyer side: unaffected.
		const order = await t.mutation(api.orders.create, {
			retailerId: s.retailerId,
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
		expect(order).toBeTruthy();

		// Seller side: locked — and told why, without a bill to go looking for.
		await expect(
			s.asUser.mutation(api.products.create, {
				retailerId: s.retailerId,
				name: "Another Box",
				currency: "MYR",
				imageStorageIds: [],
				sortOrder: 1,
				blockWhenOutOfStock: false,
				requiresProof: false,
				variants: [{ optionValues: [], price: 2500, onHand: 10 }],
			}),
		).rejects.toThrow(/sponsored access has ended/i);
	});

	test("choosing a plan and paying unlocks the store and clears the comp-ended marker", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_repay");
		const admin = asAdmin(t);
		await admin.mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "sponsor",
		});
		await admin.mutation(api.subscriptions.revokeComp, {
			retailerId: s.retailerId,
		});
		const { invoiceId } = await s.asUser.mutation(api.invoices.subscribeSelf, {
			plan: "pro",
			billingCycle: "monthly",
		});
		// A plan picked but not yet paid for doesn't unlock anything.
		expect((await getSub(t, s.subId))?.status).toBe("past_due");
		expect((await getSub(t, s.subId))?.compEndedAt).toBeTypeOf("number");

		await admin.mutation(api.invoices.markPaid, { invoiceId });
		const sub = await getSub(t, s.subId);
		expect(sub?.status).toBe("active");
		expect(sub?.compEndedAt).toBeUndefined();
		expect(resolveAccess(sub ?? null).frozen).toBe(false);
	});

	test("an expired store can't enter Off-Season Hold — there's no plan behind the lock to pause", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_nohold");
		const admin = asAdmin(t);
		await admin.mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "sponsor",
		});
		await admin.mutation(api.subscriptions.revokeComp, {
			retailerId: s.retailerId,
		});
		await expect(
			s.asUser.mutation(api.subscriptions.setSeasonalHold, {
				retailerId: s.retailerId,
				hold: true,
			}),
		).rejects.toThrow(/choose a plan/i);
		expect((await getSub(t, s.subId))?.status).toBe("past_due");
		expect(await invoicesFor(t, s.retailerId)).toHaveLength(0);
	});

	test("re-comping an expired store restores access and clears the marker", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_recomp");
		const admin = asAdmin(t);
		await admin.mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "sponsor",
		});
		await admin.mutation(api.subscriptions.revokeComp, {
			retailerId: s.retailerId,
		});
		await admin.mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "partner",
		});
		const sub = await getSub(t, s.subId);
		expect(sub?.comped).toBe(true);
		expect(sub?.status).toBe("active");
		expect(sub?.compEndedAt).toBeUndefined();
		// Turned off and on again starts fresh.
		expect(sub?.comp?.kind).toBe("partner");
	});

	test("refuses a store that isn't comped; non-admin refused", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_notcomped");
		await expect(
			asAdmin(t).mutation(api.subscriptions.revokeComp, {
				retailerId: s.retailerId,
			}),
		).rejects.toThrow(/isn't comped/i);
		await expect(
			s.asUser.mutation(api.subscriptions.revokeComp, {
				retailerId: s.retailerId,
			}),
		).rejects.toThrow(/not authorized/i);
	});
});

describe("daily cron", () => {
	test("a comp has no end date — a year of daily runs leaves it on, active and unbilled", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_forever");
		await asAdmin(t).mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "partner",
			label: "Sponsored by Y",
		});
		for (const days of [1, 30, 180, 365]) {
			vi.setSystemTime(Date.now() + days * DAY);
			await cron(t);
		}
		const sub = await getSub(t, s.subId);
		expect(sub?.comped).toBe(true);
		expect(sub?.status).toBe("active");
		expect(sub?.comp?.label).toBe("Sponsored by Y");
		expect(await invoicesFor(t, s.retailerId)).toHaveLength(0);
		expect(await compEmails(t, "compEnded")).toHaveLength(0);
	});

	test("a comped active row is never billed or locked — stale period end and stale overdue invoice included", async () => {
		const t = setup();
		const now = Date.now();
		const s = await seedSeller(t, "u_neverbilled", {
			status: "active",
			comped: true,
			currentPeriodEnd: now - DAY,
		});
		await t.run((ctx) =>
			ctx.db.insert(
				"invoices",
				invoiceRow(s.retailerId, s.subId, { invoiceNumber: "INV-TEST-0002" }),
			),
		);
		const res = await cron(t);
		expect(res.renewalsIssued).toBe(0);
		expect(res.overdue).toBe(0);
		expect((await getSub(t, s.subId))?.status).toBe("active");
	});

	test("turning a comp off keeps a saved auto-renew method attached but the machine charges NOTHING", async () => {
		const t = setup();
		const s = await seedSeller(t, "u_autorenew");
		const admin = asAdmin(t);
		await admin.mutation(api.subscriptions.setComp, {
			retailerId: s.retailerId,
			kind: "sponsor",
		});
		await t.run((ctx) =>
			ctx.db.patch(s.subId, {
				autoRenew: {
					provider: "hitpay" as const,
					method: "card",
					attachedAt: Date.now(),
				},
			}),
		);
		await admin.mutation(api.subscriptions.revokeComp, {
			retailerId: s.retailerId,
		});
		for (const days of [1, 2, 30]) {
			vi.setSystemTime(Date.now() + days * DAY);
			const res = await cron(t);
			expect(res.autoChargeRetries).toBe(0);
			expect(res.renewalsIssued).toBe(0);
		}
		const sub = await getSub(t, s.subId);
		expect(sub?.status).toBe("past_due");
		expect(sub?.autoRenew?.method).toBe("card");
		expect(await invoicesFor(t, s.retailerId)).toHaveLength(0);
		expect(
			(await scheduled(t)).some((j) => j.name.includes("chargeDueRenewal")),
		).toBe(false);
	});
});

describe("backfill", () => {
	test("heals a LEGACY comped row (no stamp) into a trial; a stamped comp survives a re-run", async () => {
		const t = setup();
		const legacy = await seedSeller(t, "u_legacy", {
			status: "active",
			comped: true,
		});
		const stamped = await seedSeller(t, "u_stamped");
		await asAdmin(t).mutation(api.subscriptions.setComp, {
			retailerId: stamped.retailerId,
			kind: "sponsor",
			label: "Sponsored by Z",
		});
		const res = await t.mutation(
			internal.subscriptions.internalBackfillSubscriptions,
			{},
		);
		expect(res.converted).toBe(1);
		const legacySub = await getSub(t, legacy.subId);
		expect(legacySub?.comped).toBe(false);
		expect(legacySub?.status).toBe("trialing");
		const stampedSub = await getSub(t, stamped.subId);
		expect(stampedSub?.comped).toBe(true);
		expect(stampedSub?.status).toBe("active");
		expect(stampedSub?.comp?.label).toBe("Sponsored by Z");
	});
});

test("turning a comp off releases a hold's storefront pause — defensive against a comped+held row", async () => {
	const t = setup();
	const s = await seedSeller(t, "user_comp_heldoff");
	// Unreachable through today's producers (`setComp` releases holds and
	// `canEnterHold` refuses comped rows) — built directly, the way a future
	// fifth producer of `comped` might. Without the release in `endComp`,
	// `orderingPausedAt` would survive under `past_due`, pausing the
	// storefront with no path that ever resumes it.
	const now = Date.now();
	await t.run(async (ctx) => {
		await ctx.db.patch(s.subId, {
			comped: true,
			comp: { kind: "sponsor" as const, grantedBy: ADMIN, grantedAt: now },
			status: "on_hold" as const,
			heldAt: now,
		});
		await ctx.db.patch(s.retailerId, { orderingPausedAt: now });
	});
	await t
		.withIdentity({ subject: ADMIN })
		.mutation(api.subscriptions.revokeComp, { retailerId: s.retailerId });
	const retailer = await getRetailer(t, s.retailerId);
	expect(retailer?.orderingPausedAt).toBeUndefined();
	const sub = await getSub(t, s.subId);
	expect(sub?.status).toBe("past_due");
	expect(sub?.heldAt).toBeUndefined();
});
