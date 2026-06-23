/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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

describe("retailers payment methods", () => {
	test("updateSettings saves the array, re-numbers sortOrder, clears legacy", async () => {
		const t = setup();
		const asA = await seed(t, "user_pm_a", "pm-a");
		const qrId = await t.run(async (ctx) =>
			ctx.storage.store(
				new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }),
			),
		);
		// Pre-seed a legacy single object to prove it's cleared on multi-method save.
		await asA.mutation(api.retailers.updateSettings, {
			paymentInstructions: { bankName: "Old Bank", bankAccountNumber: "111" },
		});

		await asA.mutation(api.retailers.updateSettings, {
			paymentMethods: [
				{ type: "bank", label: "Maybank", bankAccountNumber: "  5123  " },
				{ type: "qr", label: "DuitNow", qrImageStorageId: qrId },
				// Empty bank — dropped by sanitize.
				{ type: "bank", label: "Empty" },
			],
		});

		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.paymentMethods).toHaveLength(2);
		expect(me?.paymentMethods?.[0]).toMatchObject({
			type: "bank",
			label: "Maybank",
			bankAccountNumber: "5123",
			sortOrder: 0,
		});
		expect(me?.paymentMethods?.[1]).toMatchObject({
			type: "qr",
			label: "DuitNow",
			sortOrder: 1,
		});
		// Legacy object cleared on the underlying row.
		const row = await t.run(async (ctx) =>
			ctx.db
				.query("retailers")
				.withIndex("by_user", (q) => q.eq("userId", "user_pm_a"))
				.first(),
		);
		expect(row?.paymentInstructions).toBeUndefined();
	});

	test("garbage-collects orphaned QR blobs on remove / replace", async () => {
		const t = setup();
		const asA = await seed(t, "user_pm_gc", "pm-gc");
		const storeBlob = () =>
			t.run(async (ctx) =>
				ctx.storage.store(
					new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }),
				),
			);
		const exists = async (id: string) =>
			(await t.run(async (ctx) => ctx.storage.getUrl(id))) !== null;

		const qr1 = await storeBlob();
		const qr2 = await storeBlob();
		await asA.mutation(api.retailers.updateSettings, {
			paymentMethods: [
				{ type: "qr", label: "DuitNow", qrImageStorageId: qr1 },
				{ type: "qr", label: "TNG", qrImageStorageId: qr2 },
			],
		});
		expect(await exists(qr1)).toBe(true);
		expect(await exists(qr2)).toBe(true);

		// Remove the TNG method and replace DuitNow's image with a new blob.
		const qr1b = await storeBlob();
		await asA.mutation(api.retailers.updateSettings, {
			paymentMethods: [
				{ type: "qr", label: "DuitNow", qrImageStorageId: qr1b },
			],
		});
		// Both the removed method's blob and the replaced one are GC'd; the new one stays.
		expect(await exists(qr2)).toBe(false); // method deleted
		expect(await exists(qr1)).toBe(false); // image replaced
		expect(await exists(qr1b)).toBe(true); // current
	});

	test("backfill migrates legacy → array and clears legacy; idempotent", async () => {
		const t = setup();
		const asA = await seed(t, "user_pm_b", "pm-b");
		const qrId = await t.run(async (ctx) =>
			ctx.storage.store(
				new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }),
			),
		);
		await asA.mutation(api.retailers.updateSettings, {
			paymentInstructions: {
				bankName: "Maybank",
				bankAccountNumber: "5123",
				qrImageStorageId: qrId,
			},
		});

		const first = await t.mutation(internal.retailers.backfillPaymentMethods, {});
		expect(first.migrated).toBe(1);

		const me = await asA.query(api.retailers.getMyRetailer);
		// bank + qr → 2 methods.
		expect(me?.paymentMethods).toHaveLength(2);
		const row = await t.run(async (ctx) =>
			ctx.db
				.query("retailers")
				.withIndex("by_user", (q) => q.eq("userId", "user_pm_b"))
				.first(),
		);
		expect(row?.paymentInstructions).toBeUndefined();

		// Second run is a no-op (already migrated).
		const second = await t.mutation(internal.retailers.backfillPaymentMethods, {});
		expect(second.migrated).toBe(0);
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

