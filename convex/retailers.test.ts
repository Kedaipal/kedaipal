/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { AUP_VERSION, PRIVACY_VERSION, TERMS_VERSION } from "./lib/legal";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER_A = "user_test_a";
const USER_B = "user_test_b";

async function seed(t: ReturnType<typeof convexTest>, userId: string, slug: string) {
	const asUser = t.withIdentity({ subject: userId });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Test Store",
		slug,
	});
	return asUser;
}

describe("retailers logo", () => {
	test("getRetailerBySlug returns resolved logoUrl when set", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "logo-store");
		const storageId = await t.run(async (ctx) => {
			const blob = new Blob([new Uint8Array([1, 2, 3, 4])], {
				type: "image/png",
			});
			return ctx.storage.store(blob);
		});
		await asA.mutation(api.retailers.updateSettings, {
			logoStorageId: storageId,
		});

		const result = await t.query(api.retailers.getRetailerBySlug, {
			slug: "logo-store",
		});
		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.retailer.logoStorageId).toBe(storageId);
		expect(result.retailer.logoUrl).toMatch(/^https?:\/\//);
	});

	test("getMyRetailer returns resolved logoUrl", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "my-logo");
		const storageId = await t.run(async (ctx) => {
			const blob = new Blob([new Uint8Array([1, 2, 3, 4])], {
				type: "image/png",
			});
			return ctx.storage.store(blob);
		});
		await asA.mutation(api.retailers.updateSettings, {
			logoStorageId: storageId,
		});

		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.logoStorageId).toBe(storageId);
		expect(me?.logoUrl).toMatch(/^https?:\/\//);
	});

	test("empty string clears the logo", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "clear-logo");
		const storageId = await t.run(async (ctx) => {
			const blob = new Blob([new Uint8Array([1, 2, 3, 4])], {
				type: "image/png",
			});
			return ctx.storage.store(blob);
		});
		await asA.mutation(api.retailers.updateSettings, {
			logoStorageId: storageId,
		});
		await asA.mutation(api.retailers.updateSettings, { logoStorageId: "" });

		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.logoStorageId).toBeUndefined();
		expect(me?.logoUrl).toBeUndefined();
	});

	test("getRetailerBySlug returns no logoUrl when none configured", async () => {
		const t = setup();
		await seed(t, USER_A, "no-logo");
		const result = await t.query(api.retailers.getRetailerBySlug, {
			slug: "no-logo",
		});
		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.retailer.logoUrl).toBeUndefined();
	});
});

describe("retailers slug rename", () => {
	test("rename parks old slug in history and activates new slug", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "old-slug");
		await asA.mutation(api.retailers.renameSlug, { newSlug: "new-slug" });

		const byNew = await t.query(api.retailers.getRetailerBySlug, { slug: "new-slug" });
		expect(byNew.status).toBe("ok");

		const byOld = await t.query(api.retailers.getRetailerBySlug, { slug: "old-slug" });
		expect(byOld).toEqual({ status: "redirect", to: "new-slug" });
	});

	test("rename fails when slug is taken by another retailer", async () => {
		const t = setup();
		await seed(t, USER_A, "taken");
		const asB = await seed(t, USER_B, "mine");
		await expect(
			asB.mutation(api.retailers.renameSlug, { newSlug: "taken" }),
		).rejects.toThrow(/taken/);
	});

	test("rename fails when target slug is parked in another retailer's history", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "original-a");
		await asA.mutation(api.retailers.renameSlug, { newSlug: "new-a" });
		// original-a is now in slugHistory for retailer A

		const asB = await seed(t, USER_B, "original-b");
		await expect(
			asB.mutation(api.retailers.renameSlug, { newSlug: "original-a" }),
		).rejects.toThrow(/reserved/);
	});

	test("owner can reclaim their own historical slug", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "ver-one");
		await asA.mutation(api.retailers.renameSlug, { newSlug: "ver-two" });
		await asA.mutation(api.retailers.renameSlug, { newSlug: "ver-one" });

		const byV1 = await t.query(api.retailers.getRetailerBySlug, { slug: "ver-one" });
		expect(byV1.status).toBe("ok");
		// ver-two should now be in history redirecting back to ver-one
		const byV2 = await t.query(api.retailers.getRetailerBySlug, { slug: "ver-two" });
		expect(byV2).toEqual({ status: "redirect", to: "ver-one" });
	});

	test("createRetailer cannot claim another retailer's parked slug", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "claimed");
		await asA.mutation(api.retailers.renameSlug, { newSlug: "renamed" });

		const asB = t.withIdentity({ subject: USER_B });
		await expect(
			asB.mutation(api.retailers.createRetailer, {
				storeName: "B Store",
				slug: "claimed",
			}),
		).rejects.toThrow(/reserved/);
	});

	test("checkSlugAvailability reports owner-reclaim as available", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "orig");
		await asA.mutation(api.retailers.renameSlug, { newSlug: "renamed" });

		const forOwner = await asA.query(api.retailers.checkSlugAvailability, {
			slug: "orig",
		});
		expect(forOwner).toEqual({ status: "available" });

		const asB = t.withIdentity({ subject: USER_B });
		const forOther = await asB.query(api.retailers.checkSlugAvailability, {
			slug: "orig",
		});
		expect(forOther).toEqual({ status: "taken" });
	});
});

