/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { SHOWCASE_MEMBER_CAP } from "./lib/showcase";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const ADMIN = "user_showcase_admin";
let prevAdminEnv: string | undefined;
beforeEach(() => {
	prevAdminEnv = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
});
afterEach(() => {
	process.env.ADMIN_USER_IDS = prevAdminEnv;
});

const DAY = 24 * 60 * 60 * 1000;

/** A store with one storefront-visible product — the minimum listable unit. */
async function seedListableStore(
	t: ReturnType<typeof setup>,
	userId: string,
	slug: string,
	country: "MY" | "SG" = "MY",
): Promise<Id<"retailers">> {
	const asUser = t.withIdentity({ subject: userId });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: `Store ${slug}`,
		slug,
		country,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	await asUser.mutation(api.products.create, {
		retailerId: retailer._id,
		name: "Rendang 1kg",
		currency: country === "SG" ? "SGD" : "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		variants: [{ optionValues: [], price: 10000, onHand: 10 }],
	});
	return retailer._id;
}

async function createShowcase(
	t: ReturnType<typeof setup>,
	title = "Malaysia Campfest 2026",
	country: "MY" | "SG" = "MY",
) {
	const asAdmin = t.withIdentity({ subject: ADMIN });
	const showcaseId = await asAdmin.mutation(api.showcases.create, {
		title,
		country,
	});
	return { asAdmin, showcaseId };
}

describe("admin gate", () => {
	test("every showcase write refuses a non-admin, and the admin list is admin-only", async () => {
		const t = setup();
		const asSeller = t.withIdentity({ subject: "user_not_admin" });
		await expect(
			asSeller.mutation(api.showcases.create, {
				title: "Nope",
				country: "MY",
			}),
		).rejects.toThrow(/Not authorized/);
		await expect(asSeller.query(api.showcases.listForAdmin)).rejects.toThrow(
			/Not authorized/,
		);
		await expect(
			asSeller.mutation(api.showcases.generateCoverUploadUrl, {}),
		).rejects.toThrow(/Not authorized/);
		// Anonymous too — the public read is `listShowcases`, nothing else.
		await expect(t.query(api.showcases.listForAdmin)).rejects.toThrow();
	});
});

