/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { fulfilmentDateBounds } from "./lib/fulfilmentDate";
import {
	CLAIM_MAX_SENDS,
	CLAIM_PAYMENT_RUNWAY_MS,
	CLAIM_RESEND_COOLDOWN_MS,
	CLAIM_RETENTION_MS,
} from "./lib/orderClaims";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER_A = "user_seller_a";
const USER_B = "user_seller_b";
const BUYER_PHONE = "60123456789";

const MY_ADDRESS = {
	line1: "12 Jalan Ampang",
	city: "Kuala Lumpur",
	state: "Selangor",
	postcode: "40450",
};

async function seedRetailer(t: ReturnType<typeof setup>, userId: string) {
	const asUser = t.withIdentity({ subject: userId });
	const safe = userId.replace(/[^a-z0-9]/g, "");
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "K Frozen Food",
		slug: `kfrozen-${safe}`,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

async function seedVariant(
	t: ReturnType<typeof setup>,
	userId: string,
	retailerId: Id<"retailers">,
	opts: {
		name?: string;
		price?: number;
		onHand?: number;
		block?: boolean;
		requiresProof?: boolean;
		minNoticeDays?: number;
		prepMinutes?: number;
		pickupNote?: string;
	} = {},
): Promise<Id<"productVariants">> {
	const asUser = t.withIdentity({ subject: userId });
	const productId = await asUser.mutation(api.products.create, {
		retailerId,
		name: opts.name ?? "Ribeye MS5",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: opts.block ?? false,
		requiresProof: opts.requiresProof ?? false,
		minNoticeDays: opts.minNoticeDays,
		prepMinutes: opts.prepMinutes,
		pickupNote: opts.pickupNote,
		variants: [
			{ optionValues: [], price: opts.price ?? 8900, onHand: opts.onHand ?? 50 },
		],
	});
	const variant = await t.run((ctx) =>
		ctx.db
			.query("productVariants")
			.withIndex("by_product", (q) => q.eq("productId", productId))
			.first(),
	);
	if (!variant) throw new Error("variant seed failed");
	return variant._id;
}

/** Bind a walk-in session by manual phone — the claim-link entry point. */
async function seedSession(
	t: ReturnType<typeof setup>,
	userId: string,
	opts: { waPhone?: string; name?: string } = {},
): Promise<Id<"counterCheckoutSessions">> {
	const asUser = t.withIdentity({ subject: userId });
	const { sessionId } = await asUser.mutation(
		api.counterCheckout.bindSessionManualPhone,
		{
			waPhone: opts.waPhone ?? BUYER_PHONE,
			name: opts.name ?? "Aina Hamzah",
		},
	);
	return sessionId;
}

async function getClaim(t: ReturnType<typeof setup>, claimId: Id<"orderClaims">) {
	const claim = await t.run((ctx) => ctx.db.get(claimId));
	if (!claim) throw new Error("claim vanished");
	return claim;
}

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("orderClaims — sendClaim", () => {
	test("freezes seller-keyed lines (incl. overrides) and opens a claim", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, {
			price: 12000,
		});
		const sessionId = await seedSession(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });

		const before = Date.now();
		const { claimId, token, expiresAt } = await asA.mutation(
			api.orderClaims.sendClaim,
			{
				sessionId,
				// Seller adjusted the price down (86eyphh8r) — the claim must freeze
				// the adjusted figure, not the catalog's.
				items: [{ variantId, quantity: 2, unitPrice: 8900 }],
				windowMinutes: 15,
			},
		);
		const claim = await getClaim(t, claimId);
		expect(claim.status).toBe("open");
		expect(claim.waPhone).toBe(BUYER_PHONE);
		expect(claim.buyerName).toBe("Aina Hamzah");
		expect(claim.lines).toHaveLength(1);
		expect(claim.lines[0].price).toBe(8900);
		expect(claim.lines[0].quantity).toBe(2);
		expect(claim.token).toBe(token);
		expect(claim.sentCount).toBe(1);
		expect(expiresAt).toBeGreaterThanOrEqual(before + 15 * 60 * 1000);
		// The chosen window becomes the store default (the dialog says so).
		const updated = await asA.query(api.retailers.getMyRetailer);
		expect(updated?.claimLinkWindowMinutes).toBe(15);
	});

	test("stock is NOT decremented at send (a claim is an offer)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, {
			block: true,
			onHand: 5,
		});
		const sessionId = await seedSession(t, USER_A);
		await t.withIdentity({ subject: USER_A }).mutation(
			api.orderClaims.sendClaim,
			{
				sessionId,
				items: [{ variantId, quantity: 3 }],
				windowMinutes: 60,
			},
		);
		const variant = await t.run((ctx) => ctx.db.get(variantId));
		expect(variant?.onHand).toBe(5);
	});

	test("refuses an anonymous session — nobody to send the link to", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const { sessionId } = await asA.mutation(
			api.counterCheckout.startAnonymousSession,
			{},
		);
		const retailer = await asA.query(api.retailers.getMyRetailer);
		const variantId = await seedVariant(t, USER_A, retailer!._id);
		await expect(
			asA.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				windowMinutes: 15,
			}),
		).rejects.toThrow(/WhatsApp number/);
	});

	test("hard-block stock shortfall refuses at send — never a dead link", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, {
			block: true,
			onHand: 1,
		});
		const sessionId = await seedSession(t, USER_A);
		await expect(
			t.withIdentity({ subject: USER_A }).mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 2 }],
				windowMinutes: 15,
			}),
		).rejects.toThrow(/in stock/);
	});

	test("a second send supersedes the first open claim (old link dies)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await seedSession(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const first = await asA.mutation(api.orderClaims.sendClaim, {
			sessionId,
			items: [{ variantId, quantity: 1 }],
			windowMinutes: 15,
		});
		const second = await asA.mutation(api.orderClaims.sendClaim, {
			sessionId,
			items: [{ variantId, quantity: 2 }],
			windowMinutes: 15,
		});
		expect((await getClaim(t, first.claimId)).status).toBe("cancelled");
		expect((await getClaim(t, second.claimId)).status).toBe("open");
	});

	test("a foreign seller can't send from someone else's session", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await seedRetailer(t, USER_B);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await seedSession(t, USER_A);
		await expect(
			t.withIdentity({ subject: USER_B }).mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				windowMinutes: 15,
			}),
		).rejects.toThrow(/Forbidden/);
	});

	test("an out-of-bounds window is refused", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await seedSession(t, USER_A);
		await expect(
			t.withIdentity({ subject: USER_A }).mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				windowMinutes: 1,
			}),
		).rejects.toThrow(/at least/);
	});
});

