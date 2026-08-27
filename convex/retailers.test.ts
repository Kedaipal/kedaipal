/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
	vi,
} from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { AUP_VERSION, PRIVACY_VERSION, TERMS_VERSION } from "./lib/legal";
import { STORE_DESCRIPTION_MAX } from "./lib/storeProfile";
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

	test("garbage-collects the previous logo blob on replace / clear", async () => {
		const t = setup();
		const asA = await seed(t, "user_logo_gc", "logo-gc");
		const storeBlob = () =>
			t.run(async (ctx) =>
				ctx.storage.store(
					new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }),
				),
			);
		const exists = async (id: string) =>
			(await t.run(async (ctx) => ctx.storage.getUrl(id))) !== null;

		const logo1 = await storeBlob();
		await asA.mutation(api.retailers.updateSettings, { logoStorageId: logo1 });
		expect(await exists(logo1)).toBe(true);

		// Replace → old blob GC'd, new one kept.
		const logo2 = await storeBlob();
		await asA.mutation(api.retailers.updateSettings, { logoStorageId: logo2 });
		expect(await exists(logo1)).toBe(false);
		expect(await exists(logo2)).toBe(true);

		// Clear → the current blob GC'd too.
		await asA.mutation(api.retailers.updateSettings, { logoStorageId: "" });
		expect(await exists(logo2)).toBe(false);
	});
});

describe("retailers cover image", () => {
	test("getRetailerBySlug returns resolved coverImageUrl when set", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "cover-store");
		const storageId = await t.run(async (ctx) => {
			const blob = new Blob([new Uint8Array([1, 2, 3, 4])], {
				type: "image/png",
			});
			return ctx.storage.store(blob);
		});
		await asA.mutation(api.retailers.updateSettings, {
			coverImageStorageId: storageId,
		});

		const result = await t.query(api.retailers.getRetailerBySlug, {
			slug: "cover-store",
		});
		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.retailer.coverImageStorageId).toBe(storageId);
		expect(result.retailer.coverImageUrl).toMatch(/^https?:\/\//);
	});

	test("getMyRetailer returns resolved coverImageUrl", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "my-cover");
		const storageId = await t.run(async (ctx) => {
			const blob = new Blob([new Uint8Array([1, 2, 3, 4])], {
				type: "image/png",
			});
			return ctx.storage.store(blob);
		});
		await asA.mutation(api.retailers.updateSettings, {
			coverImageStorageId: storageId,
		});

		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.coverImageStorageId).toBe(storageId);
		expect(me?.coverImageUrl).toMatch(/^https?:\/\//);
	});

	test("empty string clears the cover image", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "clear-cover");
		const storageId = await t.run(async (ctx) => {
			const blob = new Blob([new Uint8Array([1, 2, 3, 4])], {
				type: "image/png",
			});
			return ctx.storage.store(blob);
		});
		await asA.mutation(api.retailers.updateSettings, {
			coverImageStorageId: storageId,
		});
		await asA.mutation(api.retailers.updateSettings, {
			coverImageStorageId: "",
		});

		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.coverImageStorageId).toBeUndefined();
		expect(me?.coverImageUrl).toBeUndefined();
	});

	test("getRetailerBySlug returns no coverImageUrl when none configured", async () => {
		const t = setup();
		await seed(t, USER_A, "no-cover");
		const result = await t.query(api.retailers.getRetailerBySlug, {
			slug: "no-cover",
		});
		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.retailer.coverImageUrl).toBeUndefined();
	});

	test("garbage-collects the previous cover blob on replace / clear", async () => {
		const t = setup();
		const asA = await seed(t, "user_cover_gc", "cover-gc");
		const storeBlob = () =>
			t.run(async (ctx) =>
				ctx.storage.store(
					new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }),
				),
			);
		const exists = async (id: string) =>
			(await t.run(async (ctx) => ctx.storage.getUrl(id))) !== null;

		const cover1 = await storeBlob();
		await asA.mutation(api.retailers.updateSettings, {
			coverImageStorageId: cover1,
		});
		expect(await exists(cover1)).toBe(true);

		// Replace → old blob GC'd, new one kept.
		const cover2 = await storeBlob();
		await asA.mutation(api.retailers.updateSettings, {
			coverImageStorageId: cover2,
		});
		expect(await exists(cover1)).toBe(false);
		expect(await exists(cover2)).toBe(true);

		// Clear → the current blob GC'd too.
		await asA.mutation(api.retailers.updateSettings, {
			coverImageStorageId: "",
		});
		expect(await exists(cover2)).toBe(false);
	});

	test("cover and logo are independent — setting one leaves the other", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "cover-logo-indep");
		const [logoId, coverId] = await t.run(async (ctx) => {
			const blob = () =>
				ctx.storage.store(
					new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }),
				);
			return Promise.all([blob(), blob()]);
		});
		await asA.mutation(api.retailers.updateSettings, { logoStorageId: logoId });
		await asA.mutation(api.retailers.updateSettings, {
			coverImageStorageId: coverId,
		});

		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.logoStorageId).toBe(logoId);
		expect(me?.coverImageStorageId).toBe(coverId);
		expect(me?.logoUrl).toMatch(/^https?:\/\//);
		expect(me?.coverImageUrl).toMatch(/^https?:\/\//);
	});
});

