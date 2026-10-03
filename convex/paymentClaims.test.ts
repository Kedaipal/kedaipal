/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { deleteOrderOwnedBlobs } from "./lib/orderBlobs";
import {
	currentClaimIndex,
	MAX_PAYMENT_CLAIMS_PER_ORDER,
	PAYMENT_CLAIM_LIMIT_MESSAGE,
} from "./lib/paymentClaims";
import schema from "./schema";

// Payment-proof history (z8r3fdn2uj): every "I've paid" submission is kept so
// the seller can reopen a screenshot after the payment is marked received.

const modules = import.meta.glob("./**/*.ts");
const OWNER = "user_owner";
const STRANGER = "user_stranger";

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

async function seedOrder(t: ReturnType<typeof setup>) {
	const asOwner = t.withIdentity({ subject: OWNER });
	await asOwner.mutation(api.retailers.createRetailer, {
		storeName: "Proof Store",
		slug: "proof-store",
	});
	const retailer = await asOwner.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	const productId = await asOwner.mutation(api.products.create, {
		retailerId: retailer._id,
		name: "Kek lapis",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: false,
		requiresProof: false,
		variants: [{ optionValues: [], price: 5000, onHand: 10 }],
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
		},
	});
	const order = await t.run(async (ctx) =>
		ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first(),
	);
	if (!order?.trackingToken) throw new Error("order seed failed");
	return { asOwner, orderId: order._id, token: order.trackingToken };
}

function storeImage(t: ReturnType<typeof setup>, body: string) {
	return t.run((ctx) =>
		ctx.storage.store(new Blob([body], { type: "image/png" })),
	);
}

function claimRows(t: ReturnType<typeof setup>, orderId: Id<"orders">) {
	return t.run((ctx) =>
		ctx.db
			.query("paymentClaims")
			.withIndex("by_order_createdAt", (q) => q.eq("orderId", orderId))
			.collect(),
	);
}

describe("currentClaimIndex", () => {
	test("leads with the newest submission that carries a screenshot", () => {
		expect(
			currentClaimIndex([
				{ proofStorageId: "a", createdAt: 1 },
				{ proofStorageId: "b", createdAt: 2 },
				{ reference: "ref only", createdAt: 3 },
			]),
		).toBe(1);
	});

	test("falls back to the newest submission when none has a screenshot", () => {
		expect(
			currentClaimIndex([
				{ reference: "one", createdAt: 1 },
				{ reference: "two", createdAt: 2 },
			]),
		).toBe(1);
	});

	test("is -1 for no submissions", () => {
		expect(currentClaimIndex([])).toBe(-1);
	});
});

