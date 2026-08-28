/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const SELLER = "user_releases_seller";
const ADMIN = "user_releases_admin";

async function seedRetailer(t: ReturnType<typeof setup>, userId: string) {
	const asUser = t.withIdentity({ subject: userId });
	const safe = userId.replace(/[^a-z0-9]/g, "");
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Test Store",
		slug: `store-${safe}`,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

describe("releases.getSeenVersion", () => {
	test("returns null for a caller with no retailer", async () => {
		const t = setup();
		// A storeless admin (the admin console supports them) has no place to
		// store a seen-version and is not the audience for seller release notes.
		// Distinct from `{ seenVersion: null }` so the client doesn't attempt a
		// stamp on every page load that can never succeed.
		const asNobody = t.withIdentity({ subject: "user_no_store" });
		expect(await asNobody.query(api.releases.getSeenVersion)).toBeNull();
	});

	test("returns null for an unauthenticated caller", async () => {
		const t = setup();
		expect(await t.query(api.releases.getSeenVersion)).toBeNull();
	});

	test("a fresh retailer has no stored version", async () => {
		const t = setup();
		await seedRetailer(t, SELLER);
		const asSeller = t.withIdentity({ subject: SELLER });
		expect(await asSeller.query(api.releases.getSeenVersion)).toEqual({
			seenVersion: null,
		});
	});
});

describe("releases.markSeen", () => {
	test("stores the version and reads it back", async () => {
		const t = setup();
		await seedRetailer(t, SELLER);
		const asSeller = t.withIdentity({ subject: SELLER });

		expect(
			await asSeller.mutation(api.releases.markSeen, {
				version: "2026.08.2",
			}),
		).toEqual({ updated: true });
		expect(await asSeller.query(api.releases.getSeenVersion)).toEqual({
			seenVersion: "2026.08.2",
		});
	});

	test("never moves backwards", async () => {
		const t = setup();
		await seedRetailer(t, SELLER);
		const asSeller = t.withIdentity({ subject: SELLER });
		await asSeller.mutation(api.releases.markSeen, { version: "2026.09.1" });

		// A second tab left open across a deploy would otherwise roll the marker
		// back and re-show notes the seller already dismissed.
		expect(
			await asSeller.mutation(api.releases.markSeen, {
				version: "2026.08.1",
			}),
		).toEqual({ updated: false });
		expect(await asSeller.query(api.releases.getSeenVersion)).toEqual({
			seenVersion: "2026.09.1",
		});
	});

	test("re-marking the same version is a no-op", async () => {
		const t = setup();
		await seedRetailer(t, SELLER);
		const asSeller = t.withIdentity({ subject: SELLER });
		await asSeller.mutation(api.releases.markSeen, { version: "2026.08.1" });
		expect(
			await asSeller.mutation(api.releases.markSeen, {
				version: "2026.08.1",
			}),
		).toEqual({ updated: false });
	});

	test("compares numerically — 2026.08.10 is newer than 2026.08.9", async () => {
		const t = setup();
		await seedRetailer(t, SELLER);
		const asSeller = t.withIdentity({ subject: SELLER });
		await asSeller.mutation(api.releases.markSeen, { version: "2026.08.9" });
		expect(
			await asSeller.mutation(api.releases.markSeen, {
				version: "2026.08.10",
			}),
		).toEqual({ updated: true });
	});

	test("rejects a malformed version", async () => {
		const t = setup();
		await seedRetailer(t, SELLER);
		const asSeller = t.withIdentity({ subject: SELLER });
		// A malformed value sorts below every real version, so storing one would
		// re-show every release on every visit — worse than rejecting it.
		for (const version of ["1.0.0", "dev", "", "2026.13.1", "2026.08.01"]) {
			await expect(
				asSeller.mutation(api.releases.markSeen, { version }),
			).rejects.toThrow();
		}
		expect(await asSeller.query(api.releases.getSeenVersion)).toEqual({
			seenVersion: null,
		});
	});

	test("is a no-op for a caller with no retailer", async () => {
		const t = setup();
		const asNobody = t.withIdentity({ subject: "user_no_store_2" });
		expect(
			await asNobody.mutation(api.releases.markSeen, {
				version: "2026.08.1",
			}),
		).toEqual({ updated: false });
	});

	test("an admin acting on another store stamps their OWN state, never the seller's", async () => {
		const t = setup();
		const seller = await seedRetailer(t, SELLER);
		await seedRetailer(t, ADMIN);
		const asSeller = t.withIdentity({ subject: SELLER });
		const asAdmin = t.withIdentity({ subject: ADMIN });

		await asAdmin.mutation(api.releases.markSeen, { version: "2026.09.1" });

		// The seller's own state is untouched — they have not read anything, so
		// their next visit still shows the notes. Because both sides resolve the
		// retailer from the CALLER's identity, act-as is safe by construction
		// rather than by a guard that could be forgotten.
		expect(await asSeller.query(api.releases.getSeenVersion)).toEqual({
			seenVersion: null,
		});
		expect(await asAdmin.query(api.releases.getSeenVersion)).toEqual({
			seenVersion: "2026.09.1",
		});

		// And nothing was written to the seller's row.
		const row = await t.run(async (ctx) => ctx.db.get(seller._id));
		expect(row?.lastSeenReleaseVersion).toBeUndefined();
	});
});
