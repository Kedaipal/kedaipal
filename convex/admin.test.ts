/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { devStorePurgeAllowed } from "./admin";
import schema from "./schema";

// Admin Console act-as (ClickUp 86ey25er1). Proves the owner-OR-admin access
// seam (requireRetailerAccess), the subscription bypass for act-as writes, the
// audit-log stamping, and the admin-gated directory/read endpoints.

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const ADMIN = "user_admin";
const OWNER = "user_owner";
const STRANGER = "user_stranger";

let prevAdminEnv: string | undefined;
beforeAll(() => {
	prevAdminEnv = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
});
afterAll(() => {
	process.env.ADMIN_USER_IDS = prevAdminEnv;
});

async function seedRetailer(t: ReturnType<typeof setup>, userId: string) {
	const asUser = t.withIdentity({ subject: userId });
	const slug = `store-${userId.replace(/[^a-z0-9]/g, "")}`;
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: `Store ${userId}`,
		slug,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

const baseProduct = (retailerId: Id<"retailers">) => ({
	retailerId,
	name: "Tent 2P",
	currency: "MYR",
	imageStorageIds: [],
	sortOrder: 0,
	blockWhenOutOfStock: true,
	variants: [{ optionValues: [], price: 12000, onHand: 5 }],
});

/** Force the seller's subscription into a real (non-comped) past_due soft-lock. */
async function makePastDue(t: ReturnType<typeof setup>, retailerId: Id<"retailers">) {
	await t.run(async (ctx) => {
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		if (!sub) throw new Error("no sub");
		await ctx.db.patch(sub._id, { status: "past_due", comped: false });
	});
}

async function auditCount(t: ReturnType<typeof setup>, retailerId: Id<"retailers">) {
	return t.run(async (ctx) =>
		(
			await ctx.db
				.query("adminAuditLog")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.collect()
		).length,
	);
}

describe("admin act-as access", () => {
	test("owner can write to their own store (no audit row)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		await t
			.withIdentity({ subject: OWNER })
			.mutation(api.products.create, baseProduct(retailer._id));
		expect(await auditCount(t, retailer._id)).toBe(0);
	});

	test("an admin retiring a seller's country-setup rows is audited (PR #221 review)", async () => {
		// These acks suppress a payments-at-risk warning the SELLER was meant to
		// confirm, and there is no un-ack short of another country switch — so
		// "the seller checked their bank details" must never be indistinguishable
		// from "an admin clicked through during white-glove setup".
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, {
				country: "SG",
				countryChangedAt: Date.now(),
				countryChangedFrom: "MY",
				paymentMethods: [
					{
						type: "bank" as const,
						label: "Maybank",
						bankName: "Maybank",
						bankAccountName: "Owner",
						bankAccountNumber: "512345678901",
						sortOrder: 0,
					},
				],
			});
		});

		const { acked } = await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.retailers.ackCountrySetup, { retailerId: retailer._id });
		expect(acked).toBe(1);
		expect(await auditCount(t, retailer._id)).toBe(1);
		const rows = await t
			.withIdentity({ subject: ADMIN })
			.query(api.admin.recentAuditForRetailer, { retailerId: retailer._id });
		expect(rows[0]).toMatchObject({ action: "retailers.ackCountrySetup" });
	});

	test("the OWNER doing the same ack is not audited (routine own-store write)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, {
				country: "SG",
				countryChangedAt: Date.now(),
				countryChangedFrom: "MY",
				paymentMethods: [
					{
						type: "bank" as const,
						label: "Maybank",
						bankName: "Maybank",
						bankAccountName: "Owner",
						bankAccountNumber: "512345678901",
						sortOrder: 0,
					},
				],
			});
		});
		await t
			.withIdentity({ subject: OWNER })
			.mutation(api.retailers.ackCountrySetup, {});
		expect(await auditCount(t, retailer._id)).toBe(0);
	});

	test("admin can write on a seller's behalf and it is audited", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		const productId = await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.products.create, baseProduct(retailer._id));
		expect(await auditCount(t, retailer._id)).toBe(1);
		const rows = await t
			.withIdentity({ subject: ADMIN })
			.query(api.admin.recentAuditForRetailer, { retailerId: retailer._id });
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			adminUserId: ADMIN,
			action: "products.create",
			targetId: productId,
		});
	});

	test("a non-admin, non-owner is denied (Forbidden)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		await expect(
			t
				.withIdentity({ subject: STRANGER })
				.mutation(api.products.create, baseProduct(retailer._id)),
		).rejects.toThrow(/Forbidden/);
		expect(await auditCount(t, retailer._id)).toBe(0);
	});

	test("admin write bypasses the past_due soft-lock; owner write does not", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		await makePastDue(t, retailer._id);

		// Owner is soft-locked out of growth writes.
		await expect(
			t
				.withIdentity({ subject: OWNER })
				.mutation(api.products.create, baseProduct(retailer._id)),
		).rejects.toThrow(/past due/i);

		// Admin onboarding the (unpaid) store is not blocked.
		await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.products.create, baseProduct(retailer._id));
		expect(await auditCount(t, retailer._id)).toBe(1);
	});

	test("admin's OWN past_due store is never soft-locked (free forever, no audit)", async () => {
		const t = setup();
		// Store owned by the admin themselves — not an act-as target.
		const retailer = await seedRetailer(t, ADMIN);
		await makePastDue(t, retailer._id);

		// Past the trial, an admin keeps full growth-write access to their own store
		// (a plain owner would be blocked here — see the test above).
		await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.products.create, baseProduct(retailer._id));
		await t.withIdentity({ subject: ADMIN }).mutation(api.retailers.updateSettings, {
			retailerId: retailer._id,
			storeName: "Admin's Own Store",
		});

		// It's their own store (not act-as), so nothing is audited.
		expect(await auditCount(t, retailer._id)).toBe(0);
	});

	test("updateSettings act-as edits the seller store, audited + bypasses lock", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		await makePastDue(t, retailer._id);
		await t.withIdentity({ subject: ADMIN }).mutation(api.retailers.updateSettings, {
			retailerId: retailer._id,
			storeName: "Renamed By Admin",
		});
		const after = await t
			.withIdentity({ subject: ADMIN })
			.query(api.retailers.getRetailerForAdmin, { retailerId: retailer._id });
		expect(after?.storeName).toBe("Renamed By Admin");
		const rows = await t
			.withIdentity({ subject: ADMIN })
			.query(api.admin.recentAuditForRetailer, { retailerId: retailer._id });
		expect(rows.some((r) => r.action === "retailers.updateSettings")).toBe(true);
	});
});