describe("retailers store description", () => {
	test("updateSettings saves a trimmed description; both reads surface it", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "desc-store");
		await asA.mutation(api.retailers.updateSettings, {
			storeDescription: "  Home-based frozen food, Semenyih  ",
		});

		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.storeDescription).toBe("Home-based frozen food, Semenyih");

		const result = await t.query(api.retailers.getRetailerBySlug, {
			slug: "desc-store",
		});
		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.retailer.storeDescription).toBe(
			"Home-based frozen food, Semenyih",
		);
	});

	test("preserves internal newlines", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "desc-newline");
		await asA.mutation(api.retailers.updateSettings, {
			storeDescription: "Line one\nLine two",
		});
		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.storeDescription).toBe("Line one\nLine two");
	});

	test("empty / whitespace-only clears the description", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "desc-clear");
		await asA.mutation(api.retailers.updateSettings, {
			storeDescription: "Temporary blurb",
		});
		await asA.mutation(api.retailers.updateSettings, {
			storeDescription: "   ",
		});
		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.storeDescription).toBeUndefined();
	});

	test("rejects an over-cap description (server-side, don't trust client)", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "desc-toolong");
		await expect(
			asA.mutation(api.retailers.updateSettings, {
				storeDescription: "x".repeat(STORE_DESCRIPTION_MAX + 1),
			}),
		).rejects.toThrow(new RegExp(`${STORE_DESCRIPTION_MAX} characters`));
	});

	test("unset by default", async () => {
		const t = setup();
		await seed(t, USER_A, "desc-default");
		const result = await t.query(api.retailers.getRetailerBySlug, {
			slug: "desc-default",
		});
		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.retailer.storeDescription).toBeUndefined();
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

	test("createRetailer stamps current versions + timestamps", async () => {
		const t = setup();
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.retailers.createRetailer, {
			storeName: "Consent Store",
			slug: "consent",
		});

		const row = await readRetailer(t, USER_A);
		expect(row?.termsVersion).toBe(TERMS_VERSION);
		expect(row?.privacyVersion).toBe(PRIVACY_VERSION);
		expect(row?.aupVersion).toBe(AUP_VERSION);
		expect(typeof row?.termsAcceptedAt).toBe("number");
		expect(typeof row?.privacyAcceptedAt).toBe("number");
		expect(typeof row?.aupAcceptedAt).toBe("number");
		// acceptanceIp was dropped in 86eyn25fu (no client ever passed it, and a
		// mutation can't observe the request IP) — pin that nothing writes it.
		expect("acceptanceIp" in (row ?? {})).toBe(false);
	});

	test("getMyRetailer exposes accepted versions", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "expose");
		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.termsVersion).toBe(TERMS_VERSION);
		expect(me?.privacyVersion).toBe(PRIVACY_VERSION);
		expect(me?.aupVersion).toBe(AUP_VERSION);
	});

	test("recordConsentAcceptance re-stamps versions", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "restamp");
		// Simulate a stale prior acceptance.
		await t.run(async (ctx) => {
			const rows = await ctx.db.query("retailers").collect();
			const row = rows.find((r) => r.userId === USER_A);
			if (row) {
				await ctx.db.patch(row._id, { termsVersion: "2000-01-01" });
			}
		});

		await asA.mutation(api.retailers.recordConsentAcceptance, {});

		const row = await readRetailer(t, USER_A);
		expect(row?.termsVersion).toBe(TERMS_VERSION);
		expect(row?.privacyVersion).toBe(PRIVACY_VERSION);
		expect(row?.aupVersion).toBe(AUP_VERSION);
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
			const coverId = await store();
			const qrId = await store();
			const productImgId = await store();
			const variantImgId = await store();
			const categoryImgId = await store();
			const proofId = await store();

			await ctx.db.patch(retailer._id, {
				logoStorageId: logoId,
				coverImageStorageId: coverId,
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
			const variantId = await ctx.db.insert("productVariants", {
				productId,
				retailerId: retailer._id,
				optionValues: [],
				price: 500,
				onHand: 10,
				reserved: 0,
				parcelWeightG: 0,
				imageStorageIds: [variantImgId],
				active: true,
				sortOrder: 0,
				createdAt: now,
				updatedAt: now,
			});
			const categoryId = await ctx.db.insert("categories", {
				retailerId: retailer._id,
				name: "Kuih-muih",
				slug: "kuih-muih",
				imageStorageId: categoryImgId,
				active: true,
				sortOrder: 0,
				createdAt: now,
				updatedAt: now,
			});
			const junctionId = await ctx.db.insert("productCategories", {
				productId,
				categoryId,
				retailerId: retailer._id,
				sortOrder: 0,
				createdAt: now,
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
				coverId,
				qrId,
				productImgId,
				variantImgId,
				categoryImgId,
				proofId,
				productId,
				variantId,
				categoryId,
				junctionId,
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
			expect(await ctx.db.get(ids.variantId)).toBeNull();
			expect(await ctx.db.get(ids.categoryId)).toBeNull();
			expect(await ctx.db.get(ids.junctionId)).toBeNull();
			expect(await ctx.db.get(ids.customerId)).toBeNull();
			expect(await ctx.db.get(ids.orderId)).toBeNull();
			expect(await ctx.db.get(ids.eventId)).toBeNull();
			expect(await ctx.db.get(ids.historyId)).toBeNull();

			expect(await ctx.storage.getUrl(ids.logoId)).toBeNull();
			expect(await ctx.storage.getUrl(ids.coverId)).toBeNull();
			expect(await ctx.storage.getUrl(ids.qrId)).toBeNull();
			expect(await ctx.storage.getUrl(ids.productImgId)).toBeNull();
			expect(await ctx.storage.getUrl(ids.variantImgId)).toBeNull();
			expect(await ctx.storage.getUrl(ids.categoryImgId)).toBeNull();
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

	/**
	 * The 86eyetzbk sweep: every table that used to be orphaned, the two
	 * retained-by-DECISION tables, the optOut attribution clear, and all three
	 * order blob kinds (the account cascade used to free only the proof).
	 */
	test("erases every previously-orphaned table, keeps the two retained by decision", async () => {
		const t = setup();
		const ids = await seedFullTenant(t, USER_A, "orphan-sweep");

		const extra = await t.run(async (ctx) => {
			const now = Date.now();
			const store = () =>
				ctx.storage.store(
					new Blob([new Uint8Array([9, 9, 9])], { type: "image/png" }),
				);
			// The two order blobs the old cascade leaked.
			const buyerImgId = await store();
			const mockupId = await store();
			await ctx.db.patch(ids.orderId, {
				customerImageStorageId: buyerImgId,
				mockupImageStorageIds: [mockupId],
				mockupImageStorageId: mockupId,
			});

			const pickupId = await ctx.db.insert("pickupLocations", {
				retailerId: ids.retailerId,
				label: "Stall",
				address: "12 Jln Tun Razak, 50400 Kuala Lumpur",
				// Third-party PII the cascade must not leave behind.
				managerName: "Pak Din",
				managerWaPhone: "60129998888",
				isActive: true,
				sortOrder: 0,
				createdAt: now,
				updatedAt: now,
			});
			const sessionId = await ctx.db.insert("counterCheckoutSessions", {
				retailerId: ids.retailerId,
				sellerUserId: USER_A,
				token: "KPS-testtoken0001",
				// `completed` deliberately: the 30-day stale-session cron exempts
				// completed rows, so before this ticket they held buyer phone +
				// pushname forever — the reason this table was a PDPA bug.
				status: "completed",
				waPhone: "60123456789",
				waProfileName: "Ali",
				expiresAt: now + 60_000,
				createdAt: now,
				updatedAt: now,
			});
			const usageId = await ctx.db.insert("subscriptionUsage", {
				retailerId: ids.retailerId,
				monthStart: now,
				orders: 3,
				createdAt: now,
				updatedAt: now,
			});
			const foundingId = await ctx.db.insert("foundingMembers", {
				retailerId: ids.retailerId,
				rank: 1,
				plan: "pro",
			});
			const limitsId = await ctx.db.insert("retailerSendingLimits", {
				retailerId: ids.retailerId,
				updatedAt: now,
			});
			const logId = await ctx.db.insert("outboundMessageLog", {
				retailerId: ids.retailerId,
				toWaPhone: "60123456789", // buyer PII
				category: "transactional",
				status: "sent",
				sentAt: now,
			});
			// Retained by decision — financial record + audit trail.
			const subscriptionRow = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", ids.retailerId))
				.first();
			if (!subscriptionRow) throw new Error("seed has no subscription");
			const invoiceId = await ctx.db.insert("invoices", {
				retailerId: ids.retailerId,
				subscriptionId: subscriptionRow._id,
				invoiceNumber: "INV-DEL-0001",
				amount: 9900,
				total: 9900,
				currency: "MYR",
				periodStart: now,
				periodEnd: now + 30 * 24 * 60 * 60 * 1000,
				dueDate: now + 14 * 24 * 60 * 60 * 1000,
				status: "paid",
				createdAt: now,
			});
			const auditId = await ctx.db.insert("adminAuditLog", {
				adminUserId: "admin_user",
				retailerId: ids.retailerId,
				action: "retailers.updateSettings",
				ts: now,
			});
			// Global suppression instruction: the ROW survives, only its
			// attribution to this retailer is cleared.
			const optOutId = await ctx.db.insert("optOuts", {
				waPhone: "60123456789",
				source: "stop_keyword",
				triggeredByRetailerId: ids.retailerId,
				createdAt: now,
			});
			return {
				buyerImgId,
				mockupId,
				pickupId,
				sessionId,
				usageId,
				foundingId,
				limitsId,
				logId,
				invoiceId,
				auditId,
				optOutId,
				subscriptionId: subscriptionRow._id,
			};
		});

		const result = await t.mutation(internal.retailers.deleteUser, {
			userId: USER_A,
		});
		expect(result.deleted).toBe(true);
		if (!result.deleted) throw new Error("expected the tenant to be deleted");
		// A small tenant fits one batch, so the cascade finishes in-invocation.
		expect(result.done).toBe(true);

		await t.run(async (ctx) => {
			// Previously orphaned — now all gone.
			expect(await ctx.db.get(extra.pickupId)).toBeNull();
			expect(await ctx.db.get(extra.sessionId)).toBeNull();
			expect(await ctx.db.get(extra.usageId)).toBeNull();
			expect(await ctx.db.get(extra.foundingId)).toBeNull();
			expect(await ctx.db.get(extra.limitsId)).toBeNull();
			expect(await ctx.db.get(extra.logId)).toBeNull();
			expect(await ctx.db.get(extra.subscriptionId)).toBeNull();

			// The two blobs the old cascade leaked, plus the one it did free.
			expect(await ctx.storage.getUrl(extra.buyerImgId)).toBeNull();
			expect(await ctx.storage.getUrl(extra.mockupId)).toBeNull();
			expect(await ctx.storage.getUrl(ids.proofId)).toBeNull();

			// RETAINED BY DECISION — a financial record and an audit trail must
			// outlive the tenant. If this ever flips, it must be a decision, not
			// a silent cascade addition.
			expect(await ctx.db.get(extra.invoiceId)).not.toBeNull();
			expect(await ctx.db.get(extra.auditId)).not.toBeNull();

			// The opt-out itself survives (the buyer's standing instruction), with
			// no dangling reference to the deleted store.
			const optOut = await ctx.db.get(extra.optOutId);
			expect(optOut).not.toBeNull();
			expect(optOut?.triggeredByRetailerId).toBeUndefined();
		});
	});

	test("completes for a tenant far past one transaction's batch", async () => {
		// Fake timers must be installed BEFORE the convexTest instance exists, or
		// scheduled continuations crash with "Transaction not started" (the
		// gotcha documented at convex/whatsapp.test.ts:112-114).
		vi.useFakeTimers();
		const t = setup();
		const ids = await seedFullTenant(t, USER_A, "big-tenant");
		// Well past DELETE_USER_BATCH (25) so the cascade must self-chain.
		await t.run(async (ctx) => {
			const now = Date.now();
			for (let i = 0; i < 60; i++) {
				const orderId = await ctx.db.insert("orders", {
					retailerId: ids.retailerId,
					shortId: `ORD-9${String(i).padStart(3, "0")}`,
					items: [],
					subtotal: 100,
					total: 100,
					currency: "MYR",
					status: "pending",
					channel: "whatsapp",
					customer: { name: "Bulk", waPhone: "60123456789" },
					createdAt: now,
					updatedAt: now,
				});
				await ctx.db.insert("orderEvents", {
					orderId,
					status: "pending",
					createdAt: now,
				});
			}
		});

		// One invocation can't finish this — it hands off to scheduled
		// continuations, which finishAllScheduledFunctions drains.
		const first = await t.mutation(internal.retailers.deleteUser, {
			userId: USER_A,
		});
		expect(first.deleted).toBe(true);
		if (!first.deleted) throw new Error("expected the tenant to be deleted");
		expect(first.done).toBe(false);
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		await t.run(async (ctx) => {
			expect(await ctx.db.get(ids.retailerId)).toBeNull();
			const orders = await ctx.db.query("orders").collect();
			expect(orders).toHaveLength(0);
			const events = await ctx.db.query("orderEvents").collect();
			expect(events).toHaveLength(0);
		});
		vi.useRealTimers();
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

		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(order?.retailerLocale).toBe("ms");
		expect(order?.statusLabels).toEqual({ ms: { shipped: "Sedia diambil" } });
	});

	test("zh statusLabels + locale round-trip, same as en/ms (86eybjw5n)", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "labels-zh");
		await asA.mutation(api.retailers.updateSettings, {
			locale: "zh",
			statusLabels: { zh: { shipped: "配送中", delivered: "已送达" } },
		});

		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.locale).toBe("zh");
		expect(me?.statusLabels).toEqual({
			zh: { shipped: "配送中", delivered: "已送达" },
		});
	});

	test("switching to zh with only en/ms statusLabels never leaks them (validator round-trip)", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "labels-zh-fallback");
		await asA.mutation(api.retailers.updateSettings, {
			statusLabels: {
				en: { shipped: "Out for delivery" },
				ms: { shipped: "Dalam penghantaran" },
			},
		});
		await asA.mutation(api.retailers.updateSettings, { locale: "zh" });

		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.locale).toBe("zh");
		// The stored overrides are still en/ms only — no zh key was ever written,
		// so a zh render (convex/lib/orderStatus.test.ts) falls through to the
		// built-in zh catalog, never to this en/ms text.
		expect(me?.statusLabels).toEqual({
			en: { shipped: "Out for delivery" },
			ms: { shipped: "Dalam penghantaran" },
		});
	});
});

