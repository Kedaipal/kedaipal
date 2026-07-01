/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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

	test("recentAuditForRetailer is admin-only", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		await expect(
			t
				.withIdentity({ subject: STRANGER })
				.query(api.admin.recentAuditForRetailer, { retailerId: retailer._id }),
		).rejects.toThrow(/Not authorized/);
	});
});

describe("counter checkout act-as", () => {
	test("admin opens a session for the seller (bound to the SELLER, audited)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		const { sessionId } = await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.counterCheckout.createCheckoutSession, {
				retailerId: retailer._id,
			});
		const session = await t.run(async (ctx) => ctx.db.get(sessionId));
		// The session belongs to the seller and binds the SELLER's userId, never the
		// acting admin's — so the inbound webhook still resolves the buyer correctly.
		expect(session?.retailerId).toBe(retailer._id);
		expect(session?.sellerUserId).toBe(OWNER);
		const rows = await t
			.withIdentity({ subject: ADMIN })
			.query(api.admin.recentAuditForRetailer, { retailerId: retailer._id });
		expect(
			rows.some((r) => r.action === "counterCheckout.createCheckoutSession"),
		).toBe(true);
	});

	test("a stranger cannot open a session for another store", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		await expect(
			t
				.withIdentity({ subject: STRANGER })
				.mutation(api.counterCheckout.createCheckoutSession, {
					retailerId: retailer._id,
				}),
		).rejects.toThrow(/Forbidden/);
	});

	test("admin can list the seller's open sessions", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.counterCheckout.createCheckoutSession, {
				retailerId: retailer._id,
			});
		const open = await t
			.withIdentity({ subject: ADMIN })
			.query(api.counterCheckout.listOpenSessions, { retailerId: retailer._id });
		expect(open.length).toBe(1);
		expect(open[0]?.status).toBe("awaiting_buyer");
	});
});