describe("claimPayment keeps every submission", () => {
	test("a resubmit adds a row instead of losing the first screenshot", async () => {
		const t = setup();
		const { asOwner, orderId, token } = await seedOrder(t);
		const first = await storeImage(t, "first");
		const second = await storeImage(t, "second");

		await t.mutation(api.orders.claimPayment, {
			token,
			reference: "MBB-1",
			proofStorageId: first,
		});
		await t.mutation(api.orders.claimPayment, {
			token,
			reference: "MBB-2",
			proofStorageId: second,
		});

		expect(await claimRows(t, orderId)).toHaveLength(2);
		const proofs = await asOwner.query(api.orders.listPaymentProofs, {
			orderId,
		});
		// Newest first; the newest screenshot leads.
		expect(proofs.map((p) => p.reference)).toEqual(["MBB-2", "MBB-1"]);
		expect(proofs.map((p) => p.isCurrent)).toEqual([true, false]);
		expect(proofs.every((p) => p.hasProof && p.url !== null)).toBe(true);
		// The order still carries the latest values for email + WhatsApp.
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.paymentReference).toBe("MBB-2");
		expect(order?.paymentProofStorageId).toBe(second);
	});

	test("a reference-only resubmit doesn't push the screenshot out of the lead", async () => {
		const t = setup();
		const { asOwner, orderId, token } = await seedOrder(t);
		const shot = await storeImage(t, "shot");

		await t.mutation(api.orders.claimPayment, {
			token,
			reference: "TNG-1",
			proofStorageId: shot,
		});
		await t.mutation(api.orders.claimPayment, { token, reference: "TNG-1b" });

		const proofs = await asOwner.query(api.orders.listPaymentProofs, {
			orderId,
		});
		expect(proofs).toHaveLength(2);
		expect(proofs[0]).toMatchObject({
			reference: "TNG-1b",
			hasProof: false,
			url: null,
			isCurrent: false,
		});
		expect(proofs[1]).toMatchObject({
			reference: "TNG-1",
			hasProof: true,
			isCurrent: true,
		});
	});

	test("the payment stays visible after it's marked received", async () => {
		const t = setup();
		const { asOwner, orderId, token } = await seedOrder(t);
		const shot = await storeImage(t, "shot");
		await t.mutation(api.orders.claimPayment, {
			token,
			proofStorageId: shot,
		});
		await t.run((ctx) =>
			ctx.db.patch(orderId, {
				paymentStatus: "received",
				paymentReceivedAt: Date.now(),
			}),
		);

		const proofs = await asOwner.query(api.orders.listPaymentProofs, {
			orderId,
		});
		expect(proofs).toHaveLength(1);
		expect(proofs[0].url).not.toBeNull();
	});

	test("refuses past the per-order cap, with a message that points at WhatsApp", async () => {
		const t = setup();
		const { orderId, token } = await seedOrder(t);
		await t.run(async (ctx) => {
			for (let i = 0; i < MAX_PAYMENT_CLAIMS_PER_ORDER; i++) {
				await ctx.db.insert("paymentClaims", {
					orderId,
					reference: `r${i}`,
					createdAt: i,
				});
			}
		});

		await expect(
			t.mutation(api.orders.claimPayment, { token, reference: "one more" }),
		).rejects.toThrow(PAYMENT_CLAIM_LIMIT_MESSAGE);
		// Refused before the order was touched.
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.paymentStatus).not.toBe("claimed");
		expect(order?.paymentReference).toBeUndefined();
	});
});

describe("orders claimed before the history existed", () => {
	async function makeLegacy(
		t: ReturnType<typeof setup>,
		orderId: Id<"orders">,
		fields: { reference?: string; gatewayPaymentId?: string },
	) {
		const shot = await storeImage(t, "legacy");
		await t.run((ctx) =>
			ctx.db.patch(orderId, {
				paymentStatus: "claimed",
				paymentClaimedAt: 1_000,
				paymentProofStorageId: shot,
				paymentReference: fields.reference,
				gatewayPaymentId: fields.gatewayPaymentId,
			}),
		);
		return shot;
	}

	test("shows the order's own screenshot with no history rows", async () => {
		const t = setup();
		const { asOwner, orderId } = await seedOrder(t);
		await makeLegacy(t, orderId, { reference: "OLD-REF" });

		const proofs = await asOwner.query(api.orders.listPaymentProofs, {
			orderId,
		});
		expect(proofs).toHaveLength(1);
		expect(proofs[0]).toMatchObject({
			reference: "OLD-REF",
			hasProof: true,
			submittedAt: 1_000,
			isCurrent: true,
		});
		expect(proofs[0].url).not.toBeNull();
	});

	test("a HitPay payment id isn't presented as the buyer's reference", async () => {
		const t = setup();
		const { asOwner, orderId } = await seedOrder(t);
		await makeLegacy(t, orderId, {
			reference: "hp_123",
			gatewayPaymentId: "hp_123",
		});

		const proofs = await asOwner.query(api.orders.listPaymentProofs, {
			orderId,
		});
		expect(proofs[0].reference).toBeNull();
	});

	test("a resubmit writes the legacy submission first, so it isn't lost", async () => {
		const t = setup();
		const { asOwner, orderId, token } = await seedOrder(t);
		const legacyShot = await makeLegacy(t, orderId, { reference: "OLD-REF" });
		const newShot = await storeImage(t, "new");

		await t.mutation(api.orders.claimPayment, {
			token,
			reference: "NEW-REF",
			proofStorageId: newShot,
		});

		const rows = await claimRows(t, orderId);
		expect(rows.map((r) => r.proofStorageId)).toEqual([legacyShot, newShot]);
		const proofs = await asOwner.query(api.orders.listPaymentProofs, {
			orderId,
		});
		expect(proofs.map((p) => p.reference)).toEqual(["NEW-REF", "OLD-REF"]);
	});

	test("an order nobody claimed has no submissions", async () => {
		const t = setup();
		const { asOwner, orderId } = await seedOrder(t);
		expect(
			await asOwner.query(api.orders.listPaymentProofs, { orderId }),
		).toEqual([]);
	});
});