describe("orderStages (Phase 2 custom stages)", () => {
	const SUIT = [
		{ anchor: "confirmed" as const, label: { en: "Accepted" }},
		{ anchor: "packed" as const, label: { en: "Cleaning", ms: "Mencuci" }},
		{ anchor: "packed" as const, label: { en: "Drying" }, description: { en: "1–2 days" } },
		{ anchor: "delivered" as const, label: { en: "Collected" }},
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
				{ anchor: "confirmed", label: { en: "  Accepted  ", ms: "   " }, description: { en: "", ms: "  " } },
			],
		});
		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.orderStages?.[0].label).toEqual({ en: "Accepted" });
		expect(me?.orderStages?.[0].description).toBeUndefined();
	});

	test("zh label + description round-trip, and blank zh is dropped like ms (86eybjw5n)", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "stages-zh");
		await asA.mutation(api.retailers.updateSettings, {
			orderStages: [
				{
					anchor: "confirmed",
					label: { en: "Accepted", zh: "已确认" },
					description: { en: "Order accepted", zh: "订单已接受" },
				},
				{
					anchor: "packed",
					label: { en: "Sewing", zh: "  " }, // whitespace-only zh → dropped
				},
			],
		});
		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.orderStages?.[0].label).toEqual({ en: "Accepted", zh: "已确认" });
		expect(me?.orderStages?.[0].description).toEqual({
			en: "Order accepted",
			zh: "订单已接受",
		});
		expect(me?.orderStages?.[1].label).toEqual({ en: "Sewing" });
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
					{ anchor: "packed", label: { en: "Cleaning" }},
					{ anchor: "confirmed", label: { en: "Accepted" }},
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
				orderStages: [{ anchor: "confirmed", label: { en: "  " }}],
			}),
		).rejects.toThrow(/English label/i);
	});

	test("rejects more than one Accepted (confirmed) stage", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "stages-2accepted");
		await expect(
			asA.mutation(api.retailers.updateSettings, {
				orderStages: [
					{ anchor: "confirmed", label: { en: "Received" }},
					{ anchor: "confirmed", label: { en: "Reviewing" }},
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
					{ anchor: "delivered", label: { en: "Collected" }},
					{ anchor: "delivered", label: { en: "Reviewed" }},
				],
			}),
		).rejects.toThrow(/Only one "Done"/);
	});

	test("six same-band stages are fine — the old notify cap is gone (86eyd63r8)", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "stages-notifycap");
		// MAX_NOTIFY_STAGES existed to bound per-stage WhatsApp cost; stages no
		// longer message anyone, so only the 20-stage total cap remains.
		await asA.mutation(api.retailers.updateSettings, {
			orderStages: Array.from({ length: 6 }, (_, i) => ({
				anchor: "packed" as const,
				label: { en: `Step ${i}` },
			})),
		});
		const r = await asA.query(api.retailers.getMyRetailer);
		expect(r?.orderStages).toHaveLength(6);
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

