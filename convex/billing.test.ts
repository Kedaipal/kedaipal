/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const ADMIN = "user_admin";
const USER = "user_plain";
let prev: string | undefined;
beforeAll(() => {
	prev = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
});
afterAll(() => {
	process.env.ADMIN_USER_IDS = prev;
});

async function seedRetailer(t: ReturnType<typeof setup>, userId: string) {
	const asUser = t.withIdentity({ subject: userId });
	const slug = `s-${userId.replace(/[^a-z0-9]/g, "")}`;
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Store",
		slug,
	});
	return asUser;
}

describe("billing config", () => {
	test("amIAdmin reflects the env allowlist", async () => {
		const t = setup();
		expect(
			await t.withIdentity({ subject: ADMIN }).query(api.billing.amIAdmin, {}),
		).toBe(true);
		expect(
			await t.withIdentity({ subject: USER }).query(api.billing.amIAdmin, {}),
		).toBe(false);
	});

	test("updateBillingConfig is admin-only and surfaces on paymentInstructions", async () => {
		const t = setup();
		const asUser = await seedRetailer(t, USER);

		// Non-admin can't edit.
		await expect(
			asUser.mutation(api.billing.updateBillingConfig, { bankName: "Hax" }),
		).rejects.toThrow(/not authorized/i);

		// Admin sets details.
		await t.withIdentity({ subject: ADMIN }).mutation(
			api.billing.updateBillingConfig,
			{
				bankName: "Maybank",
				bankAccountNumber: "5123",
				duitnowId: "60123",
			},
		);

		// Retailer sees them on their billing page.
		const instructions = await asUser.query(api.billing.paymentInstructions, {});
		expect(instructions?.bankName).toBe("Maybank");
		expect(instructions?.bankAccountNumber).toBe("5123");
		expect(instructions?.duitnowId).toBe("60123");

		// Singleton: a second update patches the same row (no duplicate).
		await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.billing.updateBillingConfig, { bankName: "CIMB" });
		const count = await t.run((ctx) =>
			ctx.db
				.query("billingConfig")
				.collect()
				.then((r) => r.length),
		);
		expect(count).toBe(1);
		expect((await asUser.query(api.billing.paymentInstructions, {}))?.bankName).toBe(
			"CIMB",
		);
	});

	test("paymentInstructions returns null when unauthenticated", async () => {
		const t = setup();
		expect(await t.query(api.billing.paymentInstructions, {})).toBeNull();
	});
});
