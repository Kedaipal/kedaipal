/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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

async function seedRetailer(
	t: ReturnType<typeof convexTest>,
	userId: string,
	slugSuffix = "",
) {
	const asUser = t.withIdentity({ subject: userId });
	const safeSuffix = `${userId}${slugSuffix}`.replace(/[^a-z0-9]/g, "");
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Test Store",
		slug: `test-store-${safeSuffix}`,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

async function seedLocation(
	t: ReturnType<typeof convexTest>,
	userId: string,
	retailerId: Id<"retailers">,
	label: string,
	address = "12 Jln Tun Razak, 50400 Kuala Lumpur",
): Promise<Id<"pickupLocations">> {
	const asUser = t.withIdentity({ subject: userId });
	const { pickupLocationId } = await asUser.mutation(
		api.pickupLocations.create,
		{ retailerId, label, address },
	);
	return pickupLocationId;
}

describe("pickupLocations — CRUD", () => {
	test("create persists trimmed fields and seeds sortOrder = 0", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });

		const { pickupLocationId } = await asUser.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "  Main Store  ",
				address: "  12 Jln Tun Razak, KL  ",
				mapsUrl: "https://maps.app.goo.gl/abc",
				notes: "  Bring your order ID.  ",
			},
		);

		const rows = await asUser.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows).toHaveLength(1);
		const row = rows[0];
		expect(row._id).toBe(pickupLocationId);
		expect(row.label).toBe("Main Store");
		expect(row.address).toBe("12 Jln Tun Razak, KL");
		expect(row.mapsUrl).toBe("https://maps.app.goo.gl/abc");
		expect(row.notes).toBe("Bring your order ID.");
		expect(row.isActive).toBe(true);
		expect(row.sortOrder).toBe(0);
	});

	test("create rejects a non-allowlisted mapsUrl host", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		await expect(
			asUser.mutation(api.pickupLocations.create, {
				retailerId: retailer._id,
				label: "X",
				address: "12 Some Street, KL",
				mapsUrl: "https://example.com/foo",
			}),
		).rejects.toThrow(/Waze .* Google Maps/i);
	});

	test("update patches only the fields supplied", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const id = await seedLocation(t, USER_A, retailer._id, "Original");
		const asUser = t.withIdentity({ subject: USER_A });

		await asUser.mutation(api.pickupLocations.update, {
			pickupLocationId: id,
			label: "Renamed",
		});
		const rows = await asUser.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows[0].label).toBe("Renamed");
		// address untouched
		expect(rows[0].address).toBe("12 Jln Tun Razak, 50400 Kuala Lumpur");
	});

	test("update clears mapsUrl when empty string is sent", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		const { pickupLocationId } = await asUser.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "Main",
				address: "12 Jln Tun Razak, KL",
				mapsUrl: "https://maps.app.goo.gl/abc",
			},
		);
		await asUser.mutation(api.pickupLocations.update, {
			pickupLocationId,
			mapsUrl: "",
		});
		const rows = await asUser.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows[0].mapsUrl).toBeUndefined();
	});
});

