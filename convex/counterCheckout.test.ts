/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { SESSION_TTL_MS } from "./counterCheckout";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER_A = "user_seller_a";
const USER_B = "user_seller_b";

async function seedRetailer(t: ReturnType<typeof setup>, userId: string) {
	const asUser = t.withIdentity({ subject: userId });
	const safe = userId.replace(/[^a-z0-9]/g, "");
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Bearcamp",
		slug: `bearcamp-${safe}`,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

/** Insert a customer row directly (faster than driving an order). */
async function seedCustomer(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	waPhone: string,
	name: string,
): Promise<Id<"customers">> {
	const now = Date.now();
	return t.run(async (ctx) =>
		ctx.db.insert("customers", {
			retailerId,
			waPhone,
			name,
			searchText: `${name.toLowerCase()} ${waPhone}`,
			orderCount: 3,
			totalSpent: 15000,
			firstOrderAt: now - 1000,
			lastOrderAt: now,
			createdAt: now,
			updatedAt: now,
		}),
	);
}

async function openSession(t: ReturnType<typeof setup>, userId: string) {
	return t
		.withIdentity({ subject: userId })
		.mutation(api.counterCheckout.createCheckoutSession, {});
}

describe("counterCheckout — create", () => {
	test("seller opens an awaiting session with an unguessable token + TTL", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const { sessionId, token, expiresAt } = await openSession(t, USER_A);

		expect(token).toMatch(/^[A-Za-z0-9]{24}$/);
		expect(expiresAt).toBeGreaterThan(Date.now());
		const row = await t.run((ctx) => ctx.db.get(sessionId));
		expect(row?.status).toBe("awaiting_buyer");
		expect(row?.token).toBe(token);
	});

	test("unauthenticated create is rejected", async () => {
		const t = setup();
		await expect(
			t.mutation(api.counterCheckout.createCheckoutSession, {}),
		).rejects.toThrow(/Not authenticated/);
	});
});

describe("counterCheckout — read + ownership", () => {
	test("owner reads the session; a non-owner is forbidden", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		await seedRetailer(t, USER_B);
		const { sessionId } = await openSession(t, USER_A);

		const own = await t
			.withIdentity({ subject: USER_A })
			.query(api.counterCheckout.getCheckoutSession, { sessionId });
		expect(own?.status).toBe("awaiting_buyer");

		await expect(
			t
				.withIdentity({ subject: USER_B })
				.query(api.counterCheckout.getCheckoutSession, { sessionId }),
		).rejects.toThrow(/Forbidden/);
	});

	test("a session past its TTL reads as expired even before the cron flips it", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const { sessionId } = await openSession(t, USER_A);
		await t.run((ctx) =>
			ctx.db.patch(sessionId, { expiresAt: Date.now() - 1 }),
		);
		const read = await t
			.withIdentity({ subject: USER_A })
			.query(api.counterCheckout.getCheckoutSession, { sessionId });
		expect(read?.status).toBe("expired");
	});
});

describe("counterCheckout — bind (inbound KP-<token>)", () => {
	test("binds a NEW buyer by phone + pushname; dashboard flips live", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const { sessionId, token } = await openSession(t, USER_A);

		const result = await t.mutation(
			internal.counterCheckout.bindCheckoutSession,
			{ token, waPhone: "60123456789", profileName: "Aiman" },
		);
		expect(result).toMatchObject({ result: "bound", storeName: "Bearcamp" });

		const read = await t
			.withIdentity({ subject: USER_A })
			.query(api.counterCheckout.getCheckoutSession, { sessionId });
		expect(read?.status).toBe("buyer_identified");
		expect(read?.isNewCustomer).toBe(true);
		expect(read?.waPhone).toBe("60123456789");
		expect(read?.displayName).toBe("Aiman");
		expect(read?.customer).toBeNull(); // no customer row yet for a new buyer
		void retailer;
	});

	test("binds a RETURNING buyer with their lifetime history", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await seedCustomer(t, retailer._id, "60123456789", "Siti");
		const { sessionId, token } = await openSession(t, USER_A);

		await t.mutation(internal.counterCheckout.bindCheckoutSession, {
			token,
			waPhone: "60123456789",
			profileName: "Siti from WA",
		});

		const read = await t
			.withIdentity({ subject: USER_A })
			.query(api.counterCheckout.getCheckoutSession, { sessionId });
		expect(read?.isNewCustomer).toBe(false);
		expect(read?.displayName).toBe("Siti"); // retailer-edited name wins over pushname
		expect(read?.customer).toMatchObject({ orderCount: 3, totalSpent: 15000 });
	});

	test("single-use: a second scan of the same token is ignored (replay-safe)", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const { token } = await openSession(t, USER_A);

		await t.mutation(internal.counterCheckout.bindCheckoutSession, {
			token,
			waPhone: "60123456789",
		});
		const replay = await t.mutation(
			internal.counterCheckout.bindCheckoutSession,
			{ token, waPhone: "60199999999" }, // different phone tries to hijack
		);
		expect(replay.result).toBe("already_used");
		// Original binding is untouched.
		const row = await t.run((ctx) =>
			ctx.db
				.query("counterCheckoutSessions")
				.withIndex("by_token", (q) => q.eq("token", token))
				.unique(),
		);
		expect(row?.waPhone).toBe("60123456789");
	});

	test("an expired token does not bind", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const { sessionId, token } = await openSession(t, USER_A);
		await t.run((ctx) => ctx.db.patch(sessionId, { expiresAt: Date.now() - 1 }));

		const result = await t.mutation(
			internal.counterCheckout.bindCheckoutSession,
			{ token, waPhone: "60123456789" },
		);
		expect(result.result).toBe("expired");
		const row = await t.run((ctx) => ctx.db.get(sessionId));
		expect(row?.status).toBe("expired");
	});

	test("an unknown token returns not_found", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const result = await t.mutation(
			internal.counterCheckout.bindCheckoutSession,
			{ token: "nope-nope-nope-nope-nope1", waPhone: "60123456789" },
		);
		expect(result.result).toBe("not_found");
	});
});

describe("counterCheckout — cancel + expiry cron", () => {
	test("owner cancels an awaiting session", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const { sessionId } = await openSession(t, USER_A);
		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.counterCheckout.cancelCheckoutSession, { sessionId });
		const row = await t.run((ctx) => ctx.db.get(sessionId));
		expect(row?.status).toBe("cancelled");
	});

	test("expireStaleSessions flips unscanned past-TTL sessions to expired", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const { sessionId } = await openSession(t, USER_A);
		await t.run((ctx) =>
			ctx.db.patch(sessionId, { expiresAt: Date.now() - SESSION_TTL_MS }),
		);

		const res = await t.mutation(
			internal.counterCheckout.expireStaleSessions,
			{},
		);
		expect(res.expired).toBeGreaterThanOrEqual(1);
		const row = await t.run((ctx) => ctx.db.get(sessionId));
		expect(row?.status).toBe("expired");
	});
});