describe("seller WhatsApp order alerts config (86eyhw9zy)", () => {
	afterEach(() => {
		delete process.env.WHATSAPP_SELLER_NEW_ORDER_TEMPLATE;
		delete process.env.WHATSAPP_CHECKOUT_PHONE;
	});

	test("saves a local-form MY mobile normalized and enables in one call; availability mirrors the template env", async () => {
		const t = setup();
		const asUser = await seed(t, USER_A, "wa-alerts-happy");
		await asUser.mutation(api.retailers.updateSettings, {
			notifyWaPhone: "012-345 6789",
			orderWaAlerts: true,
		});
		// Env unset → the settings card stays hidden even though config is saved.
		let retailer = await asUser.query(api.retailers.getMyRetailer);
		expect(retailer?.notifyWaPhone).toBe("60123456789");
		expect(retailer?.orderWaAlerts).toBe(true);
		expect(retailer?.waOrderAlertsAvailable).toBe(false);

		process.env.WHATSAPP_SELLER_NEW_ORDER_TEMPLATE = "seller_new_order_utility";
		retailer = await asUser.query(api.retailers.getMyRetailer);
		expect(retailer?.waOrderAlertsAvailable).toBe(true);
	});

	test("rejects landlines, garbage, and the shared WABA's own number", async () => {
		const t = setup();
		const asUser = await seed(t, USER_A, "wa-alerts-invalid");
		// Landline (03-…) — a WhatsApp alert can never reach it.
		await expect(
			asUser.mutation(api.retailers.updateSettings, {
				notifyWaPhone: "0388881234",
			}),
		).rejects.toThrow(/mobile/i);
		await expect(
			asUser.mutation(api.retailers.updateSettings, {
				notifyWaPhone: "not a phone",
			}),
		).rejects.toThrow(/digits|mobile/i);
		process.env.WHATSAPP_CHECKOUT_PHONE = "60111222333";
		await expect(
			asUser.mutation(api.retailers.updateSettings, {
				notifyWaPhone: "011-1222 333",
			}),
		).rejects.toThrow(/Kedaipal's own WhatsApp number/i);
	});

	test("enabling requires a number (same call or already saved)", async () => {
		const t = setup();
		const asUser = await seed(t, USER_A, "wa-alerts-no-phone");
		await expect(
			asUser.mutation(api.retailers.updateSettings, { orderWaAlerts: true }),
		).rejects.toThrow(/number/i);
		// Number in the same call is enough (covered by the happy-path test);
		// number saved earlier is too.
		await asUser.mutation(api.retailers.updateSettings, {
			notifyWaPhone: "0198765432",
		});
		await asUser.mutation(api.retailers.updateSettings, { orderWaAlerts: true });
		const retailer = await asUser.query(api.retailers.getMyRetailer);
		expect(retailer?.orderWaAlerts).toBe(true);
	});

	test("Starter can't enable (Pro gate) but can always disable", async () => {
		const t = setup();
		const asUser = await seed(t, USER_A, "wa-alerts-starter");
		const retailer = await asUser.query(api.retailers.getMyRetailer);
		if (!retailer) throw new Error("seed failed");
		// Saving the number alone is un-gated (it's inert without the toggle).
		await asUser.mutation(api.retailers.updateSettings, {
			notifyWaPhone: "0198765432",
		});
		await t.run(async (ctx) => {
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
				.first();
			if (!sub) throw new Error("no subscription row");
			await ctx.db.patch(sub._id, { plan: "starter", status: "active" });
		});
		await expect(
			asUser.mutation(api.retailers.updateSettings, { orderWaAlerts: true }),
		).rejects.toThrow(/Pro plan/i);
		// A downgraded seller with the toggle already on can still turn it off.
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, { orderWaAlerts: true });
		});
		await asUser.mutation(api.retailers.updateSettings, {
			orderWaAlerts: false,
		});
		const after = await asUser.query(api.retailers.getMyRetailer);
		expect(after?.orderWaAlerts).toBe(false);
	});

	test("clearing the number switches the alerts off with it", async () => {
		const t = setup();
		const asUser = await seed(t, USER_A, "wa-alerts-clear");
		await asUser.mutation(api.retailers.updateSettings, {
			notifyWaPhone: "0198765432",
			orderWaAlerts: true,
		});
		await asUser.mutation(api.retailers.updateSettings, { notifyWaPhone: "" });
		const retailer = await asUser.query(api.retailers.getMyRetailer);
		expect(retailer?.notifyWaPhone).toBeUndefined();
		expect(retailer?.orderWaAlerts).toBe(false);
	});

	test("a STOP'd alert number is surfaced on the payload (and cleared by START)", async () => {
		const t = setup();
		const asUser = await seed(t, USER_A, "wa-alerts-optout");
		await asUser.mutation(api.retailers.updateSettings, {
			notifyWaPhone: "0198765432",
		});
		const optOutId = await t.run(async (ctx) =>
			ctx.db.insert("optOuts", {
				waPhone: "60198765432",
				source: "stop_keyword",
				createdAt: Date.now(),
			}),
		);
		let retailer = await asUser.query(api.retailers.getMyRetailer);
		expect(retailer?.notifyWaPhoneOptedOut).toBe(true);
		await t.run(async (ctx) => {
			await ctx.db.patch(optOutId, { reactivatedAt: Date.now() });
		});
		retailer = await asUser.query(api.retailers.getMyRetailer);
		expect(retailer?.notifyWaPhoneOptedOut).toBe(false);
	});
});

/**
 * The store's own contact number became MY-only with the `+60` plate that now
 * fronts every phone field (86eyknr2r). It isn't cosmetic: `waPhone` is the
 * sender contact Lalamove falls back to, and Lalamove requires `+60`, so a
 * non-MY value was never a supported case — it just failed later and quietly.
 */
describe("retailers.updateSettings — waPhone is a Malaysian mobile", () => {
	test.each([
		["the bare national number the +60 plate asks for", "12-345 6789"],
		["a local number with the trunk 0", "012-345 6789"],
		["a fully-keyed international number", "60123456789"],
	])("accepts %s and stores one canonical form", async (_label, typed) => {
		const t = setup();
		const asUser = await seed(t, USER_A, `wa-phone-${typed.length}`);
		await asUser.mutation(api.retailers.updateSettings, { waPhone: typed });
		const retailer = await asUser.query(api.retailers.getMyRetailer);
		expect(retailer?.waPhone).toBe("60123456789");
	});

	test.each([
		["a landline — no WhatsApp account can exist on it", "03-8888 1234"],
		["a Singapore mobile", "+65 8123 4567"],
		["a US number that merely starts with 1", "+1 555 234 5678"],
	])("rejects %s", async (_label, typed) => {
		const t = setup();
		const asUser = await seed(t, USER_A, "wa-phone-reject");
		await expect(
			asUser.mutation(api.retailers.updateSettings, { waPhone: typed }),
		).rejects.toThrow(/Malaysian mobile/i);
	});

	test("blank still clears the number — tightening never traps a seller", async () => {
		const t = setup();
		const asUser = await seed(t, USER_A, "wa-phone-clear");
		await asUser.mutation(api.retailers.updateSettings, {
			waPhone: "012-345 6789",
		});
		await asUser.mutation(api.retailers.updateSettings, { waPhone: "" });
		const retailer = await asUser.query(api.retailers.getMyRetailer);
		expect(retailer?.waPhone).toBeUndefined();
	});
});