describe("pickupLocations — drop-off kind & schedule note", () => {
	test("create defaults locationType to self_collect when omitted", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		await asUser.mutation(api.pickupLocations.create, {
			retailerId: retailer._id,
			label: "Main Store",
			address: "12 Jln Tun Razak, KL",
		});
		const rows = await asUser.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows[0].locationType).toBe("self_collect");
		expect(rows[0].scheduleNote).toBeUndefined();
	});

	test("create persists a drop_off point with a trimmed schedule note", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		await asUser.mutation(api.pickupLocations.create, {
			retailerId: retailer._id,
			label: "Pasar Tani Seksyen 7",
			address: "Seksyen 7, Shah Alam",
			locationType: "drop_off",
			scheduleNote: "  Every Sat 3-5pm  ",
		});
		const rows = await asUser.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows[0].locationType).toBe("drop_off");
		expect(rows[0].scheduleNote).toBe("Every Sat 3-5pm");
	});

	test("create rejects a schedule note over 120 chars", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		await expect(
			asUser.mutation(api.pickupLocations.create, {
				retailerId: retailer._id,
				label: "X",
				address: "12 Jln Tun Razak, KL",
				locationType: "drop_off",
				scheduleNote: "a".repeat(121),
			}),
		).rejects.toThrow(/at most 120/i);
	});

	test("update re-tags the kind and clears the schedule note with empty string", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		const { pickupLocationId } = await asUser.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "Meetup",
				address: "Seksyen 7",
				locationType: "drop_off",
				scheduleNote: "Every Sat 3-5pm",
			},
		);
		await asUser.mutation(api.pickupLocations.update, {
			pickupLocationId,
			locationType: "self_collect",
			scheduleNote: "",
		});
		const rows = await asUser.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows[0].locationType).toBe("self_collect");
		expect(rows[0].scheduleNote).toBeUndefined();
	});

	test("listActivePublicBySlug surfaces locationType + scheduleNote for the picker", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		await asUser.mutation(api.pickupLocations.create, {
			retailerId: retailer._id,
			label: "Pasar Tani",
			address: "Seksyen 7",
			locationType: "drop_off",
			scheduleNote: "Every Sat 3-5pm",
		});
		const rows = await t.query(api.pickupLocations.listActivePublicBySlug, {
			slug: retailer.slug,
		});
		expect(rows[0].locationType).toBe("drop_off");
		expect(rows[0].scheduleNote).toBe("Every Sat 3-5pm");
	});

	test("listActivePublicBySlug maps a legacy undefined locationType to self_collect", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		// Simulate a row written before drop-off existed (no locationType field).
		await t.run(async (ctx) => {
			await ctx.db.insert("pickupLocations", {
				retailerId: retailer._id,
				label: "Legacy",
				address: "Old Town",
				isActive: true,
				sortOrder: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});
		const rows = await t.query(api.pickupLocations.listActivePublicBySlug, {
			slug: retailer.slug,
		});
		expect(rows[0].locationType).toBe("self_collect");
	});
});

describe("pickupLocations — soft-delete & restore", () => {
	test("setActive(false) hides from public listing but keeps the row", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const id = await seedLocation(t, USER_A, retailer._id, "Main");
		const asUser = t.withIdentity({ subject: USER_A });

		await asUser.mutation(api.pickupLocations.setActive, {
			pickupLocationId: id,
			isActive: false,
		});

		// Public storefront sees nothing
		const publicRows = await t.query(
			api.pickupLocations.listActivePublicBySlug,
			{ slug: retailer.slug },
		);
		expect(publicRows).toHaveLength(0);

		// Dashboard still sees it (as inactive)
		const adminRows = await asUser.query(
			api.pickupLocations.listForRetailer,
			{ retailerId: retailer._id },
		);
		expect(adminRows).toHaveLength(1);
		expect(adminRows[0].isActive).toBe(false);
	});

	test("setActive(true) on an already-active location is a no-op", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const id = await seedLocation(t, USER_A, retailer._id, "Main");
		const asUser = t.withIdentity({ subject: USER_A });

		const before = await asUser.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		await asUser.mutation(api.pickupLocations.setActive, {
			pickupLocationId: id,
			isActive: true,
		});
		const after = await asUser.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(after[0].sortOrder).toBe(before[0].sortOrder);
		expect(after[0].updatedAt).toBe(before[0].updatedAt);
	});

	test("reactivated location moves to the end of the active list", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const id1 = await seedLocation(t, USER_A, retailer._id, "First");
		await seedLocation(t, USER_A, retailer._id, "Second");
		await seedLocation(t, USER_A, retailer._id, "Third");
		const asUser = t.withIdentity({ subject: USER_A });

		await asUser.mutation(api.pickupLocations.setActive, {
			pickupLocationId: id1,
			isActive: false,
		});
		await asUser.mutation(api.pickupLocations.setActive, {
			pickupLocationId: id1,
			isActive: true,
		});

		const rows = await asUser.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		// All active again; "First" should now be last
		const labelsByOrder = rows
			.filter((r) => r.isActive)
			.sort((a, b) => a.sortOrder - b.sortOrder)
			.map((r) => r.label);
		expect(labelsByOrder).toEqual(["Second", "Third", "First"]);
	});
});

