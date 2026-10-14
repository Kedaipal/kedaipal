/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

/**
 * Store availability end to end (`z8r3fdudf7`): the seller's switch, Kedaipal's
 * pause / take-offline, and what each door and surface does about them. Every
 * assertion goes through a real door (an order, a QR scan, the storefront
 * payload, the directory) — a flag that's set but not obeyed is the bug.
 */

const modules = import.meta.glob("./**/*.ts");
const OWNER = "user_avail_owner";
const ADMIN = "user_avail_admin";
let prevAdminEnv: string | undefined;

beforeEach(() => {
	prevAdminEnv = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
});
afterEach(() => {
	process.env.ADMIN_USER_IDS = prevAdminEnv;
});

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

async function seed(t: ReturnType<typeof setup>) {
	const owner = t.withIdentity({ subject: OWNER });
	await owner.mutation(api.retailers.createRetailer, {
		storeName: "Corks Out",
		slug: "corks-out",
	});
	const retailer = await owner.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	const productId = await owner.mutation(api.products.create, {
		retailerId: retailer._id,
		name: "Wine flight",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: false,
		variants: [{ optionValues: [], price: 4500, onHand: 50 }],
	});
	return { owner, admin: t.withIdentity({ subject: ADMIN }), retailerId: retailer._id, productId };
}

function order(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	productId: Id<"products">,
) {
	return t.mutation(api.orders.create, {
		retailerId,
		items: [{ productId, quantity: 1 }],
		currency: "MYR",
		channel: "whatsapp",
		customer: { name: "Ali", waPhone: "60123456789" },
		deliveryAddress: {
			line1: "12 Jln Mawar 3",
			city: "Petaling Jaya",
			state: "Selangor",
			postcode: "47301",
		},
	});
}

async function qrScan(t: ReturnType<typeof setup>, owner: ReturnType<ReturnType<typeof setup>["withIdentity"]>) {
	const { token } = await owner.mutation(api.counterCheckout.ensureCounterQrToken, {});
	return t.mutation(internal.counterCheckout.startSessionFromStoreQr, {
		token,
		waPhone: "60123456789",
		profileName: "Aiman",
	});
}

describe("the seller's own pause", () => {
	test("closes the storefront with their note, and the order door says the same", async () => {
		const t = setup();
		const { owner, retailerId, productId } = await seed(t);
		await owner.mutation(api.storeAvailability.setAcceptingOrders, {
			retailerId,
			accepting: false,
			note: "Back on 1 Nov",
		});

		const page = await t.query(api.retailers.getRetailerBySlug, { slug: "corks-out" });
		expect(page.status).toBe("ok");
		if (page.status !== "ok") return;
		expect(page.retailer.orderingPaused).toBe(true);
		expect(page.retailer.orderingPausedBy).toEqual({ by: "seller", note: "Back on 1 Nov" });

		await expect(order(t, retailerId, productId)).rejects.toThrow(
			"Corks Out isn't taking orders right now — Back on 1 Nov",
		);
	});

	test("leaves the COUNTER open — a poster scan still starts a walk-in", async () => {
		const t = setup();
		const { owner, retailerId } = await seed(t);
		await owner.mutation(api.storeAvailability.setAcceptingOrders, {
			retailerId,
			accepting: false,
		});
		expect((await qrScan(t, owner)).result).toBe("started");
	});

	test("resuming reopens the storefront", async () => {
		const t = setup();
		const { owner, retailerId, productId } = await seed(t);
		await owner.mutation(api.storeAvailability.setAcceptingOrders, { retailerId, accepting: false });
		await owner.mutation(api.storeAvailability.setAcceptingOrders, { retailerId, accepting: true });
		await expect(order(t, retailerId, productId)).resolves.toBeDefined();
	});
});