describe("orderClaims — attribution (86eyq0eq9 × 86eyq0epn)", () => {
	test("the tagged origin is frozen on the claim, remembered, and carried onto the order", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await seedSession(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const { claimId, token } = await asA.mutation(api.orderClaims.sendClaim, {
			sessionId,
			items: [{ variantId, quantity: 1 }],
			windowMinutes: 15,
			attributionSource: "tiktok-live",
		});
		expect((await getClaim(t, claimId)).attributionSource).toBe("tiktok-live");
		// Remembered as the store default so the next 50 claims need no tap.
		expect((await asA.query(api.retailers.getMyRetailer))?.claimLinkSource).toBe(
			"tiktok-live",
		);

		await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: MY_ADDRESS,
		});
		const order = await t.run(async (ctx) => {
			const claim = await ctx.db.get(claimId);
			return claim?.orderId ? await ctx.db.get(claim.orderId) : null;
		});
		// The whole point: Insights counts this revenue against the live, not
		// against "direct".
		expect(order?.attributionSource).toBe("tiktok-live");
	});

	test("an untagged claim stays untagged — the pre-attribution behaviour", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await seedSession(t, USER_A);
		const { claimId, token } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				windowMinutes: 15,
			});
		expect((await getClaim(t, claimId)).attributionSource).toBeUndefined();
		await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: MY_ADDRESS,
		});
		const order = await t.run(async (ctx) => {
			const claim = await ctx.db.get(claimId);
			return claim?.orderId ? await ctx.db.get(claim.orderId) : null;
		});
		expect(order?.attributionSource).toBeUndefined();
	});

	test("a junk tag is sanitized, never thrown — a bad tag must not block a send", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await seedSession(t, USER_A);
		const { claimId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				windowMinutes: 15,
				attributionSource: "  TikTok Live!!  ",
			});
		expect((await getClaim(t, claimId)).attributionSource).toBe("tiktok-live");
	});
});

describe("orderClaims — resend + cancel", () => {
	async function openClaim(t: ReturnType<typeof setup>) {
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await seedSession(t, USER_A);
		const { claimId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				windowMinutes: 24 * 60,
			});
		return { claimId, sessionId, retailerId: retailer._id, variantId };
	}

	test("resend is cooled down, then re-sends WITHOUT moving the deadline", async () => {
		const t = setup();
		const { claimId } = await openClaim(t);
		const asA = t.withIdentity({ subject: USER_A });
		await expect(
			asA.mutation(api.orderClaims.resendClaim, { claimId }),
		).rejects.toThrow(/moment/);
		const before = await getClaim(t, claimId);
		// Age the last send past the cooldown — the deadline must not move.
		await t.run((ctx) =>
			ctx.db.patch(claimId, {
				lastSentAt: before.lastSentAt - CLAIM_RESEND_COOLDOWN_MS - 1000,
			}),
		);
		await asA.mutation(api.orderClaims.resendClaim, { claimId });
		const after = await getClaim(t, claimId);
		expect(after.sentCount).toBe(2);
		expect(after.expiresAt).toBe(before.expiresAt);
	});

	test("the hard send cap refuses even after the cooldown", async () => {
		const t = setup();
		const { claimId } = await openClaim(t);
		await t.run((ctx) =>
			ctx.db.patch(claimId, {
				sentCount: CLAIM_MAX_SENDS,
				lastSentAt: Date.now() - CLAIM_RESEND_COOLDOWN_MS * 2,
			}),
		);
		await expect(
			t
				.withIdentity({ subject: USER_A })
				.mutation(api.orderClaims.resendClaim, { claimId }),
		).rejects.toThrow(/maximum/);
	});

	test("cancel releases an open claim; the buyer page reads cancelled", async () => {
		const t = setup();
		const { claimId } = await openClaim(t);
		const token = (await getClaim(t, claimId)).token;
		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.cancelClaim, { claimId });
		expect((await getClaim(t, claimId)).status).toBe("cancelled");
		const payload = await t.query(api.orderClaims.getByToken, { token });
		expect(payload?.status).toBe("cancelled");
		expect(payload?.open).toBeUndefined();
	});

	// Dismissing the whole checkout is a deliberate destructive act, so killing
	// the offer with it is the right cascade — unlike ringing the same cart up
	// at the counter, which now refuses outright (see "the checkout is frozen
	// while its link is out"): that read as an ordinary sale but silently took
	// the buyer's link away mid-form.
	test("dismissing the checkout kills its open claim", async () => {
		const t = setup();
		const { claimId, sessionId } = await openClaim(t);
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.counterCheckout.cancelCheckoutSession, {
			sessionId,
		});
		expect((await getClaim(t, claimId)).status).toBe("cancelled");
	});
});

describe("orderClaims — getByToken", () => {
	test("unknown token answers null (route 404s)", async () => {
		const t = setup();
		expect(
			await t.query(api.orderClaims.getByToken, { token: "nope" }),
		).toBeNull();
	});

	test("open payload carries frozen lines + the raised notice floor", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, {
			minNoticeDays: 3,
			price: 5000,
		});
		const sessionId = await seedSession(t, USER_A);
		const { token } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 2 }],
				windowMinutes: 60,
			});
		const payload = await t.query(api.orderClaims.getByToken, { token });
		expect(payload?.status).toBe("open");
		expect(payload?.open?.itemsTotal).toBe(10000);
		expect(payload?.open?.waPhone).toBe(BUYER_PHONE);
		// Store notice 0 raised to the product's 3-day override.
		expect(payload?.store.minNoticeDays).toBe(3);
	});

	test("an open claim past its deadline reads expired before the cron flips it", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await seedSession(t, USER_A);
		const { claimId, token } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				windowMinutes: 15,
			});
		await t.run((ctx) =>
			ctx.db.patch(claimId, { expiresAt: Date.now() - 1000 }),
		);
		const payload = await t.query(api.orderClaims.getByToken, { token });
		expect(payload?.status).toBe("expired");
		expect(payload?.open).toBeUndefined();
	});
});