describe("pickupLocations — reorder", () => {
	test("rewrites sortOrder to the index of each id (0..N-1)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const idA = await seedLocation(t, USER_A, retailer._id, "A");
		const idB = await seedLocation(t, USER_A, retailer._id, "B");
		const idC = await seedLocation(t, USER_A, retailer._id, "C");
		const asUser = t.withIdentity({ subject: USER_A });

		await asUser.mutation(api.pickupLocations.reorder, {
			retailerId: retailer._id,
			orderedIds: [idC, idA, idB],
		});

		const publicRows = await t.query(
			api.pickupLocations.listActivePublicBySlug,
			{ slug: retailer.slug },
		);
		expect(publicRows.map((r) => r.label)).toEqual(["C", "A", "B"]);
		expect(publicRows.map((r) => r.sortOrder)).toEqual([0, 1, 2]);
	});

	test("identity reorder is a valid no-op", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const idA = await seedLocation(t, USER_A, retailer._id, "A");
		const idB = await seedLocation(t, USER_A, retailer._id, "B");
		const asUser = t.withIdentity({ subject: USER_A });

		await asUser.mutation(api.pickupLocations.reorder, {
			retailerId: retailer._id,
			orderedIds: [idA, idB],
		});
		const publicRows = await t.query(
			api.pickupLocations.listActivePublicBySlug,
			{ slug: retailer.slug },
		);
		expect(publicRows.map((r) => r.label)).toEqual(["A", "B"]);
	});

	test("rejects when orderedIds length mismatches the active set", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const idA = await seedLocation(t, USER_A, retailer._id, "A");
		await seedLocation(t, USER_A, retailer._id, "B");
		const asUser = t.withIdentity({ subject: USER_A });

		await expect(
			asUser.mutation(api.pickupLocations.reorder, {
				retailerId: retailer._id,
				orderedIds: [idA],
			}),
		).rejects.toThrow(/every active pickup location exactly once/);
	});

	test("rejects duplicate ids", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const idA = await seedLocation(t, USER_A, retailer._id, "A");
		await seedLocation(t, USER_A, retailer._id, "B");
		const asUser = t.withIdentity({ subject: USER_A });

		await expect(
			asUser.mutation(api.pickupLocations.reorder, {
				retailerId: retailer._id,
				orderedIds: [idA, idA],
			}),
		).rejects.toThrow(/Duplicate id/);
	});

	test("rejects an inactive id", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const idA = await seedLocation(t, USER_A, retailer._id, "A");
		const idB = await seedLocation(t, USER_A, retailer._id, "B");
		const asUser = t.withIdentity({ subject: USER_A });

		await asUser.mutation(api.pickupLocations.setActive, {
			pickupLocationId: idB,
			isActive: false,
		});
		await expect(
			asUser.mutation(api.pickupLocations.reorder, {
				retailerId: retailer._id,
				orderedIds: [idA, idB],
			}),
		).rejects.toThrow(/every active pickup location exactly once/);
	});

	test("user B cannot reorder user A's pickup locations", async () => {
		const t = setup();
		const retailerA = await seedRetailer(t, USER_A, "_a");
		await seedRetailer(t, USER_B, "_b");
		const idA = await seedLocation(t, USER_A, retailerA._id, "A");
		const asB = t.withIdentity({ subject: USER_B });

		await expect(
			asB.mutation(api.pickupLocations.reorder, {
				retailerId: retailerA._id,
				orderedIds: [idA],
			}),
		).rejects.toThrow(/Forbidden/);
	});

	test("leaves inactive rows' sortOrder untouched", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const idA = await seedLocation(t, USER_A, retailer._id, "A");
		const idB = await seedLocation(t, USER_A, retailer._id, "B");
		const idC = await seedLocation(t, USER_A, retailer._id, "C");
		const asUser = t.withIdentity({ subject: USER_A });

		// Deactivate B and snapshot its sortOrder; reorder active [C, A]
		await asUser.mutation(api.pickupLocations.setActive, {
			pickupLocationId: idB,
			isActive: false,
		});
		const before = await asUser.query(
			api.pickupLocations.listForRetailer,
			{ retailerId: retailer._id },
		);
		const bSortOrderBefore = before.find((r) => r._id === idB)?.sortOrder;

		await asUser.mutation(api.pickupLocations.reorder, {
			retailerId: retailer._id,
			orderedIds: [idC, idA],
		});

		const after = await asUser.query(
			api.pickupLocations.listForRetailer,
			{ retailerId: retailer._id },
		);
		expect(after.find((r) => r._id === idB)?.sortOrder).toBe(
			bSortOrderBefore,
		);
	});
});