describe("listPaymentProofs access and missing files", () => {
	test("another store's user is refused", async () => {
		const t = setup();
		const { orderId } = await seedOrder(t);
		await t
			.withIdentity({ subject: STRANGER })
			.mutation(api.retailers.createRetailer, {
				storeName: "Other",
				slug: "other-store",
			});
		await expect(
			t
				.withIdentity({ subject: STRANGER })
				.query(api.orders.listPaymentProofs, { orderId }),
		).rejects.toThrow();
	});

	test("a signed-out caller is refused", async () => {
		const t = setup();
		const { orderId } = await seedOrder(t);
		await expect(
			t.query(api.orders.listPaymentProofs, { orderId }),
		).rejects.toThrow();
	});

	test("a deleted screenshot comes back as a proof with no URL", async () => {
		const t = setup();
		const { asOwner, orderId, token } = await seedOrder(t);
		const shot = await storeImage(t, "gone");
		await t.mutation(api.orders.claimPayment, { token, proofStorageId: shot });
		await t.run((ctx) => ctx.storage.delete(shot));

		const proofs = await asOwner.query(api.orders.listPaymentProofs, {
			orderId,
		});
		expect(proofs[0]).toMatchObject({ hasProof: true, url: null });
	});
});

describe("deleting an order frees its whole proof history", () => {
	test("every screenshot and every claim row goes", async () => {
		const t = setup();
		const { orderId, token } = await seedOrder(t);
		const first = await storeImage(t, "first");
		const second = await storeImage(t, "second");
		await t.mutation(api.orders.claimPayment, { token, proofStorageId: first });
		await t.mutation(api.orders.claimPayment, { token, proofStorageId: second });

		await t.run(async (ctx) => {
			const order = await ctx.db.get(orderId);
			if (!order) throw new Error("missing order");
			await deleteOrderOwnedBlobs(ctx, order);
		});

		expect(await claimRows(t, orderId)).toHaveLength(0);
		const urls = await t.run(async (ctx) => [
			await ctx.storage.getUrl(first),
			await ctx.storage.getUrl(second),
		]);
		// The overwritten first screenshot used to leak; both are freed now.
		expect(urls).toEqual([null, null]);
	});
});

describe("migrations:backfillPaymentClaims", () => {
	test("writes one row per legacy claim, skips the rest, and is safe to re-run", async () => {
		const t = setup();
		const { orderId } = await seedOrder(t);
		const shot = await storeImage(t, "legacy");
		await t.run((ctx) =>
			ctx.db.patch(orderId, {
				paymentStatus: "claimed",
				paymentClaimedAt: 5_000,
				paymentProofStorageId: shot,
				paymentReference: "OLD",
			}),
		);

		const first = await t.mutation(internal.migrations.backfillPaymentClaims, {});
		const second = await t.mutation(
			internal.migrations.backfillPaymentClaims,
			{},
		);

		expect(first.inserted).toBe(1);
		expect(second.inserted).toBe(0);
		const rows = await claimRows(t, orderId);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			reference: "OLD",
			proofStorageId: shot,
			createdAt: 5_000,
		});
	});

	test("an unclaimed order gets no row", async () => {
		const t = setup();
		const { orderId } = await seedOrder(t);
		const result = await t.mutation(
			internal.migrations.backfillPaymentClaims,
			{},
		);
		expect(result.inserted).toBe(0);
		expect(await claimRows(t, orderId)).toHaveLength(0);
	});
});