describe("orderClaims — commit", () => {
	async function sendOne(
		t: ReturnType<typeof setup>,
		opts: Parameters<typeof seedVariant>[3] = {},
	) {
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, opts);
		const sessionId = await seedSession(t, USER_A);
		const { claimId, token } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 2, unitPrice: 8900 }],
				windowMinutes: 60,
			});
		return { retailer, variantId, sessionId, claimId, token };
	}

	test("commits the order at the LOCKED price even after a catalog re-price", async () => {
		const t = setup();
		const { variantId, sessionId, claimId, token } = await sendOne(t, {
			block: true,
			onHand: 10,
			price: 12000,
		});
		// Seller re-prices the catalog between send and open — the claim's frozen
		// 8900 must still be charged (the whole point of "price locked").
		await t.run((ctx) => ctx.db.patch(variantId, { price: 99900 }));

		const result = await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: MY_ADDRESS,
		});
		expect(result.shortId).toMatch(/^ORD-/);

		const order = await t.run(async (ctx) => {
			const claim = await ctx.db.get(claimId);
			return claim?.orderId ? await ctx.db.get(claim.orderId) : null;
		});
		expect(order).not.toBeNull();
		expect(order?.source).toBe("claim");
		expect(order?.items[0].price).toBe(8900);
		expect(order?.subtotal).toBe(17800);
		expect(order?.customer.waPhone).toBe(BUYER_PHONE);
		// No template env in tests → the legacy pending path (same as storefront).
		expect(order?.status).toBe("pending");
		// Stock decremented at COMMIT.
		const variant = await t.run((ctx) => ctx.db.get(variantId));
		expect(variant?.onHand).toBe(8);
		// Claim + session both settled.
		expect((await getClaim(t, claimId)).status).toBe("completed");
		const session = await t.run((ctx) => ctx.db.get(sessionId));
		expect(session?.status).toBe("completed");
		// Customer aggregates linked.
		const customer = await t.run((ctx) =>
			ctx.db
				.query("customers")
				.withIndex("by_retailer_phone", (q) =>
					q
						.eq("retailerId", order!.retailerId)
						.eq("waPhone", BUYER_PHONE),
				)
				.unique(),
		);
		expect(customer?.orderCount).toBe(1);
	});

	test("a claim order freezes stockReserved — the THIRD create path (86eypn8ye)", async () => {
		// Every create path builds its own item snapshot, so a frozen field has to
		// be stamped in each one. Storefront and counter were done in 86eypn8ye;
		// claim links landed afterwards and reproduced the gap. Unstamped, cancel
		// re-resolves `blockWhenOutOfStock` from the CURRENT docs, so flipping a
		// product to made-to-order after the sale strands its units forever.
		const t = setup();
		const { variantId, claimId, token } = await sendOne(t, {
			block: true,
			onHand: 10,
		});

		await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: MY_ADDRESS,
		});

		const orderId = (await getClaim(t, claimId)).orderId as Id<"orders">;
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.items[0].stockReserved).toBe(true);
		expect((await t.run((ctx) => ctx.db.get(variantId)))?.onHand).toBe(8);

		// The seller switches the product to made-to-order AFTER the sale. The
		// frozen flag is what makes the cancel give the units back anyway.
		await t.run((ctx) =>
			ctx.db.patch(variantId, { blockWhenOutOfStock: false }),
		);
		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orders.updateStatus, { orderId, status: "cancelled" });
		expect((await t.run((ctx) => ctx.db.get(variantId)))?.onHand).toBe(10);
	});

	test("confirm-push env set → the order commits confirmed with the push stamped", async () => {
		vi.stubEnv("WHATSAPP_ORDER_CONFIRM_TEMPLATE", "order_confirmation_utility");
		const t = setup();
		const { claimId, token } = await sendOne(t);
		await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: MY_ADDRESS,
		});
		const order = await t.run(async (ctx) => {
			const claim = await ctx.db.get(claimId);
			return claim?.orderId ? await ctx.db.get(claim.orderId) : null;
		});
		expect(order?.status).toBe("confirmed");
		expect(order?.confirmationPushStatus).toBe("sending");
	});

	test("a second commit is idempotent — same order handed back", async () => {
		const t = setup();
		const { token } = await sendOne(t);
		const first = await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: MY_ADDRESS,
		});
		const second = await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: MY_ADDRESS,
		});
		expect(second.shortId).toBe(first.shortId);
	});

	test("expired and cancelled claims refuse to commit", async () => {
		const t = setup();
		const { claimId, token } = await sendOne(t);
		await t.run((ctx) =>
			ctx.db.patch(claimId, { expiresAt: Date.now() - 1000 }),
		);
		await expect(
			t.mutation(api.orderClaims.commit, {
				token,
				deliveryMethod: "delivery",
				deliveryAddress: MY_ADDRESS,
			}),
		).rejects.toThrow(/expired/);

		const t2 = setup();
		const second = await sendOne(t2);
		await t2
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.cancelClaim, { claimId: second.claimId });
		await expect(
			t2.mutation(api.orderClaims.commit, {
				token: second.token,
				deliveryMethod: "delivery",
				deliveryAddress: MY_ADDRESS,
			}),
		).rejects.toThrow(/no longer active/);
	});

	test("sold-out-at-commit names the line and refuses (no silent drop)", async () => {
		const t = setup();
		const { variantId, token } = await sendOne(t, {
			block: true,
			onHand: 10,
		});
		await t.run((ctx) => ctx.db.patch(variantId, { onHand: 1 }));
		await expect(
			t.mutation(api.orderClaims.commit, {
				token,
				deliveryMethod: "delivery",
				deliveryAddress: MY_ADDRESS,
			}),
		).rejects.toThrow(/sold out/);
	});

	test("min-order rules do NOT apply (seller keyed the cart)", async () => {
		const t = setup();
		const { retailer, token } = await sendOne(t);
		// A floor far above the claim total — a storefront cart would bounce.
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, { minOrderValue: 1_000_000 });
		});
		const result = await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: MY_ADDRESS,
		});
		expect(result.shortId).toMatch(/^ORD-/);
	});

	test("no mockup gate on a requiresProof line (agreed in the live)", async () => {
		const t = setup();
		const { claimId, token } = await sendOne(t, { requiresProof: true });
		await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: MY_ADDRESS,
		});
		const order = await t.run(async (ctx) => {
			const claim = await ctx.db.get(claimId);
			return claim?.orderId ? await ctx.db.get(claim.orderId) : null;
		});
		expect(order?.mockupStatus).toBeUndefined();
	});

	test("the notice floor (store ∨ product) rejects a too-soon date", async () => {
		const t = setup();
		const { token } = await sendOne(t, { minNoticeDays: 3 });
		// Today is inside the 3-day product notice → refused.
		const today = fulfilmentDateBounds(0).min;
		await expect(
			t.mutation(api.orderClaims.commit, {
				token,
				deliveryMethod: "delivery",
				deliveryAddress: MY_ADDRESS,
				fulfilmentDate: today,
			}),
		).rejects.toThrow();
	});

	test("delivery needs an address; self_collect refuses one", async () => {
		const t = setup();
		const { token } = await sendOne(t);
		await expect(
			t.mutation(api.orderClaims.commit, {
				token,
				deliveryMethod: "delivery",
			}),
		).rejects.toThrow(/address/i);
	});
});