describe("pickupLocations — tenant isolation", () => {
	test("user B cannot list user A's pickup locations", async () => {
		const t = setup();
		const retailerA = await seedRetailer(t, USER_A, "_a");
		await seedRetailer(t, USER_B, "_b");
		await seedLocation(t, USER_A, retailerA._id, "Main");
		const asB = t.withIdentity({ subject: USER_B });

		await expect(
			asB.query(api.pickupLocations.listForRetailer, {
				retailerId: retailerA._id,
			}),
		).rejects.toThrow(/Forbidden/);
	});

	test("user B cannot update user A's pickup location", async () => {
		const t = setup();
		const retailerA = await seedRetailer(t, USER_A, "_a");
		await seedRetailer(t, USER_B, "_b");
		const id = await seedLocation(t, USER_A, retailerA._id, "Main");
		const asB = t.withIdentity({ subject: USER_B });

		await expect(
			asB.mutation(api.pickupLocations.update, {
				pickupLocationId: id,
				label: "Hijacked",
			}),
		).rejects.toThrow(/Forbidden/);
	});

	test("listActivePublicBySlug is unauthed but scoped by slug", async () => {
		const t = setup();
		const retailerA = await seedRetailer(t, USER_A, "_a");
		const retailerB = await seedRetailer(t, USER_B, "_b");
		await seedLocation(t, USER_A, retailerA._id, "A-Main");
		await seedLocation(t, USER_B, retailerB._id, "B-Main");

		const rowsA = await t.query(api.pickupLocations.listActivePublicBySlug, {
			slug: retailerA.slug,
		});
		const rowsB = await t.query(api.pickupLocations.listActivePublicBySlug, {
			slug: retailerB.slug,
		});
		expect(rowsA.map((r) => r.label)).toEqual(["A-Main"]);
		expect(rowsB.map((r) => r.label)).toEqual(["B-Main"]);
	});

	test("listActivePublicBySlug returns empty for unknown slug", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const rows = await t.query(api.pickupLocations.listActivePublicBySlug, {
			slug: "does-not-exist",
		});
		expect(rows).toEqual([]);
	});
});

describe("pickupLocations — hasAnyActive", () => {
	test("returns false when only inactive rows exist", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const id = await seedLocation(t, USER_A, retailer._id, "Main");
		const asUser = t.withIdentity({ subject: USER_A });
		await asUser.mutation(api.pickupLocations.setActive, {
			pickupLocationId: id,
			isActive: false,
		});
		const out = await asUser.query(api.pickupLocations.hasAnyActive, {
			retailerId: retailer._id,
		});
		expect(out.hasAny).toBe(false);
	});

	test("returns true after at least one active row is added", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await seedLocation(t, USER_A, retailer._id, "Main");
		const asUser = t.withIdentity({ subject: USER_A });
		const out = await asUser.query(api.pickupLocations.hasAnyActive, {
			retailerId: retailer._id,
		});
		expect(out.hasAny).toBe(true);
	});
});