describe("admin console reads", () => {
	test("getRetailerForAdmin returns the store with actingAsAdmin for an admin", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		const payload = await t
			.withIdentity({ subject: ADMIN })
			.query(api.retailers.getRetailerForAdmin, { retailerId: retailer._id });
		expect(payload?.storeName).toBe(`Store ${OWNER}`);
		expect(payload?.actingAsAdmin).toBe(true);
	});

	test("getRetailerForAdmin rejects a non-admin", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		await expect(
			t
				.withIdentity({ subject: STRANGER })
				.query(api.retailers.getRetailerForAdmin, { retailerId: retailer._id }),
		).rejects.toThrow(/Not authorized/);
	});

	test("listSellersForAdmin lists sellers for an admin and rejects others", async () => {
		const t = setup();
		await seedRetailer(t, OWNER);
		const rows = await t
			.withIdentity({ subject: ADMIN })
			.query(api.admin.listSellersForAdmin, {});
		expect(rows.some((r) => r.ownerUserId === OWNER)).toBe(true);

		await expect(
			t.withIdentity({ subject: STRANGER }).query(api.admin.listSellersForAdmin, {}),
		).rejects.toThrow(/Not authorized/);
	});

	test("listSellersForAdmin carries signupSource so acquisition is checkable in the console", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, { signupSource: "spotlight-thg" });
		});
		const rows = await t
			.withIdentity({ subject: ADMIN })
			.query(api.admin.listSellersForAdmin, {});
		expect(rows.find((r) => r.ownerUserId === OWNER)?.signupSource).toBe(
			"spotlight-thg",
		);
	});

	test("listSellersForAdmin flags admin-owned stores via ownerIsAdmin", async () => {
		const t = setup();
		await seedRetailer(t, OWNER);
		await seedRetailer(t, ADMIN);
		const rows = await t
			.withIdentity({ subject: ADMIN })
			.query(api.admin.listSellersForAdmin, {});
		// The seller's store is not admin-owned; the admin's own store is.
		expect(rows.find((r) => r.ownerUserId === OWNER)?.ownerIsAdmin).toBe(false);
		expect(rows.find((r) => r.ownerUserId === ADMIN)?.ownerIsAdmin).toBe(true);
	});

	test("recentAuditForRetailer is admin-only", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		await expect(
			t
				.withIdentity({ subject: STRANGER })
				.query(api.admin.recentAuditForRetailer, { retailerId: retailer._id }),
		).rejects.toThrow(/Not authorized/);
	});

	test("startActAsSession audits tenant entry (read-side trail); admin-only", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);

		// Non-admin can't open a session-start row on another store.
		await expect(
			t
				.withIdentity({ subject: STRANGER })
				.mutation(api.admin.startActAsSession, { retailerId: retailer._id }),
		).rejects.toThrow(/Not authorized/);
		expect(await auditCount(t, retailer._id)).toBe(0);

		// Admin entry is logged even with no subsequent write.
		await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.admin.startActAsSession, { retailerId: retailer._id });
		const rows = await t
			.withIdentity({ subject: ADMIN })
			.query(api.admin.recentAuditForRetailer, { retailerId: retailer._id });
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			adminUserId: ADMIN,
			action: "actAs.sessionStart",
		});
	});
});