describe("retailers legal consent", () => {
	async function readRetailer(
		t: ReturnType<typeof convexTest>,
		userId: string,
	) {
		return t.run(async (ctx) => {
			const rows = await ctx.db.query("retailers").collect();
			return rows.find((r) => r.userId === userId) ?? null;
		});
	}

	test("createRetailer stamps current versions + timestamps + IP", async () => {
		const t = setup();
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.retailers.createRetailer, {
			storeName: "Consent Store",
			slug: "consent",
			acceptanceIp: "203.0.113.7",
		});

		const row = await readRetailer(t, USER_A);
		expect(row?.termsVersion).toBe(TERMS_VERSION);
		expect(row?.privacyVersion).toBe(PRIVACY_VERSION);
		expect(row?.aupVersion).toBe(AUP_VERSION);
		expect(row?.acceptanceIp).toBe("203.0.113.7");
		expect(typeof row?.termsAcceptedAt).toBe("number");
		expect(typeof row?.privacyAcceptedAt).toBe("number");
		expect(typeof row?.aupAcceptedAt).toBe("number");
	});

	test("createRetailer omits IP when blank", async () => {
		const t = setup();
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.retailers.createRetailer, {
			storeName: "No IP Store",
			slug: "no-ip",
			acceptanceIp: "   ",
		});
		const row = await readRetailer(t, USER_A);
		expect(row?.acceptanceIp).toBeUndefined();
		// Consent is still stamped even without an IP.
		expect(row?.termsVersion).toBe(TERMS_VERSION);
	});

	test("getMyRetailer exposes accepted versions but not IP", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "expose");
		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.termsVersion).toBe(TERMS_VERSION);
		expect(me?.privacyVersion).toBe(PRIVACY_VERSION);
		expect(me?.aupVersion).toBe(AUP_VERSION);
		expect(me).not.toHaveProperty("acceptanceIp");
	});

	test("recordConsentAcceptance re-stamps versions and IP", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "restamp");
		// Simulate a stale prior acceptance.
		await t.run(async (ctx) => {
			const rows = await ctx.db.query("retailers").collect();
			const row = rows.find((r) => r.userId === USER_A);
			if (row) {
				await ctx.db.patch(row._id, {
					termsVersion: "2000-01-01",
					acceptanceIp: undefined,
				});
			}
		});

		await asA.mutation(api.retailers.recordConsentAcceptance, {
			acceptanceIp: "198.51.100.4",
		});

		const row = await readRetailer(t, USER_A);
		expect(row?.termsVersion).toBe(TERMS_VERSION);
		expect(row?.privacyVersion).toBe(PRIVACY_VERSION);
		expect(row?.aupVersion).toBe(AUP_VERSION);
		expect(row?.acceptanceIp).toBe("198.51.100.4");
	});

	test("recordConsentAcceptance errors when the user has no store", async () => {
		const t = setup();
		const asA = t.withIdentity({ subject: USER_A });
		await expect(
			asA.mutation(api.retailers.recordConsentAcceptance, {}),
		).rejects.toThrow(/No store/);
	});
});