describe("pickupLocations — Google autocomplete fields", () => {
	test("create stores latitude, longitude, and placeId when provided", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });

		const { pickupLocationId } = await asUser.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "Main",
				address: "12 Jln Tun Razak, 50400 KL",
				latitude: 3.158,
				longitude: 101.712,
				placeId: "ChIJ_abc",
			},
		);
		const rows = await asUser.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		const row = rows.find((r) => r._id === pickupLocationId);
		expect(row?.latitude).toBeCloseTo(3.158);
		expect(row?.longitude).toBeCloseTo(101.712);
		expect(row?.placeId).toBe("ChIJ_abc");
	});

	test("create rejects out-of-range coordinates", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });

		await expect(
			asUser.mutation(api.pickupLocations.create, {
				retailerId: retailer._id,
				label: "X",
				address: "Some address",
				latitude: 91,
				longitude: 0,
			}),
		).rejects.toThrow(/latitude must be between/);

		await expect(
			asUser.mutation(api.pickupLocations.create, {
				retailerId: retailer._id,
				label: "X",
				address: "Some address",
				latitude: 0,
				longitude: 181,
			}),
		).rejects.toThrow(/longitude must be between/);
	});

	test("create drops coordinates silently when one is missing (all-or-nothing)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });

		const { pickupLocationId } = await asUser.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "Half-pinned",
				address: "Some address",
				latitude: 3.158,
				// longitude omitted
			},
		);
		const rows = await asUser.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		const row = rows.find((r) => r._id === pickupLocationId);
		expect(row?.latitude).toBeUndefined();
		expect(row?.longitude).toBeUndefined();
	});

	test("update with null lat/lng clears stored coordinates", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });

		const { pickupLocationId } = await asUser.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "Pinned",
				address: "Some address",
				latitude: 3.158,
				longitude: 101.712,
				placeId: "ChIJ_abc",
			},
		);
		await asUser.mutation(api.pickupLocations.update, {
			pickupLocationId,
			latitude: null,
			longitude: null,
			placeId: null,
		});
		const rows = await asUser.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		const row = rows.find((r) => r._id === pickupLocationId);
		expect(row?.latitude).toBeUndefined();
		expect(row?.longitude).toBeUndefined();
		expect(row?.placeId).toBeUndefined();
	});

	test("listActivePublicBySlug surfaces lat/lng for the storefront picker", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		await asUser.mutation(api.pickupLocations.create, {
			retailerId: retailer._id,
			label: "Main",
			address: "12 Jln Tun Razak, 50400 KL",
			latitude: 3.158,
			longitude: 101.712,
		});

		const rows = await t.query(api.pickupLocations.listActivePublicBySlug, {
			slug: retailer.slug,
		});
		expect(rows[0].latitude).toBeCloseTo(3.158);
		expect(rows[0].longitude).toBeCloseTo(101.712);
	});

	test("orders.create freezes coordinates onto the pickup snapshot", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		await asUser.mutation(api.retailers.updateSettings, {
			offerSelfCollect: true,
		});
		const { pickupLocationId } = await asUser.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "Main",
				address: "12 Jln Tun Razak, 50400 KL",
				latitude: 3.158,
				longitude: 101.712,
			},
		);
		const productId = await asUser.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Kuih Tepung",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [{ optionValues: [], price: 1000, onHand: 50 }],
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Ali", waPhone: "60123456789" },
			deliveryMethod: "self_collect",
			pickupLocationId,
		});

		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(order?.pickupSnapshot?.latitude).toBeCloseTo(3.158);
		expect(order?.pickupSnapshot?.longitude).toBeCloseTo(101.712);

		// And the coords survive a subsequent location edit.
		await asUser.mutation(api.pickupLocations.update, {
			pickupLocationId,
			latitude: 10,
			longitude: 20,
		});
		const reread = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(reread?.pickupSnapshot?.latitude).toBeCloseTo(3.158);
	});

	test("orders.create + updatePickupLocation freeze the drop-off kind + schedule note", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		await asUser.mutation(api.retailers.updateSettings, {
			offerSelfCollect: true,
		});
		const { pickupLocationId } = await asUser.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "Pasar Tani",
				address: "Seksyen 7, Shah Alam",
				locationType: "drop_off",
				scheduleNote: "Every Sat 3-5pm",
			},
		);
		const productId = await asUser.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Kuih Tepung",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [{ optionValues: [], price: 1000, onHand: 50 }],
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Ali", waPhone: "60123456789" },
			deliveryMethod: "self_collect",
			pickupLocationId,
		});

		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(order?.pickupSnapshot?.locationType).toBe("drop_off");
		expect(order?.pickupSnapshot?.scheduleNote).toBe("Every Sat 3-5pm");

		// Re-tagging the source location later does NOT rewrite the frozen order.
		await asUser.mutation(api.pickupLocations.update, {
			pickupLocationId,
			locationType: "self_collect",
			scheduleNote: "",
		});
		const reread = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(reread?.pickupSnapshot?.locationType).toBe("drop_off");
		expect(reread?.pickupSnapshot?.scheduleNote).toBe("Every Sat 3-5pm");

		// The buyer's updatePickupLocation path also freezes the kind (second
		// snapshot build site). Add a self-collect point and switch to it.
		const { pickupLocationId: scId } = await asUser.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "My Place",
				address: "Home",
				locationType: "self_collect",
			},
		);
		await t.mutation(api.orders.updatePickupLocation, {
			token: await tk(t, shortId),
			pickupLocationId: scId,
		});
		const afterSwitch = await t.query(api.orders.get, {
			token: await tk(t, shortId),
		});
		expect(afterSwitch?.pickupSnapshot?.locationType).toBe("self_collect");
		expect(afterSwitch?.pickupSnapshot?.scheduleNote).toBeUndefined();
	});
});

