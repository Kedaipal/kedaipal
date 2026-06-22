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

		const order = await t.query(api.orders.get, { shortId });
		expect(order?.pickupSnapshot?.latitude).toBeCloseTo(3.158);
		expect(order?.pickupSnapshot?.longitude).toBeCloseTo(101.712);

		// And the coords survive a subsequent location edit.
		await asUser.mutation(api.pickupLocations.update, {
			pickupLocationId,
			latitude: 10,
			longitude: 20,
		});
		const reread = await t.query(api.orders.get, { shortId });
		expect(reread?.pickupSnapshot?.latitude).toBeCloseTo(3.158);
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
		const order = await t.query(api.orders.get, { shortId });
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