describe("counter checkout act-as", () => {
	test("admin generates the seller's store QR (bound to the SELLER, audited)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		const { token } = await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.counterCheckout.ensureCounterQrToken, {
				retailerId: retailer._id,
			});
		// The token lands on the seller's store, not the admin's.
		const seller = await t.run(async (ctx) => ctx.db.get(retailer._id));
		expect(seller?.counterQrToken).toBe(token);
		const rows = await t
			.withIdentity({ subject: ADMIN })
			.query(api.admin.recentAuditForRetailer, { retailerId: retailer._id });
		expect(
			rows.some((r) => r.action === "counterCheckout.ensureCounterQrToken"),
		).toBe(true);
	});

	test("a stranger cannot generate a store QR for another store", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		await expect(
			t
				.withIdentity({ subject: STRANGER })
				.mutation(api.counterCheckout.ensureCounterQrToken, {
					retailerId: retailer._id,
				}),
		).rejects.toThrow(/Forbidden/);
	});

	test("admin can list the seller's open sessions", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		const { token } = await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.counterCheckout.ensureCounterQrToken, {
				retailerId: retailer._id,
			});
		// A walk-in scan opens a session bound to the SELLER's store.
		await t.mutation(internal.counterCheckout.startSessionFromStoreQr, {
			token,
			waPhone: "60123456789",
		});
		const open = await t
			.withIdentity({ subject: ADMIN })
			.query(api.counterCheckout.listOpenSessions, { retailerId: retailer._id });
		expect(open.length).toBe(1);
		expect(open[0]?.origin).toBe("store_qr");
	});
});