describe("pickupLocations — store manager contact", () => {
	test("create stores managerName and managerWaPhone", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });

		const { pickupLocationId } = await asUser.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "Main",
				address: "12 Jln Tun Razak, KL",
				managerName: "  Aishah  ",
				managerWaPhone: "60123456789",
			},
		);
		const rows = await asUser.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		const row = rows.find((r) => r._id === pickupLocationId);
		expect(row?.managerName).toBe("Aishah");
		expect(row?.managerWaPhone).toBe("60123456789");
	});

	test("create rejects an invalid manager phone", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });

		await expect(
			asUser.mutation(api.pickupLocations.create, {
				retailerId: retailer._id,
				label: "Main",
				address: "12 Jln Tun Razak, KL",
				managerWaPhone: "not-a-phone",
			}),
		).rejects.toThrow(/8.{1,3}15/);
	});

	test("update with empty string clears manager fields", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		const { pickupLocationId } = await asUser.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "Main",
				address: "12 Jln Tun Razak, KL",
				managerName: "Aishah",
				managerWaPhone: "60123456789",
			},
		);
		await asUser.mutation(api.pickupLocations.update, {
			pickupLocationId,
			managerName: "",
			managerWaPhone: "",
		});
		const rows = await asUser.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		const row = rows.find((r) => r._id === pickupLocationId);
		expect(row?.managerName).toBeUndefined();
		expect(row?.managerWaPhone).toBeUndefined();
	});

	test("listActivePublicBySlug does NOT expose manager fields to buyers", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		await asUser.mutation(api.pickupLocations.create, {
			retailerId: retailer._id,
			label: "Main",
			address: "12 Jln Tun Razak, KL",
			managerName: "Aishah",
			managerWaPhone: "60123456789",
		});

		const publicRows = await t.query(
			api.pickupLocations.listActivePublicBySlug,
			{ slug: retailer.slug },
		);
		// Even on a JSON re-parse the manager fields must not exist.
		const row = publicRows[0] as Record<string, unknown>;
		expect(row.managerName).toBeUndefined();
		expect(row.managerWaPhone).toBeUndefined();
	});
});

describe("pickupLocations.getOwnedById", () => {
	test("returns the row when called by the owning retailer", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		const { pickupLocationId } = await asUser.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "Main",
				address: "12 Jln Tun Razak, KL",
				managerName: "Aishah",
				managerWaPhone: "60123456789",
			},
		);
		const row = await asUser.query(api.pickupLocations.getOwnedById, {
			pickupLocationId,
		});
		expect(row?._id).toBe(pickupLocationId);
		expect(row?.managerWaPhone).toBe("60123456789");
	});

	test("returns null for a foreign retailer's row", async () => {
		const t = setup();
		const retailerA = await seedRetailer(t, USER_A, "_a");
		await seedRetailer(t, USER_B, "_b");
		const id = await seedLocation(t, USER_A, retailerA._id, "Main");
		const asB = t.withIdentity({ subject: USER_B });

		const row = await asB.query(api.pickupLocations.getOwnedById, {
			pickupLocationId: id,
		});
		expect(row).toBeNull();
	});

	test("returns null when unauthenticated", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const id = await seedLocation(t, USER_A, retailer._id, "Main");

		const row = await t.query(api.pickupLocations.getOwnedById, {
			pickupLocationId: id,
		});
		expect(row).toBeNull();
	});
});

describe("pickupLocations — manager fields are independently optional", () => {
	test("create accepts phone alone (no name) — Notify button gets generic label", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });

		const { pickupLocationId } = await asUser.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "Main",
				address: "12 Jln Tun Razak, KL",
				managerWaPhone: "60123456789",
			},
		);
		const rows = await asUser.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		const row = rows.find((r) => r._id === pickupLocationId);
		expect(row?.managerName).toBeUndefined();
		expect(row?.managerWaPhone).toBe("60123456789");
	});

	test("create accepts name alone (no phone) — no Notify button rendered but the name is stored", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });

		const { pickupLocationId } = await asUser.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "Main",
				address: "12 Jln Tun Razak, KL",
				managerName: "Aishah",
			},
		);
		const rows = await asUser.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		const row = rows.find((r) => r._id === pickupLocationId);
		expect(row?.managerName).toBe("Aishah");
		expect(row?.managerWaPhone).toBeUndefined();
	});

	test("update can clear just one field without touching the other", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		const { pickupLocationId } = await asUser.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "Main",
				address: "12 Jln Tun Razak, KL",
				managerName: "Aishah",
				managerWaPhone: "60123456789",
			},
		);

		await asUser.mutation(api.pickupLocations.update, {
			pickupLocationId,
			managerName: "",
		});
		const rows = await asUser.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		const row = rows.find((r) => r._id === pickupLocationId);
		expect(row?.managerName).toBeUndefined();
		expect(row?.managerWaPhone).toBe("60123456789");
	});
});