describe("create → publish → buyers", () => {
	test("a new showcase is a draft with a slug from its title, and buyers see nothing", async () => {
		const t = setup();
		const { asAdmin, showcaseId } = await createShowcase(t);
		const row = await asAdmin.query(api.showcases.getForAdmin, { showcaseId });
		expect(row?.slug).toBe("malaysia-campfest-2026");
		expect(row?.state).toBe("draft");
		expect(row?.members).toEqual([]);
		expect(await t.query(api.showcases.listShowcases)).toEqual([]);
	});

	test("two showcases with the same title get distinct handles", async () => {
		const t = setup();
		const a = await createShowcase(t, "Deepavali Bazaar");
		const b = await createShowcase(t, "Deepavali Bazaar");
		const rows = await a.asAdmin.query(api.showcases.listForAdmin);
		expect(rows.map((r) => r.slug).sort()).toEqual([
			"deepavali-bazaar",
			"deepavali-bazaar-2",
		]);
		expect(a.showcaseId).not.toBe(b.showcaseId);
	});

	test("publishing an empty showcase is refused by name", async () => {
		const t = setup();
		const { asAdmin, showcaseId } = await createShowcase(t);
		await expect(
			asAdmin.mutation(api.showcases.publish, { showcaseId }),
		).rejects.toThrow(/at least one store/);
	});

	test("published with a listable member: live for buyers, member slug + label ride the payload, no ids", async () => {
		const t = setup();
		const retailerId = await seedListableStore(t, "user_sc_a", "rimba-gear");
		const { asAdmin, showcaseId } = await createShowcase(t);
		await asAdmin.mutation(api.showcases.setMembers, {
			showcaseId,
			members: [{ retailerId, label: "  Booth   B4 " }],
		});
		await asAdmin.mutation(api.showcases.publish, { showcaseId });
		const live = await t.query(api.showcases.listShowcases);
		expect(live).toHaveLength(1);
		expect(live[0].slug).toBe("malaysia-campfest-2026");
		expect(live[0].members).toEqual([
			{ slug: "rimba-gear", label: "Booth B4", coverImageUrl: undefined },
		]);
		// Payload safety: nothing that names a row or a draft state.
		const serialised = JSON.stringify(live[0]);
		expect(serialised).not.toContain("_id");
		expect(serialised).not.toContain("publishedAt");
		expect(serialised).not.toContain(retailerId);
	});

	test("the window is read-time: a future start is scheduled, a passed end is ended — neither reaches buyers", async () => {
		const t = setup();
		const retailerId = await seedListableStore(t, "user_sc_w", "kedai-w");
		const { asAdmin, showcaseId } = await createShowcase(t);
		await asAdmin.mutation(api.showcases.setMembers, {
			showcaseId,
			members: [{ retailerId }],
		});
		await asAdmin.mutation(api.showcases.update, {
			showcaseId,
			startsAt: Date.now() + DAY,
		});
		await asAdmin.mutation(api.showcases.publish, { showcaseId });
		expect(
			(await asAdmin.query(api.showcases.getForAdmin, { showcaseId }))?.state,
		).toBe("scheduled");
		expect(await t.query(api.showcases.listShowcases)).toEqual([]);

		await asAdmin.mutation(api.showcases.update, {
			showcaseId,
			startsAt: null,
			endsAt: Date.now() - 1,
		});
		expect(
			(await asAdmin.query(api.showcases.getForAdmin, { showcaseId }))?.state,
		).toBe("ended");
		expect(await t.query(api.showcases.listShowcases)).toEqual([]);

		await asAdmin.mutation(api.showcases.update, { showcaseId, endsAt: null });
		expect(await t.query(api.showcases.listShowcases)).toHaveLength(1);
	});

	test("unpublish takes it down at once and keeps everything; publish again restores it", async () => {
		const t = setup();
		const retailerId = await seedListableStore(t, "user_sc_u", "kedai-u");
		const { asAdmin, showcaseId } = await createShowcase(t);
		await asAdmin.mutation(api.showcases.setMembers, {
			showcaseId,
			members: [{ retailerId, label: "Booth 1" }],
		});
		await asAdmin.mutation(api.showcases.publish, { showcaseId });
		await asAdmin.mutation(api.showcases.unpublish, { showcaseId });
		expect(await t.query(api.showcases.listShowcases)).toEqual([]);
		const draft = await asAdmin.query(api.showcases.getForAdmin, { showcaseId });
		expect(draft?.state).toBe("draft");
		expect(draft?.members[0].label).toBe("Booth 1");
		await asAdmin.mutation(api.showcases.publish, { showcaseId });
		expect(await t.query(api.showcases.listShowcases)).toHaveLength(1);
	});

	test("remove deletes the row; the store is untouched", async () => {
		const t = setup();
		const retailerId = await seedListableStore(t, "user_sc_r", "kedai-r");
		const { asAdmin, showcaseId } = await createShowcase(t);
		await asAdmin.mutation(api.showcases.setMembers, {
			showcaseId,
			members: [{ retailerId }],
		});
		await asAdmin.mutation(api.showcases.remove, { showcaseId });
		expect(await asAdmin.query(api.showcases.listForAdmin)).toEqual([]);
		expect(
			(await t.query(api.marketplace.listStores)).map((c) => c.slug),
		).toEqual(["kedai-r"]);
	});
});