describe("Kedaipal's switch", () => {
	test("pause: browse-only, buyers told nothing about why, counter closed too", async () => {
		const t = setup();
		const { owner, admin, retailerId, productId } = await seed(t);
		await admin.mutation(api.admin.setStoreAvailability, {
			retailerId,
			mode: "paused",
			note: "Unpaid sponsorship",
		});

		const page = await t.query(api.retailers.getRetailerBySlug, { slug: "corks-out" });
		if (page.status !== "ok") throw new Error("expected the store to still show");
		expect(page.retailer.orderingPausedBy).toEqual({ by: "admin", note: undefined });
		await expect(order(t, retailerId, productId)).rejects.toThrow(
			/isn't taking orders right now/,
		);
		const scan = await qrScan(t, owner);
		expect(scan.result).toBe("unavailable");
		expect(JSON.stringify(scan)).not.toMatch(/sponsorship/i);
	});

	test("the SELLER ringing up at a closed counter is told who closed it — never the buyer's 'browse the menu'", async () => {
		const t = setup();
		const { owner, admin, retailerId } = await seed(t);
		await admin.mutation(api.admin.setStoreAvailability, {
			retailerId,
			mode: "paused",
		});
		const refusal = owner
			.mutation(api.counterCheckout.startAnonymousSession, {})
			.catch((err: Error) => err.message);
		const message = await refusal;
		expect(message).toMatch(/Kedaipal has paused ordering at your store/);
		expect(message).not.toMatch(/Browse the menu/);
	});

	test("offline: the storefront payload carries the name and nothing else; off /stores and the sitemap", async () => {
		const t = setup();
		const { admin, retailerId } = await seed(t);
		// Listed everywhere while open — so "gone" below is the switch, not a
		// store that was never there.
		expect(
			(await t.query(api.marketplace.listStores, {})).some((s) => s.slug === "corks-out"),
		).toBe(true);
		expect(
			(await t.query(api.retailers.listSlugsForSitemap, {})).some((s) => s.slug === "corks-out"),
		).toBe(true);
		expect(
			(await t.query(api.products.listForSitemap, {})).some((p) => p.storeSlug === "corks-out"),
		).toBe(true);
		await admin.mutation(api.admin.setStoreAvailability, { retailerId, mode: "offline" });

		expect(await t.query(api.retailers.getRetailerBySlug, { slug: "corks-out" })).toEqual({
			status: "unavailable",
			storeName: "Corks Out",
		});
		const stores = await t.query(api.marketplace.listStores, {});
		expect(stores.some((s) => s.slug === "corks-out")).toBe(false);
		const slugs = await t.query(api.retailers.listSlugsForSitemap, {});
		expect(slugs.some((s) => s.slug === "corks-out")).toBe(false);
		const products = await t.query(api.products.listForSitemap, {});
		expect(products.some((p) => p.storeSlug === "corks-out")).toBe(false);
	});

	test("the seller can't flip their switch under it — refused with the way out", async () => {
		const t = setup();
		const { owner, admin, retailerId } = await seed(t);
		await admin.mutation(api.admin.setStoreAvailability, { retailerId, mode: "paused" });
		await expect(
			owner.mutation(api.storeAvailability.setAcceptingOrders, { retailerId, accepting: true }),
		).rejects.toThrow(/Contact us to reopen/);
	});

	test("reopening never reopens what the seller shut themselves", async () => {
		const t = setup();
		const { owner, admin, retailerId, productId } = await seed(t);
		await owner.mutation(api.storeAvailability.setAcceptingOrders, { retailerId, accepting: false });
		await admin.mutation(api.admin.setStoreAvailability, { retailerId, mode: "offline" });
		await admin.mutation(api.admin.clearStoreAvailability, { retailerId });

		const status = await owner.query(api.storeAvailability.forSeller, { retailerId });
		expect(status.availability).toMatchObject({ state: "paused", by: "seller" });
		await expect(order(t, retailerId, productId)).rejects.toThrow(/isn't taking orders/);
	});

	test("only an admin can set it, and every write is audited", async () => {
		const t = setup();
		const { owner, admin, retailerId } = await seed(t);
		await expect(
			owner.mutation(api.admin.setStoreAvailability, { retailerId, mode: "offline" }),
		).rejects.toThrow();
		await admin.mutation(api.admin.setStoreAvailability, { retailerId, mode: "offline" });
		await admin.mutation(api.admin.clearStoreAvailability, { retailerId });
		const actions = await t.run(async (ctx) =>
			(await ctx.db.query("adminAuditLog").collect()).map((r) => r.action),
		);
		expect(actions).toEqual(["admin.takeStoreOffline", "admin.reopenStore"]);
	});

	test("the admin directory says who switched it off", async () => {
		const t = setup();
		const { admin, retailerId } = await seed(t);
		await admin.mutation(api.admin.setStoreAvailability, {
			retailerId,
			mode: "paused",
			note: "Pulled out of Campfest",
		});
		const { sellers } = await admin.query(api.admin.listSellersForAdmin, {});
		const row = sellers.find((s) => s._id === retailerId);
		expect(row?.availability).toMatchObject({ state: "paused", by: "admin" });
		expect(row?.adminAvailability?.note).toBe("Pulled out of Campfest");
	});
});

describe("Off-Season Hold keeps its own stamp", () => {
	test("ending a hold never lifts the seller's own pause", async () => {
		const t = setup();
		const { owner, retailerId } = await seed(t);
		await owner.mutation(api.storeAvailability.setAcceptingOrders, { retailerId, accepting: false });
		// A hold on top, then off again — its stamp is the retailer row's.
		await t.run((ctx) => ctx.db.patch(retailerId, { orderingPausedAt: Date.now() }));
		expect(
			(await owner.query(api.storeAvailability.forSeller, { retailerId })).availability,
		).toMatchObject({ by: "hold" });
		await t.run((ctx) => ctx.db.patch(retailerId, { orderingPausedAt: undefined }));
		expect(
			(await owner.query(api.storeAvailability.forSeller, { retailerId })).availability,
		).toMatchObject({ state: "paused", by: "seller" });
	});
});