describe("retailers — fulfilment defaults & invariant", () => {
	async function addPickup(
		asUser: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
		retailerId: Id<"retailers">,
	) {
		await asUser.mutation(api.pickupLocations.create, {
			retailerId,
			label: "Studio",
			address: "12 Jln Tun Razak, 50400 Kuala Lumpur",
		});
	}

	test("createRetailer sets offerDelivery=true by default", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "delivery-default-store");
		const retailer = await asA.query(api.retailers.getMyRetailer);
		expect(retailer?.offerDelivery).toBe(true);
	});

	test("turns delivery off when self-collect has an active location", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "pickup-only-store");
		const retailer = await asA.query(api.retailers.getMyRetailer);
		if (!retailer) throw new Error("no retailer");
		await addPickup(asA, retailer._id);

		await asA.mutation(api.retailers.updateSettings, { offerDelivery: false });

		const after = await asA.query(api.retailers.getMyRetailer);
		expect(after?.offerDelivery).toBe(false);
		expect(after?.offerSelfCollect).toBe(true);
	});

	test("rejects turning delivery off with no active pickup location", async () => {
		const t = setup();
		// offerSelfCollect defaults true, but zero active locations → self-collect
		// is not a WORKING method, so delivery-off would strand the storefront.
		const asA = await seed(t, USER_A, "no-pickup-store");
		await expect(
			asA.mutation(api.retailers.updateSettings, { offerDelivery: false }),
		).rejects.toThrow(/pickup location/i);
	});

	test("rejects turning delivery off when self-collect is also off", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "both-off-store");
		await asA.mutation(api.retailers.updateSettings, {
			offerSelfCollect: false,
		});
		await expect(
			asA.mutation(api.retailers.updateSettings, { offerDelivery: false }),
		).rejects.toThrow(/at least one/i);
	});

	test("rejects turning self-collect off when delivery is also off", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "selfcollect-off-store");
		const retailer = await asA.query(api.retailers.getMyRetailer);
		if (!retailer) throw new Error("no retailer");
		await addPickup(asA, retailer._id);
		// Delivery off is allowed (self-collect works); now removing self-collect
		// too would leave zero methods.
		await asA.mutation(api.retailers.updateSettings, { offerDelivery: false });
		await expect(
			asA.mutation(api.retailers.updateSettings, { offerSelfCollect: false }),
		).rejects.toThrow(/at least one/i);
	});

	test("allows turning self-collect off while delivery stays on", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "delivery-only-store");
		await asA.mutation(api.retailers.updateSettings, {
			offerSelfCollect: false,
		});
		const after = await asA.query(api.retailers.getMyRetailer);
		expect(after?.offerSelfCollect).toBe(false);
		expect(after?.offerDelivery).toBe(true);
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

describe("statusLabels (Phase 1 order status customization)", () => {
	test("updateSettings saves labels; getMyRetailer surfaces them", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "labels-store");
		await asA.mutation(api.retailers.updateSettings, {
			statusLabels: {
				en: { shipped: "Out for delivery", delivered: "Done" },
				ms: { shipped: "Dalam penghantaran" },
			},
		});

		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.statusLabels).toEqual({
			en: { shipped: "Out for delivery", delivered: "Done" },
			ms: { shipped: "Dalam penghantaran" },
		});
	});

	test("trims whitespace and drops empty / whitespace-only labels", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "labels-trim");
		await asA.mutation(api.retailers.updateSettings, {
			statusLabels: {
				en: {
					shipped: "  Ready to collect  ",
					packed: "   ", // whitespace-only → dropped
					delivered: "", // empty → dropped
				},
			},
		});

		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.statusLabels).toEqual({ en: { shipped: "Ready to collect" } });
	});

	test("an all-empty payload clears statusLabels back to undefined", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "labels-clear");
		await asA.mutation(api.retailers.updateSettings, {
			statusLabels: { en: { shipped: "Ready" } },
		});
		// Now blank every field — sanitize collapses to undefined.
		await asA.mutation(api.retailers.updateSettings, {
			statusLabels: { en: { shipped: "" }, ms: { packed: "   " } },
		});

		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.statusLabels).toBeUndefined();
	});

	test("rejects a label over the 24-char cap", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "labels-cap");
		await expect(
			asA.mutation(api.retailers.updateSettings, {
				statusLabels: {
					en: { shipped: "x".repeat(25) },
				},
			}),
		).rejects.toThrow(/24 characters/);
	});

	test("accepts a label exactly at the 24-char cap", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "labels-cap-ok");
		const exact = "x".repeat(24);
		await asA.mutation(api.retailers.updateSettings, {
			statusLabels: { en: { shipped: exact } },
		});
		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.statusLabels?.en?.shipped).toBe(exact);
	});

	test("orders.get surfaces the retailer's statusLabels + locale", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "labels-order");
		await asA.mutation(api.retailers.updateSettings, {
			locale: "ms",
			statusLabels: { ms: { shipped: "Sedia diambil" } },
		});
		const retailer = await asA.query(api.retailers.getMyRetailer);
		if (!retailer) throw new Error("no retailer");

		// Insert an order directly so we can read it back through orders.get.
		const shortId = "ORD-TEST";
		await t.run(async (ctx) => {
			await ctx.db.insert("orders", {
				retailerId: retailer._id,
				shortId,
				items: [],
				subtotal: 0,
				total: 0,
				currency: "MYR",
				status: "shipped",
				channel: "whatsapp",
				customer: {},
				deliveryMethod: "self_collect",
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		const order = await t.query(api.orders.get, { shortId });
		expect(order?.retailerLocale).toBe("ms");
		expect(order?.statusLabels).toEqual({ ms: { shipped: "Sedia diambil" } });
	});
});