describe("members obey the directory's listable rule", () => {
	test("an opted-out member is dropped from the public payload and NAMED on the admin row", async () => {
		const t = setup();
		const shown = await seedListableStore(t, "user_sc_m1", "kedai-shown");
		const optedOut = await seedListableStore(t, "user_sc_m2", "kedai-out");
		await t
			.withIdentity({ subject: "user_sc_m2" })
			.mutation(api.retailers.updateSettings, { marketplaceListed: false });
		const { asAdmin, showcaseId } = await createShowcase(t);
		await asAdmin.mutation(api.showcases.setMembers, {
			showcaseId,
			members: [{ retailerId: optedOut }, { retailerId: shown }],
		});
		await asAdmin.mutation(api.showcases.publish, { showcaseId });
		const live = await t.query(api.showcases.listShowcases);
		expect(live[0].members.map((m) => m.slug)).toEqual(["kedai-shown"]);
		const admin = await asAdmin.query(api.showcases.getForAdmin, { showcaseId });
		expect(admin?.members.map((m) => [m.slug, m.notListed])).toEqual([
			["kedai-out", "opted_out"],
			["kedai-shown", null],
		]);
	});

	test("an admin-hidden member never rides the public payload", async () => {
		const t = setup();
		const retailerId = await seedListableStore(t, "user_sc_h", "kedai-h");
		const { asAdmin, showcaseId } = await createShowcase(t);
		await asAdmin.mutation(api.showcases.setMembers, {
			showcaseId,
			members: [{ retailerId }],
		});
		await asAdmin.mutation(api.showcases.publish, { showcaseId });
		await asAdmin.mutation(api.admin.hideFromMarketplace, { retailerId });
		// Its only member is hidden, so the whole showcase is an empty banner —
		// and an empty banner never reaches a buyer.
		expect(await t.query(api.showcases.listShowcases)).toEqual([]);
		const admin = await asAdmin.query(api.showcases.getForAdmin, { showcaseId });
		expect(admin?.members[0].notListed).toBe("hidden_by_admin");
	});

	test("a store with no visible product is named, not dropped silently", async () => {
		const t = setup();
		const asUser = t.withIdentity({ subject: "user_sc_np" });
		await asUser.mutation(api.retailers.createRetailer, {
			storeName: "Empty",
			slug: "kedai-empty",
		});
		const retailer = await asUser.query(api.retailers.getMyRetailer);
		if (!retailer) throw new Error("seed failed");
		const { asAdmin, showcaseId } = await createShowcase(t);
		await asAdmin.mutation(api.showcases.setMembers, {
			showcaseId,
			members: [{ retailerId: retailer._id }],
		});
		const admin = await asAdmin.query(api.showcases.getForAdmin, { showcaseId });
		expect(admin?.members[0].notListed).toBe("no_visible_product");
	});

	test("a member from the other region is refused; so is changing region with members in place", async () => {
		const t = setup();
		const sg = await seedListableStore(t, "user_sc_sg", "kedai-sg", "SG");
		const my = await seedListableStore(t, "user_sc_my", "kedai-my", "MY");
		const { asAdmin, showcaseId } = await createShowcase(t);
		await expect(
			asAdmin.mutation(api.showcases.setMembers, {
				showcaseId,
				members: [{ retailerId: sg }],
			}),
		).rejects.toThrow(/not a MY store/);
		await asAdmin.mutation(api.showcases.setMembers, {
			showcaseId,
			members: [{ retailerId: my }],
		});
		await expect(
			asAdmin.mutation(api.showcases.update, { showcaseId, country: "SG" }),
		).rejects.toThrow(/Remove the 1 store first/);
	});

	test("duplicates collapse, order is kept, and the cap is enforced", async () => {
		const t = setup();
		const a = await seedListableStore(t, "user_sc_d1", "kedai-d1");
		const b = await seedListableStore(t, "user_sc_d2", "kedai-d2");
		const { asAdmin, showcaseId } = await createShowcase(t);
		await asAdmin.mutation(api.showcases.setMembers, {
			showcaseId,
			members: [{ retailerId: b }, { retailerId: a }, { retailerId: b }],
		});
		const admin = await asAdmin.query(api.showcases.getForAdmin, { showcaseId });
		expect(admin?.members.map((m) => m.slug)).toEqual(["kedai-d2", "kedai-d1"]);
		await expect(
			asAdmin.mutation(api.showcases.setMembers, {
				showcaseId,
				members: Array.from({ length: SHOWCASE_MEMBER_CAP + 1 }, (_, i) => ({
					retailerId: `fake_${i}` as Id<"retailers">,
				})),
			}),
		).rejects.toThrow();
	});
});

describe("a Kedaipal or test store can't be added", () => {
	test("adding one is refused by name; one already in the list survives a save", async () => {
		const t = setup();
		const listable = await seedListableStore(t, "user_sc_i1", "kedai-i1");
		// Owned by an admin login ⇒ an internal store, never on /stores.
		const internal = await seedListableStore(t, ADMIN, "house-demo");
		const { asAdmin, showcaseId } = await createShowcase(t);
		await expect(
			asAdmin.mutation(api.showcases.setMembers, {
				showcaseId,
				members: [{ retailerId: listable }, { retailerId: internal }],
			}),
		).rejects.toThrow(/Kedaipal or test store/);
		// A row that predates the rule is left alone: relabelling the OTHER
		// member must not fail on a store the admin didn't touch.
		await t.run(async (ctx) => {
			await ctx.db.patch(showcaseId, {
				members: [{ retailerId: listable }, { retailerId: internal }],
			});
		});
		await asAdmin.mutation(api.showcases.setMembers, {
			showcaseId,
			members: [
				{ retailerId: listable, label: "Booth B4" },
				{ retailerId: internal },
			],
		});
		const admin = await asAdmin.query(api.showcases.getForAdmin, { showcaseId });
		expect(admin?.members.map((m) => [m.slug, m.notListed])).toEqual([
			["kedai-i1", null],
			["house-demo", "internal"],
		]);
	});
});