describe("retailers — store opening hours (86eyp5rav)", () => {
	/** A week open 24h everywhere, with per-weekday overrides (0 = Sunday). */
	function weekWith(
		overrides: Record<
			number,
			{ open: number; close: number; closed?: boolean }
		> = {},
	) {
		return Array.from(
			{ length: 7 },
			(_, i) => overrides[i] ?? { open: 0, close: 1439 },
		);
	}

	test("saves a schedule, exposes it on BOTH reads, and null clears it", async () => {
		const t = setup();
		const asUser = await seed(t, USER_A, "hours-store");
		await asUser.mutation(api.retailers.updateSettings, {
			openingHours: weekWith({
				0: { open: 540, close: 1080, closed: true },
				1: { open: 540, close: 1080 },
			}),
		});

		// Public storefront payload — buyers must see the hours to plan around
		// them (header line + checkout clamp read this).
		const bySlug = await t.query(api.retailers.getRetailerBySlug, {
			slug: "hours-store",
		});
		expect(bySlug.status).toBe("ok");
		if (bySlug.status === "ok") {
			expect(bySlug.retailer.openingHours?.[0]).toEqual({
				open: 540,
				close: 1080,
				closed: true,
			});
			expect(bySlug.retailer.openingHours?.[1]).toEqual({
				open: 540,
				close: 1080,
			});
		}
		// Owner read — the settings card prefills from it.
		const mine = await asUser.query(api.retailers.getMyRetailer);
		expect(mine?.openingHours).toHaveLength(7);

		// null = the explicit clear, back to open 24/7 (field removed).
		await asUser.mutation(api.retailers.updateSettings, {
			openingHours: null,
		});
		const cleared = await t.query(api.retailers.getRetailerBySlug, {
			slug: "hours-store",
		});
		if (cleared.status === "ok") {
			expect(cleared.retailer.openingHours).toBeUndefined();
		}
	});

	test("an all-24h week normalizes to unset — open 24/7 has one spelling", async () => {
		const t = setup();
		const asUser = await seed(t, USER_A, "always-open");
		await asUser.mutation(api.retailers.updateSettings, {
			openingHours: weekWith(),
		});
		const mine = await asUser.query(api.retailers.getMyRetailer);
		expect(mine?.openingHours).toBeUndefined();
	});

	test("rejects an all-closed week and an inverted window", async () => {
		const t = setup();
		const asUser = await seed(t, USER_A, "bad-hours");
		await expect(
			asUser.mutation(api.retailers.updateSettings, {
				openingHours: Array.from({ length: 7 }, () => ({
					open: 540,
					close: 1080,
					closed: true,
				})),
			}),
		).rejects.toThrow(/at least one day/);
		await expect(
			asUser.mutation(api.retailers.updateSettings, {
				openingHours: weekWith({ 2: { open: 1080, close: 540 } }),
			}),
		).rejects.toThrow(/Tuesday/);
	});
});

describe("retailer country (SG-lite, 86eynw27f)", () => {
	test("createRetailer without a country stays MY: no stored field, MYR currency, resolved MY on reads", async () => {
		const t = setup();
		await seed(t, USER_A, "my-default-store");
		const row = await t.run(async (ctx) =>
			ctx.db
				.query("retailers")
				.withIndex("by_slug", (q) => q.eq("slug", "my-default-store"))
				.first(),
		);
		// Zero-migration posture: MY stores keep no stored country field.
		expect(row?.country).toBeUndefined();
		expect(row?.currency).toBe("MYR");

		const result = await t.query(api.retailers.getRetailerBySlug, {
			slug: "my-default-store",
		});
		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.retailer.country).toBe("MY");
	});

	test("createRetailer with SG stores the country and is born with SGD", async () => {
		const t = setup();
		const asUser = t.withIdentity({ subject: USER_A });
		await asUser.mutation(api.retailers.createRetailer, {
			storeName: "SG Store",
			slug: "sg-store",
			country: "SG",
		});
		const row = await t.run(async (ctx) =>
			ctx.db
				.query("retailers")
				.withIndex("by_slug", (q) => q.eq("slug", "sg-store"))
				.first(),
		);
		expect(row?.country).toBe("SG");
		// Currency is born from the country — products freeze theirs at create,
		// so a wrong default here would strand the whole catalog on MYR.
		expect(row?.currency).toBe("SGD");

		const result = await t.query(api.retailers.getRetailerBySlug, {
			slug: "sg-store",
		});
		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.retailer.country).toBe("SG");
		expect(result.retailer.currency).toBe("SGD");
	});

	test("updateSettings sets country and both payloads expose it", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "country-flip");
		await asA.mutation(api.retailers.updateSettings, { country: "SG" });

		const mine = await asA.query(api.retailers.getMyRetailer, {});
		expect(mine?.country).toBe("SG");
		const pub = await t.query(api.retailers.getRetailerBySlug, {
			slug: "country-flip",
		});
		expect(pub.status).toBe("ok");
		if (pub.status !== "ok") return;
		expect(pub.retailer.country).toBe("SG");
	});

	test("currency change re-stamps every product (archived too) and reports the count", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "currency-sync");
		const retailerId = await t.run(async (ctx) => {
			const row = await ctx.db
				.query("retailers")
				.withIndex("by_slug", (q) => q.eq("slug", "currency-sync"))
				.first();
			if (!row) throw new Error("no retailer");
			const now = Date.now();
			const base = {
				retailerId: row._id,
				currency: "MYR",
				imageStorageIds: [] as string[],
				channel: "whatsapp" as const,
				sortOrder: 0,
				createdAt: now,
				updatedAt: now,
			};
			await ctx.db.insert("products", { ...base, name: "Active", active: true });
			await ctx.db.insert("products", {
				...base,
				name: "Archived",
				active: false,
			});
			return row._id;
		});

		const result = await asA.mutation(api.retailers.updateSettings, {
			currency: "SGD",
		});
		expect(result.productsCurrencySynced).toBe(2);
		const currencies = await t.run(async (ctx) => {
			const products = await ctx.db
				.query("products")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.collect();
			return products.map((p) => p.currency);
		});
		// Archived rows sync too — a later restore must not resurrect a
		// mismatched currency (orders refuse an order-vs-product mismatch).
		expect(currencies).toEqual(["SGD", "SGD"]);

		// Saving anything else (or the same currency) syncs nothing.
		const again = await asA.mutation(api.retailers.updateSettings, {
			currency: "SGD",
		});
		expect(again.productsCurrencySynced).toBe(0);
	});
});

/** Seed an SG-country store — shared by the SG-lite suites below. */
async function seedSg(t: ReturnType<typeof setup>, slug: string) {
	const asUser = t.withIdentity({ subject: USER_A });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "SG Store",
		slug,
		country: "SG",
	});
	return asUser;
}

describe("SG delivery-mode allowlist (SG-lite, 86eynw29u)", () => {
	const weightConfig = {
		mode: "weight" as const,
		zones: [
			{
				name: "West MY",
				states: ["Selangor", "Johor"],
				bands: [{ maxKg: 5, fee: 1500 }],
			},
		],
		onOutOfBands: "arrange" as const,
		onUnpriceable: "arrange" as const,
	};

	test("an SG store can save flat and clear back to free", async () => {
		const t = setup();
		const asSg = await seedSg(t, "sg-flat-ok");
		await asSg.mutation(api.retailers.updateSettings, {
			deliveryConfig: { mode: "flat", fee: 500 },
		});
		let mine = await asSg.query(api.retailers.getMyRetailer);
		expect(mine?.deliveryConfig).toMatchObject({ mode: "flat", fee: 500 });
		await asSg.mutation(api.retailers.updateSettings, { deliveryConfig: null });
		mine = await asSg.query(api.retailers.getMyRetailer);
		expect(mine?.deliveryConfig).toBeUndefined();
	});

	test("an SG store is refused radius, weight AND lalamove configs", async () => {
		const t = setup();
		const asSg = await seedSg(t, "sg-mode-refusals");
		await expect(
			asSg.mutation(api.retailers.updateSettings, {
				deliveryConfig: {
					mode: "radius",
					bands: [{ maxKm: 5, fee: 500 }],
					outOfRange: "arrange",
				},
			}),
		).rejects.toThrow(/Malaysia-only/);
		await expect(
			asSg.mutation(api.retailers.updateSettings, {
				deliveryConfig: weightConfig,
			}),
		).rejects.toThrow(/Malaysia-only/);
		// Lalamove must hit the COUNTRY refusal, not "turn on booking first" —
		// the booking-credentials chase is a dead path for an SG seller.
		await expect(
			asSg.mutation(api.retailers.updateSettings, {
				deliveryConfig: { mode: "lalamove", onUnquotable: "block" },
			}),
		).rejects.toThrow(/Malaysia-only/);
	});

	test("flipping to SG KEEPS an MY-only config — it is listed, not destroyed (86eyqgujv)", async () => {
		// This used to be refused, and the settings UI escaped the refusal by
		// sending `deliveryConfig: null` — throwing away a seller's whole
		// weight-zone rate card, irreversibly, on a country switch. Carrying it
		// is safe: an SG address matches no MY zone, so the resolver holds or
		// blocks and never prices (convex/lib/delivery.test.ts). Switching back
		// restores the rate card intact.
		const t = setup();
		const asA = await seed(t, USER_A, "my-weight-flip");
		await asA.mutation(api.retailers.updateSettings, {
			deliveryConfig: weightConfig,
		});
		await asA.mutation(api.retailers.updateSettings, { country: "SG" });

		const mine = await asA.query(api.retailers.getMyRetailer);
		expect(mine?.country).toBe("SG");
		expect(mine?.deliveryConfig).toMatchObject({ mode: "weight" });

		// ...and the seller is told, rather than left to wonder why quotes stop.
		const setupState = await asA.query(api.retailers.countrySetup, {});
		expect(setupState?.items.map((i) => i.key)).toContain("delivery_mode");

		// Switching home brings it back exactly as it was.
		await asA.mutation(api.retailers.updateSettings, { country: "MY" });
		expect(
			(await asA.query(api.retailers.getMyRetailer))?.deliveryConfig,
		).toMatchObject({ mode: "weight" });
	});

	test("one save can flip to SG AND clear/replace the config together", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "my-flip-with-clear");
		await asA.mutation(api.retailers.updateSettings, {
			deliveryConfig: weightConfig,
		});
		await asA.mutation(api.retailers.updateSettings, {
			country: "SG",
			deliveryConfig: { mode: "flat", fee: 300 },
		});
		const mine = await asA.query(api.retailers.getMyRetailer);
		expect(mine?.country).toBe("SG");
		expect(mine?.deliveryConfig).toMatchObject({ mode: "flat", fee: 300 });
	});

	test("flipping to SG with a stored flat (or no) config just works", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "my-flat-flip");
		await asA.mutation(api.retailers.updateSettings, {
			deliveryConfig: { mode: "flat", fee: 700 },
		});
		await asA.mutation(api.retailers.updateSettings, { country: "SG" });
		const mine = await asA.query(api.retailers.getMyRetailer);
		expect(mine?.country).toBe("SG");
		expect(mine?.deliveryConfig).toMatchObject({ mode: "flat", fee: 700 });
	});
});

