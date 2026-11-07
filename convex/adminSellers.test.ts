/// <reference types="vite/client" />
// The paginated seller directory (Admin · Sellers, 4 Nov 2026): one cursor
// paginate per call on an index order, a cheap server-side post-filter and
// substring search over each raw page, founders pinned to page one on the
// default sort, a name sort that files "iKuih" under i, and a counts query the
// Status menu reads. Every test here reads MORE than one page — the old
// directory's tests never did, which is how a cap could ship unnoticed.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { SellerStatusFilter, SellerSort } from "./lib/adminSellerFilters";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const ADMIN = "user_admin";

let prevAdminEnv: string | undefined;
beforeAll(() => {
	prevAdminEnv = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
});
afterAll(() => {
	process.env.ADMIN_USER_IDS = prevAdminEnv;
});

type T = ReturnType<typeof setup>;

async function seedStore(t: T, userId: string, storeName: string, slug: string) {
	const asUser = t.withIdentity({ subject: userId });
	await asUser.mutation(api.retailers.createRetailer, { storeName, slug });
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

/** Seed `n` stores named Store 1…n, in that creation order. */
async function seedMany(t: T, n: number) {
	const ids: Id<"retailers">[] = [];
	for (let i = 1; i <= n; i++) {
		const r = await seedStore(t, `user_${i}`, `Store ${i}`, `store-${i}`);
		ids.push(r._id);
	}
	return ids;
}

const admin = (t: T) => t.withIdentity({ subject: ADMIN });

async function page(
	t: T,
	args: {
		sort?: SellerSort;
		filters?: SellerStatusFilter[];
		q?: string;
		numItems: number;
		cursor: string | null;
	},
) {
	const { numItems, cursor, ...rest } = args;
	return admin(t).query(api.adminSellers.listSellersPage, {
		...rest,
		paginationOpts: { numItems, cursor },
	});
}

/** Walk every page the way the client's infinite scroll does. */
async function walk(
	t: T,
	args: { sort?: SellerSort; filters?: SellerStatusFilter[]; q?: string; numItems: number },
) {
	const names: string[] = [];
	let cursor: string | null = null;
	let pages = 0;
	for (;;) {
		const res = await page(t, { ...args, cursor });
		pages++;
		names.push(...res.page.map((r) => r.storeName));
		if (res.isDone) break;
		cursor = res.continueCursor;
		if (pages > 50) throw new Error("pagination never finished");
	}
	return { names, pages };
}

describe("listSellersPage — the gate and the cursor", () => {
	test("rejects a non-admin", async () => {
		const t = setup();
		await seedStore(t, "user_x", "Mine", "mine");
		await expect(
			t.withIdentity({ subject: "user_x" }).query(api.adminSellers.listSellersPage, {
				paginationOpts: { numItems: 10, cursor: null },
			}),
		).rejects.toThrow(/Not authorized/);
	});

	test("pages newest-first with no duplicates and isDone on the last page", async () => {
		const t = setup();
		await seedMany(t, 7);
		const p1 = await page(t, { sort: "newest", numItems: 3, cursor: null });
		expect(p1.page.map((r) => r.storeName)).toEqual(["Store 7", "Store 6", "Store 5"]);
		expect(p1.isDone).toBe(false);
		const p2 = await page(t, { sort: "newest", numItems: 3, cursor: p1.continueCursor });
		expect(p2.page.map((r) => r.storeName)).toEqual(["Store 4", "Store 3", "Store 2"]);
		const p3 = await page(t, { sort: "newest", numItems: 3, cursor: p2.continueCursor });
		expect(p3.page.map((r) => r.storeName)).toEqual(["Store 1"]);
		expect(p3.isDone).toBe(true);
	});

	test("every row is the full AdminSellerRow the directory already renders", async () => {
		const t = setup();
		await seedStore(t, "user_1", "Kak Ros Kitchen", "kak-ros");
		const p1 = await page(t, { numItems: 5, cursor: null });
		const row = p1.page[0];
		expect(row).toMatchObject({
			storeName: "Kak Ros Kitchen",
			slug: "kak-ros",
			ownerIsAdmin: false,
			unclaimed: false,
			availability: { state: "open" },
			seats: { active: 1 },
		});
		expect(typeof row?.createdAt).toBe("number");
	});
});

describe("listSellersPage — sorts", () => {
	test("founding: founders by rank first on page ONE only, then newest; founders never repeat", async () => {
		const t = setup();
		const ids = await seedMany(t, 6);
		// Store 2 is founder #2, Store 4 is founder #1 — both older than the newest.
		await t.run(async (ctx) => {
			await ctx.db.patch(ids[1] as Id<"retailers">, { isFoundingMember: true, foundingMemberRank: 2 });
			await ctx.db.patch(ids[3] as Id<"retailers">, { isFoundingMember: true, foundingMemberRank: 1 });
		});
		const p1 = await page(t, { sort: "founding", numItems: 2, cursor: null });
		expect(p1.page.map((r) => r.storeName)).toEqual([
			"Store 4",
			"Store 2",
			"Store 6",
			"Store 5",
		]);
		const { names } = await walk(t, { sort: "founding", numItems: 2 });
		expect(names).toEqual(["Store 4", "Store 2", "Store 6", "Store 5", "Store 3", "Store 1"]);
	});

	test("name: files a lowercase-leading name under its letter, not after Z", async () => {
		const t = setup();
		await seedStore(t, "u1", "Zed Outdoor", "zed");
		await seedStore(t, "u2", "iKuih by Mak", "ikuih");
		await seedStore(t, "u3", "Haji Catering", "haji");
		const { names } = await walk(t, { sort: "name", numItems: 2 });
		expect(names).toEqual(["Haji Catering", "iKuih by Mak", "Zed Outdoor"]);
	});

	test("renaming a store moves it in the name sort (updateSettings keeps the key)", async () => {
		const t = setup();
		await seedStore(t, "u1", "Zed Outdoor", "zed");
		const b = await seedStore(t, "u2", "Mid Store", "mid");
		await t
			.withIdentity({ subject: "u2" })
			.mutation(api.retailers.updateSettings, { storeName: "aaa first" });
		const { names } = await walk(t, { sort: "name", numItems: 5 });
		expect(names).toEqual(["aaa first", "Zed Outdoor"]);
		expect(b.slug).toBe("mid");
	});
});

describe("listSellersPage — filter and search are server-side", () => {
	test("a rare filter is reached across short pages and the chain still ends", async () => {
		const t = setup();
		const ids = await seedMany(t, 6);
		await t.run(async (ctx) => {
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", ids[0] as Id<"retailers">))
				.first();
			if (!sub) throw new Error("no sub");
			await ctx.db.patch(sub._id, { status: "past_due", comped: false });
		});
		const { names } = await walk(t, { filters: ["past_due"], numItems: 2 });
		expect(names).toEqual(["Store 1"]);
		const all = await walk(t, { filters: ["trialing"], numItems: 2 });
		expect(all.names).toHaveLength(5);
	});

	test("search matches name, slug, handover email and three phone digits", async () => {
		const t = setup();
		const a = await seedStore(t, "u1", "Kak Ros Kitchen", "kak-ros-kitchen");
		await seedStore(t, "u2", "Bearcamp", "bearcamp");
		await t.run(async (ctx) => {
			await ctx.db.patch(a._id, { waPhone: "60123456789", pendingOwnerEmail: "vendor@handover.my" });
		});
		expect((await walk(t, { q: "ros kit", numItems: 5 })).names).toEqual(["Kak Ros Kitchen"]);
		expect((await walk(t, { q: "-ros-", numItems: 5 })).names).toEqual(["Kak Ros Kitchen"]);
		expect((await walk(t, { q: "HANDOVER", numItems: 5 })).names).toEqual(["Kak Ros Kitchen"]);
		expect((await walk(t, { q: "+60 12-345", numItems: 5 })).names).toEqual(["Kak Ros Kitchen"]);
		expect((await walk(t, { q: "nothing-here", numItems: 5 })).names).toEqual([]);
	});

	// z8r3fdzn6r: the statuses are an OR. A store in two picked statuses lands
	// once, and the server decides it — the page never unions client-side.
	test("picked statuses combine with OR, and a store in two of them lands once", async () => {
		const t = setup();
		const ids = await seedMany(t, 4);
		await t.run(async (ctx) => {
			const subOf = async (id: Id<"retailers">) => {
				const sub = await ctx.db
					.query("subscriptions")
					.withIndex("by_retailer", (q) => q.eq("retailerId", id))
					.first();
				if (!sub) throw new Error("no sub");
				return sub;
			};
			// Store 1: past due AND an open Enterprise ask — in two statuses at once.
			await ctx.db.patch((await subOf(ids[0] as Id<"retailers">))._id, { status: "past_due", comped: false });
			await ctx.db.patch(ids[0] as Id<"retailers">, { enterpriseInterestAt: Date.now() });
			// Store 2: cancelled.
			await ctx.db.patch((await subOf(ids[1] as Id<"retailers">))._id, { status: "cancelled", comped: false });
		});
		const { names } = await walk(t, {
			filters: ["past_due", "wants_enterprise", "cancelled"],
			numItems: 2,
		});
		expect([...names].sort()).toEqual(["Store 1", "Store 2"]);
		expect((await walk(t, { filters: ["cancelled", "trialing"], numItems: 2 })).names).toHaveLength(3);
		// An empty list is "All", same as leaving it out.
		expect((await walk(t, { filters: [], numItems: 2 })).names).toHaveLength(4);
	});

	test("search and filter compose", async () => {
		const t = setup();
		const ids = await seedMany(t, 3);
		await t.run(async (ctx) => {
			await ctx.db.patch(ids[2] as Id<"retailers">, { enterpriseInterestAt: Date.now() });
		});
		expect((await walk(t, { filters: ["wants_enterprise"], q: "store", numItems: 5 })).names).toEqual(["Store 3"]);
		expect((await walk(t, { filters: ["wants_enterprise"], q: "store 1", numItems: 5 })).names).toEqual([]);
	});
});

describe("countSellerBuckets", () => {
	test("agrees with the list for every filter and is not capped at this size", async () => {
		const t = setup();
		const ids = await seedMany(t, 5);
		await t.run(async (ctx) => {
			await ctx.db.patch(ids[0] as Id<"retailers">, { enterpriseInterestAt: Date.now() });
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", ids[1] as Id<"retailers">))
				.first();
			if (!sub) throw new Error("no sub");
			await ctx.db.patch(sub._id, { status: "past_due", comped: false });
		});
		const { counts, capped } = await admin(t).query(api.adminSellers.countSellerBuckets, {});
		expect(capped).toBe(false);
		expect(counts.all).toBe(5);
		expect(counts.past_due).toBe(1);
		expect(counts.trialing).toBe(4);
		expect(counts.wants_enterprise).toBe(1);
		for (const filter of ["past_due", "trialing", "wants_enterprise", "active"] as const) {
			const { names } = await walk(t, { filters: [filter], numItems: 2 });
			expect(names).toHaveLength(counts[filter]);
		}
	});

	test("rejects a non-admin", async () => {
		const t = setup();
		await seedStore(t, "user_x", "Mine", "mine");
		await expect(
			t.withIdentity({ subject: "user_x" }).query(api.adminSellers.countSellerBuckets, {}),
		).rejects.toThrow(/Not authorized/);
	});
});

describe("storeNameKey", () => {
	test("is written on create and backfilled where missing, idempotently", async () => {
		const t = setup();
		const a = await seedStore(t, "u1", "  Kak   Ros ", "kak-ros");
		expect((await t.run((ctx) => ctx.db.get(a._id)))?.storeNameKey).toBe("kak ros");
		await t.run(async (ctx) => {
			await ctx.db.patch(a._id, { storeNameKey: undefined });
		});
		expect((await t.run((ctx) => ctx.db.get(a._id)))?.storeNameKey).toBeUndefined();
		const first = await t.mutation(internal.migrations.backfillStoreNameKey, {});
		expect(first).toMatchObject({ patched: 1, isDone: true });
		expect((await t.run((ctx) => ctx.db.get(a._id)))?.storeNameKey).toBe("kak ros");
		const second = await t.mutation(internal.migrations.backfillStoreNameKey, {});
		expect(second).toMatchObject({ patched: 0, isDone: true });
	});
});

describe("enterprise.listContractTemplates", () => {
	test("lists every other store's live contract, never the excluded store's", async () => {
		const t = setup();
		const a = await seedStore(t, "u1", "Contract A", "contract-a");
		const b = await seedStore(t, "u2", "Plain B", "plain-b");
		await admin(t).mutation(api.enterprise.setContract, {
			retailerId: a._id,
			baseFeeMinor: 50000,
			includedCredits: 1000,
			overageRateMinor: 50,
			blockSize: 100,
			billingCycle: "monthly",
			contactName: "Arif",
		});
		const forB = await admin(t).query(api.enterprise.listContractTemplates, { exclude: b._id });
		expect(forB.map((x) => x.storeName)).toEqual(["Contract A"]);
		expect(forB[0]?.contract.baseFeeMinor).toBe(50000);
		const forA = await admin(t).query(api.enterprise.listContractTemplates, { exclude: a._id });
		expect(forA).toEqual([]);
		await expect(
			t.withIdentity({ subject: "u2" }).query(api.enterprise.listContractTemplates, {}),
		).rejects.toThrow(/Not authorized/);
	});
});

describe("listPickerStores — the showcase picker's slim read", () => {
	const pick = (t: T, country: "MY" | "SG") =>
		admin(t).query(api.adminSellers.listPickerStores, { country });

	test("rejects a non-admin", async () => {
		const t = setup();
		await seedStore(t, "user_x", "Mine", "mine");
		await expect(
			t.withIdentity({ subject: "user_x" }).query(api.adminSellers.listPickerStores, {
				country: "MY",
			}),
		).rejects.toThrow(/Not authorized/);
	});

	test("returns the country's stores only, A–Z by name, with a country-less store read as MY", async () => {
		const t = setup();
		const zed = await seedStore(t, "u1", "Zed Outdoor", "zed");
		await seedStore(t, "u2", "iKuih by Mak", "ikuih");
		await seedStore(t, "u3", "Haji Catering", "haji");
		const sg = await seedStore(t, "u4", "Lion City Bakes", "lion-city");
		await t.run(async (ctx) => {
			await ctx.db.patch(sg._id, { country: "SG" });
			// An older store never stamped with a country belongs to MY.
			await ctx.db.patch(zed._id, { country: undefined });
		});
		const my = await pick(t, "MY");
		expect(my.stores.map((s) => s.storeName)).toEqual([
			"Haji Catering",
			"iKuih by Mak",
			"Zed Outdoor",
		]);
		expect(my.capped).toBe(false);
		expect((await pick(t, "SG")).stores.map((s) => s.slug)).toEqual(["lion-city"]);
	});

	test("carries only what the picker draws: the internal, hidden and unlisted flags", async () => {
		const t = setup();
		const plain = await seedStore(t, "u1", "Plain Store", "plain");
		const hidden = await seedStore(t, "u2", "Hidden Store", "hidden");
		const unlisted = await seedStore(t, "u3", "Unlisted Store", "unlisted");
		await seedStore(t, ADMIN, "Admin Test Store", "admin-test-store");
		await t.run(async (ctx) => {
			await ctx.db.patch(hidden._id, {
				marketplaceHidden: { at: Date.now(), note: "Spam listing" },
			});
			await ctx.db.patch(unlisted._id, { marketplaceUnlistedAt: Date.now() });
		});
		const { stores } = await pick(t, "MY");
		const by = (slug: string) => stores.find((s) => s.slug === slug);
		expect(by("plain")).toEqual({
			_id: plain._id,
			storeName: "Plain Store",
			slug: "plain",
			internal: false,
			hidden: false,
			unlisted: false,
		});
		expect(by("hidden")?.hidden).toBe(true);
		expect(by("unlisted")?.unlisted).toBe(true);
		// An admin-owned store never lists on /stores, so the picker refuses it.
		expect(by("admin-test-store")?.internal).toBe(true);
	});
});