describe("the custom look", () => {
	test("custom needs a colour; a bad one is refused; buyers get it only on the custom look", async () => {
		const t = setup();
		const store = await seedListableStore(t, "user_sc_c1", "kedai-c1");
		const { asAdmin, showcaseId } = await createShowcase(t);
		await asAdmin.mutation(api.showcases.setMembers, {
			showcaseId,
			members: [{ retailerId: store }],
		});
		await asAdmin.mutation(api.showcases.publish, { showcaseId });

		await expect(
			asAdmin.mutation(api.showcases.update, { showcaseId, theme: "custom" }),
		).rejects.toThrow(/Pick a colour/);
		await expect(
			asAdmin.mutation(api.showcases.update, {
				showcaseId,
				theme: "custom",
				customColor: "pink",
			}),
		).rejects.toThrow(/#rrggbb/);

		await asAdmin.mutation(api.showcases.update, {
			showcaseId,
			theme: "custom",
			customColor: "#FF00AA",
		});
		let [pub] = await t.query(api.showcases.listShowcases);
		expect(pub.theme).toBe("custom");
		expect(pub.customColor).toBe("#ff00aa");

		// Switching back to a curated look keeps the pick for the admin (so
		// Custom restores it) but stops sending it to buyers.
		await asAdmin.mutation(api.showcases.update, { showcaseId, theme: "plain" });
		[pub] = await t.query(api.showcases.listShowcases);
		expect(pub.theme).toBe("plain");
		expect(pub.customColor).toBeUndefined();
		const admin = await asAdmin.query(api.showcases.getForAdmin, { showcaseId });
		expect(admin?.customColor).toBe("#ff00aa");
	});
});

describe("ordering + the window rule at the door", () => {
	test("reorder rewrites /stores order; buyers get it in that order", async () => {
		const t = setup();
		const r1 = await seedListableStore(t, "user_sc_o1", "kedai-o1");
		const r2 = await seedListableStore(t, "user_sc_o2", "kedai-o2");
		const first = await createShowcase(t, "First");
		const second = await createShowcase(t, "Second");
		const asAdmin = first.asAdmin;
		for (const [id, retailerId] of [
			[first.showcaseId, r1],
			[second.showcaseId, r2],
		] as const) {
			await asAdmin.mutation(api.showcases.setMembers, {
				showcaseId: id,
				members: [{ retailerId }],
			});
			await asAdmin.mutation(api.showcases.publish, { showcaseId: id });
		}
		expect(
			(await t.query(api.showcases.listShowcases)).map((s) => s.title),
		).toEqual(["First", "Second"]);
		await asAdmin.mutation(api.showcases.reorder, {
			orderedIds: [second.showcaseId, first.showcaseId],
		});
		expect(
			(await t.query(api.showcases.listShowcases)).map((s) => s.title),
		).toEqual(["Second", "First"]);
	});

	test("an end before the start is refused at the door", async () => {
		const t = setup();
		const { asAdmin, showcaseId } = await createShowcase(t);
		await expect(
			asAdmin.mutation(api.showcases.update, {
				showcaseId,
				startsAt: Date.now() + DAY,
				endsAt: Date.now(),
			}),
		).rejects.toThrow(/end after it starts/);
	});

	test("every write lands in the audit log under its own name", async () => {
		const t = setup();
		const retailerId = await seedListableStore(t, "user_sc_log", "kedai-log");
		const { asAdmin, showcaseId } = await createShowcase(t);
		await asAdmin.mutation(api.showcases.update, { showcaseId, theme: "ocean" });
		await asAdmin.mutation(api.showcases.setMembers, {
			showcaseId,
			members: [{ retailerId }],
		});
		await asAdmin.mutation(api.showcases.publish, { showcaseId });
		await asAdmin.mutation(api.showcases.unpublish, { showcaseId });
		await asAdmin.mutation(api.showcases.reorder, { orderedIds: [showcaseId] });
		await asAdmin.mutation(api.showcases.remove, { showcaseId });
		const actions = await t.run(async (ctx) =>
			(await ctx.db.query("adminAuditLog").collect()).map((r) => r.action),
		);
		expect(actions).toEqual([
			"showcases.create",
			"showcases.update",
			"showcases.setMembers",
			"showcases.publish",
			"showcases.unpublish",
			"showcases.reorder",
			"showcases.remove",
		]);
	});
});

describe("the seller is told", () => {
	test("myListingReadiness names the published showcases the store is in, with its label; drafts stay private", async () => {
		const t = setup();
		const retailerId = await seedListableStore(t, "user_sc_s", "kedai-s");
		const asSeller = t.withIdentity({ subject: "user_sc_s" });
		const { asAdmin, showcaseId } = await createShowcase(t);
		await asAdmin.mutation(api.showcases.setMembers, {
			showcaseId,
			members: [{ retailerId, label: "Booth B4" }],
		});
		let readiness = await asSeller.query(api.marketplace.myListingReadiness, {
			retailerId,
		});
		expect(readiness.featuredIn).toEqual([]);
		await asAdmin.mutation(api.showcases.publish, { showcaseId });
		readiness = await asSeller.query(api.marketplace.myListingReadiness, {
			retailerId,
		});
		expect(readiness.featuredIn).toMatchObject([
			{
				slug: "malaysia-campfest-2026",
				title: "Malaysia Campfest 2026",
				label: "Booth B4",
				state: "live",
			},
		]);
	});
});