describe("orderClaims — prep time + pickup note (z8r3fdff97)", () => {
	const DAY = 86_400_000;
	/** Minutes since MYT midnight, right now. */
	const nowMinutes = () =>
		Math.floor(((Date.now() + 8 * 3600_000) % DAY) / 60_000);

	async function sendPuffs(
		t: ReturnType<typeof setup>,
		opts: { prepMinutes?: number; pickupNote?: string } = {},
	) {
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, {
			name: "Ice Cream Puff",
			...opts,
		});
		const sessionId = await seedSession(t, USER_A);
		const { claimId, token } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 6 }],
				windowMinutes: 60,
			});
		const productId = (await t.run((ctx) => ctx.db.get(variantId)))
			?.productId as Id<"products">;
		return { retailer, variantId, productId, claimId, token };
	}
	const orderOf = async (
		t: ReturnType<typeof setup>,
		claimId: Id<"orderClaims">,
	) => {
		const orderId = (await getClaim(t, claimId)).orderId as Id<"orders">;
		return t.run((ctx) => ctx.db.get(orderId));
	};

	test("the claim page receives each line's live prep window and note", async () => {
		const t = setup();
		const { token, productId } = await sendPuffs(t, {
			prepMinutes: 120,
			pickupNote: "Side counter.",
		});
		// Edited after the link went out — the page shows what stands NOW.
		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.products.update, {
				productId,
				pickupNote: "Front counter.",
			});
		const payload = await t.query(api.orderClaims.getByToken, { token });
		expect(payload?.open?.lines[0]).toMatchObject({
			name: "Ice Cream Puff",
			prepMinutes: 120,
			pickupNote: "Front counter.",
		});
	});

	test("a self-collect time is kept — it used to be silently dropped", async () => {
		const t = setup();
		const { claimId, token } = await sendPuffs(t);
		const tomorrow = fulfilmentDateBounds(0).min + DAY;
		await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "self_collect",
			fulfilmentDate: tomorrow,
			fulfilmentTimeMinutes: 11 * 60 + 30,
		});
		expect((await orderOf(t, claimId))?.fulfilmentTimeMinutes).toBe(690);
	});

	test("the prep floor refuses a same-day pickup inside the window, naming the product", async () => {
		// Skipped in the last half hour before MYT midnight: from 23:41 the
		// flat 15-min lead empties the day even WITHOUT prep, the prep rule
		// defers to opening-hours rules that no-op with hours unset, and the
		// commit resolves — the server gap the same guards in orders.test.ts
		// document (ticketed follow-up; remove all five once it refuses).
		if (nowMinutes() >= 1410) return;
		const t = setup();
		const { token } = await sendPuffs(t, { prepMinutes: 120 });
		await expect(
			t.mutation(api.orderClaims.commit, {
				token,
				deliveryMethod: "self_collect",
				fulfilmentDate: fulfilmentDateBounds(0).min,
				fulfilmentTimeMinutes: Math.min(1439, nowMinutes() + 1),
			}),
		).rejects.toThrow(/Ice Cream Puff.*2 hours to prepare/s);
	});

	test("a prep window that swallows today asks for a later day; tomorrow takes any time", async () => {
		// Same near-midnight skip as above — past 23:41 the refusal defers
		// and the commit resolves.
		if (nowMinutes() >= 1410) return;
		const t = setup();
		const { claimId, token } = await sendPuffs(t, { prepMinutes: 1440 });
		const today = fulfilmentDateBounds(0).min;
		await expect(
			t.mutation(api.orderClaims.commit, {
				token,
				deliveryMethod: "self_collect",
				fulfilmentDate: today,
				fulfilmentTimeMinutes: 23 * 60,
			}),
		).rejects.toThrow(/too late for today, pick a later day/);
		await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "self_collect",
			fulfilmentDate: today + DAY,
			fulfilmentTimeMinutes: 9 * 60,
		});
		expect((await orderOf(t, claimId))?.fulfilmentTimeMinutes).toBe(540);
	});

	test("the last minutes of the day refuse a same-day commit too (the 23:41 gap)", async () => {
		// From 23:41 MYT the flat 15-minute lead alone empties an all-day
		// store; the prep rule used to defer to opening-hours rules that no-op
		// with hours unset, and the commit RESOLVED. Same gate as
		// orders.create, pinned at 23:45 so the gap's window is always tested.
		vi.useFakeTimers();
		try {
			const FRI = Date.UTC(2026, 5, 26) - 8 * 3600_000;
			vi.setSystemTime(FRI + (23 * 60 + 45) * 60_000);
			const t = setup();
			const { claimId, token } = await sendPuffs(t, { prepMinutes: 240 });
			await expect(
				t.mutation(api.orderClaims.commit, {
					token,
					deliveryMethod: "self_collect",
					fulfilmentDate: FRI,
					fulfilmentTimeMinutes: 1439,
				}),
			).rejects.toThrow(/4 hours to prepare.*too late for today/s);
			await t.mutation(api.orderClaims.commit, {
				token,
				deliveryMethod: "self_collect",
				fulfilmentDate: FRI + DAY,
				fulfilmentTimeMinutes: 9 * 60,
			});
			expect((await orderOf(t, claimId))?.fulfilmentDate).toBe(FRI + DAY);
		} finally {
			vi.useRealTimers();
		}
	});

	test("a DATE-ONLY commit's prep runs to midnight — closing time can't hide a day-long prep", async () => {
		// orders.create's rule: no time sent, so prep is judged to the end of
		// the day. At 8 PM a 9-to-6 store had no slots with prep AND none
		// without, so prep used to look blameless and tonight was bookable.
		vi.useFakeTimers();
		try {
			const FRI = Date.UTC(2026, 5, 26) - 8 * 3600_000;
			vi.setSystemTime(FRI + 20 * 3600_000);
			const t = setup();
			const { claimId, token } = await sendPuffs(t, { prepMinutes: 1440 });
			await t
				.withIdentity({ subject: USER_A })
				.mutation(api.retailers.updateSettings, {
					openingHours: Array.from({ length: 7 }, () => ({
						open: 9 * 60,
						close: 18 * 60,
					})),
				});
			await expect(
				t.mutation(api.orderClaims.commit, {
					token,
					deliveryMethod: "self_collect",
					fulfilmentDate: FRI,
				}),
			).rejects.toThrow(/24 hours to prepare.*too late for today/s);
			await t.mutation(api.orderClaims.commit, {
				token,
				deliveryMethod: "self_collect",
				fulfilmentDate: FRI + DAY,
			});
			expect((await orderOf(t, claimId))?.fulfilmentDate).toBe(FRI + DAY);
		} finally {
			vi.useRealTimers();
		}
	});

	describe("a date-only commit at a COUNTER still races closing time (z8r3fdg9aa)", () => {
		// orders.create's rule, word for word. The commit used to ask "did a
		// time arrive?" instead of the checkout's question, so a commit with no
		// time took the midnight reading even at a counter whose hour IS the
		// store's. Pinned clock: Fri 26 Jun 2026, MYT.
		const FRI = Date.UTC(2026, 5, 26) - 8 * 3600_000;
		const at = (h: number, m = 0) => FRI + (h * 60 + m) * 60_000;
		const nineToSix = Array.from({ length: 7 }, () => ({
			open: 9 * 60,
			close: 18 * 60,
		}));
		afterEach(() => vi.useRealTimers());

		/** A 9-to-6 store with one ordinary self-collect counter; returns a
		 * DATE-ONLY commit (no `fulfilmentTimeMinutes`) for the given day. */
		async function counterCommit(
			t: ReturnType<typeof setup>,
			prepMinutes: number,
		) {
			const { retailer, claimId, token } = await sendPuffs(t, { prepMinutes });
			const asUser = t.withIdentity({ subject: USER_A });
			await asUser.mutation(api.retailers.updateSettings, {
				offerSelfCollect: true,
				openingHours: nineToSix,
			});
			const { pickupLocationId } = await asUser.mutation(
				api.pickupLocations.create,
				{
					retailerId: retailer._id,
					label: "Kedai counter",
					address: "Seksyen 7, Shah Alam",
					locationType: "self_collect",
				},
			);
			return {
				claimId,
				commit: (fulfilmentDate: number) =>
					t.mutation(api.orderClaims.commit, {
						token,
						deliveryMethod: "self_collect" as const,
						pickupLocationId,
						fulfilmentDate,
					}),
			};
		}

		test("prep running past closing is refused, though no time was sent", async () => {
			vi.useFakeTimers();
			vi.setSystemTime(at(17));
			const t = setup();
			const { claimId, commit } = await counterCommit(t, 120);
			await expect(commit(FRI)).rejects.toThrow(
				/Ice Cream Puff.*2 hours to prepare.*too late for today/s,
			);
			await commit(FRI + DAY);
			expect((await orderOf(t, claimId))?.fulfilmentDate).toBe(FRI + DAY);
		});

		test("the same commit resolves while the day still has prep-able slots", async () => {
			vi.useFakeTimers();
			vi.setSystemTime(at(14));
			const t = setup();
			const { claimId, commit } = await counterCommit(t, 120);
			await commit(FRI);
			expect((await orderOf(t, claimId))?.fulfilmentDate).toBe(FRI);
		});

		test("after closing, a day-long prep is still refused — the DAY's own deadline", async () => {
			vi.useFakeTimers();
			vi.setSystemTime(at(20));
			const t = setup();
			const { commit } = await counterCommit(t, 1440);
			await expect(commit(FRI)).rejects.toThrow(
				/Ice Cream Puff.*24 hours to prepare.*too late for today/s,
			);
		});

		test("a DROP-OFF meet-up keeps its own hour — the shutters were never its deadline", async () => {
			// The trap: feed `asksForTime` the point's kind, or every meet-up
			// starts racing closing time. 4:30 PM plus 2h is 6:30 PM — past the
			// counter's close, fine for a meet-up.
			vi.useFakeTimers();
			vi.setSystemTime(at(16, 30));
			const t = setup();
			const { retailer, claimId, token } = await sendPuffs(t, {
				prepMinutes: 120,
			});
			const asUser = t.withIdentity({ subject: USER_A });
			await asUser.mutation(api.retailers.updateSettings, {
				offerSelfCollect: true,
				openingHours: nineToSix,
			});
			const { pickupLocationId } = await asUser.mutation(
				api.pickupLocations.create,
				{
					retailerId: retailer._id,
					label: "Pasar Sabtu",
					address: "Seksyen 7, Shah Alam",
					locationType: "drop_off",
				},
			);
			await t.mutation(api.orderClaims.commit, {
				token,
				deliveryMethod: "self_collect",
				pickupLocationId,
				fulfilmentDate: FRI,
			});
			expect((await orderOf(t, claimId))?.fulfilmentDate).toBe(FRI);
		});
	});

	test("a collection trip is exempt — the rider collects first, the work comes after", async () => {
		const t = setup();
		const { retailer, claimId, token } = await sendPuffs(t, {
			prepMinutes: 240,
		});
		await t.run((ctx) =>
			ctx.db.patch(retailer._id, {
				deliveryBooking: {
					enabled: false,
					vehicleType: "MOTORCYCLE",
					deliveryDirection: "collection",
				},
			}),
		);
		const soon = Math.min(1439, nowMinutes() + 20);
		await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: MY_ADDRESS,
			fulfilmentDate: fulfilmentDateBounds(0).min,
			fulfilmentTimeMinutes: soon,
		});
		const order = await orderOf(t, claimId);
		expect(order?.deliveryDirection).toBe("collection");
		expect(order?.fulfilmentTimeMinutes).toBe(soon);
	});

	test("the pickup note freezes from the LIVE product at commit", async () => {
		const t = setup();
		const { claimId, token, productId } = await sendPuffs(t, {
			pickupNote: "Side counter.",
		});
		// A typo fix between send and commit reaches the buyer…
		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.products.update, {
				productId,
				pickupNote: "Side counter — bring an ice bag.",
			});
		await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "self_collect",
			fulfilmentDate: fulfilmentDateBounds(0).min + DAY,
		});
		// …and an edit AFTER commit never rewrites what they were told.
		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.products.update, { productId, pickupNote: "Gone." });
		expect((await orderOf(t, claimId))?.items[0].pickupNote).toBe(
			"Side counter — bring an ice bag.",
		);
	});

	test("a product without a note freezes no note key at all", async () => {
		const t = setup();
		const { claimId, token } = await sendPuffs(t);
		await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "self_collect",
			fulfilmentDate: fulfilmentDateBounds(0).min + DAY,
		});
		const order = await orderOf(t, claimId);
		expect(order?.items[0]).not.toHaveProperty("pickupNote");
	});
});