describe("retailers greeting onboarding", () => {
	test("markGreetingSetupDone flips the flag for the authed retailer", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "greeting");

		const before = await asA.query(api.retailers.getMyRetailer);
		expect(before?.onboardingGreetingSetup ?? false).toBe(false);

		await asA.mutation(api.retailers.markGreetingSetupDone, {});

		const after = await asA.query(api.retailers.getMyRetailer);
		expect(after?.onboardingGreetingSetup).toBe(true);
	});

	test("markGreetingSetupDone is scoped per retailer", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "greeting-a");
		await seed(t, USER_B, "greeting-b");

		await asA.mutation(api.retailers.markGreetingSetupDone, {});

		const asB = t.withIdentity({ subject: USER_B });
		const b = await asB.query(api.retailers.getMyRetailer);
		expect(b?.onboardingGreetingSetup ?? false).toBe(false);
	});

	test("markGreetingSetupDone errors when the user has no store", async () => {
		const t = setup();
		const asA = t.withIdentity({ subject: USER_A });
		await expect(
			asA.mutation(api.retailers.markGreetingSetupDone, {}),
		).rejects.toThrow(/No store/);
	});
});

describe("retailers deleteUser (internal cascade)", () => {
	/**
	 * Seed a fully-populated tenant for USER_A: retailer + logo + payment QR,
	 * one product (with image), one customer, one order (with payment proof) +
	 * its order event, and a parked slugHistory row. Returns every id so the
	 * caller can assert each is purged.
	 */
	async function seedFullTenant(
		t: ReturnType<typeof convexTest>,
		userId: string,
		slug: string,
	) {
		await seed(t, userId, slug);
		return t.run(async (ctx) => {
			const retailers = await ctx.db.query("retailers").collect();
			const retailer = retailers.find((r) => r.userId === userId);
			if (!retailer) throw new Error("seed failed");

			const store = () =>
				ctx.storage.store(
					new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }),
				);
			const logoId = await store();
			const qrId = await store();
			const productImgId = await store();
			const proofId = await store();

			await ctx.db.patch(retailer._id, {
				logoStorageId: logoId,
				paymentInstructions: { qrImageStorageId: qrId },
			});

			const now = Date.now();
			const productId = await ctx.db.insert("products", {
				retailerId: retailer._id,
				name: "Kuih",
				price: 500,
				currency: "MYR",
				stock: 10,
				imageStorageIds: [productImgId],
				active: true,
				channel: "whatsapp",
				sortOrder: 0,
				createdAt: now,
				updatedAt: now,
			});
			const customerId = await ctx.db.insert("customers", {
				retailerId: retailer._id,
				waPhone: "60123456789",
				searchText: "60123456789",
				orderCount: 1,
				totalSpent: 500,
				firstOrderAt: now,
				lastOrderAt: now,
				createdAt: now,
				updatedAt: now,
			});
			const orderId = await ctx.db.insert("orders", {
				retailerId: retailer._id,
				shortId: "ORD-0001",
				customerId,
				items: [{ productId, name: "Kuih", price: 500, quantity: 1 }],
				subtotal: 500,
				total: 500,
				currency: "MYR",
				status: "pending",
				channel: "whatsapp",
				customer: { name: "Ali", waPhone: "60123456789" },
				paymentProofStorageId: proofId,
				createdAt: now,
				updatedAt: now,
			});
			const eventId = await ctx.db.insert("orderEvents", {
				orderId,
				status: "pending",
				createdAt: now,
			});
			const historyId = await ctx.db.insert("slugHistory", {
				oldSlug: `${slug}-old`,
				retailerId: retailer._id,
				expiresAt: now + 60_000,
			});

			return {
				retailerId: retailer._id,
				logoId,
				qrId,
				productImgId,
				proofId,
				productId,
				customerId,
				orderId,
				eventId,
				historyId,
			};
		});
	}

	test("purges retailer + all owned rows and storage files", async () => {
		const t = setup();
		const ids = await seedFullTenant(t, USER_A, "del-me");

		const result = await t.mutation(internal.retailers.deleteUser, {
			userId: USER_A,
		});
		expect(result.deleted).toBe(true);

		await t.run(async (ctx) => {
			expect(await ctx.db.get(ids.retailerId)).toBeNull();
			expect(await ctx.db.get(ids.productId)).toBeNull();
			expect(await ctx.db.get(ids.customerId)).toBeNull();
			expect(await ctx.db.get(ids.orderId)).toBeNull();
			expect(await ctx.db.get(ids.eventId)).toBeNull();
			expect(await ctx.db.get(ids.historyId)).toBeNull();

			expect(await ctx.storage.getUrl(ids.logoId)).toBeNull();
			expect(await ctx.storage.getUrl(ids.qrId)).toBeNull();
			expect(await ctx.storage.getUrl(ids.productImgId)).toBeNull();
			expect(await ctx.storage.getUrl(ids.proofId)).toBeNull();
		});
	});

	test("is idempotent — returns deleted:false when no retailer exists", async () => {
		const t = setup();
		const result = await t.mutation(internal.retailers.deleteUser, {
			userId: "user_does_not_exist",
		});
		expect(result.deleted).toBe(false);
	});

	test("does not touch another user's tenant", async () => {
		const t = setup();
		const aIds = await seedFullTenant(t, USER_A, "tenant-a");
		const bIds = await seedFullTenant(t, USER_B, "tenant-b");

		await t.mutation(internal.retailers.deleteUser, { userId: USER_A });

		await t.run(async (ctx) => {
			// A is gone…
			expect(await ctx.db.get(aIds.retailerId)).toBeNull();
			expect(await ctx.db.get(aIds.orderId)).toBeNull();
			// …B is untouched.
			expect(await ctx.db.get(bIds.retailerId)).not.toBeNull();
			expect(await ctx.db.get(bIds.productId)).not.toBeNull();
			expect(await ctx.db.get(bIds.customerId)).not.toBeNull();
			expect(await ctx.db.get(bIds.orderId)).not.toBeNull();
			expect(await ctx.db.get(bIds.eventId)).not.toBeNull();
			expect(await ctx.db.get(bIds.historyId)).not.toBeNull();
			expect(await ctx.storage.getUrl(bIds.logoId)).not.toBeNull();
			expect(await ctx.storage.getUrl(bIds.proofId)).not.toBeNull();
		});
	});
});