describe("seller-side phone arms (SG-lite, 86eynw2dy)", () => {
	test("createRetailer with country SG accepts a +65 waPhone in the bare local form", async () => {
		const t = setup();
		const asUser = t.withIdentity({ subject: USER_A });
		await asUser.mutation(api.retailers.createRetailer, {
			storeName: "SG Store",
			slug: "sg-phone-create",
			country: "SG",
			// The SAME-CALL country must judge this — the row doesn't exist yet.
			waPhone: "9123 4567",
		});
		const mine = await asUser.query(api.retailers.getMyRetailer);
		expect(mine?.waPhone).toBe("6591234567");
	});

	test("createRetailer without a country keeps rejecting +65 (MY arm intact)", async () => {
		const t = setup();
		await expect(
			t.withIdentity({ subject: USER_A }).mutation(
				api.retailers.createRetailer,
				{
					storeName: "MY Store",
					slug: "my-phone-create",
					waPhone: "+65 9123 4567",
				},
			),
		).rejects.toThrow(/Malaysian mobile/i);
	});

	test("updateSettings on an SG store accepts +65 waPhone + notifyWaPhone, rejects MY", async () => {
		const t = setup();
		const asUser = await seedSg(t, "sg-phone-settings");
		await asUser.mutation(api.retailers.updateSettings, {
			waPhone: "+65 8123 4567",
			notifyWaPhone: "9123 4567",
		});
		const mine = await asUser.query(api.retailers.getMyRetailer);
		expect(mine?.waPhone).toBe("6581234567");
		expect(mine?.notifyWaPhone).toBe("6591234567");

		await expect(
			asUser.mutation(api.retailers.updateSettings, {
				waPhone: "012-345 6789",
			}),
		).rejects.toThrow(/Singapore mobile/i);
		await expect(
			asUser.mutation(api.retailers.updateSettings, {
				notifyWaPhone: "012-345 6789",
			}),
		).rejects.toThrow(/Singapore mobile/i);
	});

	test("a same-call country switch + phone save validates coherently", async () => {
		// "Switch to Singapore and save my SG number" arrives as ONE updateSettings
		// call — the new country must judge the phone, or the save bounces off the
		// stored (old) arm and the two fields can never be changed together.
		const t = setup();
		const asUser = await seed(t, USER_A, "country-and-phone");
		await asUser.mutation(api.retailers.updateSettings, {
			country: "SG",
			waPhone: "9123 4567",
		});
		const mine = await asUser.query(api.retailers.getMyRetailer);
		expect(mine?.country).toBe("SG");
		expect(mine?.waPhone).toBe("6591234567");
	});

	test("an MY store's settings keep rejecting +65 exactly as before", async () => {
		const t = setup();
		const asUser = await seed(t, USER_A, "my-phone-settings");
		await expect(
			asUser.mutation(api.retailers.updateSettings, {
				waPhone: "+65 9123 4567",
			}),
		).rejects.toThrow(/Malaysian mobile/i);
	});
});

describe("country switch carries no wrong-country WhatsApp numbers (SG-lite invariant)", () => {
	test("a bare MY→SG switch KEEPS the MY number and lists it (86eyqgujv)", async () => {
		// Was refused, with the settings UI clearing the number to get past it.
		// A +60 number still receives WhatsApp perfectly well, so removing the
		// store's only published contact is the bigger harm — it becomes a
		// checklist row instead.
		const t = setup();
		const asA = await seed(t, USER_A, "switch-stale-wa");
		await asA.mutation(api.retailers.updateSettings, {
			waPhone: "012-345 6789",
		});
		await asA.mutation(api.retailers.updateSettings, { country: "SG" });
		const mine = await asA.query(api.retailers.getMyRetailer);
		expect(mine?.country).toBe("SG");
		expect(mine?.waPhone).toBe("60123456789");
		const setupState = await asA.query(api.retailers.countrySetup, {});
		expect(setupState?.items.map((i) => i.key)).toContain("wa_phone");
	});

	test("one save can switch AND clear the number together", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "switch-clear-wa");
		await asA.mutation(api.retailers.updateSettings, {
			waPhone: "012-345 6789",
		});
		await asA.mutation(api.retailers.updateSettings, {
			country: "SG",
			waPhone: "",
		});
		const mine = await asA.query(api.retailers.getMyRetailer);
		expect(mine?.country).toBe("SG");
		expect(mine?.waPhone).toBeUndefined();
	});

	test("one save can switch AND replace with the new country's number", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "switch-replace-wa");
		await asA.mutation(api.retailers.updateSettings, {
			waPhone: "012-345 6789",
		});
		await asA.mutation(api.retailers.updateSettings, {
			country: "SG",
			waPhone: "9123 4567",
		});
		const mine = await asA.query(api.retailers.getMyRetailer);
		expect(mine?.country).toBe("SG");
		expect(mine?.waPhone).toBe("6591234567");
	});

	test("a stored notifyWaPhone is kept and listed; clearing it in-call still auto-disables alerts", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "switch-stale-notify");
		await asA.mutation(api.retailers.updateSettings, {
			notifyWaPhone: "011-2345 6789",
		});
		await asA.mutation(api.retailers.updateSettings, { country: "SG" });
		expect(
			(await asA.query(api.retailers.countrySetup, {}))?.items.map(
				(i) => i.key,
			),
		).toContain("notify_wa_phone");
		await asA.mutation(api.retailers.updateSettings, {
			country: "SG",
			notifyWaPhone: "",
		});
		const mine = await asA.query(api.retailers.getMyRetailer);
		expect(mine?.country).toBe("SG");
		expect(mine?.notifyWaPhone).toBeUndefined();
		expect(mine?.orderWaAlerts).toBeFalsy();
	});

	test("symmetric — SG→MY keeps a stored SG number and lists it too", async () => {
		const t = setup();
		const asSg = await seedSg(t, "switch-back-my");
		await asSg.mutation(api.retailers.updateSettings, {
			waPhone: "9123 4567",
		});
		await asSg.mutation(api.retailers.updateSettings, { country: "MY" });
		const mine = await asSg.query(api.retailers.getMyRetailer);
		expect(mine?.country).toBe("MY");
		expect(mine?.waPhone).toBe("6591234567");
		expect(
			(await asSg.query(api.retailers.countrySetup, {}))?.items.map(
				(i) => i.key,
			),
		).toContain("wa_phone");
	});

	test("typing a wrong-country number DIRECTLY is still refused", async () => {
		// The switch is permissive about what it CARRIES; the phone field is not
		// permissive about what a seller TYPES. Losing that would let anyone
		// store a mismatched number at any time, which is a different bug.
		const t = setup();
		const asSg = await seedSg(t, "sg-direct-typing");
		await expect(
			asSg.mutation(api.retailers.updateSettings, { waPhone: "012-345 6789" }),
		).rejects.toThrow();
	});
});