describe("orders — delivery placeId", () => {
	test("orders.create stores placeId on the delivery address when supplied", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		const productId = await asUser.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Rendang 1kg",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [{ optionValues: [], price: 10000, onHand: 50 }],
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Ali", waPhone: "60123456789" },
			deliveryAddress: {
				line1: "12 Jln Mawar 3",
				city: "Petaling Jaya",
				state: "Selangor",
				postcode: "47301",
				latitude: 3.1,
				longitude: 101.6,
				placeId: "ChIJ_delivery",
			},
		});
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(order?.deliveryAddress?.placeId).toBe("ChIJ_delivery");
	});
});

describe("pickupLocations — placeId length cap (PR review fix)", () => {
	test("create rejects a placeId longer than the cap", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		const huge = "x".repeat(301);
		await expect(
			asUser.mutation(api.pickupLocations.create, {
				retailerId: retailer._id,
				label: "Main",
				address: "12 Jln Tun Razak, KL",
				placeId: huge,
			}),
		).rejects.toThrow(/Invalid place ID/);
	});

	test("create accepts a placeId at the cap boundary", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		const exact = "x".repeat(300);
		const { pickupLocationId } = await asUser.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "Main",
				address: "12 Jln Tun Razak, KL",
				placeId: exact,
			},
		);
		const rows = await asUser.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		const row = rows.find((r) => r._id === pickupLocationId);
		expect(row?.placeId).toBe(exact);
	});

	test("update rejects a placeId longer than the cap", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		const { pickupLocationId } = await asUser.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "Main",
				address: "12 Jln Tun Razak, KL",
				placeId: "ChIJ_short",
			},
		);
		const huge = "y".repeat(301);
		await expect(
			asUser.mutation(api.pickupLocations.update, {
				pickupLocationId,
				placeId: huge,
			}),
		).rejects.toThrow(/Invalid place ID/);
	});
});

describe("orders — delivery address placeId length cap (PR review fix)", () => {
	test("orders.create rejects an oversized placeId on delivery", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		const productId = await asUser.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Rendang 1kg",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [{ optionValues: [], price: 10000, onHand: 50 }],
		});
		const huge = "z".repeat(301);
		await expect(
			t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer: { name: "Ali", waPhone: "60123456789" },
				deliveryAddress: {
					line1: "12 Jln Mawar 3",
					city: "Petaling Jaya",
					state: "Selangor",
					postcode: "47301",
					placeId: huge,
				},
			}),
		).rejects.toThrow(/Invalid place ID/);
	});
});

describe("pickupLocations — fulfilment invariant on setActive", () => {
	test("deactivating the last active location is rejected when delivery is off", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A, "lastoff");
		const asA = t.withIdentity({ subject: USER_A });
		const locId = await seedLocation(t, USER_A, retailer._id, "Studio");
		// One active location → self-collect works → allowed to turn delivery off.
		await asA.mutation(api.retailers.updateSettings, { offerDelivery: false });
		// Now hiding that last location would strand the storefront → rejected.
		await expect(
			asA.mutation(api.pickupLocations.setActive, {
				pickupLocationId: locId,
				isActive: false,
			}),
		).rejects.toThrow(/no way to receive orders/i);
	});

	test("deactivating the last active location is allowed when delivery is on", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A, "laston");
		const asA = t.withIdentity({ subject: USER_A });
		const locId = await seedLocation(t, USER_A, retailer._id, "Studio");
		// Delivery stays on (default) → fine to hide the only pickup location.
		await asA.mutation(api.pickupLocations.setActive, {
			pickupLocationId: locId,
			isActive: false,
		});
		const rows = await asA.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows.find((r) => r._id === locId)?.isActive).toBe(false);
	});

	test("deactivating a non-last location is allowed even when delivery is off", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A, "nonlast");
		const asA = t.withIdentity({ subject: USER_A });
		const loc1 = await seedLocation(t, USER_A, retailer._id, "Studio");
		await seedLocation(t, USER_A, retailer._id, "Warehouse");
		await asA.mutation(api.retailers.updateSettings, { offerDelivery: false });
		// Two active locations → hiding one still leaves a working method.
		await asA.mutation(api.pickupLocations.setActive, {
			pickupLocationId: loc1,
			isActive: false,
		});
		const rows = await asA.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows.find((r) => r._id === loc1)?.isActive).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Per-location pickup fee (86ey5tywf) — validation + Pro gate + public read.
// ---------------------------------------------------------------------------