/**
 * Off-Season Hold (z8r3fday24) on the claim path. A claim sent minutes before
 * the seller pauses is a live link in a buyer's chat — the one create path the
 * first cut of the hold missed, found in review. The invariant is "every
 * order-create path refuses while paused", so it has to hold here too.
 */
describe("orderClaims — Off-Season Hold (z8r3fday24)", () => {
	async function sentClaimThenPause(t: ReturnType<typeof setup>) {
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await seedSession(t, USER_A);
		const { claimId, token } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 1, unitPrice: 8900 }],
				windowMinutes: 60,
			});
		// The seller pauses AFTER the link went out.
		await t.run((ctx) =>
			ctx.db.patch(retailer._id, { orderingPausedAt: Date.now() }),
		);
		return { retailer, variantId, claimId, token };
	}

	test("commit refuses a claim sent before the pause — stock untouched, no order", async () => {
		const t = setup();
		const { variantId, claimId, token } = await sentClaimThenPause(t);
		const before = await t.run((ctx) => ctx.db.get(variantId));

		await expect(
			t.mutation(api.orderClaims.commit, {
				token,
				deliveryMethod: "delivery",
				deliveryAddress: MY_ADDRESS,
			}),
		).rejects.toThrow(/seasonal break/i);

		// The refusal is total: no order, no stock movement, claim still open.
		const claim = await getClaim(t, claimId);
		expect(claim.status).toBe("open");
		expect(claim.orderId).toBeUndefined();
		expect((await t.run((ctx) => ctx.db.get(variantId)))?.onHand).toBe(
			before?.onHand,
		);
	});

	test("an ALREADY completed claim still returns its order while paused (idempotent re-open)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await seedSession(t, USER_A);
		const { token } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 1, unitPrice: 8900 }],
				windowMinutes: 60,
			});
		const committed = await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: MY_ADDRESS,
		});
		// Pause AFTER the buyer already completed — reopening their link must
		// still hand back the order they placed, never the break notice.
		await t.run((ctx) =>
			ctx.db.patch(retailer._id, { orderingPausedAt: Date.now() }),
		);
		const again = await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: MY_ADDRESS,
		});
		expect(again.shortId).toBe(committed.shortId);
	});

	test("resend refuses while paused — a fresh link is a new invitation", async () => {
		const t = setup();
		const { claimId } = await sentClaimThenPause(t);
		await expect(
			t
				.withIdentity({ subject: USER_A })
				.mutation(api.orderClaims.resendClaim, { claimId }),
		).rejects.toThrow(/seasonal break/i);
		// Send count untouched — nothing was pushed to the buyer.
		expect((await getClaim(t, claimId)).sentCount).toBe(1);
	});

	test("the buyer page learns on LOAD: getByToken carries orderingPaused", async () => {
		const t = setup();
		const { token } = await sentClaimThenPause(t);
		const payload = await t.query(api.orderClaims.getByToken, { token });
		expect(payload?.store.orderingPaused).toBe(true);
		// Still "open" as a claim — the page ranks the pause above it and renders
		// the dead end, so the buyer never fills a form the commit would refuse.
		expect(payload?.status).toBe("open");
	});

	test("an open store is unaffected — commit works and the flag is false", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await seedSession(t, USER_A);
		const { token } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 1, unitPrice: 8900 }],
				windowMinutes: 60,
			});
		expect(
			(await t.query(api.orderClaims.getByToken, { token }))?.store
				.orderingPaused,
		).toBe(false);
		await expect(
			t.mutation(api.orderClaims.commit, {
				token,
				deliveryMethod: "delivery",
				deliveryAddress: MY_ADDRESS,
			}),
		).resolves.toBeDefined();
	});
});