describe("country switch and Lalamove rider booking (PR #208 review)", () => {
	// Pricing and booking are independent by design (`pricing ⊥ booking`), so a
	// FLAT-priced store passes the delivery-mode check while still carrying an
	// armed Book-a-rider button — pointed at an integration hardcoded to
	// Lalamove Malaysia, with prompt-book-on-packed able to spend money without
	// being asked. That gap is what these pin.
	// Enabling booking requires the rider pickup origin.
	const originAddress = {
		label: "12 Jln Kilang, Shah Alam",
		latitude: 3.0,
		longitude: 101.5,
	};
	const booking = {
		enabled: true,
		vehicleType: "MOTORCYCLE" as const,
		apiKey: "pk_test_abc",
		apiSecret: "sk_test_def",
	};

	test("a bare MY→SG switch carries booking across, inert and listed (86eyqgujv)", async () => {
		// Was refused. The stored flag is now harmless: getDeliveryJob reports
		// `country_unsupported` and the dispatch card hides itself, so
		// prompt-book-on-packed can't spend a cent. Keeping the row means the
		// seller's API keys survive a round trip.
		const t = setup();
		const asA = await seed(t, USER_A, "switch-booking-armed");
		await asA.mutation(api.retailers.updateSettings, {
			businessAddress: originAddress,
			deliveryConfig: { mode: "flat", fee: 500 },
			deliveryBooking: booking,
		});
		await asA.mutation(api.retailers.updateSettings, {
			country: "SG",
			waPhone: "",
		});
		const mine = await asA.query(api.retailers.getMyRetailer);
		expect(mine?.country).toBe("SG");
		expect(mine?.deliveryBooking?.enabled).toBe(true);
		expect(mine?.deliveryBooking?.apiKeyHint).toBeTruthy();
		expect(
			(await asA.query(api.retailers.countrySetup, {}))?.items.map(
				(i) => i.key,
			),
		).toContain("delivery_booking");
	});

	test("one save can switch AND disable booking, keeping the stored keys", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "switch-booking-off");
		await asA.mutation(api.retailers.updateSettings, {
			businessAddress: originAddress,
			deliveryConfig: { mode: "flat", fee: 500 },
			deliveryBooking: booking,
		});
		await asA.mutation(api.retailers.updateSettings, {
			country: "SG",
			deliveryBooking: { enabled: false, vehicleType: "MOTORCYCLE" },
		});
		const mine = await asA.query(api.retailers.getMyRetailer);
		expect(mine?.country).toBe("SG");
		expect(mine?.deliveryBooking?.enabled).toBe(false);
		// Switching country is not a reason to make a seller re-enter API keys
		// they'll want back if they switch again.
		expect(mine?.deliveryBooking?.hasCredentials).toBe(true);
	});

	test("booking already off never blocks the switch", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "switch-booking-idle");
		await asA.mutation(api.retailers.updateSettings, {
			deliveryBooking: { enabled: false, vehicleType: "CAR" },
		});
		await asA.mutation(api.retailers.updateSettings, { country: "SG" });
		expect((await asA.query(api.retailers.getMyRetailer))?.country).toBe("SG");
	});

	test("SG→MY re-arms nothing but is never blocked by this rule", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "switch-back-my");
		await asA.mutation(api.retailers.updateSettings, { country: "SG" });
		await asA.mutation(api.retailers.updateSettings, { country: "MY" });
		expect((await asA.query(api.retailers.getMyRetailer))?.country).toBe("MY");
	});
});

describe("a country switch keeps pickup contacts (86eyqgujv, was PR #208)", () => {
	test("a wrong-country manager number SURVIVES the switch", async () => {
		// #208 review had the switch clear these. It was reported in the toast
		// but never chosen, and on a store with five points and five staff
		// numbers it is five numbers gone for good. A manager's number is an
		// internal ops contact — nothing breaks by it being foreign — so it is
		// kept and listed on the post-switch checklist instead.
		const t = setup();
		const asA = await seed(t, USER_A, "switch-pickup-contacts");
		const retailer = await asA.query(api.retailers.getMyRetailer);
		if (!retailer) throw new Error("seed failed");
		await asA.mutation(api.pickupLocations.create, {
			retailerId: retailer._id,
			label: "Studio",
			address: "12 Jln Tun Razak, 50400 Kuala Lumpur",
			managerName: "Ali",
			managerWaPhone: "012-345 6789",
		});

		await asA.mutation(api.retailers.updateSettings, { country: "SG" });

		const rows = await asA.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows.find((r) => r.label === "Studio")?.managerWaPhone).toBe(
			"60123456789",
		);
		expect(rows.find((r) => r.label === "Studio")?.managerName).toBe("Ali");

		// ...and the seller is told about it rather than left to find out.
		const setup_ = await asA.query(api.retailers.countrySetup, {});
		expect(setup_?.items.map((i) => i.key)).toContain("pickup_contacts");
	});

	test("a matching number raises nothing", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "switch-pickup-keep");
		const retailer = await asA.query(api.retailers.getMyRetailer);
		if (!retailer) throw new Error("seed failed");
		await asA.mutation(api.pickupLocations.create, {
			retailerId: retailer._id,
			label: "Studio",
			address: "12 Jln Tun Razak, 50400 Kuala Lumpur",
			managerWaPhone: "012-345 6789",
		});
		// MY→MY is not a country change at all.
		await asA.mutation(api.retailers.updateSettings, { country: "MY" });
		const rows = await asA.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows[0]?.managerWaPhone).toBe("60123456789");
		// Never switched → no checklist at all, so this store pays nothing.
		expect(await asA.query(api.retailers.countrySetup, {})).toBeNull();
	});
});