/** Re-point the seeded retailer's subscription (signup seeds a Pro trial). */
async function setPlan(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	plan: "starter" | "pro" | "scale",
) {
	await t.run(async (ctx) => {
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		if (!sub) throw new Error("no subscription row");
		await ctx.db.patch(sub._id, {
			plan,
			status: "active",
			updatedAt: Date.now(),
		});
	});
}

describe("pickupLocations — fee", () => {
	test("create persists a valid fee; 0 normalizes to unset (free)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A, "fee1");
		const asA = t.withIdentity({ subject: USER_A });

		const { pickupLocationId: paid } = await asA.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "Paid drop-off",
				address: "Seksyen 7, Shah Alam",
				fee: 500,
			},
		);
		const { pickupLocationId: zero } = await asA.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "Free point",
				address: "Seksyen 8, Shah Alam",
				fee: 0,
			},
		);
		const rows = await asA.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows.find((r) => r._id === paid)?.fee).toBe(500);
		// 0 is stored as "no fee" so every read treats undefined as the one
		// spelling of free.
		expect(rows.find((r) => r._id === zero)?.fee).toBeUndefined();
	});

	test("rejects negative, non-integer and absurd fees", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A, "fee2");
		const asA = t.withIdentity({ subject: USER_A });
		const base = {
			retailerId: retailer._id,
			label: "Point",
			address: "12 Jln Tun Razak, KL",
		};
		await expect(
			asA.mutation(api.pickupLocations.create, { ...base, fee: -100 }),
		).rejects.toThrow(/whole, non-negative/);
		await expect(
			asA.mutation(api.pickupLocations.create, { ...base, fee: 5.5 }),
		).rejects.toThrow(/whole, non-negative/);
		await expect(
			asA.mutation(api.pickupLocations.create, { ...base, fee: 1_000_001 }),
		).rejects.toThrow(/unrealistically large/);
	});

	test("update sets, changes and clears the fee (null and 0 both clear)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A, "fee3");
		const asA = t.withIdentity({ subject: USER_A });
		const locId = await seedLocation(t, USER_A, retailer._id, "Point");

		await asA.mutation(api.pickupLocations.update, {
			pickupLocationId: locId,
			fee: 700,
		});
		let rows = await asA.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows[0].fee).toBe(700);

		// Undefined = untouched by an unrelated edit.
		await asA.mutation(api.pickupLocations.update, {
			pickupLocationId: locId,
			label: "Renamed",
		});
		rows = await asA.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows[0].fee).toBe(700);

		await asA.mutation(api.pickupLocations.update, {
			pickupLocationId: locId,
			fee: null,
		});
		rows = await asA.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows[0].fee).toBeUndefined();

		await asA.mutation(api.pickupLocations.update, {
			pickupLocationId: locId,
			fee: 300,
		});
		await asA.mutation(api.pickupLocations.update, {
			pickupLocationId: locId,
			fee: 0,
		});
		rows = await asA.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows[0].fee).toBeUndefined();
	});

	test("setting a fee is Pro-gated; clearing stays open on Starter", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A, "fee4");
		const asA = t.withIdentity({ subject: USER_A });
		// Fee set while Pro (trial = Pro features).
		const locId = await seedLocation(t, USER_A, retailer._id, "Point");
		await asA.mutation(api.pickupLocations.update, {
			pickupLocationId: locId,
			fee: 500,
		});

		await setPlan(t, retailer._id, "starter");

		// Starter can't set a fee — create or update.
		await expect(
			asA.mutation(api.pickupLocations.create, {
				retailerId: retailer._id,
				label: "New paid point",
				address: "Seksyen 7, Shah Alam",
				fee: 400,
			}),
		).rejects.toThrow(/Pro/);
		await expect(
			asA.mutation(api.pickupLocations.update, {
				pickupLocationId: locId,
				fee: 900,
			}),
		).rejects.toThrow(/Pro/);

		// …but clearing back to free is always allowed (never trap a
		// downgraded seller with a fee they can't remove).
		await asA.mutation(api.pickupLocations.update, {
			pickupLocationId: locId,
			fee: null,
		});
		const rows = await asA.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows.find((r) => r._id === locId)?.fee).toBeUndefined();
	});

	test("listActivePublicBySlug exposes the fee to the storefront picker", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A, "fee5");
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.pickupLocations.create, {
			retailerId: retailer._id,
			label: "Paid point",
			address: "Seksyen 7, Shah Alam",
			fee: 500,
		});
		const rows = await t.query(api.pickupLocations.listActivePublicBySlug, {
			slug: retailer.slug,
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].fee).toBe(500);
	});
});