describe("orderClaims — listClaims + crons", () => {
	test("listClaims shows the live-judged status; foreign sellers see nothing", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await seedRetailer(t, USER_B);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await seedSession(t, USER_A);
		const { claimId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				windowMinutes: 15,
			});

		const mine = await t
			.withIdentity({ subject: USER_A })
			.query(api.orderClaims.listClaims, {});
		expect(mine).toHaveLength(1);
		expect(mine[0].status).toBe("open");

		const theirs = await t
			.withIdentity({ subject: USER_B })
			.query(api.orderClaims.listClaims, {});
		expect(theirs).toHaveLength(0);

		// Past-deadline open row reads Expired in the list before any sweep.
		await t.run((ctx) =>
			ctx.db.patch(claimId, { expiresAt: Date.now() - 1000 }),
		);
		const after = await t
			.withIdentity({ subject: USER_A })
			.query(api.orderClaims.listClaims, {});
		expect(after[0].status).toBe("expired");
	});

	test("expire cron flips past-deadline claims; purge deletes old dead ones only", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await seedSession(t, USER_A);
		const { claimId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				windowMinutes: 15,
			});
		await t.run((ctx) =>
			ctx.db.patch(claimId, { expiresAt: Date.now() - 1000 }),
		);
		await t.mutation(internal.orderClaims.expireStaleClaims, {});
		expect((await getClaim(t, claimId)).status).toBe("expired");

		// Fresh-dead: retained. Old-dead: purged (PII).
		await t.mutation(internal.orderClaims.purgeStaleClaims, {});
		expect(await t.run((ctx) => ctx.db.get(claimId))).not.toBeNull();
		await t.run((ctx) =>
			ctx.db.patch(claimId, {
				expiresAt: Date.now() - CLAIM_RETENTION_MS - 1000,
			}),
		);
		await t.mutation(internal.orderClaims.purgeStaleClaims, {});
		expect(await t.run((ctx) => ctx.db.get(claimId))).toBeNull();
	});
});