describe("address country stamps (SG-lite, 86eyqgujv)", () => {
	const MY_ADDRESS = {
		label: "55, Jalan Eco Majestic 7/1D, 43700 Beranang, Selangor",
		latitude: 2.9,
		longitude: 101.8,
	};
	const SG_ADDRESS = {
		label: "661 Woodlands Ring Road, Singapore 730661",
		latitude: 1.44,
		longitude: 103.79,
	};

	test("a saved business address is stamped with the store's country", async () => {
		// Server-stamped, never client-sent: `businessAddressValidator` has no
		// country field, so a caller cannot claim one. Same posture as
		// deliveryBooking.env / hitpay.mode.
		const t = setup();
		const asA = await seed(t, USER_A, "stamp-my");
		await asA.mutation(api.retailers.updateSettings, {
			businessAddress: MY_ADDRESS,
		});
		const mine = await asA.query(api.retailers.getMyRetailer);
		expect(mine?.businessAddress?.country).toBe("MY");
	});

	test("an SG store stamps SG — coordinates are never consulted", async () => {
		// The reason this is stamped rather than derived: Singapore's bounding
		// box (lat 1.13–1.47) contains Johor Bahru at 1.4655 N, so a geometric
		// test would call a Malaysian seller's address Singaporean. Here an SG
		// store saves a JB-adjacent coordinate and still stamps SG, because the
		// Places picker it came from was locked to Singapore.
		const t = setup();
		const asA = await seedSg(t, "stamp-sg");
		await asA.mutation(api.retailers.updateSettings, {
			businessAddress: { ...SG_ADDRESS, latitude: 1.4655, longitude: 103.757 },
		});
		const mine = await asA.query(api.retailers.getMyRetailer);
		expect(mine?.businessAddress?.country).toBe("SG");
	});

	test("switching country stamps carried addresses with the OLD country", async () => {
		// The one moment the answer is known for certain: whatever the store was
		// until this save ran. After it, "your return address is Malaysian" is a
		// stored fact rather than a guess — which is what the AWB fail-safe and
		// the post-switch checklist both read.
		const t = setup();
		const asA = await seed(t, USER_A, "stamp-switch");
		await asA.mutation(api.retailers.updateSettings, {
			businessAddress: MY_ADDRESS,
		});
		await t.run(async (ctx) => {
			// Strip the stamp to model a row saved before this shipped.
			const row = await ctx.db
				.query("retailers")
				.filter((q) => q.eq(q.field("slug"), "stamp-switch"))
				.first();
			if (!row?.businessAddress) throw new Error("seed failed");
			await ctx.db.patch(row._id, {
				businessAddress: {
					label: row.businessAddress.label,
					latitude: row.businessAddress.latitude,
					longitude: row.businessAddress.longitude,
				},
			});
		});

		await asA.mutation(api.retailers.updateSettings, {
			country: "SG",
			waPhone: "",
		});
		const mine = await asA.query(api.retailers.getMyRetailer);
		expect(mine?.country).toBe("SG");
		expect(mine?.businessAddress?.country).toBe("MY");
	});

	test("a same-call switch + new address stamps the NEW country", async () => {
		// "Flip to Singapore and pick my Singapore address" must land in one
		// save correctly — the effective-country rule the rest of updateSettings
		// already uses.
		const t = setup();
		const asA = await seed(t, USER_A, "stamp-switch-fresh");
		await asA.mutation(api.retailers.updateSettings, {
			businessAddress: MY_ADDRESS,
		});
		await asA.mutation(api.retailers.updateSettings, {
			country: "SG",
			waPhone: "",
			businessAddress: SG_ADDRESS,
		});
		const mine = await asA.query(api.retailers.getMyRetailer);
		expect(mine?.businessAddress?.country).toBe("SG");
	});

	test("an already-stamped address is never re-stamped by a switch", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "stamp-idempotent");
		await asA.mutation(api.retailers.updateSettings, {
			businessAddress: MY_ADDRESS,
		});
		await asA.mutation(api.retailers.updateSettings, {
			country: "SG",
			waPhone: "",
		});
		await asA.mutation(api.retailers.updateSettings, { country: "MY" });
		const mine = await asA.query(api.retailers.getMyRetailer);
		// Stamped MY on save, and MY is still the truth — a round trip through
		// SG must not rewrite it to SG on the way back.
		expect(mine?.businessAddress?.country).toBe("MY");
	});
});

describe("countrySetup query + ack (86eyqgujv)", () => {
	const MY_ADDRESS = {
		label: "55, Jalan Eco Majestic 7/1D, 43700 Beranang, Selangor",
		latitude: 2.9,
		longitude: 101.8,
	};

	test("a store that never switched gets null — it costs one row read", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "no-switch");
		await asA.mutation(api.retailers.updateSettings, {
			businessAddress: MY_ADDRESS,
			paymentMethods: [
				{
					type: "bank" as const,
					label: "Maybank",
					bankName: "Maybank",
					bankAccountName: "Wagyu Walid",
					bankAccountNumber: "512345678901",
					sortOrder: 0,
				},
			],
		});
		expect(await asA.query(api.retailers.countrySetup, {})).toBeNull();
	});

	test("after a switch the list is money-first and self-clears as things are fixed", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "switch-checklist");
		await asA.mutation(api.retailers.updateSettings, {
			businessAddress: MY_ADDRESS,
			paymentMethods: [
				{
					type: "bank" as const,
					label: "Maybank",
					bankName: "Maybank",
					bankAccountName: "Wagyu Walid",
					bankAccountNumber: "512345678901",
					sortOrder: 0,
				},
			],
		});
		await asA.mutation(api.retailers.updateSettings, { country: "SG" });

		const first = await asA.query(api.retailers.countrySetup, {});
		expect(first?.changedFrom).toBe("MY");
		expect(first?.items.map((i) => i.key)).toEqual([
			"payment_methods",
			"business_address",
		]);

		// Replacing the address retires its row WITHOUT any acknowledgement —
		// this is what the stamp buys: the checklist tracks reality, not clicks.
		await asA.mutation(api.retailers.updateSettings, {
			businessAddress: {
				label: "661 Woodlands Ring Road, Singapore 730661",
				latitude: 1.44,
				longitude: 103.79,
			},
		});
		expect(
			(await asA.query(api.retailers.countrySetup, {}))?.items.map((i) => i.key),
		).toEqual(["payment_methods"]);
	});

	test("ack retires only what we can't verify, and the query goes quiet", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "switch-ack");
		await asA.mutation(api.retailers.updateSettings, {
			paymentMethods: [
				{
					type: "bank" as const,
					label: "Maybank",
					bankName: "Maybank",
					bankAccountName: "Wagyu Walid",
					bankAccountNumber: "512345678901",
					sortOrder: 0,
				},
			],
		});
		await asA.mutation(api.retailers.updateSettings, { country: "SG" });
		expect(
			(await asA.query(api.retailers.countrySetup, {}))?.items,
		).toHaveLength(1);

		const { acked } = await asA.mutation(api.retailers.ackCountrySetup, {});
		expect(acked).toBe(1);
		expect((await asA.query(api.retailers.countrySetup, {}))?.items).toEqual(
			[],
		);
	});

	test("ack cannot retire a verifiable row, even by asking twice", async () => {
		// The mutation computes the ackable set server-side rather than taking
		// keys from the caller, so "dismiss" can never become a way to silence a
		// wrong-country address that is still wrong.
		const t = setup();
		const asA = await seed(t, USER_A, "switch-ack-integrity");
		await asA.mutation(api.retailers.updateSettings, {
			businessAddress: MY_ADDRESS,
		});
		await asA.mutation(api.retailers.updateSettings, { country: "SG" });

		await asA.mutation(api.retailers.ackCountrySetup, {});
		await asA.mutation(api.retailers.ackCountrySetup, {});
		expect(
			(await asA.query(api.retailers.countrySetup, {}))?.items.map((i) => i.key),
		).toEqual(["business_address"]);
	});

	test("switching again re-opens everything the seller had confirmed", async () => {
		// Their bank details were checked against the OLD destination.
		const t = setup();
		const asA = await seed(t, USER_A, "switch-twice");
		await asA.mutation(api.retailers.updateSettings, {
			paymentMethods: [
				{
					type: "bank" as const,
					label: "Maybank",
					bankName: "Maybank",
					bankAccountName: "Wagyu Walid",
					bankAccountNumber: "512345678901",
					sortOrder: 0,
				},
			],
		});
		await asA.mutation(api.retailers.updateSettings, { country: "SG" });
		await asA.mutation(api.retailers.ackCountrySetup, {});
		expect((await asA.query(api.retailers.countrySetup, {}))?.items).toEqual(
			[],
		);

		await asA.mutation(api.retailers.updateSettings, { country: "MY" });
		const reopened = await asA.query(api.retailers.countrySetup, {});
		expect(reopened?.changedFrom).toBe("SG");
		expect(reopened?.items.map((i) => i.key)).toEqual(["payment_methods"]);
	});

	test("saving the SAME country is not a switch and records nothing", async () => {
		const t = setup();
		const asA = await seed(t, USER_A, "switch-noop");
		await asA.mutation(api.retailers.updateSettings, { country: "MY" });
		expect(await asA.query(api.retailers.countrySetup, {})).toBeNull();
	});
});