describe("orderStages (Phase 2 custom stages)", () => {
	const SUIT = [
		{ anchor: "confirmed" as const, label: { en: "Accepted" }, notify: true },
		{ anchor: "packed" as const, label: { en: "Cleaning", ms: "Mencuci" }, notify: false },
		{ anchor: "packed" as const, label: { en: "Drying" }, notify: false, description: { en: "1–2 days" } },
		{ anchor: "delivered" as const, label: { en: "Collected" }, notify: true },
	];

	test("saves stages; getMyRetailer surfaces them with ids + renumbered sortOrder", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "stages-store");
		await asA.mutation(api.retailers.updateSettings, { orderStages: SUIT });

		const me = await asA.query(api.retailers.getMyRetailer);
		const stages = me?.orderStages;
		expect(stages).toHaveLength(4);
		// sortOrder renumbered to array order; every stage got a stable id.
		expect(stages?.map((s) => s.sortOrder)).toEqual([0, 1, 2, 3]);
		expect(stages?.every((s) => typeof s.id === "string" && s.id.length > 0)).toBe(true);
		expect(stages?.[1]).toMatchObject({ anchor: "packed", label: { en: "Cleaning", ms: "Mencuci" } });
		expect(stages?.[2].description).toEqual({ en: "1–2 days" });
	});

	test("trims labels and drops blank ms/description fields", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "stages-trim");
		await asA.mutation(api.retailers.updateSettings, {
			orderStages: [
				{ anchor: "confirmed", label: { en: "  Accepted  ", ms: "   " }, notify: true, description: { en: "", ms: "  " } },
			],
		});
		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.orderStages?.[0].label).toEqual({ en: "Accepted" });
		expect(me?.orderStages?.[0].description).toBeUndefined();
	});

	test("reusing a supplied id keeps it stable across saves", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "stages-stable");
		await asA.mutation(api.retailers.updateSettings, { orderStages: SUIT });
		const first = await asA.query(api.retailers.getMyRetailer);
		const ids = first?.orderStages?.map((s) => s.id) ?? [];
		// Re-save echoing the ids back → unchanged.
		await asA.mutation(api.retailers.updateSettings, {
			orderStages: (first?.orderStages ?? []).map((s) => ({ ...s })),
		});
		const second = await asA.query(api.retailers.getMyRetailer);
		expect(second?.orderStages?.map((s) => s.id)).toEqual(ids);
	});

	test("empty array clears stages back to undefined (use defaults)", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "stages-clear");
		await asA.mutation(api.retailers.updateSettings, { orderStages: SUIT });
		await asA.mutation(api.retailers.updateSettings, { orderStages: [] });
		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.orderStages).toBeUndefined();
	});

	test("rejects a backwards anchor (monotonic rule)", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "stages-mono");
		await expect(
			asA.mutation(api.retailers.updateSettings, {
				orderStages: [
					{ anchor: "packed", label: { en: "Cleaning" }, notify: false },
					{ anchor: "confirmed", label: { en: "Accepted" }, notify: true },
				],
			}),
		).rejects.toThrow(/out of order/i);
	});

	test("rejects exceeding the 20-stage cap", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "stages-cap");
		const many = Array.from({ length: 21 }, () => ({
			anchor: "packed" as const,
			label: { en: "Step" },
			notify: false,
		}));
		await expect(
			asA.mutation(api.retailers.updateSettings, { orderStages: many }),
		).rejects.toThrow(/At most 20/);
	});

	test("rejects a stage with no English label", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "stages-nolabel");
		await expect(
			asA.mutation(api.retailers.updateSettings, {
				orderStages: [{ anchor: "confirmed", label: { en: "  " }, notify: true }],
			}),
		).rejects.toThrow(/English label/i);
	});

	test("rejects more than one Accepted (confirmed) stage", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "stages-2accepted");
		await expect(
			asA.mutation(api.retailers.updateSettings, {
				orderStages: [
					{ anchor: "confirmed", label: { en: "Received" }, notify: false },
					{ anchor: "confirmed", label: { en: "Reviewing" }, notify: false },
				],
			}),
		).rejects.toThrow(/Only one "Accepted"/);
	});

	test("rejects more than one Done (delivered) stage", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "stages-2done");
		await expect(
			asA.mutation(api.retailers.updateSettings, {
				orderStages: [
					{ anchor: "delivered", label: { en: "Collected" }, notify: true },
					{ anchor: "delivered", label: { en: "Reviewed" }, notify: true },
				],
			}),
		).rejects.toThrow(/Only one "Done"/);
	});

	test("rejects more than 5 notifying stages", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "stages-notifycap");
		await expect(
			asA.mutation(api.retailers.updateSettings, {
				orderStages: Array.from({ length: 6 }, (_, i) => ({
					anchor: "packed" as const,
					label: { en: `Step ${i}` },
					notify: true,
				})),
			}),
		).rejects.toThrow(/can notify the buyer/i);
	});
});