describe("orderClaims — payment deadline (the carried timer)", () => {
	/** Send a claim + commit it as a delivery order; returns ids for assertions. */
	async function committedOrder(
		t: ReturnType<typeof setup>,
		opts: Parameters<typeof seedVariant>[3] = {},
	) {
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, {
			block: true,
			onHand: 10,
			...opts,
		});
		const sessionId = await seedSession(t, USER_A);
		const { claimId, token, expiresAt } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 2 }],
				windowMinutes: 15,
			});
		await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: MY_ADDRESS,
		});
		const orderId = await t.run(async (ctx) => {
			const claim = await ctx.db.get(claimId);
			if (!claim?.orderId) throw new Error("commit didn't settle the claim");
			return claim.orderId;
		});
		return { retailer, variantId, claimId, orderId, claimExpiresAt: expiresAt };
	}

	test("commit stamps paymentDueAt: the claim deadline floored to a full payment runway", async () => {
		const t = setup();
		const before = Date.now();
		const { orderId, claimExpiresAt } = await committedOrder(t);
		const order = await t.run((ctx) => ctx.db.get(orderId));
		// 15-min window: barely any of it was spent, so the floor (now + runway)
		// and the claim deadline are within seconds of each other — assert the
		// contract, not the winner: never earlier than either input.
		expect(order?.paymentDueAt).toBeGreaterThanOrEqual(claimExpiresAt);
		expect(order?.paymentDueAt).toBeGreaterThanOrEqual(
			before + CLAIM_PAYMENT_RUNWAY_MS,
		);
	});

	test("the sweep cancels a due unpaid order: stock back, deadline cleared, reason stamped", async () => {
		const t = setup();
		const { orderId, variantId } = await committedOrder(t);
		// Commit took 2 of the 10 on hand.
		expect((await t.run((ctx) => ctx.db.get(variantId)))?.onHand).toBe(8);

		await t.run((ctx) => ctx.db.patch(orderId, { paymentDueAt: Date.now() - 1000 }));
		const result = await t.mutation(
			internal.orderClaims.cancelUnpaidDueOrders,
			{},
		);
		expect(result.cancelled).toBe(1);

		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.status).toBe("cancelled");
		expect(order?.cancelledReason).toBe("payment_window_expired");
		expect(order?.paymentDueAt).toBeUndefined();
		// The whole point: the held stock came back.
		expect((await t.run((ctx) => ctx.db.get(variantId)))?.onHand).toBe(10);
	});

	test("the sweep leaves protected orders alone: claimed, fee-pending, live gateway session, already-fulfilling", async () => {
		const t = setup();
		const { orderId } = await committedOrder(t);
		const past = Date.now() - 1000;

		for (const patch of [
			{ paymentDueAt: past, paymentStatus: "claimed" as const },
			{ paymentDueAt: past, paymentStatus: "unpaid" as const, deliveryFeePending: true },
			{
				paymentDueAt: past,
				paymentStatus: "unpaid" as const,
				deliveryFeePending: undefined,
				gatewayRequestedAt: Date.now(),
			},
		]) {
			await t.run((ctx) => ctx.db.patch(orderId, patch));
			const result = await t.mutation(
				internal.orderClaims.cancelUnpaidDueOrders,
				{},
			);
			expect(result.cancelled).toBe(0);
			expect((await t.run((ctx) => ctx.db.get(orderId)))?.status).not.toBe(
				"cancelled",
			);
		}

		// Seller started fulfilling an unpaid order — their call stands.
		await t.run((ctx) =>
			ctx.db.patch(orderId, {
				gatewayRequestedAt: undefined,
				status: "packed",
			}),
		);
		const result = await t.mutation(
			internal.orderClaims.cancelUnpaidDueOrders,
			{},
		);
		expect(result.cancelled).toBe(0);
	});

	test("real money retires the deadline through the shared receive core", async () => {
		const t = setup();
		const { orderId } = await committedOrder(t);
		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orders.markPaymentReceived, { orderId });
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.paymentStatus).toBe("received");
		expect(order?.paymentDueAt).toBeUndefined();
		// And a later sweep has nothing to say about it.
		const result = await t.mutation(
			internal.orderClaims.cancelUnpaidDueOrders,
			{},
		);
		expect(result.cancelled).toBe(0);
	});

	test("a HitPay mint extends a nearly-dead deadline — the buyer's clock jumps, never a freeze", async () => {
		const t = setup();
		const { orderId } = await committedOrder(t);
		// 40 seconds left when the buyer taps Pay.
		const nearlyDead = Date.now() + 40_000;
		await t.run((ctx) => ctx.db.patch(orderId, { paymentDueAt: nearlyDead }));
		const before = Date.now();
		const res = await t.mutation(internal.hitpay.recordCheckoutRequest, {
			orderId,
			requestId: "req_test_1",
			url: "https://securecheckout.example/req_test_1",
			amountSen: 17800,
			currency: "MYR",
		});
		expect(res.ok).toBe(true);
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.paymentDueAt).toBeGreaterThanOrEqual(
			before + CLAIM_PAYMENT_RUNWAY_MS,
		);
		// And the live session itself shields the order from the sweep even
		// past the (old) deadline — belt and braces.
		expect(order?.gatewayRequestedAt).toBeGreaterThanOrEqual(before);
	});

	test("a seller's own cancel clears the deadline too (index hygiene)", async () => {
		const t = setup();
		const { orderId } = await committedOrder(t);
		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orders.updateStatus, { orderId, status: "cancelled" });
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.status).toBe("cancelled");
		expect(order?.paymentDueAt).toBeUndefined();
		// No robot signature on a human cancel.
		expect(order?.cancelledReason).toBeUndefined();
	});
});