// Dev-only store purge (z8r3fdbmc9) — the admin test-reset that reuses the
// PDPA erasure cascade. The gate is mutation-tested guard by guard: the env
// flag fails closed, and the prod deny-list beats even a set flag.
describe("dev-only store purge", () => {
	let prevPurgeFlag: string | undefined;
	beforeAll(() => {
		prevPurgeFlag = process.env.DEV_STORE_PURGE_ENABLED;
		process.env.DEV_STORE_PURGE_ENABLED = "true";
	});
	afterAll(() => {
		if (prevPurgeFlag === undefined) delete process.env.DEV_STORE_PURGE_ENABLED;
		else process.env.DEV_STORE_PURGE_ENABLED = prevPurgeFlag;
	});

	test("devStorePurgeAllowed fails closed without the exact opt-in flag", () => {
		const prev = process.env.DEV_STORE_PURGE_ENABLED;
		try {
			delete process.env.DEV_STORE_PURGE_ENABLED;
			expect(devStorePurgeAllowed()).toBe(false);
			process.env.DEV_STORE_PURGE_ENABLED = "";
			expect(devStorePurgeAllowed()).toBe(false);
			process.env.DEV_STORE_PURGE_ENABLED = "yes";
			expect(devStorePurgeAllowed()).toBe(false);
			process.env.DEV_STORE_PURGE_ENABLED = "true";
			expect(devStorePurgeAllowed()).toBe(true);
			process.env.DEV_STORE_PURGE_ENABLED = "1";
			expect(devStorePurgeAllowed()).toBe(true);
		} finally {
			if (prev === undefined) delete process.env.DEV_STORE_PURGE_ENABLED;
			else process.env.DEV_STORE_PURGE_ENABLED = prev;
		}
	});

	test("the prod deployment is denied even with the flag set", () => {
		const prev = process.env.CONVEX_CLOUD_URL;
		try {
			process.env.CONVEX_CLOUD_URL =
				"https://peaceful-falcon-152.convex.cloud";
			expect(devStorePurgeAllowed()).toBe(false);
		} finally {
			if (prev === undefined) delete process.env.CONVEX_CLOUD_URL;
			else process.env.CONVEX_CLOUD_URL = prev;
		}
	});

	test("non-admins cannot purge; a wrong slug echo is refused", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		await expect(
			t.withIdentity({ subject: STRANGER }).mutation(
				api.admin.purgeStoreForAdmin,
				{ retailerId: retailer._id, confirmSlug: retailer.slug },
			),
		).rejects.toThrow(/Not authorized/);
		await expect(
			t.withIdentity({ subject: ADMIN }).mutation(
				api.admin.purgeStoreForAdmin,
				{ retailerId: retailer._id, confirmSlug: "some-other-store" },
			),
		).rejects.toThrow(/doesn't match/);
		// Neither attempt touched the store.
		await t.run(async (ctx) => {
			expect(await ctx.db.get(retailer._id)).not.toBeNull();
		});
	});

	test("refused outright when the flag is off — the gate, mutation-proofed", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		const prev = process.env.DEV_STORE_PURGE_ENABLED;
		try {
			delete process.env.DEV_STORE_PURGE_ENABLED;
			await expect(
				t.withIdentity({ subject: ADMIN }).mutation(
					api.admin.purgeStoreForAdmin,
					{ retailerId: retailer._id, confirmSlug: retailer.slug },
				),
			).rejects.toThrow(/dev-deployment/);
		} finally {
			process.env.DEV_STORE_PURGE_ENABLED = prev;
		}
	});

	test("a running purge locks the store — no second purge, no act-as entry, and the directory says so", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		const admin = t.withIdentity({ subject: ADMIN });
		await admin.mutation(api.admin.purgeStoreForAdmin, {
			retailerId: retailer._id,
			confirmSlug: retailer.slug,
		});
		// Scheduled cascade NOT driven — the store sits mid-purge.
		await expect(
			admin.mutation(api.admin.purgeStoreForAdmin, {
				retailerId: retailer._id,
				confirmSlug: retailer.slug,
			}),
		).rejects.toThrow(/already running/);
		await expect(
			admin.mutation(api.admin.startActAsSession, {
				retailerId: retailer._id,
			}),
		).rejects.toThrow(/being purged/);
		const rows = await admin.query(api.admin.listSellersForAdmin, {});
		expect(rows.find((r) => r._id === retailer._id)?.purging).toBe(true);
	});

	test("a stale purge stamp (crashed cascade) can be re-run — the recovery path", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		// Simulate a cascade that died 11 minutes ago, past PURGE_RETRY_AFTER_MS.
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, {
				purgeStartedAt: Date.now() - 11 * 60 * 1000,
			});
		});
		await t.withIdentity({ subject: ADMIN }).mutation(
			api.admin.purgeStoreForAdmin,
			{ retailerId: retailer._id, confirmSlug: retailer.slug },
		);
		// Re-armed: the stamp is fresh again.
		await t.run(async (ctx) => {
			const row = await ctx.db.get(retailer._id);
			expect(
				Date.now() - (row?.purgeStartedAt ?? 0),
			).toBeLessThan(60 * 1000);
		});
	});

	test("purge erases the tenant, spares bystanders, audits itself, and frees the login for onboarding", async () => {
		vi.useFakeTimers();
		try {
			const t = setup();
			const victim = await seedRetailer(t, OWNER);
			const bystander = await seedRetailer(t, STRANGER);
			await t
				.withIdentity({ subject: OWNER })
				.mutation(api.products.create, baseProduct(victim._id));
			await t
				.withIdentity({ subject: STRANGER })
				.mutation(api.products.create, baseProduct(bystander._id));

			await t.withIdentity({ subject: ADMIN }).mutation(
				api.admin.purgeStoreForAdmin,
				{ retailerId: victim._id, confirmSlug: victim.slug },
			);
			// The cascade self-chains through the scheduler — drive it to the end.
			await t.finishAllScheduledFunctions(vi.runAllTimers);

			await t.run(async (ctx) => {
				expect(await ctx.db.get(victim._id)).toBeNull();
				const products = await ctx.db.query("products").collect();
				// Only the bystander's catalog survives.
				expect(products.length).toBe(1);
				expect(products[0]?.retailerId).toBe(bystander._id);
				expect(await ctx.db.get(bystander._id)).not.toBeNull();
				// The destructive action is audited, and the audit row outlives the
				// tenant (adminAuditLog is retained by the cascade, by decision).
				const audit = await ctx.db.query("adminAuditLog").collect();
				expect(
					audit.some(
						(row) =>
							row.action === "admin.purgeStore" &&
							row.retailerId === victim._id &&
							row.adminUserId === ADMIN,
					),
				).toBe(true);
			});

			// The whole point: the owner's login now has no store, so /onboarding
			// treats it as a fresh account.
			expect(
				await t
					.withIdentity({ subject: OWNER })
					.query(api.retailers.getMyRetailer),
			).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});
});