describe("retailers — pickup onboarding defaults", () => {
	test("createRetailer sets offerSelfCollect=true by default", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "pickup-default-store");
		const retailer = await asA.query(api.retailers.getMyRetailer);
		expect(retailer?.offerSelfCollect).toBe(true);
		// pickupSetupSeen stays unset until the seller actually visits the tab
		expect(retailer?.pickupSetupSeen).toBeUndefined();
	});
});

describe("retailers.markPickupSetupSeen", () => {
	test("returns updated=false when unauthenticated", async () => {
		const t = setup();
		const result = await t.mutation(api.retailers.markPickupSetupSeen, {});
		expect(result.updated).toBe(false);
	});

	test("returns updated=false when the user has no retailer yet", async () => {
		const t = setup();
		const asA = t.withIdentity({ subject: USER_A });
		// No createRetailer — user is signed in but hasn't onboarded.
		const result = await asA.mutation(api.retailers.markPickupSetupSeen, {});
		expect(result.updated).toBe(false);
	});

	test("first call patches pickupSetupSeen=true and returns updated=true", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "seen-store");
		const before = await asA.query(api.retailers.getMyRetailer);
		expect(before?.pickupSetupSeen).toBeUndefined();

		const result = await asA.mutation(api.retailers.markPickupSetupSeen, {});
		expect(result.updated).toBe(true);

		const after = await asA.query(api.retailers.getMyRetailer);
		expect(after?.pickupSetupSeen).toBe(true);
	});

	test("second call is a no-op (idempotent)", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "seen-idempotent");
		await asA.mutation(api.retailers.markPickupSetupSeen, {});

		const second = await asA.mutation(api.retailers.markPickupSetupSeen, {});
		expect(second.updated).toBe(false);
		const retailer = await asA.query(api.retailers.getMyRetailer);
		expect(retailer?.pickupSetupSeen).toBe(true);
	});

	test("scoped per user — calling as USER_A does not affect USER_B's retailer", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "seen-a");
		const asB = await seed(t, USER_B, "seen-b");

		await asA.mutation(api.retailers.markPickupSetupSeen, {});

		const aRetailer = await asA.query(api.retailers.getMyRetailer);
		const bRetailer = await asB.query(api.retailers.getMyRetailer);
		expect(aRetailer?.pickupSetupSeen).toBe(true);
		expect(bRetailer?.pickupSetupSeen).toBeUndefined();
	});
});