describe("retailers.checkEmailHasStore (admin onboard pre-check)", () => {
	const ADMIN = "user_admin_email";
	let prev: string | undefined;
	beforeAll(() => {
		prev = process.env.ADMIN_USER_IDS;
		process.env.ADMIN_USER_IDS = ADMIN;
	});
	afterAll(() => {
		process.env.ADMIN_USER_IDS = prev;
	});

	const asAdmin = (t: ReturnType<typeof setup>) =>
		t.withIdentity({ subject: ADMIN });

	async function seedWithEmail(
		t: ReturnType<typeof setup>,
		userId: string,
		slug: string,
		email: string,
	) {
		await t
			.withIdentity({ subject: userId, email })
			.mutation(api.retailers.createRetailer, { storeName: "Email Store", slug });
	}

	test("flags an email that already owns a store (case-insensitive)", async () => {
		const t = setup();
		await seedWithEmail(t, "u_e1", "email-store-1", "vendor@example.com");
		// Stored normalized → a differently-cased lookup still matches.
		const res = await asAdmin(t).query(api.retailers.checkEmailHasStore, {
			email: "Vendor@Example.com",
		});
		expect(res.exists).toBe(true);
		expect(res.slug).toBe("email-store-1");
	});

	test("returns not-found for an unregistered email", async () => {
		const t = setup();
		await seedWithEmail(t, "u_e1", "email-store-1", "vendor@example.com");
		const res = await asAdmin(t).query(api.retailers.checkEmailHasStore, {
			email: "nobody@example.com",
		});
		expect(res.exists).toBe(false);
	});

	test("an unparseable email is treated as not-found (no throw while typing)", async () => {
		const t = setup();
		const res = await asAdmin(t).query(api.retailers.checkEmailHasStore, {
			email: "not-an-email",
		});
		expect(res.exists).toBe(false);
	});

	test("rejects a non-admin caller", async () => {
		const t = setup();
		await expect(
			t
				.withIdentity({ subject: "u_random" })
				.query(api.retailers.checkEmailHasStore, { email: "vendor@example.com" }),
		).rejects.toThrow(/not authorized/i);
	});
});