describe("orderClaims — the checkout is frozen while its link is out", () => {
	/** Seller sends a link, then goes back to fiddle with the same checkout. */
	async function seedSentClaim(t: ReturnType<typeof setup>) {
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, {
			price: 12000,
		});
		const sessionId = await seedSession(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const { claimId } = await asA.mutation(api.orderClaims.sendClaim, {
			sessionId,
			items: [{ variantId, quantity: 1 }],
			windowMinutes: 15,
		});
		return { retailer, variantId, sessionId, asA, claimId };
	}

	// The silent one: the buyer's page renders the FROZEN claim, so a draft edit
	// would never reach them — the seller would believe a change landed that
	// didn't. Refusing is the only honest answer.
	test("a draft edit is refused, not silently diverged from the buyer's offer", async () => {
		const t = setup();
		const { sessionId, variantId, asA, claimId } = await seedSentClaim(t);

		await expect(
			asA.mutation(api.counterCheckout.saveSessionDraft, {
				sessionId,
				draft: { items: [{ variantId, quantity: 9 }] },
			}),
		).rejects.toThrow(/cancel the link first/i);

		// Release it and the same edit goes through — the way back is deliberate.
		await asA.mutation(api.orderClaims.cancelClaim, { claimId });
		await asA.mutation(api.counterCheckout.saveSessionDraft, {
			sessionId,
			draft: { items: [{ variantId, quantity: 9 }] },
		});
		const session = await t.run((ctx) => ctx.db.get(sessionId));
		expect(session?.draft?.items[0].quantity).toBe(9);
	});

	// The loud one: ringing it up at the counter used to cancel the buyer's link
	// out from under them mid-form.
	test("ringing the same cart up at the counter is refused while the link is live", async () => {
		const t = setup();
		const { sessionId, variantId, asA, claimId } = await seedSentClaim(t);

		await expect(
			asA.mutation(api.counterCheckout.createOrderFromSession, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				paidInPerson: true,
				paymentMethod: "cash",
			}),
		).rejects.toThrow(/cancel the link first/i);

		await asA.mutation(api.orderClaims.cancelClaim, { claimId });
		const { shortId } = await asA.mutation(
			api.counterCheckout.createOrderFromSession,
			{
				sessionId,
				items: [{ variantId, quantity: 1 }],
				paidInPerson: true,
				paymentMethod: "cash",
			},
		);
		expect(shortId).toMatch(/^ORD-/);
	});

	// A claim past its deadline must not hold the checkout hostage while it
	// waits for the 5-minute sweep — `effectiveClaimStatus`, not the column.
	test("an expired-but-unswept claim stops freezing the checkout", async () => {
		const t = setup();
		const { sessionId, variantId, asA, claimId } = await seedSentClaim(t);
		await t.run(async (ctx) =>
			ctx.db.patch(claimId, { expiresAt: Date.now() - 1000 }),
		);
		// Still stored as "open", but nothing about it is live any more.
		expect((await getClaim(t, claimId)).status).toBe("open");

		await asA.mutation(api.counterCheckout.saveSessionDraft, {
			sessionId,
			draft: { items: [{ variantId, quantity: 4 }] },
		});
		const session = await t.run((ctx) => ctx.db.get(sessionId));
		expect(session?.draft?.items[0].quantity).toBe(4);
	});

	test("the checkout is parked out of Open checkouts and comes back on release", async () => {
		const t = setup();
		const { retailer, sessionId, asA, claimId } = await seedSentClaim(t);
		const open = () =>
			asA.query(api.counterCheckout.listOpenSessions, {
				retailerId: retailer._id,
			});

		// Parked with the buyer: it lives under "Waiting on buyers" instead, so
		// listing it here too would show the same buyer twice — with a dismiss
		// button next to a live offer.
		expect(await open()).toHaveLength(0);

		await asA.mutation(api.orderClaims.cancelClaim, { claimId });
		const rows = await open();
		expect(rows).toHaveLength(1);
		expect(rows[0].sessionId).toBe(sessionId);
	});

	test("getCheckoutSession hands the screen the frozen snapshot, not the draft", async () => {
		const t = setup();
		const { sessionId, asA, claimId } = await seedSentClaim(t);

		const session = await asA.query(api.counterCheckout.getCheckoutSession, {
			sessionId,
		});
		expect(session?.liveClaim?.claimId).toBe(claimId);
		expect(session?.liveClaim?.lines).toHaveLength(1);
		expect(session?.liveClaim?.itemsTotal).toBe(12000);

		await asA.mutation(api.orderClaims.cancelClaim, { claimId });
		const released = await asA.query(api.counterCheckout.getCheckoutSession, {
			sessionId,
		});
		expect(released?.liveClaim).toBeNull();
	});
});
